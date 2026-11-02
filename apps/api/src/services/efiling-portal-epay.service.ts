import type { Page, Request as PwRequest, Route } from 'playwright';
import { EcourtsHttpError } from '../lib/ecourts';
import { htmlTable, onLoginForm, openPortalMenu, withPortalPage, type PortalTableData } from './efiling-live.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- DOM global, no dom lib in this tsconfig
declare const document: any;

// =============================================================================
// efiling-portal-epay.service
//
// The portal's ePayments menu, driven live over the advocate's own logged-in
// eFiling session (filing.ecourts.gov.in/pdedev), exactly as the portal's
// public epay.js does it (docs/efiling-portal-reverse-engineering.md §5):
//
//   Payment          form #frm: case source radios (name=cases: 1 search
//                    keyword #txt_case_search, 2 registered case
//                    #selComponentDistrict/#selComponentEst/#case_type/
//                    #case_no/#case_year, 3 e-filed #sel_pde_no), payment type
//                    radios (name=epayOptions: court fee / JD / penalty / F /
//                    O with #judicial_type, #scheme_code, #sub_payment_type),
//                    #payee or #extraparty, #mobile, #amount (+ Kerala heads
//                    #Amount_lbf/#Amount_awf/#Amount_acwf), #Remark.
//                    "I agree" (#i_agree -> #div_mobile) -> OnClickOTP() ->
//                    epay/generate_otp -> #div_otp, #user_otp1 -> verify_otp()
//                    -> epay/verify_otp_new, whose reply HTML (result.data) is
//                    the hand-off to the payment gateway, put in #div_redirect.
//   Transactions     viewDetails() -> epay/DoubleVerificationDetails ->
//                    #divTransList; per row getGRNGras / getCINGras /
//                    viewDetailsDouble / getPrevChallanGras / getChallanData.
//   Court Fee Wallet the menu page itself (no public JS: read as shown) and
//                    the wallet spend the public JS does have: Applications >
//                    Pay Fees (getSubmittedCasesPayFees -> #tr_submitted_epay_
//                    cases, #rem_bal_<est>, .chkEstApp, payCourtFees()).
//
// Every field is set on the portal's own form and every button is the
// portal's own (its handlers and requests run unchanged). DifAi never pays:
// the gateway step is captured, not followed, and handed to the advocate's
// browser; anything that commits a payment request needs confirmed: true.
// =============================================================================

// ---- shapes -----------------------------------------------------------------

export interface EpayOption { value: string; text: string; disabled?: boolean }
export interface EpayChoice { value: string; label: string; id: string; checked: boolean; disabled: boolean }

/** One control of the portal's form, in the portal's own order and words. */
export interface EpayField {
  /** id, or the name for a radio group (cases / epayOptions). */
  key: string;
  id: string;
  name: string;
  tag: 'input' | 'select' | 'textarea' | 'radio';
  type: string;
  label: string;
  value: string;
  required: boolean;
  disabled: boolean;
  readOnly: boolean;
  placeholder: string;
  maxLength: number | null;
  options?: EpayOption[];
  choices?: EpayChoice[];
}

export type EpayButtonKind = 'otp' | 'verify' | 'transactions' | 'other';
export interface EpayButton { label: string; id: string; kind: EpayButtonKind; disabled: boolean }

/** What the portal produced for the payment gateway (never followed by DifAi). */
export interface EpayGateway {
  method: 'GET' | 'POST';
  url: string;
  target: string;
  fields: Array<{ name: string; value: string }>;
}

export interface EpayFormView {
  title: string;
  fields: EpayField[];
  /** #displayCaseNocase: the case the portal found. */
  caseDetails: string;
  /** Amount in words the portal writes next to each amount (#curancy_id ...). */
  amountWords: Record<string, string>;
  /** #errSpan1: the portal's amount check (epay/chk_amount). */
  amountError: string;
  /**
   * "I agree" (#i_agree) and its words, when the page has it; title / text:
   * the portal's Terms and Conditions box above it, when the page shows one.
   */
  terms: { label: string; checked: boolean; title?: string; text?: string } | null;
  otp: { shown: boolean; label: string; message: string; buttons: EpayButton[] };
  buttons: EpayButton[];
  /** What verify_otp_new put in #div_redirect, read as a form or link. */
  redirect: { text: string; gateway: EpayGateway | null } | null;
  /** The portal's alerts / messages during this step. */
  messages: string[];
}

export interface EpayProceedResult {
  form: EpayFormView;
  /** The gateway page the portal tried to open, for the advocate's browser. */
  gateway: EpayGateway | null;
  messages: string[];
}

export interface EpayTxnAction { label: string; fn: string }
export type EpayTxnRow = { group: string } | { ref: string; cells: string[]; actions: EpayTxnAction[] };
export interface EpayTxnTable { headers: string[]; rows: EpayTxnRow[] }
export interface EpayTransactions {
  tables: EpayTxnTable[];
  text: string;
  messages: string[];
  /** The portal window's own title ("Transaction List"), when it has one. */
  title?: string;
}

export interface EpayOpened { url: string; file: { name: string; contentType: string; base64: string } | null }
export interface EpayTxnActionResult { transactions: EpayTransactions; opened: EpayOpened[]; messages: string[] }

export interface WalletCheck { id: string; checked: boolean; disabled: boolean }
export type WalletRow = { group: string; check?: WalletCheck } | { cells: string[]; check?: WalletCheck };
export interface WalletTable { headers: string[]; rows: WalletRow[] }
export interface EpayPayFees {
  tables: WalletTable[];
  /** Per establishment: wallet balance left (#rem_bal_<est>) and selected sub-total. */
  balances: Array<{ est: string; label: string; balance: string; subTotal: string }>;
  pages: Array<{ label: string; page: number; current: boolean }>;
  info: string;
  search: string;
  payButton: { label: string; disabled: boolean } | null;
  refreshButton: string | null;
  text: string;
}
export interface EpayWalletView {
  /** The portal's Court Fee Wallet menu page, read as shown (null: not in the menu). */
  page: { title: string; headings: string[]; tables: PortalTableData[]; text: string } | null;
  payFees: EpayPayFees | null;
  messages: string[];
}
export interface EpayWalletPayResult { paid: boolean; messages: string[]; wallet: EpayWalletView }

// Row buttons of the transaction list DifAi may press: status reads only.
const TXN_FNS = ['getGRNGras', 'getCINGras', 'viewDetailsDouble', 'getPrevChallanGras', 'getChallanData'] as const;
// Handled by their own steps, not by the field setter.
const OWN_STEP_IDS = ['user_otp1', 'user_otp2', 'user_otp', 'i_agree'];

// ---- in-page helpers (installed on the portal page per step) -----------------

