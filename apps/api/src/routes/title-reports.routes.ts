/**
 * Title Reports routes.
 *
 * Mounted at /api/title-reports under requireAuth + requireActivePlan +
 * requireFeature('title_report.use'). Every handler resolves firm_id via
 * firmIdForUser and passes it explicitly to the service — the service does
 * not look it up.
 */

import { Router, type Response } from 'express';
import { z } from 'zod';
import {
  titleReportsService,
  TitleReportError,
  TitleReportNotFound,
  TitleReportForbidden,
  TitleReportTransitionError,
  TitleReportQuotaExceeded,
} from '../services/title-reports.service';
import { AiQuotaExceededError } from '../services/ai-quota.service';
import { titleReportsAiService } from '../services/title-reports.ai.service';
import { titleReportsExtractService } from '../services/title-reports.extract.service';
import { firmIdForUser } from '../services/tenant';
import { requireFeature } from '../services/permissions.service';
import { jobs } from '../services/jobs.service';
import { logger } from '../logger';

export const titleReportsRouter: Router = Router();

titleReportsRouter.use(requireFeature('title_report.use'));

// ---- Validators -----------------------------------------------------------

const Jurisdiction = z.enum([
  'TN', 'KA', 'MH', 'TG', 'AP', 'DL', 'UP', 'GJ', 'RJ', 'WB', 'KL',
  'PB', 'HR', 'MP', 'CG', 'OR', 'JH', 'BR', 'AS', 'OTHER',
]);

const Status = z.enum(['draft', 'in_review', 'finalised', 'issued', 'withdrawn']);

