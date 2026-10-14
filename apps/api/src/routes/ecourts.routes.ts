import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import * as ecourts from '../services/ecourts.service';
import * as ecourtsLive from '../services/ecourts-live.service';
import { firmIdForUser } from '../services/tenant';
import { logger } from '../logger';
import { BadRequestError, UnauthorizedError } from '../lib/errors';

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

ecourtsRouter.get(
  '/reference/case-types/:stateCode/:distCode/:estCode',
  validate({
    params: z.object({
      stateCode: z.coerce.number().int().positive(),
      distCode:  z.coerce.number().int().positive(),
      estCode:   z.string().min(1).max(20),
    }),
    query: CourtQuery,
  }),
  async (req, res, next) => {
    try {
      const p = req.params as unknown as { stateCode: number; distCode: number; estCode: string };
      const court = (req.query as { court?: 'DC' | 'HC' }).court ?? 'DC';
      const items = await ecourts.listCaseTypes(p.stateCode, p.distCode, p.estCode, court);
      res.json({ items });
    } catch (err) {
      next(err);
    }
  },
);

ecourtsRouter.get(
  '/reference/acts/:stateCode',
  validate({
    params: z.object({ stateCode: z.coerce.number().int().positive() }),
    query: CourtQuery,
  }),
  async (req, res, next) => {
    try {
      const { stateCode } = req.params as unknown as { stateCode: number };
      const court = (req.query as { court?: 'DC' | 'HC' }).court ?? 'DC';
      const items = await ecourts.listActs(stateCode, court);
      res.json({ items });
    } catch (err) {
      next(err);
    }
  },
);

ecourtsRouter.get(
  '/reference/police-stations/:stateCode/:distCode',
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
      const items = await ecourts.listPoliceStations(stateCode, distCode, court);
      res.json({ items });
    } catch (err) {
      next(err);
    }
  },
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
      const history = await ecourts.lookupByCnr(cnr, court);
      if (!history) {
        res.status(404).json({ error: 'No case found for this CNR' });
        return;
      }
      res.json({ history });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Search endpoints — the 6 ways the eCourts app lets you discover cases
// (case number / party / advocate / FIR / filing number / act).
// ---------------------------------------------------------------------------

const CommonSearchScope = {
  stateCode: z.number().int().positive(),
  distCode:  z.number().int().positive(),
  courtCode: z.number().int().nonnegative(),
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

const OrderPdfInput = z.object({
  cino:           z.string().regex(/^[A-Za-z]{4}[A-Za-z0-9]{12}$/),
  filename:       z.string().min(1).max(255),
  stateCd:        z.number().int().positive(),
  distCd:         z.number().int().positive(),
  courtCode:      z.number().int().nonnegative(),
  caseNo:         z.string().min(1),
  cCode:          z.number().int().nonnegative(),
  bilingualFlag:  z.string().optional(),
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
      const history = await ecourts.lookupByCnr(cnr, court ?? 'DC');
      if (!history) throw new BadRequestError('No case found for this CNR');
      res.json({ history });
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
      const history = await ecourts.fetchFilingCaseHistory(cnr, court);
      if (!history) {
        res.status(404).json({ error: 'No case found for this CNR' });
        return;
      }
      res.json({ history });
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
      courtCode: z.coerce.number().int().nonnegative(),
    }),
    query: CourtQuery,
  }),
  async (req, res, next) => {
    try {
      const { stateCode, distCode, courtCode } = req.params as unknown as { stateCode: number; distCode: number; courtCode: number };
      const court = (req.query as { court?: 'DC' | 'HC' }).court ?? 'DC';
      const items = await ecourts.listJudgeBenches(stateCode, distCode, courtCode, court);
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
      courtCode: z.coerce.number().int().nonnegative(),
    }),
    query: CourtQuery,
  }),
  async (req, res, next) => {
    try {
      const { stateCode, distCode, courtCode } = req.params as unknown as { stateCode: number; distCode: number; courtCode: number };
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
      courtCode: z.coerce.number().int().nonnegative(),
    }),
    query: CourtQuery,
  }),
  async (req, res, next) => {
    try {
      const { stateCode, distCode, courtCode } = req.params as unknown as { stateCode: number; distCode: number; courtCode: number };
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
      courtCode: z.coerce.number().int().nonnegative(),
    }),
    query: CourtQuery,
  }),
  async (req, res, next) => {
    try {
      const { stateCode, distCode, courtCode } = req.params as unknown as { stateCode: number; distCode: number; courtCode: number };
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
