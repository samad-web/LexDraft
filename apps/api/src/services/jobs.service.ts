import PgBoss from 'pg-boss';
import { env } from '../env';
import { logger } from '../logger';

/**
 * Background job queue. Backed by pg-boss when DATABASE_URL is set; falls
 * back to synchronous in-process execution in demo mode (no Postgres).
 *
 * Conventions:
 *   - Job names are dotted (`documents.cleanup`, `email.send`).
 *   - Payloads are plain JSON. Don't put Buffers in the payload - store the
 *     bytes in `storage` and pass the key.
 *   - Handlers should be idempotent. pg-boss may redeliver on worker crash.
 */

export type JobHandler<T = unknown> = (data: T, meta: { id: string; attempt: number }) => Promise<void>;

interface RegisteredJob {
  name: string;
  handler: JobHandler<unknown>;
  /** When set, the job is registered on this cron schedule at worker start
   *  (pg-boss `schedule()`). Optional `tz` (IANA name) defaults to UTC. */
  cron?: string;
  tz?: string;
}

interface RegisterOptions {
  /** Cron expression for a recurring schedule (e.g. '0 3 * * 0' = Sun 03:00). */
  cron?: string;
  /** IANA timezone for the cron (e.g. 'Asia/Kolkata'). Defaults to UTC. */
  tz?: string;
}

const registry: RegisteredJob[] = [];
let boss: PgBoss | null = null;
let starting: Promise<PgBoss | null> | null = null;

async function start(): Promise<PgBoss | null> {
  if (boss) return boss;
  if (!env.hasDatabase) return null;
  if (!starting) {
    starting = (async () => {
      const instance = new PgBoss({
        connectionString: env.DATABASE_URL,
        ssl: env.databaseSsl ? { rejectUnauthorized: false } : false,
        // pg-boss defaults to ~10 connections. Supabase session-mode pooler
        // caps at 15 per project; the main db() client takes 5 and the
        // cache-broadcaster LISTEN takes 1, leaving ~9 for job traffic.
        // We cap at 3 — job workloads (email send, reminders, cleanups) are
        // low-frequency and don't need more concurrency than that. Prod on
        // a managed Postgres can raise this via env if needed.
        max: 3,
      });
      instance.on('error', (err) => logger.error({ err }, 'pg-boss error'));
      await instance.start();
      logger.info('pg-boss queue started');
      for (const job of registry) {
        // pg-boss v10 requires the queue to exist before work()/send()/
        // schedule(); create_queue is INSERT … ON CONFLICT DO NOTHING, so this
        // is idempotent and safe to run on every boot.
        await instance.createQueue(job.name);
        await instance.work(job.name, async (msg) => {
          // pg-boss v10: msg is an array of jobs when batching, single object otherwise.
          const items = Array.isArray(msg) ? msg : [msg];
          for (const m of items) {
            try {
              await job.handler(m.data, { id: m.id, attempt: (m as { retrycount?: number }).retrycount ?? 0 });
            } catch (err) {
              logger.error({ err, jobName: job.name, jobId: m.id }, 'job handler threw');
              throw err;
            }
          }
        });
      }
      // Register recurring schedules after workers are up. schedule() upserts
      // (ON CONFLICT (name) DO UPDATE), so changing a cron just re-points it.
      for (const job of registry) {
        if (!job.cron) continue;
        await instance.schedule(job.name, job.cron, {}, job.tz ? { tz: job.tz } : {});
        logger.info({ job: job.name, cron: job.cron, tz: job.tz ?? 'UTC' }, 'recurring job scheduled');
      }
      boss = instance;
      return instance;
    })();
  }
  return starting;
}

export const jobs = {
  /** Register a handler for a job name. Must be called before `start()`.
   *  Pass `opts.cron` (+ optional `opts.tz`) to also run it on a recurring
   *  schedule. */
  register<T = unknown>(name: string, handler: JobHandler<T>, opts?: RegisterOptions): void {
    if (registry.some((j) => j.name === name)) {
      throw new Error(`Job "${name}" is already registered`);
    }
    registry.push({ name, handler: handler as JobHandler<unknown>, cron: opts?.cron, tz: opts?.tz });
  },

  /** Boot the worker. Idempotent. */
  async start(): Promise<void> {
    await start();
  },

  /** Enqueue a job. In memory mode, runs the handler synchronously. */
  async enqueue<T>(name: string, data: T, opts?: { delaySec?: number; singletonKey?: string }): Promise<string | null> {
    const instance = await start();
    if (!instance) {
      const job = registry.find((j) => j.name === name);
      if (!job) {
        logger.warn({ name }, 'enqueue called but no handler registered (memory mode)');
        return null;
      }
      try {
        await job.handler(data, { id: 'memory', attempt: 0 });
      } catch (err) {
        logger.error({ err, name }, 'inline job execution failed');
      }
      return null;
    }
    const sendOpts: PgBoss.SendOptions = {};
    if (opts?.delaySec) sendOpts.startAfter = opts.delaySec;
    if (opts?.singletonKey) sendOpts.singletonKey = opts.singletonKey;
    return instance.send(name, data as object, sendOpts);
  },

  /** Stop the worker - used during graceful shutdown. */
  async stop(): Promise<void> {
    if (boss) {
      await boss.stop({ graceful: true, timeout: 10_000 });
      boss = null;
      starting = null;
    }
  },
};