const CreateBody = z.object({
  jurisdictionState: Jurisdiction,
  applicantName: z.string().min(1),
  applicantType: z.enum(['buyer', 'owner', 'borrower']).optional(),
  bankName: z.string().optional(),
  bankBranch: z.string().optional(),
  loanReference: z.string().optional(),
  caseId: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
  assignedTo: z.string().uuid().optional(),
  searchPeriodFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  searchPeriodTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const UpdateBody = z.object({
  jurisdictionState: Jurisdiction.optional(),
  applicantName: z.string().min(1).optional(),
  applicantType: z.enum(['buyer', 'owner', 'borrower']).optional(),
  bankName: z.string().nullable().optional(),
  bankBranch: z.string().nullable().optional(),
  loanReference: z.string().nullable().optional(),
  caseId: z.string().uuid().nullable().optional(),
  clientId: z.string().uuid().nullable().optional(),
  assignedTo: z.string().uuid().nullable().optional(),
  searchPeriodFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  searchPeriodTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  opinionVerdict: z.enum(['pending', 'clear', 'clear_with_conditions', 'not_clear']).optional(),
  opinionSummary: z.string().nullable().optional(),
});

const PropertyBody = z.object({
  address: z.string().min(1),
  surveyNo: z.string().optional(),
  subDivision: z.string().optional(),
  extentValue: z.number().optional(),
  extentUnit: z.enum(['sqft', 'sqm', 'acres', 'cents', 'guntas', 'hectares']).optional(),
  boundaryNorth: z.string().optional(),
  boundarySouth: z.string().optional(),
  boundaryEast: z.string().optional(),
  boundaryWest: z.string().optional(),
  scheduleA: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  jurisdictionSpecific: z.record(z.string(), z.union([z.string(), z.number(), z.null()])).optional(),
});

const ChainLinkBody = z.object({
  sequenceNo: z.number().int().min(1),
  linkType: z.enum(['sale', 'gift', 'partition', 'settlement', 'will', 'inheritance', 'decree', 'lease', 'mortgage_release', 'other']),
  // Allow empty on insert — the UX is "create blank row, fill inline".
  // Wizard's autosave-on-edit will populate these once the user types.
  transferor: z.string(),
  transferee: z.string(),
  documentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  documentNo: z.string().optional(),
  sroOffice: z.string().optional(),
  bookNo: z.string().optional(),
  volumeNo: z.string().optional(),
  pages: z.string().optional(),
  stampDutyPaid: z.number().optional(),
  consideration: z.number().optional(),
  notes: z.string().optional(),
});

const DocumentBody = z.object({
  documentType: z.enum([
    'sale_deed', 'gift_deed', 'partition_deed', 'will',
    'patta', 'chitta', 'adangal', 'khata', 'rtc', 'seven_twelve',
    'ec', 'mutation', 'dc_conversion',
    'building_plan', 'oc', 'cc', 'noc', 'rera',
    'property_tax_receipt', 'death_certificate', 'legal_heir_certificate',
    'family_tree_affidavit', 'other',
  ]),
  documentLabel: z.string().min(1),
  parties: z.string().optional(),
  documentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  registrationNo: z.string().optional(),
  sroOffice: z.string().optional(),
  copyType: z.enum(['original', 'certified', 'photocopy', 'notarised_copy']).optional(),
  storageRef: z.string().optional(),
  fileName: z.string().optional(),
  fileMime: z.string().optional(),
  fileSize: z.number().int().optional(),
});

const DocumentPatchBody = DocumentBody.partial().extend({
  extractedPayload: z.record(z.string(), z.unknown()).optional(),
  extractionStatus: z.enum(['none', 'pending', 'done', 'failed']).optional(),
  extractionError: z.string().nullable().optional(),
});

const EncumbranceBody = z.object({
  ecPeriodFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  ecPeriodTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  ecOffice: z.string().optional(),
  ecForm: z.enum(['form_15', 'form_16']).optional(),
  transactionNo: z.string().optional(),
  transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  transactionType: z.string().optional(),
  parties: z.string().optional(),
  consideration: z.number().optional(),
  status: z.enum(['subsisting', 'discharged']).optional(),
  dischargeDocRef: z.string().optional(),
});

const SearchBody = z.object({
  searchType: z.enum([
    'sro', 'revenue', 'municipal',
    'litigation_hc', 'litigation_dc', 'litigation_drt', 'litigation_nclt',
    'gst', 'ibbi', 'mca', 'attachment', 'other',
  ]),
  searchOffice: z.string().optional(),
  searchQuery: z.string().optional(),
  searchDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  resultSummary: z.string().optional(),
  resultNegative: z.boolean().optional(),
  attachmentRef: z.string().optional(),
});

const LitigationBody = z.object({
  court: z.string().optional(),
  caseNumber: z.string().optional(),
  parties: z.string().optional(),
  causeOfAction: z.string().optional(),
  stage: z.string().optional(),
  relevance: z.enum(['direct', 'indirect', 'none']).optional(),
  nextDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().optional(),
});

const ApprovalBody = z.object({
  approvalType: z.enum([
    'rera', 'building_plan', 'layout', 'oc', 'cc',
    'fire_noc', 'pollution_noc', 'aai_noc', 'environment',
    'dc_conversion', 'khata_transfer', 'other',
  ]),
  authority: z.string().optional(),
  referenceNo: z.string().optional(),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  validity: z.string().optional(),
  status: z.enum(['valid', 'expired', 'not_obtained', 'not_applicable']).optional(),
});

const HeirBody = z.object({
  predecessorName: z.string().min(1),
  predecessorDod: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  personalLaw: z.enum(['hindu', 'muslim', 'christian', 'parsi', 'special_marriage', 'other']).optional(),
  heirName: z.string().min(1),
  relationship: z.string().optional(),
  share: z.string().optional(),
  consentStatus: z.enum(['obtained', 'pending', 'not_required']).optional(),
});

const DefectBody = z.object({
  category: z.enum([
    'chain_gap', 'unregistered_link', 'stamp_duty', 'extent_mismatch',
    'subsisting_encumbrance', 'pending_litigation', 'missing_noc',
    'approval_lapsed', 'inheritance_gap', 'other',
  ]),
  severity: z.enum(['info', 'warning', 'blocker']),
  description: z.string().min(1),
  recommendation: z.string().optional(),
  refs: z.array(z.object({
    kind: z.enum(['chain_link', 'document', 'encumbrance', 'litigation', 'approval', 'heir']),
    id: z.string().uuid(),
  })).optional(),
});

const DefectAckBody = z.object({
  action: z.enum(['ack', 'dismiss', 'edit']),
  reason: z.string().optional(),
  description: z.string().optional(),
  recommendation: z.string().nullable().optional(),
  severity: z.enum(['info', 'warning', 'blocker']).optional(),
});

const TransitionBody = z.object({
  to: Status,
  reason: z.string().optional(),
});

const ExportBody = z.object({
  format: z.enum(['pdf', 'docx']).optional(),
  letterheadId: z.string().uuid().optional(),
  storageRef: z.string().optional(),
  fileName: z.string().optional(),
  fileMime: z.string().optional(),
  fileSize: z.number().int().optional(),
});

const ListQuery = z.object({
  status: Status.optional(),
  jurisdictionState: Jurisdiction.optional(),
  assignedTo: z.string().uuid().optional(),
  bank: z.string().optional(),
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

// ---- Auth context helper --------------------------------------------------

interface Ctx { userId: string; email: string; firmId: string; roleName: string | null }

async function ctx(req: Parameters<Parameters<typeof titleReportsRouter['get']>[1]>[0]): Promise<Ctx | null> {
  const userId = req.user?.id;
  const email = req.user?.email ?? '';
  const roleName = (req.user as { role?: string } | undefined)?.role ?? null;
  if (!userId) return null;
  const firmId = await firmIdForUser(userId);
  if (!firmId) return null;
  return { userId, email, firmId, roleName };
}

function respondError(res: Response, err: unknown): void {
  // The shared AI cap (plan_ai_caps) gates title-report creation. Translate
  // the service-layer exception into the same 429 + ai_quota_exceeded
  // payload that drafting emits — the web's axios interceptor recognises
  // that code and surfaces the CapExceededModal.
  if (err instanceof AiQuotaExceededError) {
    const resetMs = Math.max(0, new Date(err.status.cycleEnd).getTime() - Date.now());
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil(resetMs / 1000))));
    res.status(429).json({
      error: 'AI generation quota exceeded',
      code: 'ai_quota_exceeded',
      cap: err.status.cap,
      used: err.status.used,
      remaining: 0,
      resetsAt: err.status.cycleEnd,
      planTier: err.status.planTier,
      upgrade: err.status.planTier !== 'Firm',
    });
    return;
  }
  // Legacy: the per-firm 2/cycle Solo cap (plan_title_report_caps) is no
  // longer used for create(), but the type still exists. If anything still
  // throws it, surface a clean 429 anyway.
  if (err instanceof TitleReportQuotaExceeded) {
    const resetMs = Math.max(0, new Date(err.status_.cycleEnd).getTime() - Date.now());
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil(resetMs / 1000))));
    res.status(429).json({
      error: 'Title report quota exceeded',
      code: 'ai_quota_exceeded',
      cap: err.status_.cap,
      used: err.status_.used,
      remaining: 0,
      resetsAt: err.status_.cycleEnd,
      planTier: err.status_.planTier,
      upgrade: err.status_.planTier !== 'Firm',
    });
    return;
  }
  if (err instanceof TitleReportTransitionError) {
    res.status(409).json({ error: err.message, code: err.code, details: err.details });
    return;
  }
  if (err instanceof TitleReportNotFound) {
    res.status(404).json({ error: err.message, code: err.code });
    return;
  }
  if (err instanceof TitleReportForbidden) {
    res.status(403).json({ error: err.message, code: err.code });
    return;
  }
  if (err instanceof TitleReportError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }
  logger.warn({ err }, 'title-reports route error');
  res.status(500).json({ error: 'Internal error' });
}

