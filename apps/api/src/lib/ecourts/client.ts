import { logger } from '../../logger';
import { decryptResponse, encryptParams } from './crypto';
import type { Court } from './types';

const BASE_URL_DC = 'https://app.ecourts.gov.in/services_DC_4.0/';
const BASE_URL_HC = 'https://app.ecourts.gov.in/services_HC_4.0/';

const DEFAULT_TIMEOUT_MS = 30_000;
const USER_AGENT = 'okhttp/4.12.0';
// Refresh the bootstrap JWT this many seconds before its `exp` claim. The
// server issues 10-minute tokens; expiring a few minutes early avoids racing
// the clock when a slow request lands right at the boundary.
const JWT_REFRESH_SAFETY_S = 90;

interface TokenSlot {
  jwt: string;
  exp: number; // unix seconds
}

const tokenCache: Record<Court, TokenSlot | null> = { DC: null, HC: null };

function baseUrlFor(court: Court): string {
  return court === 'HC' ? BASE_URL_HC : BASE_URL_DC;
}

function parseJwtExp(jwt: string): number {
  // The token is HS256-signed; we never validate the signature client-side
  // (only the eCourts server holds the secret) — we just decode the payload
  // to read the `exp` claim so we know when to refresh.
  const parts = jwt.split('.');
  if (parts.length !== 3) throw new Error('Malformed eCourts JWT');
  const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'));
  if (typeof payload.exp !== 'number') throw new Error('eCourts JWT missing exp claim');
  return payload.exp;
}

function tokenStillFresh(slot: TokenSlot | null): slot is TokenSlot {
  if (!slot) return false;
  return slot.exp - JWT_REFRESH_SAFETY_S > Math.floor(Date.now() / 1000);
}

/**
 * Capture a refreshed JWT from any response payload. Most endpoints return a
 * fresh `token` field alongside their data; using it keeps the session alive
 * without a dedicated re-bootstrap round trip.
 */
function captureToken(court: Court, payload: unknown): void {
  if (!payload || typeof payload !== 'object') return;
  const token = (payload as { token?: unknown }).token;
  if (typeof token !== 'string' || token.length === 0) return;
  try {
    tokenCache[court] = { jwt: token, exp: parseJwtExp(token) };
  } catch (err) {
    logger.warn({ err }, 'eCourts: failed to parse refreshed JWT, keeping previous token');
  }
}

interface RawCallOptions {
  court?: Court;
  params?: Record<string, unknown>;
  bearer?: string | null;
  /** GET is the protocol's standard verb. POST works for some endpoints but
   *  the bootstrap server only mints a JWT when the bootstrap call is GET. */
  method?: 'GET';
  signal?: AbortSignal;
}

/** Perform one encrypted round-trip and return the *parsed JSON object*. The
 *  caller is responsible for retrying / token capture; use `call()` for the
 *  normal happy path which handles both. */
