import { db } from '../db/client';
import { logger } from '../logger';
import { EcourtsHttpError } from '../lib/ecourts';
import type { FilingStatus } from '../lib/efiling/types';
import * as live from './efiling-live.service';
import type { MyCase, PortalList, PortalListKey } from './efiling-live.service';
import { canTransition, efilingFilingsService, recordFilingEvent } from './efiling-filings.service';
import { firmIdForUser } from './tenant';

// =============================================================================
// efiling-portal-sync.service
//
// eFiling portal -> DifAi, the way eCourts and Land Records already are: what
// the advocate has on filing.ecourts.gov.in is saved into their DifAi matters
// and kept up to date, not just shown on screen.
//
// Runs over the advocate's own logged-in portal session (efiling-live.service)
// using ONLY its read functions - lists, View Status, and documents opened as
// a PDF. Nothing on the portal is ever saved, submitted, paid or deleted.
//
//   read     Draft Cases, eFiled Cases, Draft / Completed Pleadings,
//            Objections and My Cases -> one record per e-filing number
//   match    DifAi filing by eFiling number, else the matter by CNR (or a
//            filing already carrying that CNR). Nothing found -> `unlinked`,
//            with candidate matters; the advocate links or creates the matter
//   apply    portal state -> filing status, one canTransition hop at a time,
//            each hop an efiling_filing_events row (source 'tracker', note
//            "From filing.ecourts.gov.in ..."); registered -> attachCnr, so
//            the 9 AM / 7 PM eCourts sync takes over hearings and orders
//   payments GRNs from the ePayments column (or View Status > Court Fee),
//            de-duplicated by GRN across the firm
//   files    the portal's Acknowledgement and eFiled case PDF, saved once on
//            the matter's documents
//
// Idempotent: a second run with nothing new on the portal changes nothing.
// Triggers: shortly after the portal login (efiling-live markLoggedIn), at
// most every 10 minutes while the dashboard is in use, and "Sync now".
// =============================================================================

type Sql = NonNullable<ReturnType<typeof db>>;

const FROM_PORTAL = 'From filing.ecourts.gov.in';
/** e-filing number of a case: ATN20250009438C202600002 (state + advocate code + C + year + serial). */
const FULL_RE = /\b[A-Z]{3}\d{11}C\d{9}\b/g;
/** The short form some lists show ("O.S. - C202600019"): the number's last ten characters. */
const SHORT_RE = /\b(C\d{9})\b/g;
const HAS_NO = /\b(?:[A-Z]{3}\d{11})?C\d{9}\b/;
/** "STC/4377/2026 (TNCH0C0121292026)": registered case number and its CNR. */
const REGISTERED_RE = /([A-Z][A-Za-z0-9.()\- ]{0,30}?\/\d+\/\d{4})\s*\(\s*([A-Z]{4}[A-Z0-9]{12})\s*\)/;
/** "TNCT2716H2608P694 - 6600.00" in the ePayments column / GRN select. */
const GRN_RE = /\b([A-Z0-9]{10,24})\s*-\s*(?:Rs\.?\s*)?([\d,]+(?:\.\d{1,2})?)\b/g;
const SYNC_GAP_MS = 10 * 60 * 1000;
const LISTS: ReadonlyArray<PortalListKey> = ['draft_cases', 'filed_cases', 'draft_pleadings', 'completed_pleadings', 'objections'];
const LIST_LABEL: Partial<Record<PortalListKey, string>> = {
  draft_cases: 'Draft Cases', filed_cases: 'eFiled Cases', draft_pleadings: 'Draft Pleadings',
  completed_pleadings: 'Completed Pleadings', objections: 'Objections', my_cases: 'My Cases',
};

/** One e-filing as the portal shows it, gathered across its lists. */
export interface PortalFiling {
  efilingNo: string;
  title: string | null;
  establishment: string | null;
  petitioner: string | null;
  respondent: string | null;
  civilCriminal: string | null;
  /** The lists it appears in. */
  lists: PortalListKey[];
  /** "CIS verified" / "Court Verified" on the portal. */
  verified: boolean;
  caseNo: string | null;
  cnr: string | null;
  objections: string[];
  payments: Array<{ grn: string; amount: number }>;
  /** Where its Acknowledgement / case PDF / View Status open (list + row cells to match). */
  ack: { key: PortalListKey; match: string[] } | null;
  casePdf: { match: string[] } | null;
  statusRow: { match: string[] } | null;
}

export interface PortalSyncItem {
  efilingNo: string;
  title: string;
  establishment: string | null;
  caseNo: string | null;
  cnr: string | null;
  /** Where it is on the portal: "Completed Pleadings · Court verified". */
  portal: string;
  caseId: string | null;
  caseTitle: string | null;
  filingId: string | null;
  status: FilingStatus | null;
  lastChange: string | null;
  lastChangeAt: string | null;
  /** What this run changed. */
  changes: string[];
  /** Unlinked only: DifAi matters that look like this filing. */
  candidates?: Array<{ caseId: string; title: string; cnr: string | null }>;
}

export interface PortalSyncSummary {
  /** Portal filings connected to a DifAi matter. */
  linked: number;
  /** Filings this run changed (status, payment, document). */
  updated: number;
  /** Filings this run created in DifAi. */
  created: number;
  unlinked: PortalSyncItem[];
  items: PortalSyncItem[];
  errors: string[];
  at: string;
}

