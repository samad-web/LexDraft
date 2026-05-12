/**
 * Internal error tracking — Postgres-backed alternative to Sentry/OTel.
 *
 * The error middleware fires `capture(...)` for every 5xx and a curated subset
 * of 4xx (403/422/429 — security signal). Inserts are best-effort: a failed
 * write logs a warning and resolves; it never throws, never blocks the
 * response. That's load-bearing — the whole point of this module is to be a
 * safety net, so it cannot become a new failure mode for the surface it
 * observes.
 *
 * The SuperAdmin viewer reads rows back via `list`/`get`/`stats` and lets an
 * operator mark them resolved with an optional note. There is no automated
 * retention sweep yet; the table can grow unbounded and is expected to be
 * pruned manually or via a follow-up job.
 */
import { db } from '../db/client';
import { logger } from '../logger';

/** Hard cap on the persisted stack trace. 4 KB is plenty for a useful trace
 *  while keeping JSONB pages from bloating on a buggy day. */
const STACK_MAX = 4096;
/** Hard cap on a single string value inside the context payload — protects
 *  against an over-eager handler stuffing a megabyte of HTML in. */
const CONTEXT_STRING_MAX = 4096;
/** Maximum nesting depth we'll walk when scrubbing — anything deeper is
 *  dropped. Defends against pathological cyclic structures. */
const CONTEXT_MAX_DEPTH = 6;

/** Field names whose VALUE is replaced with `[REDACTED]` before persisting.
 *  Mirrors the pino redact list in `../logger.ts` (kept in sync by hand;
 *  importing the constant would create a circular initialisation order
 *  because logger.ts uses env.LOG_LEVEL at module load). If you add a
 *  credential-shaped field there, mirror it here too. */
const REDACT_KEYS = new Set<string>([
  'password',
  'currentpassword',
  'newpassword',
  'confirmpassword',
  'token',
  'refreshtoken',
  'apikey',
  'api_key',
  'secret',
  'authorization',
  'cookie',
  'otp',
  'totp',
  'totpsecret',
  'mfasecret',
  'jwt_secret',
  'anthropic_api_key',
  'xai_api_key',
  'database_url',
  'storage_signing_secret',
  'x-api-key',
  'x-auth-token',
  'x-anthropic-api-key',
]);

/** Recursively scrub credential-shaped fields and clamp string lengths.
 *  Pure — does not mutate the input. Returns `null` for input we couldn't
 *  serialise (cycles, non-JSON-safe values). */
function scrubContext(input: unknown, depth = 0): unknown {
  if (input == null) return input;
  if (depth > CONTEXT_MAX_DEPTH) return '[truncated:depth]';
  if (typeof input === 'string') {
    return input.length > CONTEXT_STRING_MAX ? `${input.slice(0, CONTEXT_STRING_MAX)}…` : input;
  }
  if (typeof input === 'number' || typeof input === 'boolean') return input;
  if (Array.isArray(input)) return input.map((v) => scrubContext(v, depth + 1));
  if (typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (REDACT_KEYS.has(k.toLowerCase())) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = scrubContext(v, depth + 1);
      }
    }
    return out;
  }
  // Functions, symbols, bigints, etc. — anything not JSON-safe — get dropped.
  return undefined;
}

function truncateStack(stack: string | undefined): string | null {
  if (!stack) return null;
  return stack.length > STACK_MAX ? `${stack.slice(0, STACK_MAX)}…[truncated]` : stack;
}

// ---------- public types ----------------------------------------------------

export interface CaptureInput {
  requestId?: string | null;
  userId?: string | null;
  firmId?: string | null;
  method: string;
  path: string;
  status: number;
  error: unknown;
  userAgent?: string | null;
  ip?: string | null;
  context?: unknown;
}

