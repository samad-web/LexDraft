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
import { sendUpcomingHearingReminders, syncCaseFromEcourts } from '../services/case-sync.service';
import { materializeCaseHearings } from '../services/hearings.service';
import {
  classifySyncError,
  linkByCaseNumber,
  linkByCnr,
  queueLink,
  recordSyncFailure,
  type EcourtsLinkStatus,
} from '../services/ecourts-link.service';
import { existingCnrs, importCnrs, MAX_IMPORT } from '../services/ecourts-import.service';
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
// PATCH /:id intentionally omits `stage` - direct writes to the legacy stage
// column bypass the per-case pipeline graph (case_pipeline_nodes) and the
// case_stage_events audit trail, leaving cases.stage and the pipeline
// stepper UI silently showing contradictory state. Stage changes must go
// through POST /:id/transition or POST /:id/pipeline/nodes/:nodeId/status,
// which keep both in sync (see case-pipeline.service.ts#setStatus). `.strict()`
// so a caller that still sends `stage` gets a clear 400 instead of having it
// silently stripped - zod's default behaviour for an unrecognised key.
const CaseUpdateInput = CaseInput.omit({ stage: true }).partial().strict(
  'Unrecognized key(s) in body - stage cannot be set via PATCH /cases/:id; use POST /cases/:id/transition instead.',
);
const CaseListQuery = z.object({
  type: z.string().optional(),
  q: z.string().optional(),
  ecourts: z.enum(['attention']).optional(),
});

export const casesRouter: Router = Router();

/**
 * A matter saved with a hearing date: show it on Hearings / Calendar now
 * (a hearing row for that date) and remind right away if it is within the
 * reminder window, instead of waiting for the 09:00 run. Never blocks or
 * fails the save.
 */
async function afterHearingDate(firmId: string | null, caseId: string): Promise<void> {
  if (!firmId) return;
  try {
    await materializeCaseHearings(firmId, caseId);
    await sendUpcomingHearingReminders({ caseId });
  } catch {
    /* the 09:00 run catches up */
  }
}

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
      ecourts: req.query['ecourts'] === 'attention' ? 'attention' : undefined,
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
      // Connect the matter to eCourts in the background - whether it came
      // from an eCourts search or was typed in by hand. Never blocks or
      // fails creation: if eCourts is down the link job retries, and the
      // 09:00 / 19:00 runs sweep up anything still pending.
      let ecourtsLinkStatus: EcourtsLinkStatus | null = null;
      if (firmId) {
        try {
          ecourtsLinkStatus = await queueLink(created.id, firmId);
        } catch {
          /* scheduled run will pick it up */
        }
      }
      if (created.next) void afterHearingDate(firmId, created.id);
      res.status(201).json({ ...created, ecourtsLinkStatus: ecourtsLinkStatus ?? 'unlinked' });
    } catch (err) {
      next(err);
    }
  },
);

// POST /cases/import/ecourts - My Cases import (the eCourts app's Import).
// `dryRun` answers which CNRs are new vs already in matters, for the preview.
const ImportInput = z.object({
  items: z.array(z.object({
    cnr: z.string().min(1).max(40),
    court: z.enum(['DC', 'HC']).optional(),
  })).min(1).max(MAX_IMPORT),
  dryRun: z.boolean().optional(),
});

casesRouter.post(
  '/import/ecourts',
  requireFeature('matter.create'),
  validate({ body: ImportInput }),
  withAudit({ action: 'case.create', targetType: 'case' }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      if (!firmId) {
        res.status(422).json({ error: 'No firm attached' });
        return;
      }
      const body = req.body as z.infer<typeof ImportInput>;
      if (body.dryRun) {
        const cnrs = body.items.map((i) => i.cnr.trim().toUpperCase());
        const have = await existingCnrs(firmId, cnrs);
        res.json({ existing: cnrs.filter((c) => have.has(c)) });
        return;
      }
      res.json(await importCnrs(firmId, body.items));
    } catch (err) {
      next(err);
    }
  },
);

