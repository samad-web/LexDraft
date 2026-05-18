import 'dotenv/config';
import { z } from 'zod';

const Schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  // Drafting / research provider. `auto` picks based on which key is set,
  // preferring xAI when both are configured.
  LLM_PROVIDER: z.enum(['auto', 'anthropic', 'xai', 'none']).default('auto'),
  ANTHROPIC_API_KEY: z.string().optional().default(''),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-6'),
  XAI_API_KEY: z.string().optional().default(''),
  XAI_MODEL: z.string().default('grok-4'),
  // Postgres / Supabase. Optional - when blank the API falls back to its
  // in-memory store (the demo mode). Provide a Supabase pooled URI in prod.
  DATABASE_URL: z.string().optional().default(''),
  DATABASE_SSL: z.enum(['true', 'false']).default('true'),

  // File storage. `local` writes to STORAGE_LOCAL_DIR and serves presigned URLs
  // back through this API. `s3` and `r2` are stubs awaiting credentials.
  STORAGE_DRIVER: z.enum(['local', 's3', 'r2']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./uploads'),
  /** Absolute base URL the API is reachable at (used to build presigned URLs
   *  for the local driver). Defaults to `http://localhost:<PORT>`. */
  STORAGE_PUBLIC_BASE_URL: z.string().optional().default(''),
  /** Secret used to sign upload/download URLs (local driver only). Must be
   *  ≥ 32 chars in production; falls back to JWT_SECRET when blank. */
  STORAGE_SIGNING_SECRET: z.string().optional().default(''),
  /** Per-user write rate limit (writes per WINDOW). */
  WRITE_RATE_LIMIT: z.coerce.number().int().positive().default(120),
  WRITE_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),

  /** Public URL of the web app - used to build magic links so the email
   *  link lands on the right host. Falls back to the first CORS origin. */
  WEB_PUBLIC_BASE_URL: z.string().optional().default(''),
  /** When 'true', /portal/auth/request-link returns the magic link in the
   *  response body. ONLY for dev - otherwise anyone hitting the endpoint
   *  with a known client email can sign in without the inbox. */
  CLIENT_PORTAL_RETURN_LINK: z.enum(['true', 'false']).default('false'),
  /** Magic-link TTL in minutes. */
  CLIENT_PORTAL_LINK_TTL_MIN: z.coerce.number().int().positive().default(15),
  /** Portal session JWT TTL (passed to jsonwebtoken). */
  CLIENT_PORTAL_SESSION_TTL: z.string().default('24h'),

  /** Dev-only escape hatch. When 'true' AND NODE_ENV !== 'production', an
   *  unknown email at sign-in auto-provisions a user (and `admin` in the
   *  email auto-promotes to superadmin). Convenient for demos, fatal for
   *  prod - kept off by default and double-gated on NODE_ENV below. */
  DEV_AUTH_AUTO_PROVISION: z.enum(['true', 'false']).default('false'),

  /** Per-provider HMAC-SHA256 webhook secrets. Each provider stamps a
   *  hex digest of the raw body in the `x-signature` header (or a
   *  provider-specific header - see services/webhooks.verify.ts). Any
   *  webhook mounted at /api/webhooks/:source with a configured secret
   *  is verified before its body is parsed. Sources without a configured
   *  secret are rejected with 503 unless WEBHOOK_ALLOW_UNVERIFIED='true'. */
  WEBHOOK_SECRET_ECOURTS: z.string().optional().default(''),
  WEBHOOK_SECRET_PAYMENT: z.string().optional().default(''),
  WEBHOOK_SECRET_ESIGN: z.string().optional().default(''),
  /** Dev escape hatch - allow unsigned webhooks. NEVER set in prod. */
  WEBHOOK_ALLOW_UNVERIFIED: z.enum(['true', 'false']).default('false'),

  /** Research provider. 'none' (default) returns 501 from /api/research so
   *  prod never ships the canned demo answer. 'demo' returns the canned
   *  answer with a clear "Demonstration" banner - useful for sales demos
   *  but never claims to be real legal research. 'indiacode' wires through
   *  to the indiacode-rag corpus (see LEXDRAFT_INTEGRATION.md). */
  RESEARCH_PROVIDER: z.enum(['none', 'demo', 'indiacode']).default('none'),

  // ---- indiacode-rag integration ------------------------------------------
  // Separate Postgres DB hosting the Indian-law corpus (acts/sections/chunks
  // with pgvector embeddings). NOT the same as DATABASE_URL — that's
  // LexDraft's own tenancy / matter / billing DB.
  LAWS_DATABASE_URL: z.string().optional().default(''),
  LAWS_DATABASE_SSL: z.enum(['true', 'false']).default('false'),
  /** Supabase REST/Storage gateway. Only needed for signed PDF URLs. */
  SUPABASE_URL: z.string().optional().default(''),
  /** Bypasses RLS; OK because the corpus is public reference data. */
  SUPABASE_SERVICE_KEY: z.string().optional().default(''),
  SUPABASE_STORAGE_BUCKET: z.string().default('indiacode'),
  /** Embed-service base URL. Self-hosted FastAPI; see §1 of the integration doc. */
  EMBED_SERVICE_URL: z.string().optional().default(''),
  /** Bearer for /embed and /rerank. Required when the service is configured
   *  with a key; the service falls back to open mode if blank server-side. */
  EMBED_API_KEY: z.string().optional().default(''),
  /** Assertion fields. The corpus is built with bge-m3 @ 1024d; any other
   *  model produces vectors in an incompatible space. */
  EMBEDDING_MODEL: z.string().default('BAAI/bge-m3'),
  EMBEDDING_DIMS: z.coerce.number().int().positive().default(1024),
});

