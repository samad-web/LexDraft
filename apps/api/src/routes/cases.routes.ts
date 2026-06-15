import { Router } from 'express';
import { z } from 'zod';
import { casesService } from '../services/cases.service';
import {
  casePipelineService,
  pipelineGraph,
  instantiateGraph,
  snapshotFor,
  customStagesForFirm,
  kindForType,
} from '../services/case-pipeline.service';
import { syncCaseFromEcourts } from '../services/case-sync.service';
import { caseActsService } from '../services/case-acts.service';
import { casePartiesService } from '../services/case-parties.service';
import { caseApplicationsService } from '../services/case-applications.service';
import { assignmentsService } from '../services/assignments.service';
import { firmIdForUser } from '../services/tenant';
import { authService } from '../services/auth.service';
import { validate, idParam } from '../middleware/validate';
import { withAudit } from '../middleware/audit';
import { requireFeature } from '../services/permissions.service';

const CaseInput = z.object({
  cnr: z.string(),
  title: z.string(),
  court: z.string(),
  stage: z.string(),
  client: z.string(),
  status: z.enum(['Active', 'Pending', 'Closed', 'Archived']),
  next: z.string(),
  type: z.string(),
});
const CaseListQuery = z.object({
  type: z.string().optional(),
  q: z.string().optional(),
});

export const casesRouter: Router = Router();

function strParam(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

casesRouter.get('/', requireFeature('matter.view'), validate({ query: CaseListQuery }), async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    const items = await casesService.list({
      firmId,
      type: typeof req.query['type'] === 'string' ? (req.query['type'] as string) : undefined,
      q:    typeof req.query['q']    === 'string' ? (req.query['q']    as string) : undefined,
    });
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

// ---- Lead-advocate assignment (handover) ----------------------------------
// GET current lead; PUT to hand the matter to another member. The service
// authorises the write (firm head, or the current lead self-handing-off), so
// the route only needs the matter feature gate.
const LeadInput = z.object({ userId: z.string().uuid() });

casesRouter.get('/:id/lead', requireFeature('matter.view'), validate({ params: idParam }), async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    const lead = await assignmentsService.getCaseLead(strParam(req.params['id']), firmId);
    res.json({ lead });
  } catch (err) {
    next(err);
  }
});

casesRouter.put(
  '/:id/lead',
  requireFeature('matter.view'),
  validate({ params: idParam, body: LeadInput }),
  withAudit({ action: 'case.update', targetType: 'case' }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      const actor = { id: req.user!.id, role: req.user!.role, isSuperadmin: req.user!.isSuperadmin };
      const lead = await assignmentsService.setCaseLead({
        caseId: strParam(req.params['id']), firmId, targetUserId: req.body.userId, actor,
      });
      res.json({ lead });
    } catch (err) {
      next(err);
    }
  },
);

casesRouter.get('/:id', requireFeature('matter.view'), validate({ params: idParam }), async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    const c = await casesService.get(strParam(req.params['id']), firmId);
    if (!c) {
      res.status(404).json({ error: 'Case not found' });
      return;
    }
    // Attach the legacy pipeline snapshot (kept for back-compat) plus the new
    // per-case graph. The graph lazily instantiates from the template if the
    // matter has none yet. Clients render the builder from `graph`.
    const extras = await customStagesForFirm(firmId, kindForType(c.type));
    const graph = firmId ? await pipelineGraph.get(strParam(req.params['id']), firmId) : { nodes: [], edges: [] };
    res.json({ ...c, pipeline: snapshotFor(c.type, c.stage, extras), graph });
  } catch (err) {
    next(err);
  }
});

// GET /cases/:id/acts — eCourts-imported (and manually-added) acts & sections
// for a matter. Empty array when the case has never been synced.
casesRouter.get(
  '/:id/acts',
  requireFeature('matter.view'),
  validate({ params: idParam }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      if (!firmId) {
        res.json({ items: [] });
        return;
      }
      const items = await caseActsService.listForCase(strParam(req.params['id']), firmId);
      res.json({ items });
    } catch (err) {
      next(err);
    }
  },
);

