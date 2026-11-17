/**
 * AI pause switch (build-docs/features/admin-ai-spend-guard.md).
 *
 * Two levels, both set by the superadmin:
 *   - platform: platform_settings 'ai_paused' = true stops every AI call;
 *   - firm:     firms.ai_paused stops that firm only.
 *
 * `assertAiAllowed` is called on the credit path (every AI feature charges
 * credits first), so a paused call is refused before anything is taken.
 * `platformPausedCached` is a synchronous backstop for the provider clients.
 * Both fail OPEN on a DB error: a broken settings read must not take AI down.
 */
import { db } from '../db/client';
import { logger } from '../logger';
import { HttpError } from './errors';

const TTL_MS = 30_000;
let cached = { paused: false, at: 0 };
let refreshing: Promise<boolean> | null = null;

export class AiPausedError extends HttpError {
  constructor() {
    super(503, 'AI features are paused by DifAi for now. Please try again later.', { code: 'ai_paused' });
  }
}

async function readPlatformPaused(): Promise<boolean> {
  const sql = db();
  if (!sql) return false;
  try {
    const [r] = await sql<{ value: unknown }[]>`select value from platform_settings where key = 'ai_paused'`;
    return r?.value === true;
  } catch (err) {
    logger.error({ err }, 'ai pause: settings read failed, treating AI as on');
    return cached.paused;
  }
}

export async function platformPaused(): Promise<boolean> {
  if (Date.now() - cached.at < TTL_MS) return cached.paused;
  refreshing ??= readPlatformPaused().then((paused) => {
    cached = { paused, at: Date.now() };
    return paused;
  }).finally(() => { refreshing = null; });
  return refreshing;
}

/** Last known platform state; starts a refresh when stale. Never throws. */
export function platformPausedCached(): boolean {
  if (Date.now() - cached.at >= TTL_MS) void platformPaused().catch(() => undefined);
  return cached.paused;
}

/** Call after the admin flips the switch so this process sees it at once. */
export function setPlatformPausedCache(paused: boolean): void {
  cached = { paused, at: Date.now() };
}

/** Throws 503 ai_paused when AI is paused for the platform or this firm. */
export async function assertAiAllowed(firmId: string | null): Promise<void> {
  if (await platformPaused()) throw new AiPausedError();
  const sql = db();
  if (!sql || !firmId) return;
  let firmPaused = false;
  try {
    const [f] = await sql<{ ai_paused: boolean }[]>`select ai_paused from firms where id = ${firmId}::uuid`;
    firmPaused = f?.ai_paused === true;
  } catch (err) {
    logger.error({ err, firmId }, 'ai pause: firm read failed, treating AI as on');
  }
  if (firmPaused) throw new AiPausedError();
}