// ---------------------------------------------------------------------------
// Built-in jobs. Add new handlers here so registration happens at module load
// (before the worker starts).
// ---------------------------------------------------------------------------

interface EmailSendPayload {
  to: string;
  subject: string;
  body: string;
}

jobs.register<EmailSendPayload>('email.send', async (data) => {
  // Delegate to the centralised emailService — uses nodemailer when
  // SMTP_HOST is configured, logs to stdout otherwise. Never throws; we
  // don't want a transient SMTP failure to crash the job queue.
  const { emailService } = await import('./email.service');
  const ok = await emailService.send({ to: data.to, subject: data.subject, body: data.body });
  if (!ok && env.hasSmtp) {
    logger.warn({ to: data.to, subject: data.subject }, 'email.send: transport rejected');
  }
});

interface HearingReminderPayload {
  hearingId: string;
  channel: 'email' | 'whatsapp' | 'sms';
}

jobs.register<HearingReminderPayload>('hearing.reminder', async (data) => {
  logger.info({ data }, 'hearing.reminder (stub) - wire WhatsApp/SMS provider');
});

interface DocumentCleanupPayload {
  storageKey: string;
}

jobs.register<DocumentCleanupPayload>('documents.cleanup', async (data) => {
  // Imported lazily to avoid the circular module import at boot.
  const { storage } = await import('./storage.service');
  await storage().delete(data.storageKey);
  logger.info({ key: data.storageKey }, 'documents.cleanup deleted blob');
});

// DPDP compliance jobs. `purgeDueDeletions` hard-deletes user-owned rows
// whose `scheduled_purge_at` has elapsed (retention window expired).
// `purgeExpiredAuditEntries` clears audit rows whose `retain_until` is in
// the past. Both handlers are idempotent; the worker should schedule them
// daily off-peak (suggested: 03:00 IST via pg-boss `schedule()`).
jobs.register('dpdp.purgeDueDeletions', async () => {
  const { dpdpService } = await import('./dpdp.service');
  const purged = await dpdpService.purgeDueDeletions();
  logger.info({ purged }, 'dpdp.purgeDueDeletions complete');
});

jobs.register('dpdp.purgeExpiredAuditEntries', async () => {
  const { dpdpService } = await import('./dpdp.service');
  const purged = await dpdpService.purgeExpiredAuditEntries();
  logger.info({ purged }, 'dpdp.purgeExpiredAuditEntries complete');
});

// Analytics MV refresh. Idempotent - `refresh materialized view
// concurrently` is a no-op when nothing's changed and is safe to call
// repeatedly. Suggested schedule: daily 02:30 IST (before the DPDP purge
// at 03:00 so a freshly-purged row doesn't transiently appear in the
// next-morning revenue chart).
jobs.register('analytics.refresh', async () => {
  const { analyticsRefreshService } = await import('./analytics-refresh.service');
  const results = await analyticsRefreshService.refreshAll();
  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    logger.warn({ failed }, 'analytics.refresh - some MVs failed');
  } else {
    logger.info({ count: results.length, totalMs: results.reduce((s, r) => s + r.ms, 0) }, 'analytics.refresh complete');
  }
});

// Title Reports — defects analysis (migration 0050). Heavy LLM call; route
// enqueues, worker runs runDefectsAnalysis, UI polls GET /:id/ai/runs/:runId
// for the result. The route's enqueue path also has a synchronous fallback
// for memory mode, so the same handler works in dev without pg-boss.
interface TitleReportAiAnalysePayload {
  firmId: string;
  titleReportId: string;
  userId: string;
  email: string;
  roleName: string | null;
}

jobs.register<TitleReportAiAnalysePayload>('title-report.ai-analyse', async (data) => {
  const { titleReportsAiService } = await import('./title-reports.ai.service');
  await titleReportsAiService.runDefectsAnalysis(data);
});

interface TitleReportExtractPayload {
  firmId: string;
  titleReportId: string;
  documentId: string;
  userId?: string;
  email?: string;
}

jobs.register<TitleReportExtractPayload>('title-report.extract', async (data) => {
  const { titleReportsExtractService } = await import('./title-reports.extract.service');
  await titleReportsExtractService.extractDocument({
    firmId: data.firmId,
    titleReportId: data.titleReportId,
    documentId: data.documentId,
    userId: data.userId ?? data.firmId,
    email: data.email ?? 'system',
  });
});

// High Court sitting-judge roster refresh. Re-scrapes the public source and
// wipe-and-replaces court_judges (see judges-roster.service.ts). Slow-moving
// data — weekly is plenty. Idempotent: the sync is a single transaction.
// Schedule: Sundays 03:00 IST (off-peak, alongside the other nightly jobs).
jobs.register('judges.roster.sync', async () => {
  const { syncHighCourtJudges } = await import('./judges-roster.service');
  const summary = await syncHighCourtJudges();
  logger.info(
    { total: summary.totalJudges, courts: Object.keys(summary.perCourt).length, persisted: summary.persisted },
    'judges.roster.sync complete',
  );
}, { cron: '0 3 * * 0', tz: 'Asia/Kolkata' });