// GET /cases/:id/parties — petitioner/respondent + extra parties + advocates,
// populated by the eCourts sync. Empty when the case has never been synced.
casesRouter.get(
  '/:id/parties',
  requireFeature('matter.view'),
  validate({ params: idParam }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      if (!firmId) {
        res.json({ items: [] });
        return;
      }
      const items = await casePartiesService.listForCase(strParam(req.params['id']), firmId);
      res.json({ items });
    } catch (err) {
      next(err);
    }
  },
);

casesRouter.get('/:id/timeline', requireFeature('matter.view'), validate({ params: idParam }), async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    if (!firmId) {
      res.json({ items: [] });
      return;
    }
    const items = await casePipelineService.timeline(strParam(req.params['id']), firmId, 'advocate');
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

const TransitionInput = z.object({
  toStage: z.string().min(1).max(80),
  note: z.string().max(400).optional(),
  visibleToPortal: z.boolean().optional(),
});

casesRouter.post(
  '/:id/transition',
  requireFeature('matter.create'),
  validate({ params: idParam, body: TransitionInput }),
  withAudit({ action: 'case.transition', targetType: 'case' }),
  async (req, res, next) => {
    try {
      const userId = req.user?.id;
      const firmId = await firmIdForUser(userId);
      if (!firmId) {
        res.status(422).json({ error: 'No firm attached' });
        return;
      }
      const actor = userId ? await authService.getById(userId).catch(() => undefined) : undefined;
      const body = req.body as z.infer<typeof TransitionInput>;
      const result = await casePipelineService.transition({
        caseId: strParam(req.params['id']),
        firmId,
        toStage: body.toStage,
        actor: { id: userId ?? null, name: actor?.name ?? null },
        ...(body.note !== undefined ? { note: body.note } : {}),
        ...(body.visibleToPortal !== undefined ? { visibleToPortal: body.visibleToPortal } : {}),
      });
      if (!result) {
        res.status(404).json({ error: 'Case not found' });
        return;
      }
      const updated = await casesService.get(strParam(req.params['id']), firmId);
      const extras = updated
        ? await customStagesForFirm(firmId, kindForType(updated.type))
        : [];
      res.json({
        ...(updated ?? {}),
        pipeline: updated ? snapshotFor(updated.type, updated.stage, extras) : null,
        transition: result,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ============================================================================
// Pipeline graph — per-case nodes + edges (migration 0054)
// ============================================================================

const nodeParam = z.object({ id: z.string().min(1), nodeId: z.string().uuid() });
const edgeParam = z.object({ id: z.string().min(1), edgeId: z.string().uuid() });

const NodeInput = z.object({
  label: z.string().min(1).max(80),
  x: z.number(),
  y: z.number(),
  applicationId: z.string().uuid().nullable().optional(),
});
const NodePatchInput = z.object({
  label: z.string().min(1).max(80).optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  applicationId: z.string().uuid().nullable().optional(),
});
const NodeStatusInput = z.object({
  status: z.enum(['pending', 'active', 'done', 'skipped']),
  note: z.string().max(400).optional(),
  visibleToPortal: z.boolean().optional(),
});
const EdgeInput = z.object({
  fromNodeId: z.string().uuid(),
  toNodeId: z.string().uuid(),
  conditionLabel: z.string().max(60).optional(),
});
const EdgePatchInput = z.object({
  conditionLabel: z.string().max(60).nullable(),
});

// GET /cases/:id/pipeline — the per-case graph (lazily instantiated).
casesRouter.get(
  '/:id/pipeline',
  requireFeature('matter.view'),
  validate({ params: idParam }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      if (!firmId) {
        res.json({ nodes: [], edges: [] });
        return;
      }
      res.json(await pipelineGraph.get(strParam(req.params['id']), firmId));
    } catch (err) {
      next(err);
    }
  },
);

casesRouter.post(
  '/:id/pipeline/nodes',
  requireFeature('matter.create'),
  validate({ params: idParam, body: NodeInput }),
  withAudit({ action: 'case.pipeline.node.add', targetType: 'case' }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      if (!firmId) { res.status(422).json({ error: 'No firm attached' }); return; }
      const body = req.body as z.infer<typeof NodeInput>;
      const node = await pipelineGraph.addNode(strParam(req.params['id']), firmId, {
        label: body.label,
        x: body.x,
        y: body.y,
        ...(body.applicationId !== undefined ? { applicationId: body.applicationId } : {}),
      });
      if (!node) { res.status(404).json({ error: 'Case not found' }); return; }
      res.status(201).json({ node, graph: await pipelineGraph.get(strParam(req.params['id']), firmId) });
    } catch (err) {
      next(err);
    }
  },
);

casesRouter.patch(
  '/:id/pipeline/nodes/:nodeId',
  requireFeature('matter.create'),
  validate({ params: nodeParam, body: NodePatchInput }),
  withAudit({ action: 'case.pipeline.node.update', targetType: 'case' }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      if (!firmId) { res.status(422).json({ error: 'No firm attached' }); return; }
      const body = req.body as z.infer<typeof NodePatchInput>;
      const patch: Parameters<typeof pipelineGraph.updateNode>[2] = {};
      if (body.label !== undefined) patch.label = body.label;
      if (body.x !== undefined) patch.x = body.x;
      if (body.y !== undefined) patch.y = body.y;
      if (body.applicationId !== undefined) patch.applicationId = body.applicationId;
      const node = await pipelineGraph.updateNode(strParam(req.params['nodeId']), firmId, patch);
      if (!node) { res.status(404).json({ error: 'Node not found' }); return; }
      res.json({ node, graph: await pipelineGraph.get(strParam(req.params['id']), firmId) });
    } catch (err) {
      next(err);
    }
  },
);

casesRouter.delete(
  '/:id/pipeline/nodes/:nodeId',
  requireFeature('matter.create'),
  validate({ params: nodeParam }),
  withAudit({ action: 'case.pipeline.node.delete', targetType: 'case' }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      if (!firmId) { res.status(422).json({ error: 'No firm attached' }); return; }
      const ok = await pipelineGraph.deleteNode(strParam(req.params['nodeId']), firmId);
      if (!ok) { res.status(404).json({ error: 'Node not found' }); return; }
      res.json({ graph: await pipelineGraph.get(strParam(req.params['id']), firmId) });
    } catch (err) {
      next(err);
    }
  },
);

casesRouter.post(
  '/:id/pipeline/nodes/:nodeId/status',
  requireFeature('matter.create'),
  validate({ params: nodeParam, body: NodeStatusInput }),
  withAudit({ action: 'case.transition', targetType: 'case' }),
  async (req, res, next) => {
    try {
      const userId = req.user?.id;
      const firmId = await firmIdForUser(userId);
      if (!firmId) { res.status(422).json({ error: 'No firm attached' }); return; }
      const actor = userId ? await authService.getById(userId).catch(() => undefined) : undefined;
      const body = req.body as z.infer<typeof NodeStatusInput>;
      const result = await pipelineGraph.setStatus({
        nodeId: strParam(req.params['nodeId']),
        firmId,
        status: body.status,
        actor: { id: userId ?? null, name: actor?.name ?? null },
        ...(body.note !== undefined ? { note: body.note } : {}),
        ...(body.visibleToPortal !== undefined ? { visibleToPortal: body.visibleToPortal } : {}),
      });
      if (!result) { res.status(404).json({ error: 'Node not found' }); return; }
      res.json({ node: result.node, graph: await pipelineGraph.get(strParam(req.params['id']), firmId) });
    } catch (err) {
      next(err);
    }
  },
);

casesRouter.post(
  '/:id/pipeline/edges',
  requireFeature('matter.create'),
  validate({ params: idParam, body: EdgeInput }),
  withAudit({ action: 'case.pipeline.edge.add', targetType: 'case' }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      if (!firmId) { res.status(422).json({ error: 'No firm attached' }); return; }
      const body = req.body as z.infer<typeof EdgeInput>;
      const edge = await pipelineGraph.addEdge(strParam(req.params['id']), firmId, {
        fromNodeId: body.fromNodeId,
        toNodeId: body.toNodeId,
        ...(body.conditionLabel !== undefined ? { conditionLabel: body.conditionLabel } : {}),
      });
      if (!edge) { res.status(409).json({ error: 'Edge already exists or endpoints invalid' }); return; }
      res.status(201).json({ edge, graph: await pipelineGraph.get(strParam(req.params['id']), firmId) });
    } catch (err) {
      next(err);
    }
  },
);

casesRouter.patch(
  '/:id/pipeline/edges/:edgeId',
  requireFeature('matter.create'),
  validate({ params: edgeParam, body: EdgePatchInput }),
  withAudit({ action: 'case.pipeline.edge.update', targetType: 'case' }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      if (!firmId) { res.status(422).json({ error: 'No firm attached' }); return; }
      const body = req.body as z.infer<typeof EdgePatchInput>;
      const edge = await pipelineGraph.updateEdge(strParam(req.params['edgeId']), firmId, body.conditionLabel);
      if (!edge) { res.status(404).json({ error: 'Edge not found' }); return; }
      res.json({ edge, graph: await pipelineGraph.get(strParam(req.params['id']), firmId) });
    } catch (err) {
      next(err);
    }
  },
);