interface UserState {
  running: Promise<PortalSyncSummary> | null;
  lastStartedAt: number;
  summary: PortalSyncSummary | null;
  /** The last read of the portal, for Link / Create matter. */
  portal: Map<string, PortalFiling>;
  /** View Status already read for these (no GRN there either): not again this process. */
  feeChecked: Set<string>;
}

const state = new Map<string, UserState>();

function stateOf(userId: string): UserState {
  let s = state.get(userId);
  if (!s) {
    s = { running: null, lastStartedAt: 0, summary: null, portal: new Map(), feeChecked: new Set() };
    state.set(userId, s);
  }
  return s;
}

function need(): Sql {
  const sql = db();
  if (!sql) throw new EcourtsHttpError(503, 'Saving eFiling into DifAi needs the database.');
  return sql;
}

// ---- reading the portal -----------------------------------------------------

const cellsOf = (l: PortalList) => l.rows.filter((r): r is { cells: string[]; actions?: string[] } => 'cells' in r);
const col = (l: PortalList, re: RegExp) => l.headers.findIndex((h) => re.test(h));
const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const fullNos = (s: string) => [...new Set(s.toUpperCase().match(FULL_RE) ?? [])];

function grns(s: string): Array<{ grn: string; amount: number }> {
  const out: Array<{ grn: string; amount: number }> = [];
  for (const m of s.toUpperCase().matchAll(GRN_RE)) {
    if (!/\d/.test(m[1]!) || !/[A-Z]/.test(m[1]!)) continue;
    const amount = Number(m[2]!.replace(/,/g, ''));
    if (Number.isFinite(amount) && !out.some((x) => x.grn === m[1])) out.push({ grn: m[1]!, amount });
  }
  return out;
}

function partiesOf(causeTitle: string): { petitioner: string | null; respondent: string | null } {
  const [p, r] = causeTitle.split(/\n\s*Vs\.?\s*\n|\s+Vs\.?\s+/i);
  return { petitioner: clean(p) || null, respondent: clean(r) || null };
}

/** Gather every portal list into one record per e-filing number. */
export function collectPortal(lists: PortalList[], myCases: MyCase[], knownNos: string[]): Map<string, PortalFiling> {
  const out = new Map<string, PortalFiling>();
  const get = (no: string): PortalFiling => {
    let f = out.get(no);
    if (!f) {
      f = { efilingNo: no, title: null, establishment: null, petitioner: null, respondent: null, civilCriminal: null, lists: [], verified: false, caseNo: null, cnr: null, objections: [], payments: [], ack: null, casePdf: null, statusRow: null };
      out.set(no, f);
    }
    return f;
  };
  const seen = (f: PortalFiling, key: PortalListKey) => { if (!f.lists.includes(key)) f.lists.push(key); };
  const addPayments = (f: PortalFiling, text: string) => {
    for (const p of grns(text)) if (!f.payments.some((x) => x.grn === p.grn)) f.payments.push(p);
  };
  const setParties = (f: PortalFiling, pet: string | null, res: string | null) => {
    if (pet && !f.petitioner) f.petitioner = pet;
    if (res && !f.respondent) f.respondent = res;
    if (!f.title && f.petitioner) f.title = f.respondent ? `${f.petitioner} vs ${f.respondent}` : f.petitioner;
  };
  const registered = (f: PortalFiling, text: string) => {
    const m = REGISTERED_RE.exec(text);
    if (m && !f.cnr) { f.caseNo = clean(m[1]); f.cnr = m[2]!; }
    if (/verified/i.test(text)) f.verified = true;
  };
  // Short numbers ("C202600019") resolved against the full ones seen anywhere.
  const shorts: Array<{ short: string; apply: (f: PortalFiling) => void }> = [];
  const byNumber = (text: string, apply: (f: PortalFiling) => void) => {
    const full = fullNos(text);
    if (full.length) { for (const no of full) apply(get(no)); return; }
    for (const m of text.toUpperCase().matchAll(SHORT_RE)) shorts.push({ short: m[1]!, apply });
  };

  for (const l of lists) {
    const noCol = col(l, /e-?filing\s*(number|no)/i);
    const estCol = col(l, /establish/i);
    const titleCol = col(l, /cause\s*title/i);
    const payCol = col(l, /epayment/i);
    const petCol = col(l, /petitioner/i);
    const resCol = col(l, /respondent/i);
    const litCol = col(l, /litigant/i);
    if (l.key === 'objections') {
      // A heading row per filing ("C202600004 - Maintenance Application"), then its reasons.
      const reasonCol = Math.max(1, col(l, /reason|objection/i));
      const dateCol = col(l, /date/i);
      let current: string | null = null;
      for (const r of l.rows) {
        if ('group' in r) { current = /no (record|data)|not found/i.test(r.group) ? null : r.group; continue; }
        const text = clean(r.cells[reasonCol]);
        const where = current ?? r.cells.join(' ');
        if (!text) continue;
        const reason = dateCol >= 0 && r.cells[dateCol] ? `${text} (${clean(r.cells[dateCol])})` : text;
        byNumber(where, (f) => { seen(f, 'objections'); if (!f.objections.includes(reason)) f.objections.push(reason); });
      }
      continue;
    }
    for (const r of cellsOf(l)) {
      const at = noCol >= 0 && r.cells[noCol] ? noCol : r.cells.findIndex((c) => HAS_NO.test(c.toUpperCase()));
      const numberCell = at >= 0 ? r.cells[at]! : r.cells.join(' ');
      const match = r.cells.slice(0, Math.max(2, at + 1));
      byNumber(numberCell, (f) => {
        seen(f, l.key);
        registered(f, numberCell);
        if (estCol >= 0 && !f.establishment) f.establishment = clean(r.cells[estCol]) || null;
        if (titleCol >= 0) { const p = partiesOf(r.cells[titleCol] ?? ''); setParties(f, p.petitioner, p.respondent); }
        if (petCol >= 0 || resCol >= 0) setParties(f, clean(r.cells[petCol]) || null, clean(r.cells[resCol]) || null);
        if (litCol >= 0) setParties(f, clean(r.cells[litCol]) || null, null);
        if (payCol >= 0) addPayments(f, r.cells[payCol] ?? '');
        const actions = r.actions ?? [];
        if (actions.includes('Acknowledgement') && (!f.ack || l.key === 'filed_cases')) f.ack = { key: l.key, match };
        if (l.key === 'filed_cases' && actions.includes('View')) f.casePdf = { match };
        if (l.key === 'completed_pleadings' && actions.includes('View Status')) f.statusRow = { match };
      });
    }
  }

  // My Cases: the portal's portfolio, with the e-filing number of a case filed through it.
  for (const c of myCases) {
    const no = fullNos(c.pdeNo ?? '')[0];
    if (!no) continue;
    const f = get(no);
    seen(f, 'my_cases');
    setParties(f, clean(c.petName) || null, clean(c.resName) || null);
    if (!f.establishment) f.establishment = clean(c.establishmentName) || null;
    if (!f.civilCriminal) f.civilCriminal = clean(c.ciCri) || null;
    if (!c.filing && c.caseNo && c.cino && !f.cnr) { f.caseNo = c.caseNo; f.cnr = c.cino.toUpperCase(); }
    if (c.underObjection && !f.objections.length) f.objections.push('Under objection (My Cases on the portal)');
  }

  const all = [...new Set([...out.keys(), ...knownNos.map((n) => n.toUpperCase())])];
  for (const s of shorts) {
    const hits = all.filter((n) => n.endsWith(s.short));
    if (hits.length === 1) s.apply(get(hits[0]!));
  }
  return out;
}