// ---- Header CRUD ----------------------------------------------------------

titleReportsRouter.get('/', async (req, res) => {
  try {
    const c = await ctx(req);
    if (!c) return res.status(401).json({ error: 'Unauthorized' });
    const q = ListQuery.parse(req.query);
    const out = await titleReportsService.listForFirm(c.firmId, q);
    res.json(out);
  } catch (err) { respondError(res, err); }
});

titleReportsRouter.get('/quota', async (req, res) => {
  try {
    const c = await ctx(req);
    if (!c) return res.status(401).json({ error: 'Unauthorized' });
    const status = await titleReportsService.quotaStatus(c.firmId);
    res.json(status);
  } catch (err) { respondError(res, err); }
});

titleReportsRouter.post('/', async (req, res) => {
  try {
    const c = await ctx(req);
    if (!c) return res.status(401).json({ error: 'Unauthorized' });
    const body = CreateBody.parse(req.body);
    const created = await titleReportsService.create(c.firmId, c.userId, c.email, c.roleName, body);
    res.status(201).json(created);
  } catch (err) { respondError(res, err); }
});

titleReportsRouter.get('/:id', async (req, res) => {
  try {
    const c = await ctx(req);
    if (!c) return res.status(401).json({ error: 'Unauthorized' });
    const full = await titleReportsService.getFull(c.firmId, req.params.id);
    res.json(full);
  } catch (err) { respondError(res, err); }
});