casesRouter.delete(
  '/:id/pipeline/edges/:edgeId',
  requireFeature('matter.create'),
  validate({ params: edgeParam }),
  withAudit({ action: 'case.pipeline.edge.delete', targetType: 'case' }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      if (!firmId) { res.status(422).json({ error: 'No firm attached' }); return; }
      const ok = await pipelineGraph.deleteEdge(strParam(req.params['edgeId']), firmId);
      if (!ok) { res.status(404).json({ error: 'Edge not found' }); return; }
      res.json({ graph: await pipelineGraph.get(strParam(req.params['id']), firmId) });
    } catch (err) {
      next(err);
    }
  },
);

// ============================================================================
// Case applications — interim applications / appeals / execution / etc.
// ============================================================================

const appParam = z.object({ id: z.string().min(1), appId: z.string().uuid() });
const APP_KINDS = ['ia', 'appeal', 'execution', 'review', 'bail', 'other'] as const;
const APP_STATUSES = ['pending', 'allowed', 'dismissed', 'withdrawn', 'disposed'] as const;

const ApplicationInput = z.object({
  kind: z.enum(APP_KINDS).default('ia'),
  label: z.string().max(120).optional(),
  appType: z.string().max(120).optional(),
  filedOn: z.string().optional(),
  status: z.enum(APP_STATUSES).default('pending'),
  orderOn: z.string().optional(),
  notes: z.string().max(2000).optional(),
  visibleToPortal: z.boolean().optional(),
});
const ApplicationPatchInput = z.object({
  kind: z.enum(APP_KINDS).optional(),
  label: z.string().max(120).nullable().optional(),
  appType: z.string().max(120).nullable().optional(),
  filedOn: z.string().nullable().optional(),
  status: z.enum(APP_STATUSES).optional(),
  orderOn: z.string().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  visibleToPortal: z.boolean().optional(),
});

