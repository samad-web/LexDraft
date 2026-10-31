import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import * as efilingLive from '../services/efiling-live.service';
import { efileCaseOnPortal, fillNewCaseOnPortal, submitPleadingOnPortal, uploadPleadingOnPortal } from '../services/efiling-portal-filing.service';
import { BadRequestError, UnauthorizedError } from '../lib/errors';
import { ALL_STEP_KEYS, PARTICULARS_EXTRA_KEYS, EFILING_PORTAL_STATES, EFILING_PORTAL_STATE_CODES, PORTAL_STEPS_BY_KIND, type PortalStepKey } from '../lib/efiling/types';
import { requireFeature } from '../services/permissions.service';
import { firmIdForUser } from '../services/tenant';
import { efilingParticularsService } from '../services/efiling-particulars.service';
import { efilingFilingsService } from '../services/efiling-filings.service';
import { efilingBundleService } from '../services/efiling-bundle.service';
import { efilingProfileService } from '../services/efiling-profile.service';
import { jobs } from '../services/jobs.service';
import { db } from '../db/client';

// =============================================================================
// /api/efiling — browser-automation gateway into the National e-Filing
// portal (filing.ecourts.gov.in). See efiling-live.service.ts's file header
// for scope: login + CAPTCHA are real; the filing-form endpoints below
// return 501 until a real advocate login is used to capture their selectors.
//
// All endpoints sit behind `requireAuth + requireActivePlan` (applied at the
// mount site in routes/index.ts), same as /api/ecourts.
// =============================================================================

export const efilingRouter: Router = Router();

const SessionIdParam = z.object({ sessionId: z.string().uuid() });

efilingRouter.get('/portal/states', (_req, res) => {
  res.json({ items: EFILING_PORTAL_STATES });
});

const StartSessionBody = z.object({
  state: z
    .string()
    .regex(/^\d{1,3}$/)
    .refine((v) => EFILING_PORTAL_STATE_CODES.has(Number(v)), 'This state is not available on the eFiling portal.'),
  userType: z.enum(['advocate', 'litigant', 'pleader', 'clerk', 'gov_auth', 'insurance']),
});

