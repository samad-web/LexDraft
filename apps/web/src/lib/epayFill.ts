/**
 * Hand a filing over to ePay (pay.ecourts.gov.in) without retyping it.
 *
 * ePay can't be prefilled by URL and its CSP blocks outside scripts, so the
 * hand-off is two parts:
 *  1. LexDraft opens ePay with the case in the URL fragment (`#lexdraft=…`).
 *     A fragment is never sent to the ePay server.
 *  2. The advocate clicks the "LexDraft Fill" bookmarklet once on that page.
 *     It selects Court Fee and fills the form from the fragment.
 *
 * The fill never ticks "I agree", generates or verifies an OTP, or pays. Those
 * stay with the advocate.
 *
 * Field ids were mapped from the live form on 2026-10-21: the state codes are
 * eCourts state codes, and the establishment values are eCourts est codes
 * (e.g. TNAL04).
 */

export const EPAY_URL = 'https://pay.ecourts.gov.in/epay/';

export interface EpayHandoff {
  v: 1;
  court: 'DC' | 'HC';
  state: number | null;
  district: number | null;
  est: string | null;
  cnr: string | null;
  party: string | null;
  amount: number | null;
  mobile: string | null;
  remark: string | null;
}

/** ePay's party-name field only accepts letters, spaces and dots. */
export function epayPartyName(name: string | null | undefined): string | null {
  const clean = (name ?? '').replace(/[^A-Za-z .]/g, ' ').replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, 99) : null;
}

export function epayUrl(h: EpayHandoff): string {
  return `${EPAY_URL}#lexdraft=${encodeURIComponent(JSON.stringify(h))}`;
}

// Kept as a plain string, not a compiled function: the bundler may rewrite a
// function body with helpers (e.g. __name) that don't exist on ePay's page.
const FILL_SOURCE = `(function () {
  function done(msg) { alert('LexDraft: ' + msg); }
  if (location.hostname !== 'pay.ecourts.gov.in') { done('Click this on the ePay page (pay.ecourts.gov.in) that LexDraft opened.'); return; }
  var m = /[#&]lexdraft=([^&]*)/.exec(location.hash);
  if (!m) { done('No case details on this page. In LexDraft click "Open ePay with this case", then click this again.'); return; }
  var d;
  try { d = JSON.parse(decodeURIComponent(m[1])); } catch (e) { done('The case details in the address are damaged. Open ePay from LexDraft again.'); return; }
  var filled = [], missed = [];
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  async function until(fn, ms) {
    var t = Date.now();
    while (Date.now() - t < (ms || 15000)) { var v = fn(); if (v) return v; await sleep(250); }
    return null;
  }
  (async function () {
    var label = document.getElementById('courtFeeLabel');
    var radio = document.getElementById('courtFee_radio');
    if (!label || !radio) { done('This ePay page has changed, so LexDraft cannot fill it. Please fill it by hand.'); return; }
    if (!radio.checked) label.click();
    var doc = await until(function () {
      var f = document.getElementById('fine_div');
      var x = f && f.contentDocument;
      return x && x.getElementById('sess_state_code') ? x : null;
    });
    if (!doc) { done('The Court Fee form did not load. Reload the page and click this again.'); return; }
    function el(id) { return doc.getElementById(id); }
    function fire(e, t) { e.dispatchEvent(new Event(t, { bubbles: true })); }
    function check(id) { var e = el(id); if (e && !e.checked) e.click(); }
    function text(id, v, name, blur) {
      if (v == null || v === '') return;
      var e = el(id);
      if (!e) { missed.push(name); return; }
      e.value = String(v); fire(e, 'input'); fire(e, 'change'); if (blur) fire(e, 'blur');
      filled.push(name);
    }
    function match(e, v) {
      return Array.prototype.find.call(e.options, function (o) { return o.value === String(v) || o.value.split('~')[0] === String(v); });
    }
    async function pick(id, v, name) {
      if (v == null || v === '') { missed.push(name); return false; }
      var e = el(id);
      var opt = e && await until(function () { return match(e, v); });
      if (!opt) { missed.push(name); return false; }
      e.value = opt.value; fire(e, 'change');
      filled.push(name);
      return true;
    }
    check(d.court === 'HC' ? 'rdoHC' : 'rdoDC');
    await sleep(500);
    if (d.cnr) {
      check('rdoOld'); await sleep(300);
      check('rdoCnr'); await sleep(300);
      text('cnr_num', d.cnr, 'CNR');
      var go = Array.prototype.find.call(doc.querySelectorAll('button'), function (b) {
        return /checkstateepayvendor/.test(b.getAttribute('onclick') || '') && b.offsetParent !== null;
      });
      if (go) go.click();
      text('amount', d.amount, 'amount', true);
    } else {
      check('rdoNew'); await sleep(300);
      if (await pick('sess_state_code', d.state, d.court === 'HC' ? 'High Court' : 'state')) {
        if (d.court !== 'HC') await pick('sess_dist_code', d.district, 'district');
        await pick('court_complex_code', d.est, d.court === 'HC' ? 'bench' : 'establishment');
      }
      text('PartyName', d.party, 'party name');
      text('Amount', d.amount, 'amount', true);
    }
    text('Remark', d.remark, 'remark');
    text('mobile', d.mobile, 'mobile');
    done('Filled: ' + (filled.join(', ') || 'nothing') + '.' +
      (missed.length ? '\\nPlease fill by hand: ' + missed.join(', ') + '.' : '') +
      '\\n\\nCheck the details, tick "I agree", generate the OTP and pay. LexDraft never pays for you.');
  })();
})();`;

export const EPAY_FILL_BOOKMARKLET = `javascript:${encodeURIComponent(FILL_SOURCE.replace(/\n\s*/g, ' '))}`;

/** For the e2e/probe scripts: the raw fill source. */
export const __epayFillSource = FILL_SOURCE;
