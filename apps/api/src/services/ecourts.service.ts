import { call, withoutToken, fetchUrlBytes } from '../lib/ecourts';
import type {
  Court,
  CaseHistory,
  CauseListEntry,
  CourtEstablishment,
  District,
  State,
  CaseType,
} from '../lib/ecourts/types';
import { logger } from '../logger';

// =============================================================================
// ecourts.service
//
// High-level wrappers over the bare-bones lib/ecourts client. Two jobs:
//   1. Add a TTL cache around endpoints whose results don't change minute-to-
//      minute (states, districts, case types — reference data).
//   2. Normalise the response shape callers see — strip the per-response
//      `token` field (already folded back into the client's session cache)
//      and surface a typed top-level array / object where appropriate.
//
// In-process cache only (Map). Multi-replica deployments can layer Redis in
// later via lib/redis without touching callers.
// =============================================================================

interface CacheEntry<T> { value: T; expiresAt: number }
const REF_TTL_MS = 24 * 60 * 60 * 1000; // reference data — 24 hours
const CASE_TTL_MS = 5 * 60 * 1000;       // case lookups — 5 minutes
const cache = new Map<string, CacheEntry<unknown>>();

function cacheGet<T>(key: string): T | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return hit.value as T;
}

function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

async function memo<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const hit = cacheGet<T>(key);
  if (hit !== undefined) return hit;
  const value = await fetcher();
  cacheSet(key, value, ttlMs);
  return value;
}

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

export async function listStates(court: Court = 'DC'): Promise<State[]> {
  return memo(`states:${court}`, REF_TTL_MS, async () => {
    const endpoint = court === 'HC' ? 'stateWebService_hc.php' : 'stateWebService.php';
    const payload = await call(endpoint, { court }) as { states?: State[] } | null;
    return payload?.states ?? [];
  });
}

export async function listDistricts(stateCode: number, court: Court = 'DC'): Promise<District[]> {
  return memo(`districts:${court}:${stateCode}`, REF_TTL_MS, async () => {
    const payload = await call('districtWebService.php', {
      court,
      params: { state_code: stateCode },
    }) as { districts?: District[] } | null;
    return payload?.districts ?? [];
  });
}

export async function listCourtEstablishments(
  stateCode: number,
  distCode: number,
  court: Court = 'DC',
): Promise<CourtEstablishment[]> {
  return memo(`courtEst:${court}:${stateCode}:${distCode}`, REF_TTL_MS, async () => {
    const payload = await call('courtEstWebService.php', {
      court,
      params: { state_code: stateCode, dist_code: distCode },
    }) as { establishments?: CourtEstablishment[] } | null;
    return payload?.establishments ?? [];
  });
}

export async function listCaseTypes(
  stateCode: number,
  distCode: number,
  estCode: string,
  court: Court = 'DC',
): Promise<CaseType[]> {
  return memo(`caseTypes:${court}:${stateCode}:${distCode}:${estCode}`, REF_TTL_MS, async () => {
    const payload = await call('caseTypesWebService.php', {
      court,
      params: { state_code: stateCode, dist_code: distCode, est_code: estCode },
    }) as { caseTypes?: CaseType[] } | null;
    return payload?.caseTypes ?? [];
  });
}

export async function listActs(stateCode: number, court: Court = 'DC'): Promise<unknown[]> {
  return memo(`acts:${court}:${stateCode}`, REF_TTL_MS, async () => {
    const payload = await call('actWebService.php', {
      court,
      params: { state_code: stateCode },
    }) as { acts?: unknown[] } | null;
    return payload?.acts ?? [];
  });
}

export async function listPoliceStations(
  stateCode: number,
  distCode: number,
  court: Court = 'DC',
): Promise<unknown[]> {
  return memo(`policeStations:${court}:${stateCode}:${distCode}`, REF_TTL_MS, async () => {
    const payload = await call('policeStationWebService.php', {
      court,
      params: { state_code: stateCode, dist_code: distCode },
    }) as { policeStations?: unknown[] } | null;
    return payload?.policeStations ?? [];
  });
}

// ---------------------------------------------------------------------------
// Case detail + searches
// ---------------------------------------------------------------------------

/** Full case history by CNR. The CNR is the 16-char national case identifier
 *  (e.g. `KLER010001682023`). */
