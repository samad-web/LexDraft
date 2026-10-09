import { call, withoutToken, fetchUrlBytes, EcourtsHttpError } from '../lib/ecourts';
import { db } from '../db/client';
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
    // `stateWebService_hc.php` is a dead/wrong endpoint - verified live it
    // returns a generic {"status":"N","msg":"error"} regardless of params.
    // The plain `stateWebService.php` works correctly against BOTH base URLs
    // (services_DC_4.0 and services_HC_4.0) - which endpoint you hit is
    // determined entirely by the base URL `call()` selects via `court`, not
    // by a different filename. Verified live: against the HC base URL this
    // returns real High Court entries (e.g. "Allahabad High Court").
    const payload = await call('stateWebService.php', { court }) as { states?: State[] } | null;
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
    // Param names verified against the official eCourts APK (React Native /
    // Hermes bundle, decompiled with hermes-dec). The app builds this payload
    // via Object.assign of { state_code, dist_code } + { court_code_arr } +
    // { establishment_state_code, establishment_district_code }. We send the
    // full superset so the field-name validation passes.
    //
    // KNOWN LIMITATION (verified live 2026-09): even with the exact APK param
    // names, this endpoint returns {status:'N', msg:'ERROR_ERROR'} from a
    // server-side client, while stateWebService / districtWebService /
    // caseHistory (CNR) all succeed through the *same* client + crypto. The
    // establishment endpoint has an additional session/device binding the app
    // satisfies at runtime that a headless caller cannot reproduce. Court-
    // location search is therefore served via the human-in-the-loop flow in
    // the web app (open eCourts -> import by CNR), not this call. See
    // memory/ecourts-apk-establishment-params.md.
    const payload = await call('courtEstWebService.php', {
      court,
      params: {
        state_code: stateCode,
        dist_code: distCode,
        court_code_arr: '',
        establishment_state_code: stateCode,
        establishment_district_code: distCode,
      },
    }) as { establishments?: CourtEstablishment[] } | null;
    return payload?.establishments ?? [];
  });
}

export interface CachedCourtComplex {
  complexCode: string;
  complexName: string;
  courtCodes: string[];
}

/**
 * Court-complex directory served from our own cache (see migration
 * 0071_ecourts_court_complexes.sql), NOT a live eCourts call. The live
 * lookup is blocked for automated callers (see listCourtEstablishments
 * above) - this table is captured once per district via a real browser
 * session and reused indefinitely, matching what the eCourts website itself
 * shows in its "Select Court Complex" dropdown.
 *
 * Returns an empty list for a district we haven't captured yet - callers
 * should fall back to a manual establishment-code text field in that case.
 */
export async function listCachedCourtComplexes(
  stateCode: number,
  distCode: number,
  court: Court = 'DC',
): Promise<CachedCourtComplex[]> {
  const sql = db();
  if (!sql) return [];
  const rows = await sql<Array<{ complex_code: string; complex_name: string; court_codes: string[] }>>`
    select complex_code, complex_name, court_codes
    from ecourts_court_complexes
    where court = ${court} and state_code = ${stateCode} and dist_code = ${distCode}
    order by complex_name
  `;
  return rows.map((r) => ({ complexCode: r.complex_code, complexName: r.complex_name, courtCodes: r.court_codes }));
}

export interface CachedCourt {
  courtCode: string;
  courtName: string;
}

/**
 * Individual courts within a complex (see migration 0072_ecourts_courts.sql).
 * A complex is a building; a case is filed at a specific court inside it -
 * selecting only the complex isn't enough to search correctly (verified
 * live: only 1 of 6 courts in "Court Complex, Chengannur" had the matching
 * case; the others returned zero results for the identical search).
 */
export async function listCachedCourts(
  stateCode: number,
  distCode: number,
  complexCode: string,
  court: Court = 'DC',
): Promise<CachedCourt[]> {
  const sql = db();
  if (!sql) return [];
  const rows = await sql<Array<{ court_code: string; court_name: string }>>`
    select court_code, court_name
    from ecourts_courts
    where court = ${court} and state_code = ${stateCode} and dist_code = ${distCode} and complex_code = ${complexCode}
    order by court_name
  `;
  return rows.map((r) => ({ courtCode: r.court_code, courtName: r.court_name }));
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
  // REQUIRED - see searchByPartyName for why (court_code_arr empty = 0
  // establishments searched, not a real "no result").
  estCode: string;
  caseType: string | number;
  regNo: number | string;
  year: number;
  court?: Court;
}

