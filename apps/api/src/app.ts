import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { env } from './env';
import { logger } from './logger';
import { apiRouter } from './routes';
import { uploadsRouter } from './routes/uploads.routes';
import { errorHandler, notFound } from './middleware/error';
import { perUserWriteLimit } from './middleware/rateLimit';
import { requestId } from './middleware/requestId';

export function createApp(): express.Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // First — every request gets an id + child logger before anything else
  // can log. Header is also echoed back so a client can quote it in a bug
  // report.
  app.use(requestId);

  app.use(helmet({
    contentSecurityPolicy: false, // disabled for API; web app sets its own.
  }));
  app.use(cors({
    origin: env.corsOrigins.length === 1 && env.corsOrigins[0] === '*' ? true : env.corsOrigins,
    credentials: true,
  }));
  app.use(compression());

  // Register a `:id` token so morgan lines carry the request id alongside
  // structured logger output — one rope to pull when debugging.
  morgan.token('id', (req: express.Request) => req.id ?? '-');
  const morganFormat = env.isProd
    ? ':id :remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"'
    : ':id :method :url :status :response-time ms - :res[content-length]';
  app.use(morgan(morganFormat, {
    stream: { write: (msg) => logger.info(msg.trim()) },
  }));

  // Storage uploads: signature-checked, raw binary bodies. Mounted before the
  // JSON parser so the body stays a Buffer.
  app.use('/api/uploads', uploadsRouter);

  // 16mb leaves room for base64-encoded uploads (~12mb binary) plus regular
  // JSON bodies. New clients should use the presigned-URL flow at
  // /api/documents/upload-url instead, which streams directly to /api/uploads
  // without going through this parser. `verify` captures the raw bytes so
  // webhook signature verification can hash the exact payload the provider
  // signed — re-stringifying parsed JSON would change whitespace and break
  // HMAC comparison.
  app.use(express.json({
    limit: '16mb',
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
    },
  }));
  app.use(express.urlencoded({ extended: false, limit: '16mb' }));

  // IP-level coarse limiter — stops anonymous floods.
  app.use('/api', rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 600,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  }));
  // Per-user write limiter — bounds a compromised account's blast radius.
  app.use('/api', perUserWriteLimit({
    windowMs: env.WRITE_RATE_LIMIT_WINDOW_MS,
    limit: env.WRITE_RATE_LIMIT,
    name: 'write',
  }));

  app.use('/api', apiRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