efilingRouter.post(
  '/live/session',
  validate({ body: StartSessionBody }),
  async (req, res, next) => {
    try {
      if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
      const { state, userType } = req.body as { state: string; userType: 'advocate' | 'litigant' | 'pleader' | 'clerk' | 'gov_auth' | 'insurance' };
      const result = await efilingLive.startEfilingSession(req.user.id, state, userType);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

const LoginBody = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(200),
});

efilingRouter.post(
  '/live/session/:sessionId/login',
  validate({ params: SessionIdParam, body: LoginBody }),
  async (req, res, next) => {
    try {
      if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
      const { sessionId } = req.params as unknown as { sessionId: string };
      const { username, password } = req.body as { username: string; password: string };
      const result = await efilingLive.submitEfilingCredentials(sessionId, req.user.id, username, password);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

efilingRouter.post(
  '/live/session/:sessionId/login/captcha/refresh',
  validate({ params: SessionIdParam }),
  async (req, res, next) => {
    try {
      if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
      const { sessionId } = req.params as unknown as { sessionId: string };
      const result = await efilingLive.refreshEfilingCaptcha(sessionId, req.user.id);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

const LoginCaptchaBody = z.object({ captchaCode: z.string().min(1).max(20) });

efilingRouter.post(
  '/live/session/:sessionId/login/captcha',
  validate({ params: SessionIdParam, body: LoginCaptchaBody }),
  async (req, res, next) => {
    try {
      if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
      const { sessionId } = req.params as unknown as { sessionId: string };
      const result = await efilingLive.submitEfilingLoginCaptcha(sessionId, req.user.id, req.body.captchaCode);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

const DuplicateLoginBody = z.object({
  password: z.string().min(1).max(200),
  captchaCode: z.string().min(1).max(20),
});

// The advocate is already logged in elsewhere - eCourts enforces one active
// session per account. This confirms the logout-other-sessions prompt
// (#frm_duplicate_login on the portal) with the password re-entered (a
// separate form, separate field) plus a fresh captcha for THIS form.
efilingRouter.post(
  '/live/session/:sessionId/login/duplicate',
  validate({ params: SessionIdParam, body: DuplicateLoginBody }),
  async (req, res, next) => {
    try {
      if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
      const { sessionId } = req.params as unknown as { sessionId: string };
      const { password, captchaCode } = req.body as { password: string; captchaCode: string };
      const result = await efilingLive.confirmDuplicateEfilingLogin(sessionId, req.user.id, password, captchaCode);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// --- Filing-form endpoints: wired up, but the service layer throws a clear
// 501 EfilingNotCapturedError until real selectors are captured from a
// logged-in advocate session. Not stubbed out of the router entirely so the
// frontend/UI contract is already settled.

// The connected session: keep-alive/status, and reading the advocate's own
// portal pages (navigation only - nothing is saved or submitted there).
efilingRouter.get(
  '/live/session/:sessionId',
  validate({ params: SessionIdParam }),
  (req, res, next) => {
    try {
      if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
      const { sessionId } = req.params as unknown as { sessionId: string };
      res.json(efilingLive.efilingSessionStatus(sessionId, req.user.id));
    } catch (err) {
      next(err);
    }
  },
);

efilingRouter.get(
  '/live/session/:sessionId/read',
  validate({ params: SessionIdParam, query: z.object({ what: z.enum(['dashboard', 'new_case']).default('dashboard') }) }),
  async (req, res, next) => {
    try {
      if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
      const { sessionId } = req.params as unknown as { sessionId: string };
      const { what } = req.query as unknown as { what: 'dashboard' | 'new_case' };
      res.json(await efilingLive.readPortalPage(sessionId, req.user.id, what));
    } catch (err) {
      next(err);
    }
  },
);

// The portal dashboard's tile numbers (one quick read), then one list per
// tile on demand - each request stays inside the web server's time limit.
efilingRouter.get(
  '/live/session/:sessionId/counts',
  validate({ params: SessionIdParam }),
  async (req, res, next) => {
    try {
      if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
      const { sessionId } = req.params as unknown as { sessionId: string };
      res.json(await efilingLive.readPortalCounts(sessionId, req.user.id));
    } catch (err) {
      next(err);
    }
  },
);

const PORTAL_LIST_KEYS = ['draft_cases', 'filed_cases', 'draft_pleadings', 'completed_pleadings', 'draft_ias', 'completed_ias', 'objections', 'my_cases'] as const;
efilingRouter.get(
  '/live/session/:sessionId/lists/:key',
  validate({ params: z.object({ sessionId: z.string().uuid(), key: z.enum(PORTAL_LIST_KEYS) }) }),
  async (req, res, next) => {
    try {
      if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
      const { sessionId, key } = req.params as unknown as { sessionId: string; key: (typeof PORTAL_LIST_KEYS)[number] };
      res.json(await efilingLive.readPortalList(sessionId, req.user.id, key));
    } catch (err) {
      next(err);
    }
  },
);

// The advocate's own portal dashboard lists (read-only).
efilingRouter.get(
  '/live/session/:sessionId/lists',
  validate({ params: SessionIdParam }),
  async (req, res, next) => {
    try {
      if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
      const { sessionId } = req.params as unknown as { sessionId: string };
      res.json({ items: await efilingLive.readPortalLists(sessionId, req.user.id) });
    } catch (err) {
      next(err);
    }
  },
);

efilingRouter.post(
  '/live/session/:sessionId/file',
  validate({ params: SessionIdParam }),
  async (req, res, next) => {
    try {
      if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
      const { sessionId } = req.params as unknown as { sessionId: string };
      await efilingLive.openNewFiling(sessionId, req.user.id);
      res.json({ ok: true }); // unreachable until openNewFiling is implemented
    } catch (err) {
      next(err);
    }
  },
);

efilingRouter.post(
  '/live/session/:sessionId/upload',
  validate({ params: SessionIdParam }),
  async (req, res, next) => {
    try {
      if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
      const { sessionId } = req.params as unknown as { sessionId: string };
      await efilingLive.uploadFilingDocument(sessionId, req.user.id);
      res.json({ ok: true }); // unreachable until uploadFilingDocument is implemented
    } catch (err) {
      next(err);
    }
  },
);

efilingRouter.post(
  '/live/session/:sessionId/end',
  validate({ params: SessionIdParam }),
  async (req, res, next) => {
    try {
      if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
      const { sessionId } = req.params as unknown as { sessionId: string };
      await efilingLive.endEfilingSession(sessionId, req.user.id);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

// =============================================================================
// Filing preparation + tracking (no portal session needed). See
// efiling-filings.service.ts for the lifecycle and efiling-tracker.service.ts
// for how filings get connected to eCourts at 09:00 / 19:00 IST.
// =============================================================================

type Handler = (req: Request, ctx: { firmId: string; userId: string }) => Promise<unknown>;

/** Resolve firm + user, run, JSON the result. Keeps each route to one line of logic. */
function handle(fn: Handler) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
      const firmId = await firmIdForUser(req.user.id);
      if (!firmId) throw new BadRequestError('eFiling needs a firm workspace.');
      res.json(await fn(req, { firmId, userId: req.user.id }));
    } catch (err) {
      next(err);
    }
  };
}

const p = (req: Request, k: string): string => String(req.params[k] ?? '');

const uuid = z.string().uuid();
const CaseParam = z.object({ caseId: uuid });
const FilingParam = z.object({ id: uuid });
const nullableText = (max: number) => z.string().trim().max(max).nullable().optional();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

// Official portal steps, in order, for one kind of filing (default: new case).
efilingRouter.get('/portal/steps', (req, res) => {
  const kind = typeof req.query['kind'] === 'string' && req.query['kind'] in PORTAL_STEPS_BY_KIND
    ? (req.query['kind'] as keyof typeof PORTAL_STEPS_BY_KIND)
    : 'new_case';
  res.json({ items: PORTAL_STEPS_BY_KIND[kind] });
});

// ---- Particulars ---------------------------------------------------------------

const MactSchema = z.object({
  itemNo: nullableText(40),
  policeState: nullableText(100),
  policeDistrict: nullableText(100),
  policeTaluka: nullableText(100),
  otherPoliceStation: z.boolean().nullable().optional(),
  accidentDate: isoDate.nullable().optional(),
  accidentTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  accidentPlace: nullableText(300),
  injuryType: z.enum(['simple', 'serious', 'death', 'other']).nullable().optional(),
  injuredName: nullableText(200),
  policeStation: nullableText(200),
  firType: nullableText(50),
  firNo: nullableText(50),
  firYear: z.number().int().min(1950).max(2100).nullable().optional(),
  vehicleType: nullableText(100),
  vehicleRegNo: nullableText(30),
  drivingLicenceNo: nullableText(50),
  licenceIssuingAuthority: nullableText(200),
  insurer: nullableText(200),
  compensationClaimedInr: z.number().nonnegative().nullable().optional(),
}).strict();

const ParticularsPatch = z.object({
  courtTier: z.enum(['DC', 'HC']).nullable().optional(),
  stateCode: z.number().int().positive().nullable().optional(),
  districtCode: z.number().int().positive().nullable().optional(),
  courtCode: z.number().int().nonnegative().nullable().optional(),
  estCode: nullableText(20),
  courtComplexCode: nullableText(40),
  establishmentName: nullableText(300),
  caseTypeCode: nullableText(20),
  caseTypeName: nullableText(200),
  isUrgent: z.boolean().optional(),
  hcSide: z.enum(['civil', 'criminal']).nullable().optional(),
  hcMatterType: nullableText(200),
  hcBench: nullableText(200),
  causeOfAction: nullableText(10_000),
  causeOfActionDate: isoDate.nullable().optional(),
  disputePlace: nullableText(300),
  subject: nullableText(2_000),
  prayer: nullableText(20_000),
  reliefParticulars: nullableText(10_000),
  valuationInr: z.number().nonnegative().nullable().optional(),
  claimAmountInr: z.number().nonnegative().nullable().optional(),
  acts: z.array(z.object({ act: z.string().trim().min(1).max(300), section: z.string().trim().max(100) })).max(50).optional(),
  hideParty: z.boolean().optional(),
  hidePartyReason: nullableText(500),
  localLanguage: nullableText(40),
  plaintLocal: nullableText(50_000),
  mact: MactSchema.nullable().optional(),
  extra: z.record(z.enum(PARTICULARS_EXTRA_KEYS), z.string().max(20_000)).optional(),
}).strict();

const PartyBody = z.object({
  side: z.enum(['petitioner', 'respondent']),
  isClient: z.boolean().default(false),
  isOrganization: z.boolean().default(false),
  name: z.string().trim().min(1).max(300),
  relationType: z.enum(['S/o', 'D/o', 'W/o', 'C/o']).nullable().optional(),
  relationName: nullableText(300),
  gender: z.enum(['M', 'F', 'T']).nullable().optional(),
  age: z.number().int().min(0).max(150).nullable().optional(),
  dateOfBirth: isoDate.nullable().optional(),
  occupation: nullableText(200),
  address: nullableText(1_000),
  district: nullableText(100),
  state: nullableText(100),
  pinCode: z.string().regex(/^\d{6}$/, 'PIN code must be 6 digits').nullable().optional(),
  mobile: z.string().regex(/^(\+?91)?[6-9]\d{9}$/, 'Mobile must be a 10-digit Indian number').nullable().optional(),
  email: z.string().email().max(200).nullable().optional(),
  isMinor: z.boolean().default(false),
  guardianName: nullableText(300),
  orgRepresentative: nullableText(300),
  legalHeirOf: uuid.nullable().optional(),
  nameLocal: nullableText(300),
  addressLocal: nullableText(1_000),
  extra: z.record(z.string().max(60), z.string().max(300)).default({}),
}).strict();

const FactsBody = z.object({
  facts: z.array(z.object({
    factDate: isoDate.nullable().optional(),
    factTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
    description: z.string().trim().min(1).max(5_000),
  })).max(200),
});

efilingRouter.get('/cases/:caseId/particulars', requireFeature('matter.view'), validate({ params: CaseParam }),
  handle((req, c) => efilingParticularsService.get(p(req, 'caseId'), c.firmId)));

efilingRouter.post('/cases/:caseId/particulars/prefill', requireFeature('matter.create'), validate({ params: CaseParam }),
  handle((req, c) => efilingParticularsService.prefill(p(req, 'caseId'), c.firmId, c.userId)));

efilingRouter.patch('/cases/:caseId/particulars', requireFeature('matter.create'), validate({ params: CaseParam, body: ParticularsPatch }),
  handle((req, c) => efilingParticularsService.updateParticulars(p(req, 'caseId'), c.firmId, c.userId, req.body)));

efilingRouter.post('/cases/:caseId/parties', requireFeature('matter.create'), validate({ params: CaseParam, body: PartyBody }),
  handle((req, c) => efilingParticularsService.addParty(p(req, 'caseId'), c.firmId, req.body)));

efilingRouter.patch('/cases/:caseId/parties/:partyId', requireFeature('matter.create'),
  validate({ params: z.object({ caseId: uuid, partyId: uuid }), body: PartyBody.partial().extend({ position: z.number().int().min(0).optional() }) }),
  handle((req, c) => efilingParticularsService.updateParty(p(req, 'caseId'), c.firmId, p(req, 'partyId'), req.body)));

efilingRouter.delete('/cases/:caseId/parties/:partyId', requireFeature('matter.create'),
  validate({ params: z.object({ caseId: uuid, partyId: uuid }) }),
  handle(async (req, c) => {
    await efilingParticularsService.deleteParty(p(req, 'caseId'), c.firmId, p(req, 'partyId'));
    return { ok: true };
  }));

efilingRouter.put('/cases/:caseId/facts', requireFeature('matter.create'), validate({ params: CaseParam, body: FactsBody }),
  handle(async (req, c) => ({ items: await efilingParticularsService.replaceFacts(p(req, 'caseId'), c.firmId, req.body.facts) })));

// ---- Filings ---------------------------------------------------------------------

const FilingKindEnum = z.enum(['new_case', 'ia', 'caveat', 'misc_document', 'deficit_court_fee']);
const StepState = z.enum(['pending', 'done', 'not_applicable']);

efilingRouter.get('/filings', requireFeature('matter.view'),
  validate({ query: z.object({ caseId: uuid.optional(), open: z.enum(['true', 'false']).optional() }) }),
  handle(async (req, c) => ({
    items: await efilingFilingsService.list(c.firmId, {
      caseId: typeof req.query['caseId'] === 'string' ? req.query['caseId'] : undefined,
      open: req.query['open'] === 'true',
    }),
  })));

efilingRouter.post('/filings', requireFeature('matter.create'),
  validate({ body: z.object({ caseId: uuid, kind: FilingKindEnum, title: z.string().trim().max(300).optional() }) }),
  handle((req, c) => efilingFilingsService.create(c.firmId, c.userId, req.body)));

efilingRouter.get('/filings/:id', requireFeature('matter.view'), validate({ params: FilingParam }),
  handle((req, c) => efilingFilingsService.get(p(req, 'id'), c.firmId)));

efilingRouter.patch('/filings/:id', requireFeature('matter.create'),
  validate({
    params: FilingParam,
    body: z.object({
      title: z.string().trim().min(1).max(300).optional(),
      efilingNo: nullableText(40),
      courtFilingNo: nullableText(40),
      courtFilingYear: z.number().int().min(1950).max(2100).nullable().optional(),
      registrationNo: nullableText(60),
      objections: nullableText(10_000),
      // Which keys are valid depends on the filing's kind - checked in the service.
      steps: z.record(z.enum(ALL_STEP_KEYS as [PortalStepKey, ...PortalStepKey[]]), StepState).optional(),
    }).strict(),
  }),
  handle((req, c) => efilingFilingsService.update(p(req, 'id'), c.firmId, c.userId, req.body)));

efilingRouter.delete('/filings/:id', requireFeature('matter.create'), validate({ params: FilingParam }),
  handle(async (req, c) => {
    await efilingFilingsService.remove(p(req, 'id'), c.firmId);
    return { ok: true };
  }));

efilingRouter.get('/filings/:id/readiness', requireFeature('matter.view'), validate({ params: FilingParam }),
  handle((req, c) => efilingFilingsService.readiness(p(req, 'id'), c.firmId)));

efilingRouter.post('/filings/:id/transition', requireFeature('matter.create'),
  validate({
    params: FilingParam,
    body: z.object({
      to: z.enum(['draft', 'ready', 'efiled', 'submitted', 'objected', 'refiled', 'accepted', 'registered', 'rejected', 'withdrawn']),
      note: nullableText(2_000),
      efilingNo: nullableText(40),
      submittedAt: z.string().datetime().nullable().optional(),
      objections: nullableText(10_000),
      cnr: nullableText(16),
    }).strict(),
  }),
  handle((req, c) => efilingFilingsService.transition(p(req, 'id'), c.firmId, c.userId, req.body)));

efilingRouter.put('/filings/:id/documents', requireFeature('matter.create'),
  validate({
    params: FilingParam,
    body: z.object({
      documents: z.array(z.object({
        label: z.string().trim().min(1).max(200),
        sourceKind: z.enum(['draft_render', 'document']),
        sourceId: uuid,
      })).max(100),
    }),
  }),
  handle(async (req, c) => ({ items: await efilingFilingsService.setDocuments(p(req, 'id'), c.firmId, c.userId, req.body.documents) })));

efilingRouter.get('/filings/:id/available-documents', requireFeature('matter.view'), validate({ params: FilingParam }),
  handle(async (req, c) => ({ items: await efilingFilingsService.availableDocuments(p(req, 'id'), c.firmId) })));

efilingRouter.post('/filings/:id/bundle', requireFeature('matter.create'), validate({ params: FilingParam }),
  handle((req, c) => efilingBundleService.build(p(req, 'id'), c.firmId, c.userId)));

efilingRouter.get('/filings/:id/bundle', requireFeature('matter.view'), validate({ params: FilingParam }), async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    if (!firmId) throw new BadRequestError('eFiling needs a firm workspace.');
    const { body, filename } = await efilingBundleService.download(p(req, 'id'), firmId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(body);
  } catch (err) {
    next(err);
  }
});

efilingRouter.post('/filings/:id/payments', requireFeature('matter.create'),
  validate({
    params: FilingParam,
    body: z.object({
      purpose: z.enum(['court_fee', 'deficit_court_fee', 'process_fee', 'judicial_deposit', 'other']),
      amountInr: z.number().nonnegative().max(1e10),
      grn: nullableText(40),
      paidOn: isoDate.nullable().optional(),
      payerName: nullableText(200),
      mode: z.enum(['epay', 'wallet', 'challan']).nullable().optional(),
    }).strict(),
  }),
  handle(async (req, c) => ({ items: await efilingFilingsService.addPayment(p(req, 'id'), c.firmId, c.userId, req.body) })));

efilingRouter.delete('/filings/:id/payments/:paymentId', requireFeature('matter.create'),
  validate({ params: z.object({ id: uuid, paymentId: uuid }) }),
  handle(async (req, c) => {
    await efilingFilingsService.deletePayment(p(req, 'id'), c.firmId, p(req, 'paymentId'));
    return { ok: true };
  }));

efilingRouter.post('/filings/:id/choose-cnr', requireFeature('matter.create'),
  validate({ params: FilingParam, body: z.object({ cnr: z.string().trim().length(16) }) }),
  handle((req, c) => efilingFilingsService.chooseCandidate(p(req, 'id'), c.firmId, c.userId, req.body.cnr)));

// ---- Tracking ---------------------------------------------------------------------

efilingRouter.post('/tracking/run', requireFeature('matter.create'),
  handle(async () => {
    await jobs.enqueue('efiling.track.manual', {}, { singletonKey: 'efiling-track-manual', expireInSeconds: 4 * 3600 });
    return { queued: true };
  }));

efilingRouter.get('/tracking/runs', requireFeature('matter.view'),
  handle(async () => {
    const sql = db();
    if (!sql) return { items: [] };
    const rows = await sql`
      select slot, run_date::text as run_date, attempt, status, started_at, finished_at,
             scanned, matched, ambiguous, not_found, failed, deferred
      from efiling_tracking_runs order by started_at desc limit 10
    `;
    return { items: rows };
  }));

// ---- Advocate profile ---------------------------------------------------------------

efilingRouter.get('/profile', handle((_req, c) => efilingProfileService.get(c.userId)));

efilingRouter.put('/profile',
  validate({
    body: z.object({
      barEnrolmentNo: nullableText(40),
      barCouncilStateCode: z.number().int().positive().nullable().optional(),
      efilingUniqueCode: nullableText(40),
      practiceLocations: z.array(z.object({
        courtTier: z.enum(['DC', 'HC']),
        stateCode: z.number().int().positive(),
        districtCode: z.number().int().positive().nullable(),
        bench: z.string().trim().max(100).nullable(),
        label: z.string().trim().max(200).nullable(),
      })).max(50).optional(),
    }).strict(),
  }),
  handle((req, c) => efilingProfileService.update(c.userId, c.firmId, req.body)));

// ---- on the real portal: fill New Case Filing, then eFile it ---------------
// Both run over the advocate's own logged-in portal session. Filling saves
// the portal's tabs 1-6 (a draft there); "eFile Case" is the irreversible
// step and needs { confirmed: true } from the advocate.
const LiveFilingParam = z.object({ sessionId: uuid, id: uuid });

efilingRouter.post('/live/session/:sessionId/filings/:id/fill', requireFeature('matter.create'), validate({ params: LiveFilingParam }),
  handle((req, c) => fillNewCaseOnPortal(p(req, 'sessionId'), c.userId, c.firmId, p(req, 'id'))));

efilingRouter.post('/live/session/:sessionId/filings/:id/efile', requireFeature('matter.create'),
  validate({ params: LiveFilingParam, body: z.object({ confirmed: z.literal(true) }).strict() }),
  handle((req, c) => efileCaseOnPortal(p(req, 'sessionId'), c.userId, c.firmId, p(req, 'id'), req.body.confirmed === true)));

efilingRouter.post('/live/session/:sessionId/filings/:id/upload-pleading', requireFeature('matter.create'), validate({ params: LiveFilingParam }),
  handle((req, c) => uploadPleadingOnPortal(p(req, 'sessionId'), c.userId, c.firmId, p(req, 'id'))));

efilingRouter.post('/live/session/:sessionId/filings/:id/submit', requireFeature('matter.create'),
  validate({ params: LiveFilingParam, body: z.object({ confirmed: z.literal(true) }).strict() }),
  handle((req, c) => submitPleadingOnPortal(p(req, 'sessionId'), c.userId, c.firmId, p(req, 'id'), req.body.confirmed === true)));