/** Read every list the sync uses, one portal step at a time. */
async function readPortal(sessionId: string, userId: string, errors: string[]): Promise<{ lists: PortalList[]; myCases: MyCase[] }> {
  const lists: PortalList[] = [];
  for (const key of LISTS) {
    try {
      const l = await live.readPortalList(sessionId, userId, key);
      if (l.error && !l.rows.length) errors.push(`${LIST_LABEL[key]}: ${l.error}`);
      lists.push(l);
    } catch (e) {
      if (sessionGone(e)) throw e;
      errors.push(`${LIST_LABEL[key]}: ${(e as Error).message}`);
    }
  }
  let myCases: MyCase[] = [];
  try {
    myCases = (await live.readMyCases(sessionId, userId)).cases;
  } catch (e) {
    if (sessionGone(e)) throw e;
    errors.push(`My Cases: ${(e as Error).message}`);
  }
  return { lists, myCases };
}

function sessionGone(e: unknown): boolean {
  const s = (e as { status?: number }).status;
  return s === 404 || s === 410;
}

// ---- status mapping ---------------------------------------------------------

const RANK: Record<FilingStatus, number> = {
  draft: 0, ready: 1, efiled: 2, submitted: 3, objected: 4, refiled: 4, accepted: 5, registered: 6, rejected: -1, withdrawn: -1,
};

/** Where the portal has this filing, as a DifAi status. */
export function portalStatus(p: PortalFiling): FilingStatus {
  if (p.cnr && p.caseNo) return 'registered';
  if (p.objections.length) return 'objected';
  if (p.verified) return 'accepted';
  if (p.lists.includes('completed_pleadings')) return 'submitted';
  if (p.lists.some((k) => k === 'filed_cases' || k === 'draft_pleadings' || k === 'my_cases')) return 'efiled';
  return 'ready';
}

export function portalWhere(p: PortalFiling): string {
  const where = p.lists.map((k) => LIST_LABEL[k]).filter(Boolean) as string[];
  if (p.caseNo) where.push(`Registered ${p.caseNo}`);
  else if (p.verified) where.push('Court verified');
  return where.join(' · ') || 'On the portal';
}

/** Shortest run of allowed moves from -> to (never through draft / withdrawn / rejected). */
export function pathTo(from: FilingStatus, to: FilingStatus): FilingStatus[] | null {
  if (from === to) return [];
  const prev = new Map<FilingStatus, FilingStatus>();
  const queue: FilingStatus[] = [from];
  const nodes = Object.keys(RANK) as FilingStatus[];
  while (queue.length) {
    const s = queue.shift()!;
    for (const n of nodes) {
      if (n === 'draft' || n === 'withdrawn' || n === 'rejected' || prev.has(n) || n === from || !canTransition(s, n)) continue;
      prev.set(n, s);
      if (n === to) {
        const path: FilingStatus[] = [n];
        for (let c = s; c !== from; c = prev.get(c)!) path.unshift(c);
        return path;
      }
      queue.push(n);
    }
  }
  return null;
}

/** The status DifAi should move to, or null to leave it. */
export function goalFor(current: FilingStatus, p: PortalFiling, objectionFromPortal: boolean): FilingStatus | null {
  if (current === 'registered' || current === 'withdrawn' || current === 'rejected') return null;
  const t = portalStatus(p);
  if (t === 'registered') return 'registered';
  if (t === 'objected') return current === 'objected' ? null : 'objected';
  // The objection the sync recorded is no longer listed: cured and re-filed.
  if (current === 'objected') return objectionFromPortal ? (RANK[t] > RANK.refiled ? t : 'refiled') : null;
  return RANK[t] > RANK[current] ? t : null;
}

