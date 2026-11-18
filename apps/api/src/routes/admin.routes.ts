import crypto from 'node:crypto';
import { ADMIN_CREDIT_PRICE_INR } from '../lib/plans';
import { invoiceWhatsappService } from '../services/invoice-whatsapp.service';
import { landRecordsAdmin } from '../services/land-records-admin.service';
import { firm360Service } from '../services/firm360.service';
import { customPlanService } from '../services/custom-plan.service';
import { aiSpendService } from '../services/ai-spend.service';
import { Router } from 'express';
import { z } from 'zod';
import { strongPassword } from '../lib/password';
import { adminService } from '../services/admin.service';
import { billingService } from '../services/billing.service';
import { subscriptionInvoiceService } from '../services/subscription-invoice.service';
import { sendInvoicePdf } from './billing.routes';
import { storage } from '../services/storage.service';
import { db } from '../db/client';
import { aiUsageReportService } from '../services/ai-usage-report.service';
import { composeOutcomesService } from '../services/compose-outcomes.service';
import { templatesService } from '../services/templates.service';
import { impersonationService } from '../services/impersonation.service';
import { auditService } from '../services/audit.service';
import { creditService } from '../services/credit.service';
import { analyticsRefreshService } from '../services/analytics-refresh.service';

export const adminRouter: Router = Router();

// ---- helpers ---------------------------------------------------------------

function actor(req: import('express').Request): { id: string; email: string } {
  return { id: req.user!.id, email: req.user!.email };
}

const FirmPlanTier  = z.enum(['Solo', 'Practice', 'Firm']);
const BillingStatus = z.enum(['trial', 'active', 'past_due', 'cancelled']);
const FirmStatus    = z.enum(['active', 'suspended']);
const UserStatus    = z.enum(['active', 'suspended', 'deactivated']);
const FeatureModule = z.enum([
  'drafting', 'cases', 'contracts', 'billing', 'research',
  'limitation', 'ecourts', 'analytics', 'firm_dashboard',
]);
const TemplateScope = z.enum(['platform', 'firm']);

// ---- platform stats --------------------------------------------------------

adminRouter.get('/stats', async (_req, res, next) => {
  try { res.json(await adminService.platformStats()); } catch (err) { next(err); }
});

// ---- AI token usage --------------------------------------------------------

// Optional ?days=7|30|90 (default 30) controls the window. We accept a bounded
// day-count rather than free-form dates so the dashboard can't request an
// unboundedly expensive scan.
const AiUsageQuery = z.object({
  days: z.coerce.number().int().min(1).max(365).optional(),
});

adminRouter.get('/ai-usage', async (req, res, next) => {
  try {
    const { days } = AiUsageQuery.parse(req.query);
    const end = new Date();
    const start = new Date(end.getTime() - (days ?? 30) * 24 * 60 * 60 * 1000);
    res.json(await aiUsageReportService.report(start, end));
  } catch (err) {
    next(err);
  }
});

// Per-user AI use + monthly credit caps (admin-per-user-usage.md).
adminRouter.get('/ai-usage/users', async (req, res, next) => {
  try {
    const q = AiUsageQuery.extend({ firmId: z.string().uuid().optional() }).parse(req.query);
    const end = new Date();
    const start = new Date(end.getTime() - (q.days ?? 30) * 24 * 60 * 60 * 1000);
    res.json({ items: await aiUsageReportService.byUser(start, end, q.firmId) });
  } catch (err) { next(err); }
});

const CreditCap = z.object({
  cap: z.number().min(0).max(100_000).refine((n) => Number.isInteger(n * 2), 'in half credits').nullable(),
}).strict();
adminRouter.patch('/users/:id/credit-cap', async (req, res, next) => {
  try {
    const userId = z.string().uuid().parse(req.params.id);
    const { cap } = CreditCap.parse(req.body);
    if (!(await creditService.setUserCap(userId, cap, { id: req.user!.id, email: req.user!.email }))) {
      res.status(404).json({ error: 'User not found' }); return;
    }
    res.json({ userId, creditCapMonth: cap });
  } catch (err) { next(err); }
});

// Drafting quality: per doc type, how often the drafted body reached the
// advocate vs fell back to the plain skeleton, and why.
adminRouter.get('/compose-quality', async (req, res, next) => {
  try {
    const { days } = AiUsageQuery.parse(req.query);
    const end = new Date();
    const start = new Date(end.getTime() - (days ?? 30) * 24 * 60 * 60 * 1000);
    res.json(await composeOutcomesService.report(start, end));
  } catch (err) {
    next(err);
  }
});