const parsed = Schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:', parsed.error.format());
  process.exit(1);
}

function resolveProvider(): 'anthropic' | 'xai' | 'none' {
  const explicit = parsed.data!.LLM_PROVIDER;
  if (explicit !== 'auto') return explicit;
  if (parsed.data!.XAI_API_KEY) return 'xai';
  if (parsed.data!.ANTHROPIC_API_KEY) return 'anthropic';
  return 'none';
}

export const env = {
  ...parsed.data,
  corsOrigins: parsed.data.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  isProd: parsed.data.NODE_ENV === 'production',
  hasDatabase: parsed.data.DATABASE_URL.length > 0,
  databaseSsl: parsed.data.DATABASE_SSL === 'true',
  llmProvider: resolveProvider(),
  storageSigningSecret: parsed.data.STORAGE_SIGNING_SECRET || parsed.data.JWT_SECRET,
  storagePublicBaseUrl: parsed.data.STORAGE_PUBLIC_BASE_URL || `http://localhost:${parsed.data.PORT}`,
  webPublicBaseUrl: parsed.data.WEB_PUBLIC_BASE_URL
    || parsed.data.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)[0]
    || 'http://localhost:5173',
  clientPortalReturnLink: parsed.data.CLIENT_PORTAL_RETURN_LINK === 'true',
  // Double-gate: even if someone sets the flag in a prod .env by mistake,
  // NODE_ENV='production' wins and shortcuts stay off.
  devAuthAutoProvision:
    parsed.data.NODE_ENV !== 'production'
    && parsed.data.DEV_AUTH_AUTO_PROVISION === 'true',
  // Same double-gate pattern: unsigned webhooks only flow when NODE_ENV is
  // non-prod AND the operator opts in explicitly.
  webhookAllowUnverified:
    parsed.data.NODE_ENV !== 'production'
    && parsed.data.WEBHOOK_ALLOW_UNVERIFIED === 'true',
  webhookSecrets: {
    ecourts: parsed.data.WEBHOOK_SECRET_ECOURTS,
    payment: parsed.data.WEBHOOK_SECRET_PAYMENT,
    esign:   parsed.data.WEBHOOK_SECRET_ESIGN,
  } as Record<string, string>,
  // ---- indiacode-rag derived flags ----
  /** True when both the laws DB and the embed service are configured. The
   *  routes return 503 with a clear message otherwise so misconfigured
   *  envs are obvious instead of silently empty. */
  hasLawsCorpus:
    parsed.data.LAWS_DATABASE_URL.length > 0
    && parsed.data.EMBED_SERVICE_URL.length > 0,
  lawsDatabaseSsl: parsed.data.LAWS_DATABASE_SSL === 'true',
};