function noteFor(to: FilingStatus, p: PortalFiling): string {
  switch (to) {
    case 'ready': return `${FROM_PORTAL}: in Draft Cases (${p.efilingNo})`;
    case 'efiled': return `${FROM_PORTAL}: eFiled, eFiling no. ${p.efilingNo}`;
    case 'submitted': return `${FROM_PORTAL}: final submitted (Completed Pleadings)`;
    case 'accepted': return `${FROM_PORTAL}: verified by the court (CIS)`;
    case 'objected': return `${FROM_PORTAL}: objection - ${p.objections.join('; ')}`.slice(0, 1000);
    case 'refiled': return `${FROM_PORTAL}: objection no longer listed`;
    case 'registered': return `${FROM_PORTAL}: registered as ${p.caseNo}, CNR ${p.cnr}`;
    default: return FROM_PORTAL;
  }
}

/** Column values that go with moving into `to` (the same ones transition() sets; efiled_at /
 *  submitted_at are kept when already set, in the update itself). */
function fieldsFor(to: FilingStatus, p: PortalFiling): Record<string, unknown> {
  const v: Record<string, unknown> = { status: to };
  if (to === 'efiled') v.efiling_no = p.efilingNo;
  if (to === 'objected') {
    v.objections = p.objections.join('\n');
    v.objections_raised_at = new Date();
    v.objections_cured_at = null;
  }
  if (to === 'refiled') v.objections_cured_at = new Date();
  if (['submitted', 'objected', 'refiled', 'accepted'].includes(to)) {
    v.tracking_status = 'idle';
    v.tracking_fail_count = 0;
  }
  return v;
}

/** Portal steps the status implies are done. */
function stepsFor(status: FilingStatus): Record<string, 'done'> {
  const r = RANK[status];
  const s: Record<string, 'done'> = {};
  if (r >= RANK.efiled) s.efile_case = 'done';
  if (r >= RANK.submitted) { s.upload = 'done'; s.final_submit = 'done'; }
  return s;
}

// ---- applying one portal filing to DifAi ------------------------------------

interface FilingRow {
  id: string; case_id: string; case_title: string; status: FilingStatus; title: string;
  cnr: string | null; objections: string | null; registration_no: string | null; created_by_user_id: string | null;
  case_owner: string | null;
}

async function loadFiling(sql: Sql, firmId: string, where: { efilingNo: string } | { id: string }): Promise<FilingRow | null> {
  const [row] = await sql<FilingRow[]>`
    select f.id, f.case_id, c.title as case_title, f.status, f.title, f.cnr, f.objections, f.registration_no,
           f.created_by_user_id, c.created_by_user_id as case_owner
    from efiling_filings f join cases c on c.id = f.case_id and c.deleted_at is null
    where f.firm_id = ${firmId}::uuid
      and ${'id' in where ? sql`f.id = ${where.id}::uuid` : sql`upper(f.efiling_no) = ${where.efilingNo.toUpperCase()}`}
    limit 1
  `;
  return row ?? null;
}

/** The matter for a portal filing without a DifAi filing: by CNR, or a filing already holding that CNR. */
async function findCase(sql: Sql, firmId: string, p: PortalFiling): Promise<{ id: string; title: string } | null> {
  if (!p.cnr) return null;
  const [c] = await sql<Array<{ id: string; title: string }>>`
    select id, title from cases
    where firm_id = ${firmId}::uuid and deleted_at is null and upper(trim(cnr)) = ${p.cnr}
    limit 1
  `;
  if (c) return c;
  const [f] = await sql<Array<{ id: string; title: string }>>`
    select c.id, c.title from efiling_filings f join cases c on c.id = f.case_id and c.deleted_at is null
    where f.firm_id = ${firmId}::uuid and upper(f.cnr) = ${p.cnr}
    limit 1
  `;
  return f ?? null;
}

/** DifAi matters that look like this filing (party names, case number), for the advocate to pick. */
async function candidatesFor(sql: Sql, firmId: string, p: PortalFiling): Promise<Array<{ caseId: string; title: string; cnr: string | null }>> {
  const words = (s: string | null) => clean(s).split(' ').filter((w) => w.length >= 3).slice(0, 2).join(' ');
  const patterns = [words(p.petitioner), words(p.respondent), clean(p.caseNo)].filter((x) => x.length >= 3).map((x) => `%${x.replace(/[%_\\]/g, '')}%`);
  if (!patterns.length) return [];
  const rows = await sql<Array<{ id: string; title: string; cnr: string | null }>>`
    select c.id, c.title, c.cnr from cases c
    where c.firm_id = ${firmId}::uuid and c.deleted_at is null
      and (c.title ilike any(${sql.array(patterns)}::text[])
        or exists (select 1 from case_parties cp where cp.case_id = c.id and cp.party_name ilike any(${sql.array(patterns)}::text[])))
    order by c.updated_at desc nulls last
    limit 5
  `;
  return rows.map((r) => ({ caseId: r.id, title: r.title, cnr: /^[A-Z]{4}[A-Z0-9]{12}$/.test((r.cnr ?? '').trim().toUpperCase()) ? r.cnr!.trim().toUpperCase() : null }));
}

interface ApplyCtx {
  sql: Sql;
  sessionId: string;
  userId: string;
  firmId: string;
  errors: string[];
  feeChecked: Set<string>;
}