/** '' / undefined → null (so an empty date input clears rather than casting
 *  ''::date and erroring). */
function dateOrNull(v: string | null | undefined): string | null {
  return v && v.trim() ? v.trim() : null;
}

casesRouter.get(
  '/:id/applications',
  requireFeature('matter.view'),
  validate({ params: idParam }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      if (!firmId) { res.json({ items: [] }); return; }
      const items = await caseApplicationsService.listForCase(strParam(req.params['id']), firmId);
      res.json({ items });
    } catch (err) {
      next(err);
    }
  },
);

casesRouter.post(
  '/:id/applications',
  requireFeature('matter.create'),
  validate({ params: idParam, body: ApplicationInput }),
  withAudit({ action: 'case.application.create', targetType: 'case' }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      if (!firmId) { res.status(422).json({ error: 'No firm attached' }); return; }
      const body = req.body as z.infer<typeof ApplicationInput>;
      const created = await caseApplicationsService.create(strParam(req.params['id']), firmId, {
        kind: body.kind,
        label: body.label ?? null,
        appType: body.appType ?? null,
        filedOn: dateOrNull(body.filedOn),
        status: body.status,
        orderOn: dateOrNull(body.orderOn),
        notes: body.notes ?? null,
        ...(body.visibleToPortal !== undefined ? { visibleToPortal: body.visibleToPortal } : {}),
      });
      if (!created) { res.status(404).json({ error: 'Case not found' }); return; }
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  },
);