export async function searchByCaseNumber(input: SearchByCaseNumberInput): Promise<unknown> {
  // Field names verified live against the real backend (full systematic APK
  // re-audit, 2026-10): the registration-number field is `case_number`, not
  // `reg_no`/`reg_year` - the old names returned `error_ERROR_case_no` on
  // every search. `year` (not `reg_year`) is the field name here. Verified:
  // identical court/case_type/number with the corrected fields returns the
  // real case; the old fields never worked.
  //
  // court_code_arr FIX (2026-10, live-probed against KLER01/state 4/dist 2/
  // court 1, CNR KLER010001682023 as ground truth): `court_code_arr` is NOT
  // the establishment-code string - sending `input.estCode` (bare or array-
  // wrapped) both produce `{"no_of_establishments":0}` (array-wrapping a
  // string actually 500s). The field is the *numeric* `court_code`, sent as
  // a bare scalar (NOT array-wrapped - array-wrapping the number also 500s).
  // Verified live: `court_code_arr: input.courtCode` returns real
  // `no_of_establishments:1` with the exact case row; every other shape
  // tried (string, array-of-string, array-of-number, array-of-object,
  // JSON-stringified array) either 500s or silently reports zero
  // establishments searched.
  const params: Record<string, unknown> = {
    state_code: input.stateCode,
    dist_code: input.distCode,
    court_code: input.courtCode,
    court_code_arr: input.courtCode,
    case_type: input.caseType,
    case_number: input.regNo,
    year: input.year,
    bilingual_flag: 0,
  };
  const payload = await call('caseNumberSearch.php', { court: input.court ?? 'DC', params });
  return stripToken(payload);
}

interface SearchByPartyInput {
  stateCode: number;
  distCode: number;
  courtCode: number;
  // REQUIRED, despite earlier assumptions. Without it, `court_code_arr` is
  // sent empty and eCourts searches zero establishments - it replies
  // `{"no_of_establishments":0}` (not an error!), which reads exactly like a
  // real "no matching case" result unless you know to expect it. Verified
  // live: sending the same query with `court_code_arr` populated from a real
  // establishment code returns actual case rows.
  estCode: string;
  partyName: string;
  year: number;
  // Accepted for API-shape compatibility, but NOT sent upstream - the live
  // endpoint rejects the request outright if `pendingDisposed` is present in
  // any form (see below for the verified detail).
  stage?: 'P' | 'D' | 'B';
  court?: Court;
}