/** Create the DifAi filing for a portal filing on a known matter, at the portal's status (registration aside). */
async function createFiling(ctx: ApplyCtx, caseId: string, p: PortalFiling): Promise<string> {
  const { sql, firmId, userId } = ctx;
  const target = portalStatus(p);
  const start: FilingStatus = target === 'registered' ? (p.verified ? 'accepted' : 'submitted') : target;
  const now = new Date();
  const objected = start === 'objected';
  const [row] = await sql<Array<{ id: string }>>`
    insert into efiling_filings (firm_id, case_id, kind, title, status, efiling_no, efiled_at, submitted_at,
                                 objections, objections_raised_at, steps, tracking_status, created_by_user_id)
    values (${firmId}::uuid, ${caseId}::uuid, 'new_case', ${p.title ?? `New case ${p.efilingNo}`}, ${start}, ${p.efilingNo},
            ${RANK[start] >= RANK.efiled ? now : null}, ${RANK[start] >= RANK.submitted ? now : null},
            ${objected ? p.objections.join('\n') : null}, ${objected ? now : null},
            ${sql.json(stepsFor(start) as never)}, 'idle', ${userId}::uuid)
    returning id
  `;
  await recordFilingEvent(sql, {
    filingId: row!.id, firmId, from: null, to: start, source: 'tracker',
    note: `${FROM_PORTAL}: found in ${portalWhere(p)}${objected ? ` - objection: ${p.objections.join('; ')}` : ''}`.slice(0, 1000),
  });
  if (objected) {
    const { notify } = await import('./notifications.service');
    const [c] = await sql<Array<{ title: string; created_by_user_id: string | null }>>`select title, created_by_user_id from cases where id = ${caseId}::uuid`;
    await notify.efilingObjection(firmId, { filingId: row!.id, matterTitle: c?.title ?? p.efilingNo, objections: p.objections.join('; '), ownerUserId: c?.created_by_user_id ?? userId });
  }
  return row!.id;
}

/**
 * Bring one DifAi filing up to what the portal shows: status (each move an
 * allowed one, each recorded), CNR, GRNs, Acknowledgement / case PDF.
 * Returns what changed (empty = nothing).
 */
async function applyToFiling(ctx: ApplyCtx, f: FilingRow, p: PortalFiling): Promise<string[]> {
  const { sql, firmId } = ctx;
  const changes: string[] = [];
  const { notify } = await import('./notifications.service');
  const owner = f.case_owner ?? f.created_by_user_id;

  // The objection the filing holds came from the portal (so the portal may clear it).
  const [fromPortal] = f.status === 'objected'
    ? await sql<Array<{ n: number }>>`
        select count(*)::int as n from efiling_filing_events
        where filing_id = ${f.id}::uuid and to_status = 'objected' and source = 'tracker' and note like ${`${FROM_PORTAL}%`}`
    : [{ n: 0 }];
  const goal = goalFor(f.status, p, (fromPortal?.n ?? 0) > 0);

  if (goal) {
    const path = pathTo(f.status, goal);
    if (!path) {
      ctx.errors.push(`${p.efilingNo}: DifAi has it as "${f.status}"; the portal shows "${goal}" - not a move DifAi makes on its own.`);
    } else {
      let from = f.status;
      for (const to of path) {
        if (to === 'registered') {
          f.status = from;
          await register(ctx, f, p);
          changes.push(`Registered ${p.caseNo} (CNR ${p.cnr})`);
          await notify.efilingRegistered(firmId, { filingId: f.id, caseId: f.case_id, matterTitle: f.case_title, cnr: p.cnr!, ownerUserId: owner });
          from = to;
          continue;
        }
        await sql`
          update efiling_filings set ${sql(fieldsFor(to, p))},
            steps = steps || ${sql.json(stepsFor(to) as never)},
            efiled_at = case when ${RANK[to] >= RANK.efiled} then coalesce(efiled_at, now()) else efiled_at end,
            submitted_at = case when ${RANK[to] >= RANK.submitted} then coalesce(submitted_at, now()) else submitted_at end,
            updated_at = now()
          where id = ${f.id}::uuid and status = ${from}
        `;
        await recordFilingEvent(sql, { filingId: f.id, firmId, from, to, note: noteFor(to, p), source: 'tracker' });
        changes.push(`${from} → ${to}`);
        if (to === 'objected') await notify.efilingObjection(firmId, { filingId: f.id, matterTitle: f.case_title, objections: p.objections.join('; '), ownerUserId: owner });
        if (to === 'refiled') await notify.efilingObjectionCleared(firmId, { filingId: f.id, matterTitle: f.case_title, ownerUserId: owner });
        from = to;
      }
      f.status = from;
    }
  } else if (f.status === 'objected' && p.objections.length && clean(f.objections) !== clean(p.objections.join('\n'))) {
    // Still objected, with different reasons now.
    await sql`update efiling_filings set objections = ${p.objections.join('\n')}, updated_at = now() where id = ${f.id}::uuid`;
    await recordFilingEvent(sql, { filingId: f.id, firmId, note: noteFor('objected', p), source: 'tracker' });
    await notify.efilingObjection(firmId, { filingId: f.id, matterTitle: f.case_title, objections: p.objections.join('; '), ownerUserId: owner });
    changes.push('Objection updated');
  }

  changes.push(...(await syncPayments(ctx, f, p)));
  changes.push(...(await syncDocuments(ctx, f, p)));
  return changes;
}

