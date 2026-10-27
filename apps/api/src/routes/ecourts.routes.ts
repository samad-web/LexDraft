import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import * as ecourts from '../services/ecourts.service';
import * as ecourtsLive from '../services/ecourts-live.service';
import * as ecourtsWeb from '../services/ecourts-web-search.service';
import { firmIdForUser } from '../services/tenant';
import { logger } from '../logger';
import { BadRequestError, UnauthorizedError } from '../lib/errors';
import { db } from '../db/client';
import { MAX_ATTEMPTS, RETRY_DELAY_SEC } from '../services/ecourts-sync-runs.service';

// =============================================================================
// /api/ecourts — live data from the eCourts Services backend (district + high
// court case lookup, cause lists, party / advocate / FIR / caveat search,
// reference data, order PDFs).
//
// Wire protocol: the service layer in services/ecourts.service.ts handles the
// AES-encrypted request format and per-session JWT cycle (see
// memory/project_ecourts_api_reverse_engineering.md). Route handlers are thin
// — they validate input with Zod, delegate to the service, and return what
// comes back.
//
// All endpoints sit behind `requireAuth + requireActivePlan` (applied at the
// mount site in routes/index.ts).
// =============================================================================

export const ecourtsRouter: Router = Router();

const CourtParam = z.enum(['DC', 'HC']).default('DC');

// ---------------------------------------------------------------------------
// GET /ecourts/sync/status — health of the firm's eCourts connection: the
// latest scheduled run (09:00 / 19:00 IST, plus retries) and how many of the
// firm's matters are linked / pending / not found. Drives the status strip
// on the eCourts and Matters screens.
// ---------------------------------------------------------------------------

// POST /ecourts/sync/firm - "Sync from eCourts" on Hearings: refresh this
// firm's matters now (hearings, next dates, orders) in the background. One
// queued run per firm at a time; recently synced matters are skipped.
ecourtsRouter.post('/sync/firm', async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    if (!firmId) {
      res.status(422).json({ error: 'No firm attached' });
      return;
    }
    const { countFirmSyncCandidates } = await import('../services/ecourts-sync-runs.service');
    const { due, total, closed } = await countFirmSyncCandidates(firmId);
    if (due > 0) {
      const { jobs } = await import('../services/jobs.service');
      // Not awaited: without a queue (memory mode) enqueue runs the job
      // inline, which would hold this request for minutes.
      void jobs.enqueue('ecourts.sync.firm', { firmId }, { singletonKey: `ecourts-sync-firm:${firmId}` })
        .catch((err: unknown) => logger.warn({ err, firmId }, 'ecourts firm sync: enqueue failed'));
    }
    res.status(202).json({ queued: due, total, closed });
  } catch (err) {
    next(err);
  }
});

ecourtsRouter.get('/sync/status', async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    const sql = db();
    if (!firmId || !sql) {
      res.json({ lastRun: null, retryPending: false, counts: null, schedule: SYNC_SCHEDULE });
      return;
    }
    const [lastRun] = await sql<Array<{
      slot: string; run_date: string; attempt: number; status: string;
      started_at: Date; finished_at: Date | null;
    }>>`
      select slot, run_date::text, attempt, status, started_at, finished_at
      from ecourts_sync_runs
      where slot <> 'manual'
      order by started_at desc
      limit 1
    `;
    const [counts] = await sql<Array<Record<'linked' | 'pending' | 'not_found' | 'error' | 'unlinked', number>>>`
      select
        count(*) filter (where ecourts_link_status = 'linked')::int    as linked,
        count(*) filter (where ecourts_link_status = 'pending')::int   as pending,
        count(*) filter (where ecourts_link_status = 'not_found')::int as not_found,
        count(*) filter (where ecourts_link_status = 'error')::int     as error,
        count(*) filter (where ecourts_link_status = 'unlinked')::int  as unlinked
      from cases
      where firm_id = ${firmId}::uuid and deleted_at is null and kind = 'matter'
        and status in ('Active', 'Pending')
    `;
    res.json({
      lastRun: lastRun
        ? {
            slot: lastRun.slot,
            runDate: lastRun.run_date,
            attempt: lastRun.attempt,
            status: lastRun.status,
            startedAt: lastRun.started_at,
            finishedAt: lastRun.finished_at,
          }
        : null,
      // An upstream_down/partial run below the attempt cap has a retry queued.
      retryPending: !!lastRun
        && (lastRun.status === 'upstream_down' || lastRun.status === 'partial')
        && lastRun.attempt < MAX_ATTEMPTS,
      counts: counts
        ? {
            linked: counts.linked,
            pending: counts.pending,
            notFound: counts.not_found,
            error: counts.error,
            unlinked: counts.unlinked,
          }
        : null,
      schedule: SYNC_SCHEDULE,
    });
  } catch (err) {
    next(err);
  }
});

const SYNC_SCHEDULE = { timezone: 'Asia/Kolkata', times: ['09:00', '19:00'], retryEveryMinutes: RETRY_DELAY_SEC / 60 };

// ---------------------------------------------------------------------------
// Reference data — states, districts, court establishments, case types, acts.
// All cached for 24h in-process; first hit pays the round-trip, the rest are
// free.
// ---------------------------------------------------------------------------

const CourtQuery = z.object({ court: CourtParam.optional() });

ecourtsRouter.get(
  '/reference/states',
  validate({ query: CourtQuery }),
  async (req, res, next) => {
    try {
      const court = (req.query as { court?: 'DC' | 'HC' }).court ?? 'DC';
      const states = await ecourts.listStates(court);
      res.json({ items: states });
    } catch (err) {
      next(err);
    }
  },
);