// ---- AI spend guard (admin-ai-spend-guard.md) ------------------------------

adminRouter.get('/ai-spend', async (_req, res, next) => {
  try { res.json(await aiSpendService.spend()); } catch (err) { next(err); }
});

const AiSpendPatch = z.object({
  budgetUsd: z.number().positive().max(1_000_000).nullable().optional(),
  alertPcts: z.array(z.number().int().min(1).max(200)).min(1).max(5).optional(),
  autopause: z.boolean().optional(),
}).strict();
adminRouter.patch('/ai-spend', async (req, res, next) => {
  try {
    const body = AiSpendPatch.parse(req.body);
    res.json(await aiSpendService.updateSettings(body, { id: req.user!.id, email: req.user!.email }));
  } catch (err) { next(err); }
});

const AiPause = z.object({ paused: z.boolean(), reason: z.string().trim().min(3).max(300) }).strict();
adminRouter.post('/ai-spend/pause', async (req, res, next) => {
  try {
    const body = AiPause.parse(req.body);
    await aiSpendService.setPaused(body.paused, { id: req.user!.id, email: req.user!.email }, body.reason);
    res.json(await aiSpendService.spend());
  } catch (err) { next(err); }
});

adminRouter.patch('/firms/:id/ai-pause', async (req, res, next) => {
  try {
    const firmId = z.string().uuid().parse(req.params.id);
    const { paused } = z.object({ paused: z.boolean() }).strict().parse(req.body);
    const ok = await aiSpendService.setFirmPaused(firmId, paused, { id: req.user!.id, email: req.user!.email });
    if (!ok) { res.status(404).json({ error: 'Firm not found' }); return; }
    res.json({ firmId, aiPaused: paused });
  } catch (err) { next(err); }
});

// ---- business overview + Firm 360 (admin-firm-360.md) ----------------------

adminRouter.get('/business', async (_req, res, next) => {
  try { res.json(await firm360Service.overview()); } catch (err) { next(err); }
});

adminRouter.get('/firms/:id/payments', async (req, res, next) => {
  try { res.json(await firm360Service.payments(z.string().uuid().parse(req.params.id))); } catch (err) { next(err); }
});

adminRouter.get('/firms/:id/ledger', async (req, res, next) => {
  try {
    const firmId = z.string().uuid().parse(req.params.id);
    const { before } = z.object({ before: z.string().datetime().optional() }).parse(req.query);
    res.json(await firm360Service.ledger(firmId, before));
  } catch (err) { next(err); }
});

const ExtendPlan = z.object({ months: z.number().int().min(1).max(12), reason: z.string().trim().min(3).max(300) }).strict();
adminRouter.post('/firms/:id/extend', async (req, res, next) => {
  try {
    const firmId = z.string().uuid().parse(req.params.id);
    const body = ExtendPlan.parse(req.body);
    res.json(await firm360Service.extend(firmId, body.months, body.reason, { id: req.user!.id, email: req.user!.email }));
  } catch (err) { next(err); }
});

// ---- Land Records switch (land-records-tn-gate.md) -------------------------

adminRouter.get('/land-records', async (_req, res, next) => {
  try { res.json({ enabled: await landRecordsAdmin.enabled() }); } catch (err) { next(err); }
});

adminRouter.patch('/land-records', async (req, res, next) => {
  try {
    const { enabled } = z.object({ enabled: z.boolean() }).strict().parse(req.body);
    await landRecordsAdmin.setEnabled(enabled, { id: req.user!.id, email: req.user!.email });
    res.json({ enabled });
  } catch (err) { next(err); }
});

adminRouter.patch('/firms/:id/land-records', async (req, res, next) => {
  try {
    const firmId = z.string().uuid().parse(req.params.id);
    const { mode } = z.object({ mode: z.enum(['on', 'off']).nullable() }).strict().parse(req.body);
    if (!(await landRecordsAdmin.setFirm(firmId, mode, { id: req.user!.id, email: req.user!.email }))) {
      res.status(404).json({ error: 'Firm not found' }); return;
    }
    res.json({ firmId, landRecords: mode });
  } catch (err) { next(err); }
});

// ---- firms -----------------------------------------------------------------

adminRouter.get('/firms', async (_req, res, next) => {
  try { res.json({ items: await adminService.listFirms() }); } catch (err) { next(err); }
});

adminRouter.get('/firms/:id', async (req, res, next) => {
  try {
    const firm = await adminService.getFirm(req.params.id!);
    if (!firm) { res.status(404).json({ error: 'Firm not found' }); return; }
    res.json(firm);
  } catch (err) { next(err); }
});

