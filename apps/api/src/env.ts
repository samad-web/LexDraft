import 'dotenv/config';
import { z } from 'zod';
import { Buffer } from 'node:buffer';

const Schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  /** Field-level encryption key for PII columns (esign_signers.name/email/
   *  signed_ip, clients.email) - see src/lib/field-crypto.ts. Base64-encoded
   *  32 bytes (AES-256-GCM). Required once any firm has esign/client rows;
   *  blank is only tolerated so the schema/migrations can be reviewed before
   *  a key is minted - decrypt of real ciphertext will throw without it. */
  FIELD_ENCRYPTION_KEY: z.string().optional().default(''),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  // Drafting / research provider. `auto` picks based on which key is set,
  // preferring xAI when both are configured.
  LLM_PROVIDER: z.enum(['auto', 'anthropic', 'xai', 'none']).default('auto'),
  ANTHROPIC_API_KEY: z.string().optional().default(''),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-6'),
  /** Model that reads an uploaded drafting format (scan / PDF / Word) into an
   *  engine template spec. Accuracy matters more than cost here: it runs once per
   *  uploaded format, not per draft. */
  FORMAT_READER_MODEL: z.string().default('claude-opus-5-5'),
  XAI_API_KEY: z.string().optional().default(''),
  XAI_MODEL: z.string().default('grok-4'),
  // Conversational-intake extractor/classifier use a SEPARATE, FAST model — the
  // heavy drafting model (grok-4 / sonnet) is overkill for extraction/routing and
  // makes each intake turn slow. When set, intake uses these instead of the
  // drafting provider/model above. Leave blank to reuse the drafting model.
  INTAKE_PROVIDER: z.enum(['anthropic', 'xai', '']).default(''),
  INTAKE_MODEL: z.string().default(''),
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

  /** Optional Redis URL for cross-replica rate limiting + cache fanout. When
   *  blank, the rate limiter and caches stay in-process (single replica). */
  REDIS_URL: z.string().optional().default(''),

  /** The co-located Python drafting-engine service (FastAPI). When blank, the
   *  engine client is DISABLED — shadow mode and engine routing are no-ops, and
   *  the existing model pipeline is unaffected. Set to e.g.
   *  http://127.0.0.1:8099 to enable. */
  ENGINE_SERVICE_URL: z.string().optional().default(''),
  /** Shared service-to-service token; must match the engine's
   *  LEXDRAFT_SERVICE_TOKEN. Sent as `Authorization: Bearer <token>`. */
  ENGINE_SERVICE_TOKEN: z.string().optional().default(''),

  /** Comma-separated advocate emails allowed onto the engine-routed Draft path
   *  (Phase 2 flag). Empty = nobody (the flag is off for everyone). This is how
   *  "me as the only user" is expressed — put your email here. */
  ENGINE_ROUTING_ALLOWLIST: z.string().optional().default(''),

  /** Absolute path to the LibreOffice `soffice` binary used to convert the engine
   *  .docx to a filing PDF (document.render job). Defaults to the PATH lookup
   *  `soffice`; pin the full path in the container. When the binary is missing the
   *  render job records render_status='failed' rather than crashing the worker. */
  SOFFICE_BIN: z.string().optional().default('soffice'),
  /** Hard timeout (ms) for a single soffice conversion. LibreOffice hangs on
   *  malformed input; the job kills it past this and marks the render failed. */
  SOFFICE_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  /** Dev-only escape hatch: open the engine-routed Draft path to EVERY logged-in
   *  user, bypassing the allowlist. Convenient for local dev where you don't want
   *  to enumerate emails. Double-gated on NODE_ENV below (same pattern as
   *  DEV_AUTH_AUTO_PROVISION / WEBHOOK_ALLOW_UNVERIFIED): even if set in a prod
   *  .env by mistake, NODE_ENV='production' forces it off. */
  ENGINE_ROUTING_ALLOW_ALL: z.enum(['true', 'false']).default('false'),
  /** Production-safe "open to everyone" switch: unlike ENGINE_ROUTING_ALLOW_ALL,
   *  this is NOT gated off by NODE_ENV='production' — set it deliberately when
   *  the engine-routed Draft path should be live for every current AND future
   *  account (not just an enumerated allowlist). Off by default. */
  ENGINE_ROUTING_OPEN_PROD: z.enum(['true', 'false']).default('false'),

  /** Run the conversational intake with ZERO LLM calls: a deterministic,
   *  rule-based extractor (dates/amounts/cheque no/enums via regex) plus the
   *  built-in plain-language questions (no phraser). No API cost per turn. The
   *  trade-off is weaker handling of free natural phrasing — good for cost-free
   *  testing, or where an LLM key isn't available. When 'false' (default) the
   *  intake uses the LLM extractor + phraser as before. */
  INTAKE_DETERMINISTIC: z.enum(['true', 'false']).default('false'),

  /** COMPOSE (post-generation prose enrichment, see intake-compose.service) —
   *  independent of INTAKE_DETERMINISTIC (which only controls extraction).
   *  Default 'true' — an advocate expects filing-ready prose, not a bare
   *  skeleton; set 'false' for ONLY the engine's plain deterministic draft
   *  (e.g. a fully offline / no-LLM-key deployment). */
  INTAKE_COMPOSE: z.enum(['true', 'false']).default('true'),

  /** SMTP wiring for transactional email (invitations, password resets,
   *  hearing reminders, etc.). When SMTP_HOST is blank, `email.send` logs to
   *  stdout instead — fine for dev, never sends mail. */
  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASSWORD: z.string().optional().default(''),
  SMTP_SECURE: z.enum(['true', 'false']).default('false'),
  EMAIL_FROM: z.string().optional().default(''),

  /** S3 / R2 credentials. Only consulted when STORAGE_DRIVER is 's3' or 'r2'. */
  STORAGE_S3_BUCKET: z.string().optional().default(''),
  STORAGE_S3_REGION: z.string().optional().default(''),
  STORAGE_S3_ACCESS_KEY_ID: z.string().optional().default(''),
  STORAGE_S3_SECRET_ACCESS_KEY: z.string().optional().default(''),
  /** Custom endpoint, e.g. Cloudflare R2 (https://<account>.r2.cloudflarestorage.com). */
  STORAGE_S3_ENDPOINT: z.string().optional().default(''),
  /** When 'true', generate path-style URLs (required by some R2-compatible hosts). */
  STORAGE_S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('false'),

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

  /** Google OAuth client id(s) whose ID tokens /auth/google accepts, comma
   *  separated (web client first; add the Android client id when the native
   *  app gets Google sign-in). Blank disables Google sign-in. */
  GOOGLE_CLIENT_IDS: z.string().optional().default(''),
  /** Dodo Payments (self-serve plan upgrades). Blank API key = online
   *  payment off; the plan page says so instead of offering checkout. */
  DODO_PAYMENTS_API_KEY: z.string().optional().default(''),
  DODO_PAYMENTS_WEBHOOK_SECRET: z.string().optional().default(''),
  DODO_PAYMENTS_ENVIRONMENT: z.enum(['test_mode', 'live_mode']).default('test_mode'),
  /** Dodo product ids, one per plan + cycle (subscription products). */
  DODO_PRODUCT_SOLO_MONTHLY: z.string().optional().default(''),
  DODO_PRODUCT_SOLO_ANNUAL: z.string().optional().default(''),
  DODO_PRODUCT_PRACTICE_MONTHLY: z.string().optional().default(''),
  DODO_PRODUCT_PRACTICE_ANNUAL: z.string().optional().default(''),
  /** Self-serve email + password sign-up. New accounts are meant to come in
   *  through Google + WhatsApp OTP, so this is off in production unless set
   *  to 'true'; outside production it stays on unless set to 'false' (the
   *  e2e suites sign up with passwords). Existing users can always sign in
   *  with their password either way. */
  PASSWORD_SIGNUP: z.enum(['true', 'false']).optional(),
  /** Email + password sign-in. On everywhere unless set to 'false'
   *  (Google sign-in is offered alongside it). */
  PASSWORD_SIGNIN: z.enum(['true', 'false']).optional(),

  /** WhatsApp OTP delivery. 'console' logs the code to the API log (dev
   *  only - refused in production). 'wasi' sends the approved authentication
   *  template through the Wasi Hub API (wasi.sirahagents.com). 'meta' sends it
   *  through the WhatsApp Cloud API directly. */
  WHATSAPP_PROVIDER: z.enum(['console', 'wasi', 'meta']).default('console'),
  WASI_API_BASE_URL: z.string().default('https://wasi.sirahagents.com'),
  WASI_API_KEY: z.string().optional().default(''),
  /** Wasi account id (GET /api/v1/account -> client_id). Not a secret. */
  WASI_CLIENT_ID: z.string().optional().default(''),
  WHATSAPP_META_PHONE_NUMBER_ID: z.string().optional().default(''),
  WHATSAPP_META_ACCESS_TOKEN: z.string().optional().default(''),
  WHATSAPP_META_API_VERSION: z.string().default('v21.0'),
  /** Name + language of the approved authentication template. */
  WHATSAPP_OTP_TEMPLATE: z.string().default('test_message'),
  WHATSAPP_OTP_TEMPLATE_LANG: z.string().default('en'),

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
  // DifAi's own tenancy / matter / billing DB.
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