ecourtsRouter.get(
  '/reference/districts/:stateCode',
  validate({
    params: z.object({ stateCode: z.coerce.number().int().positive() }),
    query: CourtQuery,
  }),
  async (req, res, next) => {
    try {
      const { stateCode } = req.params as unknown as { stateCode: number };
      const court = (req.query as { court?: 'DC' | 'HC' }).court ?? 'DC';
      const districts = await ecourts.listDistricts(stateCode, court);
      res.json({ items: districts });
    } catch (err) {
      next(err);
    }
  },
);

ecourtsRouter.get(
  '/reference/court-establishments/:stateCode/:distCode',
  validate({
    params: z.object({
      stateCode: z.coerce.number().int().positive(),
      distCode:  z.coerce.number().int().positive(),
    }),
    query: CourtQuery,
  }),
  async (req, res, next) => {
    try {
      const { stateCode, distCode } = req.params as unknown as { stateCode: number; distCode: number };
      const court = (req.query as { court?: 'DC' | 'HC' }).court ?? 'DC';
      const items = await ecourts.listCourtEstablishments(stateCode, distCode, court);
      res.json({ items });
    } catch (err) {
      next(err);
    }
  },
);

// Court-complex directory served from our own cache (migration
// 0071_ecourts_court_complexes.sql), not a live eCourts call - the live
// lookup is blocked for automated callers. Empty array means we haven't
// captured that district yet; the UI falls back to a manual code field.
ecourtsRouter.get(
  '/reference/court-complexes/:stateCode/:distCode',
  validate({
    params: z.object({
      stateCode: z.coerce.number().int().positive(),
      distCode:  z.coerce.number().int().positive(),
    }),
    query: CourtQuery,
  }),
  async (req, res, next) => {
    try {
      const { stateCode, distCode } = req.params as unknown as { stateCode: number; distCode: number };
      const court = (req.query as { court?: 'DC' | 'HC' }).court ?? 'DC';
      const items = await ecourts.listCachedCourtComplexes(stateCode, distCode, court);
      res.json({ items });
    } catch (err) {
      next(err);
    }
  },
);

