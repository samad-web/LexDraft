import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import * as ecourts from '../services/ecourts.service';
import { logger } from '../logger';
import { BadRequestError } from '../lib/errors';

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
  estCode:      z.string().min(1).max(20),
  caveatorName: z.string().max(120).optional(),
  caveateeName: z.string().max(120).optional(),
  year:         z.number().int().min(1900).max(2100).optional(),
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
  cino:      z.string().regex(/^[A-Za-z]{4}[A-Za-z0-9]{12}$/),
  filename:  z.string().min(1).max(255),
  stateCd:   z.number().int().positive(),
  distCd:    z.number().int().positive(),
  courtCode: z.number().int().nonnegative(),
  court:     CourtParam.optional(),
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

logger.debug('eCourts routes mounted');
