import type { Dialog, Page } from 'playwright';
import { EcourtsHttpError } from '../lib/ecourts';
import { closePortalPopups, openPortalMenu, withPortalPage } from './efiling-live.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- DOM global, no dom lib in this tsconfig
declare const document: any;

// =============================================================================
// efiling-portal-applications.service
//
// The portal's APPLICATIONS menu (filing.ecourts.gov.in/pdedev), live over the
// advocate's own logged-in portal page:
//
//   Applications > Interlocutory Application Filing   (#frmapplications)
//     tab 1  the application: how the case is chosen (radio `cases`: e-filing
//            number #sel_pde_no / case registered in the court - district,
//            establishment, case type, number, year -> searchCase() ->
//            applications/getCaseNumberComponent/ / by next date #dt_next_date
//            -> getMyCases()), the parties (.chk_pet / .chk_res, or .selcase +
//            .csClient per case), Application Type (#application_type ->
//            getPrayerPreamble() -> preamble, prayer, court fee), Paragraph1..n
//            (add_more_para / remove_para), then submitApplication()
//            (applications/submitApplication). Applications already added for
//            the case are listed with Edit (editApplication) / Delete
//            (delApplication - "Do you want to Delete the application ?").
//     #epay_tab  pay the court fee from the wallet: getSubmittedCasesPayFees ->
//            .chkEstApp per application, remaining balance per establishment,
//            payCourtFees() ("Do you want to pay for application?").
//     #otp_tab   authentication: getMySubmittedCases -> per application the
//            litigant / advocate authenticate buttons (setPartyMobile) open
//            #vw_otp_modal; generateOTP() sends the OTP, the ADVOCATE types it
//            (#user_otp) and verifyOTP() checks it and then submits
//            (submitFinalData).
//   Applications > Submitted Applications  (#frm_submitted_application:
//            from_date / to_date -> searchApplication() ->
//            applications/searchSubmittedApplication; each application opens
//            through getPrayerPreambleData).
//
// Everything above is from the portal's public js/applications.js (see
// docs/efiling-portal-reverse-engineering.md section 6). The page's HTML
// itself (labels, button texts, which radio is which) is server-rendered and
// not public, so DifAi does not invent it: every step reads the page as the
// portal drew it - headings, fields with their labels and choices, buttons,
// tables with the controls inside each row, open pop-ups - and acts on it the
// way the advocate would (choosing, typing, ticking, pressing the portal's own
// buttons, so its own JavaScript makes its own requests).
//
// Safety: a portal confirm() is answered "OK" only when the advocate confirmed
// in DifAi (`confirmed: true`); buttons that submit, delete, pay, update or
// verify need `confirmed: true` before they are pressed at all. OTPs are only
// ever typed by the advocate; DifAi never reads, guesses or stores them.
// =============================================================================

export type AppsScreenKey = 'applications' | 'submitted';

const SCREENS: Record<AppsScreenKey, { label: string; menu: RegExp[]; marker: string }> = {
  applications: {
    label: 'Interlocutory Application Filing',
    menu: [/interlocutory\s*applications?(\s*filing)?/i, /^\s*applications?\s*filing\s*$/i],
    marker: '#frmapplications',
  },
  submitted: {
    label: 'Submitted Applications',
    menu: [/submitted\s*applications?/i],
    marker: '#frm_submitted_application',
  },
};

/** One control as the portal shows it. `ref` is how DifAi points at it on the page. */
export interface AppControl {
  ref: string;
  tag: string;
  type: string;
  id: string;
  name: string;
  /** Its label on the portal (button text for buttons and links). */
  label: string;
  value: string;
  checked?: boolean;
  disabled: boolean;
  readOnly?: boolean;
  options?: Array<{ value: string; text: string }>;
  /** The portal's own validation message next to it ("This field is required." ...). */
  error?: string;
  /** Submits, deletes, pays, updates or verifies: needs the advocate's confirmation. */
  risky?: boolean;
}

export type AppRow = { group: string } | { cells: Array<{ text: string; controls: AppControl[] }> };

export type AppItem =
  | { kind: 'heading'; text: string }
  | { kind: 'text'; id: string; label: string; text: string }
  | { kind: 'field'; control: AppControl }
  | { kind: 'button'; control: AppControl }
  | { kind: 'table'; id: string; headers: string[]; rows: AppRow[] };

export interface AppsModal {
  id: string;
  title: string;
  /** The window's own close (×), pressed when the advocate closes it in DifAi. */
  closeRef: string | null;
  items: AppItem[];
}

export interface AppsScreen {
  screen: AppsScreenKey;
  label: string;
  /** False when the portal page moved to another screen (e.g. after a reload). */
  onScreen: boolean;
  tabs: Array<{ ref: string; id: string; text: string; active: boolean }>;
  items: AppItem[];
  /** Pop-ups open on the portal page (e.g. #vw_otp_modal), in the order shown. */
  modals: AppsModal[];
  /** What the portal said during the last step (its alerts / messages). */
  messages: string[];
  /** A confirm() the portal asked and DifAi answered "Cancel" - ask the advocate, then repeat with confirmed. */
  confirm: string | null;
  /** The button that asked `confirm` (its ref in this read), to press again with confirmed. */
  confirmRef: string | null;
}

export interface AppsFile {
  name: string;
  contentType: string;
  body: Buffer;
}

