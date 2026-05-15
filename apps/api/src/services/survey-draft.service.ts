import { db } from '../db/client';

interface CreateMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

interface DraftPatch {
  answers?: Record<string, unknown>;
  otherTexts?: Record<string, unknown>;
  currentIndex?: number;
  completed?: boolean;
}

export const surveyDraftService = {
  async create(meta: CreateMeta): Promise<{ id: string }> {
    const sql = db();
    if (!sql) throw new Error('Database not configured');
    const rows = await sql<{ id: string }[]>`
      insert into survey_drafts (ip_address, user_agent)
      values (${meta.ipAddress}, ${meta.userAgent})
      returning id
    `;
    return rows[0]!;
  },

  /**
   * Overwrite the named fields on an existing draft. Each PUT from the
   * client is a full snapshot of {answers, otherTexts, currentIndex} -
   * we don't try to merge partial diffs because the client always sends
   * the complete blob and we'd rather have last-write-wins than risk
   * stale-merge bugs.
   *
   * Returns true if a row was updated. False indicates the draft id was
   * not found, which the caller should surface as 404.
   */
  async update(id: string, patch: DraftPatch): Promise<boolean> {
    const sql = db();
    if (!sql) throw new Error('Database not configured');

    // postgres-js sql.json() rejects Record<string, unknown> at the type
    // level (the lib expects a stricter JSONValue). Drafts store arbitrary
    // partial state, so we serialise upfront and inline-cast to ::jsonb at
    // the SQL boundary - same pattern as audit.service.ts.
    const answersJson    = patch.answers    != null ? JSON.stringify(patch.answers)    : null;
    const otherTextsJson = patch.otherTexts != null ? JSON.stringify(patch.otherTexts) : null;
    const currentIndex   = patch.currentIndex ?? null;
    const markComplete   = patch.completed === true;

    const rows = await sql<{ id: string }[]>`
      update survey_drafts set
        answers       = coalesce(${answersJson}::jsonb, answers),
        other_texts   = coalesce(${otherTextsJson}::jsonb, other_texts),
        current_index = coalesce(${currentIndex}::int, current_index),
        completed_at  = case when ${markComplete} then now() else completed_at end,
        updated_at    = now()
      where id::text = ${id}
      returning id
    `;
    return rows.length > 0;
  },
};