titleReportsRouter.patch('/:id', async (req, res) => {
  try {
    const c = await ctx(req);
    if (!c) return res.status(401).json({ error: 'Unauthorized' });
    const body = UpdateBody.parse(req.body);
    const updated = await titleReportsService.update(c.firmId, req.params.id, c.userId, c.email, c.roleName, body);
    res.json(updated);
  } catch (err) { respondError(res, err); }
});

titleReportsRouter.delete('/:id', async (req, res) => {
  try {
    const c = await ctx(req);
    if (!c) return res.status(401).json({ error: 'Unauthorized' });
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
    const withdrawn = await titleReportsService.softDelete(c.firmId, req.params.id, c.userId, c.email, c.roleName, reason);
    res.json(withdrawn);
  } catch (err) { respondError(res, err); }
});

// ---- Property -------------------------------------------------------------

titleReportsRouter.post('/:id/property', async (req, res) => {
  try {
    const c = await ctx(req);
    if (!c) return res.status(401).json({ error: 'Unauthorized' });
    const body = PropertyBody.parse(req.body);
    const out = await titleReportsService.upsertProperty(c.firmId, req.params.id, c.userId, c.email, c.roleName, body);
    res.json(out);
  } catch (err) { respondError(res, err); }
});

// ---- Chain links ----------------------------------------------------------

titleReportsRouter.post('/:id/chain-links', async (req, res) => {
  try {
    const c = await ctx(req);
    if (!c) return res.status(401).json({ error: 'Unauthorized' });
    const body = ChainLinkBody.parse(req.body);
    const out = await titleReportsService.addChainLink(c.firmId, req.params.id, c.userId, c.email, c.roleName, body);
    res.status(201).json(out);
  } catch (err) { respondError(res, err); }
});

titleReportsRouter.patch('/:id/chain-links/:linkId', async (req, res) => {
  try {
    const c = await ctx(req);
    if (!c) return res.status(401).json({ error: 'Unauthorized' });
    const body = ChainLinkBody.partial().parse(req.body);
    const out = await titleReportsService.updateChainLink(
      c.firmId, req.params.id, req.params.linkId, c.userId, c.email, c.roleName, body,
    );
    res.json(out);
  } catch (err) { respondError(res, err); }
});

titleReportsRouter.delete('/:id/chain-links/:linkId', async (req, res) => {
  try {
    const c = await ctx(req);
    if (!c) return res.status(401).json({ error: 'Unauthorized' });
    await titleReportsService.deleteChainLink(c.firmId, req.params.id, req.params.linkId, c.userId, c.email, c.roleName);
    res.status(204).end();
  } catch (err) { respondError(res, err); }
});

// ---- Documents (the client uploads to storage first, then POSTs metadata) -

titleReportsRouter.post('/:id/documents', async (req, res) => {
  try {
    const c = await ctx(req);
    if (!c) return res.status(401).json({ error: 'Unauthorized' });
    const body = DocumentBody.parse(req.body);
    const out = await titleReportsService.addDocument(c.firmId, req.params.id, c.userId, c.email, c.roleName, body);
    // Kick off extraction asynchronously if a blob was attached.
    if (out.storageRef) {
      void jobs.enqueue('title-report.extract', {
        firmId: c.firmId, titleReportId: req.params.id, documentId: out.id,
      }).catch((err) => logger.warn({ err }, 'failed to enqueue extract job'));
    }
    res.status(201).json(out);
  } catch (err) { respondError(res, err); }
});

titleReportsRouter.post('/:id/documents/:docId/extract', async (req, res) => {
  try {
    const c = await ctx(req);
    if (!c) return res.status(401).json({ error: 'Unauthorized' });
    const run = await titleReportsExtractService.extractDocument({
      firmId: c.firmId, titleReportId: req.params.id, documentId: req.params.docId,
      userId: c.userId, email: c.email,
    });
    res.json(run);
  } catch (err) { respondError(res, err); }
});