casesRouter.patch(
  '/:id',
  requireFeature('matter.create'),
  validate({ params: idParam, body: CaseUpdateInput }),
  withAudit({ action: 'case.update', targetType: 'case' }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      const caseId = strParam(req.params['id']);
      // Edit forms usually resend every field, CNR included - only a CNR
      // that actually changed should reset the eCourts link and refetch.
      const before = req.body.cnr !== undefined ? await casesService.get(caseId, firmId) : undefined;
      const updated = await casesService.update(caseId, req.body, firmId);
      if (!updated) {
        res.status(404).json({ error: 'Case not found' });
        return;
      }
      if (req.body.next !== undefined) void afterHearingDate(firmId, caseId);
      const cnrChanged = before !== undefined
        && (before.cnr ?? '').trim().toUpperCase() !== (updated.cnr ?? '').trim().toUpperCase();
      if (cnrChanged && firmId) {
        try {
          const ecourtsLinkStatus = await queueLink(caseId, firmId);
          res.json({ ...updated, ecourtsLinkStatus: ecourtsLinkStatus ?? 'unlinked' });
          return;
        } catch {
          /* scheduled run will pick it up */
        }
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
      const caseId = strParam(req.params['id']);
      let result: Awaited<ReturnType<typeof syncCaseFromEcourts>>;
      try {
        result = await syncCaseFromEcourts(caseId, firmId, body);
      } catch (err) {
        const kind = classifySyncError(err);
        await recordSyncFailure(caseId, kind, err);
        if (kind !== 'upstream') throw err;
        // eCourts itself is down - a raw 502/504 with a crypto or timeout
        // message helps nobody. Say what's happening and what happens next.
        res.status(503).json({
          error: 'eCourts is not responding right now. Your matter still shows the last synced details, and it will be refreshed automatically at the next scheduled update (9 AM / 7 PM), or try Sync again in a few minutes.',
          code: 'ecourts_unavailable',
        });
        return;
      }
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
          actsReplaced:      result.actsReplaced,
          partiesReplaced:   result.partiesReplaced,
          sideDetected:      result.side,
          surfaceOnly:       result.surfaceOnly,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// POST /cases/:id/ecourts/link — connect a matter to eCourts after the fact.
// For manual matters saved without a CNR (TEMP-… placeholder) or with a
// wrong one. Either give the CNR directly, or the case type + registration
// number + year in a chosen court and let eCourts resolve the CNR. Several
// matches come back as `status: 'choose'` with candidates; resubmit with the
// picked candidate's CNR.
const CourtTier = z.enum(['DC', 'HC']);
const LinkInput = z.union([
  z.object({
    cnr: z.string().min(16).max(20),
    court: CourtTier.optional(),
  }).strict(),
  z.object({
    court: CourtTier.optional(),
    stateCode: z.number().int().positive(),
    distCode: z.number().int().positive(),
    courtCode: z.number().int().positive(),
    estCode: z.string().min(1),
    caseType: z.union([z.string().min(1), z.number().int()]),
    regNo: z.union([z.string().min(1), z.number().int()]),
    year: z.number().int().min(1950).max(2100),
  }).strict(),
]);

casesRouter.post(
  '/:id/ecourts/link',
  requireFeature('matter.create'),
  validate({ params: idParam, body: LinkInput }),
  withAudit({ action: 'case.sync_from_ecourts', targetType: 'case' }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      if (!firmId) {
        res.status(422).json({ error: 'No firm attached' });
        return;
      }
      const caseId = strParam(req.params['id']);
      const body = req.body as z.infer<typeof LinkInput>;
      const outcome = 'cnr' in body
        ? await linkByCnr(caseId, firmId, body.cnr, body.court)
        : await linkByCaseNumber(caseId, firmId, body);
      if (outcome.status === 'choose') {
        res.json({ status: 'choose', candidates: outcome.candidates });
        return;
      }
      const c = await casesService.get(caseId, firmId);
      res.json({
        status: outcome.status,
        cnr: outcome.cnr,
        ...(outcome.status === 'pending' ? { message: outcome.reason } : {}),
        case: c,
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
      // Soft-delete: the matter is hidden and recoverable for 30 days.
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

// Recently-deleted matters (soft-deleted, still within the 30-day window).
casesRouter.get(
  '/trash/list',
  requireFeature('matter.view'),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      res.json({ items: await casesService.listDeleted(firmId) });
    } catch (err) {
      next(err);
    }
  },
);

// Restore a soft-deleted matter (the 30-day undo).
casesRouter.post(
  '/:id/restore',
  requireFeature('matter.create'),
  validate({ params: idParam }),
  withAudit({ action: 'case.restore', targetType: 'case' }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      const restored = await casesService.restore(strParam(req.params['id']), firmId);
      if (!restored) {
        res.status(404).json({ error: 'Case not found or already restored' });
        return;
      }
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);
