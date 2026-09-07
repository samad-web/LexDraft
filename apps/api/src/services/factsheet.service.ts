// =============================================================================
// factsheet.service — the versioned Matter Fact Sheet on the Node side.
//
// Mirrors the Python engine's MatterFactSheet contract EXACTLY, because the
// engine keys document sign-off on (matter_id, version) and treats a sign-off
// against a superseded version as stale (the banner returns). For that to hold:
//
//   * create()    -> version 1 for a new matter_id.
//   * revise()    -> a NEW row at version N+1. NEVER an in-place update. The
//                    prior version is left untouched and remains readable.
//   * getCurrent()-> the highest version = "the facts now". This is the version
//                    that MUST be sent on every /v1/draft and /v1/sign-off call.
//
// Contrast drafts.service.update(), which mutates a row in place — correct there
// (a draft is a working document), fatal here (it would leave a signed document
// signed after the facts moved). There is deliberately no update path.
// =============================================================================

import { randomUUID } from 'node:crypto';
import { db } from '../db/client';
import { logger } from '../logger';

export interface FactSheet {
  /** The matter identity — stable across every version (the engine's matter_id). */
  matterId: string;
  /** Monotonic per-matter version (starts at 1). */
  version: number;
  firmId: string | null;
  createdBy: string;
  facts: Record<string, unknown>;
  createdAt: string;
}

interface Row {
  matter_id: string;
  version: number;
  firm_id: string | null;
  created_by: string;
  facts_json: Record<string, unknown> | string;
  created_at: string | Date;
}

function fromRow(r: Row): FactSheet {
  const facts =
    typeof r.facts_json === 'string'
      ? (JSON.parse(r.facts_json) as Record<string, unknown>)
      : (r.facts_json ?? {});
  return {
    matterId: r.matter_id,
    version: r.version,
    firmId: r.firm_id,
    createdBy: r.created_by,
    facts,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
  };
}

// In-memory fallback (dev without Postgres). An append-only list per matter,
// enforcing the same immutability + monotonicity as the table.
const mem = new Map<string, FactSheet[]>();

export class FactSheetConflictError extends Error {
  constructor(matterId: string, version: number) {
    super(`fact sheet version ${version} already exists for matter ${matterId}`);
    this.name = 'FactSheetConflictError';
  }
}

export interface Ctx {
  firmId: string | null;
  userId: string;
}

export const factSheetService = {
  /** First version of a NEW matter. Returns version 1. */
  async create(facts: Record<string, unknown>, ctx: Ctx): Promise<FactSheet> {
    const matterId = randomUUID();
    const sql = db();
    if (!sql) {
      const sheet: FactSheet = {
        matterId,
        version: 1,
        firmId: ctx.firmId,
        createdBy: ctx.userId,
        facts,
        createdAt: new Date().toISOString(),
      };
      mem.set(matterId, [sheet]);
      return sheet;
    }
    const rows = await sql<Row[]>`
      insert into fact_sheets (matter_id, version, firm_id, created_by, facts_json)
      values (${matterId}, 1, ${ctx.firmId}, ${ctx.userId}, ${sql.json(facts as Record<string, never>)})
      returning matter_id, version, firm_id, created_by, facts_json, created_at
    `;
    return fromRow(rows[0]!);
  },

  /**
   * Produce the NEXT version of an existing matter. Inserts a new row at
   * max(version)+1; never mutates. On a race (two revises computing the same
   * next version) the unique (matter_id, version) constraint rejects the loser;
   * we retry against the new max a few times before surfacing a conflict.
   */
  async revise(
    matterId: string,
    facts: Record<string, unknown>,
    ctx: Ctx,
  ): Promise<FactSheet> {
    const sql = db();
    if (!sql) {
      const chain = mem.get(matterId);
      if (!chain || chain.length === 0) {
        throw new Error(`no fact sheet for matter ${matterId}`);
      }
      const next: FactSheet = {
        matterId,
        version: chain[chain.length - 1]!.version + 1,
        firmId: ctx.firmId,
        createdBy: ctx.userId,
        facts,
        createdAt: new Date().toISOString(),
      };
      chain.push(next); // append-only; prior versions untouched
      return next;
    }

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const cur = await this.getCurrent(matterId);
      if (!cur) throw new Error(`no fact sheet for matter ${matterId}`);
      const nextVersion = cur.version + 1;
      try {
        const rows = await sql<Row[]>`
          insert into fact_sheets (matter_id, version, firm_id, created_by, facts_json)
          values (${matterId}, ${nextVersion}, ${ctx.firmId}, ${ctx.userId}, ${sql.json(facts as Record<string, never>)})
          returning matter_id, version, firm_id, created_by, facts_json, created_at
        `;
        return fromRow(rows[0]!);
      } catch (err: unknown) {
        // 23505 = unique_violation: someone else took nextVersion. Recompute.
        if (isUniqueViolation(err) && attempt < 3) {
          logger.warn({ matterId, nextVersion }, 'fact-sheet revise raced; retrying');
          continue;
        }
        throw new FactSheetConflictError(matterId, nextVersion);
      }
    }
    throw new FactSheetConflictError(matterId, -1);
  },

  /** The current (highest) version — "the facts now". */
  async getCurrent(matterId: string): Promise<FactSheet | null> {
    const sql = db();
    if (!sql) {
      const chain = mem.get(matterId);
      return chain && chain.length ? chain[chain.length - 1]! : null;
    }
    const rows = await sql<Row[]>`
      select matter_id, version, firm_id, created_by, facts_json, created_at
      from fact_sheets
      where matter_id = ${matterId}
      order by version desc
      limit 1
    `;
    return rows[0] ? fromRow(rows[0]) : null;
  },

  /** A specific version (for audit / debugging; the engine never needs it). */
  async getVersion(matterId: string, version: number): Promise<FactSheet | null> {
    const sql = db();
    if (!sql) {
      const chain = mem.get(matterId);
      return chain?.find((s) => s.version === version) ?? null;
    }
    const rows = await sql<Row[]>`
      select matter_id, version, firm_id, created_by, facts_json, created_at
      from fact_sheets
      where matter_id = ${matterId} and version = ${version}
      limit 1
    `;
    return rows[0] ? fromRow(rows[0]) : null;
  },

  /** All versions oldest-first (history walk). */
  async history(matterId: string): Promise<FactSheet[]> {
    const sql = db();
    if (!sql) return [...(mem.get(matterId) ?? [])];
    const rows = await sql<Row[]>`
      select matter_id, version, firm_id, created_by, facts_json, created_at
      from fact_sheets
      where matter_id = ${matterId}
      order by version asc
    `;
    return rows.map(fromRow);
  },

  /** Test-only: clear the in-memory store. */
  _resetMemory(): void {
    mem.clear();
  },
};

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === '23505'
  );
}