titleReportsRouter.patch('/:id/documents/:docId', async (req, res) => {
  try {
    const c = await ctx(req);
    if (!c) return res.status(401).json({ error: 'Unauthorized' });
    const body = DocumentPatchBody.parse(req.body);
    const out = await titleReportsService.patchDocument(
      c.firmId, req.params.id, req.params.docId, c.userId, c.email, c.roleName, body,
    );
    res.json(out);
  } catch (err) { respondError(res, err); }
});

titleReportsRouter.post('/:id/documents/:docId/apply', async (req, res) => {
  try {
    const c = await ctx(req);
    if (!c) return res.status(401).json({ error: 'Unauthorized' });
    const out = await titleReportsService.applyDocumentExtraction(
      c.firmId, req.params.id, req.params.docId, c.userId, c.email, c.roleName,
    );
    res.json(out);
  } catch (err) { respondError(res, err); }
});

// ---- Encumbrances ---------------------------------------------------------

titleReportsRouter.post('/:id/encumbrances', async (req, res) => {
  try {
    const c = await ctx(req);
    if (!c) return res.status(401).json({ error: 'Unauthorized' });
    const body = EncumbranceBody.parse(req.body);
    const out = await titleReportsService.addEncumbrance(c.firmId, req.params.id, c.userId, c.email, c.roleName, body);
    res.status(201).json(out);
  } catch (err) { respondError(res, err); }
});

titleReportsRouter.patch('/:id/encumbrances/:encId', async (req, res) => {
  try {
    const c = await ctx(req);
    if (!c) return res.status(401).json({ error: 'Unauthorized' });
    const body = EncumbranceBody.partial().parse(req.body);
    const out = await titleReportsService.patchEncumbrance(
      c.firmId, req.params.id, req.params.encId, c.userId, c.email, c.roleName, body,
    );
    res.json(out);
  } catch (err) { respondError(res, err); }
});

titleReportsRouter.delete('/:id/encumbrances/:encId', async (req, res) => {
  try {
    const c = await ctx(req);
    if (!c) return res.status(401).json({ error: 'Unauthorized' });
    await titleReportsService.deleteEncumbrance(
      c.firmId, req.params.id, req.params.encId, c.userId, c.email, c.roleName,
    );
    res.status(204).end();
  } catch (err) { respondError(res, err); }
});

// ---- Searches / Litigation / Approvals / Heirs ----------------------------

titleReportsRouter.post('/:id/searches', async (req, res) => {
  try {
    const c = await ctx(req);
    if (!c) return res.status(401).json({ error: 'Unauthorized' });
    const body = SearchBody.parse(req.body);
    const out = await titleReportsService.addSearch(c.firmId, req.params.id, c.userId, c.email, c.roleName, body);
    res.status(201).json(out);
  } catch (err) { respondError(res, err); }
});

titleReportsRouter.post('/:id/litigation', async (req, res) => {
  try {
    const c = await ctx(req);
    if (!c) return res.status(401).json({ error: 'Unauthorized' });
    const body = LitigationBody.parse(req.body);
    const out = await titleReportsService.addLitigation(c.firmId, req.params.id, c.userId, c.email, c.roleName, body);
    res.status(201).json(out);
  } catch (err) { respondError(res, err); }
});

titleReportsRouter.delete('/:id/litigation/:litId', async (req, res) => {
  try {
    const c = await ctx(req);
    if (!c) return res.status(401).json({ error: 'Unauthorized' });
    await titleReportsService.deleteLitigation(
      c.firmId, req.params.id, req.params.litId, c.userId, c.email, c.roleName,
    );
    res.status(204).end();
  } catch (err) { respondError(res, err); }
});

titleReportsRouter.post('/:id/approvals', async (req, res) => {
  try {
    const c = await ctx(req);
    if (!c) return res.status(401).json({ error: 'Unauthorized' });
    const body = ApprovalBody.parse(req.body);
    const out = await titleReportsService.addApproval(c.firmId, req.params.id, c.userId, c.email, c.roleName, body);
    res.status(201).json(out);
  } catch (err) { respondError(res, err); }
});

