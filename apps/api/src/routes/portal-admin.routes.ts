/**
 * Firm-side portal administration routes (CLIENT_PORTAL.md §7.1).
 *
 * These endpoints are mounted under `/api/portal-admin/*` and gated by
 * `requireAuth` + tenant scoping (firmIdForUser). They flip the visibility
 * flags introduced in migration 0015, manage portal-user lifecycle, and
 * surface the firm-side messages inbox.
 *
 * The PORTAL-side `/api/portal/*` endpoints remain client-facing; nothing
 * here is reachable with a portal-client JWT.
 */

import { Router } from 'express';
import { z } from 'zod';
import { portalService, portalAdminService } from '../services/portal.service';
import { firmIdForUser } from '../services/tenant';
import { authService } from '../services/auth.service';
import { auditService } from '../services/audit.service';
import { requireFeature } from '../services/permissions.service';
import { checkCanEnablePortal } from '../services/portal-plan-gate';
import { notify } from '../services/notifications.service';
import { logger } from '../logger';
import { validate, idParam } from '../middleware/validate';
import type { AuditAction, AuditTargetType } from '@lexdraft/types';

export const portalAdminRouter: Router = Router();

// ---- helpers ---------------------------------------------------------------

interface AuditCtx {
  actorUserId: string;
  actorEmail: string;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string | null;
  payload?: Record<string, unknown>;
}

function fireAudit(ctx: AuditCtx): void {
  auditService.write(ctx).catch((err) => {
    logger.warn({ err, action: ctx.action }, 'portal-admin audit write failed');
  });
}

// ---- Client portal lifecycle ----------------------------------------------