export async function searchByPartyName(input: SearchByPartyInput): Promise<unknown> {
  // Field names/shape verified live against the real backend (decrypted raw
  // responses, not just error strings):
  //  - the party-name field is `pet_name`, not `petres_name` - the old name
  //    made every search fail validation (`error_ERROR_pet4`).
  //  - `pendingDisposed` must be OMITTED, not sent as 'P'/'D'/'B' - sending it
  //    at all (any value) triggers `ERROR_SPL4---pendingDisposed`. Filtering
  //    by pending/disposed isn't available through this endpoint; every
  //    search returns both.
  //  - `court_code_arr` must carry a value to scope the search - state/dist
  //    alone is not enough; sending it empty silently returns zero
  //    establishments searched, which LOOKS like "no cases found" but isn't
  //    a real answer.
  //
  // court_code_arr FIX (2026-10, live-probed against KLER01/state 4/dist 2/
  // court 1, CNR KLER010001682023 as ground truth): the earlier assumption
  // that `court_code_arr` carries the establishment code `estCode` as a
  // string was WRONG - that shape (bare or array-wrapped) returns
  // `{"no_of_establishments":0}` (array-wrapping the string 500s). The field
  // is actually the *numeric* `court_code`, sent as a bare scalar (array-
  // wrapping the number also 500s). Verified live:
  // `court_code_arr: input.courtCode` returns `no_of_establishments:1` with
  // real case rows (including cases matching `partyName: 'Ajayakumar'`,
  // recovering the known CNR among them). `est_code` is left in the payload
  // unchanged - it's accepted as an extra field and may still matter for
  // other validation paths.
  const params: Record<string, unknown> = {
    state_code: input.stateCode,
    dist_code: input.distCode,
    court_code: input.courtCode,
    court_code_arr: input.courtCode,
    est_code: input.estCode,
    pet_name: input.partyName,
    year: input.year,
    bilingual_flag: 0,
  };
  const payload = await call('searchByPartyName.php', { court: input.court ?? 'DC', params });
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
  // Fixed via full systematic APK re-audit (2026-10). This endpoint's submit
  // handler is shared across advocate-name/bar-code/case-list search modes,
  // switched by `checkedSearchByRadioValue` ('1' = advocate name, '2' = bar
  // code) - that field was missing entirely, which is what produced
  // `error_ERRORsearchtype3` on every call regardless of the other fields
  // being correct. There is no separate `est_code` - only `court_code_arr` -
  // and `pendingDisposed` must be present (empty string), matching the FIR/
  // filing-number endpoints. Verified live: identical court/name/year with
  // the radio-value field added returns real case data; without it, every
  // request is rejected before the search even runs.
  // court_code_arr FIX (2026-10, live-probed against KLER01/state 4/dist 2/
  // court 1): same bug as searchByPartyName/searchByCaseNumber -
  // `court_code_arr` is the numeric `court_code`, not `estCode`, sent as a
  // bare scalar. Verified live: with this fix, searching advocate name
  // "Sruthi Das" against this tuple returns real `no_of_establishments:1`
  // with case rows.
  const params: Record<string, unknown> = {
    bilingual_flag: 0,
    state_code: input.stateCode,
    dist_code: input.distCode,
    court_code_arr: input.courtCode,
    court_code: input.courtCode,
    checkedSearchByRadioValue: '1',
    pendingDisposed: '',
    advocateName: input.advocateName,
    year: input.year,
  };
  const payload = await call('searchByAdvocateName.php', { court: input.court ?? 'DC', params });
  return stripToken(payload);
}

interface SearchByFirInput {
  stateCode: number;
  distCode: number;
  courtCode: number;
  // REQUIRED - see searchByPartyName for why.
  estCode: string;
  policeStCode: number;
  firNo: string;
  firYear: number;
  court?: Court;
}

export async function searchByFirNumber(input: SearchByFirInput): Promise<unknown> {
  // Field names verified live against the real backend (full systematic APK
  // re-audit, 2026-10): the police-station field is `police_stationcode`, not
  // `police_st_code` - the old name returned `error_ERROR_pst3` on every
  // search regardless of the FIR number/year fields. The FIR fields
  // themselves are `firNumber`/`year` (not `fir_no`/`fir_year`), and there is
  // no separate `est_code` - only `court_code_arr`. `pendingDisposed` is
  // included (empty string) here, matching the APK trace exactly - unlike
  // party search, where any value in that field triggers rejection.
  // court_code_arr FIX (2026-10, live-probed against KLER01/state 4/dist 2/
  // court 1): same bug as the other search endpoints - `court_code_arr` is
  // the numeric `court_code`, not `estCode`, sent as a bare scalar. Verified
  // live: with this fix, the request returns a real `no_of_establishments:1`
  // envelope (an empty `caseNos: []` for the probed FIR number/year is a
  // legitimate "no match", not the zero-establishments failure mode).
  const params: Record<string, unknown> = {
    bilingual_flag: 0,
    state_code: input.stateCode,
    dist_code: input.distCode,
    language_flag: 0,
    court_code_arr: input.courtCode,
    court_code: input.courtCode,
    pendingDisposed: '',
    firNumber: input.firNo,
    year: input.firYear,
    police_stationcode: input.policeStCode,
  };
  const payload = await call('firNumberSearch.php', { court: input.court ?? 'DC', params });
  return stripToken(payload);
}