export interface ErrorLogListItem {
  id: string;
  occurredAt: string;
  requestId: string | null;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  firmId: string | null;
  firmName: string | null;
  method: string;
  path: string;
  status: number;
  errorName: string;
  errorMessage: string;
  userAgent: string | null;
  ip: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
}

export interface ErrorLogDetail extends ErrorLogListItem {
  errorStack: string | null;
  context: unknown;
}

export interface ListQuery {
  since?: string;
  until?: string;
  status?: number;
  userId?: string;
  firmId?: string;
  resolved?: boolean;
  limit?: number;
  offset?: number;
}

export interface StatsQuery {
  since?: string;
  until?: string;
}

export interface ErrorLogStats {
  totalCount: number;
  unresolvedCount: number;
  byStatus: Record<string, number>;
  byPath: Array<{ path: string; count: number }>;
  byErrorName: Array<{ name: string; count: number }>;
}

// ---------- row → DTO -------------------------------------------------------

interface ListRow {
  id: string;
  occurred_at: Date;
  request_id: string | null;
  user_id: string | null;
  user_name: string | null;
  user_email: string | null;
  firm_id: string | null;
  firm_name: string | null;
  method: string;
  path: string;
  status: number;
  error_name: string;
  error_message: string;
  user_agent: string | null;
  ip: string | null;
  resolved_at: Date | null;
  resolved_by: string | null;
  resolution_note: string | null;
}

interface DetailRow extends ListRow {
  error_stack: string | null;
  context: Record<string, unknown> | string | null;
}

function listRowToItem(r: ListRow): ErrorLogListItem {
  return {
    id: r.id,
    occurredAt: r.occurred_at.toISOString(),
    requestId: r.request_id,
    userId: r.user_id,
    userName: r.user_name,
    userEmail: r.user_email,
    firmId: r.firm_id,
    firmName: r.firm_name,
    method: r.method,
    path: r.path,
    status: r.status,
    errorName: r.error_name,
    errorMessage: r.error_message,
    userAgent: r.user_agent,
    ip: r.ip,
    resolvedAt: r.resolved_at ? r.resolved_at.toISOString() : null,
    resolvedBy: r.resolved_by,
    resolutionNote: r.resolution_note,
  };
}

function parseContext(raw: DetailRow['context']): unknown {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as unknown; }
    catch { return null; }
  }
  return raw;
}

function detailRowToDetail(r: DetailRow): ErrorLogDetail {
  return {
    ...listRowToItem(r),
    errorStack: r.error_stack,
    context: parseContext(r.context),
  };
}

// ---------- service ---------------------------------------------------------

/** Names of common error subclasses we want surfaced verbatim in the table.
 *  Anything else falls back to `Error`. */
function errorNameOf(err: unknown): string {
  if (err instanceof Error) return err.name || 'Error';
  if (err && typeof err === 'object' && 'name' in err && typeof (err as { name: unknown }).name === 'string') {
    return (err as { name: string }).name;
  }
  return typeof err === 'string' ? 'StringThrown' : 'UnknownError';
}

function errorMessageOf(err: unknown): string {
  if (err instanceof Error) return err.message || '(no message)';
  if (typeof err === 'string') return err;
  try { return JSON.stringify(err); } catch { return String(err); }
}

function errorStackOf(err: unknown): string | undefined {
  if (err instanceof Error && typeof err.stack === 'string') return err.stack;
  return undefined;
}

