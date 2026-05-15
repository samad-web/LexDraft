import pino from 'pino';
import { env } from './env';

// Anything that smells like a credential gets censored before pino emits
// the line. Paths are matched at the exact depth (e.g. `req.body.password`)
// or via a single-level wildcard (e.g. `*.token` catches `evt.token`).
// fast-redact resolves these once at startup; the runtime cost is a single
// property lookup per matched path per log call.
const REDACT_PATHS = [
  // Express request headers
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["x-auth-token"]',
  'req.headers["x-anthropic-api-key"]',

  // Request bodies - auth + admin flows
  'req.body.password',
  'req.body.currentPassword',
  'req.body.newPassword',
  'req.body.confirmPassword',
  'req.body.token',
  'req.body.refreshToken',
  'req.body.apiKey',
  'req.body.api_key',
  'req.body.secret',
  'req.body.otp',
  'req.body.totp',

  // Common top-level fields wherever an object is logged
  'password',
  'currentPassword',
  'newPassword',
  'confirmPassword',
  'token',
  'refreshToken',
  'apiKey',
  'api_key',
  'secret',
  'authorization',
  'cookie',
  'otp',
  'totp',
  'totpSecret',
  'mfaSecret',

  // Env-shaped fields - guard against accidental env dumps
  'JWT_SECRET',
  'ANTHROPIC_API_KEY',
  'XAI_API_KEY',
  'DATABASE_URL',
  'STORAGE_SIGNING_SECRET',

  // Webhook payload bodies - providers ship signatures and sometimes
  // secrets in the body
  'body.password',
  'body.token',
  'body.secret',
  'body.api_key',
  'body.apiKey',
  'body.authorization',

  // Single-level wildcard - catches err.config.headers, evt.user.password, …
  '*.password',
  '*.token',
  '*.secret',
  '*.apiKey',
  '*.api_key',
  '*.authorization',
  '*.cookie',
  '*.otp',
  '*.totp',
];

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  transport: env.isProd
    ? undefined
    : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
});
