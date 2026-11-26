// review-copy (build-docs/features/review-copy.md): pen marks + margin notes on a
// frozen PDF copy of a draft or case document. Firm members can view; only the
// author changes, exports or deletes. No model calls.
import { Router, type Response } from 'express';
import { z } from 'zod';
import { requireFeature } from '../services/permissions.service';
import { firmIdForUser } from '../services/tenant';
import { ImportError } from '../services/imported-documents.service';
import { MAX_SNAPSHOT_BYTES, reviewsService } from '../services/reviews.service';
import { nameOf } from '../services/presence.service';

export const reviewsRouter: Router = Router();

const FromDraft = z.object({
  draftId: z.string().uuid(),
  title: z.string().max(200).default(''),
  matter: z.string().max(300).default(''),
  pdfBase64: z.string().min(1).refine((b) => Buffer.byteLength(b, 'base64') <= MAX_SNAPSHOT_BYTES, { message: 'too_large' }),
});
const FromDocument = z.object({ documentId: z.string().uuid() });
const FromDocuments = z.object({ documentIds: z.array(z.string().uuid()).min(1).max(20) });
const Blank = z.object({ blank: z.literal(true), matter: z.string().max(300).default('') });
const SaveBody = z.object({ marks: z.unknown().optional(), notes: z.unknown().optional() });
const SendBody = z.object({
  userIds: z.array(z.string().uuid()).min(1).max(20),
  message: z.string().max(300).optional(),
  due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
const NoteWork = z.object({ done: z.boolean().optional(), reply: z.string().max(500).optional() });

async function namedCtx(req: { user?: { id: string } }) {
  const c = await ctxOf(req);
  return { ...c, name: await nameOf(c.userId) };
}

async function ctxOf(req: { user?: { id: string } }) {
  const userId = req.user!.id;
  return { userId, firmId: await firmIdForUser(userId) };
}

function fail(err: unknown, res: Response, next: (e: unknown) => void) {
  if (err instanceof ImportError) { res.status(err.status).json({ error: err.code }); return; }
  if (err instanceof z.ZodError) {
    const tooLarge = err.issues.some((i) => i.message === 'too_large');
    res.status(tooLarge ? 413 : 400).json({ error: tooLarge ? 'too_large' : 'validation' });
    return;
  }
  next(err);
}

reviewsRouter.post('/', requireFeature('drafting.basic'), async (req, res, next) => {
  try {
    const ctx = await ctxOf(req);
    const body = req.body as Record<string, unknown>;
    const b = body ?? {};
    const out = 'blank' in b ? await reviewsService.blank(Blank.parse(b).matter, ctx)
      : 'documentIds' in b ? await reviewsService.fromDocuments(FromDocuments.parse(b).documentIds, ctx)
      : 'documentId' in b ? await reviewsService.fromDocument(FromDocument.parse(b).documentId, ctx)
      : await reviewsService.fromDraft(FromDraft.parse(b), ctx);
    res.status(201).json(out);
  } catch (err) { fail(err, res, next); }
});

reviewsRouter.get('/', requireFeature('shared.documents'), async (req, res, next) => {
  try {
    const draftId = typeof req.query.draftId === 'string' ? req.query.draftId : undefined;
    res.json({ items: await reviewsService.list(draftId ? { draftId } : {}, await ctxOf(req)) });
  } catch (err) { fail(err, res, next); }
});

reviewsRouter.get('/:id', requireFeature('shared.documents'), async (req, res, next) => {
  try {
    res.json(await reviewsService.get(String(req.params.id), await ctxOf(req)));
  } catch (err) { fail(err, res, next); }
});

reviewsRouter.get('/:id/pdf', requireFeature('shared.documents'), async (req, res, next) => {
  try {
    const pdf = await reviewsService.snapshot(String(req.params.id), await ctxOf(req));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(pdf);
  } catch (err) { fail(err, res, next); }
});

reviewsRouter.put('/:id', requireFeature('drafting.basic'), async (req, res, next) => {
  try {
    res.json(await reviewsService.save(String(req.params.id), SaveBody.parse(req.body), await ctxOf(req)));
  } catch (err) { fail(err, res, next); }
});

reviewsRouter.post('/:id/export', requireFeature('drafting.basic'), async (req, res, next) => {
  try {
    res.json(await reviewsService.exportToDocuments(String(req.params.id), await ctxOf(req)));
  } catch (err) { fail(err, res, next); }
});

reviewsRouter.post('/:id/pages', requireFeature('drafting.basic'), async (req, res, next) => {
  try {
    res.json(await reviewsService.addPage(String(req.params.id), await ctxOf(req)));
  } catch (err) { fail(err, res, next); }
});

// team-docs: send to teammates (tasks + notifications); tick notes Done / reply.
reviewsRouter.post('/:id/send', requireFeature('drafting.basic'), async (req, res, next) => {
  try {
    res.json(await reviewsService.send(String(req.params.id), SendBody.parse(req.body), await namedCtx(req)));
  } catch (err) { fail(err, res, next); }
});

reviewsRouter.post('/:id/notes/:noteId', requireFeature('shared.documents'), async (req, res, next) => {
  try {
    res.json(await reviewsService.workOnNote(String(req.params.id), String(req.params.noteId).slice(0, 40), NoteWork.parse(req.body), await namedCtx(req)));
  } catch (err) { fail(err, res, next); }
});

reviewsRouter.delete('/:id', requireFeature('drafting.basic'), async (req, res, next) => {
  try {
    await reviewsService.remove(String(req.params.id), await ctxOf(req));
    res.status(204).end();
  } catch (err) { fail(err, res, next); }
});
