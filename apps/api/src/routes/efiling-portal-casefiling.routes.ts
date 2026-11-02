import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { UnauthorizedError } from '../lib/errors';
import { requireFeature } from '../services/permissions.service';
import {
  CASE_FILING_TABS, caseFilingListAction, caseFilingPartyAction, caseFilingPdf, efileCase, openCaseFilingWizard, pickCaseFilingSuggestion,
  pressCaseFilingButton, readCaseFilingList, saveCaseFilingTab, setCaseFilingFields, showCaseFilingTab, suggestCaseFiling,
  type CaseFilingTabKey, type CaseListKey, type PartyListKey,
} from '../services/efiling-portal-casefiling.service';

// =============================================================================
// /api/efiling/live/session/:sessionId/case-filing/... - the portal's Case
// Filing menu (New Case Filing with its Draft / eFiled Cases, and Manage
// Favourite Clients), live over the advocate's own portal session. See
// efiling-portal-casefiling.service.ts. `screen` picks the page:
// 'new_case' (default) or 'clients'. Portal problems answer 409 / 410 / 502
// (EcourtsHttpError), never 401 - a 401 signs the advocate out of DifAi.
// Deleting and "eFile Case" need { confirmed: true }.
// =============================================================================

export const efilingPortalCaseFilingRouter: Router = Router();

const BASE = '/live/session/:sessionId/case-filing';
const Params = z.object({ sessionId: z.string().uuid() });
const Tab = z.enum(CASE_FILING_TABS as [CaseFilingTabKey, ...CaseFilingTabKey[]]);
const Screen = z.enum(['new_case', 'clients']);
const PdeNo = z.string().trim().regex(/^[A-Za-z0-9]{4,40}$/, 'That is not a portal e-filing number.');
const Values = z.array(z.object({ key: z.string().min(1).max(160), value: z.union([z.string().max(10_000), z.boolean()]) })).max(400);
const Match = z.array(z.string().max(500)).min(1).max(3);
const Ref = { screen: Screen.optional(), pdeNo: PdeNo.nullable().optional() };
const Paging = { page: z.coerce.number().int().min(1).max(10_000).optional(), search: z.string().max(100).optional() };

type Handler = (req: Request, userId: string, sessionId: string) => Promise<unknown>;

const run = (fn: Handler) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
    const { sessionId } = req.params as unknown as { sessionId: string };
    res.json(await fn(req, req.user.id, sessionId));
  } catch (err) {
    next(err);
  }
};

// ---- the screens' tabs and forms ----------------------------------------------------

efilingPortalCaseFilingRouter.post(`${BASE}/wizard/open`,
  validate({ params: Params, body: z.object({ ...Ref, tab: Tab.optional(), fresh: z.boolean().optional() }).strict() }),
  run((req, userId, sessionId) => openCaseFilingWizard(sessionId, userId, req.body)));

efilingPortalCaseFilingRouter.post(`${BASE}/wizard/tab`,
  validate({ params: Params, body: z.object({ ...Ref, tab: Tab }).strict() }),
  run((req, userId, sessionId) => showCaseFilingTab(sessionId, userId, req.body)));

efilingPortalCaseFilingRouter.post(`${BASE}/wizard/fields`,
  validate({ params: Params, body: z.object({ ...Ref, tab: Tab, values: Values.min(1) }).strict() }),
  run((req, userId, sessionId) => setCaseFilingFields(sessionId, userId, req.body)));

efilingPortalCaseFilingRouter.post(`${BASE}/wizard/save`, requireFeature('matter.create'),
  validate({ params: Params, body: z.object({ ...Ref, tab: Tab, values: Values }).strict() }),
  run((req, userId, sessionId) => saveCaseFilingTab(sessionId, userId, req.body)));

efilingPortalCaseFilingRouter.post(`${BASE}/wizard/button`, requireFeature('matter.create'),
  validate({
    params: Params,
    body: z.object({ ...Ref, tab: Tab, key: z.string().min(1).max(160), text: z.string().max(80).optional(), values: Values.optional(), confirmed: z.boolean().optional() }).strict(),
  }),
  run((req, userId, sessionId) => pressCaseFilingButton(sessionId, userId, req.body)));