// Individual courts within a complex, served from our own cache (migration
// 0072_ecourts_courts.sql). A case is filed at a specific court, not just a
// complex - this is what search endpoints actually need as `estCode`.
ecourtsRouter.get(
  '/reference/courts/:stateCode/:distCode/:complexCode',
  validate({
    params: z.object({
      stateCode:   z.coerce.number().int().positive(),
      distCode:    z.coerce.number().int().positive(),
      complexCode: z.string().min(1).max(20),
    }),
    query: CourtQuery,
  }),
  async (req, res, next) => {
    try {
      const { stateCode, distCode, complexCode } = req.params as unknown as { stateCode: number; distCode: number; complexCode: string };
      const court = (req.query as { court?: 'DC' | 'HC' }).court ?? 'DC';
      const items = await ecourts.listCachedCourts(stateCode, distCode, complexCode, court);
      res.json({ items });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// CNR-direct live lookup - the path used inline on search results (Party
// Name, Advocate, etc. from the fast mobile API all return a `cino` per
// case). Single page, no state/district/complex selection - see
// ecourts-live.service.ts's startCnrSession doc comment.
// ---------------------------------------------------------------------------

const SessionIdParam = z.object({ sessionId: z.string().uuid() });
const LiveCaptchaBody = z.object({
  captchaCode: z.string().min(1).max(20),
  // Required, not re-derived from the page: see submitCnrCaptcha's doc
  // comment - reading #cino from the DOM after a wrong-captcha error is
  // unreliable (the field can already be hidden/cleared by the page's own
  // JS at that point), which caused a second wrong-captcha attempt to fail
  // with eCourts' own "Enter 16 digit CNR number" instead of a captcha error.
  cino: z.string().regex(/^[A-Za-z]{4}[A-Za-z0-9]{12}$/, 'CNR must be 16 chars (4 letters + 12 alphanumeric)'),
});

ecourtsRouter.post('/live/cnr-session', async (req, res, next) => {
  try {
    if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
    const result = await ecourtsLive.startCnrSession(req.user.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

const CnrLookupBody = z.object({ cino: z.string().regex(/^[A-Za-z]{4}[A-Za-z0-9]{12}$/, 'CNR must be 16 chars (4 letters + 12 alphanumeric)') });
ecourtsRouter.post(
  '/live/session/:sessionId/cnr',
  validate({ params: SessionIdParam, body: CnrLookupBody }),
  async (req, res, next) => {
    try {
      if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
      const { sessionId } = req.params as unknown as { sessionId: string };
      const result = await ecourtsLive.openCnrLookup(sessionId, req.user.id, req.body.cino);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

ecourtsRouter.post(
  '/live/session/:sessionId/cnr/captcha/refresh',
  validate({ params: SessionIdParam }),
  async (req, res, next) => {
    try {
      if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
      const { sessionId } = req.params as unknown as { sessionId: string };
      const result = await ecourtsLive.refreshCnrCaptcha(sessionId, req.user.id);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

ecourtsRouter.post(
  '/live/session/:sessionId/cnr/captcha',
  validate({ params: SessionIdParam, body: LiveCaptchaBody }),
  async (req, res, next) => {
    try {
      if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
      const { sessionId } = req.params as unknown as { sessionId: string };
      const result = await ecourtsLive.submitCnrCaptcha(sessionId, req.user.id, req.body.captchaCode, req.body.cino);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// eCourts app services - no captcha (see ecourts.service.ts "App-only
// services"). Search by case type, Advocate's Cause List by name, and View
// Business (daily status) for a hearing date.
// ---------------------------------------------------------------------------

// A whole court complex, as the eCourts app searches it: every court code in
// the complex, comma-separated, sent as court_code_arr (verified live
// 2026-10-22: "1,2,...,90" for District Court Ernakulam answered for all 23
// establishments). courtCode stays required as the first court of the set.
const CourtCodesParam = z.string().regex(/^\d+(,\d+){0,99}$/, 'Court codes must be comma-separated numbers');

const AppCourtScope = {
  stateCode: z.number().int().positive(),
  distCode: z.number().int().positive(),
  courtCode: z.number().int().positive(),
  courtCodes: CourtCodesParam.optional(),
  court: z.enum(['DC', 'HC']).optional(),
};

// Pre Trial Application (Remand / Bail before registration) - app service,
// no captcha.
ecourtsRouter.post(
  '/pretrial/search',
  validate({
    body: z.object({
      ...AppCourtScope,
      applicationType: z.enum(['R', 'B', 'A']).default('R'),
      policeStCode: z.number().int().positive(),
      firType: z.enum(['0', '1', '2', '3']).default('0'),
      firNumber: z.string().regex(/^[A-Za-z0-9/-]{1,99}$/).optional(),
      year: z.number().int().min(1950).max(2100).optional(),
    }),
  }),
  async (req, res, next) => {
    try {
      res.json(await ecourts.searchPreTrial(req.body));
    } catch (err) {
      next(err);
    }
  },
);

ecourtsRouter.post(
  '/pretrial/order-pdf',
  validate({
    body: z.object({
      stateCode: z.number().int().positive(),
      distCode: z.number().int().positive(),
      courtCode: z.number().int().positive(),
      orderYr: z.string().min(1).max(10),
      orderId: z.string().min(1).max(40),
      crno: z.string().min(1).max(60),
    }),
  }),
  async (req, res, next) => {
    try {
      const pdf = await ecourts.fetchPreTrialOrderPdf(req.body);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="pretrial-order-${String(req.body.orderId).replace(/[^\w-]/g, '_')}.pdf"`);
      res.send(pdf);
    } catch (err) {
      next(err);
    }
  },
);

// GET /ecourts/labels/:language - the eCourts app's own UI labels in one of
// its six languages (cached 24h), keyed by label id.
ecourtsRouter.get(
  '/labels/:language',
  validate({ params: z.object({ language: z.enum(ecourts.ECOURTS_LANGUAGES) }) }),
  async (req, res, next) => {
    try {
      const { language } = req.params as unknown as { language: ecourts.EcourtsLanguage };
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.json({ language, labels: await ecourts.fetchLabels(language) });
    } catch (err) {
      next(err);
    }
  },
);

ecourtsRouter.post(
  '/search/case-type',
  validate({
    body: z.object({
      ...AppCourtScope,
      caseType: z.union([z.string().min(1).max(20), z.number().int()]),
      year: z.number().int().min(1950).max(2100),
      status: z.enum(['Pending', 'Disposed']).default('Pending'),
    }),
  }),
  async (req, res, next) => {
    try {
      res.json(await ecourts.searchByCaseType(req.body));
    } catch (err) {
      next(err);
    }
  },
);

ecourtsRouter.post(
  '/cause-list/advocate',
  validate({
    body: z.object({
      ...AppCourtScope,
      advocateName: z.string().min(3).max(100),
      date: z.string().regex(/^\d{2}-\d{2}-\d{4}$/, 'Use dd-mm-yyyy'),
    }),
  }),
  async (req, res, next) => {
    try {
      res.json(await ecourts.fetchAdvocateCauseList(req.body));
    } catch (err) {
      next(err);
    }
  },
);

ecourtsRouter.post(
  '/business',
  validate({
    body: z.object({
      ...AppCourtScope,
      cino: z.string().regex(/^[A-Za-z]{4}[A-Za-z0-9]{12}$/),
      caseNumber: z.string().min(1).max(40),
      courtNo: z.string().max(20).default(''),
      businessDate: z.string().regex(/^\d{2}-\d{2}-\d{4}$/),
      nextDate: z.string().max(20).default(''),
      disposalFlag: z.string().max(40).default(''),
    }),
  }),
  async (req, res, next) => {
    try {
      res.json(await ecourts.fetchBusiness({ ...req.body, cino: req.body.cino.toUpperCase() }));
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Website-only searches (CAPTCHA, solved by the advocate) - search by case
// type, advocate Bar registration, and Court Orders by party / case number /
// order date. See ecourts-web-search.service.ts. Three steps:
//   POST /live/web-search                        -> { sessionId, captchaImageBase64 }
//   POST /live/web-search/:sessionId/captcha     -> { status: 'ok', result } | { status: 'retry', … }
//   POST /live/web-search/:sessionId/captcha/refresh
//   DELETE /live/web-search/:sessionId
// ---------------------------------------------------------------------------

const DdMmYyyy = z.string().regex(/^\d{2}-\d{2}-\d{4}$/, 'Use dd-mm-yyyy');
const OrderType = z.enum(['both', 'finalorder', 'interim']).default('both');
const WebSearchBody = z.object({
  scope: z.object({
    stateCode: z.number().int().positive(),
    distCode: z.number().int().positive(),
    complexCode: z.string().min(1).max(20),
    courtCode: z.number().int().positive(),
  }),
  fields: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('case-type'),
      caseTypeCode: z.string().min(1).max(20),
      caseTypeName: z.string().max(200).optional(),
      year: z.number().int().min(1950).max(2100),
      status: z.enum(['Pending', 'Disposed']).default('Pending'),
    }),
    z.object({
      kind: z.literal('advocate-bar'),
      barState: z.string().regex(/^[A-Za-z]{1,4}$/, 'Bar state code, e.g. KL'),
      barCode: z.string().regex(/^\d{1,8}$/),
      barYear: z.string().regex(/^\d{4}$/),
      status: z.enum(['Pending', 'Disposed', 'Both']).default('Both'),
    }),
    z.object({
      kind: z.literal('orders-party'),
      partyName: z.string().min(3).max(100),
      year: z.number().int().min(1950).max(2100),
      orderType: OrderType,
    }),
    z.object({
      kind: z.literal('orders-case'),
      caseTypeCode: z.string().min(1).max(20),
      caseTypeName: z.string().max(200).optional(),
      regNo: z.string().regex(/^\d{1,10}$/),
      year: z.number().int().min(1950).max(2100),
      orderType: OrderType,
    }),
    z.object({
      kind: z.literal('orders-date'),
      fromDate: DdMmYyyy,
      toDate: DdMmYyyy,
      orderType: OrderType,
    }),
    z.object({
      kind: z.literal('advocate-name'),
      advocateName: z.string().min(3).max(100),
      status: z.enum(['Pending', 'Disposed', 'Both']).default('Both'),
    }),
    z.object({
      kind: z.literal('advocate-causelist'),
      barState: z.string().regex(/^[A-Za-z]{1,4}$/, 'Bar state code, e.g. KL'),
      barCode: z.string().regex(/^\d{1,8}$/),
      barYear: z.string().regex(/^\d{4}$/),
      date: DdMmYyyy,
    }),
    z.object({
      kind: z.literal('party-status'),
      partyName: z.string().min(3).max(100),
      year: z.number().int().min(1950).max(2100),
      status: z.enum(['Pending', 'Disposed', 'Both']).default('Both'),
    }),
    z.object({
      kind: z.literal('act'),
      actCode: z.string().min(1).max(20),
      actName: z.string().max(300).optional(),
      section: z.string().max(40).optional(),
      status: z.enum(['Pending', 'Disposed']).default('Pending'),
    }),
    z.object({
      kind: z.literal('orders-court'),
      orderType: OrderType,
    }),
    z.object({
      kind: z.literal('cause-list'),
      date: DdMmYyyy,
      listType: z.enum(['civ', 'cri']),
    }),
  ]),
});

// Court orders by party name through the mobile API - no captcha. See
// ecourts-orders.service.ts. The captcha'd website version above stays as a
// fallback for anything the mobile API doesn't carry.
ecourtsRouter.post(
  '/orders/by-party',
  validate({
    body: z.object({
      stateCode: z.number().int().positive(),
      distCode: z.number().int().positive(),
      courtCode: z.number().int().positive(),
      estCode: z.string().min(1).max(20),
      partyName: z.string().trim().min(3).max(100),
      year: z.number().int().min(1950).max(2100),
      orderType: OrderType,
      court: z.enum(['DC', 'HC']).default('DC'),
    }),
  }),
  async (req, res, next) => {
    try {
      const { searchOrdersByParty } = await import('../services/ecourts-orders.service');
      res.json(await searchOrdersByParty(req.body));
    } catch (err) {
      next(err);
    }
  },
);

ecourtsRouter.post('/live/web-search', validate({ body: WebSearchBody }), async (req, res, next) => {
  try {
    if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
    const body = req.body as z.infer<typeof WebSearchBody>;
    res.json(await ecourtsWeb.startWebSearch(req.user.id, body.scope, body.fields));
  } catch (err) {
    next(err);
  }
});

ecourtsRouter.post(
  '/live/web-search/:sessionId/captcha',
  validate({
    params: SessionIdParam,
    body: z.object({
      captchaCode: z.string().min(1).max(20),
      // Court / judge picked from the `choice` options returned at start
      // (court-number orders, cause list).
      choice: z.string().min(1).max(200).optional(),
    }),
  }),
  async (req, res, next) => {
    try {
      if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
      const { sessionId } = req.params as unknown as { sessionId: string };
      res.json(await ecourtsWeb.submitWebSearch(sessionId, req.user.id, req.body.captchaCode, req.body.choice));
    } catch (err) {
      next(err);
    }
  },
);

ecourtsRouter.post(
  '/live/web-search/:sessionId/captcha/refresh',
  validate({ params: SessionIdParam }),
  async (req, res, next) => {
    try {
      if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
      const { sessionId } = req.params as unknown as { sessionId: string };
      res.json(await ecourtsWeb.refreshWebSearchCaptcha(sessionId, req.user.id));
    } catch (err) {
      next(err);
    }
  },
);

// ---- Process details (summons / warrants) ---------------------------------
// start (process ID + email) -> captcha -> send OTP to the recipient -> verify
// OTP -> PDF. Refresh / end reuse the web-search session routes.

ecourtsRouter.post(
  '/live/process',
  validate({ body: z.object({ processId: z.string().regex(/^[A-Za-z0-9_]{4,60}$/), email: z.string().email().max(200) }) }),
  async (req, res, next) => {
    try {
      if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
      res.json(await ecourtsWeb.startProcessDetails(req.user.id, req.body.processId, req.body.email));
    } catch (err) {
      next(err);
    }
  },
);

ecourtsRouter.post(
  '/live/process/:sessionId/captcha',
  validate({ params: SessionIdParam, body: z.object({ captchaCode: z.string().min(1).max(20) }) }),
  async (req, res, next) => {
    try {
      if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
      const { sessionId } = req.params as unknown as { sessionId: string };
      res.json(await ecourtsWeb.submitProcessCaptcha(sessionId, req.user.id, req.body.captchaCode));
    } catch (err) {
      next(err);
    }
  },
);

ecourtsRouter.post(
  '/live/process/:sessionId/send-otp',
  validate({
    params: SessionIdParam,
    body: z.object({
      name: z.string().min(1).max(100),
      mobile: z.string().regex(/^\d{10}$/, '10-digit mobile number'),
      email: z.string().email().max(200),
    }),
  }),
  async (req, res, next) => {
    try {
      if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
      const { sessionId } = req.params as unknown as { sessionId: string };
      res.json(await ecourtsWeb.sendProcessOtp(sessionId, req.user.id, req.body));
    } catch (err) {
      next(err);
    }
  },
);

ecourtsRouter.post(
  '/live/process/:sessionId/verify-otp',
  validate({ params: SessionIdParam, body: z.object({ otp: z.string().regex(/^[A-Za-z0-9]{4,10}$/) }) }),
  async (req, res, next) => {
    try {
      if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
      const { sessionId } = req.params as unknown as { sessionId: string };
      const { pdfBase64, filename } = await ecourtsWeb.verifyProcessOtp(sessionId, req.user.id, req.body.otp);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(Buffer.from(pdfBase64, 'base64'));
    } catch (err) {
      next(err);
    }
  },
);

ecourtsRouter.delete('/live/web-search/:sessionId', validate({ params: SessionIdParam }), async (req, res, next) => {
  try {
    if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
    const { sessionId } = req.params as unknown as { sessionId: string };
    await ecourtsWeb.endWebSearchSession(sessionId, req.user.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// Court-scoped dropdown lists - case types, acts, police stations. All three
// need the specific court (see ecourts.service.ts listCaseTypes) and return
// `{ items: [{ code, name }] }`.
// courtCode may be one court or a whole complex ("1,2,3"), as the app sends it.
const CourtScopedParams = z.object({
  stateCode: z.coerce.number().int().positive(),
  distCode:  z.coerce.number().int().positive(),
  courtCode: z.string().regex(/^\d+(,\d+){0,99}$/).transform((v) => (v.includes(',') ? v : Number(v))),
});
type CourtScoped = z.infer<typeof CourtScopedParams>;

const courtScopedList = (
  fetch: (stateCode: number, distCode: number, courtCode: number | string, court: 'DC' | 'HC') => Promise<ecourts.RefOption[]>,
) => async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const p = req.params as unknown as CourtScoped;
    const court = (req.query as { court?: 'DC' | 'HC' }).court ?? 'DC';
    res.json({ items: await fetch(p.stateCode, p.distCode, p.courtCode, court) });
  } catch (err) {
    next(err);
  }
};

ecourtsRouter.get(
  '/reference/case-types/:stateCode/:distCode/:courtCode',
  validate({ params: CourtScopedParams, query: CourtQuery }),
  courtScopedList(ecourts.listCaseTypes),
);

ecourtsRouter.get(
  '/reference/acts/:stateCode/:distCode/:courtCode',
  validate({ params: CourtScopedParams, query: CourtQuery }),
  courtScopedList(ecourts.listActs),
);

ecourtsRouter.get(
  '/reference/police-stations/:stateCode/:distCode/:courtCode',
  validate({ params: CourtScopedParams, query: CourtQuery }),
  courtScopedList(ecourts.listPoliceStations),
);

// ---------------------------------------------------------------------------
// CNR lookup — single most-used endpoint. The CNR is the 16-char national
// case identifier: 4 letters (state + district) + 12 alphanumeric. The
// establishment code (chars 5-6) can include letters — e.g.
//   KLER010001682023  (Ernakulam JM-1)
//   TNCG0B0011172024  (Alandur JM, est `0B`)
// ---------------------------------------------------------------------------

const CnrParam = z.object({ cnr: z.string().regex(/^[A-Za-z]{4}[A-Za-z0-9]{12}$/, 'CNR must be 16 chars (4 letters + 12 alphanumeric)') });

ecourtsRouter.get(
  '/lookup/cnr/:cnr',
  validate({ params: CnrParam, query: CourtQuery }),
  async (req, res, next) => {
    try {
      const { cnr } = req.params as unknown as { cnr: string };
      const court = (req.query as { court?: 'DC' | 'HC' }).court ?? 'DC';
      await sendStoredCase(req, res, cnr, court);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * Full case by CNR from DifAI's case store (ecourts-case-store.service):
 * instant when stored, refreshed in the background when stale, and - when
 * eCourts is down and nothing is stored - queued with retries plus an in-app
 * notification, instead of a 15 s wait that ends in an error.
 *   200 { history, meta: { fetchedAt, stale, refreshing } }
 *   202 { queued: true, message }
 *   404 no such case
 */
async function sendStoredCase(req: Request, res: Response, cnr: string, court: 'DC' | 'HC'): Promise<void> {
  const { getCase } = await import('../services/ecourts-case-store.service');
  const userId = req.user?.id;
  const firmId = userId ? await firmIdForUser(userId).catch(() => null) : null;
  const r = await getCase('history', cnr, court, userId ? { queueFor: { userId, firmId } } : {});
  if (r.status === 'ok') {
    res.json({ history: r.data, meta: { fetchedAt: r.fetchedAt, stale: r.stale, refreshing: r.refreshing } });
  } else if (r.status === 'not_found') {
    res.status(404).json({ error: 'No case found for this CNR' });
  } else {
    res.status(202).json({ queued: true, message: r.message });
  }
}

// ---------------------------------------------------------------------------
// Search endpoints — the 6 ways the eCourts app lets you discover cases
// (case number / party / advocate / FIR / filing number / act).
// ---------------------------------------------------------------------------

const CommonSearchScope = {
  stateCode: z.number().int().positive(),
  distCode:  z.number().int().positive(),
  courtCode: z.number().int().nonnegative(),
  courtCodes: CourtCodesParam.optional(),
  // REQUIRED. An earlier version of this made it optional on the theory that
  // eCourts falls back to a whole-district search - that was wrong. Omitting
  // it makes the upstream `court_code_arr` empty, so eCourts searches ZERO
  // establishments and replies `{"no_of_establishments":0}` - which looks
  // exactly like a real "no matches" result but isn't one. Verified live: the
  // identical query with a real establishment code returns real case rows.
  estCode:   z.string().min(1).max(20),
};

const SearchByCaseNumberInput = z.object({
  ...CommonSearchScope,
  caseType: z.union([z.string(), z.number()]),
  regNo:    z.union([z.string(), z.number()]),
  year:     z.number().int().min(1900).max(2100),
  court:    CourtParam.optional(),
});

ecourtsRouter.post(
  '/search/case-number',
  validate({ body: SearchByCaseNumberInput }),
  async (req, res, next) => {
    try {
      const result = await ecourts.searchByCaseNumber(req.body);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

const SearchByPartyInput = z.object({
  ...CommonSearchScope,
  partyName: z.string().min(1).max(120),
  year:      z.number().int().min(1900).max(2100),
  stage:     z.enum(['P', 'D', 'B']).optional(),
  court:     CourtParam.optional(),
});

ecourtsRouter.post(
  '/search/party',
  validate({ body: SearchByPartyInput }),
  async (req, res, next) => {
    try {
      const result = await ecourts.searchByPartyName(req.body);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

const SearchByAdvocateInput = z.object({
  ...CommonSearchScope,
  advocateName: z.string().min(1).max(120),
  year:         z.number().int().min(1900).max(2100),
  stage:        z.enum(['P', 'D', 'B']).optional(),
  court:        CourtParam.optional(),
});

ecourtsRouter.post(
  '/search/advocate',
  validate({ body: SearchByAdvocateInput }),
  async (req, res, next) => {
    try {
      const result = await ecourts.searchByAdvocateName(req.body);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

const SearchByFirInput = z.object({
  ...CommonSearchScope,
  policeStCode: z.number().int().positive(),
  firNo:        z.string().min(1).max(50),
  firYear:      z.number().int().min(1900).max(2100),
  court:        CourtParam.optional(),
});

ecourtsRouter.post(
  '/search/fir',
  validate({ body: SearchByFirInput }),
  async (req, res, next) => {
    try {
      const result = await ecourts.searchByFirNumber(req.body);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

const SearchByFilingInput = z.object({
  ...CommonSearchScope,
  filingNo:   z.string().min(1).max(50),
  filingYear: z.number().int().min(1900).max(2100),
  court:      CourtParam.optional(),
});

ecourtsRouter.post(
  '/search/filing-number',
  validate({ body: SearchByFilingInput }),
  async (req, res, next) => {
    try {
      const result = await ecourts.searchByFilingNumber(req.body);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

const SearchByActInput = z.object({
  ...CommonSearchScope,
  actCode: z.union([z.string(), z.number()]),
  section: z.string().max(50).optional(),
  year:    z.number().int().min(1900).max(2100).optional(),
  court:   CourtParam.optional(),
});

ecourtsRouter.post(
  '/search/act',
  validate({ body: SearchByActInput }),
  async (req, res, next) => {
    try {
      const result = await ecourts.searchByAct(req.body);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Cause list — day's docket for an establishment / bench.
// ---------------------------------------------------------------------------

const CauseListInput = z.object({
  ...CommonSearchScope,
  // A cause list is inherently per-court - unlike the case searches, there's
  // no "whole district" cause list to fall back to - so re-require it here
  // even though CommonSearchScope made it optional for the search endpoints.
  estCode: z.string().min(1).max(20),
  date:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  court: CourtParam.optional(),
});

ecourtsRouter.post(
  '/cause-list',
  validate({ body: CauseListInput }),
  async (req, res, next) => {
    try {
      const items = await ecourts.fetchCauseList(req.body);
      res.json({ items });
    } catch (err) {
      next(err);
    }
  },
);

// The app's Cause List: one court (bench) on a date, Civil or Criminal.
ecourtsRouter.post(
  '/cause-list/court',
  validate({
    body: z.object({
      stateCode: z.number().int().positive(),
      distCode:  z.number().int().positive(),
      courtCode: z.number().int().positive(),
      courtNo:   z.string().regex(/^\d{1,6}$/),
      kind:      z.enum(['civil', 'criminal']),
      date:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
      court:     CourtParam.optional(),
    }),
  }),
  async (req, res, next) => {
    try {
      res.json(await ecourts.fetchCourtCauseList(req.body));
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Caveat search
// ---------------------------------------------------------------------------

const CaveatSearchInput = z.object({
  stateCode:    z.number().int().positive(),
  distCode:     z.number().int().positive(),
  // REQUIRED (added 2026-10, live-probed): `court_code_arr` turns out to be
  // the numeric `court_code`, not `estCode` - see searchCaveat's doc comment
  // in ecourts.service.ts. Every caller already sends this (the frontend's
  // shared `EcourtsCourtScope` includes it for every search tab, caveat
  // included) - this schema had simply never captured it.
  courtCode:    z.number().int().nonnegative(),
  courtCodes:   CourtCodesParam.optional(),
  // Still accepted/required for API-shape compatibility with the other
  // search endpoints, though it's no longer what scopes the court_code_arr
  // search - see CommonSearchScope's estCode comment for the original
  // (superseded) reasoning.
  estCode:      z.string().min(1).max(20),
  caveatorName: z.string().max(120).optional(),
  caveateeName: z.string().max(120).optional(),
  // Which name field eCourts should match against — the official app's own
  // default is 'Caveator'. Confirmed via decompile, see searchCaveat's doc
  // comment; this replaced a guessed `year`/`reg_year` field that the real
  // endpoint never accepted.
  searchBy:     z.enum(['Caveator', 'Caveatee']).optional(),
  court:        CourtParam.optional(),
}).refine(
  (v) => Boolean(v.caveatorName || v.caveateeName),
  { message: 'At least one of caveatorName / caveateeName is required' },
);

ecourtsRouter.post(
  '/caveat/search',
  validate({ body: CaveatSearchInput }),
  async (req, res, next) => {
    try {
      const result = await ecourts.searchCaveat(req.body);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Order / judgment PDF retrieval
// ---------------------------------------------------------------------------

// Coerced: interim and final order rows don't always carry the same types
// (numbers arrive as strings in some states), and a strict check turned a
// valid order into a bare "400" for the advocate.
const OrderPdfInput = z.object({
  cino:           z.string().regex(/^[A-Za-z]{4}[A-Za-z0-9]{12}$/),
  filename:       z.string().min(1, 'This order has no file on eCourts yet.').max(255),
  stateCd:        z.coerce.number().int().positive(),
  distCd:         z.coerce.number().int().positive(),
  courtCode:      z.coerce.number().int().nonnegative(),
  caseNo:         z.coerce.string().min(1),
  cCode:          z.coerce.number().int().nonnegative(),
  bilingualFlag:  z.coerce.string().optional(),
  court:          CourtParam.optional(),
});

ecourtsRouter.post(
  '/orders/pdf',
  validate({ body: OrderPdfInput }),
  async (req, res, next) => {
    try {
      const result = await ecourts.fetchOrderPdf(req.body);
      // Stream as a real PDF download. The browser-side `fetch()` reads the
      // body as a Blob and triggers a save dialog; using `inline` instead
      // would render in a viewer tab — we go with `attachment` because the
      // EcourtsView UI button is unambiguously "Download".
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${result.suggestedFilename.replace(/"/g, '')}"`,
      );
      res.setHeader('Content-Length', String(result.bytes.length));
      // Don't let intermediaries cache — the upstream token is one-shot, so
      // a cached copy keyed on the request URL would be meaningless.
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).end(result.bytes);
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Convenience: rich case detail by CNR via POST (when callers prefer body over
// path). Same behaviour as GET /lookup/cnr/:cnr.
// ---------------------------------------------------------------------------

const PostCnrInput = z.object({
  cnr:   z.string().regex(/^[A-Za-z]{4}[A-Za-z0-9]{12}$/, 'CNR must be 16 chars (4 letters + 12 alphanumeric)'),
  court: CourtParam.optional(),
});

ecourtsRouter.post(
  '/lookup/cnr',
  validate({ body: PostCnrInput }),
  async (req, res, next) => {
    try {
      const { cnr, court } = req.body as { cnr: string; court?: 'DC' | 'HC' };
      await sendStoredCase(req, res, cnr, court ?? 'DC');
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Richer filing-number case history, IA business, appellate info, judge/bench
// names, caveat reference data — 6 endpoints found by re-auditing the full
// decompiled APK (see ecourts.service.ts's doc comment for how each param
// shape was recovered). All GET/CNR-scoped like /lookup/cnr, except
// appellate-info and the caveat endpoints which need a fuller court scope.
// ---------------------------------------------------------------------------

ecourtsRouter.get(
  '/lookup/cnr/:cnr/filing-history',
  validate({ params: CnrParam, query: CourtQuery }),
  async (req, res, next) => {
    try {
      const { cnr } = req.params as unknown as { cnr: string };
      const court = (req.query as { court?: 'DC' | 'HC' }).court ?? 'DC';
      // Status shown on every search-result row: served from the case store
      // and fetched live only through the shared rate limiter, so a long
      // result list no longer fires a burst that eCourts blocks. Not queued:
      // the row just shows no badge if eCourts is unavailable.
      const { getCase } = await import('../services/ecourts-case-store.service');
      const r = await getCase('filing', cnr, court);
      if (r.status === 'ok') {
        res.json({ history: r.data, meta: { fetchedAt: r.fetchedAt, stale: r.stale } });
      } else if (r.status === 'not_found') {
        res.status(404).json({ error: 'No case found for this CNR' });
      } else {
        res.status(503).json({ error: r.message });
      }
    } catch (err) {
      next(err);
    }
  },
);

ecourtsRouter.get(
  '/lookup/cnr/:cnr/ia-business',
  validate({ params: CnrParam, query: CourtQuery }),
  async (req, res, next) => {
    try {
      const { cnr } = req.params as unknown as { cnr: string };
      const court = (req.query as { court?: 'DC' | 'HC' }).court ?? 'DC';
      const items = await ecourts.fetchIaBusiness(cnr, court);
      res.json({ items });
    } catch (err) {
      next(err);
    }
  },
);

const AppellateInfoInput = z.object({
  stateCode:   z.number().int().positive(),
  distCode:    z.number().int().positive(),
  courtCode:   z.number().int().nonnegative(),
  caseNumber1: z.string().min(1),
  appCsNo:     z.string().min(1),
  court:       CourtParam.optional(),
});

ecourtsRouter.post(
  '/appellate-info',
  validate({ body: AppellateInfoInput }),
  async (req, res, next) => {
    try {
      const writInfo = await ecourts.fetchAppellateInfo(req.body);
      res.json({ writInfo });
    } catch (err) {
      next(err);
    }
  },
);

// Judge/bench names within a specific court — a fourth cascade level below
// /reference/courts/:stateCode/:distCode/:complexCode. Unlike that route
// (our own DB cache), this is a LIVE eCourts call with no local cache table,
// so it's memoized in-process for 24h the same way states/districts are.
ecourtsRouter.get(
  '/reference/judge-benches/:stateCode/:distCode/:courtCode',
  validate({
    params: z.object({
      stateCode: z.coerce.number().int().positive(),
      distCode:  z.coerce.number().int().positive(),
      courtCode: z.string().regex(/^\d+(,\d+){0,99}$/).transform((v) => (v.includes(',') ? v : Number(v))),
    }),
    query: CourtQuery.extend({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
  }),
  async (req, res, next) => {
    try {
      const { stateCode, distCode, courtCode } = req.params as unknown as { stateCode: number; distCode: number; courtCode: number | string };
      const { court = 'DC', date } = req.query as { court?: 'DC' | 'HC'; date?: string };
      const items = await ecourts.listJudgeBenches(stateCode, distCode, courtCode, court, date);
      res.json({ items });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Caveat-family reference data — separate endpoints from the plain
// state/district lists (see ecourts.service.ts for why).
// ---------------------------------------------------------------------------

ecourtsRouter.get(
  '/reference/caveat/states/:stateCode/:distCode/:courtCode',
  validate({
    params: z.object({
      stateCode: z.coerce.number().int().positive(),
      distCode:  z.coerce.number().int().positive(),
      courtCode: z.string().regex(/^\d+(,\d+){0,99}$/).transform((v) => (v.includes(',') ? v : Number(v))),
    }),
    query: CourtQuery,
  }),
  async (req, res, next) => {
    try {
      const { stateCode, distCode, courtCode } = req.params as unknown as { stateCode: number; distCode: number; courtCode: number | string };
      const court = (req.query as { court?: 'DC' | 'HC' }).court ?? 'DC';
      const items = await ecourts.listCaveatStates({ stateCode, distCode, courtCode, court });
      res.json({ items });
    } catch (err) {
      next(err);
    }
  },
);

ecourtsRouter.get(
  '/reference/caveat/districts/:stateCode/:distCode/:courtCode',
  validate({
    params: z.object({
      stateCode: z.coerce.number().int().positive(),
      distCode:  z.coerce.number().int().positive(),
      courtCode: z.string().regex(/^\d+(,\d+){0,99}$/).transform((v) => (v.includes(',') ? v : Number(v))),
    }),
    query: CourtQuery,
  }),
  async (req, res, next) => {
    try {
      const { stateCode, distCode, courtCode } = req.params as unknown as { stateCode: number; distCode: number; courtCode: number | string };
      const court = (req.query as { court?: 'DC' | 'HC' }).court ?? 'DC';
      const items = await ecourts.listCaveatDistricts({ stateCode, distCode, courtCode, court });
      res.json({ items });
    } catch (err) {
      next(err);
    }
  },
);

ecourtsRouter.get(
  '/reference/caveat/lower-court/:stateCode/:distCode/:courtCode',
  validate({
    params: z.object({
      stateCode: z.coerce.number().int().positive(),
      distCode:  z.coerce.number().int().positive(),
      courtCode: z.string().regex(/^\d+(,\d+){0,99}$/).transform((v) => (v.includes(',') ? v : Number(v))),
    }),
    query: CourtQuery,
  }),
  async (req, res, next) => {
    try {
      const { stateCode, distCode, courtCode } = req.params as unknown as { stateCode: number; distCode: number; courtCode: number | string };
      const court = (req.query as { court?: 'DC' | 'HC' }).court ?? 'DC';
      const items = await ecourts.listLowerCourtCaveat({ stateCode, distCode, courtCode, court });
      res.json({ items });
    } catch (err) {
      next(err);
    }
  },
);

const CaveatHistoryInput = z.object({
  stateCode:    z.number().int().positive(),
  distCode:     z.number().int().positive(),
  courtCode:    z.number().int().nonnegative(),
  caveatNumber: z.string().min(1).max(40),
  court:        CourtParam.optional(),
});

// Detail for one specific caveat (parties, subject, filing date) - given its
// caveat_no (a field every caveat search result row carries). Distinct from
// /reference/caveat/lower-court above, which checks whether a DIFFERENT,
// lower court has a caveat for the same matter.
ecourtsRouter.post(
  '/caveat/history',
  validate({ body: CaveatHistoryInput }),
  async (req, res, next) => {
    try {
      const history = await ecourts.fetchCaveatHistory(req.body);
      res.json({ history });
    } catch (err) {
      next(err);
    }
  },
);

// Court-complex geolocation (lat/long + Bhuvan map link). A 4th reference
// endpoint alongside /reference/courts and /reference/judge-benches, scoped
// to one specific complex (not a court within it - a complex is one
// building, so one set of coordinates covers every court inside it).
ecourtsRouter.get(
  '/reference/location/:stateCode/:distCode/:complexCode',
  validate({
    params: z.object({
      stateCode:   z.coerce.number().int().positive(),
      distCode:    z.coerce.number().int().positive(),
      complexCode: z.string().min(1).max(20),
    }),
    query: CourtQuery,
  }),
  async (req, res, next) => {
    try {
      const { stateCode, distCode, complexCode } = req.params as unknown as { stateCode: number; distCode: number; complexCode: string };
      const court = (req.query as { court?: 'DC' | 'HC' }).court ?? 'DC';
      const location = await ecourts.fetchCourtLocation({ stateCode, distCode, complexCode, court });
      res.json({ location });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Business notes — manual fallback for the captcha-gated "Business" text
// (see ecourts.service.ts's doc comment). Firm-scoped via requireAuth's
// req.user, not a :firmId param - an advocate can only read/write their own
// firm's notes.
// ---------------------------------------------------------------------------

ecourtsRouter.get(
  '/business-notes/:cino',
  validate({ params: z.object({ cino: z.string().min(1).max(32) }) }),
  async (req, res, next) => {
    try {
      const { cino } = req.params as unknown as { cino: string };
      const firmId = await firmIdForUser(req.user?.id);
      if (!firmId) throw new UnauthorizedError('Not authenticated');
      const items = await ecourts.listBusinessNotes(firmId, cino.toUpperCase());
      res.json({ items });
    } catch (err) {
      next(err);
    }
  },
);

const SaveBusinessNoteInput = z.object({
  hearingDate:  z.string().min(1).max(40),
  businessText: z.string().min(1).max(10_000),
});

ecourtsRouter.put(
  '/business-notes/:cino',
  validate({ params: z.object({ cino: z.string().min(1).max(32) }), body: SaveBusinessNoteInput }),
  async (req, res, next) => {
    try {
      const { cino } = req.params as unknown as { cino: string };
      const { hearingDate, businessText } = req.body as { hearingDate: string; businessText: string };
      const firmId = await firmIdForUser(req.user?.id);
      if (!firmId) throw new UnauthorizedError('Not authenticated');
      const note = await ecourts.saveBusinessNote({
        firmId, cino: cino.toUpperCase(), hearingDate, businessText, userId: req.user?.id,
      });
      res.json({ note });
    } catch (err) {
      next(err);
    }
  },
);

logger.debug('eCourts routes mounted');