titleReportsRouter.delete('/:id/approvals/:apId', async (req, res) => {
  try {
    const c = await ctx(req);
    if (!c) return res.status(401).json({ error: 'Unauthorized' });
    await titleReportsService.deleteApproval(
      c.firmId, req.params.id, req.params.apId, c.userId, c.email, c.roleName,
    );
    res.status(204).end();
  } catch (err) { respondError(res, err); }
});

titleReportsRouter.post('/:id/heirs', async (req, res) => {
  try {
    const c = await ctx(req);
    if (!c) return res.status(401).json({ error: 'Unauthorized' });
    const body = HeirBody.parse(req.body);
    const out = await titleReportsService.addHeir(c.firmId, req.params.id, c.userId, c.email, c.roleName, body);
    res.status(201).json(out);
  } catch (err) { respondError(res, err); }
});

// ---- Defects --------------------------------------------------------------

titleReportsRouter.post('/:id/defects', async (req, res) => {
  try {
    const c = await ctx(req);
    if (!c) return res.status(401).json({ error: 'Unauthorized' });
    const body = DefectBody.parse(req.body);
    const out = await titleReportsService.addManualDefect(
      c.firmId, req.params.id, c.userId, c.email, c.roleName, body,
    );
    res.status(201).json(out);
  } catch (err) { respondError(res, err); }
});

titleReportsRouter.patch('/:id/defects/:defectId', async (req, res) => {
  try {
    const c = await ctx(req);
    if (!c) return res.status(401).json({ error: 'Unauthorized' });
    const body = DefectAckBody.parse(req.body);
    const out = await titleReportsService.applyDefectAck(
      c.firmId, req.params.id, req.params.defectId, c.userId, c.email, c.roleName, body,
    );
    res.json(out);
  } catch (err) { respondError(res, err); }
});

// ---- AI -------------------------------------------------------------------

titleReportsRouter.post('/:id/ai/analyse', async (req, res) => {
  try {
    const c = await ctx(req);
    if (!c) return res.status(401).json({ error: 'Unauthorized' });
    const runId = await titleReportsAiService.enqueueDefectsAnalysis({
      firmId: c.firmId, titleReportId: req.params.id, userId: c.userId, email: c.email, roleName: c.roleName,
    });
    res.status(202).json({ runId, status: 'pending' });
  } catch (err) { respondError(res, err); }
});

titleReportsRouter.get('/:id/ai/runs/:runId', async (req, res) => {
  try {
    const c = await ctx(req);
    if (!c) return res.status(401).json({ error: 'Unauthorized' });
    const run = await titleReportsService.getAiRun(c.firmId, req.params.runId);
    if (!run) return res.status(404).json({ error: 'AI run not found' });
    res.json(run);
  } catch (err) { respondError(res, err); }
});

titleReportsRouter.post('/:id/ai/opinion', async (req, res) => {
  try {
    const c = await ctx(req);
    if (!c) return res.status(401).json({ error: 'Unauthorized' });
    const out = await titleReportsAiService.synthesiseOpinion({
      firmId: c.firmId, titleReportId: req.params.id, userId: c.userId, email: c.email, roleName: c.roleName,
    });
    res.json(out);
  } catch (err) { respondError(res, err); }
});

// ---- Transition + export --------------------------------------------------

titleReportsRouter.post('/:id/transition', async (req, res) => {
  try {
    const c = await ctx(req);
    if (!c) return res.status(401).json({ error: 'Unauthorized' });
    const body = TransitionBody.parse(req.body);
    const out = await titleReportsService.transition(
      c.firmId, req.params.id, c.userId, c.email, c.roleName, body.to, body.reason,
    );
    res.json(out);
  } catch (err) { respondError(res, err); }
});

titleReportsRouter.post('/:id/export', async (req, res) => {
  try {
    const c = await ctx(req);
    if (!c) return res.status(401).json({ error: 'Unauthorized' });
    const body = ExportBody.parse(req.body);
    const out = await titleReportsService.recordExport(c.firmId, req.params.id, c.userId, c.email, {
      format: body.format ?? 'pdf',
      letterheadId: body.letterheadId ?? null,
      storageRef: body.storageRef ?? null,
      fileName: body.fileName ?? null,
      fileMime: body.fileMime ?? null,
      fileSize: body.fileSize ?? null,
    });
    res.status(201).json(out);
  } catch (err) { respondError(res, err); }
});
