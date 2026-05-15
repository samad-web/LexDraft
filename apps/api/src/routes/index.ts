import { Router } from 'express';
import { db } from '../db/client';
import { authRouter } from './auth.routes';
import { casesRouter } from './cases.routes';
import { hearingsRouter } from './hearings.routes';
import { tasksRouter } from './tasks.routes';
import { documentsRouter } from './documents.routes';
import { draftingRouter } from './drafting.routes';
import { draftsRouter } from './drafts.routes';
import { reviewRouter } from './review.routes';
import { letterheadsRouter } from './letterheads.routes';
import { researchRouter } from './research.routes';
import { dashboardRouter } from './dashboard.routes';
import { firmRouter } from './firm.routes';
import { invitationsRouter } from './invitations.routes';
import { webhooksRouter } from './webhooks.routes';
import { adminRouter } from './admin.routes';
import { clausesRouter } from './clauses.routes';
import { clientsRouter } from './clients.routes';
import { leadsRouter } from './leads.routes';
import { invoicesRouter } from './invoices.routes';
import { expensesRouter } from './expenses.routes';
import { limitationsRouter } from './limitations.routes';
import { diaryRouter } from './diary.routes';
import { archiveRouter } from './archive.routes';
import { physicalDocumentsRouter } from './physical-documents.routes';
import { analyticsRouter } from './analytics.routes';
import { meRouter } from './me.routes';
import { meMfaRouter } from './me-mfa.routes';
import { meDpdpRouter } from './me-dpdp.routes';
import { sanhitaRouter } from './sanhita.routes';
import { calculatorsRouter } from './calculators.routes';
import { conflictsRouter } from './conflicts.routes';
import { coverageRouter } from './coverage.routes';
import { practiceAnalyticsRouter } from './practice-analytics.routes';
import { engagementRouter } from './engagement.routes';
import { caseloadHealthRouter } from './caseload-health.routes';
import { exportsRouter } from './exports.routes';
import { adminErrorsRouter } from './admin-errors.routes';
import { portalRouter } from './portal.routes';
import { portalAdminRouter } from './portal-admin.routes';
import { surveyRouter } from './survey.routes';
import { surveyDraftRouter } from './survey-draft.routes';
import { signUpLimiter, surveyDraftLimiter } from '../middleware/rateLimit';
import { requireAuth, requireSuperadmin, optionalAuth } from '../middleware/auth';
import { requireActivePlan } from '../middleware/requireActivePlan';

export const apiRouter: Router = Router();