/**
 * Registered on the portal: record the case number and CNR. The matter gets
 * the CNR and is linked to eCourts (attachCnr) - unless it already has a
 * different working CNR, which DifAi never re-points on its own.
 */
async function register(ctx: ApplyCtx, f: FilingRow, p: PortalFiling): Promise<void> {
  const { sql, firmId } = ctx;
  const cnr = p.cnr!;
  const [c] = await sql<Array<{ cnr: string | null }>>`select cnr from cases where id = ${f.case_id}::uuid`;
  const caseCnr = (c?.cnr ?? '').trim().toUpperCase();
  const keepsOwn = /^[A-Z]{4}[A-Z0-9]{12}$/.test(caseCnr) && caseCnr !== cnr;
  if (!keepsOwn) {
    try {
      await efilingFilingsService.attachCnr(f.id, firmId, cnr, 'tracker', null, noteFor('registered', p));
      await sql`update efiling_filings set registration_no = coalesce(registration_no, ${p.caseNo}) where id = ${f.id}::uuid`;
      return;
    } catch (e) {
      // Another matter already holds this CNR: record it on the filing only.
      ctx.errors.push(`${p.efilingNo}: ${(e as Error).message}`);
    }
  }
  await sql`
    update efiling_filings set status = 'registered', cnr = ${cnr}, registration_no = coalesce(registration_no, ${p.caseNo}),
      registered_at = coalesce(registered_at, now()), tracking_status = 'matched', tracking_candidates = null, updated_at = now()
    where id = ${f.id}::uuid
  `;
  await recordFilingEvent(sql, {
    filingId: f.id, firmId, from: f.status, to: 'registered', source: 'tracker',
    note: `${noteFor('registered', p)} (the matter keeps its own CNR${caseCnr ? ` ${caseCnr}` : ''})`,
  });
}

/** GRNs from the portal -> efiling_payments, once per GRN in the firm. */
async function syncPayments(ctx: ApplyCtx, f: FilingRow, p: PortalFiling): Promise<string[]> {
  const { sql, firmId, userId } = ctx;
  let payments = p.payments;
  if (!payments.length && p.statusRow && !ctx.feeChecked.has(p.efilingNo)) {
    // No GRN in the list: View Status > Court Fee, once, when DifAi has none for it.
    const [has] = await sql<Array<{ n: number }>>`select count(*)::int as n from efiling_payments where filing_id = ${f.id}::uuid`;
    if (!has?.n) {
      ctx.feeChecked.add(p.efilingNo);
      try {
        const v = await live.openPortalRowAction(ctx.sessionId, ctx.userId, 'completed_pleadings', p.statusRow.match, 'View Status');
        const fee = v.sections.find((s) => /court\s*fee/i.test(s.name))?.table;
        if (fee) {
          const g = fee.headers.findIndex((h) => /grn/i.test(h));
          const a = fee.headers.findIndex((h) => /amount/i.test(h));
          for (const r of fee.rows) {
            if (!('cells' in r)) continue;
            const grn = clean(r.cells[g >= 0 ? g : 1]).toUpperCase();
            const amount = Number(clean(r.cells[a >= 0 ? a : 2]).replace(/,/g, ''));
            if (/^[A-Z0-9]{10,24}$/.test(grn) && Number.isFinite(amount)) payments = [...payments, { grn, amount }];
          }
        }
      } catch (e) {
        if (sessionGone(e)) throw e;
        ctx.errors.push(`${p.efilingNo} View Status: ${(e as Error).message}`);
      }
    }
  }
  const changes: string[] = [];
  for (const pay of payments) {
    const [dup] = await sql<Array<{ n: number }>>`
      select count(*)::int as n from efiling_payments where firm_id = ${firmId}::uuid and upper(grn) = ${pay.grn}`;
    if (dup?.n) continue;
    await sql`
      insert into efiling_payments (filing_id, firm_id, purpose, amount_inr, grn, mode, created_by_user_id)
      values (${f.id}::uuid, ${firmId}::uuid, 'court_fee', ${pay.amount}, ${pay.grn}, 'epay', ${userId}::uuid)
    `;
    await sql`update efiling_filings set steps = steps || ${sql.json({ court_fee: 'done' } as never)}, updated_at = now() where id = ${f.id}::uuid`;
    await recordFilingEvent(sql, { filingId: f.id, firmId, source: 'tracker', note: `${FROM_PORTAL}: court fee ₹${pay.amount.toFixed(2)} (GRN ${pay.grn})` });
    changes.push(`Court fee GRN ${pay.grn}`);
  }
  return changes;
}

/** Statuses whose bundle is final: portal documents can sit beside it on the filing. */
const LINK_DOCS: ReadonlyArray<FilingStatus> = ['submitted', 'refiled', 'accepted', 'registered'];

/** The portal's Acknowledgement and eFiled case PDF, saved once on the matter. */
async function syncDocuments(ctx: ApplyCtx, f: FilingRow, p: PortalFiling): Promise<string[]> {
  const changes: string[] = [];
  const want: Array<{ name: string; open: () => Promise<live.PortalFile> }> = [];
  if (p.ack) {
    const ack = p.ack;
    want.push({ name: `eFiling acknowledgement - ${p.efilingNo}`, open: () => live.openPortalFile(ctx.sessionId, ctx.userId, ack.key, { match: ack.match, link: 'Acknowledgement' }) });
  }
  if (p.casePdf) {
    const row = p.casePdf;
    want.push({ name: `eFiled case - ${p.efilingNo}`, open: () => live.openPortalFile(ctx.sessionId, ctx.userId, 'filed_cases', { match: row.match, link: 'View' }) });
  }
  for (const w of want) {
    try {
      const saved = await saveDocument(ctx, f, w.name, w.open);
      if (saved) changes.push(`Saved ${w.name}`);
    } catch (e) {
      if (sessionGone(e)) throw e;
      ctx.errors.push(`${w.name}: ${(e as Error).message}`);
    }
  }
  return changes;
}

