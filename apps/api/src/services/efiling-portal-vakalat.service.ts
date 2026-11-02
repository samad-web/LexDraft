import type { Page } from 'playwright';
import { EcourtsHttpError } from '../lib/ecourts';
import { onLoginForm, withPortalPage } from './efiling-live.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- DOM global, no dom lib in this tsconfig
declare const document: any;

// =============================================================================
// efiling-portal-vakalat.service
//
// The portal's VAKALAT menu (Assign Partners to Case, Accept Offer, Print
// Vakalat) and MY PARTNERS, live over the advocate's own logged-in portal
// session - plus the "live screen" engine the portfolio screens share.
//
// What the portal's public JS says (js/vakalat.js, docs/efiling-portal-
// reverse-engineering.md §7):
//   * ONE page script serves both Vakalat screens. Hidden #acceptOffer='Y'
//     marks Accept Offer: fetchLitigantData('N') draws the offers into the
//     DataTable #example (server-side, vakalat/fetchLitigantData with
//     type_of_case + search_1..n + column_cnt), a .chk_adv_approve box per
//     offer. Ticking one enables Send OTP (#sotp_go -> sendOTP('A') ->
//     vakalat/sendOTP flg=A), which enables #otp; 6+ characters enable
//     Submit (#sv_go -> submitData('A') -> vakalat/submitData with the form
//     + flg + cause_title + lcause_title).
//   * Otherwise it is Assign Partners to Case: radio "cases" (e-filed #eFiled
//     / registered #regis); #sel_pde_no change -> fetchData('3') ->
//     vakalat/fetchData sel_pde_no&str=3; #txt_case_search change / #go ->
//     fetchData('1') with cnr=#hid_cino. The reply fills #advocate
//     (partners, adv_option) and #litigant (party_option) and the cause
//     title; setParty() writes "I and <partners> ..." and, per ticked party
//     (chk_pet_list[] / chk_res_list[]), a mobile box + Search (getUser ->
//     vakalat/getUser mobile_no -> usrOptions into #sel_party_mobile<b>).
//     #lit_agree must be ticked; Submit -> submitData('L'). A litigant
//     (sessionUserType 2) also needs the OTP (sendOTP('L') / verifyOTP ->
//     vakalat/sendOTP, vakalat/verifyOTP).
//   * Print Vakalat and My Partners have NO public script (every guessed
//     .js name is a 404) - their pages are server-rendered.
//
// So DifAi does not re-implement any of it: it opens the advocate's own
// portal page from the portal's own menu, and for every step sets the
// fields and presses the buttons THERE, letting the portal's own script
// make its own requests (with its own field names and token chain). What
// the page then shows - headings, text, fields with their labels and
// choices, buttons, tables - is read back in the order the portal draws it,
// so DifAi's screen is the portal's screen. OTPs are typed by the advocate;
// captchas are never automated; anything that assigns, accepts, removes,
// deletes or imports needs `confirmed: true`.
// =============================================================================

const BASE = 'https://filing.ecourts.gov.in';

// ---- what a live screen is made of ------------------------------------------------

export interface LiveOption { value: string; text: string; selected: boolean; disabled?: boolean }

/** One field on the portal page, as the advocate sees it. `key` is a CSS selector for it. */
export interface LiveControl {
  key: string;
  id: string;
  name: string;
  tag: 'input' | 'select' | 'textarea';
  /** text, radio, checkbox, select-one, select-multiple, textarea, date, file ... */
  type: string;
  label: string;
  value: string;
  checked?: boolean;
  options?: LiveOption[];
  required: boolean;
  disabled: boolean;
  readOnly: boolean;
  placeholder: string;
  maxLength?: number;
}

/** A button or link on the portal page: its text and which one of that text it is. */
export interface LiveClick {
  text: string; nth: number; kind: 'button' | 'link'; disabled: boolean; id: string;
  /** The open tab / current page (the portal marks it active / current). */
  active?: boolean;
}

export interface LiveCell { text: string; controls: LiveControl[]; clicks: LiveClick[] }
export type LiveRow = { group: string } | { cells: LiveCell[] };
export interface LiveTable {
  id: string;
  headers: string[];
  /** The portal's per-column search boxes under the titles (DataTables filters), when it has them. */
  filters?: LiveCell[];
  rows: LiveRow[];
}

export type LiveItem =
  | { kind: 'heading'; text: string }
  | { kind: 'text'; lines: string[]; clicks: LiveClick[] }
  | { kind: 'control'; control: LiveControl }
  | { kind: 'click'; click: LiveClick }
  | { kind: 'table'; table: LiveTable };

export interface LiveScreen {
  view: string;
  /** The menu item the advocate opened (as the portal names it). */
  label: string;
  title: string;
  url: string;
  items: LiveItem[];
}

/**
 * What the portal told the advocate. 'confirm' is a question the portal asked
 * (its own confirm(), e.g. "Do you want to revoke ...?"): answered OK only on
 * a step sent with `confirmed: true`, otherwise Cancel - send the step again
 * with `confirmed: true` to answer OK.
 */
export interface LiveMessage { kind: 'error' | 'success' | 'alert' | 'confirm'; text: string }

export interface LiveFile { name: string; contentType: string; base64: string }

export interface LiveStepResult {
  screen: LiveScreen;
  /** What the portal told the advocate (its alert boxes and pop-up messages). */
  messages: LiveMessage[];
  /** A document the portal opened (Print ...), when it did. */
  file?: LiveFile;
}

export interface FillEntry { key: string; value?: string | string[]; checked?: boolean }

export interface LiveStep {
  fill?: FillEntry[];
  press?: { text: string; nth?: number };
  confirmed?: boolean;
}

export interface ScreenDef {
  /** The portal menu (dropdown) the item sits in. */
  menu: RegExp;
  /** The menu item's text. */
  item: RegExp;
  label: string;
  /** Runs after the page is opened (e.g. show all entries). */
  after?: (page: Page) => Promise<void>;
}