// Liveness - process is up. Cheap, no DB.
apiRouter.get('/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// Readiness - process is up AND can talk to its dependencies. Used by the
// orchestrator's readinessProbe so a pod with a broken DB connection is
// pulled out of the load balancer instead of serving 500s.
apiRouter.get('/ready', async (_req, res) => {
  const checks: Record<string, { ok: boolean; ms?: number; error?: string }> = {};
  const sql = db();
  if (!sql) {
    checks.db = { ok: false, error: 'DATABASE_URL not configured' };
  } else {
    const t0 = Date.now();
    try {
      await sql`select 1 as ok`;
      checks.db = { ok: true, ms: Date.now() - t0 };
    } catch (err) {
      checks.db = { ok: false, ms: Date.now() - t0, error: err instanceof Error ? err.message : String(err) };
    }
  }
  const ok = Object.values(checks).every((c) => c.ok);
  res.status(ok ? 200 : 503).json({ ok, ts: new Date().toISOString(), checks });
});

// Public.
apiRouter.use('/auth', authRouter);
apiRouter.use('/webhooks', webhooksRouter);

// Public market-research questionnaire (Legal_AI_Survey.md + lexdraft-survey.md).
// Rate-limited at the IP level so a single source can't flood the table.
//
// Order matters: mount /survey/drafts BEFORE /survey so the specific sub-path
// matches first. The draft endpoints get a more permissive limiter - one
// respondent typically generates 30-60 PUTs across a session.
apiRouter.use('/survey/drafts', surveyDraftLimiter, surveyDraftRouter);
apiRouter.use('/survey', signUpLimiter, surveyRouter);

// Client portal - its own auth (magic link → portal JWT). Internal middleware
// gates all but /portal/auth/*.
apiRouter.use('/portal', portalRouter);

// Mixed: GET /by-token/:token + POST /by-token/:token/accept are public,
// everything else under /invitations applies requireAuth via the router itself.
apiRouter.use('/invitations', invitationsRouter);

// Protected. `requireActivePlan` runs after `requireAuth` on every feature
// mount and returns 402 (PaymentRequired) when firms.plan_status is
// past_due/cancelled, or when renews_at is in the past for a non-trial
// firm. Superadmins + impersonation sessions bypass the check.
// `/me*` is deliberately excluded so users can still log in to manage
// profile / billing after their plan lapses.
apiRouter.use('/dashboard', requireAuth, requireActivePlan, dashboardRouter);
apiRouter.use('/firm', requireAuth, requireActivePlan, firmRouter);
apiRouter.use('/cases', requireAuth, requireActivePlan, casesRouter);
apiRouter.use('/hearings', requireAuth, requireActivePlan, hearingsRouter);
apiRouter.use('/tasks', requireAuth, requireActivePlan, tasksRouter);
apiRouter.use('/documents', requireAuth, requireActivePlan, documentsRouter);
apiRouter.use('/drafting', requireAuth, requireActivePlan, draftingRouter);
apiRouter.use('/drafts',   requireAuth, requireActivePlan, draftsRouter);
apiRouter.use('/review',   requireAuth, requireActivePlan, reviewRouter);
apiRouter.use('/letterheads', requireAuth, requireActivePlan, letterheadsRouter);
apiRouter.use('/research', requireAuth, requireActivePlan, researchRouter);
apiRouter.use('/clauses',     requireAuth, requireActivePlan, clausesRouter);
apiRouter.use('/clients',     requireAuth, requireActivePlan, clientsRouter);
apiRouter.use('/leads',       requireAuth, requireActivePlan, leadsRouter);
apiRouter.use('/invoices',    requireAuth, requireActivePlan, invoicesRouter);
apiRouter.use('/expenses',    requireAuth, requireActivePlan, expensesRouter);
apiRouter.use('/limitations', requireAuth, requireActivePlan, limitationsRouter);
apiRouter.use('/diary',       requireAuth, requireActivePlan, diaryRouter);
apiRouter.use('/archive',     requireAuth, requireActivePlan, archiveRouter);
apiRouter.use('/physical-documents', requireAuth, requireActivePlan, physicalDocumentsRouter);
apiRouter.use('/analytics',   requireAuth, requireActivePlan, analyticsRouter);
apiRouter.use('/me',          requireAuth, meRouter);
// MFA - `optionalAuth` instead of `requireAuth` because the
// `verify-challenge` endpoint is the post-password handshake step where the
// client has a challengeId but no bearer yet. Every other handler in this
// router enforces `req.user` itself and throws UnauthorizedError when
// missing, so an attacker can't reach enrolment endpoints unauthenticated.
apiRouter.use('/me/mfa',      optionalAuth, meMfaRouter);
apiRouter.use('/me/dpdp',     requireAuth,  meDpdpRouter);

// Sweep B features - statute reference, calculators, conflict + coverage,
// practice analytics, engagement letters, caseload health, financial exports.
apiRouter.use('/sanhita',             requireAuth, requireActivePlan, sanhitaRouter);
apiRouter.use('/calculators',         requireAuth, requireActivePlan, calculatorsRouter);
apiRouter.use('/conflicts',           requireAuth, requireActivePlan, conflictsRouter);
apiRouter.use('/coverage',            requireAuth, requireActivePlan, coverageRouter);
apiRouter.use('/practice-analytics',  requireAuth, requireActivePlan, practiceAnalyticsRouter);
apiRouter.use('/engagement',          requireAuth, requireActivePlan, engagementRouter);
apiRouter.use('/caseload-health',     requireAuth, requireActivePlan, caseloadHealthRouter);
apiRouter.use('/exports',             requireAuth, requireActivePlan, exportsRouter);

// Firm-side portal administration - toggles, lifecycle, inbox.
apiRouter.use('/portal-admin', requireAuth, requireActivePlan, portalAdminRouter);

// Platform admin - superadmin only, impersonation sessions blocked.
apiRouter.use('/admin', requireAuth, requireSuperadmin, adminRouter);
// Internal error log - superadmin-only viewer + resolve actions.
apiRouter.use('/admin/errors', requireAuth, requireSuperadmin, adminErrorsRouter);