interface SearchByFilingNumberInput {
  stateCode: number;
  distCode: number;
  courtCode: number;
  // REQUIRED - see searchByPartyName for why.
  estCode: string;
  filingNo: string;
  filingYear: number;
  court?: Court;
}

export async function searchByFilingNumber(input: SearchByFilingNumberInput): Promise<unknown> {
  // Field names verified live against the real backend (full systematic APK
  // re-audit, 2026-10): `fil_no`/`fil_year`/`est_code` caused a hard 500 on
  // every search. The real fields are `filingNumber`/`year` (camelCase,
  // matching the FIR search convention), and there is no separate `est_code`
  // - only `court_code_arr`. Verified: identical court/number/year with the
  // corrected fields returns real case data; the old fields always 500'd.
  // court_code_arr FIX (2026-10, live-probed against KLER01/state 4/dist 2/
  // court 1, CNR KLER010001682023 as ground truth): same bug as the other
  // search endpoints - `court_code_arr` is the numeric `court_code`, not
  // `estCode`, sent as a bare scalar. Verified live: with this fix, filing
  // number 100095/2023 (the known filing_no for the ground-truth CNR)
  // returns real `no_of_establishments:1` and recovers that exact CNR in
  // the result rows.
  const params: Record<string, unknown> = {
    bilingual_flag: 0,
    state_code: input.stateCode,
    dist_code: input.distCode,
    court_code_arr: input.courtCode,
    court_code: input.courtCode,
    filingNumber: input.filingNo,
    year: input.filingYear,
  };
  const payload = await call('searchByFilingNumberWebService.php', { court: input.court ?? 'DC', params });
  return stripToken(payload);
}

interface SearchByActInput {
  stateCode: number;
  distCode: number;
  courtCode: number;
  // REQUIRED - see searchByPartyName for why.
  estCode: string;
  actCode: number | string;
  section?: string;
  year?: number;
  pendingDisposed?: string;
  court?: Court;
}