export interface PortalMenu { menu: string; items: Array<{ text: string; href: string; onclick: string }> }

/** Buttons and links that change the advocate's portal account. */
export const CHANGES_ACCOUNT = /\b(add|save|submit|assign|accept|approve|remove|delete|import|update|reject|withdraw|revoke|e-?sign|final)/i;

// ---- in-page helpers -----------------------------------------------------------------------

/**
 * Installed into the portal page on every step: counts the page's pending
 * requests (so DifAi waits for the portal's own ajax), and the readers that
 * turn the page into LiveItems. Runs in the page.
 */
function installHelpers(): void {
  const W = globalThis as any;
  if (W.__difai && W.__difai.v === 6) return;
  if (!W.__difaiXhrPatched && W.XMLHttpRequest) {
    W.__difaiXhrPatched = true;
    W.__difaiPending = 0;
    const send = W.XMLHttpRequest.prototype.send;
    W.XMLHttpRequest.prototype.send = function (this: any, ...args: unknown[]) {
      W.__difaiPending += 1;
      let done = false;
      const end = () => { if (!done) { done = true; W.__difaiPending = Math.max(0, W.__difaiPending - 1); } };
      this.addEventListener('loadend', end);
      try {
        return send.apply(this, args);
      } catch (e) {
        end();
        throw e;
      } finally {
        // A synchronous request (the portal's ajaxCall uses async:false) is over already.
        if (this.readyState === 4) end();
      }
    };
  }
  // Short timers the portal sets after its requests (setTimeout(setParty, 500) ...).
  if (!W.__difaiTimersPatched) {
    W.__difaiTimersPatched = true;
    W.__difaiTimers = new Set();
    const st = W.setTimeout;
    const ct = W.clearTimeout;
    W.setTimeout = function (fn: unknown, ms?: number, ...rest: unknown[]) {
      if (typeof fn !== 'function' || Number(ms ?? 0) > 1500) return st(fn, ms, ...rest);
      const id = st(function (this: unknown, ...a: unknown[]) {
        W.__difaiTimers.delete(id);
        return (fn as (...x: unknown[]) => unknown).apply(this, a);
      }, ms, ...rest);
      W.__difaiTimers.add(id);
      return id;
    };
    W.clearTimeout = function (id: unknown) {
      W.__difaiTimers.delete(id);
      return ct(id);
    };
  }
  const norm = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const chosenOf = (el: any) => {
    const n = el.nextElementSibling;
    return el.tagName === 'SELECT' && n && /\bchosen-container\b/.test(String(n.className)) ? n : null;
  };
  const styleHidden = (el: any) => {
    const cs = W.getComputedStyle(el);
    return cs.display === 'none' || cs.visibility === 'hidden';
  };
  const shown = (el: any): boolean => {
    if (el.getClientRects().length > 0 && W.getComputedStyle(el).visibility !== 'hidden') return true;
    const c = chosenOf(el);
    return !!c && c.getClientRects().length > 0;
  };
  // jQuery UI autocomplete suggestions (Add Partners' advocate name) are picked by clicking them.
  const CLICK = 'button, input[type=button], input[type=submit], input[type=reset], a, .ui-autocomplete .ui-menu-item';
  const OUTSIDE = 'nav, .navbar, header, footer, .dropdown-menu, .chosen-container, .main-header, .main-footer';
  const textOf = (el: any) => norm(el.innerText ?? el.textContent) || norm(el.value) || norm(el.getAttribute('aria-label')) || norm(el.title) || (el.id ? String(el.id) : '');
  /** Every visible button / link outside the menus, in page order: the same list for reading and pressing. */
  const clickables = () => ([...document.body.querySelectorAll(CLICK)] as any[])
    .filter((e) => !e.closest(OUTSIDE) && shown(e) && textOf(e));
  const clickInfo = () => {
    const m = new Map<any, { text: string; nth: number; kind: 'button' | 'link'; disabled: boolean; id: string; active?: boolean }>();
    const counts = new Map<string, number>();
    for (const e of clickables()) {
      const text = textOf(e);
      const nth = counts.get(text) ?? 0;
      counts.set(text, nth + 1);
      m.set(e, {
        text, nth, kind: e.tagName === 'A' && !e.classList.contains('btn') ? 'link' : 'button',
        disabled: !!e.disabled || e.classList.contains('disabled') || e.getAttribute('aria-disabled') === 'true', id: e.id || '',
        ...(/\b(active|current)\b/.test(String(e.className)) || /\bactive\b/.test(String(e.parentElement?.className ?? '')) || e.getAttribute('aria-selected') === 'true' ? { active: true } : {}),
      });
    }
    return m;
  };
  const esc = (s: string) => (W.CSS && W.CSS.escape ? W.CSS.escape(s) : s.replace(/["\\]/g, '\\$&'));
  const keyOf = (el: any): string => {
    if (el.id) return `#${esc(el.id)}`;
    const name = el.getAttribute('name');
    const tick = el.type === 'radio' || el.type === 'checkbox';
    if (name) return tick ? `[name="${esc(name)}"][value="${esc(String(el.value))}"]` : `[name="${esc(name)}"]`;
    const cls = String(el.className || '').split(/\s+/).filter(Boolean)[0];
    if (cls && tick) return `.${esc(cls)}[value="${esc(String(el.value))}"]`;
    return '';
  };
  const consumed = new Set<any>();
  const labelOf = (el: any): string => {
    if (el.id) {
      const l = document.querySelector(`label[for="${esc(el.id)}"]`);
      if (l && norm(l.textContent)) return norm(l.textContent);
    }
    const wrap = el.closest('label');
    if (wrap) {
      const k = wrap.cloneNode(true);
      for (const x of [...k.querySelectorAll('select, option')]) x.remove();
      if (norm(k.textContent)) return norm(k.textContent);
    }
    if (el.type === 'radio' || el.type === 'checkbox') {
      const n = el.nextSibling;
      if (n && (n.nodeType === 3 || (n.nodeType === 1 && /^(SPAN|LABEL|B|STRONG)$/.test(n.tagName) && !n.querySelector('input,select,textarea'))) && norm(n.textContent)) {
        consumed.add(n);
        return norm(n.textContent);
      }
    }
    let p = el.parentElement;
    for (let i = 0; i < 3 && p; i++, p = p.parentElement) {
      const prev = p.previousElementSibling;
      if (prev && !prev.querySelector('input,select,textarea,table') && norm(prev.textContent) && norm(prev.textContent).length < 100) return norm(prev.textContent);
    }
    return norm(el.getAttribute('placeholder')) || norm(el.getAttribute('aria-label')) || norm(el.title);
  };
  const controlOf = (el: any, label?: string) => {
    const tag = String(el.tagName).toLowerCase();
    const type = tag === 'select' ? (el.multiple ? 'select-multiple' : 'select-one') : tag === 'textarea' ? 'textarea' : String(el.getAttribute('type') || 'text').toLowerCase();
    let lab = label ?? labelOf(el);
    const star = /^\*/.test(lab) || /\*$/.test(lab);
    lab = lab.replace(/^\*\s*/, '').replace(/\s*\*$/, '');
    return {
      key: keyOf(el), id: el.id || '', name: el.getAttribute('name') || '', tag, type, label: lab,
      value: type === 'password' || type === 'file' ? '' : String(el.value ?? ''),
      ...(type === 'radio' || type === 'checkbox' ? { checked: !!el.checked } : {}),
      ...(tag === 'select' ? { options: ([...el.options] as any[]).slice(0, 600).map((o) => ({ value: String(o.value), text: norm(o.text), selected: !!o.selected, ...(o.disabled ? { disabled: true } : {}) })) } : {}),
      required: !!el.required || star || el.classList.contains('compulsary') || el.getAttribute('aria-required') === 'true',
      disabled: !!el.disabled, readOnly: !!el.readOnly, placeholder: norm(el.getAttribute('placeholder')),
      ...(el.maxLength > 0 ? { maxLength: el.maxLength } : {}),
    };
  };
  const CONTROL = 'input:not([type=hidden]):not([type=button]):not([type=submit]):not([type=reset]), select, textarea';
  /** The page's content: the smallest box holding every visible field, table and heading outside the menus. */
  const pickRoot = () => {
    const parts = ([...document.body.querySelectorAll(`${CONTROL}, table, h1, h2, h3, h4, h5, legend, button, input[type=button]`)] as any[])
      .filter((e) => !e.closest(OUTSIDE) && !e.closest('.modal') && shown(e));
    if (!parts.length) return document.body;
    let root = parts[0].parentElement;
    while (root && root !== document.body && !parts.every((p) => root.contains(p))) root = root.parentElement;
    return root || document.body;
  };
  // A table holding other tables (a page laid out in a table, a calendar's
  // header + body grids) is layout: its own headings and tables are read.
  const isDataTable = (t: any) => !t.querySelector('table') && (!!t.querySelector('thead th') || !t.querySelector('select, textarea, input[type=text], input:not([type])'));
  /** A short line in large type (the portal's page titles that are not h1-h6). */
  const bigTitle = (n: any): string => {
    // (Cells of data tables are read by readTable, never here.)
    if (n.closest('a, button, label')) return '';
    const t = norm(n.innerText ?? n.textContent);
    if (!t || t.length > 80 || /\n/.test(String(n.innerText ?? '').trim())) return '';
    return parseFloat(W.getComputedStyle(n).fontSize) >= 19 ? t : '';
  };
  const BLOCK = 'div,p,ul,ol,li,section,article,form,fieldset,center,header,footer,dl,dt,dd,hr,tr,table,tbody,thead';
  const walk = (root: any) => {
    const items: any[] = [];
    const info = clickInfo();
    const labelled = new Set<any>();
    for (const l of [...document.querySelectorAll('label[for]')] as any[]) {
      const t = document.getElementById(l.getAttribute('for'));
      if (t && t.matches('input, select, textarea') && t.type !== 'hidden') labelled.add(l);
    }
    let buf: any = null;
    let clicks: any[] = [];
    const flush = () => {
      if (!buf) return;
      const lines = String(buf.innerText ?? '').split('\n').map(norm).filter(Boolean);
      if (lines.length) items.push({ kind: 'text', lines, clicks });
      buf.remove();
      buf = null;
      clicks = [];
    };
    const inline = (n: any) => {
      if (!buf) {
        buf = document.createElement('div');
        buf.style.cssText = 'position:absolute;left:-99999px;top:0';
        document.body.appendChild(buf);
      }
      const k = n.cloneNode(true);
      if (k.nodeType === 1) for (const x of [...k.querySelectorAll('script, style')]) x.remove();
      buf.appendChild(k);
      if (n.nodeType === 1) for (const a of [n, ...n.querySelectorAll('a')]) if (info.has(a)) clicks.push(info.get(a));
    };
    const cellOf = (c: any, header: string) => {
      const k = c.cloneNode(true);
      for (const x of [...k.querySelectorAll('script, style, select, textarea, .modal, .popup, [style*="display:none"], [style*="display: none"]')]) x.remove();
      for (const br of [...k.querySelectorAll('br')]) br.replaceWith('\n');
      for (const b of [...k.querySelectorAll('div, p, li, tr')]) b.append('\n');
      const text = String(k.textContent ?? '').split('\n').map(norm).filter(Boolean).join('\n');
      const controls = ([...c.querySelectorAll(CONTROL)] as any[]).filter((e) => shown(e) && keyOf(e))
        .map((e) => controlOf(e, e.type === 'checkbox' || e.type === 'radio' ? header : undefined));
      const cl = ([...c.querySelectorAll(CLICK)] as any[]).filter((e) => info.has(e)).map((e) => info.get(e));
      return { text, controls, clicks: cl };
    };
    const plainCells = (r: any) => ([...r.cells] as any[]).filter((c) => !c.querySelector(CONTROL) && norm(c.textContent)).length;
    const readTable = (t: any) => {
      // The titles row (most plain-text cells); a row of search boxes under
      // it (the portal's per-column filters + Search) is kept as `filters`.
      let headRows = t.tHead ? ([...t.tHead.rows] as any[]).filter(shown) : [];
      if (!headRows.some((r: any) => plainCells(r))) {
        const scrollHead = t.closest('.dataTables_wrapper')?.querySelector('.dataTables_scrollHead thead');
        const firstTh = ([...t.rows] as any[]).find((r) => r.cells.length > 1 && [...r.cells].every((c: any) => c.tagName === 'TH'));
        headRows = scrollHead ? ([...scrollHead.rows] as any[]) : firstTh ? [firstTh] : headRows;
      }
      const plain = plainCells;
      const headRow = [...headRows].sort((a, b) => plain(b) - plain(a))[0] ?? null;
      const headers = headRow ? ([...headRow.cells] as any[]).map((c) => {
        const i = c.querySelector('input');
        return norm(c.textContent) || norm(i && (i.getAttribute('placeholder') || i.value));
      }) : [];
      const filterRow = headRows.find((r) => r !== headRow && r.querySelector(`${CONTROL}, ${CLICK}`));
      const filters = filterRow ? ([...filterRow.cells] as any[]).map((c, i) => cellOf(c, headers[i] ?? '')) : undefined;
      const own = (t.tBodies && t.tBodies.length ? ([...t.tBodies] as any[]).flatMap((b) => [...b.rows]) : [...t.rows]) as any[];
      const rows = own.filter((r) => r.parentElement.tagName !== 'THEAD' && !headRows.includes(r) && shown(r)).map((tr) => {
        const cells = [...tr.cells] as any[];
        if (cells.length === 1 && Number(cells[0].getAttribute('colspan') || 1) > 1 && !cells[0].querySelector(`${CONTROL}, ${CLICK}`)) return { group: norm(cells[0].textContent) };
        return { cells: cells.map((c, i) => cellOf(c, headers[i] ?? '')) };
      }).filter((r: any) => ('group' in r ? r.group : r.cells.some((c: any) => c.text || c.controls.length || c.clicks.length)));
      return { id: t.id || '', headers, ...(filters ? { filters } : {}), rows };
    };
    const visit = (el: any) => {
      for (const n of [...el.childNodes] as any[]) {
        if (consumed.has(n)) continue;
        if (n.nodeType === 3) { if (norm(n.textContent)) inline(n); continue; }
        if (n.nodeType !== 1) continue;
        if (n.matches('script, style, noscript, template, .chosen-container, .dataTables_processing') || n.matches(OUTSIDE) || labelled.has(n)) continue;
        const isSel = n.tagName === 'SELECT' && chosenOf(n);
        if (!isSel && styleHidden(n)) continue;
        if (n.matches(CONTROL)) {
          if (!shown(n) || !keyOf(n)) continue;
          flush();
          items.push({ kind: 'control', control: controlOf(n) });
          continue;
        }
        if (info.has(n) && (n.tagName !== 'A' || n.classList.contains('btn'))) {
          flush();
          items.push({ kind: 'click', click: info.get(n) });
          continue;
        }
        if (n.tagName === 'INPUT' || n.tagName === 'BUTTON') continue;
        if (n.tagName === 'TABLE') {
          if (!shown(n)) continue;
          if (isDataTable(n)) { flush(); items.push({ kind: 'table', table: readTable(n) }); continue; }
          flush(); visit(n); flush();
          continue;
        }
        if (/^H[1-6]$/.test(n.tagName) || n.tagName === 'LEGEND') {
          flush();
          const t = norm(n.textContent);
          if (t) items.push({ kind: 'heading', text: t });
          continue;
        }
        if (n.tagName === 'LABEL' && n.querySelector(CONTROL)) {
          flush();
          for (const c of [...n.querySelectorAll(CONTROL)] as any[]) if (shown(c) && keyOf(c)) items.push({ kind: 'control', control: controlOf(c) });
          continue;
        }
        if (n.tagName === 'BR') { inline(n); continue; }
        const inner = n.querySelector(`${CONTROL}, button, input[type=button], input[type=submit], a.btn, table, h1, h2, h3, h4, h5, h6, legend`);
        const block = n.matches(BLOCK);
        if (!inner) {
          const big = info.has(n) ? '' : bigTitle(n);
          if (big) { flush(); items.push({ kind: 'heading', text: big }); continue; }
          if (block) flush();
          inline(n);
          if (block) flush();
          continue;
        }
        if (block) flush();
        visit(n);
        if (block) flush();
      }
    };
    visit(root);
    flush();
    // A text line that only repeats the next field's label is that label.
    const out: any[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const next = items[i + 1];
      if (it.kind === 'text' && next && next.kind === 'control') {
        const last = String(it.lines[it.lines.length - 1]).replace(/^\*\s*/, '').replace(/\s*\*$/, '').replace(/\s*:$/, '');
        if (last && last === String(next.control.label).replace(/\s*:$/, '')) {
          if (/^\*|\*$/.test(String(it.lines[it.lines.length - 1]))) next.control.required = true;
          it.lines = it.lines.slice(0, -1);
          if (!it.lines.length) continue;
        }
      }
      out.push(it);
    }
    return out;
  };
  const screen = () => {
    consumed.clear();
    const root = pickRoot();
    let items = walk(root);
    // Nothing in the box the visible parts share (the page still settling): the whole page.
    if (!items.length && root !== document.body) items = walk(document.body);
    // Pop-ups the portal opened (results, messages) after the page itself.
    for (const m of [...document.querySelectorAll('.modal')] as any[]) {
      if (root.contains(m) || m.contains(root) || !shown(m)) continue;
      const title = norm(m.querySelector('.modal-title, .modal-header')?.textContent);
      const inner = walk(m.querySelector('.modal-body') ?? m);
      if (inner.length) items.push(...(title ? [{ kind: 'heading', text: title }] : []), ...inner);
    }
    // Suggestions the portal lists under a field being typed in.
    const info = clickInfo();
    for (const ul of [...document.querySelectorAll('.ui-autocomplete')] as any[]) {
      if (!shown(ul)) continue;
      for (const li of [...ul.querySelectorAll('.ui-menu-item')] as any[]) if (info.has(li)) items.push({ kind: 'click', click: { ...info.get(li), kind: 'link' } });
    }
    const h = items.find((i: any) => i.kind === 'heading');
    return { title: h ? h.text : norm(document.title), url: String(document.location.href), items };
  };
  W.__difai = { v: 6, norm, shown, clickables, textOf, screen };
}

async function helpers(page: Page): Promise<void> {
  await page.evaluate(installHelpers);
}

/** Wait for the portal's own requests (and the timers right after them) to finish. */
export async function portalIdle(page: Page, extraMs = 250): Promise<void> {
  await page.waitForTimeout(extraMs);
  const requests = () => page.waitForFunction(() => Number((globalThis as any).__difaiPending ?? 0) === 0, undefined, { timeout: 25_000, polling: 100 }).catch(() => {});
  await requests();
  // Then the short timers the portal set (they may start requests of their own).
  const timers = await page.waitForFunction(() => Number((globalThis as any).__difaiTimers?.size ?? 0) === 0, undefined, { timeout: 4_000, polling: 100 }).then(() => true).catch(() => false);
  if (timers) await requests();
  await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});
}

export async function assertPortalLoggedIn(page: Page): Promise<void> {
  if (await onLoginForm(page)) {
    throw new EcourtsHttpError(410, 'The eFiling portal has signed this session out (the same account was probably opened in another browser). Log in again.');
  }
}

/** Go to the advocate's portal dashboard (where the menu bar is). */
export async function goPortalDashboard(page: Page): Promise<void> {
  await page.goto(`${BASE}/pdedev/?p=dashboard`, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  await assertPortalLoggedIn(page);
}

/** The portal's menu bar: each dropdown and its items, as it draws them. */
async function menusOnPage(page: Page): Promise<PortalMenu[]> {
  return page.evaluate(() => {
    const txt = (e: any) => String(e?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const out: Array<{ menu: string; items: Array<{ text: string; href: string; onclick: string }> }> = [];
    for (const dd of [...document.querySelectorAll('.dropdown, .nav-item.dropdown, li.dropdown')] as any[]) {
      const toggle = dd.querySelector('.dropdown-toggle, [data-toggle=dropdown], [data-bs-toggle=dropdown]') ?? dd.querySelector('a');
      const items = ([...dd.querySelectorAll('.dropdown-menu a, .dropdown-menu button')] as any[])
        .map((a) => ({ text: txt(a), href: String(a.getAttribute('href') ?? ''), onclick: String(a.getAttribute('onclick') ?? '').slice(0, 160) }))
        .filter((a) => a.text);
      if (toggle && items.length) out.push({ menu: txt(toggle), items });
    }
    return out;
  });
}

/** Read the portal's menus (the dashboard's menu bar). */
export async function readPortalMenus(sessionId: string, userId: string): Promise<PortalMenu[]> {
  return withPortalPage(sessionId, userId, async (page) => {
    let menus = await menusOnPage(page);
    if (!menus.length) {
      await goPortalDashboard(page);
      menus = await menusOnPage(page);
    }
    return menus;
  });
}

/**
 * Open a page from the portal's own menu, as the advocate would: the item in
 * that dropdown (or a link of that text anywhere on the page). Navigation
 * only. Returns the item's text as the portal names it.
 */
export async function openMenuItem(page: Page, def: ScreenDef): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt === 1) await goPortalDashboard(page);
    const hit = await page.evaluate(({ menu, item }) => {
      const txt = (e: any) => String(e?.textContent ?? '').replace(/\s+/g, ' ').trim();
      const mRe = new RegExp(menu.source, menu.flags);
      const iRe = new RegExp(item.source, item.flags);
      for (const e of [...document.querySelectorAll('[data-difai-go]')]) e.removeAttribute('data-difai-go');
      let found: any = null;
      for (const dd of [...document.querySelectorAll('.dropdown, .nav-item.dropdown, li.dropdown')] as any[]) {
        const toggle = dd.querySelector('.dropdown-toggle, [data-toggle=dropdown], [data-bs-toggle=dropdown]') ?? dd.querySelector('a');
        if (!mRe.test(txt(toggle))) continue;
        found = ([...dd.querySelectorAll('.dropdown-menu a, .dropdown-menu button')] as any[]).find((a) => iRe.test(txt(a)));
        if (found) break;
      }
      // A menu entry that is a plain link (My Partners may be one).
      if (!found) found = ([...document.querySelectorAll('a, button')] as any[]).find((a) => iRe.test(txt(a)) && !/logout|log out/i.test(`${a.getAttribute('href') ?? ''} ${txt(a)}`));
      if (!found) return null;
      found.setAttribute('data-difai-go', '1');
      return { text: txt(found), href: found.tagName === 'A' ? String(found.href ?? '') : '', raw: String(found.getAttribute('href') ?? '') };
    }, { menu: { source: def.menu.source, flags: def.menu.flags }, item: { source: def.item.source, flags: def.item.flags } });
    if (!hit) continue;
    const here = new URL(page.url());
    if (hit.href && !/^(#|javascript:)/i.test(hit.raw) && hit.raw !== '' && new URL(hit.href).hostname === here.hostname) {
      await page.goto(hit.href, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    } else {
      // Opened by the portal's own script: click it.
      await page.evaluate(() => (document.querySelector('[data-difai-go]') as any)?.click()).catch(() => {});
      await page.waitForTimeout(400);
    }
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    await assertPortalLoggedIn(page);
    return hit.text;
  }
  throw new EcourtsHttpError(502, `Couldn't find "${def.label}" in your eFiling portal menu.`);
}

/** Collect what the portal tells the advocate: its errorAlert / successAlert boxes and browser alerts. */
async function listen(page: Page, confirmed: boolean): Promise<() => Promise<LiveMessage[]>> {
  const dialogs: LiveMessage[] = [];
  const onDialog = (d: { message: () => string; type: () => string; accept: () => Promise<void>; dismiss: () => Promise<void> }) => {
    const text = d.message().replace(/\s+/g, ' ').trim();
    // A plain alert is acknowledged. The portal's own confirm() ("Do you
    // want to ...?") is answered OK only when the advocate confirmed this
    // step in DifAi; otherwise Cancel, and DifAi shows the question.
    if (d.type() === 'confirm' || d.type() === 'beforeunload') {
      dialogs.push({ kind: 'confirm', text });
      void (confirmed ? d.accept() : d.dismiss()).catch(() => {});
      return;
    }
    dialogs.push({ kind: 'alert', text });
    void d.accept().catch(() => {});
  };
  page.on('dialog', onDialog);
  const wrap = async () => page.evaluate(() => {
    const w = globalThis as any;
    w.__difaiMsgs = w.__difaiMsgs ?? [];
    for (const [fn, kind] of [['errorAlert', 'error'], ['successAlert', 'success']] as const) {
      const orig = w[fn];
      if (typeof orig === 'function' && !orig.__difai) {
        const wrapped = function (this: unknown, msg: unknown) {
          w.__difaiMsgs.push({ kind, text: String(msg ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() });
          return orig.apply(this, arguments as any);
        };
        (wrapped as any).__difai = true;
        w[fn] = wrapped;
      }
    }
  }).catch(() => {});
  await wrap();
  return async () => {
    page.off('dialog', onDialog);
    const inPage = (await page.evaluate(() => {
      const w = globalThis as any;
      const m = w.__difaiMsgs ?? [];
      w.__difaiMsgs = [];
      return m;
    }).catch(() => [])) as LiveMessage[];
    const seen = new Set<string>();
    return [...inPage, ...dialogs].filter((m) => m.text && !seen.has(m.text) && seen.add(m.text));
  };
}

export async function readLiveScreen(page: Page, view: string, label: string): Promise<LiveScreen> {
  await helpers(page);
  const s = (await page.evaluate(() => (globalThis as any).__difai.screen())) as Omit<LiveScreen, 'view' | 'label'>;
  return { view, label, ...s };
}

async function markView(page: Page, view: string, label: string): Promise<void> {
  await page.evaluate(({ view, label }) => {
    document.documentElement.setAttribute('data-difai-view', view);
    document.documentElement.setAttribute('data-difai-label', label);
  }, { view, label }).catch(() => {});
}

async function onView(page: Page, view: string): Promise<string | null> {
  return page.evaluate((v) => (document.documentElement.getAttribute('data-difai-view') === v ? String(document.documentElement.getAttribute('data-difai-label') ?? '') : null), view).catch(() => null);
}

/** Open a screen from the portal's menu and read it. */
export async function openLiveScreen(page: Page, view: string, def: ScreenDef): Promise<LiveScreen> {
  const label = await openMenuItem(page, def);
  await helpers(page);
  await portalIdle(page, 300);
  if (def.after) {
    await def.after(page);
    await portalIdle(page);
  }
  await markView(page, view, label);
  // The portal may still be drawing (a calendar saying "Loading...", a page
  // whose body arrives after its title): wait for it, then read; read again
  // if nothing was there yet.
  await page.waitForFunction(() => ![...document.querySelectorAll('body *')].some((e: any) => e.children.length === 0 && /^loading\.*$/i.test(String(e.textContent ?? '').trim()) && e.getClientRects().length), undefined, { timeout: 10_000, polling: 300 }).catch(() => {});
  let screen = await readLiveScreen(page, view, label);
  for (let i = 0; i < 3 && !screen.items.length; i++) {
    await page.waitForTimeout(1200);
    await portalIdle(page);
    screen = await readLiveScreen(page, view, label);
  }
  return screen;
}

/** Set one field on the portal page the way a person does, so the portal's own handlers run. */
async function fillOne(page: Page, f: FillEntry): Promise<'ok' | 'missing' | 'disabled'> {
  return page.evaluate((f) => {
    const W = globalThis as any;
    let el: any = null;
    try { el = document.querySelector(f.key); } catch { return 'missing'; }
    if (!el) return 'missing';
    if (el.disabled) return 'disabled';
    const fire = (type: string) => el.dispatchEvent(new W.Event(type, { bubbles: true }));
    if (el.type === 'radio') {
      if (f.checked === false) return 'ok';
      el.click();
      if (!el.checked) { el.checked = true; fire('change'); }
    } else if (el.type === 'checkbox') {
      if (el.checked !== !!f.checked) el.click();
    } else if (el.tagName === 'SELECT') {
      const want = Array.isArray(f.value) ? f.value.map(String) : [String(f.value ?? '')];
      if (el.multiple) for (const o of [...el.options] as any[]) o.selected = want.includes(String(o.value));
      else el.value = want[0];
      fire('change');
      if (W.jQuery) W.jQuery(el).trigger('chosen:updated');
    } else {
      el.focus?.();
      el.value = String(f.value ?? '');
      fire('input');
      fire('keyup');
      fire('change');
    }
    return 'ok';
  }, f as { key: string; value?: string | string[]; checked?: boolean });
}

/** Watch for a document the portal opens: a viewer frame, a new tab or a download. */
async function watchForDocument(page: Page): Promise<() => Promise<LiveFile | undefined>> {
  await page.evaluate(() => {
    for (const e of [...document.querySelectorAll('iframe, object, embed')] as any[]) e.setAttribute('data-difai-had', String(e.getAttribute('src') ?? e.getAttribute('data') ?? ''));
  }).catch(() => {});
  const popups: Page[] = [];
  const onPage = (p: Page) => { popups.push(p); };
  const downloads: Array<import('playwright').Download> = [];
  const onDownload = (d: import('playwright').Download) => { downloads.push(d); };
  page.context().on('page', onPage);
  page.on('download', onDownload);
  return async () => {
    page.context().off('page', onPage);
    page.off('download', onDownload);
    const d = downloads[0];
    if (d) {
      const path = await d.path().catch(() => null);
      if (path) {
        const { readFile } = await import('node:fs/promises');
        const body = await readFile(path);
        return { name: d.suggestedFilename() || 'document.pdf', contentType: 'application/pdf', base64: body.toString('base64') };
      }
    }
    let url: string | null = null;
    const p = popups[0];
    if (p) {
      await p.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});
      url = p.url();
      if (url && url !== 'about:blank' && !/\.pdf(\?|$)|viewer\.html/i.test(url)) {
        // A printable page in a new tab: keep it as the portal drew it.
        const html = await p.content().catch(() => '');
        await p.close().catch(() => {});
        return { name: 'document.html', contentType: 'text/html', base64: Buffer.from(html).toString('base64') };
      }
      await p.close().catch(() => {});
    }
    if (!url || url === 'about:blank') {
      url = (await page.evaluate(() => {
        const e = ([...document.querySelectorAll('iframe, object, embed')] as any[]).find((x) => {
          const u = String(x.getAttribute('src') ?? x.getAttribute('data') ?? '');
          return u && u !== 'about:blank' && u !== x.getAttribute('data-difai-had');
        });
        return e ? String(e.getAttribute('src') ?? e.getAttribute('data')) : null;
      }).catch(() => null)) as string | null;
    }
    if (!url || url === 'about:blank') return undefined;
    const viewer = /[?&]file=([^&#]+)/.exec(url);
    if (/viewer\.html/i.test(url) && viewer) url = decodeURIComponent(viewer[1]!);
    if (url.startsWith('data:')) {
      const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
      if (!m) return undefined;
      return { name: 'document.pdf', contentType: m[1] || 'application/pdf', base64: m[2] ? m[3]! : Buffer.from(decodeURIComponent(m[3]!)).toString('base64') };
    }
    const abs = url.startsWith('blob:') ? url : new URL(url, page.url()).toString();
    if (!abs.startsWith('blob:') && new URL(abs).hostname !== new URL(page.url()).hostname) {
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
    const name = decodeURIComponent(abs.split(/[?#]/)[0]!.split('/').pop() || 'document.pdf');
    return { name, contentType: got.type.split(';')[0] || 'application/pdf', base64: got.b64 };
  };
}

/**
 * One step on a screen DifAi opened: set the fields, then (optionally) press
 * one button / link of that text - on the portal page itself. Then read what
 * the page shows now and what the portal said. The page must still be the
 * one DifAi opened for this screen (another portal screen may have replaced
 * it - then 409, and the screen is opened again).
 */
export async function stepLiveScreen(page: Page, view: string, def: ScreenDef, step: LiveStep): Promise<LiveStepResult> {
  if (step.press && CHANGES_ACCOUNT.test(step.press.text) && !step.confirmed) {
    throw new EcourtsHttpError(400, `"${step.press.text}" changes your eFiling portal account - confirm it first.`);
  }
  const label = await onView(page, view);
  if (label === null) {
    throw new EcourtsHttpError(409, `The portal page for ${def.label} was replaced by another eFiling screen. Open ${def.label} again.`);
  }
  await helpers(page);
  const drain = await listen(page, !!step.confirmed);
  const missing: string[] = [];
  for (const f of step.fill ?? []) {
    const r = await fillOne(page, f);
    if (r !== 'ok') missing.push(f.key);
    // Cascading choices (district -> establishment ...) load on change.
    await portalIdle(page, 200);
  }
  if (missing.length && step.press) {
    await drain();
    throw new EcourtsHttpError(409, 'Some fields are no longer on the portal page (it changed). Check the screen and try again.');
  }
  let file: LiveFile | undefined;
  if (step.press) {
    const { text, nth = 0 } = step.press;
    const found = await page.evaluate(({ text, nth }) => {
      const d = (globalThis as any).__difai;
      const list = (d.clickables() as any[]).filter((e) => d.textOf(e) === text);
      const b = list[nth];
      if (!b) return 'missing';
      if (b.disabled || b.classList.contains('disabled')) return 'disabled';
      b.setAttribute('data-difai-press', '1');
      return 'ok';
    }, { text, nth });
    if (found === 'missing') { await drain(); throw new EcourtsHttpError(409, `The portal page has no "${text}" now - it may have changed. Check the screen and try again.`); }
    if (found === 'disabled') { await drain(); throw new EcourtsHttpError(409, `The portal keeps "${text}" disabled for now (fill what it needs first).`); }
    const wait = await watchForDocument(page);
    const before = page.url();
    await page.evaluate(() => {
      const b = document.querySelector('[data-difai-press]') as any;
      b.removeAttribute('data-difai-press');
      b.removeAttribute('target');
      b.click();
    }).catch(() => {});
    await portalIdle(page, 600);
    if (page.url() !== before) await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    // A Print / View / Download button: give the portal's viewer a moment to get its document.
    if (/print|view|download|pdf|generate|template/i.test(text)) {
      // A viewer frame, or a new tab (Print Vakalat: window.open(result.name)).
      const tab = page.context().waitForEvent('page', { timeout: 3_000 }).catch(() => null);
      await Promise.race([tab, page.waitForFunction(() => ([...document.querySelectorAll('iframe, object, embed')] as any[]).some((x) => {
        const u = String(x.getAttribute('src') ?? x.getAttribute('data') ?? '');
        return u && u !== 'about:blank' && u !== x.getAttribute('data-difai-had');
      }), undefined, { timeout: 3_000, polling: 150 }).catch(() => {})]);
    }
    file = await wait();
    await assertPortalLoggedIn(page);
    await helpers(page);
    await markView(page, view, label);
  }
  const messages = await drain();
  const screen = await readLiveScreen(page, view, label);
  return { screen, messages, ...(file ? { file } : {}) };
}

// ---- the Vakalat menu and My Partners ---------------------------------------------------------
//
// The portal's menus (live map of the real portal):
//   My Partners > Add Partners (?p=my_partner1/add_partner, js/partners/my_partner1.js),
//     Accept Partnership (?p=my_partner2/accept_partnership, my_partner2.js),
//     Revoke Partnership (?p=revoke_partner/revoke_partnership, revoke_partner.js),
//     Accept Revocation (?p=accept_revocution/accept_revocution_partnership, accept_revocution.js),
//     My Partners Report (?p=my_partner2/friendship_report, report.js)
//   Vakalat > Assign Partners to Case (?p=vakalat), Accept Offer (?p=vakalat/acceptOffer),
//     Print Vakalat (?p=vakalattemplate/generateTemplate, vakalat_template.js)

export type PartnersView = 'add_partner' | 'accept_partnership' | 'revoke_partnership' | 'accept_revocation' | 'partners_report';
export type VakalatView = PartnersView | 'vakalat' | 'accept_offer' | 'print_vakalat';

export const PARTNER_VIEWS: ReadonlyArray<PartnersView> = ['add_partner', 'accept_partnership', 'revoke_partnership', 'accept_revocation', 'partners_report'];

/** Accept Offer: show every offer (the DataTable's "All" entry), as the advocate would pick it. */
async function showAllEntries(page: Page): Promise<void> {
  await page.evaluate(() => {
    const sel = document.querySelector('#example_length select') as any;
    if (!sel || ![...sel.options].some((o: any) => o.value === '-1')) return;
    sel.value = '-1';
    sel.dispatchEvent(new (globalThis as any).Event('change', { bubbles: true }));
  }).catch(() => {});
}

const PARTNERS_MENU = /my\s*partners?/i;

export const VAKALAT_SCREENS: Record<VakalatView, ScreenDef> = {
  // my_partner1.js: advocate name (jQuery UI autocomplete -> my_partner1/get_advocate adv_name&sel_state,
  // pick -> setBarReg), Submit -> submitData() -> my_partner1/submit_data (#frmaddpartner); #get_partner ->
  // my_partner1/fetch_partner lists them; delete_adv_partner(...) asks confirm() -> my_partner1/deletion_adv_partner.
  add_partner: { menu: PARTNERS_MENU, item: /^\s*add\s*partners?\s*$/i, label: 'Add Partners' },
  // my_partner2.js: an offer -> accept_reject_adv_partner(..., 1 accept | 2 reject) shows #div_accept_reject;
  // Get OTP (#get_otp -> send_otp() -> my_partner2/send_otp adv_action), #enter_otp, Submit ->
  // my_partner2/verify_otp then my_partner2/accept_reject_submit (#frmAcceptPartnership).
  accept_partnership: { menu: PARTNERS_MENU, item: /^\s*accept\s*partnership\s*$/i, label: 'Accept Partnership' },
  // revoke_partner.js: revoke_partner/fetchpartnersData -> #partner_table; a partner -> fetchdata1(...) asks
  // confirm() -> revoke_partner/updatedata1; #fofferedchk, Get OTP (getotp() -> revoke_partner/send_otp),
  // #enter_otp, Submit -> submitData(flag) -> revoke_partner/submitdata.
  revoke_partnership: { menu: PARTNERS_MENU, item: /^\s*revoke\s*partnership\s*$/i, label: 'Revoke Partnership' },
  // accept_revocution.js: accept_revocution/fetchpartnersData (rad_val = ftype_radio) -> #partner_table1;
  // fetchdata1(...), getotp() -> accept_revocution/send_otp, submitData(flag) -> accept_revocution/submitdata.
  accept_revocation: { menu: PARTNERS_MENU, item: /^\s*accept\s*revocation\s*$/i, label: 'Accept Revocation' },
  // report.js: my_partner2/my_request -> #div_friendship_req; getRevokeData(opt) -> revoke_partner/my_revoke -> #my_revoke.
  partners_report: { menu: PARTNERS_MENU, item: /partners?\s*report/i, label: 'My Partners Report' },
  // Vakalat > Assign Partners to Case (vakalat.js without #acceptOffer).
  vakalat: { menu: /vakal/i, item: /assign\s*partners?/i, label: 'Assign Partners to Case' },
  // Vakalat > Accept Offer (#acceptOffer = 'Y' -> fetchLitigantData('N')).
  accept_offer: { menu: /vakal/i, item: /accept\s*offer/i, label: 'Accept Offer', after: showAllEntries },
  // Vakalat > Print Vakalat (vakalat_template.js: the same case picking; a template ->
  // viewVakalatTemplate(...) -> vakalattemplate/viewTemplate -> window.open(result.name)).
  print_vakalat: { menu: /vakal/i, item: /print\s*vakal/i, label: 'Print Vakalat' },
};

/** Open a Vakalat / My Partners screen on the portal and read it. */
export async function openVakalatScreen(sessionId: string, userId: string, view: VakalatView): Promise<LiveScreen> {
  const def = VAKALAT_SCREENS[view];
  return withPortalPage(sessionId, userId, (page) => openLiveScreen(page, view, def));
}

/** One step on a Vakalat / My Partners screen (fields, then a button), on the portal page. */
export async function stepVakalatScreen(sessionId: string, userId: string, view: VakalatView, step: LiveStep): Promise<LiveStepResult> {
  const def = VAKALAT_SCREENS[view];
  return withPortalPage(sessionId, userId, (page) => stepLiveScreen(page, view, def, step));
}
