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
  expireInSeconds?: number;
}

interface RegisterOptions {
  /** Cron expression for a recurring schedule (e.g. '0 3 * * 0' = Sun 03:00). */
  cron?: string;
  /** IANA timezone for the cron (e.g. 'Asia/Kolkata'). Defaults to UTC. */
  tz?: string;
  /** How long one run may take before pg-boss treats it as dead and retries
   *  it. pg-boss's default is 15 minutes - too short for a sweep that walks
   *  every case at a throttled pace. */
  expireInSeconds?: number;
}

interface EnqueueOptions {
  delaySec?: number;
  singletonKey?: string;
  /** Retry policy for handlers that throw on transient failures. */
  retryLimit?: number;
  retryDelay?: number;
  retryBackoff?: boolean;
  expireInSeconds?: number;
}

const registry: RegisteredJob[] = [];

/** Job names whose recurring schedule was removed. Their handlers may still
 *  be registered (for manual triggering) but must no longer fire on a cron.
 *  - ecourts.sync.daily (02:00) -> replaced by ecourts.sync.morning/evening
 *  - hearings.reminders.daily (02:30) -> now runs after the 09:00 sync
 *  - tn-land.reminders.morning/evening -> Land Records reminders dropped (user, 2026-10-24) */
const RETIRED_SCHEDULES = ['ecourts.sync.daily', 'hearings.reminders.daily', 'tn-land.reminders.morning', 'tn-land.reminders.evening'];
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
      // Schedules persist in Postgres, so a cron that is no longer wanted
      // must be actively unscheduled - otherwise it keeps firing.
      for (const name of RETIRED_SCHEDULES) {
        await instance.unschedule(name);
      }
      for (const job of registry) {
        if (!job.cron) continue;
        const scheduleOpts: PgBoss.ScheduleOptions = {};
        if (job.tz) scheduleOpts.tz = job.tz;
        if (job.expireInSeconds) scheduleOpts.expireInSeconds = job.expireInSeconds;
        await instance.schedule(job.name, job.cron, {}, scheduleOpts);
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
    registry.push({
      name,
      handler: handler as JobHandler<unknown>,
      cron: opts?.cron,
      tz: opts?.tz,
      expireInSeconds: opts?.expireInSeconds,
    });
  },

  /** Boot the worker. Idempotent. */
  async start(): Promise<void> {
    await start();
  },

  /** Enqueue a job. In memory mode, runs the handler synchronously. */
  async enqueue<T>(name: string, data: T, opts?: EnqueueOptions): Promise<string | null> {
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
    if (opts?.retryLimit !== undefined) sendOpts.retryLimit = opts.retryLimit;
    if (opts?.retryDelay !== undefined) sendOpts.retryDelay = opts.retryDelay;
    if (opts?.retryBackoff !== undefined) sendOpts.retryBackoff = opts.retryBackoff;
    if (opts?.expireInSeconds !== undefined) sendOpts.expireInSeconds = opts.expireInSeconds;
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
  /** Display name shown as the sender, e.g. "Asha Rao (via LexDraft)". The
   *  address stays EMAIL_FROM so SPF/DKIM pass. */
  fromName?: string;
  /** Where replies go - typically the acting user's sign-in email. */
  replyTo?: string;
}