// FIELD_ENCRYPTION_KEY must decode to exactly 32 bytes (AES-256) when set -
// a truncated/garbled key would otherwise fail at the first encrypt/decrypt
// call deep inside a request instead of at boot.
let fieldEncryptionKey: Buffer | null = null;
if (parsed.data!.FIELD_ENCRYPTION_KEY) {
  const decoded = Buffer.from(parsed.data!.FIELD_ENCRYPTION_KEY, 'base64');
  if (decoded.length !== 32) {
    // eslint-disable-next-line no-console
    console.error(
      `FIELD_ENCRYPTION_KEY must decode (base64) to exactly 32 bytes for AES-256-GCM, got ${decoded.length}`,
    );
    process.exit(1);
  }
  fieldEncryptionKey = decoded;
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
  googleClientIds: parsed.data.GOOGLE_CLIENT_IDS.split(',').map((s) => s.trim()).filter(Boolean),
  dodo: {
    apiKey: parsed.data.DODO_PAYMENTS_API_KEY,
    webhookSecret: parsed.data.DODO_PAYMENTS_WEBHOOK_SECRET,
    baseUrl: parsed.data.DODO_PAYMENTS_ENVIRONMENT === 'live_mode'
      ? 'https://live.dodopayments.com'
      : 'https://test.dodopayments.com',
    products: {
      solo: { monthly: parsed.data.DODO_PRODUCT_SOLO_MONTHLY, annual: parsed.data.DODO_PRODUCT_SOLO_ANNUAL },
      practice: { monthly: parsed.data.DODO_PRODUCT_PRACTICE_MONTHLY, annual: parsed.data.DODO_PRODUCT_PRACTICE_ANNUAL },
    },
  },
  passwordSignupEnabled: parsed.data.NODE_ENV === 'production'
    ? parsed.data.PASSWORD_SIGNUP === 'true'
    : parsed.data.PASSWORD_SIGNUP !== 'false',
  passwordSigninEnabled: parsed.data.PASSWORD_SIGNIN !== 'false',
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
  hasSmtp: parsed.data.SMTP_HOST.length > 0,
  smtpSecure: parsed.data.SMTP_SECURE === 'true',
  hasRedis: parsed.data.REDIS_URL.length > 0,
  /** Engine client is enabled only when its URL is configured. */
  hasEngineService: parsed.data.ENGINE_SERVICE_URL.length > 0,
  /** Lowercased set of emails allowed onto the engine-routed Draft path. */
  engineRoutingAllowlist: new Set(
    parsed.data.ENGINE_ROUTING_ALLOWLIST.split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  ),
  /** Dev-only: open the engine-routed path to every logged-in user. Same
   *  double-gate as devAuthAutoProvision — inert when NODE_ENV='production'. */
  engineRoutingAllowAll:
    parsed.data.NODE_ENV !== 'production'
    && parsed.data.ENGINE_ROUTING_ALLOW_ALL === 'true',
  /** Deliberate production-wide open — NOT NODE_ENV-gated. See
   *  ENGINE_ROUTING_OPEN_PROD above. */
  engineRoutingOpenProd: parsed.data.ENGINE_ROUTING_OPEN_PROD === 'true',
  /** Run conversational intake with no LLM calls (deterministic extractor +
   *  plain questions). Not NODE_ENV-gated — it's a quality/cost trade-off, safe
   *  in any environment (it never fabricates; it just extracts less). */
  intakeDeterministic: parsed.data.INTAKE_DETERMINISTIC === 'true',
  intakeComposeEnabled: parsed.data.INTAKE_COMPOSE === 'true',
  /** The FAST provider/model the conversational intake extractor+classifier use,
   *  when configured (else they fall back to the drafting provider/model). Keeps
   *  intake responsive without downgrading the heavy General-AI drafting model. */
  intakeProvider: (parsed.data.INTAKE_PROVIDER || '') as 'anthropic' | 'xai' | '',
  intakeModel: parsed.data.INTAKE_MODEL || '',
  hasS3: parsed.data.STORAGE_DRIVER === 's3' || parsed.data.STORAGE_DRIVER === 'r2',
  storageS3ForcePathStyle: parsed.data.STORAGE_S3_FORCE_PATH_STYLE === 'true',
  /** Decoded 32-byte key, or null when FIELD_ENCRYPTION_KEY is unset. See
   *  src/lib/field-crypto.ts - encryptField/hmacEmailLookup throw if this
   *  is null, so booting without it is fine until an encrypted column is
   *  actually written to. */
  fieldEncryptionKey,
};