// ---- the page's #user_name -----------------------------------------------------------
//
// The OTP pop-up on this page shows the litigant's name in #user_name
// (setPartyMobile: $('#user_name').html(party_name)). efiling-live.service
// takes a #user_name on the page as "bounced to the login form", so between
// steps that span is parked under another id and put back before the portal's
// own code runs again. The login form's #user_name (an input) is never touched.

async function unpark(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const el of [...document.querySelectorAll('[data-difai-parked-id]')] as any[]) {
      el.id = el.getAttribute('data-difai-parked-id');
      el.removeAttribute('data-difai-parked-id');
    }
  }).catch(() => {});
}

async function park(page: Page): Promise<void> {
  await page.evaluate(() => {
    const el = document.getElementById('user_name') as any;
    if (!el || el.tagName === 'INPUT' || document.getElementById('frm_login')) return;
    el.setAttribute('data-difai-parked-id', 'user_name');
    el.id = 'difai_parked_user_name';
  }).catch(() => {});
}

/** One step on the Applications screens: the advocate's page, one at a time. */
async function onPortal<T>(sessionId: string, userId: string, fn: (page: Page) => Promise<T>): Promise<T> {
  return withPortalPage(sessionId, userId, async (page) => {
    await unpark(page);
    try {
      return await fn(page);
    } finally {
      await park(page);
    }
  });
}

// ---- opening the screens --------------------------------------------------------------

async function isOn(page: Page, key: AppsScreenKey): Promise<boolean> {
  return !!(await page.$(SCREENS[key].marker).catch(() => null));
}

async function loginShown(page: Page): Promise<boolean> {
  return page.evaluate(() => !!document.querySelector('#frm_login, input#user_name')).catch(() => false);
}

async function openFromMenu(page: Page, key: AppsScreenKey): Promise<boolean> {
  for (const re of SCREENS[key].menu) {
    if (await openPortalMenu(page, re).catch(() => false)) return true;
  }
  return false;
}

/** A screen that sits in a tab of the page: open that tab, as the advocate would. */
async function showTabHolding(page: Page, marker: string): Promise<void> {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel) as any;
    if (!el || el.getClientRects().length) return;
    const pane = el.closest('.tab-pane');
    if (!pane?.id) return;
    const tab = document.querySelector(`.nav-tabs a[href="#${pane.id}"], [data-target="#${pane.id}"], [data-bs-target="#${pane.id}"]`) as any;
    tab?.click();
  }, marker).catch(() => {});
  await page.waitForTimeout(400);
}

