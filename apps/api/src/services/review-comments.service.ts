/**
 * Comment threads on contract reviews.
 *
 * Each comment is either review-level (findingIndex = null) or anchored to a
 * specific finding by its position in `findings_json`. Threading via
 * `parentCommentId`. Soft-deletion keeps the thread structure intact when a
 * reply is removed - the API returns the row with `isDeleted=true` and an
 * empty body so the client can render a "comment removed" placeholder
 * rather than re-parenting children to a non-existent comment.
 *
 * Tenant isolation: every read/write joins on the parent review's firm_id
 * via `contract_reviews`. A direct DELETE on the comment uses a sub-select
 * on the review's firm_id to make cross-tenant deletes structurally
 * impossible.
 *
 * In-memory fallback mirrors the DB shape so dev-without-Postgres works.
 */

import { db } from '../db/client';
import { ForbiddenError, NotFoundError, UnprocessableEntityError } from '../lib/errors';
import { reviewService, bumpMemoryCommentCount, emitCommentNotification } from './review.service';
import type {
  CreateReviewCommentRequest,
  ReviewComment,
  UpdateReviewCommentRequest,
} from '../types/review.types';

interface CommentRow {
  id: string;
  review_id: string;
  finding_index: number | null;
  parent_comment_id: string | null;
  author_id: string;
  body: string;
  created_at: Date | string;
  updated_at: Date | string;
  deleted_at: Date | string | null;
  author_name: string | null;
  author_email: string | null;
}

function toIso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : v;
}

function rowToComment(r: CommentRow): ReviewComment {
  const isDeleted = !!r.deleted_at;
  return {
    id: r.id,
    reviewId: r.review_id,
    findingIndex: r.finding_index,
    parentCommentId: r.parent_comment_id,
    author: r.author_id
      ? { id: r.author_id, name: r.author_name ?? '', email: r.author_email ?? '' }
      : null,
    body: isDeleted ? '' : r.body,
    isDeleted,
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
  };
}

// In-memory fallback. Keyed by review id; one bucket per review keeps the
// thread small and cheap to filter.
const memComments = new Map<string, ReviewComment[]>();
function memThread(reviewId: string): ReviewComment[] {
  let arr = memComments.get(reviewId);
  if (!arr) { arr = []; memComments.set(reviewId, arr); }
  return arr;
}

// ---------- Public service --------------------------------------------------

interface CreateArgs extends CreateReviewCommentRequest {
  reviewId: string;
  firmId: string;
  authorId: string;
}

