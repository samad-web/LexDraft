import { Router, type Request } from 'express';
import { z } from 'zod';
import { portalService } from '../services/portal.service';
import { auditService } from '../services/audit.service';
import { storage } from '../services/storage.service';
import { validate, idParam } from '../middleware/validate';
import { requirePortalAuth } from '../middleware/portalAuth';
import { logger } from '../logger';
import { notify } from '../services/notifications.service';
import { db } from '../db/client';
import type { AuditAction, AuditTargetType } from '@lexdraft/types';

export const portalRouter: Router = Router();

// ---- public auth endpoints --------------------------------------------------

const SignIn = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(128),
}).strict();

portalRouter.post(
  '/auth/sign-in',
  validate({ body: SignIn }),
  async (req, res, next) => {
    try {
      const session = await portalService.signInWithPassword(
        req.body.email,
        req.body.password,
      );
      writePortalAudit({
        clientId: session.client.id,
        firmId: session.client.firmId,
        email: session.client.email,
        action: 'portal.session.created',
        targetType: 'portal_session',
        targetId: null,
        req,
      });
      res.json(session);
    } catch (err) {
      next(err);
    }
  },
);

// ---- authenticated read endpoints ------------------------------------------

portalRouter.use(requirePortalAuth);

function ctx(req: Request): { clientId: string; firmId: string; email: string } {
  const c = req.portalClient!;
  return { clientId: c.clientId, firmId: c.firmId, email: c.email };
}

portalRouter.post('/auth/sign-out', (req, res) => {
  const { clientId, firmId, email } = ctx(req);
  writePortalAudit({
    clientId, firmId, email,
    action: 'portal.session.signed_out',
    targetType: 'portal_session',
    targetId: null,
    req,
  });
  // JWT is stateless; the SPA clears it. Server-side revocation is best-effort.
  res.json({ ok: true });
});

portalRouter.get('/me', async (req, res, next) => {
  try {
    const { clientId, firmId, email } = ctx(req);
    const name = await portalService.clientName(clientId, firmId);
    if (!name) {
      res.status(410).json({ error: 'Client no longer exists' });
      return;
    }
    res.json({ client: { id: clientId, name, firmId, email } });
  } catch (err) {
    next(err);
  }
});

