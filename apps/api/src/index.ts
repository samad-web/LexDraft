import { createApp } from './app';
import { env } from './env';
import { logger } from './logger';
import { db } from './db/client';
import { jobs } from './services/jobs.service';
import { cacheBroadcaster } from './services/cache-broadcaster';
import { teamChatRealtime } from './services/team-chat-realtime';

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(`DifAi API listening on http://localhost:${env.PORT}`);
});

// Email is the ONLY delivery channel for hearing reminders, invoice-issued
// notices, and portal messages (see notifications.service.ts) - without
// SMTP_HOST, email.service.ts silently logs every send instead of delivering
// it, with no other sign to an operator. That's fine in dev (expected,
// everyone knows); in production it means hearing reminders could be going
// nowhere with nobody aware. Surface it loudly, once, at boot.
if (env.NODE_ENV === 'production' && !env.hasSmtp) {
  logger.warn(
    'SMTP is not configured (SMTP_HOST is blank) - hearing reminders, invoice notices, and portal '
    + 'emails will be logged only, NOT delivered. Set SMTP_HOST/SMTP_USER/SMTP_PASSWORD in '
    + 'production to actually send them.',
  );
}

// Warm the LibreOffice profile off the request path so the advocate's first
// "Download PDF" / preview is on the fast (~3s) warm path instead of paying the
// one-time ~10s+ profile-creation cost. Best-effort, never blocks boot.
void import('./services/document-render.service')
  .then((m) => m.documentRenderService.warmUp())
  .catch((err) => logger.warn({ err }, 'document-render warm-up failed'));

// Same for Land Records (eservices.tn.gov.in): start its browser and pay the
// slow first-tab start-up now, so the first service an advocate opens is quick.
void import('./services/tn-land-records.service')
  .then((m) => m.warmLandBrowser())
  .catch((err) => logger.warn({ err }, 'land-records warm-up failed'));

// Same for eFiling (filing.ecourts.gov.in): a ready browser, so an advocate's
// portal login opens quickly. Each advocate still gets a private context.
void import('./services/efiling-live.service')
  .then((m) => m.warmEfilingBrowser())
  .catch((err) => logger.warn({ err }, 'efiling warm-up failed'));

// Boot the background worker. When DATABASE_URL is blank this is a no-op and
// jobs run inline at enqueue time.
jobs.start()
  // If the server was off at 9 AM / 7 PM, run that missed eCourts update now
  // rather than waiting for someone to notice (see ecourts.sync.watchdog).
  .then(() => import('./services/jobs.service').then((m) => m.ensureScheduledSyncRan()))
  .catch((err) => logger.error({ err }, 'jobs.start failed'));

// Boot the cross-replica cache invalidation listener. firmId + permissions
// caches subscribe at module load; this kicks the LISTEN connection open.
// In-memory mode (no DATABASE_URL) is a no-op. A failure here doesn't
// crash the process - single-replica deploys still serve correct decisions
// from the local cache + TTL fallback.
cacheBroadcaster.start().catch((err) =>
  logger.error({ err }, 'cacheBroadcaster.start failed - running without cross-replica invalidation'),
);

// Team-chat live delivery. Shares the LISTEN connection opened above
// (postgres.js multiplexes channels), so it costs no extra pool slot. Without
// it, messages still save; clients just see them on their next refresh.
teamChatRealtime.start().catch((err) =>
  logger.error({ err }, 'teamChatRealtime.start failed - team chat will not update live'),
);

// MFA pending challenges are stored in Postgres (table `mfa_pending_challenges`)
// not in-process, so they don't drift between replicas. Only the firmId +
// permissions caches needed the broadcaster.