export const errorLogService = {
  /**
   * Persist an error row. Fire-and-forget: returns a promise that resolves
   * to void EITHER on successful insert OR on a logged failure — it never
   * rejects. Callers may `void errorLogService.capture(...)` without a
   * try/catch around it.
   */
  async capture(input: CaptureInput): Promise<void> {
    try {
      const sql = db();
      if (!sql) {
        // No DB configured — silently drop. This matches the audit log's
        // behaviour in dev when DATABASE_URL is blank. Logging here would
        // produce one warning per request, which is noise.
        return;
      }
      const stack = truncateStack(errorStackOf(input.error));
      const scrubbed = scrubContext(input.context);
      const contextJson = scrubbed == null ? null : JSON.stringify(scrubbed);
      await sql`
        insert into error_log (
          request_id, user_id, firm_id, method, path, status,
          error_name, error_message, error_stack, user_agent, ip, context
        ) values (
          ${input.requestId ?? null},
          ${input.userId ?? null}::uuid,
          ${input.firmId ?? null}::uuid,
          ${input.method},
          ${input.path},
          ${input.status},
          ${errorNameOf(input.error)},
          ${errorMessageOf(input.error)},
          ${stack},
          ${input.userAgent ?? null},
          ${input.ip ?? null},
          ${contextJson}::jsonb
        )
      `;
    } catch (err) {
      // A failing error logger must not crash the request. Log at warn so
      // operators can spot it without being woken by it.
      logger.warn(
        { err, requestId: input.requestId, status: input.status, path: input.path },
        'error_log capture failed',
      );
    }
  },

  async list(query: ListQuery = {}): Promise<{ items: ErrorLogListItem[]; total: number }> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 500);
    const offset = Math.max(query.offset ?? 0, 0);
    const sql = db();
    if (!sql) return { items: [], total: 0 };

    // Resolved filter: undefined = all, true = resolved only, false = unresolved only.
    const resolvedFilter: 'all' | 'yes' | 'no' =
      query.resolved === undefined ? 'all' : query.resolved ? 'yes' : 'no';

    const rows = await sql<ListRow[]>`
      select e.id,
             e.occurred_at,
             e.request_id,
             e.user_id,
             u.name  as user_name,
             u.email as user_email,
             e.firm_id,
             f.name  as firm_name,
             e.method,
             e.path,
             e.status,
             e.error_name,
             e.error_message,
             e.user_agent,
             e.ip,
             e.resolved_at,
             e.resolved_by,
             e.resolution_note
      from error_log e
      left join users u on u.id = e.user_id
      left join firms f on f.id = e.firm_id
      where (${query.since ?? null}::timestamptz is null or e.occurred_at >= ${query.since ?? null}::timestamptz)
        and (${query.until ?? null}::timestamptz is null or e.occurred_at <= ${query.until ?? null}::timestamptz)
        and (${query.status ?? null}::int        is null or e.status = ${query.status ?? null}::int)
        and (${query.userId ?? null}::uuid       is null or e.user_id = ${query.userId ?? null}::uuid)
        and (${query.firmId ?? null}::uuid       is null or e.firm_id = ${query.firmId ?? null}::uuid)
        and (${resolvedFilter} = 'all'
             or (${resolvedFilter} = 'yes' and e.resolved_at is not null)
             or (${resolvedFilter} = 'no'  and e.resolved_at is null))
      order by e.occurred_at desc
      limit ${limit} offset ${offset}
    `;

    const totalRows = await sql<Array<{ c: number }>>`
      select count(*)::int as c
      from error_log e
      where (${query.since ?? null}::timestamptz is null or e.occurred_at >= ${query.since ?? null}::timestamptz)
        and (${query.until ?? null}::timestamptz is null or e.occurred_at <= ${query.until ?? null}::timestamptz)
        and (${query.status ?? null}::int        is null or e.status = ${query.status ?? null}::int)
        and (${query.userId ?? null}::uuid       is null or e.user_id = ${query.userId ?? null}::uuid)
        and (${query.firmId ?? null}::uuid       is null or e.firm_id = ${query.firmId ?? null}::uuid)
        and (${resolvedFilter} = 'all'
             or (${resolvedFilter} = 'yes' and e.resolved_at is not null)
             or (${resolvedFilter} = 'no'  and e.resolved_at is null))
    `;

    return {
      items: rows.map(listRowToItem),
      total: totalRows[0]?.c ?? 0,
    };
  },

  async get(id: string): Promise<ErrorLogDetail | null> {
    const sql = db();
    if (!sql) return null;
    const rows = await sql<DetailRow[]>`
      select e.id,
             e.occurred_at,
             e.request_id,
             e.user_id,
             u.name  as user_name,
             u.email as user_email,
             e.firm_id,
             f.name  as firm_name,
             e.method,
             e.path,
             e.status,
             e.error_name,
             e.error_message,
             e.error_stack,
             e.user_agent,
             e.ip,
             e.context,
             e.resolved_at,
             e.resolved_by,
             e.resolution_note
      from error_log e
      left join users u on u.id = e.user_id
      left join firms f on f.id = e.firm_id
      where e.id = ${id}::uuid
      limit 1
    `;
    const row = rows[0];
    return row ? detailRowToDetail(row) : null;
  },

  async resolve(id: string, resolvedBy: string, note?: string): Promise<void> {
    const sql = db();
    if (!sql) return;
    await sql`
      update error_log
      set resolved_at     = now(),
          resolved_by     = ${resolvedBy}::uuid,
          resolution_note = ${note ?? null}
      where id = ${id}::uuid
    `;
  },

  async unresolve(id: string): Promise<void> {
    const sql = db();
    if (!sql) return;
    await sql`
      update error_log
      set resolved_at     = null,
          resolved_by     = null,
          resolution_note = null
      where id = ${id}::uuid
    `;
  },

  async stats(query: StatsQuery = {}): Promise<ErrorLogStats> {
    const sql = db();
    if (!sql) {
      return { totalCount: 0, unresolvedCount: 0, byStatus: {}, byPath: [], byErrorName: [] };
    }
    // One round-trip per axis is fine — these are aggregates over the
    // window the operator chose, expected to be < a few weeks in practice.
    const totals = await sql<Array<{ total: number; unresolved: number }>>`
      select count(*)::int as total,
             count(*) filter (where resolved_at is null)::int as unresolved
      from error_log
      where (${query.since ?? null}::timestamptz is null or occurred_at >= ${query.since ?? null}::timestamptz)
        and (${query.until ?? null}::timestamptz is null or occurred_at <= ${query.until ?? null}::timestamptz)
    `;
    const byStatusRows = await sql<Array<{ status: number; c: number }>>`
      select status, count(*)::int as c
      from error_log
      where (${query.since ?? null}::timestamptz is null or occurred_at >= ${query.since ?? null}::timestamptz)
        and (${query.until ?? null}::timestamptz is null or occurred_at <= ${query.until ?? null}::timestamptz)
      group by status
      order by c desc
    `;
    const byPathRows = await sql<Array<{ path: string; c: number }>>`
      select path, count(*)::int as c
      from error_log
      where (${query.since ?? null}::timestamptz is null or occurred_at >= ${query.since ?? null}::timestamptz)
        and (${query.until ?? null}::timestamptz is null or occurred_at <= ${query.until ?? null}::timestamptz)
      group by path
      order by c desc
      limit 10
    `;
    const byErrorRows = await sql<Array<{ error_name: string; c: number }>>`
      select error_name, count(*)::int as c
      from error_log
      where (${query.since ?? null}::timestamptz is null or occurred_at >= ${query.since ?? null}::timestamptz)
        and (${query.until ?? null}::timestamptz is null or occurred_at <= ${query.until ?? null}::timestamptz)
      group by error_name
      order by c desc
      limit 10
    `;

    const byStatus: Record<string, number> = {};
    for (const row of byStatusRows) byStatus[String(row.status)] = row.c;

    return {
      totalCount: totals[0]?.total ?? 0,
      unresolvedCount: totals[0]?.unresolved ?? 0,
      byStatus,
      byPath: byPathRows.map((r) => ({ path: r.path, count: r.c })),
      byErrorName: byErrorRows.map((r) => ({ name: r.error_name, count: r.c })),
    };
  },
};