const CreateFirm = z.object({
  name: z.string().min(1),
  seats: z.number().int().min(1).max(500),
  plan: FirmPlanTier,
  adminEmail: z.string().email(),
  adminName: z.string().min(1).optional(),
  adminPassword: strongPassword.optional(),
});
adminRouter.post('/firms', async (req, res, next) => {
  try {
    const body = CreateFirm.parse(req.body);
    res.status(201).json(await adminService.createFirm(body, actor(req)));
  } catch (err) { next(err); }
});

const UpdateFirm = z.object({
  name: z.string().min(1).optional(),
  seats: z.number().int().min(1).max(500).optional(),
  status: FirmStatus.optional(),
});
adminRouter.patch('/firms/:id', async (req, res, next) => {
  try {
    const body = UpdateFirm.parse(req.body);
    res.json(await adminService.updateFirm(req.params.id!, body, actor(req)));
  } catch (err) { next(err); }
});

adminRouter.delete('/firms/:id', async (req, res, next) => {
  try {
    await adminService.deleteFirm(req.params.id!, actor(req));
    res.status(204).end();
  } catch (err) { next(err); }
});

// ---- plan ------------------------------------------------------------------

const UpdatePlan = z.object({
  tier: FirmPlanTier.optional(),
  status: BillingStatus.optional(),
  mrrInr: z.number().int().min(0).optional(),
  renewsAt: z.string().nullable().optional(),
  freePlan: z.boolean().optional(),
  /** Enterprise quote: AI credits a month (null = the plan's own allowance). */
  creditAllowance: z.number().min(0).max(100_000).refine((n) => Number.isInteger(n * 2), 'in half credits').nullable().optional(),
});
adminRouter.patch('/firms/:id/plan', async (req, res, next) => {
  try {
    const body = UpdatePlan.parse(req.body);
    res.json(await adminService.updatePlan(req.params.id!, body, actor(req)));
  } catch (err) { next(err); }
});

// ---- AI credits: a firm's balance, and support / goodwill grants (audited) --

adminRouter.get('/firms/:id/credits', async (req, res, next) => {
  try {
    res.json({ ...(await creditService.balance(String(req.params.id))), pricePerCreditInr: ADMIN_CREDIT_PRICE_INR });
  } catch (err) { next(err); }
});

