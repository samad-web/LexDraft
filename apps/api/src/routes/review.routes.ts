/**
 * Contract-review routes — gated by `review.approve` (Practice + Firm tiers;
 * Solo gets `review.comment` only, which is read-only commentary on others'
 * reviews and not yet exposed).
 *
 *   POST   /api/review                          — run a fresh review
 *   GET    /api/review                          — list firm's reviews
 *   GET    /api/review/assignable-users         — directory for the picker
 *   GET    /api/review/:id                      — full review payload
 *   PATCH  /api/review/:id                      — assignee / decision update
 *   DELETE /api/review/:id                      — remove a review
 *   GET    /api/review/:id/comments             — list comments on a review
 *   POST   /api/review/:id/comments             — add a comment (or reply)
 *   PATCH  /api/review/:id/comments/:commentId  — edit (author only)
 *   DELETE /api/review/:id/comments/:commentId  — soft-delete (author only)
 *
 * The POST review handler is wrapped in `llmGenerationLimiter` (the same
 * per-user cap the drafting routes use) so a runaway script can't burn
 * through the LLM budget by re-submitting paste after paste. Comment
 * mutations don't hit an LLM — they're plain CRUD, so the global write
 * limiter is sufficient.
 */

import { Router } from 'express';
import { z } from 'zod';
import { reviewService } from '../services/review.service';
import { reviewCommentsService } from '../services/review-comments.service';
import { firmIdForUser } from '../services/tenant';
import { requireFeature } from '../services/permissions.service';
import { llmGenerationLimiter } from '../middleware/rateLimit';
import { UnauthorizedError } from '../lib/errors';
import { db } from '../db/client';

const PERSPECTIVE = z.enum([
  'Client', 'Vendor', 'Employer', 'Employee', 'Landlord', 'Tenant', 'Company',
]);

const Create = z.object({
  perspective: PERSPECTIVE,
  // Cap at ~200KB — the service truncates further to 120KB before the LLM
  // call. Anything above this is almost certainly a paste mishap.
  sourceText: z.string().min(50).max(200_000),
  title: z.string().max(200).optional(),
  sourceFilename: z.string().max(255).optional(),
  caseId: z.string().uuid().optional(),
  documentId: z.string().uuid().optional(),
  provider: z.enum(['xai', 'anthropic']).optional(),
});

const UpdateLifecycle = z.object({
  // null = unassign. omit = leave alone.
  assignedTo: z.string().uuid().nullable().optional(),
  decision: z.enum(['pending', 'changes_requested', 'approved']).nullable().optional(),
});

const CreateComment = z.object({
  body: z.string().min(1).max(4000),
  findingIndex: z.number().int().nonnegative().optional(),
  parentCommentId: z.string().uuid().optional(),
});

const UpdateComment = z.object({
  body: z.string().min(1).max(4000),
});

// Gate at `review.comment` (not `review.approve`) so every plan tier sees
// the feature. Solo's plan_features row only includes `review.comment`;
// `review.approve` is Practice+ only. Granting the entire review surface
// — including assign/decide/comment — under `review.comment` keeps the
// page visible to Solo users without inventing a third feature key.
const gate = requireFeature('review.comment');

export const reviewRouter: Router = Router();

// ---- Reviews -------------------------------------------------------------

reviewRouter.post('/', gate, llmGenerationLimiter, async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    const body = Create.parse(req.body);
    const created = await reviewService.create({
      firmId: firmId ?? '',
      createdBy: req.user?.id ?? null,
      perspective: body.perspective,
      sourceText: body.sourceText,
      ...(body.title ? { title: body.title } : {}),
      ...(body.sourceFilename ? { sourceFilename: body.sourceFilename } : {}),
      ...(body.caseId ? { caseId: body.caseId } : {}),
      ...(body.documentId ? { documentId: body.documentId } : {}),
      ...(body.provider ? { provider: body.provider } : {}),
    });
    // 201 even when status='failed' — the row exists, the UI renders the
    // failure inline. Only validation / auth problems surface as 4xx.
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

reviewRouter.get('/', gate, async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    const caseId = typeof req.query.caseId === 'string' ? req.query.caseId : undefined;
    res.json(await reviewService.list(firmId, caseId));
  } catch (err) {
    next(err);
  }
});

// "My queue" — reviews assigned to the caller. Defined BEFORE the
// `/:id` route so Express doesn't match `mine` as an id.
reviewRouter.get('/mine', gate, async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedError();
    const firmId = await firmIdForUser(userId);
    res.json(await reviewService.mine(userId, firmId));
  } catch (err) {
    next(err);
  }
});

// Lightweight directory for the assignee picker. Gated by `review.approve`
// so we don't broaden access beyond who can already see /app/review; only
// id/name/email are returned (no role, status, etc.) — that lives on the
// admin-only /firm/users surface.
reviewRouter.get('/assignable-users', gate, async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    if (!firmId) {
      res.json({ items: [] });
      return;
    }
    const sql = db();
    if (!sql) {
      // In-memory mode — no users table to enumerate. Return at least the
      // caller so the picker isn't empty in dev.
      res.json({
        items: req.user
          ? [{ id: req.user.id, name: req.user.email ?? '', email: req.user.email ?? '' }]
          : [],
      });
      return;
    }
    const rows = await sql<Array<{ id: string; name: string; email: string }>>`
      select id, name, email
      from users
      where firm_id = ${firmId}::uuid and (status is null or status = 'active')
      order by name asc
      limit 200
    `;
    res.json({ items: rows });
  } catch (err) {
    next(err);
  }
});

reviewRouter.get('/:id', gate, async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    res.json(await reviewService.get(String(req.params.id ?? ''), firmId));
  } catch (err) {
    next(err);
  }
});

reviewRouter.patch('/:id', gate, async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedError();
    const firmId = await firmIdForUser(userId);
    const body = UpdateLifecycle.parse(req.body);
    const updated = await reviewService.updateLifecycle(
      String(req.params.id ?? ''),
      firmId,
      body,
      userId,
    );
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

reviewRouter.delete('/:id', gate, async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    await reviewService.remove(String(req.params.id ?? ''), firmId);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ---- Comments ------------------------------------------------------------

reviewRouter.get('/:id/comments', gate, async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    const items = await reviewCommentsService.list(String(req.params.id ?? ''), firmId);
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

reviewRouter.post('/:id/comments', gate, async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedError();
    const firmId = await firmIdForUser(userId);
    if (!firmId) throw new UnauthorizedError('No firm attached');
    const body = CreateComment.parse(req.body);
    const created = await reviewCommentsService.create({
      reviewId: String(req.params.id ?? ''),
      firmId,
      authorId: userId,
      body: body.body,
      ...(body.findingIndex !== undefined ? { findingIndex: body.findingIndex } : {}),
      ...(body.parentCommentId ? { parentCommentId: body.parentCommentId } : {}),
    });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

reviewRouter.patch('/:id/comments/:commentId', gate, async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedError();
    const firmId = await firmIdForUser(userId);
    const body = UpdateComment.parse(req.body);
    const updated = await reviewCommentsService.update(
      String(req.params.commentId ?? ''),
      String(req.params.id ?? ''),
      firmId,
      userId,
      body,
    );
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

reviewRouter.delete('/:id/comments/:commentId', gate, async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedError();
    const firmId = await firmIdForUser(userId);
    const removed = await reviewCommentsService.remove(
      String(req.params.commentId ?? ''),
      String(req.params.id ?? ''),
      firmId,
      userId,
    );
    res.json(removed);
  } catch (err) {
    next(err);
  }
});