/** true when something new was stored or linked. */
async function saveDocument(ctx: ApplyCtx, f: FilingRow, name: string, open: () => Promise<live.PortalFile>): Promise<boolean> {
  const { sql, firmId } = ctx;
  let changed = false;
  let [doc] = await sql<Array<{ id: string; file_size: string | null }>>`
    select id, file_size from documents where firm_id = ${firmId}::uuid and case_id = ${f.case_id}::uuid and name = ${name} limit 1`;
  if (!doc) {
    const file = await open();
    if (!file.body.length || !/pdf/i.test(file.contentType)) throw new EcourtsHttpError(502, 'The portal did not send a PDF.');
    const { documentsService } = await import('./documents.service');
    const created = await documentsService.create({
      name, type: 'eFiling', case: f.case_title, updated: 'just now',
      fileName: `${name.replace(/[^\w.-]+/g, '_')}.pdf`, fileMime: 'application/pdf', fileSize: file.body.length, fileBase64: file.body.toString('base64'),
    }, firmId);
    await sql`update documents set case_id = ${f.case_id}::uuid where id::text = ${created.id!}`;
    doc = { id: created.id!, file_size: String(file.body.length) };
    await recordFilingEvent(sql, { filingId: f.id, firmId, source: 'tracker', note: `${FROM_PORTAL}: saved "${name}" to the matter's documents` });
    changed = true;
  }
  if (LINK_DOCS.includes(f.status)) {
    const [linked] = await sql<Array<{ n: number }>>`
      select count(*)::int as n from efiling_documents where filing_id = ${f.id}::uuid and source_kind = 'document' and source_id = ${doc.id}::uuid`;
    if (!linked?.n) {
      await sql`
        insert into efiling_documents (filing_id, firm_id, position, label, source_kind, source_id, size_bytes)
        select ${f.id}::uuid, ${firmId}::uuid, coalesce(max(position) + 1, 0), ${name}, 'document', ${doc.id}::uuid, ${doc.file_size == null ? null : Number(doc.file_size)}
        from efiling_documents where filing_id = ${f.id}::uuid
      `;
      changed = true;
    }
  }
  return changed;
}

async function lastEvent(sql: Sql, filingId: string): Promise<{ note: string | null; at: string | null }> {
  const [e] = await sql<Array<{ note: string | null; to_status: string | null; created_at: Date }>>`
    select note, to_status, created_at from efiling_filing_events where filing_id = ${filingId}::uuid order by created_at desc limit 1`;
  return { note: e ? e.note ?? (e.to_status ? `Moved to ${e.to_status}` : null) : null, at: e ? e.created_at.toISOString() : null };
}

function itemOf(p: PortalFiling): PortalSyncItem {
  return {
    efilingNo: p.efilingNo, title: p.title ?? p.efilingNo, establishment: p.establishment, caseNo: p.caseNo, cnr: p.cnr,
    portal: portalWhere(p), caseId: null, caseTitle: null, filingId: null, status: null, lastChange: null, lastChangeAt: null, changes: [],
  };
}

/** One portal filing -> DifAi. Returns its summary row and whether it was created / changed. */
async function applyOne(ctx: ApplyCtx, p: PortalFiling, linkTo?: string): Promise<{ item: PortalSyncItem; created: boolean; changed: boolean }> {
  const { sql, firmId } = ctx;
  const item = itemOf(p);
  let f = await loadFiling(sql, firmId, { efilingNo: p.efilingNo });
  let created = false;
  if (!f) {
    const c = linkTo ? { id: linkTo } : await findCase(sql, firmId, p);
    if (!c) {
      item.candidates = await candidatesFor(sql, firmId, p);
      return { item, created: false, changed: false };
    }
    const id = await createFiling(ctx, c.id, p);
    f = (await loadFiling(sql, firmId, { id }))!;
    created = true;
    item.changes.push(`Filing created (${f.status})`);
  }
  try {
    item.changes.push(...(await applyToFiling(ctx, f, p)));
  } catch (e) {
    if (sessionGone(e)) throw e;
    ctx.errors.push(`${p.efilingNo}: ${(e as Error).message}`);
  }
  const now = (await loadFiling(sql, firmId, { id: f.id }))!;
  const last = await lastEvent(sql, f.id);
  Object.assign(item, { caseId: now.case_id, caseTitle: now.case_title, filingId: now.id, status: now.status, lastChange: last.note, lastChangeAt: last.at });
  return { item, created, changed: item.changes.length > 0 };
}

// ---- the sync ---------------------------------------------------------------