export async function lookupByCnr(
  cino: string,
  court: Court = 'DC',
): Promise<CaseHistory | null> {
  const cleanCino = cino.trim().toUpperCase();
  // 4 letters (state + district) + 12 alphanumeric. Establishment code at
  // positions 5-6 can be alphanumeric (e.g. `0B` for Alandur JM in TNCG0B…),
  // so a `\d{12}$` suffix would reject valid CNRs.
  if (!/^[A-Z]{4}[A-Z0-9]{12}$/.test(cleanCino)) {
    throw new Error('CNR must be 16 chars: 4 letters followed by 12 alphanumeric');
  }
  return memo(`cnr:${court}:${cleanCino}`, CASE_TTL_MS, async () => {
    const payload = await call('caseHistoryWebService.php', {
      court,
      params: { cino: cleanCino },
    }) as { history?: CaseHistory } | null;
    return payload?.history ?? null;
  });
}

interface SearchByCaseNumberInput {
  stateCode: number;
  distCode: number;
  courtCode: number;
  estCode: string;
  caseType: string | number;
  regNo: number | string;
  year: number;
  court?: Court;
}

export async function searchByCaseNumber(input: SearchByCaseNumberInput): Promise<unknown> {
  const payload = await call('caseNumberSearch.php', {
    court: input.court ?? 'DC',
    params: {
      state_code: input.stateCode,
      dist_code: input.distCode,
      court_code: input.courtCode,
      est_code: input.estCode,
      case_type: input.caseType,
      reg_no: input.regNo,
      reg_year: input.year,
    },
  });
  return stripToken(payload);
}

interface SearchByPartyInput {
  stateCode: number;
  distCode: number;
  courtCode: number;
  estCode: string;
  partyName: string;
  year: number;
  stage?: 'P' | 'D' | 'B'; // pending / disposed / both
  court?: Court;
}

export async function searchByPartyName(input: SearchByPartyInput): Promise<unknown> {
  const payload = await call('searchByPartyName.php', {
    court: input.court ?? 'DC',
    params: {
      state_code: input.stateCode,
      dist_code: input.distCode,
      court_code: input.courtCode,
      est_code: input.estCode,
      petres_name: input.partyName,
      reg_year: input.year,
      caseStatus: input.stage ?? 'B',
    },
  });
  return stripToken(payload);
}

interface SearchByAdvocateInput {
  stateCode: number;
  distCode: number;
  courtCode: number;
  estCode: string;
  advocateName: string;
  year: number;
  stage?: 'P' | 'D' | 'B';
  court?: Court;
}

export async function searchByAdvocateName(input: SearchByAdvocateInput): Promise<unknown> {
  const payload = await call('searchByAdvocateName.php', {
    court: input.court ?? 'DC',
    params: {
      state_code: input.stateCode,
      dist_code: input.distCode,
      court_code: input.courtCode,
      est_code: input.estCode,
      advname: input.advocateName,
      reg_year: input.year,
      caseStatus: input.stage ?? 'B',
    },
  });
  return stripToken(payload);
}

interface SearchByFirInput {
  stateCode: number;
  distCode: number;
  courtCode: number;
  estCode: string;
  policeStCode: number;
  firNo: string;
  firYear: number;
  court?: Court;
}

export async function searchByFirNumber(input: SearchByFirInput): Promise<unknown> {
  const payload = await call('firNumberSearch.php', {
    court: input.court ?? 'DC',
    params: {
      state_code: input.stateCode,
      dist_code: input.distCode,
      court_code: input.courtCode,
      est_code: input.estCode,
      police_st_code: input.policeStCode,
      fir_no: input.firNo,
      fir_year: input.firYear,
    },
  });
  return stripToken(payload);
}

interface SearchByFilingNumberInput {
  stateCode: number;
  distCode: number;
  courtCode: number;
  estCode: string;
  filingNo: string;
  filingYear: number;
  court?: Court;
}

export async function searchByFilingNumber(input: SearchByFilingNumberInput): Promise<unknown> {
  const payload = await call('searchByFilingNumberWebService.php', {
    court: input.court ?? 'DC',
    params: {
      state_code: input.stateCode,
      dist_code: input.distCode,
      court_code: input.courtCode,
      est_code: input.estCode,
      fil_no: input.filingNo,
      fil_year: input.filingYear,
    },
  });
  return stripToken(payload);
}

interface SearchByActInput {
  stateCode: number;
  distCode: number;
  courtCode: number;
  estCode: string;
  actCode: number | string;
  section?: string;
  year?: number;
  court?: Court;
}

export async function searchByAct(input: SearchByActInput): Promise<unknown> {
  const payload = await call('searchByActWebService.php', {
    court: input.court ?? 'DC',
    params: {
      state_code: input.stateCode,
      dist_code: input.distCode,
      court_code: input.courtCode,
      est_code: input.estCode,
      act_code: input.actCode,
      section: input.section ?? '',
      reg_year: input.year ?? '',
    },
  });
  return stripToken(payload);
}

// ---------------------------------------------------------------------------
// Cause list
// ---------------------------------------------------------------------------

