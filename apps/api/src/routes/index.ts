import { Router } from 'express';
import { db } from '../db/client';
import { authRouter } from './auth.routes';
import { casesRouter } from './cases.routes';
import { hearingsRouter } from './hearings.routes';
import { tasksRouter } from './tasks.routes';
import { documentsRouter } from './documents.routes';
import { draftingRouter } from './drafting.routes';
import { draftsRouter } from './drafts.routes';
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
import { portalRouter } from './portal.routes';
import { portalAdminRouter } from './portal-admin.routes';
import { requireAuth, requireSuperadmin, optionalAuth } from '../middleware/auth';

export const apiRouter: Router = Router();

// Liveness — process is up. Cheap, no DB.
apiRouter.get('/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// Readiness — process is up AND can talk to its dependencies. Used by the
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

// Client portal — its own auth (magic link → portal JWT). Internal middleware
// gates all but /portal/auth/*.
apiRouter.use('/portal', portalRouter);

// Mixed: GET /by-token/:token + POST /by-token/:token/accept are public,
// everything else under /invitations applies requireAuth via the router itself.
apiRouter.use('/invitations', invitationsRouter);

// Protected.
apiRouter.use('/dashboard', requireAuth, dashboardRouter);
apiRouter.use('/firm', requireAuth, firmRouter);
apiRouter.use('/cases', requireAuth, casesRouter);
apiRouter.use('/hearings', requireAuth, hearingsRouter);
apiRouter.use('/tasks', requireAuth, tasksRouter);
apiRouter.use('/documents', requireAuth, documentsRouter);
apiRouter.use('/drafting', requireAuth, draftingRouter);
apiRouter.use('/drafts',   requireAuth, draftsRouter);
apiRouter.use('/research', requireAuth, researchRouter);
apiRouter.use('/clauses',     requireAuth, clausesRouter);
apiRouter.use('/clients',     requireAuth, clientsRouter);
apiRouter.use('/leads',       requireAuth, leadsRouter);
apiRouter.use('/invoices',    requireAuth, invoicesRouter);
apiRouter.use('/expenses',    requireAuth, expensesRouter);
apiRouter.use('/limitations', requireAuth, limitationsRouter);
apiRouter.use('/diary',       requireAuth, diaryRouter);
apiRouter.use('/archive',     requireAuth, archiveRouter);
apiRouter.use('/physical-documents', requireAuth, physicalDocumentsRouter);
apiRouter.use('/analytics',   requireAuth, analyticsRouter);
apiRouter.use('/me',          requireAuth, meRouter);
// MFA — `optionalAuth` instead of `requireAuth` because the
// `verify-challenge` endpoint is the post-password handshake step where the
// client has a challengeId but no bearer yet. Every other handler in this
// router enforces `req.user` itself and throws UnauthorizedError when
// missing, so an attacker can't reach enrolment endpoints unauthenticated.
apiRouter.use('/me/mfa',      optionalAuth, meMfaRouter);
apiRouter.use('/me/dpdp',     requireAuth,  meDpdpRouter);

// Firm-side portal administration — toggles, lifecycle, inbox.
apiRouter.use('/portal-admin', requireAuth, portalAdminRouter);

// Platform admin — superadmin only, impersonation sessions blocked.
apiRouter.use('/admin', requireAuth, requireSuperadmin, adminRouter);