casesRouter.patch(
  '/:id/applications/:appId',
  requireFeature('matter.create'),
  validate({ params: appParam, body: ApplicationPatchInput }),
  withAudit({ action: 'case.application.update', targetType: 'case' }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      if (!firmId) { res.status(422).json({ error: 'No firm attached' }); return; }
      const body = req.body as z.infer<typeof ApplicationPatchInput>;
      const patch: Parameters<typeof caseApplicationsService.update>[2] = {};
      if (body.kind !== undefined) patch.kind = body.kind;
      if (body.label !== undefined) patch.label = body.label;
      if (body.appType !== undefined) patch.appType = body.appType;
      if (body.filedOn !== undefined) patch.filedOn = dateOrNull(body.filedOn);
      if (body.status !== undefined) patch.status = body.status;
      if (body.orderOn !== undefined) patch.orderOn = dateOrNull(body.orderOn);
      if (body.notes !== undefined) patch.notes = body.notes;
      if (body.visibleToPortal !== undefined) patch.visibleToPortal = body.visibleToPortal;
      const updated = await caseApplicationsService.update(strParam(req.params['appId']), firmId, patch);
      if (!updated) { res.status(404).json({ error: 'Application not found' }); return; }
      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

casesRouter.delete(
  '/:id/applications/:appId',
  requireFeature('matter.create'),
  validate({ params: appParam }),
  withAudit({ action: 'case.application.delete', targetType: 'case' }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      if (!firmId) { res.status(422).json({ error: 'No firm attached' }); return; }
      const ok = await caseApplicationsService.remove(strParam(req.params['appId']), firmId);
      if (!ok) { res.status(404).json({ error: 'Application not found' }); return; }
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

casesRouter.post(
  '/',
  requireFeature('matter.create'),
  validate({ body: CaseInput }),
  withAudit({ action: 'case.create', targetType: 'case' }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      const created = await casesService.create(req.body, firmId);
      // Seed the matter's pipeline graph from its type template. Best-effort:
      // a failure here must not fail case creation — GET /:id lazily
      // instantiates the graph on first read as a safety net.
      if (firmId) {
        try {
          await instantiateGraph(created.id, firmId, created.type, created.stage);
        } catch {
          /* lazy fallback on read */
        }
      }
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  },
);

casesRouter.patch(
  '/:id',
  requireFeature('matter.create'),
  validate({ params: idParam, body: CaseInput.partial() }),
  withAudit({ action: 'case.update', targetType: 'case' }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      const updated = await casesService.update(strParam(req.params['id']), req.body, firmId);
      if (!updated) {
        res.status(404).json({ error: 'Case not found' });
        return;
      }
      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

// POST /cases/:id/sync-from-ecourts — pull live data from the eCourts gateway
// and fold it into this matter (and its hearings). The service layer handles
// the mapping; this route just validates input and forwards the result.
const SyncInput = z.object({
  side:          z.enum(['petitioner', 'respondent']).optional(),
  overwriteAll:  z.boolean().optional(),
  court:         z.enum(['DC', 'HC']).optional(),
}).default({});

casesRouter.post(
  '/:id/sync-from-ecourts',
  requireFeature('matter.create'),
  validate({ params: idParam, body: SyncInput }),
  withAudit({ action: 'case.sync_from_ecourts', targetType: 'case' }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      if (!firmId) {
        res.status(422).json({ error: 'No firm attached' });
        return;
      }
      const body = req.body as z.infer<typeof SyncInput>;
      const result = await syncCaseFromEcourts(strParam(req.params['id']), firmId, body);
      // The case row in `result.caseRow` is in DB shape — re-attach the
      // pipeline snapshot like /:id and /:id/transition do so the client can
      // render the stepper without a second round trip.
      const extras = await customStagesForFirm(firmId, kindForType(result.caseRow.type));
      res.json({
        ...result.caseRow,
        pipeline: snapshotFor(result.caseRow.type, result.caseRow.stage, extras),
        sync: {
          changes:           result.changes,
          hearingsReplaced:  result.hearingsReplaced,
          sideDetected:      result.side,
          surfaceOnly:       result.surfaceOnly,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

casesRouter.delete(
  '/:id',
  requireFeature('matter.create'),
  validate({ params: idParam }),
  withAudit({ action: 'case.delete', targetType: 'case' }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      const removed = await casesService.remove(strParam(req.params['id']), firmId);
      if (!removed) {
        res.status(404).json({ error: 'Case not found' });
        return;
      }
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);