async function install(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = globalThis as any;
    if (w.__dfe) return;
    const txt = (e: any) => String(e?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const clean = (s: string) => s.replace(/\*/g, '').replace(/\s+/g, ' ').replace(/\s*:\s*$/, '').trim();
    // Shown on screen. A select replaced by chosen counts as shown when its widget is.
    const shown = (e: any): boolean => {
      if (!e) return false;
      if (e.getClientRects().length > 0) return true;
      if (e.tagName === 'SELECT' && e.id) {
        const c = document.getElementById(`${e.id}_chosen`);
        return !!c && c.getClientRects().length > 0;
      }
      return false;
    };
    const hiddenIn = (e: any, root: any) => {
      for (let p = e; p && p !== root; p = p.parentElement) {
        const s = String(p.getAttribute?.('style') ?? '').replace(/\s+/g, '').toLowerCase();
        if (s.includes('display:none') || p.hidden) return true;
      }
      return false;
    };
    const labelOf = (el: any): string => {
      if (el.id) {
        const l = document.querySelector(`label[for="${String(el.id).replace(/"/g, '\\"')}"]`);
        if (l && txt(l)) return clean(txt(l));
      }
      const wrap = el.closest('label');
      if (wrap && txt(wrap)) return clean(txt(wrap));
      const td = el.closest('td');
      if (td?.previousElementSibling && txt(td.previousElementSibling)) return clean(txt(td.previousElementSibling));
      const grp = el.closest('.form-group, [class*="col-"], .row');
      const l = grp?.querySelector('label');
      if (l && !l.contains(el) && !l.querySelector('input') && txt(l)) return clean(txt(l));
      let p: any = el;
      for (let i = 0; i < 3 && p; i++, p = p.parentElement) {
        const prev = p.previousElementSibling;
        if (prev && txt(prev) && txt(prev).length < 80 && !prev.querySelector('input, select, textarea')) return clean(txt(prev));
      }
      return clean(String(el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.title || ''));
    };
    const starred = (el: any): boolean => {
      if (el.required) return true;
      const l = el.id ? document.querySelector(`label[for="${String(el.id).replace(/"/g, '\\"')}"]`) : null;
      return !!l && /\*/.test(String(l.textContent ?? ''));
    };
    // A cell's visible lines (case no / CNR / amounts ...), as the portal shows them.
    const lines = (cell: any): string => {
      const k = cell.cloneNode(true);
      for (const e of [...k.querySelectorAll('script, style, .modal, [style*="display:none"], [style*="display: none"]')]) e.remove();
      for (const e of [...k.querySelectorAll('input[type=checkbox], input[type=radio]')]) e.remove();
      for (const br of [...k.querySelectorAll('br')]) br.replaceWith('\n');
      for (const b of [...k.querySelectorAll('div, p, li, tr')]) b.append('\n');
      return String(k.textContent ?? '').split('\n').map((x: string) => x.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
    };
    const fnOf = (e: any): string => {
      const s = String(e.getAttribute('onclick') ?? '') || String(e.getAttribute('href') ?? '').replace(/^javascript:/i, '');
      const m = /(?:^|[\s;(])(?:return\s+)?([A-Za-z_$][\w$]*)\s*\(/.exec(s);
      return m ? m[1]! : '';
    };
    const buttonKind = (b: any): string => {
      const on = `${b.getAttribute('onclick') ?? ''} ${b.getAttribute('href') ?? ''}`;
      if (/OnClickOTP|generate_otp/.test(on) || /^button_mobile/.test(b.id ?? '')) return 'otp';
      if (/verify_otp/.test(on)) return 'verify';
      if (/viewDetails\s*\(/.test(on)) return 'transactions';
      return 'other';
    };
    const label = (b: any) => (txt(b) || String(b.value ?? '').trim() || String(b.title ?? '').trim()).slice(0, 80);
    w.__dfe = { txt, clean, shown, hiddenIn, labelOf, starred, lines, fnOf, buttonKind, label };
  });
}

/** Everything the portal says during a step: alert()/confirm(), errorAlert, successAlert. */
async function listen(page: Page, opts: { acceptConfirm?: boolean } = {}): Promise<() => Promise<string[]>> {
  const dialogs: string[] = [];
  const onDialog = (d: { message: () => string; type: () => string; accept: () => Promise<void>; dismiss: () => Promise<void> }) => {
    dialogs.push(d.message());
    // A confirm() is accepted only on a step the advocate confirmed in DifAi.
    void (d.type() === 'confirm' && !opts.acceptConfirm ? d.dismiss() : d.accept()).catch(() => {});
  };
  page.on('dialog', onDialog);
  await page.evaluate(() => {
    const w = globalThis as any;
    w.__dfeMsgs = [];
    for (const fn of ['errorAlert', 'successAlert']) {
      const orig = w[fn];
      if (typeof orig === 'function' && !orig.__dfe) {
        const wrapped = function (this: unknown, msg: unknown) {
          w.__dfeMsgs.push(String(msg ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
          return orig.apply(this, arguments as any);
        };
        (wrapped as any).__dfe = true;
        w[fn] = wrapped;
      }
    }
  }).catch(() => {});
  return async () => {
    page.off('dialog', onDialog);
    const fromPage = (await page.evaluate(() => (globalThis as any).__dfeMsgs ?? []).catch(() => [])) as string[];
    return [...new Set([...fromPage, ...dialogs].map((m) => m.replace(/\s+/g, ' ').trim()).filter(Boolean))];
  };
}

/** Wait until the portal's own ajax (ajaxCall: 50 ms delay, then a sync XHR) has finished. */
function trackPortal(page: Page) {
  let host = '';
  try { host = new URL(page.url()).host; } catch { /* about:blank */ }
  let pending = 0;
  let last = Date.now();
  const mine = (r: PwRequest) => {
    try { return new URL(r.url()).host === host && ['xhr', 'fetch'].includes(r.resourceType()); } catch { return false; }
  };
  const on = (r: PwRequest) => { if (mine(r)) { pending += 1; last = Date.now(); } };
  const off = (r: PwRequest) => { if (mine(r)) { pending = Math.max(0, pending - 1); last = Date.now(); } };
  page.on('request', on);
  page.on('requestfinished', off);
  page.on('requestfailed', off);
  return {
    async quiet(maxMs = 20_000): Promise<void> {
      const t0 = Date.now();
      await page.waitForTimeout(250);
      while (Date.now() - t0 < maxMs) {
        if (pending === 0 && Date.now() - last > 450) return;
        await page.waitForTimeout(100);
      }
    },
    stop(): void {
      page.off('request', on);
      page.off('requestfinished', off);
      page.off('requestfailed', off);
    },
  };
}

async function signedOut(page: Page): Promise<void> {
  if (await onLoginForm(page)) {
    throw new EcourtsHttpError(410, 'The eFiling portal has signed this session out (the same account was probably opened in another browser). Log in again.');
  }
}

// ---- Payment page --------------------------------------------------------------

const onEpayPage = (page: Page) => page.evaluate(() =>
  typeof (globalThis as any).verify_otp === 'function' && !!document.querySelector('input[name=epayOptions]'),
).catch(() => false);

/**
 * Open ePayments > Payment from the portal's own menu (fresh = reload it).
 * Falls back to the epay controller's page when the menu link isn't found.
 */
async function ensureEpayPage(page: Page, fresh: boolean): Promise<void> {
  if (!fresh && await onEpayPage(page)) return;
  const t = trackPortal(page);
  try {
    let opened = false;
    for (const re of [/^\s*payments?\s*$/i, /^\s*e-?payments?\s*$/i, /^\s*(pay\s+)?court\s*fees?(\s+payment)?\s*$/i]) {
      if (await openPortalMenu(page, re).catch(() => false)) { opened = true; break; }
    }
    await signedOut(page);
    if (!opened || !(await onEpayPage(page))) {
      const base = await page.evaluate(() => String((document.getElementById('base_url') as any)?.value ?? '')).catch(() => '');
      const origin = (() => { try { return new URL(page.url()).origin; } catch { return 'https://filing.ecourts.gov.in'; } })();
      await page.goto(`${(base || `${origin}/pdedev`).replace(/\/$/, '')}/?p=epay`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
      await signedOut(page);
    }
    if (!(await page.waitForFunction(() => !!document.querySelector('input[name=epayOptions]'), undefined, { timeout: 15_000 }).then(() => true).catch(() => false))) {
      throw new EcourtsHttpError(502, "Couldn't open ePayments > Payment on your portal. Try again.");
    }
    // The page's own on-ready request (epay/get_payment_type) shows the payment types.
    await t.quiet();
  } finally {
    t.stop();
  }
}

async function readForm(page: Page, messages: string[] = []): Promise<EpayFormView> {
  await install(page);
  const raw = await page.evaluate((ownIds: string[]) => {
    const h = (globalThis as any).__dfe;
    const root = document.getElementById('frm') ?? document.querySelector('input[name=epayOptions]')?.closest('form') ?? document.body;
    const content = document.querySelector('.content-wrapper, main, #content, .container-fluid, .container') ?? document.body;
    const outside = (e: any) => !e.closest('nav, header, footer, .navbar, .modal, table, form, #frm');
    const heading = ([...content.querySelectorAll('h1, h2, h3, h4, legend, .card-header, .box-title')] as any[]).find((e) => h.shown(e) && h.txt(e) && h.txt(e).length < 80)
      ?? ([...document.querySelectorAll('h1, h2, h3, h4, h5, legend, .card-header, .box-title, .page-title, .card-title')] as any[]).find((e) => h.shown(e) && outside(e) && h.txt(e) && h.txt(e).length < 80);
    const fields: any[] = [];
    const radioGroups = new Map<string, any>();
    for (const el of [...root.querySelectorAll('input, select, textarea')] as any[]) {
      const type = String(el.getAttribute('type') ?? (el.tagName === 'SELECT' ? 'select' : 'text')).toLowerCase();
      if (['hidden', 'button', 'submit', 'reset', 'file', 'image'].includes(type)) continue;
      if (ownIds.includes(el.id)) continue;
      if (type === 'radio') {
        if (!el.name) continue;
        let g = radioGroups.get(el.name);
        if (!g) {
          // The group's own label: text before the first radio's block.
          let groupLabel = '';
          let p: any = el.closest('label') ?? el;
          for (let i = 0; i < 5 && p && !groupLabel; i++, p = p.parentElement) {
            const prev = p.previousElementSibling;
            if (prev && h.txt(prev) && h.txt(prev).length < 80 && !prev.querySelector('input')) groupLabel = h.clean(h.txt(prev));
          }
          g = { key: el.name, id: '', name: el.name, tag: 'radio', type: 'radio', label: groupLabel, value: '', required: false, disabled: false, readOnly: false, placeholder: '', maxLength: null, choices: [] };
          radioGroups.set(el.name, g);
          fields.push(g);
        }
        if (!h.shown(el) && !h.shown(el.closest('label'))) continue;
        const own = (el.id && document.querySelector(`label[for="${el.id}"]`)) || el.closest('label');
        const lbl = h.clean(own ? h.txt(own) : h.txt(el.nextSibling) || String(el.value));
        g.choices.push({ value: String(el.value), label: lbl, id: el.id ?? '', checked: !!el.checked, disabled: !!el.disabled });
        if (el.checked) g.value = String(el.value);
        continue;
      }
      if (!h.shown(el)) continue;
      fields.push({
        key: el.id || el.name, id: el.id ?? '', name: el.getAttribute('name') ?? '',
        tag: el.tagName.toLowerCase(), type, label: h.labelOf(el), value: type === 'checkbox' ? (el.checked ? 'Y' : 'N') : String(el.value ?? ''),
        required: h.starred(el), disabled: !!el.disabled, readOnly: !!el.readOnly,
        placeholder: String(el.getAttribute('placeholder') ?? ''), maxLength: el.maxLength > 0 ? el.maxLength : null,
        ...(el.tagName === 'SELECT' ? { options: ([...el.options] as any[]).map((o) => ({ value: String(o.value), text: h.txt(o), ...(o.disabled ? { disabled: true } : {}) })) } : {}),
      });
    }
    const visibleText = (id: string) => { const e = document.getElementById(id); return e && h.shown(e) ? h.txt(e) : ''; };
    const amountWords: Record<string, string> = {};
    for (const [field, span] of [['amount', 'curancy_id'], ['Amount_lbf', 'curancy_id_2'], ['Amount_awf', 'curancy_id_3'], ['Amount_acwf', 'curancy_id_4']]) {
      const t = h.txt(document.getElementById(span!));
      if (t) amountWords[field!] = t;
    }
    const agree = document.getElementById('i_agree');
    // The Terms and Conditions box the portal shows above "I agree": the
    // smallest shown block whose text starts with its title.
    let termsBox: any = null;
    if (agree) {
      for (const e of [...document.querySelectorAll('div, p, fieldset, section, textarea, span')] as any[]) {
        if (!h.shown(e) || e.contains(agree) || e.closest('nav, .navbar, .modal')) continue;
        const t = e.tagName === 'TEXTAREA' ? String(e.value ?? '') : h.txt(e);
        if (!/^terms\s*(and|&)\s*conditions\b/i.test(t) || t.length < 120) continue;
        if (!termsBox || termsBox.contains(e)) termsBox = e;
      }
    }
    const termsRaw = termsBox ? (termsBox.tagName === 'TEXTAREA' ? String(termsBox.value ?? '') : String(termsBox.innerText ?? h.txt(termsBox))) : '';
    const termsTitle = /^\s*(terms\s*(and|&)\s*conditions)\s*:?/i.exec(termsRaw)?.[1] ?? '';
    const termsText = termsRaw.slice(termsRaw.toLowerCase().indexOf(termsTitle.toLowerCase()) + termsTitle.length)
      .replace(/^\s*:?\s*/, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 6000);
    const terms = agree
      ? { label: h.labelOf(agree), checked: !!agree.checked, ...(termsText ? { title: termsTitle.replace(/\s+/g, ' '), text: termsText } : {}) }
      : null;
    const btnInfo = (b: any) => ({ label: h.label(b), id: b.id ?? '', kind: h.buttonKind(b), disabled: !!b.disabled });
    const allButtons = ([...document.querySelectorAll('button, input[type=button], input[type=submit], a.btn, a[onclick]')] as any[]).filter((b) => h.shown(b));
    const otpBox = document.getElementById('div_otp');
    const mobBox = document.getElementById('div_mobile');
    const otpButtons = allButtons.filter((b) => (otpBox?.contains(b) || mobBox?.contains(b)) && h.buttonKind(b) !== 'other').map(btnInfo);
    const buttons = allButtons.filter((b) => !(otpBox?.contains(b) || mobBox?.contains(b)) && (root.contains(b) || h.buttonKind(b) !== 'other') && !b.closest('.modal')).map(btnInfo);
    const otpInput = document.getElementById('user_otp1');
    const redirectEl = document.getElementById('div_redirect');
    let redirect: any = null;
    if (redirectEl && String(redirectEl.innerHTML ?? '').trim()) {
      const f = redirectEl.querySelector('form');
      const a = ([...redirectEl.querySelectorAll('a[href]')] as any[]).find((x) => !/^(#|javascript:)/i.test(x.getAttribute('href') ?? '#'));
      const gateway = f
        ? {
          method: String(f.getAttribute('method') ?? 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET',
          url: String(f.action || ''), target: String(f.getAttribute('target') ?? ''),
          fields: ([...f.elements] as any[]).filter((e) => e.name && !['button', 'submit', 'reset', 'file'].includes(String(e.type))).map((e) => ({ name: String(e.name), value: String(e.value ?? '') })),
        }
        : a ? { method: 'GET', url: String(a.href), target: String(a.getAttribute('target') ?? ''), fields: [] } : null;
      redirect = { text: String(redirectEl.innerText ?? h.txt(redirectEl)).replace(/[ \t]+/g, ' ').trim().slice(0, 800), gateway };
    }
    const otpMsg = ['msg-danger3', 'msg-success3', 'msg-danger5', 'msg-success5'].map(visibleText).filter(Boolean).join(' ');
    return {
      title: heading ? h.txt(heading) : String(document.title ?? ''),
      fields: fields.filter((f) => f.tag !== 'radio' || f.choices.length),
      caseDetails: h.txt(document.getElementById('displayCaseNocase')),
      amountWords,
      amountError: visibleText('errSpan1'),
      terms,
      otp: { shown: !!(otpBox && h.shown(otpBox) && otpInput && h.shown(otpInput)), label: otpInput ? h.labelOf(otpInput) : '', message: otpMsg, buttons: otpButtons },
      buttons,
      redirect,
    };
  }, OWN_STEP_IDS);
  return { ...(raw as Omit<EpayFormView, 'messages'>), messages };
}

/** Set one control the way the advocate would; the portal's own handlers run. */
async function applyField(page: Page, key: string, value: string): Promise<'ok' | 'missing' | 'option' | 'disabled'> {
  return page.evaluate(({ key, value, ownIds }) => {
    const h = (globalThis as any).__dfe;
    const root = document.getElementById('frm') ?? document.querySelector('input[name=epayOptions]')?.closest('form') ?? document.body;
    const $ = (globalThis as any).jQuery;
    const fire = (el: any, type: string) => el.dispatchEvent(new (globalThis as any).Event(type, { bubbles: true }));
    const radios = ([...root.querySelectorAll('input[type=radio]')] as any[]).filter((r) => r.name === key);
    if (radios.length) {
      const r = radios.find((x) => String(x.value) === value);
      if (!r) return 'option';
      if (r.disabled || (!h.shown(r) && !h.shown(r.closest('label')))) return 'disabled';
      // A click, as the advocate's: the portal's click handlers (#eFiled,
      // #search, #regis reset the form) and onclick/onchange run.
      r.click();
      return 'ok';
    }
    // "I agree" (#i_agree) may sit outside #frm; ticking it shows the OTP buttons (funTermsAccepted).
    const el = key === 'i_agree'
      ? document.getElementById('i_agree')
      : ([...root.querySelectorAll('input, select, textarea')] as any[]).find((e) => e.id === key) ?? ([...root.querySelectorAll('input, select, textarea')] as any[]).find((e) => e.name === key);
    if (!el || (key !== 'i_agree' && ownIds.includes(el.id)) || ['hidden', 'button', 'submit', 'file'].includes(String(el.type))) return 'missing';
    if (el.disabled || el.readOnly || !h.shown(el)) return 'disabled';
    if (el.type === 'checkbox') {
      const on = value === 'Y' || value === 'true' || value === '1';
      if (el.checked !== on) el.click();
      return 'ok';
    }
    if (el.tagName === 'SELECT') {
      const opt = ([...el.options] as any[]).find((o) => String(o.value) === value);
      if (!opt || opt.disabled) return 'option';
      el.value = opt.value;
      fire(el, 'change');
      if ($) $(el).trigger('chosen:updated');
      return 'ok';
    }
    // Typed and left, as the advocate would: input (amount in words), change,
    // then one blur (the portal checks the amount on leaving the field).
    el.focus?.();
    const focused = document.activeElement === el;
    el.value = value;
    fire(el, 'input');
    fire(el, 'keyup');
    fire(el, 'change');
    if (focused) el.blur();
    else fire(el, 'blur');
    return 'ok';
  }, { key, value, ownIds: OWN_STEP_IDS });
}

/** Open (or re-open with fresh = true) ePayments > Payment and read its form. */
export async function openEpayForm(sessionId: string, userId: string, fresh = true): Promise<EpayFormView> {
  return withPortalPage(sessionId, userId, async (page) => {
    const done = await listen(page);
    await ensureEpayPage(page, fresh);
    return readForm(page, await done());
  });
}

/**
 * Fill the form, one control at a time in the order given (as the advocate
 * would: case source -> e-filing number / case -> payment type -> payee ->
 * mobile -> amount ...), waiting for each portal request it starts.
 */
export async function setEpayFields(sessionId: string, userId: string, fields: Array<{ key: string; value: string }>): Promise<EpayFormView> {
  return withPortalPage(sessionId, userId, async (page) => {
    if (!(await onEpayPage(page))) throw new EcourtsHttpError(409, 'The Payment form on the portal was closed by another step. Open Payment again.');
    await install(page);
    const done = await listen(page);
    const t = trackPortal(page);
    const problems: string[] = [];
    try {
      for (const f of fields) {
        const r = await applyField(page, f.key, f.value);
        if (r === 'missing') problems.push(`The portal's form has no "${f.key}" field now.`);
        else if (r === 'option') problems.push(`"${f.value}" is not a choice for "${f.key}" on the portal now.`);
        else if (r === 'disabled') problems.push(`The portal does not let you change "${f.key}" now.`);
        await t.quiet();
      }
    } finally {
      t.stop();
    }
    await signedOut(page);
    return readForm(page, [...problems, ...(await done())]);
  });
}

/**
 * "I agree" + Send OTP: the portal's own button (OnClickOTP -> epay/
 * generate_otp) sends the OTP to the mobile in the form. Nothing is paid.
 */
export async function sendEpayOtp(sessionId: string, userId: string, agreed: boolean): Promise<EpayFormView> {
  if (!agreed) throw new EcourtsHttpError(400, 'Tick "I agree" first, as on the portal.');
  return withPortalPage(sessionId, userId, async (page) => {
    if (!(await onEpayPage(page))) throw new EcourtsHttpError(409, 'The Payment form on the portal was closed by another step. Open Payment again.');
    await install(page);
    const done = await listen(page);
    const t = trackPortal(page);
    try {
      await page.evaluate(() => {
        const agree = document.getElementById('i_agree');
        if (agree && !agree.checked) agree.click();
      });
      await page.waitForTimeout(200);
      const clicked = await page.evaluate(() => {
        const h = (globalThis as any).__dfe;
        const box = document.getElementById('div_mobile') ?? document;
        const b = ([...box.querySelectorAll('button, input[type=button], a')] as any[]).find((x) => h.shown(x) && !x.disabled && h.buttonKind(x) === 'otp');
        if (b) { b.click(); return true; }
        const w = globalThis as any;
        if (typeof w.OnClickOTP === 'function') { w.OnClickOTP('button_mobile'); return true; }
        return false;
      });
      if (!clicked) throw new EcourtsHttpError(409, 'The portal shows no Send OTP button now - check the mobile number and "I agree".');
      await t.quiet();
    } finally {
      t.stop();
    }
    await signedOut(page);
    return readForm(page, await done());
  });
}

/**
 * Hold the gateway: whatever the portal's reply tries to open (an
 * auto-submitting form, a redirect, a new tab) is recorded, not followed.
 */
async function holdGateway(page: Page) {
  const caught: EpayGateway[] = [];
  let portalOrigin = '';
  try { portalOrigin = new URL(page.url()).origin; } catch { /* blank */ }
  await page.evaluate(() => {
    const w = globalThis as any;
    w.__dfeGate = [];
    const formInfo = (f: any) => ({
      method: String(f.getAttribute('method') ?? 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET',
      url: String(f.action || ''), target: String(f.getAttribute('target') ?? ''),
      fields: ([...f.elements] as any[]).filter((e) => e.name && !['button', 'submit', 'reset', 'file'].includes(String(e.type))).map((e) => ({ name: String(e.name), value: String(e.value ?? '') })),
    });
    const P = w.HTMLFormElement.prototype;
    w.__dfeOrig = { submit: P.submit, requestSubmit: P.requestSubmit, open: w.open };
    P.submit = function (this: any) { w.__dfeGate.push(formInfo(this)); };
    P.requestSubmit = function (this: any) { w.__dfeGate.push(formInfo(this)); };
    w.open = (url: unknown) => { w.__dfeGate.push({ method: 'GET', url: String(new w.URL(String(url ?? ''), document.baseURI)), target: '_blank', fields: [] }); return null; };
    w.__dfeOnSubmit = (e: any) => { w.__dfeGate.push(formInfo(e.target)); e.preventDefault(); };
    w.__dfeOnClick = (e: any) => {
      const a = e.target?.closest?.('a[target=_blank]');
      if (a && a.href && !/^javascript:/i.test(a.href)) { w.__dfeGate.push({ method: 'GET', url: String(a.href), target: '_blank', fields: [] }); e.preventDefault(); }
    };
    w.addEventListener('submit', w.__dfeOnSubmit, true);
    document.addEventListener('click', w.__dfeOnClick, true);
  });
  // A navigation away from the portal (location.href = gateway ...): recorded and stopped.
  const offPortal = (url: URL) => url.origin !== portalOrigin;
  const handler = async (route: Route) => {
    const req = route.request();
    if (!req.isNavigationRequest()) return route.fallback();
    const body = req.postData() ?? '';
    caught.push({
      method: req.method() === 'POST' ? 'POST' : 'GET', url: req.url(), target: '',
      fields: req.method() === 'POST' ? [...new URLSearchParams(body)].map(([name, value]) => ({ name, value })) : [],
    });
    return route.abort('aborted');
  };
  await page.route(offPortal, handler);
  const onPopup = (p: Page) => {
    caught.push({ method: 'GET', url: p.url(), target: '_blank', fields: [] });
    void p.close().catch(() => {});
  };
  page.context().on('page', onPopup);
  return {
    async release(): Promise<EpayGateway[]> {
      page.context().off('page', onPopup);
      await page.unroute(offPortal, handler).catch(() => {});
      const inPage = (await page.evaluate(() => {
        const w = globalThis as any;
        const got = w.__dfeGate ?? [];
        if (w.__dfeOrig) {
          w.HTMLFormElement.prototype.submit = w.__dfeOrig.submit;
          w.HTMLFormElement.prototype.requestSubmit = w.__dfeOrig.requestSubmit;
          w.open = w.__dfeOrig.open;
          w.removeEventListener('submit', w.__dfeOnSubmit, true);
          document.removeEventListener('click', w.__dfeOnClick, true);
          w.__dfeOrig = null;
        }
        return got;
      }).catch(() => [])) as EpayGateway[];
      return [...inPage, ...caught].filter((g) => g.url && !/^about:/i.test(g.url));
    },
  };
}

/**
 * Verify the OTP with the portal's own button (verify_otp -> epay/
 * verify_otp_new). This makes the portal create the payment request and
 * produce the gateway hand-off - so it needs the advocate's confirmation.
 * The gateway itself is NOT opened here: it is returned for the advocate's
 * own browser, where the advocate pays.
 */
export async function proceedToGateway(sessionId: string, userId: string, otp: string, confirmed: boolean): Promise<EpayProceedResult> {
  if (confirmed !== true) throw new EcourtsHttpError(400, 'Confirm the payment details first - DifAi never pays on its own.');
  return withPortalPage(sessionId, userId, async (page) => {
    if (!(await onEpayPage(page)) || !(await page.$('#user_otp1'))) {
      throw new EcourtsHttpError(409, 'The Payment form on the portal was closed by another step. Open Payment again and send a fresh OTP.');
    }
    await install(page);
    // The portal's own confirm() (amount of Rs 1,00,000 or more) is accepted:
    // the advocate confirmed this amount in DifAi.
    const done = await listen(page, { acceptConfirm: true });
    const gate = await holdGateway(page);
    const t = trackPortal(page);
    let held: EpayGateway[] = [];
    try {
      await page.evaluate((code: string) => {
        const el = document.getElementById('user_otp1');
        el.value = code;
        el.dispatchEvent(new (globalThis as any).Event('input', { bubbles: true }));
        el.dispatchEvent(new (globalThis as any).Event('change', { bubbles: true }));
      }, otp);
      const clicked = await page.evaluate(() => {
        const h = (globalThis as any).__dfe;
        const b = ([...document.querySelectorAll('button, input[type=button], input[type=submit], a')] as any[]).find((x) => h.shown(x) && !x.disabled && h.buttonKind(x) === 'verify');
        if (b) { b.click(); return true; }
        const w = globalThis as any;
        if (typeof w.verify_otp === 'function') { w.verify_otp(); return true; }
        return false;
      });
      if (!clicked) throw new EcourtsHttpError(409, 'The portal shows no button to verify the OTP now.');
      await t.quiet(40_000);
      // The reply's HTML lands in #div_redirect (jQuery runs its scripts).
      await page.waitForFunction(() => String(document.getElementById('div_redirect')?.innerHTML ?? '').trim().length > 0 || ((globalThis as any).__dfeGate ?? []).length > 0 || ((globalThis as any).__dfeMsgs ?? []).length > 0, undefined, { timeout: 8_000 }).catch(() => {});
      await page.waitForTimeout(500);
    } finally {
      t.stop();
      held = await gate.release();
    }
    const messages = await done();
    await signedOut(page);
    const form = await readForm(page, messages);
    const gateway = held[0] ?? form.redirect?.gateway ?? null;
    return { form, gateway, messages };
  });
}

// ---- Transactions (viewDetails) -------------------------------------------------

async function openTransactionList(page: Page): Promise<void> {
  const has = await page.evaluate(() => !!document.querySelector('#divTransList table')).catch(() => false);
  if (!has) {
    await ensureEpayPage(page, false);
    const t = trackPortal(page);
    try {
      const ok = await page.evaluate(() => {
        const h = (globalThis as any).__dfe;
        const b = ([...document.querySelectorAll('button, input[type=button], a')] as any[]).find((x) => h.shown(x) && h.buttonKind(x) === 'transactions');
        if (b) { b.click(); return true; }
        const w = globalThis as any;
        if (typeof w.viewDetails === 'function') { w.viewDetails(); return true; }
        return false;
      });
      if (!ok) throw new EcourtsHttpError(502, "The portal's payment page has no transaction list.");
      await t.quiet();
    } finally {
      t.stop();
    }
    await page.waitForFunction(() => !!document.querySelector('#divTransList table'), undefined, { timeout: 15_000 }).catch(() => {});
  }
  // "Show All entries" in the list's own length menu, so every row is read.
  await page.evaluate(() => {
    const $ = (globalThis as any).jQuery;
    if (!$?.fn?.dataTable) return;
    $('#divTransList table').each(function (this: unknown) {
      if ($.fn.dataTable.isDataTable(this)) $(this).DataTable().page.len(-1).draw(false);
    });
  }).catch(() => {});
}

async function readTransactionList(page: Page, messages: string[] = []): Promise<EpayTransactions> {
  await install(page);
  return page.evaluate(({ fns, messages }) => {
    const h = (globalThis as any).__dfe;
    const box = document.getElementById('divTransList');
    if (!box) return { tables: [], text: '', messages };
    const winTitle = h.txt(box.closest('.modal')?.querySelector('.modal-title, .modal-header h1, .modal-header h2, .modal-header h3, .modal-header h4, .modal-header h5'));
    const tables = ([...box.querySelectorAll('table')] as any[]).filter((t) => !t.parentElement?.closest('table') && !t.closest('.dataTables_scrollHead'));
    const out = tables.map((table, ti) => {
      let head = table.tHead?.rows?.length ? table.tHead.rows[table.tHead.rows.length - 1] : null;
      if (!head) head = table.closest('.dataTables_wrapper')?.querySelector('.dataTables_scrollHead thead tr:last-child') ?? null;
      const headers = head ? ([...head.cells] as any[]).map(h.txt) : [];
      const trs = ([...(table.tBodies?.length ? [...table.tBodies].flatMap((b: any) => [...b.rows]) : [...table.rows])] as any[]).filter((r) => !r.parentElement?.matches?.('thead'));
      const rows = trs.map((tr, ri) => {
        const cells = [...tr.cells] as any[];
        if (cells.length === 1 && Number(cells[0].getAttribute('colspan') || 1) > 1) return { group: h.txt(cells[0]) };
        const idEl = tr.querySelector('[id^="grn_"], [id^="cin_"], [id^="amt_"], [id^="grnHref_"], [id^="cinHref_"], [id^="hrefChalan_"]');
        const ref = `${ti}:${idEl ? String(idEl.id).replace(/^[^_]+_/, '') : `r${ri}`}`;
        const actions: Array<{ label: string; fn: string }> = [];
        for (const a of [...tr.querySelectorAll('a, button, input[type=button]')] as any[]) {
          if (h.hiddenIn(a, tr)) continue;
          const fn = h.fnOf(a);
          if (!fns.includes(fn)) continue;
          const label = h.label(a);
          if (label && !actions.some((x) => x.label === label && x.fn === fn)) actions.push({ label, fn });
        }
        return { ref, cells: cells.map(h.lines), actions };
      }).filter((r: any) => ('group' in r ? r.group : r.cells.some(Boolean)));
      return { headers, rows };
    }).filter((t) => t.rows.length || t.headers.length);
    return { tables: out, text: out.length ? '' : h.txt(box).slice(0, 500), messages, ...(winTitle && winTitle.length < 80 ? { title: winTitle } : {}) };
  }, { fns: [...TXN_FNS] as string[], messages }) as Promise<EpayTransactions>;
}

/** ePayments transactions (the portal's viewDetails list), every row. */
export async function readEpayTransactions(sessionId: string, userId: string): Promise<EpayTransactions> {
  return withPortalPage(sessionId, userId, async (page) => {
    const done = await listen(page);
    await openTransactionList(page);
    await signedOut(page);
    return readTransactionList(page, await done());
  });
}

/**
 * Press a row's own link in the transaction list (Get GRN, Get Bank Details,
 * double verification, View Challan) - status reads, nothing is paid. What
 * the portal opens (a challan PDF, the bank's verification page) is returned:
 * a portal file is fetched over the session, anything else is a link for the
 * advocate's browser.
 */
export async function runEpayTransactionAction(sessionId: string, userId: string, ref: string, fn: string): Promise<EpayTxnActionResult> {
  if (!(TXN_FNS as readonly string[]).includes(fn)) throw new EcourtsHttpError(400, 'That is not a transaction-list button DifAi can press.');
  return withPortalPage(sessionId, userId, async (page) => {
    const done = await listen(page);
    await openTransactionList(page);
    await install(page);
    const gate = await holdGateway(page);
    const t = trackPortal(page);
    let opened: EpayGateway[] = [];
    try {
      const clicked = await page.evaluate(({ ref, fn }) => {
        const h = (globalThis as any).__dfe;
        const box = document.getElementById('divTransList');
        const [ti, key] = [Number(ref.split(':')[0]), ref.slice(ref.indexOf(':') + 1)];
        const tables = ([...(box?.querySelectorAll('table') ?? [])] as any[]).filter((t) => !t.parentElement?.closest('table') && !t.closest('.dataTables_scrollHead'));
        const table = tables[ti];
        if (!table) return 'row';
        const trs = ([...(table.tBodies?.length ? [...table.tBodies].flatMap((b: any) => [...b.rows]) : [...table.rows])] as any[]).filter((r) => !r.parentElement?.matches?.('thead'));
        const tr = /^r\d+$/.test(key)
          ? trs[Number(key.slice(1))]
          : trs.find((r) => r.querySelector(`[id="grn_${key}"], [id="cin_${key}"], [id="amt_${key}"], [id="grnHref_${key}"], [id="cinHref_${key}"], [id="hrefChalan_${key}"]`));
        if (!tr) return 'row';
        const a = ([...tr.querySelectorAll('a, button, input[type=button]')] as any[]).find((x) => !h.hiddenIn(x, tr) && h.fnOf(x) === fn);
        if (!a) return 'link';
        a.click();
        return 'ok';
      }, { ref, fn });
      if (clicked === 'row') throw new EcourtsHttpError(409, 'That payment is no longer in the list - Refresh and try again.');
      if (clicked === 'link') throw new EcourtsHttpError(409, 'The portal has no such button in that row now.');
      await t.quiet();
      await page.waitForTimeout(400);
    } finally {
      t.stop();
      opened = await gate.release();
    }
    const messages = await done();
    await signedOut(page);
    const files: EpayOpened[] = [];
    let origin = '';
    try { origin = new URL(page.url()).origin; } catch { /* blank */ }
    for (const o of opened.slice(0, 3)) {
      let file: EpayOpened['file'] = null;
      try {
        if (new URL(o.url).origin === origin) {
          const got = await page.evaluate(async (u: string) => {
            const r = await fetch(u, { credentials: 'include' });
            const type = r.headers.get('content-type') ?? '';
            if (!r.ok || !/pdf|octet-stream|image\//i.test(type)) return null;
            const buf = new Uint8Array(await r.arrayBuffer());
            let s = '';
            for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
            return { type, b64: (globalThis as any).btoa(s) };
          }, o.url).catch(() => null);
          if (got) file = { name: decodeURIComponent(new URL(o.url).pathname.split('/').pop() || 'challan.pdf'), contentType: got.type.split(';')[0]!, base64: got.b64 };
        }
      } catch { /* not a URL */ }
      files.push({ url: o.url, file });
    }
    return { transactions: await readTransactionList(page, []), opened: files, messages };
  });
}

// ---- Court Fee Wallet ------------------------------------------------------------

const onApplicationsPage = (page: Page) => page.evaluate(() =>
  typeof (globalThis as any).getSubmittedCasesPayFees === 'function',
).catch(() => false);

async function ensureApplicationsPage(page: Page): Promise<boolean> {
  if (await onApplicationsPage(page)) return true;
  for (const re of [/^\s*(interlocutory\s+)?applications?(\s+filing)?\s*$/i, /^\s*pay\s*fees\s*$/i, /^\s*(file\s+)?ia\s*$/i]) {
    if (await openPortalMenu(page, re).catch(() => false)) {
      await signedOut(page);
      if (await onApplicationsPage(page)) return true;
    }
  }
  const base = await page.evaluate(() => String((document.getElementById('base_url') as any)?.value ?? '')).catch(() => '');
  const origin = (() => { try { return new URL(page.url()).origin; } catch { return 'https://filing.ecourts.gov.in'; } })();
  await page.goto(`${(base || `${origin}/pdedev`).replace(/\/$/, '')}/?p=applications`, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await signedOut(page);
  return onApplicationsPage(page);
}

async function readWalletPage(page: Page): Promise<EpayWalletView['page']> {
  const opened = await openPortalMenu(page, /^\s*court\s*fee\s*wallet\s*$/i).catch(() => false)
    || await openPortalMenu(page, /wallet/i).catch(() => false);
  if (!opened) return null;
  await signedOut(page);
  await page.waitForTimeout(600);
  await install(page);
  const got = await page.evaluate(() => {
    const h = (globalThis as any).__dfe;
    // The page's own content: the largest content block (the first one can be
    // the portal's A- A A+ text-size bar).
    const blocks = ([...document.querySelectorAll('.content-wrapper, main, #content, .container-fluid, .container')] as any[]).filter((e) => h.shown(e) && !e.closest('nav, header, .navbar'));
    const content = blocks.sort((a, b) => h.txt(b).length - h.txt(a).length)[0] ?? document.body;
    const headings = ([...content.querySelectorAll('h1, h2, h3, h4, h5, legend, .card-header, .box-title, .page-title, .card-title')] as any[]).filter((e) => h.shown(e) && !e.closest('nav, header, .navbar, .modal')).map((e) => String(h.txt(e))).filter((t: string) => t && t.length < 120).slice(0, 20);
    const tables = ([...content.querySelectorAll('table')] as any[]).filter((t) => h.shown(t) && !t.parentElement?.closest('table')).map((t) => String(t.outerHTML));
    const clone = content.cloneNode(true);
    for (const e of [...clone.querySelectorAll('table, script, style, nav, header, footer, .navbar, .modal, select')]) e.remove();
    // The portal's text-size bar (A- A A+ A A) is not page content.
    for (const e of [...clone.querySelectorAll('*')] as any[]) {
      if (/^(A[-+]?\s*){3,6}$/.test(String(e.textContent ?? '').replace(/\s+/g, ' ').trim())) e.remove();
    }
    return { title: headings[0] ?? String(document.title ?? ''), headings, tables, text: String(clone.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 1500) };
  }) as { title: string; headings: string[]; tables: string[]; text: string };
  const tables: PortalTableData[] = [];
  for (const html of got.tables.slice(0, 6)) tables.push(await htmlTable(page, html));
  return { title: got.title, headings: got.headings, tables: tables.filter((t) => t.rows.length || t.headers.length), text: got.text };
}

async function readPayFees(page: Page): Promise<EpayPayFees> {
  await install(page);
  return page.evaluate(() => {
    const h = (globalThis as any).__dfe;
    const box = document.getElementById('tr_submitted_epay_cases');
    const checkOf = (el: any) => {
      const c = el.querySelector('input[type=checkbox]');
      return c ? { id: String(c.id || `${c.name}=${c.value}`), checked: !!c.checked, disabled: !!c.disabled } : undefined;
    };
    const tables = box ? ([...box.querySelectorAll('table')] as any[]).filter((t) => !t.parentElement?.closest('table')).map((table) => {
      const head = table.tHead?.rows?.length ? table.tHead.rows[table.tHead.rows.length - 1] : null;
      // DataTables drops its hidden columns (establishment, case) from the DOM and groups rows by them.
      const headers = head ? ([...head.cells] as any[]).map(h.txt) : [];
      const trs = ([...(table.tBodies?.length ? [...table.tBodies].flatMap((b: any) => [...b.rows]) : [...table.rows])] as any[]).filter((r) => !r.parentElement?.matches?.('thead'));
      const rows = trs.map((tr) => {
        const cells = [...tr.cells] as any[];
        const check = checkOf(tr);
        if (cells.length === 1 && Number(cells[0].getAttribute('colspan') || 1) > 1) return { group: h.lines(cells[0]).replace(/\n/g, ' '), ...(check ? { check } : {}) };
        return { cells: cells.map(h.lines), ...(check ? { check } : {}) };
      }).filter((r: any) => ('group' in r ? r.group || r.check : r.cells.some(Boolean) || r.check));
      return { headers, rows };
    }).filter((t: any) => t.rows.length || t.headers.length) : [];
    const balances = ([...document.querySelectorAll('[id^="rem_bal_"]')] as any[]).map((e) => {
      const est = String(e.id).slice('rem_bal_'.length);
      const group = e.closest('tr')?.cells?.[0];
      return { est, label: group ? h.txt(group).slice(0, 160) : est, balance: h.txt(e), subTotal: h.txt(document.getElementById(`sp_sub_total_${est}`)) };
    });
    const pages = ([...(box?.querySelectorAll('.pay-page-link-btn') ?? [])] as any[]).map((a) => ({
      label: h.txt(a), page: Number(a.getAttribute('data-page')) || 0, current: !!a.closest('.active') || a.getAttribute('aria-current') === 'page',
    })).filter((p) => p.page > 0);
    const info = box ? h.txt([...box.querySelectorAll('.text-muted.small')].pop()) : '';
    const pay = document.getElementById('btnPayEpay');
    const refresh = ([...document.querySelectorAll('button, input[type=button], a')] as any[]).find((b) => /refreshConnEst/.test(String(b.getAttribute('onclick') ?? '')) && h.shown(b));
    return {
      tables, balances, pages, info,
      search: String((document.getElementById('txtAppSearch') as any)?.value ?? ''),
      payButton: pay && h.shown(pay) ? { label: h.label(pay), disabled: !!pay.disabled } : null,
      refreshButton: refresh ? h.label(refresh) : null,
      text: tables.length ? '' : h.txt(box).slice(0, 500),
    };
  }) as Promise<EpayPayFees>;
}

/** Load the Pay Fees list the way its tab / page buttons do: getSubmittedCasesPayFees(page, 20). */
async function loadPayFees(page: Page, o: { page?: number; search?: string; refresh?: boolean }): Promise<void> {
  const t = trackPortal(page);
  try {
    if (o.refresh) {
      await page.evaluate(() => {
        const h = (globalThis as any).__dfe;
        const b = ([...document.querySelectorAll('button, input[type=button], a')] as any[]).find((x) => /refreshConnEst/.test(String(x.getAttribute('onclick') ?? '')) && h.shown(x));
        if (b) b.click();
        else if (typeof (globalThis as any).refreshConnEst === 'function') (globalThis as any).refreshConnEst();
      });
      await t.quiet();
    }
    await page.evaluate(({ pageNo, search }) => {
      const s = document.getElementById('txtAppSearch');
      if (s && search !== undefined) s.value = search;
      (globalThis as any).getSubmittedCasesPayFees(pageNo, 20);
    }, { pageNo: o.page ?? 1, search: o.search });
    await t.quiet();
  } finally {
    t.stop();
  }
  await page.waitForFunction(() => String(document.getElementById('tr_submitted_epay_cases')?.innerHTML ?? '').trim().length > 0, undefined, { timeout: 10_000 }).catch(() => {});
}

/** ePayments > Court Fee Wallet as the portal shows it, and the wallet's Pay Fees list. */
export async function readEpayWallet(sessionId: string, userId: string, o: { page?: number; search?: string; refresh?: boolean } = {}): Promise<EpayWalletView> {
  return withPortalPage(sessionId, userId, async (page) => {
    const done = await listen(page);
    const walletPage = await readWalletPage(page);
    let payFees: EpayPayFees | null = null;
    if (await ensureApplicationsPage(page)) {
      await install(page);
      await loadPayFees(page, o);
      payFees = await readPayFees(page);
    }
    return { page: walletPage, payFees, messages: await done() };
  });
}

/**
 * Pay the ticked applications' fees from the wallet (Pay Fees: tick rows ->
 * the portal's own pay button -> payCourtFees()). This spends wallet money,
 * so it needs the advocate's confirmation; the portal's own confirm() is
 * accepted only then.
 */
export async function payFromWallet(sessionId: string, userId: string, checks: string[], confirmed: boolean): Promise<EpayWalletPayResult> {
  if (confirmed !== true) throw new EcourtsHttpError(400, 'Confirm the payment from your wallet first - DifAi never pays on its own.');
  return withPortalPage(sessionId, userId, async (page) => {
    if (!(await ensureApplicationsPage(page))) throw new EcourtsHttpError(502, "Couldn't open Pay Fees on your portal. Try again.");
    await install(page);
    // A fresh list (same page, same search) so the ticks start from the
    // wallet's real balance, as on a newly opened Pay Fees tab.
    const current = await page.evaluate(() => {
      const a = ([...document.querySelectorAll('#tr_submitted_epay_cases .pay-page-link-btn')] as any[]).find((x) => x.closest('.active'));
      return Number(a?.getAttribute('data-page')) || 1;
    }).catch(() => 1);
    await loadPayFees(page, { page: current });
    const done = await listen(page, { acceptConfirm: true });
    const t = trackPortal(page);
    let paid = false;
    try {
      // Tick exactly the chosen rows, one click each (setWalletBalence runs per click).
      const state = await page.evaluate((want: string[]) => {
        const boxes = [...document.querySelectorAll('#tr_submitted_epay_cases .chkEstApp')] as any[];
        const idOf = (c: any) => String(c.id || `${c.name}=${c.value}`);
        for (const c of boxes) if (c.checked && !want.includes(idOf(c))) c.click();
        const missing = want.filter((w) => !boxes.some((c) => idOf(c) === w));
        for (const c of boxes) if (!c.checked && want.includes(idOf(c)) && !c.disabled) c.click();
        return { missing, ticked: boxes.filter((c) => c.checked).length };
      }, checks);
      if (state.missing.length) throw new EcourtsHttpError(409, 'Some of those applications are no longer in the Pay Fees list - Refresh and try again.');
      if (!state.ticked) {
        return { paid: false, messages: await done(), wallet: { page: null, payFees: await readPayFees(page), messages: [] } };
      }
      const btn = await page.evaluate(() => {
        const b = document.getElementById('btnPayEpay');
        if (!b || !(globalThis as any).__dfe.shown(b)) return 'missing';
        if (b.disabled) return 'disabled';
        return 'ok';
      });
      if (btn !== 'ok') {
        return { paid: false, messages: [...(await done()), btn === 'disabled' ? 'The portal keeps Pay disabled: the wallet balance is not enough for the ticked fees.' : 'The portal shows no Pay button now.'], wallet: { page: null, payFees: await readPayFees(page), messages: [] } };
      }
      const reply = page.waitForResponse((r) => r.url().includes('applications/payCourtFees'), { timeout: 30_000 }).catch(() => null);
      await page.evaluate(() => (document.getElementById('btnPayEpay') as any).click());
      const res = await reply;
      if (res) {
        const json = await res.json().catch(() => null) as Record<string, unknown> | null;
        paid = !!json && !json['errormsg'] && json['status'] !== false && res.status() === 200;
      }
      await t.quiet();
    } finally {
      t.stop();
    }
    const messages = await done();
    await signedOut(page);
    await page.waitForFunction(() => String(document.getElementById('tr_submitted_epay_cases')?.innerHTML ?? '').trim().length > 0, undefined, { timeout: 10_000 }).catch(() => {});
    return { paid, messages, wallet: { page: null, payFees: await readPayFees(page), messages: [] } };
  });
}