async function ensureScreen(page: Page, key: AppsScreenKey, fresh: boolean): Promise<void> {
  if (!fresh && await isOn(page, key)) return;
  await closePortalPopups(page);
  let opened = await openFromMenu(page, key);
  if (!opened) {
    // The menu isn't on this page: from the dashboard, as the advocate would.
    const base = await page.evaluate(() => String((document.getElementById('base_url') as any)?.value ?? '')).catch(() => '');
    const home = `${(base || `${new URL(page.url()).origin}/pdedev`).replace(/\/$/, '')}/?p=dashboard`;
    await page.goto(home, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    if (await loginShown(page)) throw new EcourtsHttpError(410, 'The eFiling portal has signed this session out. Log in again.');
    opened = await openFromMenu(page, key);
  }
  if (await loginShown(page)) throw new EcourtsHttpError(410, 'The eFiling portal has signed this session out. Log in again.');
  // Submitted Applications may be a tab of the Applications page.
  if (!(await isOn(page, key)) && key === 'submitted' && await openFromMenu(page, 'applications')) {
    /* looked for below */
  }
  if (!(await isOn(page, key))) {
    throw new EcourtsHttpError(502, opened
      ? `The portal opened a page without ${SCREENS[key].label} on it - it may have changed. Try again.`
      : `Couldn't find Applications > ${SCREENS[key].label} in your portal menu.`);
  }
  await showTabHolding(page, SCREENS[key].marker);
}

// ---- reading what the portal shows ---------------------------------------------------

const RISKY_TEXT = /\b(submit|final|delete|pay|update|verify)\b/i;
const RISKY_FN = /\b(submitApplication|delApplication|payCourtFees|verifyOTP1?|submitFinalData1?)\s*\(/;

/** Read the screen as drawn: tabs, items in page order, open pop-ups. Assigns fresh refs. */
async function readScreen(page: Page): Promise<Pick<AppsScreen, 'tabs' | 'items' | 'modals'>> {
  // The portal's DataTables show 20-25 rows a page; show all of them (as
  // choosing more entries would) so nothing is missed.
  await page.evaluate(() => {
    const $ = (globalThis as any).jQuery;
    if (!$?.fn?.dataTable) return;
    for (const t of [...document.querySelectorAll('table')] as any[]) {
      try {
        if ($.fn.dataTable.isDataTable(t)) {
          const api = $(t).DataTable();
          if (api.page.len() !== -1) api.page.len(-1).draw(false);
        }
      } catch { /* not a DataTable */ }
    }
  }).catch(() => {});

  return page.evaluate(({ riskyText, riskyFn }) => {
    const W = globalThis as any;
    const RISKY_T = new RegExp(riskyText, 'i');
    const RISKY_F = new RegExp(riskyFn);
    const txt = (e: any) => String(e?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const chosenOf = (el: any) => (el.id ? document.getElementById(`${el.id}_chosen`) : null)
      ?? (el.nextElementSibling?.classList?.contains('chosen-container') ? el.nextElementSibling : null);
    const shown = (el: any): boolean => {
      if (!el) return false;
      if (el.tagName === 'SELECT') {
        const c = chosenOf(el);
        if (c) return c.getClientRects().length > 0;
      }
      return el.getClientRects().length > 0;
    };
    const CONTROL = 'input:not([type=hidden]), select, textarea';
    const isButton = (el: any): boolean => {
      if (el.tagName === 'BUTTON') return true;
      if (el.tagName === 'INPUT') return /^(button|submit|reset)$/i.test(el.type);
      if (el.tagName !== 'A') return false;
      const href = String(el.getAttribute('href') ?? '');
      return !!el.getAttribute('onclick') || el.classList.contains('btn') || /page-link/.test(String(el.className))
        || el.hasAttribute('data-page') || href === '' || href.endsWith('#') || /^javascript:/i.test(href);
    };
    const isField = (el: any) => (el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type !== 'hidden' && !isButton(el)));
    const INLINE = /^(B|STRONG|I|EM|SPAN|SMALL|FONT|U|BR|SUP|SUB|LABEL)$/;
    const leafish = (el: any) => ([...el.querySelectorAll('*')] as any[]).every((c) => INLINE.test(c.tagName) && !c.matches(CONTROL));

    for (const e of [...document.querySelectorAll('[data-difai-app-ref]')] as any[]) e.removeAttribute('data-difai-app-ref');
    let n = 0;
    const ref = (el: any) => { const r = `a${++n}`; el.setAttribute('data-difai-app-ref', r); return r; };

    // Labels the portal put next to a control (or a value shown by id): kept
    // with that control, not shown again as loose text.
    const used = new Set<any>();
    const labelOf = (el: any): string => {
      if (el.id) {
        const l = document.querySelector(`label[for="${W.CSS.escape(el.id)}"]`);
        if (l) { used.add(l); return txt(l); }
      }
      const wrap = el.closest('label');
      if (wrap && wrap !== el) {
        const k = wrap.cloneNode(true);
        for (const c of [...k.querySelectorAll('input, select, textarea')]) c.remove();
        return txt(k);
      }
      if (el.type === 'radio' || el.type === 'checkbox') {
        // "<input type=checkbox> Ramesh Kumar<br>": the text right after it.
        let s = el.nextSibling;
        let out = '';
        const nodes: any[] = [];
        while (s && out.length < 160) {
          if (s.nodeType === 1 && (s.matches('input, select, textarea, br, div, table, p, ul') || s.querySelector?.('input, select, textarea'))) break;
          out += ` ${s.textContent ?? ''}`;
          nodes.push(s);
          s = s.nextSibling;
        }
        out = out.replace(/\s+/g, ' ').trim();
        if (out) { for (const x of nodes) used.add(x); return out; }
      }
      // The label column just before it: "<div col-3><label>X</label></div><div col-8><field>".
      // Only the field itself or its own column/cell - never further out.
      const steps = [el, el.parentElement?.matches?.('[class*="col"], .form-group, .input-group, td') ? el.parentElement : null];
      for (const p of steps) {
        if (!p) continue;
        const prev = p.previousElementSibling;
        if (prev && !/^H[1-6]$/.test(prev.tagName) && !prev.matches('.row, table, br') && leafish(prev) && txt(prev) && txt(prev).length < 160) {
          used.add(prev);
          return txt(prev);
        }
        if (prev) break;
      }
      return String(el.getAttribute('placeholder') ?? el.getAttribute('title') ?? el.getAttribute('aria-label') ?? '');
    };
    const errorOf = (el: any): string => {
      const after = chosenOf(el) ?? el;
      let s = after.nextElementSibling;
      const out: string[] = [];
      while (s && s.matches('label.error, span.error, span.error_comp, .invalid-feedback')) {
        if (s.getClientRects().length && txt(s)) out.push(txt(s));
        used.add(s);
        s = s.nextElementSibling;
      }
      return out.join(' ');
    };
    const control = (el: any) => {
      const tag = String(el.tagName).toLowerCase();
      const btn = isButton(el);
      const type = String(el.getAttribute('type') ?? (tag === 'select' ? 'select' : tag === 'textarea' ? 'textarea' : btn ? 'button' : 'text')).toLowerCase();
      const label = btn ? (txt(el) || String(el.value ?? '') || String(el.getAttribute('title') ?? '')).slice(0, 80) : labelOf(el).slice(0, 200);
      const c: any = {
        ref: ref(el), tag, type, id: String(el.id ?? ''), name: String(el.getAttribute('name') ?? ''), label,
        value: btn || type === 'file' || type === 'password' ? '' : String(el.value ?? ''),
        disabled: !!el.disabled || el.classList.contains('disabled') || !!el.closest('fieldset[disabled], .disabledcs'),
      };
      if (type === 'checkbox' || type === 'radio') c.checked = !!el.checked;
      if (tag === 'select') c.options = ([...el.options] as any[]).map((o) => ({ value: String(o.value), text: txt(o) }));
      if (el.readOnly) c.readOnly = true;
      if (btn) c.risky = RISKY_T.test(label) || RISKY_F.test(String(el.getAttribute('onclick') ?? ''));
      if (!btn) { const err = errorOf(el); if (err) c.error = err; }
      return c;
    };

    // A table as shown: headers, group rows, each cell's lines and controls.
    const cellText = (c: any): string => {
      const hidden = ([...c.querySelectorAll('*')] as any[]).filter((e) => !e.getClientRects().length && !e.matches('br'));
      for (const e of hidden) e.setAttribute('data-difai-hidden', '1');
      const k = c.cloneNode(true);
      for (const e of hidden) e.removeAttribute('data-difai-hidden');
      for (const e of [...k.querySelectorAll('[data-difai-hidden], script, style, button, select, textarea, input, .chosen-container')]) e.remove();
      for (const a of [...k.querySelectorAll('a')] as any[]) if (a.getAttribute('onclick') || a.classList.contains('btn')) a.remove();
      for (const br of [...k.querySelectorAll('br')]) br.replaceWith('\n');
      for (const b of [...k.querySelectorAll('div, p, li, tr')]) b.append('\n');
      return String(k.textContent ?? '').split('\n').map((x: string) => x.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
    };
    const table = (t: any) => {
      const head = t.tHead?.rows?.length ? t.tHead.rows[t.tHead.rows.length - 1] : null;
      const headers = head ? ([...head.cells] as any[]).filter((c) => c.getClientRects().length).map(txt) : [];
      const rows = ([...t.rows] as any[])
        .filter((r) => r.parentElement?.tagName !== 'THEAD' && r.getClientRects().length)
        .map((tr) => {
          const cells = ([...tr.cells] as any[]).filter((c) => c.getClientRects().length);
          if (cells.length === 1 && (Number(cells[0].colSpan) > 1 || tr.classList.contains('dtrg-group')) && !cells[0].querySelector(CONTROL)) {
            return { group: txt(cells[0]) };
          }
          return {
            cells: cells.map((c) => ({
              text: cellText(c),
              controls: ([...c.querySelectorAll('input:not([type=hidden]), select, textarea, button, a')] as any[])
                .filter((el) => !el.closest('.chosen-container') && shown(el) && (isField(el) || isButton(el)))
                .map(control),
            })),
          };
        })
        .filter((r: any) => ('group' in r ? !!r.group : r.cells.some((c: any) => c.text || c.controls.length)));
      return { kind: 'table', id: String(t.id ?? ''), headers, rows };
    };

    const SKIP = 'script, style, noscript, template, nav, .navbar, header, footer, .modal, .chosen-container, .nav-tabs, '
      + '.dataTables_length, .dataTables_filter, .dataTables_info, .dataTables_paginate, #validateError, .alert-danger-cust, .alert-success-cust, #loader, .loader';
    const walk = (root: any, out: any[]) => {
      let loose = '';
      const flush = () => { const t = loose.replace(/\s+/g, ' ').trim(); if (t) out.push({ kind: 'text', id: '', label: '', text: t }); loose = ''; };
      for (const node of [...root.childNodes] as any[]) {
        if (node.nodeType === 3) {
          if (!used.has(node) && root.getClientRects().length) loose += ` ${node.textContent ?? ''}`;
          continue;
        }
        if (node.nodeType !== 1) continue;
        const el = node;
        if (el.matches(SKIP) || used.has(el)) continue;
        if (el.tagName === 'INPUT' && el.type === 'hidden') continue;
        if (isField(el)) {
          if (shown(el)) { flush(); out.push({ kind: 'field', control: control(el) }); }
          continue;
        }
        if (!shown(el)) continue;
        if (isButton(el)) { flush(); out.push({ kind: 'button', control: control(el) }); continue; }
        if (el.tagName === 'TABLE') { flush(); out.push(table(el)); continue; }
        if (/^H[1-6]$/.test(el.tagName) || el.matches('legend, .card-header, .panel-heading, .box-title, .modal-title')) {
          if (!el.querySelector('input, select, textarea, button, table')) {
            flush();
            const t = txt(el);
            if (t) out.push({ kind: 'heading', text: t });
            continue;
          }
        }
        if (el.tagName === 'LABEL' && !el.querySelector(CONTROL)) {
          // A label of no field here: the portal's own wording (e.g. "Select Case").
          flush();
          const t = txt(el);
          if (t) out.push({ kind: 'text', id: String(el.id ?? ''), label: '', text: t });
          continue;
        }
        if (el.id && leafish(el)) {
          // A value the portal shows by id (court fee, case title, OTP mobile ...).
          flush();
          const label = labelOf(el);
          const t = txt(el);
          if (t) out.push({ kind: 'text', id: String(el.id), label: label === t ? '' : label, text: t });
          continue;
        }
        if (INLINE.test(el.tagName) && leafish(el)) { loose += ` ${el.textContent ?? ''}`; continue; }
        flush();
        walk(el, out);
      }
      flush();
    };
    // Labels first (so they stay with their controls), then the walk.
    for (const el of [...document.querySelectorAll(CONTROL)] as any[]) if (shown(el) && !isButton(el)) labelOf(el);
    for (const el of [...document.querySelectorAll('[id]')] as any[]) {
      if (/^(LABEL|OPTION|SELECT|TEXTAREA|INPUT|BUTTON|A|TABLE|SCRIPT|STYLE)$/.test(el.tagName) || el.closest('nav, .navbar')) continue;
      if (leafish(el) && txt(el) && el.getClientRects().length) labelOf(el);
    }

    const tabs = ([...document.querySelectorAll('.nav-tabs a, .nav-tabs button, [role=tab]')] as any[])
      .filter((a) => shown(a) && !a.closest('nav, .navbar, .modal'))
      .map((a) => {
        const href = String(a.getAttribute('href') ?? a.getAttribute('data-target') ?? a.getAttribute('data-bs-target') ?? '');
        const pane = /^#[\w-]+$/.test(href) ? document.querySelector(href) : null;
        // The tab whose pane is showing; without a pane, the tab's own marking.
        const active = pane ? pane.getClientRects().length > 0
          : a.classList.contains('active') || a.getAttribute('aria-selected') === 'true' || !!a.closest('li.active');
        return { ref: ref(a), id: String(a.id ?? ''), text: txt(a), active };
      })
      .filter((t) => t.text);

    const items: any[] = [];
    walk(document.body, items);
    const modals = ([...document.querySelectorAll('.modal')] as any[])
      .filter((m) => m.id !== 'validateError' && m.getClientRects().length > 0 && W.getComputedStyle(m).display !== 'none')
      .map((m) => {
        const out: any[] = [];
        const body = m.querySelector('.modal-content') ?? m;
        // The heading row is the window's title; its × is DifAi's own close.
        for (const h of [...body.querySelectorAll('.modal-header')]) used.add(h);
        walk(body, out);
        const close = ([...m.querySelectorAll('[data-dismiss=modal], [data-bs-dismiss=modal], .close, .btn-close')] as any[]).find(shown);
        return { id: String(m.id ?? ''), title: txt(m.querySelector('.modal-title')), closeRef: close ? ref(close) : null, items: out };
      });
    return { tabs, items, modals };
  }, { riskyText: RISKY_TEXT.source, riskyFn: RISKY_FN.source }) as Promise<Pick<AppsScreen, 'tabs' | 'items' | 'modals'>>;
}

// ---- doing a step the way the advocate would --------------------------------------------

interface StepResult { messages: string[]; confirm: string | null }

/**
 * Run `act` on the page with the portal's dialogs handled (alerts noted; a
 * confirm() answered OK only when the advocate confirmed) and its messages
 * (errorAlert / successAlert) collected, then wait for its requests to finish.
 */
async function step(page: Page, confirmed: boolean, act: () => Promise<void>): Promise<StepResult> {
  const dialogs: string[] = [];
  let declined: string | null = null;
  const onDialog = (d: Dialog) => {
    const msg = d.message();
    if (d.type() === 'confirm') {
      if (confirmed) { dialogs.push(msg); void d.accept().catch(() => {}); } else { declined = msg; void d.dismiss().catch(() => {}); }
      return;
    }
    if (d.type() === 'alert') dialogs.push(msg);
    void (d.type() === 'alert' ? d.accept() : d.dismiss()).catch(() => {});
  };
  page.on('dialog', onDialog);
  await page.evaluate(() => {
    const w = globalThis as any;
    w.__difaiAppMsgs = [];
    for (const fn of ['errorAlert', 'successAlert']) {
      const orig = w[fn];
      if (typeof orig === 'function' && !orig.__difaiApps) {
        const wrapped = function (this: unknown, msg: unknown) {
          (w.__difaiAppMsgs ??= []).push(String(msg ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
          return orig.apply(this, arguments as any);
        };
        (wrapped as any).__difaiApps = true;
        w[fn] = wrapped;
      }
    }
  }).catch(() => {});

  // The portal's requests (its ajaxCall waits 50 ms, then posts; chosen is redrawn 300 ms later).
  let inflight = 0;
  let last = Date.now();
  const mine = (r: { resourceType: () => string }) => ['xhr', 'fetch', 'document'].includes(r.resourceType());
  const onReq = (r: { resourceType: () => string }) => { if (mine(r)) { inflight++; last = Date.now(); } };
  const onDone = (r: { resourceType: () => string }) => { if (mine(r)) { inflight = Math.max(0, inflight - 1); last = Date.now(); } };
  page.on('request', onReq);
  page.on('requestfinished', onDone);
  page.on('requestfailed', onDone);
  try {
    const startUrl = page.url();
    await act();
    const start = Date.now();
    await page.waitForTimeout(400);
    while (Date.now() - start < 60_000) {
      if (inflight === 0 && Date.now() - last > 700) break;
      await page.waitForTimeout(150);
    }
    if (page.url() !== startUrl) await page.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => {});
  } finally {
    page.off('dialog', onDialog);
    page.off('request', onReq);
    page.off('requestfinished', onDone);
    page.off('requestfailed', onDone);
  }
  const fromPage = (await page.evaluate(() => (globalThis as any).__difaiAppMsgs ?? []).catch(() => [])) as string[];
  // The portal's message window: read, so it is closed as the advocate would.
  await page.evaluate(() => {
    const $ = (globalThis as any).jQuery;
    const box = document.getElementById('validateError') as any;
    if (!box) return;
    if ($?.fn?.modal) $(box).modal('hide'); else box.style.display = 'none';
  }).catch(() => {});
  if (await loginShown(page)) throw new EcourtsHttpError(410, 'The eFiling portal has signed this session out. Log in again.');
  return { messages: [...fromPage, ...dialogs].filter(Boolean), confirm: declined };
}

async function screenAfter(page: Page, key: AppsScreenKey, r: StepResult, pressed?: string): Promise<AppsScreen> {
  const onScreen = await isOn(page, key);
  // The button the advocate pressed, found again after the read gives new refs.
  if (pressed && r.confirm) {
    await page.evaluate((x) => document.querySelector(`[data-difai-app-ref="${x}"]`)?.setAttribute('data-difai-pressed', '1'), pressed).catch(() => {});
  }
  const s = await readScreen(page);
  let confirmRef: string | null = null;
  if (pressed && r.confirm) {
    confirmRef = await page.evaluate(() => {
      const el = document.querySelector('[data-difai-pressed]') as any;
      el?.removeAttribute('data-difai-pressed');
      return el?.getAttribute('data-difai-app-ref') ?? null;
    }).catch(() => null);
  }
  return { screen: key, label: SCREENS[key].label, onScreen, ...s, messages: r.messages, confirm: r.confirm, confirmRef };
}

/** Make sure a ref from the last read is still on the screen; describe it. */
async function target(page: Page, key: AppsScreenKey, ref: string): Promise<{ tag: string; type: string; text: string; risky: boolean; disabled: boolean }> {
  if (!(await isOn(page, key))) {
    throw new EcourtsHttpError(409, `Your portal page is no longer on ${SCREENS[key].label} - open it again.`);
  }
  const t = await page.evaluate(({ r, riskyText, riskyFn }) => {
    const el = document.querySelector(`[data-difai-app-ref="${r}"]`) as any;
    if (!el || !el.isConnected) return null;
    const text = String(el.textContent || el.value || '').replace(/\s+/g, ' ').trim();
    return {
      tag: String(el.tagName).toLowerCase(), type: String(el.getAttribute('type') ?? '').toLowerCase(), text,
      risky: !el.closest('.nav-tabs, [role=tablist]') && el.getAttribute('role') !== 'tab'
        && (new RegExp(riskyText, 'i').test(text) || new RegExp(riskyFn).test(String(el.getAttribute('onclick') ?? ''))),
      disabled: !!el.disabled || el.classList.contains('disabled') || !!el.closest('fieldset[disabled], .disabledcs'),
      logout: /log\s*out|sign\s*out/i.test(`${text} ${el.getAttribute('href') ?? ''}`),
    };
  }, { r: ref, riskyText: RISKY_TEXT.source, riskyFn: RISKY_FN.source }).catch(() => null);
  if (!t) throw new EcourtsHttpError(409, 'That part of the portal page has changed - it has been read again.');
  if (t.logout) throw new EcourtsHttpError(400, 'DifAi does not log you out of the portal from here.');
  return t;
}

// ---- public steps --------------------------------------------------------------------

/** Open (or re-read) Applications > Interlocutory Application Filing / Submitted Applications. */
export async function readApplicationsScreen(sessionId: string, userId: string, key: AppsScreenKey, fresh = false): Promise<AppsScreen> {
  return onPortal(sessionId, userId, async (page) => {
    await ensureScreen(page, key, fresh);
    return screenAfter(page, key, { messages: [], confirm: null });
  });
}

/** Choose / type / tick a field as the advocate would (its own change handlers run). */
export async function setApplicationsField(sessionId: string, userId: string, key: AppsScreenKey, ref: string, input: { value?: string; checked?: boolean }): Promise<AppsScreen> {
  return onPortal(sessionId, userId, async (page) => {
    const t = await target(page, key, ref);
    if (t.disabled) throw new EcourtsHttpError(409, 'The portal has this field switched off right now.');
    if (t.type === 'file') throw new EcourtsHttpError(400, 'Attach this file on the portal page itself.');
    const r = await step(page, false, async () => {
      const res = await page.evaluate(({ r, value, checked }) => {
        const el = document.querySelector(`[data-difai-app-ref="${r}"]`) as any;
        if (!el) return 'gone';
        const W = globalThis as any;
        const fire = (type: string) => el.dispatchEvent(new W.Event(type, { bubbles: true }));
        if (el.type === 'checkbox' || el.type === 'radio') {
          const want = el.type === 'radio' ? true : !!checked;
          // A click, so the portal's onclick (setWalletBalence, checkTermCondition ...) runs.
          if (!!el.checked !== want) el.click();
          return 'ok';
        }
        if (el.tagName === 'SELECT') {
          const opt = ([...el.options] as any[]).find((o) => String(o.value) === String(value ?? ''));
          if (!opt) return 'option';
          el.value = opt.value;
          fire('change');
          const $ = W.jQuery;
          if ($) $(el).trigger('chosen:updated');
          return 'ok';
        }
        if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return 'kind';
        el.value = String(value ?? '');
        fire('input');
        fire('keyup');
        fire('change');
        return 'ok';
      }, { r: ref, value: input.value ?? null, checked: input.checked ?? null });
      if (res === 'option') throw new EcourtsHttpError(409, 'That choice is not in the portal\'s list any more - it has been read again.');
      if (res !== 'ok') throw new EcourtsHttpError(409, 'That part of the portal page has changed - it has been read again.');
    });
    return screenAfter(page, key, r);
  });
}

/**
 * Press one of the portal's buttons / links / tabs on the screen. Buttons that
 * submit, delete, pay, update or verify need `confirmed`; a confirm() the
 * portal asks is answered OK only when `confirmed`.
 */
export async function pressApplicationsControl(sessionId: string, userId: string, key: AppsScreenKey, ref: string, confirmed: boolean): Promise<AppsScreen> {
  return onPortal(sessionId, userId, async (page) => {
    const t = await target(page, key, ref);
    if (t.risky && !confirmed) {
      throw new EcourtsHttpError(409, `"${t.text || 'This button'}" changes your filing on the portal - confirm it first.`);
    }
    if (t.disabled) throw new EcourtsHttpError(409, 'The portal has this button switched off right now.');
    const r = await step(page, confirmed, async () => {
      await page.evaluate((x) => { (document.querySelector(`[data-difai-app-ref="${x}"]`) as any)?.click(); }, ref);
    });
    return screenAfter(page, key, r, ref);
  });
}

/** The step continues what is on the screen now: never reload it underneath. */
async function requireOn(page: Page, key: AppsScreenKey): Promise<void> {
  if (!(await isOn(page, key))) {
    throw new EcourtsHttpError(409, `Your portal page is no longer on ${SCREENS[key].label} - open it again.`);
  }
}

/** Call one of applications.js's own functions (the buttons whose job the JS makes certain). */
async function callPortalFn(page: Page, name: string, args: unknown[] = []): Promise<void> {
  const ok = await page.evaluate(({ name, args }) => {
    const f = (globalThis as any)[name];
    if (typeof f !== 'function') return false;
    f(...args);
    return true;
  }, { name, args }).catch(() => false);
  if (!ok) throw new EcourtsHttpError(502, `The portal page has no ${name}() any more - it may have changed.`);
}

/** Interlocutory Application Filing > Submit / Update (submitApplication). */
export async function submitApplication(sessionId: string, userId: string, confirmed: boolean): Promise<AppsScreen> {
  if (!confirmed) throw new EcourtsHttpError(409, 'Confirm before the application is submitted on the portal.');
  return onPortal(sessionId, userId, async (page) => {
    await requireOn(page, 'applications');
    const r = await step(page, true, () => callPortalFn(page, 'submitApplication'));
    return screenAfter(page, 'applications', r);
  });
}

/** Authentication: "Send OTP" in the OTP window (generateOTP) - the portal texts it to the mobile shown. */
export async function sendApplicationOtp(sessionId: string, userId: string): Promise<AppsScreen> {
  return onPortal(sessionId, userId, async (page) => {
    await requireOn(page, 'applications');
    const open = await page.evaluate(() => {
      const m = document.getElementById('vw_otp_modal') as any;
      return !!m && m.getClientRects().length > 0;
    }).catch(() => false);
    if (!open) throw new EcourtsHttpError(409, 'Choose who authenticates first (the Authenticate button in the application\'s row).');
    const r = await step(page, false, () => callPortalFn(page, 'generateOTP'));
    return screenAfter(page, 'applications', r);
  });
}

/**
 * Authentication: the OTP the advocate typed -> verifyOTP(). On success the
 * portal itself goes on to submitFinalData (the final submission), so this
 * needs `confirmed`. The OTP is never logged or kept.
 */
export async function verifyApplicationOtp(sessionId: string, userId: string, otp: string, confirmed: boolean): Promise<AppsScreen> {
  if (!confirmed) throw new EcourtsHttpError(409, 'Confirm before the OTP is verified - the portal submits the application right after.');
  return onPortal(sessionId, userId, async (page) => {
    await requireOn(page, 'applications');
    const typed = await page.evaluate((code) => {
      const el = document.getElementById('user_otp') as any;
      if (!el || !el.getClientRects().length) return false;
      el.value = code;
      el.dispatchEvent(new (globalThis as any).Event('input', { bubbles: true }));
      return true;
    }, otp).catch(() => false);
    if (!typed) throw new EcourtsHttpError(409, 'The OTP window is not open on the portal - press Authenticate again.');
    const r = await step(page, true, () => callPortalFn(page, 'verifyOTP'));
    return screenAfter(page, 'applications', r);
  });
}

/** Pay Fees: pay the ticked applications' court fee from the wallet (payCourtFees). */
export async function payApplicationFees(sessionId: string, userId: string, confirmed: boolean): Promise<AppsScreen> {
  if (!confirmed) throw new EcourtsHttpError(409, 'Confirm before the court fee is paid from your wallet.');
  return onPortal(sessionId, userId, async (page) => {
    await requireOn(page, 'applications');
    const r = await step(page, true, () => callPortalFn(page, 'payCourtFees'));
    return screenAfter(page, 'applications', r);
  });
}

/** Submitted Applications: From Date / To Date (dd-mm-yyyy, as the portal takes them) -> searchApplication(). */
export async function searchSubmittedApplications(sessionId: string, userId: string, fromDate: string, toDate: string): Promise<AppsScreen> {
  return onPortal(sessionId, userId, async (page) => {
    await ensureScreen(page, 'submitted', false);
    const r = await step(page, false, async () => {
      const ok = await page.evaluate(({ f, t }) => {
        const a = document.getElementById('from_date') as any;
        const b = document.getElementById('to_date') as any;
        if (!a || !b) return false;
        a.value = f;
        b.value = t;
        for (const el of [a, b]) el.dispatchEvent(new (globalThis as any).Event('change', { bubbles: true }));
        return true;
      }, { f: fromDate, t: toDate });
      if (!ok) throw new EcourtsHttpError(502, 'The portal page has no From Date / To Date any more - it may have changed.');
      await callPortalFn(page, 'searchApplication');
    });
    return screenAfter(page, 'submitted', r);
  });
}

/**
 * A link / button that shows a document (an application through
 * getPrayerPreambleData, ...): press it, catch the file the portal's viewer
 * then shows (its frame, a new tab or a download) and fetch it over the
 * advocate's session.
 */
export async function openApplicationsDocument(sessionId: string, userId: string, key: AppsScreenKey, ref: string): Promise<AppsFile> {
  return onPortal(sessionId, userId, async (page) => {
    const t = await target(page, key, ref);
    if (t.risky) throw new EcourtsHttpError(400, 'That button does not open a document.');
    await page.evaluate(() => {
      for (const e of [...document.querySelectorAll('iframe, object, embed')] as any[]) e.setAttribute('data-difai-had', String(e.getAttribute('src') ?? e.getAttribute('data') ?? ''));
    });
    const popup = page.context().waitForEvent('page', { timeout: 25_000 }).catch(() => null);
    const download = page.waitForEvent('download', { timeout: 25_000 }).catch(() => null);
    const framed = page.waitForFunction(() => {
      const e = ([...document.querySelectorAll('iframe, object, embed')] as any[]).find((x) => {
        const u = String(x.getAttribute('src') ?? x.getAttribute('data') ?? '');
        return u && u !== 'about:blank' && u !== x.getAttribute('data-difai-had');
      });
      return e ? String(e.getAttribute('src') ?? e.getAttribute('data')) : false;
    }, undefined, { timeout: 25_000, polling: 250 }).then((h) => h.jsonValue() as Promise<string>).catch(() => null);
    await step(page, false, async () => {
      await page.evaluate((x) => {
        const el = document.querySelector(`[data-difai-app-ref="${x}"]`) as any;
        el?.removeAttribute('target');
        el?.click();
      }, ref);
    });
    const got = await Promise.race([
      framed.then((u) => (u ? { url: u } : null)),
      popup.then(async (p) => {
        if (!p) return null;
        await p.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});
        const u = p.url();
        await p.close().catch(() => {});
        return u && u !== 'about:blank' ? { url: u } : null;
      }),
      download.then((d) => (d ? { download: d } : null)),
      new Promise<null>((r) => setTimeout(() => r(null), 26_000)),
    ]);
    try {
      if (!got) throw new EcourtsHttpError(502, 'The portal did not open the document. It may be slow - try again.');
      const name = `${(t.text || 'application').replace(/[^\w .()-]+/g, '_').slice(0, 60) || 'application'}.pdf`;
      if ('download' in got && got.download) {
        const path = await got.download.path();
        if (!path) throw new EcourtsHttpError(502, 'The portal download did not finish.');
        const { readFile } = await import('node:fs/promises');
        return { name: got.download.suggestedFilename() || name, contentType: 'application/pdf', body: await readFile(path) };
      }
      let url = (got as { url: string }).url;
      const viewer = /[?&]file=([^&#]+)/.exec(url);
      if (/viewer\.html/i.test(url) && viewer) url = decodeURIComponent(viewer[1]!);
      if (url.startsWith('data:')) {
        const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
        if (!m) throw new EcourtsHttpError(502, 'The portal sent a document DifAi could not read.');
        return { name, contentType: m[1] || 'application/pdf', body: m[2] ? Buffer.from(m[3]!, 'base64') : Buffer.from(decodeURIComponent(m[3]!)) };
      }
      const abs = url.startsWith('blob:') ? url : new URL(url, page.url()).toString();
      if (!abs.startsWith('blob:') && new URL(abs).hostname !== new URL(page.url()).hostname) {
        throw new EcourtsHttpError(502, 'The portal pointed the document somewhere else; DifAi did not follow it.');
      }
      const file = await page.evaluate(async (u) => {
        const r = await fetch(u, { credentials: 'include' });
        const buf = new Uint8Array(await r.arrayBuffer());
        let s = '';
        for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        return { status: r.status, type: r.headers.get('content-type') ?? '', b64: btoa(s) };
      }, abs);
      if (file.status >= 400) throw new EcourtsHttpError(502, `The portal answered ${file.status} for this document.`);
      return { name, contentType: file.type.split(';')[0] || 'application/pdf', body: Buffer.from(file.b64, 'base64') };
    } finally {
      // Close the portal's viewer again, as the advocate would.
      await page.evaluate(() => {
        const $ = (globalThis as any).jQuery;
        for (const id of ['vw_app_modal', 'vw_doc_app_list_modal']) {
          const m = document.getElementById(id) as any;
          if (!m) continue;
          if ($?.fn?.modal) $(m).modal('hide'); else m.style.display = 'none';
        }
        for (const e of [...document.querySelectorAll('[data-difai-had]')] as any[]) e.removeAttribute('data-difai-had');
      }).catch(() => {});
    }
  });
}

export const __testing = { readScreen, park, unpark };