const shutdown = (signal: string) => {
  logger.info({ signal }, 'shutting down');
  void jobs.stop().catch((err) => logger.warn({ err }, 'jobs.stop failed'));
  void cacheBroadcaster.stop().catch((err) => logger.warn({ err }, 'cacheBroadcaster.stop failed'));
  // Ends open SSE streams too - otherwise server.close() waits on them.
  void teamChatRealtime.stop().catch((err) => logger.warn({ err }, 'teamChatRealtime.stop failed'));
  // Log advocates out of the eFiling portal first (one session per account
  // there), then stop - bounded so shutdown never hangs on the portal.
  void import('./services/efiling-live.service')
    .then((m) => m.closeAllEfilingSessions(7000))
    .catch((err) => logger.warn({ err }, 'efiling logout on shutdown failed'))
    .finally(() => server.close(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ---------------------------------------------------------------------------
// Crash resilience
// ---------------------------------------------------------------------------
//
// The DB is a remote Supabase pooler; its connection is dropped periodically
// (idle timeout, pooler recycle, transient network blip). postgres.js and
// pg-boss both reconnect on their own, and per-query failures reject the
// individual promise the route handler already catches. The danger is a
// transient DB/network error that escapes as an *unhandled* rejection or
// exception — the previous handler called process.exit(1) on ANY uncaught
// exception, so one dropped socket took the whole API down (this is the
// "Network Error" the login page kept showing). We now classify these: a
// transient connectivity error is logged and survived (the pool self-heals);
// only a genuine programming fault is treated as fatal.

/** Heuristic: does this error look like a transient DB / socket drop we can
 *  ride out, rather than a real bug? Matches postgres.js + node net codes for
 *  connection resets, terminations, and pooler recycles. */
function isTransientConnectionError(err: unknown): boolean {
  const e = err as { code?: string; message?: string; errno?: string } | null;
  const code = (e?.code ?? e?.errno ?? '').toUpperCase();
  const msg = (e?.message ?? '').toLowerCase();
  if (['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'CONNECTION_ENDED', 'CONNECTION_DESTROYED', 'CONNECTION_CLOSED'].includes(code)) {
    return true;
  }
  return (
    msg.includes('connection terminated')
    || msg.includes('connection ended')
    || msg.includes('connection closed')
    || msg.includes('read econnreset')
    || msg.includes('terminating connection')
    || msg.includes('server closed the connection')
    || msg.includes('write epipe')
  );
}

process.on('unhandledRejection', (reason) => {
  if (isTransientConnectionError(reason)) {
    logger.warn({ reason }, 'transient DB/network rejection — surviving; pool will reconnect');
    return;
  }
  logger.error({ reason }, 'unhandledRejection');
});

process.on('uncaughtException', (err) => {
  if (isTransientConnectionError(err)) {
    // A dropped DB socket must NOT kill the API. Log and keep serving —
    // postgres.js/pg-boss reconnect, and the next query succeeds.
    logger.warn({ err }, 'transient DB/network exception — surviving; pool will reconnect');
    return;
  }
  // Genuine programming fault: state may be corrupt, so exit and let the
  // process manager (or `tsx watch` / docker restart policy) bring us back.
  logger.fatal({ err }, 'uncaughtException — exiting');
  process.exit(1);
});

// ---------------------------------------------------------------------------
// DB keepalive / health probe
// ---------------------------------------------------------------------------
//
// A cheap periodic `SELECT 1` serves two purposes: (1) it keeps the pooled
// connection warm so Supabase's idle timeout doesn't silently reap it between
// user requests, and (2) it surfaces a half-dead pool in the logs the moment
// it goes unreachable, instead of the failure first appearing as a user-facing
// 500. A failed probe is logged, never fatal — the next probe (or a real
// request) drives postgres.js to reconnect.
const DB_HEALTH_INTERVAL_MS = 60_000;
let dbHealthy = true;
const dbHealthTimer = setInterval(() => {
  const sql = db();
  if (!sql) return; // in-memory mode — nothing to probe
  void sql`select 1`.then(
    () => {
      if (!dbHealthy) {
        dbHealthy = true;
        logger.info('DB connection recovered');
      }
    },
    (err: unknown) => {
      dbHealthy = false;
      logger.warn({ err }, 'DB health probe failed — pool unreachable, will retry');
    },
  );
}, DB_HEALTH_INTERVAL_MS);
dbHealthTimer.unref(); // don't keep the event loop alive for the probe alone