portalRouter.get('/dashboard', async (req, res, next) => {
  try {
    const { clientId, firmId, email } = ctx(req);
    const payload = await portalService.dashboard(clientId, firmId);
    writePortalAudit({
      clientId, firmId, email,
      action: 'portal.dashboard.viewed',
      targetType: 'portal_session',
      targetId: null,
      req,
    });
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

portalRouter.get('/cases', async (req, res, next) => {
  try {
    const { clientId, firmId } = ctx(req);
    res.json({ items: await portalService.listCases(clientId, firmId) });
  } catch (err) {
    next(err);
  }
});

portalRouter.get('/hearings', async (req, res, next) => {
  try {
    const { clientId, firmId } = ctx(req);
    res.json({ items: await portalService.listHearings(clientId, firmId) });
  } catch (err) {
    next(err);
  }
});

portalRouter.get('/invoices', async (req, res, next) => {
  try {
    const { clientId, firmId } = ctx(req);
    res.json({ items: await portalService.listInvoices(clientId, firmId) });
  } catch (err) {
    next(err);
  }
});

portalRouter.get('/documents', async (req, res, next) => {
  try {
    const { clientId, firmId } = ctx(req);
    res.json({ items: await portalService.listDocuments(clientId, firmId) });
  } catch (err) {
    next(err);
  }
});

portalRouter.get(
  '/matters/:id',
  validate({ params: idParam }),
  async (req, res, next) => {
    try {
      const { clientId, firmId, email } = ctx(req);
      const id = typeof req.params['id'] === 'string' ? (req.params['id'] as string) : '';
      const detail = await portalService.matterDetail(id, clientId, firmId);
      if (!detail) {
        res.status(404).json({ error: 'Matter not available' });
        return;
      }
      writePortalAudit({
        clientId, firmId, email,
        action: 'portal.matter.viewed',
        targetType: 'case',
        targetId: id,
        req,
      });
      res.json(detail);
    } catch (err) {
      next(err);
    }
  },
);

portalRouter.get(
  '/documents/:id/download-url',
  validate({ params: idParam }),
  async (req, res, next) => {
    try {
      const { clientId, firmId, email } = ctx(req);
      const id = typeof req.params['id'] === 'string' ? (req.params['id'] as string) : '';
      const key = await portalService.getDocumentStorageKey(id, clientId, firmId);
      if (!key) {
        res.status(404).json({ error: 'Document not available' });
        return;
      }
      const presigned = await storage().presignDownload({ key });
      writePortalAudit({
        clientId, firmId, email,
        action: 'portal.document.viewed',
        targetType: 'document',
        targetId: id,
        req,
      });
      res.json(presigned);
    } catch (err) {
      next(err);
    }
  },
);

portalRouter.post(
  '/documents/:id/sign',
  validate({ params: idParam }),
  async (req, res, next) => {
    try {
      const { clientId, firmId, email } = ctx(req);
      const id = typeof req.params['id'] === 'string' ? (req.params['id'] as string) : '';
      const result = await portalService.acknowledgeDocument(id, clientId, firmId);
      writePortalAudit({
        clientId, firmId, email,
        action: 'portal.document.acknowledged',
        targetType: 'document',
        targetId: id,
        req,
        payload: { signedAt: result.signedAt },
      });
      // Best-effort: tell the firm. Lookup the document name + client name
      // so the email body is informative.
      try {
        const sql = db();
        if (sql) {
          const meta = await sql<Array<{ name: string; client_name: string }>>`
            select d.name, c.name as client_name
            from documents d
            left join clients c on c.id = ${clientId}::uuid
            where d.id = ${id}::uuid and d.firm_id = ${firmId}::uuid limit 1
          `;
          const m = meta[0];
          if (m) {
            await notify.documentAcknowledged(firmId, {
              clientName: m.client_name,
              documentName: m.name,
            });
          }
        }
      } catch { /* best effort */ }
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// ---- messages ---------------------------------------------------------------

const MessageQuery = z.object({
  matterId: z.string().uuid().optional(),
});

portalRouter.get('/messages', async (req, res, next) => {
  try {
    const { clientId, firmId } = ctx(req);
    const query = MessageQuery.parse(req.query);
    const matterId = query.matterId ?? null;
    const items = await portalService.listMessages(clientId, firmId, matterId);
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

const SendMessageBody = z.object({
  matterId: z.string().uuid().nullable().optional(),
  body: z.string().min(1).max(4000),
});

portalRouter.post('/messages', async (req, res, next) => {
  try {
    const { clientId, firmId, email } = ctx(req);
    const body = SendMessageBody.parse(req.body);
    const message = await portalService.sendMessage(
      clientId,
      firmId,
      body.matterId ?? null,
      body.body,
    );
    writePortalAudit({
      clientId, firmId, email,
      action: 'portal.message.sent',
      targetType: 'portal_message',
      targetId: message.id,
      req,
      payload: { matterId: message.matterId },
    });
    // Best-effort: notify the firm-side advocates of the new message.
    try {
      await notify.messageFromClient(firmId, {
        clientName: message.senderName,
        matterTitle: message.matterLabel ?? null,
        preview: message.body.length > 120 ? `${message.body.slice(0, 117)}…` : message.body,
      });
    } catch { /* best effort */ }
    res.status(201).json(message);
  } catch (err) {
    next(err);
  }
});

// ---- profile ----------------------------------------------------------------

portalRouter.get('/profile', async (req, res, next) => {
  try {
    const { clientId, firmId, email } = ctx(req);
    const profile = await portalService.getProfile(clientId, firmId);
    writePortalAudit({
      clientId, firmId, email,
      action: 'portal.profile.viewed',
      targetType: 'client',
      targetId: clientId,
      req,
    });
    res.json(profile);
  } catch (err) {
    next(err);
  }
});

const NotificationPrefs = z.object({
  newDocument: z.boolean().optional(),
  hearingReminder: z.boolean().optional(),
  newMessage: z.boolean().optional(),
  invoiceIssued: z.boolean().optional(),
  invoiceOverdue: z.boolean().optional(),
}).strict().partial();

const ProfilePatch = z.object({
  language: z.literal('en').optional(),
  notifications: NotificationPrefs.optional(),
}).strict();

portalRouter.patch('/profile', async (req, res, next) => {
  try {
    const { clientId, firmId, email } = ctx(req);
    const patch = ProfilePatch.parse(req.body);
    const updated = await portalService.updateProfile(clientId, firmId, patch);
    writePortalAudit({
      clientId, firmId, email,
      action: 'portal.profile.updated',
      targetType: 'client',
      targetId: clientId,
      req,
      payload: { patch },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

const ForgetMeBody = z.object({
  reason: z.string().max(500).optional(),
}).strict().partial();

portalRouter.post('/forget-me', async (req, res, next) => {
  try {
    const { clientId, firmId, email } = ctx(req);
    const body = ForgetMeBody.parse(req.body ?? {});
    const result = await portalService.requestForgetMe(clientId, firmId);
    writePortalAudit({
      clientId, firmId, email,
      action: 'portal.dsr.forget_me_requested',
      targetType: 'client',
      targetId: clientId,
      req,
      payload: body.reason ? { reason: body.reason } : undefined,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

portalRouter.post('/messages/read', async (req, res, next) => {
  try {
    const { clientId, firmId, email } = ctx(req);
    const query = MessageQuery.parse(req.query);
    const matterId = query.matterId ?? null;
    const marked = await portalService.markThreadRead(clientId, firmId, matterId);
    if (marked > 0) {
      writePortalAudit({
        clientId, firmId, email,
        action: 'portal.message.read',
        targetType: 'portal_message',
        targetId: null,
        req,
        payload: { matterId, count: marked },
      });
    }
    res.json({ ok: true, marked });
  } catch (err) {
    next(err);
  }
});

// ---- helpers ----------------------------------------------------------------

interface PortalAuditInput {
  clientId: string;
  firmId: string;
  email: string;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string | null;
  req: Request;
  payload?: Record<string, unknown>;
}

/**
 * Fire-and-forget audit write for portal actions. Distinct from the firm-side
 * `withAudit` middleware because the actor is a portal client, not a firm
 * user - `actorUserId` is null and the discriminator + identity live in the
 * payload (`actorKind: 'portal_client'`). Never blocks the response.
 */
function writePortalAudit(input: PortalAuditInput): void {
  const payload: Record<string, unknown> = {
    actorKind: 'portal_client',
    clientId: input.clientId,
    firmId: input.firmId,
    ip: input.req.ip,
    userAgent: input.req.header('user-agent') ?? '',
    ...(input.payload ?? {}),
  };
  // We reuse `actor_user_id` to store the clientId - the column carries no FK
  // constraint, and `payload.actorKind` disambiguates user vs portal_client
  // when reading. This lets the firm-side audit feed surface portal actions
  // for the firm via a join against the clients table.
  auditService
    .write({
      actorUserId: input.clientId,
      actorEmail: input.email,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      payload,
    })
    .catch((err) => {
      logger.warn({ err, action: input.action }, 'portal audit write failed');
    });
}