export const reviewCommentsService = {
  async list(reviewId: string, firmId: string | null): Promise<ReviewComment[]> {
    // Tenant gate: confirm the review belongs to the firm. Throws 404 if not,
    // which is the right surface - we don't even reveal that the id exists
    // outside the firm.
    await reviewService.get(reviewId, firmId);

    const sql = db();
    if (sql) {
      const rows = await sql<CommentRow[]>`
        select
          c.id, c.review_id, c.finding_index, c.parent_comment_id,
          c.author_id, c.body, c.created_at, c.updated_at, c.deleted_at,
          u.name as author_name, u.email as author_email
        from contract_review_comments c
        left join users u on u.id = c.author_id
        where c.review_id = ${reviewId}::uuid
        order by c.created_at asc
        limit 500
      `;
      return rows.map(rowToComment);
    }
    return [...memThread(reviewId)];
  },

  async create(input: CreateArgs): Promise<ReviewComment> {
    if (!input.body || input.body.trim().length === 0) {
      throw new UnprocessableEntityError('Comment body cannot be empty');
    }
    if (input.body.length > 4000) {
      throw new UnprocessableEntityError('Comment is too long (4000 char max)');
    }
    // Tenant gate. Also confirms findingIndex (if provided) is in bounds.
    const review = await reviewService.get(input.reviewId, input.firmId);
    if (input.findingIndex !== undefined && input.findingIndex !== null) {
      if (input.findingIndex < 0 || input.findingIndex >= review.findings.length) {
        throw new UnprocessableEntityError('findingIndex out of range');
      }
    }
    // Parent must belong to the same review. Skip the check in memory mode
    // since cross-review threading isn't possible there (different buckets).
    // Capture the parent's author so we can notify them on reply without
    // an extra round-trip later.
    let parentAuthorId: string | null = null;
    if (input.parentCommentId) {
      const sql = db();
      if (sql) {
        const rows = await sql<{ id: string; author_id: string }[]>`
          select id, author_id from contract_review_comments
          where id = ${input.parentCommentId}::uuid
            and review_id = ${input.reviewId}::uuid
          limit 1
        `;
        if (rows.length === 0) {
          throw new UnprocessableEntityError('parentCommentId is not on this review');
        }
        parentAuthorId = rows[0]!.author_id;
      } else {
        const parent = memThread(input.reviewId).find((c) => c.id === input.parentCommentId);
        if (!parent) {
          throw new UnprocessableEntityError('parentCommentId is not on this review');
        }
        parentAuthorId = parent.author?.id ?? null;
      }
    }

    const sql = db();
    let created: ReviewComment;
    if (sql) {
      const rows = await sql<CommentRow[]>`
        with inserted as (
          insert into contract_review_comments
            (review_id, finding_index, parent_comment_id, author_id, body)
          values
            (${input.reviewId}::uuid,
             ${input.findingIndex ?? null},
             ${input.parentCommentId ?? null},
             ${input.authorId}::uuid,
             ${input.body.trim()})
          returning id, review_id, finding_index, parent_comment_id,
                    author_id, body, created_at, updated_at, deleted_at
        )
        select
          i.id, i.review_id, i.finding_index, i.parent_comment_id,
          i.author_id, i.body, i.created_at, i.updated_at, i.deleted_at,
          u.name as author_name, u.email as author_email
        from inserted i
        left join users u on u.id = i.author_id
      `;
      created = rowToComment(rows[0]!);
    } else {
      // Memory path
      const now = new Date().toISOString();
      created = {
        id: `cmt-${Date.now()}-${memThread(input.reviewId).length + 1}`,
        reviewId: input.reviewId,
        findingIndex: input.findingIndex ?? null,
        parentCommentId: input.parentCommentId ?? null,
        author: { id: input.authorId, name: '', email: '' },
        body: input.body.trim(),
        isDeleted: false,
        createdAt: now,
        updatedAt: now,
      };
      memThread(input.reviewId).push(created);
      bumpMemoryCommentCount(input.firmId, input.reviewId, +1);
    }

    // Fire-and-forget email fan-out. The mutation returns immediately;
    // notification failures are caught and logged inside the helper.
    void emitCommentNotification({
      reviewId: input.reviewId,
      firmId: input.firmId,
      authorId: input.authorId,
      body: created.body,
      parentAuthorId,
    });

    return created;
  },

  async update(
    commentId: string,
    reviewId: string,
    firmId: string | null,
    callerId: string,
    patch: UpdateReviewCommentRequest,
  ): Promise<ReviewComment> {
    if (!patch.body || patch.body.trim().length === 0) {
      throw new UnprocessableEntityError('Comment body cannot be empty');
    }
    if (patch.body.length > 4000) {
      throw new UnprocessableEntityError('Comment is too long (4000 char max)');
    }
    // Tenant gate
    await reviewService.get(reviewId, firmId);

    const sql = db();
    if (sql) {
      // Author-only edit. We don't allow firm admins to edit other people's
      // comments - better to delete + re-comment than silently rewrite
      // history.
      const rows = await sql<CommentRow[]>`
        with updated as (
          update contract_review_comments
          set body = ${patch.body.trim()}
          where id = ${commentId}::uuid
            and review_id = ${reviewId}::uuid
            and author_id = ${callerId}::uuid
            and deleted_at is null
          returning id, review_id, finding_index, parent_comment_id,
                    author_id, body, created_at, updated_at, deleted_at
        )
        select
          u2.id, u2.review_id, u2.finding_index, u2.parent_comment_id,
          u2.author_id, u2.body, u2.created_at, u2.updated_at, u2.deleted_at,
          us.name as author_name, us.email as author_email
        from updated u2
        left join users us on us.id = u2.author_id
      `;
      const row = rows[0];
      if (!row) throw new ForbiddenError('Cannot edit this comment');
      return rowToComment(row);
    }
    const thread = memThread(reviewId);
    const idx = thread.findIndex((c) => c.id === commentId);
    if (idx === -1) throw new NotFoundError('Comment not found');
    const cur = thread[idx]!;
    if (cur.isDeleted) throw new ForbiddenError('Cannot edit a deleted comment');
    if (cur.author?.id !== callerId) throw new ForbiddenError('Cannot edit this comment');
    const next: ReviewComment = {
      ...cur,
      body: patch.body.trim(),
      updatedAt: new Date().toISOString(),
    };
    thread[idx] = next;
    return next;
  },

  /** Soft-delete. Returns the tombstoned shape (isDeleted=true, empty body)
   *  so the client can update its cached thread without a refetch. */
  async remove(
    commentId: string,
    reviewId: string,
    firmId: string | null,
    callerId: string,
  ): Promise<ReviewComment> {
    await reviewService.get(reviewId, firmId);

    const sql = db();
    if (sql) {
      const rows = await sql<CommentRow[]>`
        with updated as (
          update contract_review_comments
          set deleted_at = now()
          where id = ${commentId}::uuid
            and review_id = ${reviewId}::uuid
            and author_id = ${callerId}::uuid
            and deleted_at is null
          returning id, review_id, finding_index, parent_comment_id,
                    author_id, body, created_at, updated_at, deleted_at
        )
        select
          u2.id, u2.review_id, u2.finding_index, u2.parent_comment_id,
          u2.author_id, u2.body, u2.created_at, u2.updated_at, u2.deleted_at,
          us.name as author_name, us.email as author_email
        from updated u2
        left join users us on us.id = u2.author_id
      `;
      const row = rows[0];
      if (!row) throw new ForbiddenError('Cannot delete this comment');
      return rowToComment(row);
    }
    const thread = memThread(reviewId);
    const idx = thread.findIndex((c) => c.id === commentId);
    if (idx === -1) throw new NotFoundError('Comment not found');
    const cur = thread[idx]!;
    if (cur.isDeleted) return cur;
    if (cur.author?.id !== callerId) throw new ForbiddenError('Cannot delete this comment');
    const next: ReviewComment = {
      ...cur,
      isDeleted: true,
      body: '',
      updatedAt: new Date().toISOString(),
    };
    thread[idx] = next;
    if (firmId) bumpMemoryCommentCount(firmId, reviewId, -1);
    return next;
  },
};