async function runSync(sessionId: string, userId: string): Promise<PortalSyncSummary> {
  const firmId = await firmIdForUser(userId);
  if (!firmId) throw new EcourtsHttpError(409, 'No firm attached to this account - DifAi has nowhere to save eFiling.');
  const sql = need();
  const st = stateOf(userId);
  const errors: string[] = [];
  live.efilingSessionStatus(sessionId, userId);

  const { lists, myCases } = await readPortal(sessionId, userId, errors);
  const known = await sql<Array<{ efiling_no: string }>>`
    select efiling_no from efiling_filings where firm_id = ${firmId}::uuid and efiling_no is not null`;
  const portal = collectPortal(lists, myCases, known.map((k) => k.efiling_no));
  st.portal = portal;

  const ctx: ApplyCtx = { sql, sessionId, userId, firmId, errors, feeChecked: st.feeChecked };
  const items: PortalSyncItem[] = [];
  let created = 0;
  let updated = 0;
  for (const p of portal.values()) {
    try {
      const r = await applyOne(ctx, p);
      items.push(r.item);
      if (r.created) created += 1;
      else if (r.changed) updated += 1;
    } catch (e) {
      if (sessionGone(e)) throw e;
      errors.push(`${p.efilingNo}: ${(e as Error).message}`);
      items.push(itemOf(p));
    }
  }
  const summary: PortalSyncSummary = {
    linked: items.filter((i) => i.filingId).length,
    updated,
    created,
    unlinked: items.filter((i) => !i.filingId),
    items,
    errors,
    at: new Date().toISOString(),
  };
  st.summary = summary;
  logger.info({ userId, linked: summary.linked, updated, created, unlinked: summary.unlinked.length, errors: errors.length }, 'efiling portal sync');
  return summary;
}

/**
 * Read the advocate's portal and save it into DifAi. One run at a time per
 * advocate: a second call while one runs gets the same result.
 */
export async function syncPortalToDifai(sessionId: string, userId: string): Promise<PortalSyncSummary> {
  const st = stateOf(userId);
  if (st.running) return st.running;
  st.lastStartedAt = Date.now();
  st.running = runSync(sessionId, userId).finally(() => { st.running = null; });
  return st.running;
}

/** Automatic runs are off in tests unless asked for (they'd read the stand-in portal mid-test). */
function autoSyncOn(): boolean {
  if (process.env['EFILING_AUTO_SYNC'] === '0') return false;
  return process.env['NODE_ENV'] !== 'test' || process.env['EFILING_AUTO_SYNC'] === '1';
}

/** In the background, unless one ran in the last `gapMs` (default 10 minutes) or is running. */
export function syncIfDue(sessionId: string, userId: string, gapMs = SYNC_GAP_MS): void {
  if (!autoSyncOn()) return;
  const st = stateOf(userId);
  if (st.running || Date.now() - st.lastStartedAt < gapMs) return;
  void syncPortalToDifai(sessionId, userId).catch((e) => {
    logger.info({ err: (e as Error).message, status: (e as { status?: number }).status }, 'efiling portal sync did not finish');
  });
}

export function lastSyncSummary(userId: string): { summary: PortalSyncSummary | null; running: boolean } {
  const st = state.get(userId);
  return { summary: st?.summary ?? null, running: !!st?.running };
}

/**
 * The advocate links a portal filing DifAi couldn't place: to an existing
 * matter (caseId), or to a new matter made from the portal's cause title /
 * CNR (createCase). Uses the last sync's read of the portal.
 */
export async function linkPortalFiling(
  sessionId: string,
  userId: string,
  efilingNo: string,
  target: { caseId: string } | { createCase: true },
): Promise<PortalSyncItem> {
  const firmId = await firmIdForUser(userId);
  if (!firmId) throw new EcourtsHttpError(409, 'No firm attached to this account.');
  const sql = need();
  live.efilingSessionStatus(sessionId, userId);
  const st = stateOf(userId);
  const no = efilingNo.trim().toUpperCase();
  const p = st.portal.get(no);
  if (!p) throw new EcourtsHttpError(409, 'DifAi has not read that eFiling number from the portal yet - Sync now first.');
  if (await loadFiling(sql, firmId, { efilingNo: no })) throw new EcourtsHttpError(409, 'That eFiling number is already on a DifAi filing.');

  let caseId: string;
  if ('caseId' in target) {
    const [c] = await sql<Array<{ id: string }>>`
      select id from cases where id::text = ${target.caseId} and firm_id = ${firmId}::uuid and deleted_at is null`;
    if (!c) throw new EcourtsHttpError(404, 'Matter not found.');
    caseId = c.id;
  } else {
    const { casesService } = await import('./cases.service');
    const created = await casesService.create({
      cnr: p.cnr ?? `TEMP-${no}`,
      title: p.title ?? `eFiling ${no}`,
      court: p.establishment ?? '',
      stage: 'Filing',
      client: p.petitioner ?? '',
      status: 'Active',
      next: '',
      type: /crim/i.test(p.civilCriminal ?? '') ? 'Criminal' : 'Civil',
    } as never, firmId);
    caseId = created.id;
    // A matter with a CNR is connected to eCourts the same way "New matter" does it.
    if (p.cnr) {
      const { queueLink } = await import('./ecourts-link.service');
      await queueLink(caseId, firmId).catch(() => null);
    }
  }

  const ctx: ApplyCtx = { sql, sessionId, userId, firmId, errors: [], feeChecked: st.feeChecked };
  const { item } = await applyOne(ctx, p, caseId);
  if (st.summary) {
    const items = st.summary.items.map((i) => (i.efilingNo === no ? item : i));
    st.summary = {
      ...st.summary,
      items,
      linked: items.filter((i) => i.filingId).length,
      created: st.summary.created + 1,
      unlinked: items.filter((i) => !i.filingId),
      errors: [...st.summary.errors, ...ctx.errors],
    };
  }
  return item;
}

export const __testing = {
  reset: () => state.clear(),
};