// New Case Filing only: party lists, act / section suggestions, eFile.
const CaseRef = { pdeNo: Ref.pdeNo };

efilingPortalCaseFilingRouter.post(`${BASE}/wizard/party`, requireFeature('matter.create'),
  validate({
    params: Params,
    body: z.object({ ...CaseRef, list: z.enum(['parties', 'prev_parties', 'lh_parties']), match: Match, action: z.string().min(1).max(60), confirmed: z.boolean().optional() }).strict(),
  }),
  run((req, userId, sessionId) => caseFilingPartyAction(sessionId, userId, req.body as { list: PartyListKey; match: string[]; action: string; confirmed?: boolean; pdeNo?: string | null })));

efilingPortalCaseFilingRouter.post(`${BASE}/wizard/suggest`,
  validate({ params: Params, body: z.object({ ...CaseRef, tab: Tab, key: z.string().min(1).max(160), term: z.string().max(120) }).strict() }),
  run((req, userId, sessionId) => suggestCaseFiling(sessionId, userId, req.body)));

efilingPortalCaseFilingRouter.post(`${BASE}/wizard/suggest/pick`,
  validate({ params: Params, body: z.object({ ...CaseRef, tab: Tab, key: z.string().min(1).max(160), term: z.string().min(1).max(120), index: z.number().int().min(0).max(100) }).strict() }),
  run((req, userId, sessionId) => pickCaseFilingSuggestion(sessionId, userId, req.body)));

// "eFile Case": irreversible on the portal.
efilingPortalCaseFilingRouter.post(`${BASE}/efile`, requireFeature('matter.create'),
  validate({ params: Params, body: z.object({ pdeNo: PdeNo, confirmed: z.literal(true) }).strict() }),
  run((req, userId, sessionId) => efileCase(sessionId, userId, { pdeNo: req.body.pdeNo, confirmed: req.body.confirmed === true })));

// ---- Draft Cases / eFiled Cases / favourite clients list ----------------------------

const ListParams = Params.extend({ list: z.enum(['draft', 'filed', 'clients']) });

efilingPortalCaseFilingRouter.get(`${BASE}/lists/:list`,
  validate({ params: ListParams, query: z.object(Paging) }),
  run((req, userId, sessionId) => readCaseFilingList(sessionId, userId, (req.params as unknown as { list: CaseListKey }).list, {
    page: req.query['page'] ? Number(req.query['page']) : undefined, search: typeof req.query['search'] === 'string' ? req.query['search'] : undefined,
  })));

efilingPortalCaseFilingRouter.post(`${BASE}/lists/:list/action`, requireFeature('matter.create'),
  validate({ params: ListParams, body: z.object({ match: Match, action: z.string().min(1).max(60), confirmed: z.boolean().optional(), ...Paging }).strict() }),
  run((req, userId, sessionId) => caseFilingListAction(sessionId, userId, { list: (req.params as unknown as { list: CaseListKey }).list, ...req.body })));

// The case's PDF as the portal makes it (binary).
efilingPortalCaseFilingRouter.post(`${BASE}/pdf`,
  validate({ params: Params, body: z.object({ pdeNo: PdeNo }).strict() }),
  async (req, res, next) => {
    try {
      if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
      const { sessionId } = req.params as unknown as { sessionId: string };
      const f = await caseFilingPdf(sessionId, req.user.id, (req.body as { pdeNo: string }).pdeNo);
      res.setHeader('Content-Type', f.contentType);
      res.setHeader('Content-Disposition', `inline; filename="${f.name.replace(/[^\w .()-]+/g, '_').slice(0, 120) || 'case.pdf'}"`);
      res.setHeader('Cache-Control', 'no-store');
      res.send(f.body);
    } catch (err) {
      next(err);
    }
  });