jobs.register<EmailSendPayload>('email.send', async (data) => {
  // Delegate to the centralised emailService — uses nodemailer when
  // SMTP_HOST is configured, logs to stdout otherwise. Never throws; we
  // don't want a transient SMTP failure to crash the job queue.
  const { emailService } = await import('./email.service');
  const ok = await emailService.send({
    to: data.to,
    subject: data.subject,
    body: data.body,
    ...(data.fromName ? { fromName: data.fromName } : {}),
    ...(data.replyTo ? { replyTo: data.replyTo } : {}),
  });
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
// the past. Both handlers are idempotent (condition-based delete; a re-run
// against rows already purged is a no-op) — scheduled daily off-peak,
// after the other nightly sweeps above.
//
// FIXED (2026-10): these were registered WITHOUT a cron schedule — every
// other recurring job in this file passes {cron, tz}, these two didn't, so
// pg-boss never scheduled them. A user could request deletion, see the
// countdown banner, scheduled_purge_at would be set correctly — and then
// nothing ever actually purged it. dpdp.service.ts's own doc comment
// already said "the orchestrator wires into pg-boss on a daily cron"; this
// was the missing wiring.
jobs.register('dpdp.purgeDueDeletions', async () => {
  const { dpdpService } = await import('./dpdp.service');
  const purged = await dpdpService.purgeDueDeletions();
  logger.info({ purged }, 'dpdp.purgeDueDeletions complete');
}, { cron: '45 3 * * *', tz: 'Asia/Kolkata' });

jobs.register('dpdp.purgeExpiredAuditEntries', async () => {
  const { dpdpService } = await import('./dpdp.service');
  const purged = await dpdpService.purgeExpiredAuditEntries();
  logger.info({ purged }, 'dpdp.purgeExpiredAuditEntries complete');
}, { cron: '0 4 * * *', tz: 'Asia/Kolkata' });

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

// Document render — engine .docx -> stored .docx + LibreOffice PDF (Task 4, the
// single rendering path). The route enqueues after a 'generated' engine draft; the
// worker stores both artifacts to S3 and marks the draft_renders row ready. The job
// is idempotent on (matterId, factSheetVersion): a retry overwrites the same keys and
// upserts the same row rather than duplicating S3 objects. In memory mode (no
// pg-boss) it runs inline, so dev without Postgres still produces a PDF.
//
// NB: the docx base64 travels in the payload because it is the transient input to the
// conversion and is not otherwise persisted until the handler stores it. It is the one
// deliberate exception to "no bytes in payloads" — the alternative (a pre-store round
// trip) buys nothing since the handler stores it immediately anyway.
interface DocumentRenderPayload {
  matterId: string;
  factSheetVersion: number;
  firmId: string | null;
  docType: string;
  draftId?: string | null;
  docxBase64: string;
  templateId: string;
  templateVersion: number;
}

jobs.register<DocumentRenderPayload>('document.render', async (data) => {
  const { documentRenderService } = await import('./document-render.service');
  await documentRenderService.process(data);
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

// Scheduled eCourts case sync - 09:00 and 19:00 IST. Walks every live matter
// with a usable CNR, re-pulls it from eCourts, folds updates into the case +
// hearings, notifies on changes, and sends every advocate an in-app summary
// of the run. eCourts goes down often: a circuit breaker stops the run when
// it's unreachable and `ecourts.sync.retry` re-attempts the leftovers every
// 30 min (see ecourts-sync-runs.service.ts).
//   09:00 - advocates start the day with today's listings.
//   19:00 - after courts have posted the day's business and next dates.
const ECOURTS_RUN_EXPIRE_SEC = 4 * 3600;

// eFiling tracking (efiling-tracker.service.ts) runs straight after each
// slot's eCourts sync, in the same job, so the two never hit eCourts at
// once. It must run even when the sync failed, and its own failure must not
// stop the hearing reminders.
async function trackEfilingsAfterSync(slot: 'morning' | 'evening'): Promise<void> {
  try {
    const { runEfilingTracking } = await import('./efiling-tracker.service');
    await runEfilingTracking({ slot });
  } catch (err) {
    logger.error({ err, slot }, 'efiling tracking after eCourts sync failed');
  }
  // Then refresh cases advocates opened in the last week that aren't
  // matters, so "View" on them is instant and current (case store, 0088).
  try {
    const { refreshRecentlyViewed } = await import('./ecourts-case-store.service');
    await refreshRecentlyViewed(slot);
  } catch (err) {
    logger.error({ err, slot }, 'viewed-case refresh after eCourts sync failed');
  }
}

// A case an advocate opened while eCourts was down: retried with backoff
// (policy set at enqueue time), in-app notification when it lands.
jobs.register<import('./ecourts-case-store.service').CaseFetchPayload>('ecourts.case.fetch', async (data) => {
  const { runCaseFetchJob } = await import('./ecourts-case-store.service');
  await runCaseFetchJob(data);
});

/** Everything one 09:00 / 19:00 slot does. `runDate` is set when a missed
 *  slot is being caught up, so the run is recorded under the day it was for. */
async function runSlot(slot: 'morning' | 'evening', runDate?: string): Promise<void> {
  const { runScheduledSync } = await import('./ecourts-sync-runs.service');
  try {
    await runScheduledSync({ slot, ...(runDate ? { runDate } : {}) });
  } finally {
    await trackEfilingsAfterSync(slot);
    if (slot === 'morning') {
      // Hearing reminders read the DB, not eCourts - they must go out even
      // when eCourts is down, using the last synced hearing dates.
      const { sendUpcomingHearingReminders } = await import('./case-sync.service');
      const summary = await sendUpcomingHearingReminders();
      logger.info(summary, 'hearing reminders sent after morning sync');
    }
  }
}

jobs.register('ecourts.sync.morning', async () => {
  await runSlot('morning');
}, { cron: '0 9 * * *', tz: 'Asia/Kolkata', expireInSeconds: ECOURTS_RUN_EXPIRE_SEC });

jobs.register('ecourts.sync.evening', async () => {
  await runSlot('evening');
}, { cron: '0 19 * * *', tz: 'Asia/Kolkata', expireInSeconds: ECOURTS_RUN_EXPIRE_SEC });

// ---- Missed-run recovery -------------------------------------------------
// The cron above fires only if the server is up at that exact minute, and
// pg-boss never catches up. This makes the slots run without anyone doing
// anything: checked at startup (index.ts) and every 15 minutes, a slot with
// no ecourts_sync_runs record is run now (see missedSlot()).

interface CatchupPayload { slot: 'morning' | 'evening'; runDate: string }

jobs.register<CatchupPayload>('ecourts.sync.catchup', async ({ slot, runDate }) => {
  const { missedSlot } = await import('./ecourts-sync-runs.service');
  // Re-check: the real cron (or another catch-up) may have started it since.
  const still = await missedSlot();
  if (!still || still.slot !== slot || still.runDate !== runDate) return;
  logger.warn({ slot, runDate }, 'eCourts scheduled update was missed (server not running at that time) - running it now');
  await runSlot(slot, runDate);
}, { expireInSeconds: ECOURTS_RUN_EXPIRE_SEC });

/** Queue the latest missed slot, if any. Safe to call any number of times. */
export async function ensureScheduledSyncRan(): Promise<void> {
  try {
    const { missedSlot } = await import('./ecourts-sync-runs.service');
    const missed = await missedSlot();
    if (!missed) return;
    await jobs.enqueue<CatchupPayload>('ecourts.sync.catchup', { slot: missed.slot, runDate: missed.runDate }, {
      singletonKey: `ecourts-catchup:${missed.slot}:${missed.runDate}`,
      expireInSeconds: ECOURTS_RUN_EXPIRE_SEC,
    });
    logger.info(missed, 'queued catch-up for a missed eCourts update');
  } catch (err) {
    logger.error({ err }, 'missed eCourts update check failed');
  }
}

jobs.register('ecourts.sync.watchdog', async () => {
  await ensureScheduledSyncRan();
}, { cron: '*/15 * * * *', tz: 'Asia/Kolkata' });

interface EfilingTrackRetryPayload {
  slot: 'morning' | 'evening' | 'manual';
  runDate: string;
  attempt: number;
}

// Re-tries filings eCourts couldn't answer, every 30 min (see tracker).
jobs.register<EfilingTrackRetryPayload>('efiling.track.retry', async (data) => {
  const { runEfilingTracking } = await import('./efiling-tracker.service');
  await runEfilingTracking(data);
});

// Ad-hoc run ("Check now" in the eFiling view).
jobs.register('efiling.track.manual', async () => {
  const { runEfilingTracking } = await import('./efiling-tracker.service');
  await runEfilingTracking({ slot: 'manual' });
});

interface EcourtsSyncRetryPayload {
  slot: 'morning' | 'evening' | 'manual';
  runDate: string;
  attempt: number;
  busyDeferrals?: number;
}

jobs.register<EcourtsSyncRetryPayload>('ecourts.sync.retry', async (data) => {
  const { runScheduledSync } = await import('./ecourts-sync-runs.service');
  await runScheduledSync(data);
});

// Ad-hoc full sync (no schedule - its old 02:00 cron is retired above).
jobs.register('ecourts.sync.daily', async () => {
  const { runScheduledSync } = await import('./ecourts-sync-runs.service');
  await runScheduledSync({ slot: 'manual' });
});

// First fetch for a matter that was just added or had its CNR changed.
// Throws only when eCourts is unreachable, so pg-boss retries with backoff
// exactly those (policy set at enqueue time in ecourts-link.service.ts).
interface EcourtsCaseLinkPayload {
  caseId: string;
  firmId: string;
}

jobs.register<EcourtsCaseLinkPayload>('ecourts.case.link', async (data) => {
  const { runLinkJob } = await import('./ecourts-link.service');
  await runLinkJob(data);
});

// "Sync from eCourts" on Hearings: one firm's matters, on demand.
jobs.register<{ firmId: string }>('ecourts.sync.firm', async (data) => {
  const { syncFirmCases } = await import('./ecourts-sync-runs.service');
  await syncFirmCases(data.firmId);
}, { expireInSeconds: 30 * 60 });

// Upcoming-hearing reminders. Runs automatically right after the 09:00
// eCourts sync (above) so a hearing date that moved is reflected the same
// morning. Kept registered without a cron for manual triggering.
jobs.register('hearings.reminders.daily', async () => {
  const { sendUpcomingHearingReminders } = await import('./case-sync.service');
  const summary = await sendUpcomingHearingReminders();
  logger.info(summary, 'hearings.reminders.daily complete');
});

// Permanently purge matters that have been soft-deleted for more than 30 days.
// Deleting a matter marks deleted_at (recoverable via "Recently deleted"); this
// sweep, at 03:30 IST daily, hard-removes those past the retention window.
jobs.register('cases.purge.deleted.daily', async () => {
  const { casesService } = await import('./cases.service');
  const purged = await casesService.purgeExpired(30);
  if (purged > 0) logger.info({ purged }, 'cases.purge.deleted.daily complete');
}, { cron: '30 3 * * *', tz: 'Asia/Kolkata' });