const ManualPaymentSchema = z.object({
  mode: z.enum(['upi', 'bank_transfer', 'cheque', 'cash']),
  reference: z.string().trim().min(1).max(100),
  receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).strict();

const GrantCredits = z.object({
  /** Form-generated key: a double submit grants once. Old clients omit it. */
  key: z.string().uuid().optional(),
  amount: z.number().min(0.5).max(100_000).refine((n) => Number.isInteger(n * 2), 'in half credits'),
  note: z.string().trim().min(3).max(300),
  days: z.number().int().min(1).max(730).default(30),
  /** Sold for an offline payment: whole rupees ex-GST; a GST invoice is issued. */
  paidInr: z.number().int().min(1).max(10_000_000).optional(),
  payment: ManualPaymentSchema.optional(),
}).strict();
adminRouter.post('/firms/:id/credits', async (req, res, next) => {
  try {
    const body = GrantCredits.parse(req.body);
    const firmId = z.string().uuid().parse(req.params.id);
    const r = await customPlanService.grantCredits(firmId, { ...body, key: body.key ?? crypto.randomUUID() }, { id: req.user!.id, email: req.user!.email });
    res.status(201).json({ ...(await creditService.balance(firmId)), invoiceId: r.invoiceId });
  } catch (err) { next(err); }
});

// ---- custom (Enterprise) plan with an offline payment (admin-custom-plan.md) --

const CustomPlan = z.object({
  key: z.string().uuid(),
  name: z.string().trim().min(2).max(80),
  seats: z.number().int().min(1).max(500),
  munshiSeats: z.number().int().min(0).max(100),
  creditsPerMonth: z.number().min(0).max(100_000).refine((n) => Number.isInteger(n * 2), 'in half credits'),
  priceInr: z.number().int().min(0).max(10_000_000),
  cycle: z.enum(['monthly', 'annual', 'custom']),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  payment: ManualPaymentSchema.nullable(),
}).strict();
adminRouter.post('/firms/:id/custom-plan', async (req, res, next) => {
  try {
    const body = CustomPlan.parse(req.body);
    const firmId = z.string().uuid().parse(req.params.id);
    res.status(201).json(await customPlanService.apply(firmId, body, { id: req.user!.id, email: req.user!.email }));
  } catch (err) { next(err); }
});

// ---- free launch plan switches ---------------------------------------------

// The ID document a user uploaded on /onboarding: a short-lived link.
adminRouter.get('/users/:id/id-document', async (req, res, next) => {
  try {
    const sql = db();
    const [row] = sql
      ? await sql<{ id_document_key: string | null }[]>`select id_document_key from users where id = ${req.params.id}::uuid`
      : [];
    if (!row?.id_document_key) {
      res.status(404).json({ error: 'No ID document uploaded' });
      return;
    }
    const link = await storage().presignDownload({ key: row.id_document_key, expiresInSec: 300 });
    res.json({ url: link.downloadUrl });
  } catch (err) {
    next(err);
  }
});

// Self-serve billing: who picked which plan, who stopped at checkout, who pays.
adminRouter.get('/billing', async (_req, res, next) => {
  try {
    const [summary, events] = await Promise.all([billingService.adminSummary(), billingService.adminEvents()]);
    res.json({ summary, events });
  } catch (err) {
    next(err);
  }
});

// GST invoices issued for subscriptions (all firms).
adminRouter.get('/billing/invoices', async (_req, res, next) => {
  try {
    res.json({ items: await subscriptionInvoiceService.listAll() });
  } catch (err) {
    next(err);
  }
});

// Resend one GST invoice on WhatsApp (invoice-whatsapp.md).
adminRouter.post('/billing/invoices/:id/whatsapp', async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    let result: string;
    try { result = await invoiceWhatsappService.send(id, true); } catch (e) {
      res.status(502).json({ error: `WhatsApp send failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300) }); return;
    }
    await auditService.write({ actorUserId: req.user!.id, actorEmail: req.user!.email, action: 'invoice.whatsapp.resend',
      targetType: 'platform', targetId: id, payload: { result } });
    if (result === 'missing') { res.status(404).json({ error: 'Invoice not found' }); return; }
    if (result === 'off') { res.status(409).json({ error: 'Invoice WhatsApp is off (template not set on the server yet).' }); return; }
    if (result === 'no_phone') { res.status(409).json({ error: 'The account owner has no verified WhatsApp number.' }); return; }
    res.json({ result });
  } catch (err) { next(err); }
});

adminRouter.get('/billing/invoices/:id/pdf', async (req, res, next) => {
  try {
    const inv = await subscriptionInvoiceService.find(String(req.params.id), null);
    if (!inv) { res.status(404).json({ error: 'Invoice not found' }); return; }
    sendInvoicePdf(res, inv.invoice_no, await subscriptionInvoiceService.pdf(inv));
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/free-plan/switches', async (_req, res, next) => {
  try {
    res.json({ items: await adminService.freePlanSwitches() });
  } catch (err) { next(err); }
});

const UpdateFreePlanSwitch = z.object({ enabled: z.boolean() });
adminRouter.patch('/free-plan/switches/:key', async (req, res, next) => {
  try {
    const key = z.enum(['team_chat', 'analytics', 'limitation', 'co_counsel']).parse(req.params.key);
    const body = UpdateFreePlanSwitch.parse(req.body);
    res.json({ items: await adminService.setFreePlanSwitch(key, body.enabled, actor(req)) });
  } catch (err) { next(err); }
});

// ---- flags -----------------------------------------------------------------

const UpdateFlags = z.object({
  flags: z.array(z.object({ module: FeatureModule, enabled: z.boolean() })).min(1),
});
adminRouter.patch('/firms/:id/flags', async (req, res, next) => {
  try {
    const body = UpdateFlags.parse(req.body);
    res.json({ items: await adminService.updateFlags(req.params.id!, body, actor(req)) });
  } catch (err) { next(err); }
});

// ---- branding --------------------------------------------------------------

const UpdateBranding = z.object({
  displayName: z.string().min(1).optional(),
  logoUrl: z.string().url().nullable().optional(),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
});
adminRouter.patch('/firms/:id/branding', async (req, res, next) => {
  try {
    const body = UpdateBranding.parse(req.body);
    res.json(await adminService.updateBranding(req.params.id!, body, actor(req)));
  } catch (err) { next(err); }
});

// ---- users -----------------------------------------------------------------

adminRouter.get('/users', async (req, res, next) => {
  try {
    const firmId = typeof req.query.firmId === 'string' ? req.query.firmId : undefined;
    const status = typeof req.query.status === 'string' ? (req.query.status as 'active' | 'suspended' | 'deactivated') : undefined;
    const q      = typeof req.query.q === 'string' ? req.query.q : undefined;
    res.json({ items: await adminService.listUsers({ firmId, status, q }) });
  } catch (err) { next(err); }
});

const UpdateUser = z.object({
  role: z.string().min(1).optional(),
  status: UserStatus.optional(),
  isSuperadmin: z.boolean().optional(),
  firmId: z.string().uuid().nullable().optional(),
});
adminRouter.patch('/users/:id', async (req, res, next) => {
  try {
    const body = UpdateUser.parse(req.body);
    res.json(await adminService.updateUser(req.params.id!, body, actor(req)));
  } catch (err) { next(err); }
});

adminRouter.delete('/users/:id', async (req, res, next) => {
  try {
    await adminService.deleteUser(req.params.id!, actor(req));
    res.status(204).end();
  } catch (err) { next(err); }
});

adminRouter.post('/users/:id/reset-password', async (req, res, next) => {
  try {
    res.json(await adminService.resetUserPassword(req.params.id!, actor(req)));
  } catch (err) { next(err); }
});

// ---- impersonation ---------------------------------------------------------

adminRouter.post('/impersonate/:userId', async (req, res, next) => {
  try {
    res.json(await impersonationService.start(req.params.userId!, actor(req)));
  } catch (err) { next(err); }
});

const EndImpersonation = z.object({ targetUserId: z.string().uuid().nullable().optional() });
adminRouter.post('/impersonate/end', async (req, res, next) => {
  try {
    const body = EndImpersonation.parse(req.body ?? {});
    await impersonationService.end(actor(req), body.targetUserId ?? null);
    res.status(204).end();
  } catch (err) { next(err); }
});

// ---- audit log -------------------------------------------------------------

adminRouter.get('/audit-log', async (req, res, next) => {
  try {
    const limit  = req.query.limit  ? Number(req.query.limit)  : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;
    const action = typeof req.query.action === 'string' ? (req.query.action as never) : undefined;
    const targetType = typeof req.query.targetType === 'string'
      ? (req.query.targetType as 'firm' | 'user' | 'template' | 'platform')
      : undefined;
    const targetId   = typeof req.query.targetId === 'string' ? req.query.targetId : undefined;
    const actorUserId = typeof req.query.actorUserId === 'string' ? req.query.actorUserId : undefined;
    res.json({ items: await auditService.list({ limit, offset, action, targetType, targetId, actorUserId }) });
  } catch (err) { next(err); }
});

// ---- templates -------------------------------------------------------------

adminRouter.get('/templates', async (req, res, next) => {
  try {
    const scope = typeof req.query.scope === 'string' ? (req.query.scope as 'platform' | 'firm') : undefined;
    const firmId = typeof req.query.firmId === 'string' ? req.query.firmId : undefined;
    res.json({ items: await templatesService.list(scope, firmId) });
  } catch (err) { next(err); }
});

adminRouter.get('/templates/:id', async (req, res, next) => {
  try {
    const t = await templatesService.get(req.params.id!);
    if (!t) { res.status(404).json({ error: 'Template not found' }); return; }
    res.json(t);
  } catch (err) { next(err); }
});

const CreateTemplate = z.object({
  name: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  scope: TemplateScope,
  firmId: z.string().uuid().nullable().optional(),
  body: z.string().min(1),
});
adminRouter.post('/templates', async (req, res, next) => {
  try {
    const body = CreateTemplate.parse(req.body);
    res.status(201).json(await templatesService.create(body, actor(req)));
  } catch (err) { next(err); }
});

const UpdateTemplate = z.object({
  name: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
});
adminRouter.patch('/templates/:id', async (req, res, next) => {
  try {
    const body = UpdateTemplate.parse(req.body);
    res.json(await templatesService.update(req.params.id!, body, actor(req)));
  } catch (err) { next(err); }
});

adminRouter.delete('/templates/:id', async (req, res, next) => {
  try {
    await templatesService.remove(req.params.id!, actor(req));
    res.status(204).end();
  } catch (err) { next(err); }
});

// ---- analytics MV refresh --------------------------------------------------
// Force an immediate refresh of the Firm-analytics materialized views.
// Daily auto-refresh is wired via the `analytics.refresh` pg-boss job;
// this endpoint exists for operators who want their dashboard to catch
// up without waiting for the next scheduled run (e.g. after bulk imports).
adminRouter.post('/analytics/refresh', async (_req, res, next) => {
  try {
    const results = await analyticsRefreshService.refreshAll();
    const ok = results.every((r) => r.ok);
    res.status(ok ? 200 : 207).json({ ok, results });
  } catch (err) { next(err); }
});