async function rawCall(endpoint: string, opts: RawCallOptions): Promise<unknown> {
  const court = opts.court ?? 'DC';
  const url = new URL(baseUrlFor(court) + endpoint);
  url.searchParams.set('params', encryptParams(opts.params ?? {}));

  const headers: Record<string, string> = { 'User-Agent': USER_AGENT };
  if (opts.bearer) headers.Authorization = `Bearer ${opts.bearer}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  const compositeSignal = opts.signal
    ? AbortSignal.any([controller.signal, opts.signal])
    : controller.signal;

  let res: Response;
  try {
    res = await fetch(url, { method: opts.method ?? 'GET', headers, signal: compositeSignal });
  } finally {
    clearTimeout(timer);
  }

  const body = await res.text();
  if (!res.ok) {
    throw new EcourtsHttpError(res.status, `eCourts ${endpoint} returned ${res.status}`, body);
  }

  // Empty body → server accepted but had nothing to say. Treat as null
  // payload so callers can decide whether to retry or surface a 502.
  if (body.trim().length === 0) return null;

  const plaintext = decryptResponse(body);
  return JSON.parse(plaintext);
}

export class EcourtsHttpError extends Error {
  constructor(public status: number, message: string, public bodySnippet?: string) {
    super(message);
    this.name = 'EcourtsHttpError';
  }
}

export class EcourtsSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EcourtsSessionError';
  }
}

/** Bootstrap a fresh session JWT by hitting `appReleaseWebService.php`. */
async function bootstrap(court: Court): Promise<TokenSlot> {
  logger.debug({ court }, 'eCourts: bootstrapping JWT');
  const payload = await rawCall('appReleaseWebService.php', {
    court,
    params: { version: '4.0' },
  }) as { token?: string | null; version_compatible?: string } | null;

  if (!payload || typeof payload.token !== 'string' || payload.token.length === 0) {
    throw new EcourtsSessionError(
      `eCourts bootstrap returned no token (version_compatible=${payload?.version_compatible ?? 'unknown'})`,
    );
  }
  const slot: TokenSlot = { jwt: payload.token, exp: parseJwtExp(payload.token) };
  tokenCache[court] = slot;
  return slot;
}

async function ensureToken(court: Court): Promise<string> {
  const cached = tokenCache[court];
  if (tokenStillFresh(cached)) return cached.jwt;
  return (await bootstrap(court)).jwt;
}

interface CallOptions {
  court?: Court;
  params?: Record<string, unknown>;
  signal?: AbortSignal;
}

/**
 * Call any authenticated eCourts endpoint. Bootstraps a JWT if needed, retries
 * once on a session-rejection response, and captures any refreshed token from
 * the payload back into the cache.
 *
 * Returns the decrypted JSON payload (whatever shape the endpoint produces).
 */
export async function call(endpoint: string, opts: CallOptions = {}): Promise<unknown> {
  const court = opts.court ?? 'DC';
  let bearer = await ensureToken(court);
  let payload = await rawCall(endpoint, {
    court,
    params: opts.params,
    bearer,
    signal: opts.signal,
  });

  // Status-"N" envelopes mean the server rejected our session — usually a
  // token that expired between `ensureToken` and the actual request landing.
  // One retry with a fresh token covers the race and `status: "N"` on
  // genuinely bad input (e.g. malformed CNR) gets returned to the caller
  // unchanged on the second attempt.
  if (isSessionRejection(payload)) {
    logger.debug({ endpoint, court }, 'eCourts: session rejected, re-bootstrapping');
    tokenCache[court] = null;
    bearer = await ensureToken(court);
    payload = await rawCall(endpoint, {
      court,
      params: opts.params,
      bearer,
      signal: opts.signal,
    });
  }

  captureToken(court, payload);
  return payload;
}

function isSessionRejection(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as { status?: unknown; Msg?: unknown };
  if (p.status !== 'N') return false;
  const msg = typeof p.Msg === 'string' ? p.Msg : '';
  return /auth_token|not in session/i.test(msg);
}

/** Strip the `token` field that every response carries — most callers don't
 *  care, and the token has already been folded back into the cache by the
 *  time they see the payload. */
export function withoutToken<T extends Record<string, unknown>>(payload: T): Omit<T, 'token'> {
  const { token: _drop, ...rest } = payload;
  return rest;
}

/**
 * GET an absolute URL and return the raw response body as a Buffer.
 *
 * Used by the PDF flow: `display_pdf_new.php` returns an encrypted JSON
 * envelope with a one-shot `pdf_url`. The client calls THIS helper next to
 * stream the actual PDF bytes from that URL. No encryption layer on this
 * second hop — bytes are returned as-is.
 *
 * The eCourts server prepends a CRLF to PDF responses (`0d 0a 25 50 44 46 …`),
 * so the caller should pass `stripLeadingWhitespace: true` for PDFs to get a
 * byte stream that starts cleanly with `%PDF-`.
 */
export async function fetchUrlBytes(
  url: string,
  opts: { signal?: AbortSignal; stripLeadingWhitespace?: boolean } = {},
): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  const compositeSignal = opts.signal
    ? AbortSignal.any([controller.signal, opts.signal])
    : controller.signal;
  let res: Response;
  try {
    res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: compositeSignal });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    throw new EcourtsHttpError(res.status, `eCourts URL fetch returned ${res.status}`);
  }
  let bytes = Buffer.from(await res.arrayBuffer());
  if (opts.stripLeadingWhitespace) {
    let i = 0;
    while (i < bytes.length && (bytes[i] === 0x0d || bytes[i] === 0x0a
      || bytes[i] === 0x20 || bytes[i] === 0x09)) i++;
    if (i > 0) bytes = bytes.subarray(i);
  }
  return bytes;
}

// ---- testing seam --------------------------------------------------------
// Internal helper used by unit tests to reset the in-memory JWT cache between
// runs. Exported deliberately under an underscore-prefixed name to discourage
// production callers.
export function _resetTokenCacheForTests(): void {
  tokenCache.DC = null;
  tokenCache.HC = null;
}