portalAdminRouter.post(
  '/clients/:id/enable',
  requireFeature('client.create'),
  validate({ params: idParam }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      if (!firmId) { res.status(403).json({ error: 'No firm attached' }); return; }
      const clientId = String(req.params.id ?? '');

      const gate = await checkCanEnablePortal(firmId);
      if (!gate.allowed) {
        res.status(gate.reason === 'plan_not_supported' ? 402 : 409)
           .json({ error: gate.message, reason: gate.reason });
        return;
      }

      const result = await portalAdminService.enablePortal(clientId, firmId);
      fireAudit({
        actorUserId: req.user!.id,
        actorEmail: req.user!.email,
        action: 'portal.client.enabled',
        targetType: 'client',
        targetId: clientId,
      });
      if (result.devMagicLink) {
        notify.portalEnabled(clientId, result.devMagicLink).catch(() => {/* best-effort */});
      }
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

portalAdminRouter.post(
  '/clients/:id/disable',
  requireFeature('client.create'),
  validate({ params: idParam }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      if (!firmId) { res.status(403).json({ error: 'No firm attached' }); return; }
      const clientId = String(req.params.id ?? '');
      const result = await portalAdminService.disablePortal(clientId, firmId);
      fireAudit({
        actorUserId: req.user!.id,
        actorEmail: req.user!.email,
        action: 'portal.client.disabled',
        targetType: 'client',
        targetId: clientId,
        payload: { revokedSessions: result.revokedSessions },
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

portalAdminRouter.post(
  '/clients/:id/resend-link',
  requireFeature('client.create'),
  validate({ params: idParam }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      if (!firmId) { res.status(403).json({ error: 'No firm attached' }); return; }
      const clientId = String(req.params.id ?? '');
      const result = await portalAdminService.resendLink(clientId, firmId);
      fireAudit({
        actorUserId: req.user!.id,
        actorEmail: req.user!.email,
        action: 'portal.client.link_resent',
        targetType: 'client',
        targetId: clientId,
      });
      if (result.devMagicLink) {
        notify.magicLinkResent(clientId, result.devMagicLink).catch(() => {/* best-effort */});
      }
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// ---- Document portal flags ------------------------------------------------

const DocumentPortalPatch = z.object({
  sharedWithClient: z.boolean().optional(),
  requiresAcknowledgement: z.boolean().optional(),
}).strict().refine(
  (v) => v.sharedWithClient !== undefined || v.requiresAcknowledgement !== undefined,
  { message: 'At least one flag must be supplied' },
);

portalAdminRouter.patch(
  '/documents/:id/flags',
  requireFeature('matter.create'),
  validate({ params: idParam, body: DocumentPortalPatch }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      if (!firmId) { res.status(403).json({ error: 'No firm attached' }); return; }
      const docId = String(req.params.id ?? '');
      const body = DocumentPortalPatch.parse(req.body);
      const result = await portalAdminService.setDocumentPortalFlags(docId, firmId, body);

      // Audit the actual transitions, not just the request - so a no-op
      // PATCH (toggle to current value) doesn't pollute the feed.
      if (body.sharedWithClient !== undefined) {
        fireAudit({
          actorUserId: req.user!.id, actorEmail: req.user!.email,
          action: result.sharedWithClient ? 'portal.document.shared' : 'portal.document.unshared',
          targetType: 'document', targetId: docId,
          payload: { name: result.name },
        });
      }
      if (body.requiresAcknowledgement !== undefined) {
        fireAudit({
          actorUserId: req.user!.id, actorEmail: req.user!.email,
          action: result.requiresAcknowledgement ? 'portal.document.ack_required' : 'portal.document.ack_cleared',
          targetType: 'document', targetId: docId,
          payload: { name: result.name },
        });
      }

      // Fire notifications only on net-positive transitions: sharing a doc
      // that wasn't shared, or asking for ack when none was required.
      if (result.clientName && result.becameShared) {
        // Resolve clientId by name lookup so the notifier can read prefs.
        // Pull every client of this firm with this name; usually 1.
        try {
          const c = await findFirstClientByName(firmId, result.clientName);
          if (c) await notify.documentShared(c, result.name);
        } catch { /* best effort */ }
      }
      if (result.clientName && result.becameRequired) {
        try {
          const c = await findFirstClientByName(firmId, result.clientName);
          if (c) await notify.documentRequiresAck(c, result.name);
        } catch { /* best effort */ }
      }

      res.json({
        id: result.id,
        sharedWithClient: result.sharedWithClient,
        requiresAcknowledgement: result.requiresAcknowledgement,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ---- Matter portal flags --------------------------------------------------

const MatterPortalPatch = z.object({
  visibleToClient: z.boolean(),
}).strict();

portalAdminRouter.patch(
  '/cases/:id/visibility',
  requireFeature('matter.create'),
  validate({ params: idParam, body: MatterPortalPatch }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      if (!firmId) { res.status(403).json({ error: 'No firm attached' }); return; }
      const caseId = String(req.params.id ?? '');
      const body = MatterPortalPatch.parse(req.body);
      await portalAdminService.setMatterVisibility(caseId, firmId, body.visibleToClient);
      fireAudit({
        actorUserId: req.user!.id,
        actorEmail: req.user!.email,
        action: 'portal.matter.visibility.updated',
        targetType: 'case',
        targetId: caseId,
        payload: { visibleToClient: body.visibleToClient },
      });
      res.json({ id: caseId, visibleToClient: body.visibleToClient });
    } catch (err) {
      next(err);
    }
  },
);

// ---- Firm-side messages inbox ---------------------------------------------

portalAdminRouter.get(
  '/messages',
  requireFeature('client.view'),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      if (!firmId) { res.json({ items: [] }); return; }
      const items = await portalAdminService.listInbox(firmId);
      res.json({ items });
    } catch (err) {
      next(err);
    }
  },
);

const ThreadQuery = z.object({
  clientId: z.string().uuid(),
  matterId: z.string().uuid().optional(),
});

portalAdminRouter.get(
  '/messages/thread',
  requireFeature('client.view'),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      if (!firmId) { res.json({ items: [] }); return; }
      const q = ThreadQuery.parse(req.query);
      const items = await portalAdminService.listThread(firmId, q.clientId, q.matterId ?? null);
      res.json({ items });
    } catch (err) {
      next(err);
    }
  },
);

const FirmSendMessage = z.object({
  clientId: z.string().uuid(),
  matterId: z.string().uuid().nullable().optional(),
  body: z.string().min(1).max(4000),
});

portalAdminRouter.post(
  '/messages',
  requireFeature('client.view'),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      if (!firmId) { res.status(403).json({ error: 'No firm attached' }); return; }
      const body = FirmSendMessage.parse(req.body);

      const inviter = await authService.getById(req.user!.id);
      const senderName = inviter?.name ?? req.user!.email;

      const message = await portalAdminService.sendFromFirm(firmId, {
        clientId: body.clientId,
        matterId: body.matterId ?? null,
        body: body.body,
        senderId: req.user!.id,
        senderName,
      });

      fireAudit({
        actorUserId: req.user!.id,
        actorEmail: req.user!.email,
        action: 'portal.message.firm_sent',
        targetType: 'portal_message',
        targetId: message.id,
        payload: { clientId: body.clientId, matterId: body.matterId ?? null },
      });

      // Best-effort notification to the client's email.
      try {
        await notify.messageFromAdvocate(body.clientId, {
          advocateName: senderName,
          matterTitle: message.matterLabel ?? null,
          preview: body.body.length > 120 ? `${body.body.slice(0, 117)}…` : body.body,
        });
      } catch { /* best effort */ }

      res.status(201).json(message);
    } catch (err) {
      next(err);
    }
  },
);

const MarkReadQuery = z.object({
  clientId: z.string().uuid(),
  matterId: z.string().uuid().optional(),
});

portalAdminRouter.post(
  '/messages/read',
  requireFeature('client.view'),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      if (!firmId) { res.status(403).json({ error: 'No firm attached' }); return; }
      const q = MarkReadQuery.parse(req.query);
      const marked = await portalAdminService.markThreadReadFromFirm(
        firmId, q.clientId, q.matterId ?? null,
      );
      if (marked > 0) {
        fireAudit({
          actorUserId: req.user!.id,
          actorEmail: req.user!.email,
          action: 'portal.message.firm_read',
          targetType: 'portal_message',
          targetId: null,
          payload: { clientId: q.clientId, matterId: q.matterId ?? null, count: marked },
        });
      }
      res.json({ ok: true, marked });
    } catch (err) {
      next(err);
    }
  },
);

// ---- helpers ---------------------------------------------------------------

async function findFirstClientByName(firmId: string, name: string): Promise<string | null> {
  const { db } = await import('../db/client');
  const sql = db();
  if (!sql) return null;
  const rows = await sql<Array<{ id: string }>>`
    select id from clients where firm_id = ${firmId}::uuid and name = ${name} limit 1
  `;
  return rows[0]?.id ?? null;
}

void portalService; // re-export anchor: keep portalService imported for
                    // future endpoints that might want the read-side helpers.
