import type { Frame, Page } from 'playwright';
import { EcourtsHttpError } from '../lib/ecourts';
import { closePortalPopups, findLink, openPortalMenu, portalPost, withPortalPage } from './efiling-live.service';

/* eslint-disable @typescript-eslint/no-explicit-any -- in-page DOM code (page.evaluate); no dom lib in this tsconfig */
declare const document: any;

// =============================================================================
// efiling-portal-pleadings.service
//
// Pleadings and Video Recording (oath) on the REAL portal, live over the
// advocate's own logged-in session - the portal's own screens, functions and
// requests, as its public JS has them (upload_pleading.js, pleading_index.js,
// pleading_esign_test.js, videoRecording.js, dashboard.js; see
// docs/efiling-portal-reverse-engineering.md §3-4):
//
//   Pleadings > Pleading Upload
//     case: radio name=cases (3 = e-filed -> #sel_pde_no, 1 = existing case ->
//       #txt_case_search); choosing one runs fetchPleadingData()
//       -> upload_pleading/fetchPleadingData (the case's uploaded pleadings)
//     upload tab: #selDocType (where the portal has it), #file_name (title),
//       #doc_file_name (file), #add_btn -> upload_pleading/addFile (multipart);
//       the clients (chk_pet_list[] / chk_res_list[]); submitData()
//       -> upload_pleading/addData; removeFile(pleading) -> removeFile;
//       goToMerge + mergeFiles() -> mergedocSubmit; showFile(pleading) -> PDF
//     #pleading_index_tab: fetchPleadingIndex -> pleading_index/fetchPleadingData;
//       addIndex(pleading) + documentIndex() -> documentIndex; deleteIndex
//     #pleading_esign_tab: fetchPleadingEsign -> pleading_esign_test/fetchPleadingData;
//       addAuth -> pleading_index/fetchAdvLit, submitAuth -> pleading_index/submitAuth;
//       showFrame/showEsignFrame -> pleading_esign_test/esign_trans (Aadhaar eSign
//       gateway page); showEsignFrame1 + sendOTP / verifyOTP (OTP authentication)
//   Dashboard > Draft Pleadings: Dashboard/submit_pleading/ (with the GRN);
//     Completed Pleadings: Dashboard/resubmit_pleading/ (after objections)
//   Pleadings > Video Recording: radio name=search_case, #sel_pde_no ->
//     pleading_index/fetchDocument (#selDocument), videoRecording/fetchDetails,
//     videoRecording/fetchOathVideos, upload -> videoRecording/selfInvoker,
//     play -> videoRecording/readOathVideo
//
// Screen labels are read from the advocate's portal page (its labels_array /
// buttons_array / alerts_array and the server-rendered labels), not invented.
// OTPs and the eSign gateway's own fields are typed by the advocate in DifAi
// and relayed as typed - DifAi never fills or guesses them. Anything that
// deletes or submits needs { confirmed: true }.
// =============================================================================

// ---- shapes -----------------------------------------------------------------------

/** A portal button/link in a row: the function its onclick calls and that call's arguments. */
export interface PortalCall {
  label: string;
  fn: string;
  args: string[];
}

export interface PortalOption { value: string; text: string; selected?: boolean }

export interface PleadingRow {
  cells: string[];
  actions?: string[];
  calls?: PortalCall[];
  selects?: Array<{ id: string; name: string; options: PortalOption[] }>;
  checks?: Array<{ id: string; name: string; value: string; label: string; checked: boolean }>;
}

export interface PleadingTable {
  headers: string[];
  rows: Array<{ group: string } | PleadingRow>;
}

export interface PortalSaid {
  ok: boolean;
  /** What the portal told the advocate (its alert boxes, dialogs, msg / errormsg). */
  portal: string[];
}

export interface CaseRef {
  /** The `cases` radio: '3' e-filed case (e-filing number), '1' existing case. */
  source: string;
  value: string;
}

export interface PleadingScreen {
  title: string;
  sources: Array<{ value: string; label: string; checked: boolean }>;
  efiled: PortalOption[];
  existing: PortalOption[];
  /** The page's tabs in order, as labelled there. */
  tabs: Array<{ id: string; label: string }>;
  labels: Record<string, string>;
  docTypes: PortalOption[] | null;
  selected: CaseRef | null;
}

export interface PleadingCaseView {
  case: CaseRef;
  table: PleadingTable;
  parties: Array<{ side: 'pet' | 'res'; value: string; label: string; checked: boolean }>;
  /** The clients box heading ("My Clients [Petitioner]", common_pleading_temp.js #sp_pet_called_as). */
  clientsLabel: string;
  /** Files Added on the portal and not yet Submitted (#upload_pdf_name). */
  added: AddedFile[];
}

export interface AddedFile { title: string; file: string; size: string; signed: boolean }

export interface AuthChoice {
  labels: { title: string; advocates: string; clients: string; submit: string };
  advocates: AuthPerson[];
  clients: AuthPerson[];
}
export interface AuthPerson {
  id: string;
  /** The checkbox's value - what submitAuth sends. */
  value: string;
  /** The `aesigotp[i]` / `lesigotp[i]` index. */
  idx: string;
  label: string;
  checked: boolean;
  /** eSign / OTP radios, as the portal labels them. */
  choices: Array<{ value: string; label: string; checked: boolean }>;
}

export interface GatewayView {
  url: string;
  done: boolean;
  text: string[];
  fields: Array<{ key: string; label: string; type: string; options?: PortalOption[] }>;
  buttons: string[];
  screenshotBase64: string | null;
  portal: string[];
}

export interface OathScreen {
  title: string;
  sources: Array<{ value: string; label: string; checked: boolean }>;
  cases: PortalOption[];
  labels: Record<string, string>;
}

export interface OathDetails {
  establishment: string;
  causeTitle: string;
  caseNumber: string;
  litigants: string;
  oathMessage: string;
  clients: PortalOption[];
  labels: Record<string, string>;
}

export interface PortalFileBody { name: string; contentType: string; body: Buffer }

// ---- the advocate's portal page ---------------------------------------------------

// One step at a time on the advocate's page (withPortalPage tells a logged-out
// portal by its login form - Pleading Upload has its own hidden #user_name).
const withPage = withPortalPage;

// ---- in-page helpers ------------------------------------------------------------

const clean = (s: unknown): string => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

/** What the portal's JSON reply said (ajaxCall shows errormsg / msg the same way). */
function replySaid(json: Record<string, unknown> | null, text = ''): string[] {
  const out: string[] = [];
  if (json) {
    for (const k of ['errormsg', 'msg', 'msg1']) if (json[k]) out.push(clean(json[k]));
  } else if (text) {
    const msg = clean(text.split('#####')[0]);
    if (msg && msg.length < 400) out.push(msg);
  }
  return out;
}

const okReply = (json: Record<string, unknown> | null): boolean =>
  Boolean(json) && !json?.['errormsg'] && json?.['status'] !== false && json?.['status'] !== 'false';

/**
 * Record what the portal tells the advocate while `fn` runs: its alert
 * boxes (errorAlert / successAlert) and dialogs. A confirm() is accepted only
 * when the advocate confirmed that step in DifAi.
 */