interface CauseListInput {
  stateCode: number;
  distCode: number;
  courtCode: number;
  estCode: string;
  /** YYYY-MM-DD */
  date: string;
  court?: Court;
}

export async function fetchCauseList(input: CauseListInput): Promise<CauseListEntry[]> {
  const payload = await call('causeListWebService.php', {
    court: input.court ?? 'DC',
    params: {
      state_code: input.stateCode,
      dist_code: input.distCode,
      court_code: input.courtCode,
      est_code: input.estCode,
      causelist_dt: input.date,
    },
  }) as { causeList?: CauseListEntry[] } | null;
  return payload?.causeList ?? [];
}

// ---------------------------------------------------------------------------
// Caveat
// ---------------------------------------------------------------------------

interface CaveatSearchInput {
  stateCode: number;
  distCode: number;
  estCode: string;
  caveatorName?: string;
  caveateeName?: string;
  year?: number;
  court?: Court;
}

export async function searchCaveat(input: CaveatSearchInput): Promise<unknown> {
  const payload = await call('searchCaveat.php', {
    court: input.court ?? 'DC',
    params: {
      state_code: input.stateCode,
      dist_code: input.distCode,
      est_code: input.estCode,
      caveator_name: input.caveatorName ?? '',
      caveatee_name: input.caveateeName ?? '',
      reg_year: input.year ?? '',
    },
  });
  return stripToken(payload);
}

// ---------------------------------------------------------------------------
// Order / judgment PDFs
// ---------------------------------------------------------------------------

interface OrderPdfInput {
  cino: string;
  filename: string;
  stateCd: number;
  distCd: number;
  courtCode: number;
  court?: Court;
}

export interface OrderPdfBytes {
  bytes: Buffer;
  /** Suggested filename for Content-Disposition (e.g. `KLER010001682023_2.pdf`). */
  suggestedFilename: string;
}

/**
 * Fetch a single order / judgment PDF.
 *
 * Two-step protocol (observed on the wire):
 *   1. `GET display_pdf_new.php?params=<encrypted{filename,cino,state_cd,
 *      dist_cd,court_code}>` returns an encrypted JSON envelope of shape
 *      `{ status: 'Y', pdf_url: '…?pdf_token=<one-shot>', token: <jwt> }`.
 *   2. `GET <pdf_url>` (no auth, no encryption wrapper) returns the binary
 *      PDF prefixed by a CRLF that we strip.
 *
 * The pdf_token is single-use, so we MUST consume it here on the server
 * (streaming to the client) rather than handing the URL back to the browser.
 *
 * Returns the raw bytes and a suggested filename derived from the upstream
 * `filename` field.
 */
export async function fetchOrderPdf(input: OrderPdfInput): Promise<OrderPdfBytes> {
  const envelope = await call('display_pdf_new.php', {
    court: input.court ?? 'DC',
    params: {
      filename:   input.filename,
      cino:       input.cino,
      state_cd:   input.stateCd,
      dist_cd:    input.distCd,
      court_code: input.courtCode,
    },
  }) as { status?: string; pdf_url?: string; Msg?: string } | null;

  if (!envelope || envelope.status !== 'Y' || !envelope.pdf_url) {
    throw new Error(`eCourts returned no PDF URL (status=${envelope?.status ?? 'unknown'}, msg=${envelope?.Msg ?? ''})`);
  }

  // Step 2: pull the actual bytes. The token in pdf_url is one-shot, so we
  // can't redirect the browser — we have to stream it back.
  const bytes = await fetchUrlBytes(envelope.pdf_url, { stripLeadingWhitespace: true });
  if (bytes.length < 4 || bytes.subarray(0, 4).toString() !== '%PDF') {
    throw new Error('eCourts PDF response did not start with %PDF magic bytes');
  }
  return {
    bytes,
    suggestedFilename: deriveFilename(input.filename, input.cino),
  };
}

function deriveFilename(rawPath: string, cino: string): string {
  // rawPath looks like `/orders/2023/204600000772023_2.pdf` — strip the dir,
  // keep the base, fall back to `<cino>.pdf` if anything looks off.
  const base = rawPath.split('/').filter(Boolean).pop();
  if (!base || !base.toLowerCase().endsWith('.pdf')) return `${cino}.pdf`;
  return base;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function stripToken(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return payload;
  return withoutToken(payload as Record<string, unknown>);
}

// Re-exports so route handlers can import everything they need from one place.
export { EcourtsHttpError, EcourtsSessionError } from '../lib/ecourts';
export type { Court } from '../lib/ecourts';

// Surfaced for tests / debugging.
export function _clearEcourtsCache(): void {
  cache.clear();
  logger.debug('eCourts cache cleared');
}
