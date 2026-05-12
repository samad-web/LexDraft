import { createApp } from './app';
import { env } from './env';
import { logger } from './logger';
import { jobs } from './services/jobs.service';

const app = createApp();

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
