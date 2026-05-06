import { Router } from 'express';
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
import { analyticsRouter } from './analytics.routes';
import { requireAuth, requireSuperadmin } from '../middleware/auth';

export const apiRouter: Router = Router();

apiRouter.get('/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// Public.
apiRouter.use('/auth', authRouter);
apiRouter.use('/webhooks', webhooksRouter);

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
apiRouter.use('/analytics',   requireAuth, analyticsRouter);

// Platform admin — superadmin only, impersonation sessions blocked.
apiRouter.use('/admin', requireAuth, requireSuperadmin, adminRouter);
