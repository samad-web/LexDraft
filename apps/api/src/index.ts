import { createApp } from './app';
import { env } from './env';
import { logger } from './logger';
import { jobs } from './services/jobs.service';
import { cacheBroadcaster } from './services/cache-broadcaster';

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(`LexDraft API listening on http://localhost:${env.PORT}`);
});

// Boot the background worker. When DATABASE_URL is blank this is a no-op and
// jobs run inline at enqueue time.
jobs.start().catch((err) => logger.error({ err }, 'jobs.start failed'));

// Boot the cross-replica cache invalidation listener. firmId + permissions
// caches subscribe at module load; this kicks the LISTEN connection open.
// In-memory mode (no DATABASE_URL) is a no-op. A failure here doesn't
// crash the process — single-replica deploys still serve correct decisions
// from the local cache + TTL fallback.
cacheBroadcaster.start().catch((err) =>
  logger.error({ err }, 'cacheBroadcaster.start failed — running without cross-replica invalidation'),
);

// MFA pending challenges are stored in Postgres (table `mfa_pending_challenges`)
// not in-process, so they don't drift between replicas. Only the firmId +
// permissions caches needed the broadcaster.

const shutdown = (signal: string) => {
  logger.info({ signal }, 'shutting down');
  void jobs.stop().catch((err) => logger.warn({ err }, 'jobs.stop failed'));
  void cacheBroadcaster.stop().catch((err) => logger.warn({ err }, 'cacheBroadcaster.stop failed'));
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => logger.error({ reason }, 'unhandledRejection'));
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaughtException');
  process.exit(1);
});