async function hearing<T>(page: Page, acceptConfirm: boolean, fn: () => Promise<T>): Promise<{ value: T; said: string[] }> {
  const dialogs: string[] = [];
  const onDialog = (d: { message: () => string; type: () => string; accept: () => Promise<void>; dismiss: () => Promise<void> }) => {
    dialogs.push(clean(d.message()));
    void (d.type() === 'confirm' && !acceptConfirm ? d.dismiss() : d.type() === 'prompt' ? d.dismiss() : d.accept()).catch(() => {});
  };
  page.on('dialog', onDialog);
  await page.evaluate(() => {
    const w = globalThis as any;
    w.__difaiSaid = [];
    for (const name of ['errorAlert', 'successAlert']) {
      const orig = w[name];
      if (typeof orig === 'function' && !orig.__difai) {
        const wrapped = function (this: unknown, ...args: unknown[]) {
          w.__difaiSaid.push(String(args[0] ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim());
          return orig.apply(this, args);
        };
        (wrapped as any).__difai = true;
        w[name] = wrapped;
      }
    }
  }).catch(() => {});
  try {
    const value = await fn();
    await page.waitForTimeout(300);
    const fromPage = (await page.evaluate(() => (globalThis as any).__difaiSaid ?? []).catch(() => [])) as string[];
    return { value, said: [...fromPage, ...dialogs].filter(Boolean) };
  } finally {
    page.off('dialog', onDialog);
  }
}

/**
 * Call one of the portal page's own functions (as its button does) and catch
 * the reply to `route`. No request = the portal's own checks stopped it
 * (their message is in what was said).
 */
async function callPortalFn(page: Page, fn: string, args: unknown[], route: string | null, timeout = 30_000): Promise<{ called: boolean; json: Record<string, unknown> | null; sent: boolean }> {
  const sent = route ? page.waitForRequest((r) => r.url().includes(`p=${route}`), { timeout: 3_000 }).catch(() => null) : null;
  const answered = route ? page.waitForResponse((r) => r.url().includes(`p=${route}`), { timeout }).catch(() => null) : null;
  const called = await page.evaluate(({ fn, args }) => {
    const f = (globalThis as any)[fn];
    if (typeof f !== 'function') return false;
    try { f(...args); } catch { /* the portal's own errors stay on the portal */ }
    return true;
  }, { fn, args }).catch(() => false);
  if (!called || !route) return { called, json: null, sent: false };
  const req = await sent;
  if (!req) return { called, json: null, sent: false };
  const res = await answered;
  const json = res ? (await res.json().catch(() => null)) as Record<string, unknown> | null : null;
  await page.waitForTimeout(400);
  return { called, json, sent: true };
}

/** A portal reply's HTML table -> rows, the way the portal's DataTables shows it. */
async function parseTable(page: Page, html: string, opts: { hide?: number[]; groupBy?: number } = {}): Promise<PleadingTable> {
  if (!html || !String(html).trim()) return { headers: [], rows: [] };
  return page.evaluate(({ h, hide, groupBy }) => {
    // obj.tbl is the INSIDE of the portal's <table> (it does $('#newtbl').html(obj.tbl)).
    const src = /<table[\s>]/i.test(h) ? h : `<table>${h}</table>`;
    const doc = new (globalThis as any).DOMParser().parseFromString(String(src), 'text/html');
    const txt = (e: any) => String(e?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const outer = [...doc.querySelectorAll('table')].filter((t: any) => !t.parentElement?.closest('table')) as any[];
    const ownRows = (t: any) => [...t.rows].filter((r: any) => r.closest('table') === t);
    const table = doc.querySelector('table#example1') ?? outer.sort((a, b) => ownRows(b).length - ownRows(a).length)[0];
    if (!table) return { headers: [], rows: [] };
    const visible = (c: any) => {
      const k = c.cloneNode(true);
      for (const e of [...k.querySelectorAll('table, script, style, .modal, .popup, [style*="display:none"], [style*="display: none"]')]) e.remove();
      return k;
    };
    const lines = (k: any) => {
      for (const s of [...k.querySelectorAll('select')]) s.remove();
      for (const br of [...k.querySelectorAll('br')]) br.replaceWith('\n');
      for (const b of [...k.querySelectorAll('div, p, li')]) b.append('\n');
      return String(k.textContent ?? '').split('\n').map((x: string) => x.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
    };
    // fn('a', "b", 3) -> ['a', 'b', '3']
    const parseCall = (code: string): { fn: string; args: string[] } | null => {
      const m = /^\s*(?:javascript:)?\s*(?:return\s+)?([A-Za-z_$][\w$]*)\s*\(([\s\S]*?)\)\s*;?/.exec(code);
      if (!m) return null;
      const args: string[] = [];
      let cur = ''; let q: string | null = null; let any = false;
      for (const ch of m[2]!) {
        if (q) { if (ch === q) q = null; else cur += ch; continue; }
        if (ch === '"' || ch === "'") { q = ch; any = true; continue; }
        if (ch === ',') { args.push(any ? cur : cur.trim()); cur = ''; any = false; continue; }
        if (!/\s/.test(ch) || cur) cur += ch;
      }
      if (cur.trim() || any || args.length) args.push(any ? cur : cur.trim());
      return { fn: m[1]!, args };
    };
    const head = table.tHead?.rows?.length ? table.tHead.rows[table.tHead.rows.length - 1] : null;
    const firstTh = !head ? ownRows(table).find((r: any) => r.querySelector('th') && !r.querySelector('td')) : null;
    const hdr = head ?? firstTh;
    const headers = hdr ? [...hdr.cells].map(txt) : [];
    const keep = (_: unknown, i: number) => !(hide as number[]).includes(i);
    const rows: any[] = [];
    let lastGroup: string | null = null;
    for (const tr of ownRows(table) as any[]) {
      if (tr === hdr || tr.parentElement?.tagName === 'THEAD') continue;
      const cells = [...tr.cells] as any[];
      if (!cells.length) continue;
      if (cells.length === 1 && Number(cells[0].getAttribute('colspan') || 1) > 1) { rows.push({ group: txt(visible(cells[0])) }); continue; }
      const texts = cells.map((c) => lines(visible(c)));
      if (groupBy != null && groupBy >= 0) {
        const g = texts[groupBy] ?? '';
        if (g && g !== lastGroup) rows.push({ group: g.replace(/\n/g, ' ') });
        lastGroup = g;
      }
      const calls: Array<{ label: string; fn: string; args: string[] }> = [];
      const actions: string[] = [];
      for (const el of [...tr.querySelectorAll('[onclick], a[href^="javascript:"], [onchange]')] as any[]) {
        if (el.closest('.popup, [style*="display:none"], [style*="display: none"]') && el.closest('tr') !== tr) continue;
        const code = el.getAttribute('onclick') || el.getAttribute('href') || el.getAttribute('onchange') || '';
        const call = parseCall(code);
        if (!call) continue;
        const label = txt(el) || String(el.value ?? '').trim() || el.getAttribute('title') || el.getAttribute('aria-label')
          || el.getAttribute('data-original-title') || el.getAttribute('data-bs-original-title') || '';
        if (calls.some((c) => c.fn === call.fn && c.args.join('|') === call.args.join('|'))) continue;
        calls.push({ label, fn: call.fn, args: call.args });
        if (label && label.length < 40 && !actions.includes(label)) actions.push(label);
      }
      const selects = ([...tr.querySelectorAll('select')] as any[]).map((s) => ({
        id: String(s.id ?? ''), name: String(s.getAttribute('name') ?? ''),
        options: [...s.options].map((o: any) => ({ value: String(o.value), text: txt(o), selected: !!o.selected })),
      }));
      const checks = ([...tr.querySelectorAll('input[type=checkbox]')] as any[]).map((c) => ({
        id: String(c.id ?? ''), name: String(c.getAttribute('name') ?? ''), value: String(c.getAttribute('value') ?? ''),
        label: txt(c.closest('label')) || String(c.getAttribute('title') ?? ''), checked: c.hasAttribute('checked'),
      }));
      const row: any = { cells: texts.filter(keep) };
      if (actions.length) row.actions = actions;
      if (calls.length) row.calls = calls;
      if (selects.length) row.selects = selects;
      if (checks.length) row.checks = checks;
      if (row.cells.some(Boolean) || calls.length) rows.push(row);
    }
    return { headers: headers.filter(keep), rows };
  }, { h: String(html), hide: opts.hide ?? [], groupBy: opts.groupBy ?? -1 }) as Promise<PleadingTable>;
}

/** Fill a portal control and fire its change the way jQuery / chosen would. */
async function setControl(page: Page, sel: string, value: string): Promise<boolean> {
  return page.evaluate(({ sel, value }) => {
    const el = document.querySelector(sel) as any;
    if (!el) return false;
    if (el.tagName === 'SELECT') {
      const opt = [...el.options].find((o: any) => String(o.value) === value)
        ?? [...el.options].find((o: any) => String(o.value).split('~')[0] === value);
      if (!opt) return false;
      el.value = (opt as any).value;
    } else {
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const $ = (globalThis as any).jQuery;
    if ($) $(el).trigger('change').trigger('chosen:updated');
    else el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, { sel, value }).catch(() => false);
}

async function readOptions(page: Page, sel: string): Promise<PortalOption[]> {
  return page.evaluate((sel) => {
    const s = document.querySelector(sel) as any;
    if (!s || s.tagName !== 'SELECT') return [];
    return [...s.options].filter((o: any) => String(o.value) !== '')
      .map((o: any) => ({ value: String(o.value), text: String(o.textContent ?? '').replace(/\s+/g, ' ').trim(), selected: !!o.selected }));
  }, sel).catch(() => []);
}

async function waitOptions(page: Page, sel: string, timeout = 6_000): Promise<boolean> {
  return page.waitForFunction((s) => {
    const el = document.querySelector(s) as any;
    return !!el && el.options && [...el.options].some((o: any) => o.value);
  }, sel, { timeout, polling: 200 }).then(() => true).catch(() => false);
}

/** The text a portal control is labelled with on the page (label[for], its group's label, the cell before it). */
async function labelsFor(page: Page, ids: string[]): Promise<Record<string, string>> {
  return page.evaluate((ids) => {
    const txt = (e: any) => String(e?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const out: Record<string, string> = {};
    for (const id of ids) {
      const el = document.getElementById(id) as any;
      if (!el) continue;
      let t = txt(document.querySelector(`label[for="${id}"]`));
      if (!t && el.closest('label')) t = txt(el.closest('label'));
      if (!t && el.tagName === 'BUTTON') t = txt(el);
      if (!t && el.tagName === 'INPUT' && /button|submit/.test(el.type)) t = String(el.value ?? '').trim();
      if (!t) { const td = el.closest('td'); if (td?.previousElementSibling) t = txt(td.previousElementSibling); }
      if (!t) {
        const grp = el.closest('.form-group, .col-md-6, .col-md-4, .col-md-3, .col-sm-6, .col-lg-4, .col-lg-6, .col-md-12, .row');
        const l = grp?.querySelector('label, .font-weight-bold, b, strong');
        if (l && !l.contains(el)) t = txt(l);
      }
      if (!t) t = String(el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.title || '');
      if (t) out[id] = t.replace(/\s*:\s*$/, '');
    }
    return out;
  }, ids).catch(() => ({}));
}

/** Labels from the portal's own label/button/alert arrays (loaded per language). */
async function portalText(page: Page, keys: Array<[string, number]>): Promise<string[]> {
  return page.evaluate((keys) => keys.map(([arr, i]) => {
    const a = (globalThis as any)[arr];
    return a && a[i] != null ? String(a[i]).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
  }), keys).catch(() => keys.map(() => ''));
}

/** Fetch a document the portal pointed at, over the advocate's session. */
async function fetchInPage(page: Page, url: string, name: string, fallbackType: string): Promise<PortalFileBody> {
  if (url.startsWith('data:')) {
    const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
    if (!m) throw new EcourtsHttpError(502, 'The portal sent a document DifAi could not read.');
    return { name, contentType: m[1] || fallbackType, body: m[2] ? Buffer.from(m[3]!, 'base64') : Buffer.from(decodeURIComponent(m[3]!)) };
  }
  const viewer = /[?&]file=([^&#]+)/.exec(url);
  const target = /viewer\.html/i.test(url) && viewer ? decodeURIComponent(viewer[1]!) : url;
  const abs = new URL(target.split('#')[0]!, page.url()).toString();
  if (new URL(abs).hostname !== new URL(page.url()).hostname) {
    throw new EcourtsHttpError(502, 'The portal pointed the document somewhere else; DifAi did not follow it.');
  }
  const got = await page.evaluate(async (u) => {
    const r = await fetch(u, { credentials: 'include' });
    const buf = new Uint8Array(await r.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { status: r.status, type: r.headers.get('content-type') ?? '', b64: btoa(s) };
  }, abs);
  if (got.status >= 400) throw new EcourtsHttpError(502, `The portal answered ${got.status} for this document.`);
  return { name, contentType: got.type.split(';')[0] || fallbackType, body: Buffer.from(got.b64, 'base64') };
}

// ---- Pleadings > Pleading Upload: the screen and its case ------------------------

const onUploadScreen = async (page: Page): Promise<boolean> => Boolean(await page.$('#frm_doc')) && Boolean(await page.$('#add_btn'));

async function ensureUploadScreen(page: Page): Promise<void> {
  if (await onUploadScreen(page)) return;
  await closePortalPopups(page);
  const opened = await openPortalMenu(page, /pleading\s*upload/i) || await openPortalMenu(page, /^\s*pleadings?\s*$/i);
  if (!opened || !(await onUploadScreen(page))) {
    throw new EcourtsHttpError(502, "Couldn't open Pleadings > Pleading Upload on your portal account.");
  }
}

async function currentCase(page: Page): Promise<CaseRef & { hid: string } | null> {
  return page.evaluate(() => {
    const r = document.querySelector('input[name="cases"]:checked') as any;
    if (!r) return null;
    const src = String(r.value);
    const sel = document.getElementById(src === '3' ? 'sel_pde_no' : 'txt_case_search') as any;
    const hid = String((document.getElementById('hid_pde_no') as any)?.value ?? '');
    return { source: src, value: String(sel?.value ?? ''), hid };
  }).catch(() => null);
}

/** Choose the case the way the advocate does: the radio, then the e-filing number / case. */
async function chooseCase(page: Page, c: CaseRef): Promise<boolean> {
  const cur = await currentCase(page);
  if (cur && cur.source === c.source && cur.value === c.value && cur.hid === c.value) return false;
  const radio = await page.evaluate((v) => {
    const r = document.querySelector(`input[name="cases"][value="${v}"]`) as any;
    if (!r) return false;
    if (!r.checked) r.click();
    return true;
  }, c.source).catch(() => false);
  if (!radio) throw new EcourtsHttpError(409, 'The portal has no such case choice on Pleading Upload.');
  const sel = c.source === '3' ? '#sel_pde_no' : '#txt_case_search';
  const isSelect = await page.evaluate((s) => (document.querySelector(s) as any)?.tagName === 'SELECT', sel).catch(() => false);
  if (isSelect) await waitOptions(page, sel);
  // An existing case not in the box (the page was reloaded): search the advocate's cases for it, as typing would.
  if (c.source === '1' && !(await readOptions(page, sel)).some((o) => o.value === c.value)) await searchMyCases(page, c.value);
  const answered = page.waitForResponse((r) => r.url().includes('p=upload_pleading/fetchPleadingData'), { timeout: 20_000 }).catch(() => null);
  if (!(await setControl(page, sel, c.value))) {
    throw new EcourtsHttpError(409, `${c.value} is not in this list on your portal account.`);
  }
  await answered;
  // The clients of this case (who the pleading is for) come in with it.
  await page.waitForSelector('input[name="chk_pet_list[]"], input[name="chk_res_list[]"]', { timeout: 6_000 }).catch(() => {});
  await page.waitForTimeout(300);
  return true;
}

async function readParties(page: Page): Promise<PleadingCaseView['parties']> {
  return page.evaluate(() => {
    const txt = (e: any) => String(e?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const out: any[] = [];
    for (const [name, side] of [['chk_pet_list[]', 'pet'], ['chk_res_list[]', 'res']] as const) {
      for (const c of [...document.querySelectorAll(`input[name="${name}"]`)] as any[]) {
        const l = c.id ? document.querySelector(`label[for="${c.id}"]`) : null;
        const label = txt(l) || txt(c.closest('label')) || txt(c.parentElement) || String(c.value).split('~')[3] || String(c.value);
        out.push({ side, value: String(c.value), label, checked: !!c.checked });
      }
    }
    return out;
  }).catch(() => []);
}

async function readAdded(page: Page): Promise<AddedFile[]> {
  return page.evaluate(() => {
    const txt = (e: any) => String(e?.textContent ?? '').replace(/\s+/g, ' ').trim();
    return ([...document.querySelectorAll('#upload_pdf_name > li')] as any[]).map((li) => {
      const cols = [...li.querySelectorAll('.text-break')] as any[];
      return {
        title: txt(cols[0]),
        file: txt(li.querySelector('.up_file_name a')),
        size: txt(li.querySelector('.up_file_size')),
        signed: !!li.querySelector('.badge-success'),
      };
    });
  }).catch(() => []);
}

async function caseTable(page: Page, c: CaseRef): Promise<PleadingTable> {
  // The same request fetchPleadingData() makes, sent without clearing what is Added on the page.
  const body = await page.evaluate(() => ({
    pde: String((document.getElementById('sel_pde_no') as any)?.value ?? ''),
    cino: String((document.getElementById('txt_case_search') as any)?.value ?? ''),
  })).catch(() => ({ pde: '', cino: '' }));
  const pde = c.source === '3' ? c.value : body.pde;
  const cino = c.source === '1' ? c.value : body.cino;
  const r = await portalPost(page, 'upload_pleading/fetchPleadingData', `column_cnt=2&type_of_case=${c.source}&sel_pde_no=${pde}&hid_cino=${cino}`);
  // DataTables there: column 2 hidden, rows grouped by it.
  return parseTable(page, String(r.json?.['tbl'] ?? ''), { hide: [2], groupBy: 2 });
}

/** The list reload the portal itself sends after a change (fetchPleadingData). */
const listReload = (page: Page) => page.waitForResponse((x) => x.url().includes('p=upload_pleading/fetchPleadingData'), { timeout: 15_000 }).catch(() => null);

const readClientsLabel = (page: Page): Promise<string> =>
  page.evaluate(() => String((document.getElementById('sp_pet_called_as') as any)?.textContent ?? '').replace(/\s+/g, ' ').trim()).catch(() => '');

async function caseView(page: Page, c: CaseRef): Promise<PleadingCaseView> {
  return { case: c, table: await caseTable(page, c), parties: await readParties(page), clientsLabel: await readClientsLabel(page), added: await readAdded(page) };
}

/**
 * Existing case: #txt_case_search is a chosen box the advocate types into;
 * from 3 letters common_pleading_temp.js asks custom_component/get_my_cases
 * and puts the options it returns into the box. The same here.
 */
async function searchMyCases(page: Page, term: string): Promise<PortalOption[]> {
  const gp = await page.evaluate(() => String((document.getElementById('gov_pleader_allocated') as any)?.value ?? '')).catch(() => '');
  const r = await portalPost(page, 'custom_component/get_my_cases', `term=${term}&gov_pleader_allocated=${gp}`);
  const html = String(r.json?.['options'] ?? '');
  await page.evaluate((h) => {
    const s = document.getElementById('txt_case_search') as any;
    if (!s) return;
    s.innerHTML = h;
    const $ = (globalThis as any).jQuery;
    if ($) $(s).trigger('chosen:updated');
  }, html).catch(() => {});
  return readOptions(page, '#txt_case_search');
}

export async function searchPleadingCases(sessionId: string, userId: string, input: { term: string }): Promise<PortalOption[]> {
  if (input.term.trim().length < 3) throw new EcourtsHttpError(400, 'Type at least 3 letters of the case.');
  return withPage(sessionId, userId, async (page) => {
    await ensureUploadScreen(page);
    await page.evaluate(() => { const r = document.querySelector('input[name="cases"][value="1"]') as any; if (r && !r.checked) r.click(); }).catch(() => {});
    return searchMyCases(page, input.term.trim());
  });
}

export async function readPleadingScreen(sessionId: string, userId: string): Promise<PleadingScreen> {
  return withPage(sessionId, userId, async (page) => {
    await ensureUploadScreen(page);
    // The e-filed numbers: listed when the e-filed choice is on.
    if (!(await readOptions(page, '#sel_pde_no')).length) {
      await page.evaluate(() => { const r = document.querySelector('input[name="cases"][value="3"]') as any; if (r && !r.checked) r.click(); }).catch(() => {});
      await waitOptions(page, '#sel_pde_no', 5_000);
    }
    const shape = await page.evaluate(() => {
      const txt = (e: any) => String(e?.textContent ?? '').replace(/\s+/g, ' ').trim();
      const sources = ([...document.querySelectorAll('input[name="cases"]')] as any[]).map((r) => {
        const l = r.id ? document.querySelector(`label[for="${r.id}"]`) : null;
        return { value: String(r.value), label: txt(l) || txt(r.closest('label')) || txt(r.nextSibling) || String(r.value), checked: !!r.checked };
      });
      // The page's tabs: the nav holding #pleading_index_tab / #pleading_esign_tab.
      const anchor = document.getElementById('pleading_index_tab') ?? document.getElementById('pleading_esign_tab');
      const nav = anchor?.closest('.nav, .nav-tabs, ul, [role=tablist]');
      const tabEls = nav ? [...nav.querySelectorAll('a, button, [role=tab]')] as any[] : (anchor ? [anchor] : []);
      const tabs = tabEls.filter((t) => txt(t)).map((t) => ({ id: String(t.id ?? ''), label: txt(t) }));
      const title = txt(document.querySelector('.page-title, .card-header h4, .card-header h3, h1, h2, h3, h4'));
      return { sources, tabs, title };
    });
    const labels = await labelsFor(page, ['sel_pde_no', 'txt_case_search', 'selDocType', 'file_name', 'doc_file_name', 'add_btn', 'chkShowAll', 'chkShowAlleSign', 'merge_txt', 'index_title', 'from_page_no', 'to_page_no', 'selDocument']);
    const submit = await page.evaluate(() => {
      const b = document.querySelector('[onclick*="submitData"]') as any;
      return b ? String(b.textContent ?? b.value ?? '').replace(/\s+/g, ' ').trim() : '';
    }).catch(() => '');
    if (submit) labels['submit'] = submit;
    const docTypes = (await page.$('#selDocType')) ? await readOptions(page, '#selDocType') : null;
    const cur = await currentCase(page);
    return {
      title: shape.title,
      sources: shape.sources,
      efiled: await readOptions(page, '#sel_pde_no'),
      existing: await readOptions(page, '#txt_case_search'),
      tabs: shape.tabs,
      labels,
      docTypes,
      selected: cur && cur.value ? { source: cur.source, value: cur.value } : null,
    };
  });
}

/** Choose a case on Pleading Upload; its uploaded pleadings and clients. */
export async function selectPleadingCase(sessionId: string, userId: string, c: CaseRef): Promise<PleadingCaseView> {
  return withPage(sessionId, userId, async (page) => {
    await ensureUploadScreen(page);
    await chooseCase(page, c);
    return caseView(page, c);
  });
}

// ---- upload: Add file(s), then Submit ----------------------------------------------

export interface AddFileInput extends CaseRef {
  title: string;
  docType?: string | null;
  file: { name: string; base64: string };
}

/** #add_btn: one file up to the portal (upload_pleading/addFile), listed under the form until Submit. */
export async function addPleadingFile(sessionId: string, userId: string, input: AddFileInput): Promise<PortalSaid & { added: AddedFile[]; pleadingNumber: string | null; signed: boolean }> {
  const body = Buffer.from(input.file.base64, 'base64');
  if (!body.length) throw new EcourtsHttpError(400, 'The file is empty.');
  return withPage(sessionId, userId, async (page) => {
    await ensureUploadScreen(page);
    await chooseCase(page, input);
    if (input.docType && (await page.$('#selDocType'))) {
      if (!(await setControl(page, '#selDocType', input.docType))) throw new EcourtsHttpError(409, 'That document type is not offered on your portal.');
    }
    const readonly = await page.evaluate(() => !!(document.getElementById('file_name') as any)?.readOnly).catch(() => false);
    if (!readonly) {
      await page.fill('#file_name', input.title);
      // The portal checks the title on blur (its red notes under the field).
      await page.evaluate(() => { const $ = (globalThis as any).jQuery; const el = document.getElementById('file_name'); if ($) $(el).trigger('blur'); else el?.dispatchEvent(new Event('blur')); }).catch(() => {});
    }
    const name = /\.pdf$/i.test(input.file.name) ? input.file.name : `${input.file.name}.pdf`;
    await page.setInputFiles('#doc_file_name', { name, mimeType: 'application/pdf', buffer: body });
    const { value: res, said } = await hearing(page, false, async () => {
      const sent = page.waitForRequest((r) => r.url().includes('p=upload_pleading/addFile'), { timeout: 3_000 }).catch(() => null);
      const answered = page.waitForResponse((r) => r.url().includes('p=upload_pleading/addFile'), { timeout: 120_000 }).catch(() => null);
      await page.click('#add_btn');
      if (!(await sent)) return null;
      const r = await answered;
      await page.waitForTimeout(400);
      return r ? (await r.json().catch(() => null)) as Record<string, unknown> | null : null;
    });
    const notes = await page.evaluate(() => ([...document.querySelectorAll('.file-error')] as any[]).map((e) => String(e.textContent ?? '').trim())).catch(() => []);
    const portal = [...new Set([...said, ...notes, ...replySaid(res)])];
    return {
      ok: okReply(res),
      portal,
      added: await readAdded(page),
      pleadingNumber: typeof res?.['pleading_number'] === 'string' ? res['pleading_number'] : null,
      signed: res?.['signed_flg'] === 'Y',
    };
  });
}

/** Submit (submitData -> upload_pleading/addData): the Added files become this case's pleading. */
export async function submitPleadingFiles(sessionId: string, userId: string, input: CaseRef & { parties: string[]; confirmed: boolean }): Promise<PortalSaid & { view: PleadingCaseView }> {
  if (!input.confirmed) throw new EcourtsHttpError(400, 'Confirm Submit first - the pleading is then filed against this case on the portal.');
  return withPage(sessionId, userId, async (page) => {
    await ensureUploadScreen(page);
    const cur = await currentCase(page);
    if (!cur || cur.source !== input.source || cur.value !== input.value) {
      throw new EcourtsHttpError(409, 'The portal is on another case now - Add the files again for this case.');
    }
    if (!(await readAdded(page)).length) throw new EcourtsHttpError(409, 'No file is Added on the portal for this case yet (the portal clears them when the case is reloaded).');
    // Who the pleading is for: the clients the advocate ticked.
    await page.evaluate((want) => {
      for (const c of [...document.querySelectorAll('input[name="chk_pet_list[]"], input[name="chk_res_list[]"]')] as any[]) {
        if (!!c.checked !== want.includes(String(c.value))) c.click();
      }
    }, input.parties).catch(() => {});
    // The portal reloads the list itself after a Submit (fetchPleadingData).
    const reloaded = listReload(page);
    const { value: r, said } = await hearing(page, false, () => callPortalFn(page, 'submitData', [], 'upload_pleading/addData', 120_000));
    if (!r.called) throw new EcourtsHttpError(502, 'The Pleading Upload screen on the portal has no Submit here.');
    if (r.sent) await reloaded;
    return { ok: r.sent && okReply(r.json), portal: [...new Set([...said, ...replySaid(r.json)])], view: await caseView(page, input) };
  });
}

/** A pleading's delete (removeFile) - the portal also deletes its oath recording. */
export async function deletePleading(sessionId: string, userId: string, input: CaseRef & { pleadingNumber: string; confirmed: boolean }): Promise<PortalSaid & { view: PleadingCaseView }> {
  if (!input.confirmed) throw new EcourtsHttpError(400, 'Confirm the delete first - the associated oath recording is deleted too.');
  return withPage(sessionId, userId, async (page) => {
    await ensureUploadScreen(page);
    await chooseCase(page, input);
    const reloaded = listReload(page);
    const { value: r, said } = await hearing(page, true, () => callPortalFn(page, 'removeFile', [input.pleadingNumber], 'upload_pleading/removeFile'));
    if (!r.called) throw new EcourtsHttpError(502, 'The Pleading Upload screen on the portal has no delete here.');
    if (r.sent) await reloaded;
    return { ok: r.sent && okReply(r.json), portal: [...new Set([...said, ...replySaid(r.json)])], view: await caseView(page, input) };
  });
}

/** Merge (goToMerge + mergeFiles -> upload_pleading/mergedocSubmit): two or more pleadings into one. */
export async function mergePleadings(sessionId: string, userId: string, input: CaseRef & { pleadingNumbers: string[]; title: string; confirmed: boolean }): Promise<PortalSaid & { view: PleadingCaseView }> {
  if (!input.confirmed) throw new EcourtsHttpError(400, 'Confirm the merge first - the earlier indexing of these documents is removed.');
  return withPage(sessionId, userId, async (page) => {
    await ensureUploadScreen(page);
    await chooseCase(page, input);
    const opened = await page.evaluate((nos) => {
      for (const c of [...document.querySelectorAll('input[type=checkbox][id^="chk_"]')] as any[]) {
        const want = nos.includes(String(c.id).replace(/^chk_/, ''));
        if (!!c.checked !== want) c.checked = want;
      }
      const btn = document.querySelector('[onclick*="goToMerge"]') as any;
      if (!btn) return false;
      btn.click();
      return true;
    }, input.pleadingNumbers).catch(() => false);
    if (!opened) throw new EcourtsHttpError(409, 'The portal has no Merge for this case.');
    await page.fill('#merge_txt', input.title).catch(() => {});
    // The portal reloads the list itself after a merge (fetchPleadingData).
    const reloaded = listReload(page);
    const { value: r, said } = await hearing(page, true, () => callPortalFn(page, 'mergeFiles', [], 'upload_pleading/mergedocSubmit', 120_000));
    if (r.sent) await reloaded;
    await closePortalPopups(page);
    return { ok: r.sent && okReply(r.json), portal: [...new Set([...said, ...replySaid(r.json)])], view: await caseView(page, input) };
  });
}

/** The PDF of a pleading, as showFile(pleading) shows it in the portal's viewer. */
export async function viewPleadingFile(sessionId: string, userId: string, input: CaseRef & { pleadingNumber: string }): Promise<PortalFileBody> {
  return withPage(sessionId, userId, async (page) => {
    await ensureUploadScreen(page);
    await chooseCase(page, input);
    await page.evaluate(() => { for (const o of [...document.querySelectorAll('#viewFiles-body object')]) o.remove(); }).catch(() => {});
    const shown = page.waitForFunction(() => {
      const o = document.querySelector('#viewFiles-body object[data], #viewFiles-body iframe[src]') as any;
      return o ? String(o.getAttribute('data') ?? o.getAttribute('src')) : false;
    }, undefined, { timeout: 25_000, polling: 250 }).then((h) => h.jsonValue() as Promise<string>).catch(() => null);
    const called = await page.evaluate((no) => { const f = (globalThis as any).showFile; if (typeof f !== 'function') return false; f(no); return true; }, input.pleadingNumber).catch(() => false);
    if (!called) throw new EcourtsHttpError(502, 'The Pleading Upload screen on the portal cannot show documents here.');
    const url = await shown;
    try {
      if (!url) throw new EcourtsHttpError(502, 'The portal did not show this document. It may be slow - try again.');
      return await fetchInPage(page, url, `${input.pleadingNumber}.pdf`, 'application/pdf');
    } finally {
      await closePortalPopups(page);
    }
  });
}

// ---- Pleading Index tab --------------------------------------------------------------

async function readIndex(page: Page, all: boolean): Promise<{ table: PleadingTable; showAllLabel: string }> {
  const { json } = await callPortalFn(page, 'fetchPleadingIndex', [1, all ? 1 : 2], 'pleading_index/fetchPleadingData');
  const showAllLabel = (await labelsFor(page, ['chkShowAll']))['chkShowAll'] ?? '';
  // DataTables there: columns 1 and 2 hidden, grouped by column 2.
  return { table: await parseTable(page, String(json?.['tbl'] ?? ''), { hide: [1, 2], groupBy: 2 }), showAllLabel };
}

export async function readPleadingIndex(sessionId: string, userId: string, input: CaseRef & { all?: boolean }) {
  return withPage(sessionId, userId, async (page) => {
    await ensureUploadScreen(page);
    await chooseCase(page, input);
    return readIndex(page, Boolean(input.all));
  });
}

/** Add Index (addIndex + documentIndex -> pleading_index/documentIndex): a bookmark over pages. */
export async function addPleadingIndex(sessionId: string, userId: string, input: CaseRef & { pleadingNumber: string; title: string; fromPage: number; toPage: number }) {
  return withPage(sessionId, userId, async (page) => {
    await ensureUploadScreen(page);
    await chooseCase(page, input);
    await callPortalFn(page, 'addIndex', [input.pleadingNumber], null);
    await page.evaluate(({ no, t, f, to }) => {
      const set = (id: string, v: string) => { const el = document.getElementById(id) as any; if (el) el.value = v; };
      set('selDocument', no);
      set('index_title', t);
      set('from_page_no', f);
      set('to_page_no', to);
    }, { no: input.pleadingNumber, t: input.title, f: String(input.fromPage), to: String(input.toPage) });
    const { value: r, said } = await hearing(page, false, () => callPortalFn(page, 'documentIndex', [], 'pleading_index/documentIndex'));
    await closePortalPopups(page);
    const after = await readIndex(page, false);
    return { ok: r.sent && okReply(r.json), portal: [...new Set([...said, ...replySaid(r.json)])], ...after };
  });
}

export async function deletePleadingIndex(sessionId: string, userId: string, input: CaseRef & { pleadingNumber: string; srNo: string; confirmed: boolean }) {
  if (!input.confirmed) throw new EcourtsHttpError(400, 'Confirm the delete first.');
  return withPage(sessionId, userId, async (page) => {
    await ensureUploadScreen(page);
    await chooseCase(page, input);
    const { value: r, said } = await hearing(page, true, () => callPortalFn(page, 'deleteIndex', [input.pleadingNumber, input.srNo], 'pleading_index/deleteIndex'));
    const after = await readIndex(page, false);
    return { ok: r.sent && okReply(r.json), portal: [...new Set([...said, ...replySaid(r.json)])], ...after };
  });
}

// ---- eSign tab: authorisation, Aadhaar eSign, OTP authentication ----------------------

async function readEsign(page: Page, all: boolean): Promise<{ table: PleadingTable; showAllLabel: string }> {
  // fetchPleadingEsign also keeps each pleading's signer list (#dv_<pleading>), which eSign sends.
  const { json } = await callPortalFn(page, 'fetchPleadingEsign', [1, all ? 1 : 2], 'pleading_esign_test/fetchPleadingData');
  const showAllLabel = (await labelsFor(page, ['chkShowAlleSign']))['chkShowAlleSign'] ?? '';
  return { table: await parseTable(page, String(json?.['tbl'] ?? ''), { hide: [1, 2], groupBy: 2 }), showAllLabel };
}

export async function readPleadingEsign(sessionId: string, userId: string, input: CaseRef & { all?: boolean }) {
  return withPage(sessionId, userId, async (page) => {
    await ensureUploadScreen(page);
    await chooseCase(page, input);
    return readEsign(page, Boolean(input.all));
  });
}

async function parseAuth(page: Page, json: Record<string, unknown> | null): Promise<Omit<AuthChoice, 'labels'>> {
  return page.evaluate(({ adv, lit }) => {
    const txt = (e: any) => String(e?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const read = (html: string, kind: 'adv' | 'lit') => {
      const doc = new (globalThis as any).DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
      const radioName = kind === 'adv' ? 'aesigotp' : 'lesigotp';
      return ([...doc.querySelectorAll('input[type=checkbox]')] as any[]).map((c) => {
        const idx = String(c.id ?? '').split('_')[1] ?? '';
        const own = c.id ? doc.querySelector(`label[for="${c.id}"]`) : null;
        const radios = [...doc.querySelectorAll(`input[type=radio][name="${radioName}[${idx}]"]`)] as any[];
        return {
          id: String(c.id ?? ''), value: String(c.getAttribute('value') ?? ''), idx,
          label: txt(own) || txt(c.closest('label')) || txt(c.parentElement) || String(c.getAttribute('value') ?? ''),
          checked: c.hasAttribute('checked'),
          choices: radios.map((r) => {
            const l = r.id ? doc.querySelector(`label[for="${r.id}"]`) : null;
            return { value: String(r.getAttribute('value') ?? ''), label: txt(l) || txt(r.closest('label')) || txt(r.nextSibling) || String(r.getAttribute('value') ?? ''), checked: r.hasAttribute('checked') };
          }),
        };
      });
    };
    return { advocates: read(adv, 'adv'), clients: read(lit, 'lit') };
  }, { adv: String(json?.['adv_option'] ?? ''), lit: String(json?.['lit_option'] ?? '') });
}

/** Who is to sign a pleading (addAuth -> pleading_index/fetchAdvLit): advocates and clients, eSign or OTP each. */
export async function readPleadingAuth(sessionId: string, userId: string, input: CaseRef & { pleadingNumber: string; pdeNo: string; dirMonth?: string }): Promise<AuthChoice> {
  return withPage(sessionId, userId, async (page) => {
    await ensureUploadScreen(page);
    await chooseCase(page, input);
    const { json } = await callPortalFn(page, 'addAuth', [input.pleadingNumber, input.pdeNo, input.dirMonth ?? ''], 'pleading_index/fetchAdvLit');
    if (!json) throw new EcourtsHttpError(502, 'The portal did not list who can sign this pleading.');
    const [title, advocates, clients, submit] = await portalText(page, [['labels_array', 2441], ['labels_array', 140], ['labels_array', 2431], ['buttons_array', 1]]);
    await closePortalPopups(page);
    return { labels: { title: title!, advocates: advocates!, clients: clients!, submit: submit! }, ...(await parseAuth(page, json)) };
  });
}

/** Save who signs (pleading_index/submitAuth) - the same request submitAuth() sends. */
export async function savePleadingAuth(sessionId: string, userId: string, input: CaseRef & {
  pleadingNumber: string;
  advocates: Array<{ value: string; sign: string }>;
  clients: Array<{ value: string; sign: string }>;
}) {
  return withPage(sessionId, userId, async (page) => {
    await ensureUploadScreen(page);
    const [needType, needOne] = await portalText(page, [['alerts_array', 670], ['alerts_array', 671]]);
    if (!input.advocates.length && !input.clients.length) throw new EcourtsHttpError(400, needOne || 'Please select Clients OR Advocates.');
    if ([...input.advocates, ...input.clients].some((x) => !x.sign)) throw new EcourtsHttpError(400, needType || 'Please select Signature type.');
    await chooseCase(page, input);
    const postdata = `&pleading_number=${input.pleadingNumber}&advchk=${input.advocates.map((a) => a.value).join('#')}&litchk=${input.clients.map((a) => a.value).join('#')}`
      + `&aesigotp=${input.advocates.map((a) => a.sign).join('#')}&lesigotp=${input.clients.map((a) => a.sign).join('#')}`;
    const r = await portalPost(page, 'pleading_index/submitAuth', postdata.replace(/^&/, ''));
    const after = await readEsign(page, false);
    return { ok: okReply(r.json), portal: replySaid(r.json, r.text), ...after };
  });
}

/** The child frame showing the eSign gateway (the ESP page the portal put in its <object>). */
async function gatewayFrame(page: Page, url: string | null, wait = 15_000): Promise<Frame | null> {
  const portalHost = new URL(page.url()).hostname;
  const deadline = Date.now() + wait;
  for (;;) {
    // Only a frame the advocate would see (the portal copies the <object> into its alert box).
    const frames: Frame[] = [];
    for (const f of page.frames()) {
      if (f === page.mainFrame() || !f.url() || f.url() === 'about:blank') continue;
      const el = await f.frameElement().catch(() => null);
      if (el && await el.boundingBox().catch(() => null)) frames.push(f);
    }
    const want = url ? new URL(url, page.url()) : null;
    const hit = (want && frames.find((f) => { try { const u = new URL(f.url()); return u.origin === want.origin && u.pathname === want.pathname; } catch { return false; } }))
      ?? frames.find((f) => { try { return new URL(f.url()).hostname !== portalHost; } catch { return false; } })
      ?? null;
    if (hit || Date.now() > deadline) return hit;
    await page.waitForTimeout(250);
  }
}

async function readGateway(page: Page, frame: Frame | null, url: string, said: string[]): Promise<GatewayView> {
  // Back on the portal with the document signed: upload_pleading opens with #esigned = 'Y'.
  const esigned = await page.evaluate(() => String((document.getElementById('esigned') as any)?.value ?? '') === 'Y').catch(() => false);
  if (!frame || esigned) {
    const [done] = await portalText(page, [['alerts_array', 659]]);
    return { url, done: esigned, text: esigned ? [done || 'Document signed Successfully'] : [], fields: [], buttons: [], screenshotBase64: null, portal: said };
  }
  await frame.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});
  const shape = await frame.evaluate(() => {
    const txt = (e: any) => String(e?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const vis = (e: any) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
    const fields = ([...document.querySelectorAll('input, select, textarea')] as any[])
      .filter((e) => vis(e) && !/^(hidden|submit|button|image|reset)$/i.test(e.type ?? ''))
      .map((e) => {
        const key = String(e.id || e.getAttribute('name') || '');
        const l = e.id ? document.querySelector(`label[for="${e.id}"]`) : null;
        return {
          key,
          label: txt(l) || txt(e.closest('label')) || String(e.getAttribute('placeholder') ?? '') || key,
          type: e.tagName === 'SELECT' ? 'select' : String(e.type ?? 'text'),
          ...(e.tagName === 'SELECT' ? { options: [...e.options].map((o: any) => ({ value: String(o.value), text: txt(o) })) } : {}),
        };
      }).filter((f) => f.key);
    const buttons = ([...document.querySelectorAll('button, input[type=submit], input[type=button], a.btn')] as any[])
      .filter(vis).map((b) => txt(b) || String(b.value ?? '').trim()).filter(Boolean);
    const text = String((document.body as any)?.innerText ?? '').split('\n').map((s: string) => s.trim()).filter(Boolean).slice(0, 40);
    return { fields, buttons: [...new Set(buttons)], text };
  }).catch(() => ({ fields: [], buttons: [], text: [] as string[] }));
  const el = await frame.frameElement().catch(() => null);
  const shot = el ? await el.screenshot({ type: 'png' }).catch(() => null) : null;
  return { url: frame.url() || url, done: false, ...shape, screenshotBase64: shot ? shot.toString('base64') : null, portal: said };
}

/**
 * eSign (showFrame -> "I accept the Terms & Conditions" -> showEsignFrame ->
 * pleading_esign_test/esign_trans): the portal opens the Aadhaar eSign
 * gateway in its page. DifAi shows that gateway's own fields; the advocate
 * types what it asks (Aadhaar / VID, OTP) and DifAi passes it on as typed.
 */
export async function startPleadingEsign(sessionId: string, userId: string, input: CaseRef & { pleadingNumber: string; signCounter: string; pageCreated: string; userName: string; accepted: boolean }): Promise<GatewayView> {
  if (!input.accepted) throw new EcourtsHttpError(400, 'Accept the Terms & Conditions first.');
  return withPage(sessionId, userId, async (page) => {
    await ensureUploadScreen(page);
    await chooseCase(page, input);
    // The signer list the eSign request carries (#dv_<pleading>) comes with the eSign list.
    if (!(await page.$(`#dv_${input.pleadingNumber}`))) await readEsign(page, false);
    const { value: r, said } = await hearing(page, false, () => callPortalFn(page, 'showEsignFrame', [input.pleadingNumber, input.signCounter, input.pageCreated, input.userName], 'pleading_esign_test/esign_trans', 60_000));
    if (!r.called) throw new EcourtsHttpError(502, 'The eSign tab on the portal has no eSign here.');
    const url = typeof r.json?.['url'] === 'string' ? r.json['url'] : '';
    if (!url) return { url: '', done: false, text: [], fields: [], buttons: [], screenshotBase64: null, portal: [...said, ...replySaid(r.json)] };
    return readGateway(page, await gatewayFrame(page, url), url, [...said, ...replySaid(r.json)].filter((s) => s.length < 300));
  });
}

/** The advocate's entries for the eSign gateway's fields, then the gateway's button they pressed. */
export async function stepPleadingEsign(sessionId: string, userId: string, input: { values: Record<string, string>; press: string }): Promise<GatewayView> {
  return withPage(sessionId, userId, async (page) => {
    const frame = await gatewayFrame(page, null, 3_000);
    if (!frame) return readGateway(page, null, '', []);
    const frameBefore = frame.url();
    const mainBefore = page.url();
    const { said } = await hearing(page, false, async () => {
      const ok = await frame.evaluate(({ values, press }) => {
        for (const [key, v] of Object.entries(values)) {
          const el = (document.getElementById(key) ?? document.querySelector(`[name="${key}"]`)) as any;
          if (!el) continue;
          if (el.type === 'checkbox' || el.type === 'radio') { if (!!el.checked !== (v === 'true' || v === el.value)) el.click(); continue; }
          el.value = v;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
        const txt = (e: any) => String(e?.textContent ?? '').replace(/\s+/g, ' ').trim() || String(e.value ?? '').trim();
        const b = ([...document.querySelectorAll('button, input[type=submit], input[type=button], a.btn')] as any[]).find((x) => txt(x) === press);
        if (!b) return false;
        b.click();
        return true;
      }, input).catch(() => false);
      if (!ok) throw new EcourtsHttpError(409, `The eSign page has no "${input.press}" now.`);
      // The gateway moves to its next page - or, once signed, hands back to the
      // portal, which reloads Pleading Upload in the whole window.
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        await page.waitForTimeout(300);
        if (page.url() !== mainBefore || frame.isDetached()) break;
        if (frame.url() !== frameBefore) {
          await frame.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});
          await page.waitForTimeout(1_500);
          if (page.url() === mainBefore && !frame.isDetached()) break;
        }
      }
      await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(500);
    });
    const next = await gatewayFrame(page, null, 3_000);
    return readGateway(page, next, next?.url() ?? '', said);
  });
}

/** OTP authentication instead of eSign (showEsignFrame1 + sendOTP -> pleading_esign_test/sendOTP). */
export async function sendPleadingOtp(sessionId: string, userId: string, input: CaseRef & { args: string[]; mobile: string }) {
  return withPage(sessionId, userId, async (page) => {
    await ensureUploadScreen(page);
    await chooseCase(page, input);
    // showEsignFrame1 opens the OTP window (#verifyMsg) and keeps the row's details in its hidden fields.
    const opened = await callPortalFn(page, 'showEsignFrame1', input.args, null);
    if (!opened.called) throw new EcourtsHttpError(502, 'The eSign tab on the portal has no OTP authentication here.');
    await page.evaluate((m) => { const el = document.getElementById('mobile') as any; if (el) el.value = m; }, input.mobile).catch(() => {});
    const { value: r, said } = await hearing(page, false, () => callPortalFn(page, 'sendOTP', [], 'pleading_esign_test/sendOTP'));
    const button = await page.evaluate(() => String((document.getElementById('sotp_go') as any)?.value ?? '')).catch(() => '');
    const portal = [...new Set([...said, ...replySaid(r.json)])];
    return { ok: r.sent && okReply(r.json), portal, button, locked: portal.some((m) => /after 2 minute/i.test(m)) };
  });
}

/** verifyOTP -> pleading_esign_test/verifyOTP: the OTP the signer received, as the advocate typed it. */
export async function verifyPleadingOtp(sessionId: string, userId: string, input: { otp: string }) {
  return withPage(sessionId, userId, async (page) => {
    const open = await page.evaluate(() => String((document.getElementById('pleading_number') as any)?.value ?? '')).catch(() => '');
    if (!open) throw new EcourtsHttpError(409, 'Send the OTP first - the portal has no OTP window open.');
    await page.evaluate((o) => { const el = document.getElementById('otp') as any; if (el) el.value = o; }, input.otp).catch(() => {});
    const { value: r, said } = await hearing(page, false, () => callPortalFn(page, 'verifyOTP', [], 'pleading_esign_test/verifyOTP'));
    const verified = Boolean(r.json?.['msg']);
    const after = verified ? await readEsign(page, false) : null;
    return { ok: verified, portal: [...new Set([...said, ...replySaid(r.json)])], ...(after ?? {}) };
  });
}

// ---- Dashboard > Draft Pleadings (submit with GRN) / Completed Pleadings (re-submit) ----

const DRAFT_ROUTES = { draft: 'dashboard/fetchActivities', completed: 'dashboard/fetchCompletedActivities' } as const;

async function readDraftList(page: Page, kind: keyof typeof DRAFT_ROUTES): Promise<PleadingTable & { total: number }> {
  const r = await portalPost(page, DRAFT_ROUTES[kind], '');
  if (!r.json) throw new EcourtsHttpError(502, `The portal did not answer with ${kind === 'draft' ? 'Draft' : 'Completed'} Pleadings.`);
  const t = await parseTable(page, String(r.json['submitted_pde_list'] ?? ''));
  return { ...t, total: Number(r.json['total_record'] ?? t.rows.length) || 0 };
}

export async function readDraftPleadings(sessionId: string, userId: string, kind: 'draft' | 'completed') {
  return withPage(sessionId, userId, (page) => readDraftList(page, kind));
}

/**
 * Submit a draft pleading to the court (dashboard.js submit_pleading ->
 * Dashboard/submit_pleading/) with the GRN chosen in its row. Without a GRN
 * the portal asks "submit case without court fee..?" - `withoutCourtFee`.
 */
export async function submitDraftPleading(sessionId: string, userId: string, input: { uniqueId: string; typeOfCase: string; efilingNumber: string; grn: string; withoutCourtFee?: boolean; confirmed: boolean }) {
  if (!input.confirmed) throw new EcourtsHttpError(400, 'Confirm the submission first - it goes to the court and cannot be undone.');
  if (!input.grn && !input.withoutCourtFee) {
    throw new EcourtsHttpError(400, 'You have not selected GRN, if you have to add court fee for this case then select payment menu from epayment. Do you want to submit case without court fee..?');
  }
  return withPage(sessionId, userId, async (page) => {
    const list = await readDraftList(page, 'draft');
    const row = list.rows.find((x): x is PleadingRow => 'cells' in x && (x.calls ?? []).some((c) => c.fn === 'submit_pleading' && c.args[0] === input.uniqueId && c.args[2] === input.efilingNumber));
    if (!row) throw new EcourtsHttpError(409, `${input.efilingNumber} is no longer in your Draft Pleadings on the portal - Refresh.`);
    if (input.grn) {
      const sel = row.selects?.find((s) => s.id === input.uniqueId);
      if (!sel?.options.some((o) => o.value === input.grn)) throw new EcourtsHttpError(409, 'That GRN is not offered for this pleading on the portal.');
    }
    const r = await portalPost(page, 'Dashboard/submit_pleading/', `unique_id=${input.uniqueId}&type_of_case=${input.typeOfCase}&grn=${input.grn}&efiling_number=${input.efilingNumber}`);
    return { ok: okReply(r.json), portal: replySaid(r.json, r.text), list: await readDraftList(page, 'draft') };
  });
}

/** Re-submit after objections are complied with (resubmit_pleading -> Dashboard/resubmit_pleading/). */
export async function resubmitPleading(sessionId: string, userId: string, input: { efilingNumber: string; confirmed: boolean }) {
  if (!input.confirmed) throw new EcourtsHttpError(400, 'Confirm the re-submission first.');
  return withPage(sessionId, userId, async (page) => {
    const list = await readDraftList(page, 'completed');
    const has = list.rows.some((x) => 'cells' in x && (x.calls ?? []).some((c) => c.fn === 'resubmit_pleading' && c.args[0] === input.efilingNumber));
    if (!has) throw new EcourtsHttpError(409, `The portal offers no Re-submit for ${input.efilingNumber} now - Refresh.`);
    const r = await portalPost(page, 'Dashboard/resubmit_pleading/', `efiling_number=${input.efilingNumber}`);
    return { ok: okReply(r.json), portal: replySaid(r.json, r.text), list: await readDraftList(page, 'completed') };
  });
}

// ---- Pleadings > Video Recording (oath) -------------------------------------------------

const onOathScreen = async (page: Page): Promise<boolean> => page.evaluate(() => typeof (globalThis as any).fetchOathVideos === 'function' && !!document.getElementById('sel_pde_no')).catch(() => false);

async function ensureOathScreen(page: Page): Promise<void> {
  if (await onOathScreen(page)) return;
  await closePortalPopups(page);
  const menu = (await findLink(page, /video\s*recording/i)) ? /video\s*recording/i : /oath/i;
  if (!(await openPortalMenu(page, menu)) || !(await onOathScreen(page))) {
    throw new EcourtsHttpError(502, "Couldn't open Pleadings > Video Recording on your portal account.");
  }
}

const OATH_IDS = ['sel_pde_no', 'selDocument', 'selClientList', 'est_name', 'cause_tit', 'case_num', 'liti_name', 'lit_oath_name', 'oath_txt'];

export async function readOathScreen(sessionId: string, userId: string): Promise<OathScreen> {
  return withPage(sessionId, userId, async (page) => {
    await ensureOathScreen(page);
    const shape = await page.evaluate(() => {
      const txt = (e: any) => String(e?.textContent ?? '').replace(/\s+/g, ' ').trim();
      const sources = ([...document.querySelectorAll('input[name="search_case"]')] as any[]).map((r) => {
        const l = r.id ? document.querySelector(`label[for="${r.id}"]`) : null;
        return { value: String(r.value), label: txt(l) || txt(r.closest('label')) || txt(r.nextSibling) || String(r.value), checked: !!r.checked };
      });
      const title = txt(document.querySelector('.page-title, .card-header h4, .card-header h3, h1, h2, h3, h4'));
      // The recorder's own buttons (RecordRTC): start / pause / stop / upload.
      const rec = ([...document.querySelectorAll('#vr_screen button, .recordrtc button, button[id^="btn-"]')] as any[]).map((b) => txt(b)).filter(Boolean);
      return { sources, title, rec: [...new Set(rec)] };
    });
    const labels = await labelsFor(page, OATH_IDS);
    shape.rec.forEach((b, i) => { labels[`recorder${i}`] = b; });
    return { title: shape.title, sources: shape.sources, cases: await readOptions(page, '#sel_pde_no'), labels };
  });
}

async function chooseOathCase(page: Page, searchCase: string, pdeNo: string): Promise<PortalOption[]> {
  const radio = await page.evaluate((v) => {
    const r = document.querySelector(`input[name="search_case"][value="${v}"]`) as any;
    if (!r) return null;
    if (r.checked) return 'same';
    r.click();
    return 'clicked';
  }, searchCase).catch(() => null);
  if (radio === null && searchCase) throw new EcourtsHttpError(409, 'The portal has no such case choice on Video Recording.');
  if (radio === 'clicked') {
    // displayData() -> pleading_index/getSelectBox refills the e-filing numbers.
    await page.waitForResponse((r) => r.url().includes('p=pleading_index/getSelectBox'), { timeout: 6_000 }).catch(() => null);
  }
  const already = await page.evaluate((v) => String((document.getElementById('sel_pde_no') as any)?.value ?? '') === v && ((document.getElementById('selDocument') as any)?.options?.length ?? 0) > 1, pdeNo).catch(() => false);
  if (radio !== 'clicked' && already) return readOptions(page, '#selDocument');
  await waitOptions(page, '#sel_pde_no');
  const docs = page.waitForResponse((r) => r.url().includes('p=pleading_index/fetchDocument'), { timeout: 15_000 }).catch(() => null);
  if (!(await setControl(page, '#sel_pde_no', pdeNo))) throw new EcourtsHttpError(409, `${pdeNo} is not in this list on your portal account.`);
  await docs;
  await page.waitForTimeout(300);
  return readOptions(page, '#selDocument');
}

async function oathVideos(page: Page, searchCase: string, pdeNo: string): Promise<PleadingTable> {
  const r = await portalPost(page, 'videoRecording/fetchOathVideos', `sel_pde_no=${pdeNo}&search_case=${searchCase}`);
  // DataTables there: column 1 hidden, grouped by it.
  return parseTable(page, String(r.json?.['tbl'] ?? ''), { hide: [1], groupBy: 1 });
}

/** A case on Video Recording: its documents (#selDocument) and its oath videos. */
export async function selectOathCase(sessionId: string, userId: string, input: { searchCase: string; pdeNo: string }) {
  return withPage(sessionId, userId, async (page) => {
    await ensureOathScreen(page);
    const documents = await chooseOathCase(page, input.searchCase, input.pdeNo);
    return { documents, videos: await oathVideos(page, input.searchCase, input.pdeNo) };
  });
}

/** A document chosen for the oath (openPdf -> videoRecording/fetchDetails): case details, oath text, clients. */
export async function oathDocumentDetails(sessionId: string, userId: string, input: { searchCase: string; pdeNo: string; document: string }): Promise<OathDetails> {
  return withPage(sessionId, userId, async (page) => {
    await ensureOathScreen(page);
    await chooseOathCase(page, input.searchCase, input.pdeNo);
    await page.evaluate((v) => { const s = document.getElementById('selDocument') as any; if (s) s.value = v; }, input.document).catch(() => {});
    const r = await portalPost(page, 'videoRecording/fetchDetails', `sel_pde_no=${input.pdeNo}&search_case=${input.searchCase}&doc_id=${input.document.split('~')[0]}`);
    const j = r.json ?? {};
    if (j['errormsg']) throw new EcourtsHttpError(409, clean(j['errormsg']));
    // The client list goes into #selClientList on the page, as the portal does - the upload sends it.
    const clients = await page.evaluate((html) => {
      const s = document.getElementById('selClientList') as any;
      if (s) s.innerHTML = html;
      const doc = new (globalThis as any).DOMParser().parseFromString(`<select>${html}</select>`, 'text/html');
      return [...doc.querySelectorAll('option')].filter((o: any) => o.value).map((o: any) => ({ value: String(o.value), text: String(o.textContent ?? '').replace(/\s+/g, ' ').trim() }));
    }, String(j['client_list'] ?? '')).catch(() => []);
    return {
      establishment: clean(j['est_name']), causeTitle: clean(j['cause_title']), caseNumber: clean(j['case_number']),
      litigants: clean(j['litigant_names']), oathMessage: clean(j['oathMessage']), clients,
      labels: await labelsFor(page, OATH_IDS),
    };
  });
}

/**
 * Upload the recorded oath (uploadToPHPServer -> videoRecording/selfInvoker):
 * the same multipart the portal's recorder sends, through its own ajaxCallNew.
 */
export async function uploadOathVideo(sessionId: string, userId: string, input: { searchCase: string; pdeNo: string; document: string; client: string; video: { base64: string; mimeType: string }; confirmed: boolean }) {
  if (!input.confirmed) throw new EcourtsHttpError(400, 'Confirm the upload first - an oath video cannot be changed once uploaded.');
  if (!input.video.base64) throw new EcourtsHttpError(400, 'Record the oath first.');
  return withPage(sessionId, userId, async (page) => {
    await ensureOathScreen(page);
    await chooseOathCase(page, input.searchCase, input.pdeNo);
    const ext = /mp4|h264/i.test(input.video.mimeType) ? 'mp4' : /matroska|mkv/i.test(input.video.mimeType) ? 'mkv' : 'webm';
    const { value: r, said } = await hearing(page, false, async () => {
      const sent = page.waitForRequest((x) => x.url().includes('p=videoRecording/selfInvoker'), { timeout: 10_000 }).catch(() => null);
      const answered = page.waitForResponse((x) => x.url().includes('p=videoRecording/selfInvoker'), { timeout: 180_000 }).catch(() => null);
      const started = await page.evaluate(({ b64, mime, ext, search, pde, docv, client }) => {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const d = new Date();
        const fileName = `RecordRTC-${d.getUTCFullYear()}${d.getUTCMonth()}${d.getUTCDate()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const G = globalThis as any;
        const fd = new G.FormData();
        fd.append('video-filename', fileName);
        fd.append('video-blob', new G.File([bytes], fileName, { type: mime }));
        fd.append('search_case', search);
        fd.append('sel_pde_no', pde);
        fd.append('selDocument', docv);
        fd.append('selClient', client);
        if (typeof G.ajaxCallNew === 'function') { G.ajaxCallNew('videoRecording/selfInvoker', fd, () => {}); return true; }
        return false;
      }, { b64: input.video.base64, mime: input.video.mimeType, ext, search: input.searchCase, pde: input.pdeNo, docv: input.document, client: input.client });
      if (!started || !(await sent)) return null;
      const res = await answered;
      return res ? (await res.json().catch(() => null)) as Record<string, unknown> | null : null;
    });
    return { ok: okReply(r), portal: [...new Set([...said, ...replySaid(r)])], videos: await oathVideos(page, input.searchCase, input.pdeNo) };
  });
}

/** Play an oath video (setVideo -> videoRecording/readOathVideo). */
export async function playOathVideo(sessionId: string, userId: string, input: { filepath: string }): Promise<PortalFileBody> {
  return withPage(sessionId, userId, async (page) => {
    const r = await portalPost(page, 'videoRecording/readOathVideo', `filepath=${input.filepath}`);
    const url = String(r.json?.['contents'] ?? r.json?.['outputFile'] ?? '');
    if (!url) throw new EcourtsHttpError(502, 'The portal did not give this oath video.');
    return fetchInPage(page, url, `${input.filepath.split('/').pop() || 'oath'}`, 'video/webm');
  });
}

// ---- Pleadings > Use Template -----------------------------------------------------
//
// use_templates_script.js + common_pleading_temp.js: form #frmusetemplates;
// radio name=cases (#search 1 existing case, #eFiled 3 e-filed, #regis
// registered case by number); #sel_pde_no -> getPartyListFromPDE (clients in
// #case_pet_list / #case_res_list - ticking one side disables the other);
// the type of pleading #type_pleading <- use_templates/get_pleading_list1;
// submitData() -> use_templates/generate_template -> obj.name, offered as a
// .doc link (#rptname).

export interface TemplateScreen {
  title: string;
  sources: Array<{ value: string; label: string; checked: boolean }>;
  efiled: PortalOption[];
  labels: Record<string, string>;
}

export interface TemplateCaseView {
  case: CaseRef;
  pleadingTypes: PortalOption[];
  parties: Array<{ side: 'pet' | 'res'; value: string; label: string; checked: boolean }>;
  clientsLabel: string;
}

const onTemplateScreen = async (page: Page): Promise<boolean> => Boolean(await page.$('#frmusetemplates'));

async function ensureTemplateScreen(page: Page): Promise<void> {
  if (await onTemplateScreen(page)) return;
  await closePortalPopups(page);
  if (!(await openPortalMenu(page, /use\s*templates?/i)) || !(await onTemplateScreen(page))) {
    throw new EcourtsHttpError(502, "Couldn't open Pleadings > Use Template on your portal account.");
  }
}

async function readTemplateParties(page: Page): Promise<TemplateCaseView['parties']> {
  return page.evaluate(() => {
    const txt = (e: any) => String(e?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const out: any[] = [];
    for (const [box, side] of [['case_pet_list', 'pet'], ['case_res_list', 'res']] as const) {
      for (const c of [...document.querySelectorAll(`#${box} input[type=checkbox]`)] as any[]) {
        const l = c.id ? document.querySelector(`label[for="${c.id}"]`) : null;
        out.push({ side, value: String(c.value), label: txt(l) || txt(c.closest('label')) || txt(c.parentElement) || String(c.value), checked: !!c.checked });
      }
    }
    return out;
  }).catch(() => []);
}

export async function readTemplateScreen(sessionId: string, userId: string): Promise<TemplateScreen> {
  return withPage(sessionId, userId, async (page) => {
    await ensureTemplateScreen(page);
    const shape = await page.evaluate(() => {
      const txt = (e: any) => String(e?.textContent ?? '').replace(/\s+/g, ' ').trim();
      const sources = ([...document.querySelectorAll('input[name="cases"]')] as any[]).map((r) => {
        const l = r.id ? document.querySelector(`label[for="${r.id}"]`) : null;
        return { value: String(r.value), label: txt(l) || txt(r.closest('label')) || txt(r.nextSibling) || String(r.value), checked: !!r.checked };
      });
      const title = txt(document.querySelector('.page-title, .card-header h4, .card-header h3, h1, h2, h3, h4'));
      const submit = document.querySelector('[onclick*="submitData"]') as any;
      return { sources, title, submit: submit ? txt(submit) || String(submit.value ?? '') : '' };
    });
    const labels = await labelsFor(page, ['sel_pde_no', 'txt_case_search', 'type_pleading', 'rptname']);
    if (shape.submit) labels['submit'] = shape.submit;
    return { title: shape.title, sources: shape.sources, efiled: await readOptions(page, '#sel_pde_no'), labels };
  });
}

/** Choose the case on Use Template: its clients and the types of pleading the portal offers for it. */
async function chooseTemplateCase(page: Page, c: CaseRef): Promise<void> {
  const cur = await page.evaluate(() => {
    const r = document.querySelector('input[name="cases"]:checked') as any;
    const src = r ? String(r.value) : '';
    const sel = document.getElementById(src === '1' ? 'txt_case_search' : 'sel_pde_no') as any;
    return { src, value: String(sel?.value ?? '') };
  }).catch(() => ({ src: '', value: '' }));
  if (cur.src === c.source && cur.value === c.value && (await readOptions(page, '#type_pleading')).length) return;
  if (cur.src !== c.source) {
    const types = page.waitForResponse((r) => r.url().includes('p=use_templates/get_pleading_list1'), { timeout: 8_000 }).catch(() => null);
    const ok = await page.evaluate((v) => {
      const r = document.querySelector(`input[name="cases"][value="${v}"]`) as any;
      if (!r) return false;
      r.click();
      const $ = (globalThis as any).jQuery;
      if ($) $(r).trigger('change');
      return true;
    }, c.source).catch(() => false);
    if (!ok) throw new EcourtsHttpError(409, 'The portal has no such case choice on Use Template.');
    await types;
  }
  const sel = c.source === '1' ? '#txt_case_search' : '#sel_pde_no';
  if (c.source === '1' && !(await readOptions(page, sel)).some((o) => o.value === c.value)) await searchMyCases(page, c.value);
  const types = page.waitForResponse((r) => r.url().includes('p=use_templates/get_pleading_list1'), { timeout: 15_000 }).catch(() => null);
  if (!(await setControl(page, sel, c.value))) throw new EcourtsHttpError(409, `${c.value} is not in this list on your portal account.`);
  await types;
  await page.waitForSelector('#case_pet_list input[type=checkbox], #case_res_list input[type=checkbox]', { timeout: 6_000 }).catch(() => {});
  await page.waitForTimeout(300);
}

export async function selectTemplateCase(sessionId: string, userId: string, c: CaseRef): Promise<TemplateCaseView> {
  return withPage(sessionId, userId, async (page) => {
    await ensureTemplateScreen(page);
    await chooseTemplateCase(page, c);
    return { case: c, pleadingTypes: await readOptions(page, '#type_pleading'), parties: await readTemplateParties(page), clientsLabel: await readClientsLabel(page) };
  });
}

/** Generate (submitData -> use_templates/generate_template): the filled template, as the .doc the portal links. */
export async function generateTemplate(sessionId: string, userId: string, input: CaseRef & { typePleading: string; parties: string[] }): Promise<PortalSaid & { file: PortalFileBody | null }> {
  return withPage(sessionId, userId, async (page) => {
    await ensureTemplateScreen(page);
    await chooseTemplateCase(page, input);
    if (!(await setControl(page, '#type_pleading', input.typePleading))) throw new EcourtsHttpError(409, 'That type of pleading is not offered for this case on the portal.');
    // The clients the advocate ticked (the portal lets one side be ticked at a time).
    await page.evaluate((want) => {
      for (const c of [...document.querySelectorAll('#case_pet_list input[type=checkbox], #case_res_list input[type=checkbox]')] as any[]) {
        if (!!c.checked !== want.includes(String(c.value))) { c.disabled = false; c.click(); }
      }
    }, input.parties).catch(() => {});
    const { value: r, said } = await hearing(page, false, () => callPortalFn(page, 'submitData', [], 'use_templates/generate_template', 60_000));
    if (!r.called) throw new EcourtsHttpError(502, 'The Use Template screen on the portal has no Generate here.');
    // The form's own checks (jquery.validate) show under the fields.
    const notes = await page.evaluate(() => ([...document.querySelectorAll('#frmusetemplates label.error, #frmusetemplates .error')] as any[])
      .filter((e) => e.getClientRects().length).map((e) => String(e.textContent ?? '').trim()).filter(Boolean)).catch(() => []);
    const portal = [...new Set([...said, ...notes, ...replySaid(r.json)])];
    const name = r.json && Number(r.json['status']) === 1 && typeof r.json['name'] === 'string' ? r.json['name'] : '';
    if (!name) return { ok: false, portal, file: null };
    // The portal links the same name with a .doc extension (use_templates_script.js).
    const doc = `${name.replace(/\.[^./]*$/, '')}.doc`;
    const file = await fetchInPage(page, doc, doc.split('/').pop() || 'template.doc', 'application/msword');
    return { ok: true, portal, file };
  });
}

export const __testing = { parseTable };
