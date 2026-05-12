import { createApp } from './app';
import { env } from './env';
import { logger } from './logger';
import { jobs } from './services/jobs.service';

const app = createApp();

// Multi-replica drift warning. Several caches are process-local Maps
// (firmIdForUser, permissions resolver, MFA pending challenges). Running
// multiple API replicas behind a load balancer without a shared cache
// layer (e.g. Redis) will produce per-replica stale state: a role change
// invalidates on one replica's cache but not the others, so a request
// routed to the wrong replica can serve up-to-15-seconds-stale entitlement
// decisions. Acceptable for low-tenant pilot deploys; budget the Redis-
// backed cache abstraction before going past one replica.
if (env.isProd && env.API_REPLICAS && env.API_REPLICAS > 1) {
  logger.warn(
    { replicas: env.API_REPLICAS },
    'Multi-replica deploy detected. Process-local caches (firmId, permissions, MFA challenges) will drift between replicas. Plan a shared-cache migration before scaling further. See DEPLOYMENT.md §"Scaling".',
  );
}

const server = app.listen(env.PORT, () => {
  logger.info(`LexDraft API listening on http://localhost:${env.PORT}`);
});

// Boot the background worker. When DATABASE_URL is blank this is a no-op and
// jobs run inline at enqueue time.
jobs.start().catch((err) => logger.error({ err }, 'jobs.start failed'));

const shutdown = (signal: string) => {
  logger.info({ signal }, 'shutting down');
  void jobs.stop().catch((err) => logger.warn({ err }, 'jobs.stop failed'));
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