export async function searchByAct(input: SearchByActInput): Promise<unknown> {
  // CONFIRMED STILL BROKEN — full Hermes bytecode DECOMPILE (not just
  // disassembly) of the official APK, 2026-10, using hbc-decompiler for
  // readable pseudocode instead of raw opcodes. This resolved the other two
  // "KNOWN BROKEN" endpoints (fetchCauseList, searchCaveat) by tracing
  // `useState` origins the disassembler's raw register ops couldn't show,
  // but it does NOT resolve this one. The decompiled onSubmit (function
  // #17456) shows a LOCAL validation-only object capturing `court_complex`/
  // `actType`, which is only ever passed to the form validator and an
  // `Object.keys(...).length === 0` check — never merged into the real
  // request params (bilingual_flag/state_code/dist_code/court_code_arr|
  // court_code/pendingDisposed only). That reading was then live-tested
  // (2026-10) across every combination of those confirmed-correct fields
  // plus every act-code spelling previously tried, against TWO different
  // live establishments (Kerala KLER01 and Tamil Nadu TNCH0C, re-derived
  // fresh from live CNR lookups, not cached) - every single call, including
  // ones that EXACTLY mirror the known-working searchByAdvocateName shape,
  // returns the identical `error_ERROR_actcode1`. Conclusion: the server
  // unconditionally demands an act-code-shaped field regardless of what's
  // sent, which the decompiled client-side code never actually provides in
  // this APK build - i.e. the official app's own "Search by Act" screen is
  // itself non-functional against the live backend today, not just
  // unreverse-engineered. There is no client-observable field name to
  // discover by any means short of eCourts' own server source. Do not treat
  // a `status:"N"` response from this endpoint as "no matching cases".
  const params: Record<string, unknown> = {
    state_code: input.stateCode,
    dist_code: input.distCode,
    court_code: input.courtCode,
    court_code_arr: input.estCode,
    act_code: input.actCode,
    section: input.section ?? '',
    reg_year: input.year ?? '',
    pendingDisposed: input.pendingDisposed ?? '',
  };
  const payload = await call('searchByActWebService.php', { court: input.court ?? 'DC', params });
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

/** `DD-MM-YYYY`, zero-padded — the exact format the official app builds via
 *  `getDate()`/`getMonth()+1`/`getFullYear()` string concatenation. */
function toEcourtsDMY(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00`);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${d.getFullYear()}`;
}

export async function fetchCauseList(input: CauseListInput): Promise<CauseListEntry[]> {
  // FIXED - full Hermes bytecode DECOMPILE (hbc-decompiler, readable
  // pseudocode, not just raw disassembly opcodes) of the official APK,
  // 2026-10, cross-checked against a LIVE call. This screen's onSubmit
  // (function #17181) is a shared "Search By" form (Advocate Name / Bar Code
  // / Date Case List) gated by `checkedSearchByRadioValue`, whose radio
  // options are rendered with literal values '1' (Advocate Name), '2' (Bar
  // Code), '3' ("Date Case List" - confirmed from the adjacent label string
  // in the same JSX). The '3' branch builds:
  //   bilingual_flag, state_code, dist_code, (court_code_arr | court_code),
  //   checkedSearchByRadioValue: '3', pendingDisposed, date: 'DD-MM-YYYY'
  // (date built via getDate()/getMonth()+1/getFullYear(), zero-padded,
  // dash-joined - NOT `causelist_dt`, which is just the unused local Redux
  // field name). Prior attempts correctly found `date` replacing
  // `causelist_dt` but never located `checkedSearchByRadioValue: '3'`, since
  // that value lives in a sibling form component, not this function. LIVE
  // CONFIRMED (2026-10, TN establishment TNCH0C): no error, clean
  // `{causeList: [...]}` shape — 0 entries for "today", which is a
  // legitimate answer (no list published for that date), not a validation
  // failure. `pendingDisposed: 'Pending'` matches the UI's own default value
  // for that field (a useState('Pending') in the decompiled source);
  // untested whether 'Disposed' or omitting it changes results.
  const payload = await call('causeListWebService.php', {
    court: input.court ?? 'DC',
    params: {
      bilingual_flag: 0,
      state_code: input.stateCode,
      dist_code: input.distCode,
      court_code_arr: input.estCode,
      checkedSearchByRadioValue: '3',
      pendingDisposed: 'Pending',
      date: toEcourtsDMY(input.date),
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
  // REQUIRED (added 2026-10, live-probed) - carries the numeric court_code
  // court_code_arr actually needs. See searchCaveat's doc comment below.
  courtCode: number;
  // Still required for API-shape compatibility with the other search
  // endpoints, though it's no longer what scopes court_code_arr.
  estCode: string;
  caveatorName?: string;
  caveateeName?: string;
  /** Which name to search on — the app's own default is 'Caveator'. */
  searchBy?: 'Caveator' | 'Caveatee';
  court?: Court;
}

export async function searchCaveat(input: CaveatSearchInput): Promise<unknown> {
  // FIXED - full Hermes bytecode DECOMPILE (hbc-decompiler, readable
  // pseudocode, not just raw disassembly opcodes) of the official APK,
  // 2026-10, cross-checked against a LIVE call. The prior attempt's
  // disassembly-based trace found the right field set
  // (bilingual_flag/selectedLanguage/state_code/dist_code/court_code_arr/
  // action_code/caveator_name/caveatee_name/starting_wit_RadioVal) but
  // guessed at `starting_wit_RadioVal`'s value space (tried '1'/'2'/'Y'/'N'/
  // booleans) because raw opcodes don't show variable origins. The
  // decompiled pseudocode traces it straight to a `useState('Caveator')`
  // hook - it's a literal capitalised string, 'Caveator' or 'Caveatee', not
  // an enum code, which is why every numeric/boolean guess was rejected.
  // Confirmed params for the DC party-name caveat search (action_code '2'):
  //   bilingual_flag, selectedLanguage, state_code, dist_code,
  //   court_code_arr, action_code: '2', caveator_name, caveatee_name,
  //   starting_wit_RadioVal: 'Caveator' | 'Caveatee'
  // LIVE CONFIRMED (2026-10, TN establishment TNCH0C): request is
  // structurally VALID - no validation error. At the time, it still
  // returned a bare `{no_of_establishments: 0}` with `court_code_arr:
  // input.estCode` (the establishment-code string) - this was NOT a
  // caveat-specific issue; it's the identical `court_code_arr` bug also
  // confirmed in searchByPartyName/searchByCaseNumber/etc (see their doc
  // comments). Before this earlier fix every call failed validation
  // outright with `error_ERROR_caveat_action_code1`/
  // `error_ERRORstarting_wit_RadioVal2`.
  //
  // court_code_arr FIX (2026-10, live-probed against KLER01/state 4/dist 2/
  // court 1): `court_code_arr` is the numeric `court_code`, not `estCode`,
  // sent as a bare scalar - same bug, same fix as the other 5 search
  // endpoints. Verified live: searching caveator name "Kumar" against this
  // tuple with the fix returns real `no_of_establishments:1` with actual
  // caveat rows (`caveat_no`, `petname`, `resname`, etc) — the earlier "0
  // establishments" reading for "Ajayakumar" was this same param bug, not
  // (as the earlier comment concluded) a genuine data-availability quirk.
  const params: Record<string, unknown> = {
    bilingual_flag: 0,
    selectedLanguage: 'ENG',
    state_code: input.stateCode,
    dist_code: input.distCode,
    court_code_arr: input.courtCode,
    action_code: '2',
    caveator_name: input.caveatorName ?? '',
    caveatee_name: input.caveateeName ?? '',
    starting_wit_RadioVal: input.searchBy ?? 'Caveator',
  };
  const payload = await call('searchCaveat.php', { court: input.court ?? 'DC', params });
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
  // REQUIRED - see below for why. Sourced from the order's own `caseno`/
  // `cCode`/`bilingual_flag` fields (the case-history response already
  // carries these verbatim for each order under `last_order`/`interimOrder`/
  // `finalOrder`), not re-derived.
  caseNo: string;
  cCode: number;
  bilingualFlag?: string;
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
  // Field names verified live against the real backend (full systematic APK
  // re-audit, 2026-10): the canonical params are `state_cd/dist_cd/
  // court_code/bilingual_flag/appFlag/caseno/cCode/filename` - there is no
  // `cino` field at all. A live case-history fetch confirmed this exactly:
  // each order's `last_order`/`interimOrder`/`finalOrder` entry already
  // carries `caseno`/`cCode`/`appFlag`/`bilingual_flag` verbatim. The prior
  // `cino`-only version happened to still return PDFs in testing (eCourts
  // likely falls back to resolving by filename alone), but was missing the
  // canonical lookup key and the required `appFlag` - kept here as a
  // harmless extra field since dropping it isn't necessary now that the
  // canonical fields are sent. NOTE: the corrected shape itself has not been
  // end-to-end re-verified post-fix - `display_pdf_new.php` started
  // returning a transport-level decrypt failure ("IV did not decode to 16
  // bytes") during this audit, reproducible with or without `cino`, while
  // every other endpoint tested in the same session remained healthy. That
  // points to transient upstream trouble with this specific endpoint (it
  // has a history of real 500s/30s timeouts earlier this session) rather
  // than a param-shape bug, but re-confirm with a live download once it
  // recovers.
  const envelope = await call('display_pdf_new.php', {
    court: input.court ?? 'DC',
    params: {
      filename:       input.filename,
      cino:           input.cino,
      caseno:         input.caseNo,
      cCode:          input.cCode,
      appFlag:        '1',
      state_cd:       input.stateCd,
      dist_cd:        input.distCd,
      court_code:     input.courtCode,
      bilingual_flag: input.bilingualFlag ?? '0',
    },
  }) as { status?: string; pdf_url?: string; Msg?: string; msg?: string } | null;

  // The success envelope isn't consistent - verified live it can be just
  // `{"pdf_url": "..."}` with NO `status` field at all. Requiring
  // `status === 'Y'` rejected genuinely successful responses as failures
  // (surfaced to the advocate as a raw "Request failed with status code
  // 500"). The only reliable success signal is a non-empty `pdf_url`.
  if (!envelope?.pdf_url) {
    const reason = envelope?.Msg ?? envelope?.msg ?? envelope?.status ?? 'no reason given';
    throw new EcourtsHttpError(502, `eCourts did not return an order PDF (${reason})`);
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
