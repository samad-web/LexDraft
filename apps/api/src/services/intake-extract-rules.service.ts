// =============================================================================
// intake-extract-rules — a DETERMINISTIC, no-LLM extractor for the intake loop.
//
// Same contract as intakeLlm.extract (returns an ExtractionPatch), but built
// from regexes + keyword rules instead of a model call. ZERO API cost.
//
// It holds the SAME no-hallucination discipline as the LLM path: a field is
// emitted ONLY when a rule clearly matches, and it carries the matched span as
// `source`. What it can't parse, it leaves out — so the engine keeps asking, and
// the advocate can always type the value into the fact-sheet panel directly.
//
// Honest limits (documented, not hidden): it is strong on STRUCTURED facts
// (dates, amounts, cheque number, the dishonour-reason enum, bank+branch) and
// weak on free natural phrasing (it will NOT reliably tell the drawer's name
// from the payee's out of loose prose). Those unresolved fields simply stay
// "still needed" — which is the correct behaviour, not a failure. Turn this on
// with INTAKE_DETERMINISTIC=true; leave off to use the LLM extractor.
// =============================================================================

import type { ExtractionPatch, ExtractedField, IntakeFieldSpec } from './intake-llm.service';
import { normalizeFieldValue } from './intake-llm.service';

// ---- date parsing ----------------------------------------------------------

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const mm = String(m).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  return `${y}-${mm}-${dd}`;
}

/** Find all dates in a string, each with its matched span. Handles:
 *  "10 August 2026", "10 Aug 2026", "August 10, 2026", "10/08/2026",
 *  "10-08-2026", "2026-08-10". Day-first for numeric (Indian convention). */
function findDates(text: string): Array<{ value: string; span: string }> {
  const out: Array<{ value: string; span: string }> = [];
  const seen = new Set<string>();
  const push = (value: string | null, span: string) => {
    if (value && !seen.has(span)) { seen.add(span); out.push({ value, span }); }
  };

  // ISO: 2026-08-10
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    push(iso(+m[1]!, +m[2]!, +m[3]!), m[0]);
  }
  // "10 August 2026" / "10 Aug 2026" / "10th August 2026"
  for (const m of text.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?\s+(\d{4})\b/g)) {
    const mon = MONTHS[m[2]!.toLowerCase()];
    if (mon) push(iso(+m[3]!, mon, +m[1]!), m[0]);
  }
  // "August 10, 2026" / "Aug 10 2026"
  for (const m of text.matchAll(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/g)) {
    const mon = MONTHS[m[1]!.toLowerCase()];
    if (mon) push(iso(+m[3]!, mon, +m[2]!), m[0]);
  }
  // Numeric d/m/y or d-m-y (day-first). Avoid matching the ISO already caught.
  for (const m of text.matchAll(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/g)) {
    push(iso(+m[3]!, +m[2]!, +m[1]!), m[0]);
  }
  return out;
}

// ---- amount parsing --------------------------------------------------------

/** Parse an amount near a currency cue. Handles "₹4,75,000", "Rs. 475000",
 *  "4.75 lakh", "5 lakh", "1.2 crore". Returns integer rupees + span. */
function findAmounts(text: string): Array<{ value: number; span: string }> {
  const out: Array<{ value: number; span: string }> = [];
  // lakh / crore worded amounts
  for (const m of text.matchAll(/(?:₹|rs\.?\s*)?(\d+(?:\.\d+)?)\s*(lakh|lakhs|lac|crore|crores|cr)\b/gi)) {
    const n = parseFloat(m[1]!);
    const unit = m[2]!.toLowerCase();
    const mult = unit.startsWith('cr') || unit.startsWith('crore') ? 10_000_000 : 100_000;
    out.push({ value: Math.round(n * mult), span: m[0] });
  }
  // plain grouped/ungrouped digits with a currency cue. Accept Rs / ₹ / INR (the
  // deferment agreements and most Indian instruments write "INR 3,99,088").
  for (const m of text.matchAll(/(?:₹|rs\.?|inr)\s*([\d,]{3,})(?!\s*(?:lakh|crore|cr))/gi)) {
    const digits = m[1]!.replace(/,/g, '');
    // A real money figure is at least 3 digits — guards against a stray "2"
    // mistaken for money (the "amount = 2" bug).
    if (/^\d+$/.test(digits) && digits.length >= 3) out.push({ value: parseInt(digits, 10), span: m[0] });
  }
  return out;
}

// ---- multi-cheque correlation ----------------------------------------------

/** A cheque's particulars parsed as one correlated group. */
interface ChequeGroup {
  number?: string;
  amount?: number;
  date?: string;
  span: string;
}

/**
 * Find EVERY cheque stated as a correlated line and keep its number, amount, and
 * date TOGETHER (so the 2nd cheque's amount never attaches to the 1st). Handles
 * the common Indian phrasings, in any internal order:
 *   "Cheque No. 000105 for INR 3,99,088 dated 16/04/2026"
 *   "Cheque No. 000102 dated 25/04/2026 for Rs. 3,00,000"
 * Anchored on "Cheque No./Number <digits>"; the amount and date are taken from
 * the same line/segment (up to the next "Cheque No." or a hard stop).
 */
function findChequeGroups(text: string): ChequeGroup[] {
  const out: ChequeGroup[] = [];
  // Split the text into segments each beginning at a "Cheque No." anchor, so a
  // group's amount/date are scoped to its own segment.
  const anchor = /cheque\s*(?:no\.?|number|#)\s*[:.]?\s*(\d{3,})/gi;
  const anchors: Array<{ number: string; at: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = anchor.exec(text)) !== null) {
    anchors.push({ number: m[1]!, at: m.index, end: m.index + m[0].length });
  }
  if (anchors.length === 0) return out;
  for (let i = 0; i < anchors.length; i += 1) {
    const a = anchors[i]!;
    // The segment runs from this anchor to the next anchor (or +160 chars / a
    // paragraph break — whichever comes first) so amount/date stay in-scope.
    const nextAt = i + 1 < anchors.length ? anchors[i + 1]!.at : text.length;
    const segEnd = Math.min(nextAt, a.end + 160);
    const seg = text.slice(a.at, segEnd);
    const amts = findAmounts(seg);
    const dates = findDates(seg);
    out.push({
      number: a.number,
      amount: amts.length ? amts[0]!.value : undefined,
      date: dates.length ? dates[0]!.value : undefined,
      span: seg.trim().slice(0, 120),
    });
  }
  return out;
}

// ---- the extractor ---------------------------------------------------------

/** A tiny helper: emit an ExtractedField (always confidence 'stated' — a rule
 *  matched literal text; we never derive, so nothing is 'inferred' here). */
function field(key: string, value: string, source: string): ExtractedField {
  return { key, value: normalizeFieldValue(key, value), confidence: 'stated', source };
}

/**
 * Extract fields from the latest message using deterministic rules. Only the
 * `latest` message is parsed (not the whole transcript) — mirroring how the
 * advocate answers one turn at a time. `answering` biases WHICH field an
 * ambiguous single date/amount is assigned to.
 */
export function extractDeterministic(args: {
  fields: IntakeFieldSpec[];
  latest: string;
  answering: string[];
}): ExtractionPatch {
  const text = args.latest;
  const specByKey = new Map(args.fields.map((f) => [f.key, f]));
  const has = (k: string) => specByKey.has(k);
  const found: ExtractedField[] = [];
  const usedKeys = new Set<string>();

  const add = (key: string, value: string, source: string) => {
    if (!has(key) || usedKeys.has(key)) return;
    const spec = specByKey.get(key)!;
    // enum: value must be an allowed option
    if (spec.type === 'select' && spec.options) {
      const match = spec.options.find((o) => o.toLowerCase() === value.toLowerCase());
      if (!match) return;
      value = match;
    }
    usedKeys.add(key);
    found.push(field(key, value, source));
  };

  // --- cheque particulars: MULTI-CHEQUE. A s.138 matter can involve several
  //     cheques ("Cheque No. 000105 for INR 3,99,088 dated 16/04/2026, Cheque No.
  //     000102 …"). Parse each cheque line as a CORRELATED group (number + amount
  //     + date TOGETHER) and emit the first under the base keys and each further
  //     one under indexed keys (cheque_no_2 / cheque_amount_2 / cheque_date_2, …),
  //     which the engine mapper folds into the cheques[] list. If nothing matches
  //     the correlated pattern, the single-field fallbacks below still run.
  const chequeGroups = findChequeGroups(text);
  if (chequeGroups.length) {
    chequeGroups.forEach((g, i) => {
      const suf = i === 0 ? '' : `_${i + 1}`;
      if (g.number) add(`cheque_no${suf}`, g.number, g.span);
      if (g.amount !== undefined) add(`cheque_amount${suf}`, String(g.amount), g.span);
      if (g.date) add(`cheque_date${suf}`, g.date, g.span);
    });
  } else {
    // Fallback: a lone "cheque number 000456789" with no correlated line.
    const m = text.match(/cheque\s*(?:number|no\.?|#)?\s*[:.]?\s*(\d{4,})/i);
    if (m) add('cheque_no', m[1]!, m[0]);
  }

  // --- dishonour reason (enum): keyword -> canonical option ---
  {
    const reasonSpec = args.fields.find((f) => f.key === 'dishonour_reason');
    if (reasonSpec?.options) {
      const lc = text.toLowerCase();
      const cue: Array<[RegExp, string]> = [
        [/insufficient|no funds|not enough funds|funds insufficient/, 'Funds Insufficient'],
        [/account\s+(?:was\s+|is\s+|has\s+been\s+)?closed/, 'Account Closed'],
        [/stop(?:ped)? payment|payment stopped/, 'Payment Stopped'],
        [/signature (?:differs|mismatch|does not match)/, 'Signature Differs'],
        [/refer to drawer/, 'Refer to Drawer'],
      ];
      for (const [re, opt] of cue) {
        if (re.test(lc) && reasonSpec.options.includes(opt)) {
          const m = text.match(re);
          add('dishonour_reason', opt, m ? m[0] : opt);
          break;
        }
      }
    }
  }

  // --- dispatch mode (enum) ---
  {
    const modeSpec = args.fields.find((f) => f.key === 'dispatch_mode');
    if (modeSpec?.options) {
      const lc = text.toLowerCase();
      const cue: Array<[RegExp, string]> = [
        [/registered post|rpad|acknowledgement due/, 'Registered Post Acknowledgement Due'],
        [/speed post/, 'Speed Post'],
        [/courier/, 'Courier'],
        [/\bemail\b/, 'Email'],
        [/hand delivery|by hand/, 'Hand Delivery'],
      ];
      for (const [re, opt] of cue) {
        if (re.test(lc) && modeSpec.options.includes(opt)) {
          const m = text.match(re);
          add('dispatch_mode', opt, m ? m[0] : opt);
          break;
        }
      }
    }
  }

  // --- amount: the cheque amount (first currency-cued amount) — only as a
  //     fallback when the correlated cheque-group pass above did NOT already fill
  //     it (usedKeys guards add(), but we skip the work when groups matched). ---
  if (!chequeGroups.length) {
    const amounts = findAmounts(text);
    if (amounts.length) add('cheque_amount', String(amounts[0]!.value), amounts[0]!.span);
  }

  // --- bank & branch: "HDFC Bank, Connaught Place branch" ---
  {
    const m = text.match(/(?:drawn on|on)\s+([A-Z][A-Za-z&. ]+?bank[A-Za-z&. ,]*?(?:branch)?)(?=[.,;]|$)/i)
      ?? text.match(/([A-Z][A-Za-z&. ]*bank[A-Za-z&. ]*,[A-Za-z&. ]+branch)/i);
    if (m) add('drawee_bank', m[1]!.trim(), m[0]);
  }

  // --- dates: assign by nearby keyword cue, else by `answering` hint ---
  {
    const dates = findDates(text);
    // Keyword-anchored date assignment: a date within ~40 chars AFTER a cue. The
    // cues must be SPECIFIC to the event — a bare "presented"/"presentation"/
    // "received" would fire on unrelated prose (e.g. "deferment of PRESENTATION
    // of the cheques") and wrongly copy a cheque date into presentation_date /
    // memo_date. A s.138 dishonour fact is only real when the document states the
    // event with its date; otherwise the field stays empty (→ a [placeholder] at
    // draft-now, never a fabricated date). "cheque … dated" must also NOT be a
    // catch-all bare "dated" — several cheques each carry "dated", so we anchor to
    // a cheque context and take the FIRST (see multi-cheque handling).
    // Each cue must be an EVENT with a date, not a bare topic word. "presented …
    // on <date>" is a real presentation; "deferment of presentation of the
    // cheques" (no "on <date>") is NOT — so we require "presented … on" / "for
    // payment/encashment on", never the lone word "presentation".
    const dateCues: Array<[RegExp, string]> = [
      [/cheque\s*(?:(?:no\.?|number|#)\s*\d+\s*)?(?:for[^.]*?)?dated/i, 'cheque_date'],
      [/presented\s+(?:it\s+)?(?:for\s+(?:payment|encashment)\s+)?on|presentation\s+date\s*[:\-]?/i, 'presentation_date'],
      [/(?:dishonou?r\s+)?memo\s+(?:is\s+)?dated|memo\s+date\s*[:\-]?|return(?:ed|ing)?\s+memo\s+dated/i, 'dishonour_date'],
      [/(?:memo\s+(?:was\s+)?received|received)\s+(?:the\s+(?:dishonou?r\s+)?memo\s+)?on|memo\s+received\s+date\s*[:\-]?/i, 'memo_received_date'],
      [/notice\s+(?:to\s+be\s+)?dated|notice\s+date\s*[:\-]?/i, 'notice_date'],
    ];
    const assigned = new Set<string>();
    for (const [cue, key] of dateCues) {
      if (!has(key)) continue;
      const cm = text.match(cue);
      if (!cm || cm.index === undefined) continue;
      // the nearest date whose span starts after this cue
      const cueEnd = cm.index + cm[0].length;
      const near = dates
        .map((d) => ({ d, at: text.indexOf(d.span, Math.max(0, cueEnd - 5)) }))
        .filter((x) => x.at >= 0 && x.at - cueEnd < 40)
        .sort((a, b) => a.at - b.at)[0];
      if (near && !assigned.has(near.d.span)) {
        assigned.add(near.d.span);
        add(key, near.d.value, `${cm[0]} … ${near.d.span}`);
      }
    }
    // If exactly one date and one date-field is being asked, assign it.
    const dateAnswerTargets = args.answering.filter((k) => specByKey.get(k)?.type === 'date');
    const leftover = dates.filter((d) => !assigned.has(d.span));
    if (leftover.length === 1 && dateAnswerTargets.length === 1 && !usedKeys.has(dateAnswerTargets[0]!)) {
      add(dateAnswerTargets[0]!, leftover[0]!.value, leftover[0]!.span);
    }
  }

  // --- names/addresses: only when explicitly cued (never guess from bare prose) ---
  {
    // "The drawer is Sandeep Verma of B-204, Sector 47, Gurugram"
    const drawer = text.match(/drawer\s+is\s+((?:[A-Z][A-Za-z]*\.?\s+)*[A-Z][A-Za-z]+)(?:\s+of\s+([^.;]+))?(?=[.;]|$)/i);
    if (drawer) {
      add('recipient_name', drawer[1]!.trim(), drawer[0]);
      if (drawer[2]) add('recipient_address', drawer[2]!.trim(), drawer[0]);
    }
    // "payee is Mehta Enterprises Pvt. Ltd., Plot 14, Naraina"
    const payee = text.match(/(?:client|payee)\s+(?:is\s+)?([A-Z][A-Za-z&. ]+?(?:Pvt\.?\s*Ltd\.?|LLP|Enterprises|Co\.?|Company|Limited)?)(?:,\s*([^.;]+?))?(?=\s+is the payee|\s+gave|[.;]|$)/i);
    if (payee) {
      add('client', payee[1]!.trim(), payee[0]); // engine key 'client' maps back to sender_name form field
      add('sender_name', payee[1]!.trim(), payee[0]);
      if (payee[2]) add('sender_address', payee[2]!.trim(), payee[0]);
    }
    // advocate: "I'm R. Sundaravadivel, enrolment MS/2287/2011". The name is a
    // run of capitalised words/initials (so "R. Sundaravadivel" is kept whole),
    // ending at a comma / "enrolment" / sentence end.
    const adv = text.match(/\b(?:I'?m|advocate|counsel)\s+((?:[A-Z][A-Za-z]*\.?\s+)*[A-Z][A-Za-z]+)(?:\s*,\s*enrol(?:ment)?\.?\s*(?:no\.?\s*)?([A-Z]{1,3}[\/-]?\d+[\/-]?\d*))?/);
    if (adv) {
      add('advocate_name', adv[1]!.trim(), adv[0]);
      if (adv[2]) add('advocate_enrolment', adv[2]!.trim(), adv[0]);
    }
    // standalone enrolment "enrolment MS/2287/2011"
    if (!usedKeys.has('advocate_enrolment')) {
      const en = text.match(/enrol(?:ment)?\.?\s*(?:no\.?\s*)?([A-Z]{1,3}[\/-]?\d+[\/-]?\d*)/i);
      if (en) add('advocate_enrolment', en[1]!.trim(), en[0]);
    }
    // place: the town where the document is signed/filed. Common Indian legal
    // phrasings — "executed at Chennai", "made at Chennai", "Courts at Chennai",
    // "Place: Chennai", "from Coimbatore", or "signed at <City>". Prefer an
    // explicit signing/execution cue over a bare "at <City>" so we don't grab a
    // property location. Value is a single City token (title-case).
    if (has('place')) {
      // Only EXPLICIT signing/execution cues (unambiguous) — never a bare "at
      // <City>" (that grabs a property location or "at No.7"). A city token starts
      // with a capital and is not a boilerplate word like "No".
      const CITY = `([A-Z][a-z]+(?:puram|bad|pur|nagar)?)`;
      const cued =
        text.match(new RegExp(`(?:executed|made|signed|verified)\\s+(?:at|in)\\s+${CITY}`, 'i'))
        // "…made on <date> at Chennai" / "…this 5th day of May 2026 at Chennai" —
        // an "at <City>" that immediately follows a date/year (a signing line).
        ?? text.match(new RegExp(`(?:\\d{4}|\\d{1,2}(?:st|nd|rd|th)?\\s+[A-Za-z]+\\s+\\d{4})\\s+at\\s+${CITY}`, 'i'))
        ?? text.match(new RegExp(`\\bPlace\\s*[:\\-]\\s*${CITY}`, 'i'))
        ?? text.match(new RegExp(`\\bfrom\\s+${CITY}(?=[.;,]|$)`, 'i'))
        ?? text.match(new RegExp(`Courts?\\s+at\\s+${CITY}`, 'i'));
      if (cued && cued[1] && !STOPWORDS.has(cued[1].toLowerCase())) add('place', cued[1].trim(), cued[0]);
    }
  }

  // === GENERAL, FIELD-DRIVEN LAYER (works for ANY doc type) ================
  // The specific rules above win (usedKeys guards). This layer fills the rest by
  // keying off each field's own LABEL — so it captures across bail, deeds, leases,
  // matrimonial, etc. without per-doc rules. No LLM; zero cost.
  generalFieldExtract(args.fields, text, add, has, usedKeys);

  // === BARE-ANSWER FALLBACK ================================================
  // The advocate answered a SPECIFIC question with a bare value ("gowtham" to
  // "advocate name?"). If, after all the rules above, a field we ASKED about
  // (`answering`) is still empty AND the message is short (a direct answer, not a
  // fresh narration), assign the whole message to that field. This is what stops
  // the loop re-asking the same question forever.
  {
    const stillPending = args.answering.filter((k) => specByKey.has(k) && !usedKeys.has(k));
    const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
    // Only treat as a direct answer when the reply is short (≤ 8 words) — a long
    // paste is a narration to be parsed by the rules, not a single field's value.
    if (stillPending.length >= 1 && wordCount > 0 && wordCount <= 8) {
      // With exactly one pending field, the whole message is its value. With a few
      // pending, only assign when the value's TYPE clearly fits one of them (so we
      // don't put a name into a date field).
      if (stillPending.length === 1) {
        assignBare(stillPending[0]!, text.trim(), specByKey, add);
      } else {
        for (const key of stillPending) {
          if (assignBare(key, text.trim(), specByKey, add)) break;
        }
      }
    }
  }

  return {
    fields: found,
    unmappedNotes: [],
    lowConfidence: [],
    collisions: [],
    modelUsed: 'deterministic:rules',
  };
}

/**
 * Assign a bare answer to a pending field, coercing to its type. Returns true if
 * assigned. A value only lands when it PLAUSIBLY fits the field's type — so a
 * name never fills a date/number field (which would keep the loop stuck anyway).
 */
function assignBare(
  key: string,
  raw: string,
  specByKey: Map<string, IntakeFieldSpec>,
  add: (key: string, value: string, source: string) => void,
): boolean {
  const spec = specByKey.get(key);
  if (!spec) return false;
  const v = raw.trim();
  if (spec.type === 'date') {
    const iso = normaliseDate(v);
    if (!iso) return false;
    add(key, iso, v);
    return true;
  }
  if (spec.type === 'currency' || spec.type === 'number') {
    const amt = parseAmountLoose(v);
    if (amt === null) return false;
    add(key, String(amt), v);
    return true;
  }
  if (spec.type === 'select') {
    // `add` already validates the option; only assign if it matches one.
    if (!spec.options?.some((o) => o.toLowerCase() === v.toLowerCase())) return false;
    add(key, v, v);
    return true;
  }
  // text / textarea: accept the bare value as-is (strip a trailing period).
  const clean = v.replace(/[.]+$/, '').trim();
  if (clean.length < 1) return false;
  add(key, clean, v);
  return true;
}

// ---- general field-driven extraction ---------------------------------------

/** Role/label words that commonly precede a party name across doc types, mapped
 *  to the kind of value they introduce. Used to anchor name/address capture. */
const ROLE_WORDS = [
  'vendor', 'vendee', 'purchaser', 'seller', 'buyer', 'lessor', 'lessee',
  'landlord', 'tenant', 'donor', 'donee', 'mortgagor', 'mortgagee', 'plaintiff',
  'defendant', 'petitioner', 'respondent', 'complainant', 'accused', 'applicant',
  'appellant', 'executant', 'claimant', 'deponent', 'testator', 'settlor',
  'trustee', 'caveator', 'decree-holder', 'judgment-debtor', 'surety', 'drawer',
  'payee', 'proprietor', 'client',
];

/** Words that are NEVER a valid name/value — connective/boilerplate the extractor
 *  must reject rather than emit as garbage ("Hereinafter", "No", "The", …). A
 *  captured name/address matching these is dropped (leave the field empty so the
 *  advocate types it — an empty field beats a wrong one they must delete). */
const STOPWORDS = new Set([
  'hereinafter', 'referred', 'the', 'and', 'as', 'is', 'of', 'a', 'an', 'no',
  'this', 'that', 'said', 'above', 'below', 'herein', 'whereas', 'now', 'to',
  'by', 'for', 'with', 'proprietor', 'prop', 'between', 'made', 'on', 'at',
]);

/** True when a captured string is real content, not a stopword/boilerplate token. */
function isMeaningful(v: string): boolean {
  const t = v.trim();
  if (t.length < 2) return false;
  const words = t.split(/\s+/).filter(Boolean);
  // Every word a stopword → junk. A leading stopword-only capture ("Hereinafter",
  // "No") is rejected; a real name that merely CONTAINS "of"/"and" is fine.
  if (words.every((w) => STOPWORDS.has(w.toLowerCase().replace(/[.,]/g, '')))) return false;
  // "No." followed by a number is a HOUSE NUMBER ("No. 8/2, Nair Street"), not the
  // stopword "no" — a legitimate start of an address line. Accept it.
  const w0 = words[0]!.toLowerCase().replace(/[.,]/g, '');
  if (w0 === 'no' && words.length >= 2 && /\d/.test(words[1]!)) return true;
  // First token must not itself be a bare stopword ("No", "Hereinafter").
  if (STOPWORDS.has(w0)) return false;
  return true;
}

/** Common label synonyms per field-key fragment, so "Cheque No." matches a field
 *  keyed cheque_no, "amount"/"sum"/"value" matches an amount field, etc. */
function labelSynonyms(spec: IntakeFieldSpec): string[] {
  const out = new Set<string>();
  const label = spec.label.replace(/\(.*?\)/g, '').trim(); // drop "(who issued…)"
  out.add(label);
  // split the label into meaningful words too (e.g. "Cheque number" -> also "cheque")
  const key = spec.key.toLowerCase();
  const add = (s: string) => s && out.add(s);
  if (/name/.test(key)) { /* handled by role-anchored pass */ }
  if (/address/.test(key)) { add('address'); add('residing at'); add('r/o'); add('office at'); }
  if (/amount|consideration|sum|price|value|rent|deposit|quantum|principal/.test(key)) {
    add('amount'); add('sum'); add('consideration'); add('value'); add('rs'); add('inr');
  }
  // DATE fields: do NOT add generic 'dated'/'on' — those match ANY date in the
  // document (every cheque line has "dated 16/04/2026"), which wrongly copied a
  // cheque date into presentation_date / memo_date. Only the SPECIFIC anchored
  // cues (see the dateCues pass) may fill a dishonour-event date; otherwise the
  // field stays empty and becomes a [placeholder] at draft-now.
  if (/date/.test(key)) { add(label); }
  if (/section|offence|sections/.test(key)) { add('section'); add('u/s'); add('under section'); }
  if (/bank/.test(key)) { add('bank'); add('drawn on'); }
  if (/no\b|number|_no$/.test(key)) { add('no'); add('number'); }
  if (/fir/.test(key)) { add('fir'); add('crime no'); }
  if (/police/.test(key)) { add('police station'); add('p.s'); }
  if (/pan/.test(key)) { add('pan'); }
  if (/gst/.test(key)) { add('gst'); }
  if (/occupation/.test(key)) { add('occupation'); add('by profession'); }
  if (/age/.test(key)) { add('age'); add('aged'); }
  // COUNT/DURATION number fields (term/tenure/period/duration + months/years/days).
  // Add each cue word so "term 24 months" is reachable even though the literal
  // label "Term months" never appears verbatim in the prose.
  if (/term|tenure|duration|period|months|month|years|year|days|day|count|quantity|qty|number of/.test(key)) {
    for (const w of ['term', 'tenure', 'duration', 'period', 'months', 'month', 'years', 'year', 'days', 'day', 'count', 'quantity']) {
      if (key.includes(w)) add(w);
    }
  }
  // Expose the individual words of the label as cues (so a multi-word label like
  // "Term months" is reachable by its parts). EXCEPT for DATE fields: their label
  // words ("date", "cheque", "presented", "memo") are far too generic — they'd
  // match the cheque date that sits near every one of those words and copy it into
  // presentation_date / memo_date. Date fields fill ONLY via the specific anchored
  // cues; unmatched, they stay empty (→ a [placeholder] at draft-now).
  if (spec.type !== 'date') {
    for (const w of label.toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length >= 3)) add(w);
  }
  return [...out];
}

const _MONTHS_G = /jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i;

/**
 * Fill any still-empty field by matching its LABEL (and synonyms) in the text and
 * pulling the value that follows, coerced to the field's type. Deliberately
 * conservative: only emits when a label anchor is found near a plausible value, so
 * it never fabricates. Runs AFTER the specific rules (which have already claimed
 * their fields), so it only fills the gaps.
 */
function generalFieldExtract(
  specs: IntakeFieldSpec[],
  text: string,
  add: (key: string, value: string, source: string) => void,
  has: (k: string) => boolean,
  usedKeys: Set<string>,
): void {
  // 0) HIGH-SIGNAL patterns FIRST (PAN/GST/FIR/section) — they claim their exact
  //    tokens so later, looser passes don't swallow them into another field.
  extractHighSignal(specs, text, add, usedKeys);

  // 1) Role-anchored NAMES, generic across doc types, SENTENCE-SCOPED (a name
  //    never crosses a '.'). Handles both orders:
  //    "Vendor: Mr. Suresh Kumar …"      (role before name)
  //    "THOORIGAI PRINTS … is the Payee" (name before role)
  // Split into sentences, but NOT on an abbreviation period (Mr./Mrs./M/s./No.)
  // — otherwise "Vendor: Mr. Suresh" splits after "Mr." and the name is lost.
  const sentences = text.split(/(?<=[.;])\s+/).reduce<string[]>((acc, part) => {
    const prev = acc[acc.length - 1];
    if (prev && /\b(?:Mr|Mrs|Ms|M\/s|Smt|Thiru|No|Prop|Pvt|Ltd)\.$/i.test(prev)) {
      acc[acc.length - 1] = prev + ' ' + part;      // re-join a false split
    } else acc.push(part);
    return acc;
  }, []);
  for (const spec of specs) {
    if (!spec.key.toLowerCase().includes('name')) continue;
    if (usedKeys.has(spec.key)) continue;
    const keyLc = (spec.key + ' ' + spec.label).toLowerCase();
    const role = ROLE_WORDS.find((r) => keyLc.includes(r.replace('-', ' ')) || keyLc.includes(r));
    if (!role) continue;
    // A name = optional title + Caps word(s); NO period inside (stays in-sentence).
    // The title needs whitespace + a following Caps word, so "Mr." alone never wins.
    const NAME = `((?:(?:M/s|Mr|Mrs|Ms|Smt|Thiru)\\.?\\s+)?[A-Z][A-Za-z&]+(?:\\s+[A-Z][A-Za-z&]*){0,4})`;
    // role BEFORE name — "Vendor: Mr. X", "the accused Rajesh Kumar". The negative
    // lookbehind skips "…referred to as the <Role>" (the name-before-role case),
    // so we don't grab the word AFTER the role there ("…as the Payee. Hereinafter").
    // A junk capture (Hereinafter/No) is rejected by isMeaningful below.
    const roleBefore = new RegExp(`(?<!as\\s)(?<!as the\\s)(?<!/\\s)(?<!/)\\b${role}\\b\\s*[:\\-]?\\s*(?:is\\s+)?${NAME}`, 'i');
    // NAME-BEFORE-ROLE first, on the FULL text: when the role is introduced by a
    // "hereinafter / referred to as / is the <Role>" clause (often inside a quoted
    // alias like "Vendor / Payee"), the party NAME is the FIRST proper-noun run in
    // the party block that PRECEDES that clause — with any Proprietor/PAN/GST/
    // Address/hereinafter tail stripped off. Run on the full text (not per-sentence)
    // so a stray initial like "Proprietor: R. Venkatesh" can't mis-scope the block;
    // nameBeforeRole finds the block via BETWEEN/AND/alias-quote boundaries itself.
    const nb = nameBeforeRole(text, role);
    if (nb && nb.length >= 2 && !ROLE_WORDS.includes(nb.toLowerCase()) && isMeaningful(nb)) {
      add(spec.key, nb, nb);
      continue;
    }
    // Otherwise ROLE-BEFORE-NAME: "Vendor: Mr. Suresh Kumar" — sentence-scoped so a
    // name never crosses a '.' into the next clause.
    for (const sent of sentences) {
      if (!new RegExp(`\\b${role}\\b`, 'i').test(sent)) continue;
      const m = sent.match(roleBefore);
      if (m && m[1]) {
        const name = cleanName(m[1]);
        // Reject junk (Hereinafter/No/role-words) — an empty field beats a wrong one.
        if (name.length >= 2 && !ROLE_WORDS.includes(name.toLowerCase()) && isMeaningful(name)) {
          add(spec.key, name, m[0]);
          break;
        }
      }
    }
  }

  // 2) ADDRESS fields — ROLE-ANCHORED, so a two-party document (payee vs drawer,
  //    lessor vs lessee) never gets one party's address copied into the other's.
  //    Each address field is matched to its role (via the field label), and its
  //    value comes from THAT party's own block (addressBeforeRole). Only when a
  //    field has no role, OR it is the SOLE address field (no swap risk), do we
  //    fall back to the first "residing at / Address:" line in the text.
  const addressSpecs = specs.filter(
    (s) => s.key.toLowerCase().includes('address') && !usedKeys.has(s.key),
  );
  for (const spec of addressSpecs) {
    const keyLc = (spec.key + ' ' + spec.label).toLowerCase();
    const role = ROLE_WORDS.find((r) => keyLc.includes(r.replace('-', ' ')) || keyLc.includes(r));
    if (role) {
      const addr = addressBeforeRole(text, role);
      if (addr) { add(spec.key, addr, addr); continue; }
      // A roled address field with no block match stays EMPTY (better than a
      // swapped guess) UNLESS it's the only address field — handled below.
    }
    // Fallback (no role, or the sole address field): first address line in text.
    if (!role || addressSpecs.length === 1) {
      const m = text.match(
        /(?:residing at|r\/o|office at|address\s*[:\-]?)\s*((?:No\.?\s*)?\d?[^.;\n]*?[A-Za-z]{3,}[^.;\n]*?)(?=\s*(?:hereinafter|referred|\.(?!\d)|;|\n|$))/i,
      );
      if (m && m[1]) {
        const addr = m[1].trim().replace(/[.,;]+$/, '');
        if (addr.length >= 6 && isMeaningful(addr)) add(spec.key, addr, m[0]);
      }
    }
  }

  // 3) TYPE-AWARE, LABEL-ANCHORED capture for the remaining fields.
  for (const spec of specs) {
    if (usedKeys.has(spec.key)) continue;
    const syns = labelSynonyms(spec);

    if (spec.type === 'date') {
      // A date appearing right after any of the field's label synonyms.
      const near = findNearLabel(text, syns, /\b(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}|\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\.?\s+\d{4}|[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2})\b/);
      if (near) {
        const iso = normaliseDate(near);
        if (iso) add(spec.key, iso, near);
      }
      continue;
    }

    if (spec.type === 'currency' || spec.type === 'number') {
      // CURRENCY requires a real money figure next to the label — a currency cue
      // (Rs/₹/INR), a lakh/crore unit, or a grouped/3+-digit number. A bare 1-2
      // digit numeral (a list marker, "the first two cheques") is NOT money: this
      // is the "amount = 2" bug. NUMBER (age, term, count) is a plain integer and
      // MAY be small (age 34, term 24 months), so it keeps the loose pattern.
      const valRe =
        spec.type === 'currency'
          ? /(?:(?:₹|rs\.?|inr)\s*[\d,]+(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s*(?:lakh|lakhs|crore|cr)|\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d{3,}(?:\.\d+)?)/i
          : /(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d+)?\s*(?:lakh|lakhs|crore|cr)?)/i;
      const near = findNearLabel(text, syns, valRe);
      if (near) {
        const amt = parseAmountLoose(near);
        // Final guard: reject an implausibly small "amount" for a CURRENCY field.
        if (amt !== null && (spec.type !== 'currency' || amt >= 100)) {
          add(spec.key, String(amt), near);
        }
        continue;
      }
      // FALLBACK for a CURRENCY field with no label anchor in the text: take the
      // first currency-cued amount (₹/Rs/lakh/crore). Only when this is the SOLE
      // still-unfilled currency field, so we never mis-split rent vs deposit vs
      // consideration (those are disambiguated by their own labels above).
      if (spec.type === 'currency') {
        const otherCurrencyOpen = specs.some(
          (s) => s !== spec && s.type === 'currency' && !usedKeys.has(s.key),
        );
        if (!otherCurrencyOpen) {
          const amounts = findAmounts(text);
          if (amounts.length) add(spec.key, String(amounts[0]!.value), amounts[0]!.span);
        }
      }
      continue;
    }

    if (spec.type === 'select' && spec.options) {
      // Match any option name (or an obvious keyword) present in the text.
      const opt = spec.options.find((o) => new RegExp(`\\b${escapeRe(o)}\\b`, 'i').test(text));
      if (opt) add(spec.key, opt, opt);
      continue;
    }

    // text/textarea: "Label: value" / "Label is value" / "Label - value".
    // Stop the value at a clause boundary (comma / period / " at " / " under " /
    // " drawn " / a following capitalised label word) so it doesn't over-capture.
    for (const syn of syns) {
      const m = text.match(new RegExp(`\\b${escapeRe(syn)}\\b\\s*(?:no\\.?|number)?\\s*[:\\-]?\\s*(?:is\\s+)?([A-Za-z0-9][^.;,\\n]{1,80})`, 'i'));
      if (m && m[1]) {
        const v = clampValue(m[1]);
        if (v.length >= 2 && isMeaningful(v)) { add(spec.key, v, m[0]); break; }
      }
    }
  }
}

/** PAN / GST / FIR / section — high-signal patterns matched regardless of label,
 *  claimed FIRST so looser passes can't swallow these tokens. */
function extractHighSignal(
  specs: IntakeFieldSpec[],
  text: string,
  add: (key: string, value: string, source: string) => void,
  usedKeys: Set<string>,
): void {
  const patternFields: Array<[RegExp, RegExp]> = [
    [/pan/, /\b([A-Z]{5}\d{4}[A-Z])\b/],
    [/gst/, /\b(\d{2}[A-Z]{5}\d{4}[A-Z]\dZ[A-Z\d])\b/],
    [/fir|crime/, /\b(?:fir|crime)\s*(?:no\.?)?\s*[:\-]?\s*(\d+\/\d{2,4})\b/i],
    [/section|offence/, /\b(?:u\/s\.?|under\s+section|section)\s+(\d+[A-Za-z]?(?:\s*(?:IPC|BNS|CrPC|BNSS|NI\s*Act))?)/i],
    [/police/, /\bat\s+([A-Z][A-Za-z0-9 .]*?)\s+police\s+station/i],
    [/police/, /\b([A-Z][A-Za-z0-9 .]*?)\s+police\s+station/i],
  ];
  for (const spec of specs) {
    if (usedKeys.has(spec.key)) continue;
    const keyLc = spec.key.toLowerCase();
    for (const [keyMatch, valRe] of patternFields) {
      if (!keyMatch.test(keyLc)) continue;
      const m = text.match(valRe);
      if (m && m[1]) { add(spec.key, m[1].trim(), m[0]); break; }
    }
  }
}

/** Tail cues that mark the END of a party NAME — everything from here on is a
 *  proprietor/PAN/GST/address/relationship/alias clause, not part of the name. */
const NAME_TAIL =
  /\s*,?\s*(?:Proprietor|Prop|PAN|GST|GSTIN|Address|Add|Aadhaar|s\/o|d\/o|w\/o|son|daughter|wife|husband|aged|residing|r\/o|office|through|rep(?:resented)?|hereinafter|referred|represented)\b/i;

/**
 * NAME-BEFORE-ROLE capture. In deeds/notices a party is written NAME first, then a
 * long "Proprietor: … PAN: … Address: … hereinafter referred to as the '<Role>'"
 * clause. Given a sentence and the role word, return the party name = the FIRST
 * proper-noun run in the party block that precedes the role-introducing clause,
 * with the Proprietor/PAN/GST/Address/hereinafter tail stripped. Returns null when
 * the role isn't introduced by such a clause (leave role-before-name to handle it).
 */
function nameBeforeRole(text: string, role: string): string | null {
  // The clause that INTRODUCES the role: "referred to as … <role>" (the role is
  // often inside a quoted alias like "Vendor / Payee"), or a bare "is the <role>" /
  // "as the <role>". Kept within one sentence; a stray "." in "No. 8/2" is fine
  // because it sits BEFORE this clause, not inside it.
  const introRe = new RegExp(
    `\\b(?:referred to as|known as|called|described as|as the|is the|is)\\b[^.]*?\\b${role}\\b`,
    'i',
  );
  const im = text.match(introRe);
  if (!im || im.index === undefined) return null;
  // The party block ENDS at the intro clause. Its START = the nearest preceding
  // boundary: a BETWEEN/AND keyword, a previous alias quote, a colon-label, or 0.
  const before = text.slice(0, im.index);
  let start = 0;
  let bm: RegExpExecArray | null;
  const boundRe = /\b(?:BETWEEN|AND)\b|["“”]/g;
  while ((bm = boundRe.exec(before)) !== null) start = bm.index + bm[0].length;
  const block = before.slice(start);
  // First proper-noun run (ALLCAPS entity or Titlecase words), with optional title.
  const nm = block.match(
    /((?:(?:M\/s|Mr|Mrs|Ms|Smt|Thiru|Dr)\.?\s+)?[A-Z][A-Za-z&.]*(?:\s+[A-Z][A-Za-z&.0-9]*){0,6})/,
  );
  if (!nm) return null;
  const name = cleanName(nm[1]!.split(NAME_TAIL)[0]!);
  return name.length >= 2 ? name : null;
}

/**
 * The ADDRESS belonging to the party introduced with `role`, taken from that
 * party's OWN block (name → PAN/GST → Address → "referred to as the <role>").
 * This is what prevents the payee's and drawer's addresses being swapped: each
 * address is scoped to the block that carries its role anchor, NOT the first
 * "Address:" in the document. Returns null when that block has no address.
 */
function addressBeforeRole(text: string, role: string): string | null {
  // Find the role intro clause (same anchor nameBeforeRole uses), then take the
  // party block that ENDS at it. The address is the "Address:" line inside it.
  const introRe = new RegExp(
    `\\b(?:referred to as|known as|called|described as|as the|is the|is)\\b[^.]*?\\b${role}\\b`,
    'i',
  );
  const im = text.match(introRe);
  if (!im || im.index === undefined) return null;
  const before = text.slice(0, im.index);
  // Block start = nearest preceding BETWEEN/AND boundary (start of THIS party).
  let start = 0;
  let bm: RegExpExecArray | null;
  const boundRe = /\b(?:BETWEEN|AND)\b/g;
  while ((bm = boundRe.exec(before)) !== null) start = bm.index + bm[0].length;
  const block = before.slice(start);
  // The address inside this block: "Address: …" up to the next block label
  // (Hereinafter / Entity Type / Nature of Business / PAN / GST) or end.
  const am = block.match(
    /\baddress\s*[:\-]?\s*((?:No\.?\s*)?[^\n]*?[A-Za-z]{3,}[^\n]*?)(?=\s*(?:hereinafter|entity type|nature of business|pan\b|gst|$))/i,
  );
  if (!am || !am[1]) return null;
  const addr = am[1].trim().replace(/[.,;]+$/, '');
  return addr.length >= 6 && isMeaningful(addr) ? addr : null;
}

/** Trim a captured NAME: drop a trailing description/role tail and stray punctuation. */
function cleanName(raw: string): string {
  return raw
    .replace(/\s+(?:son|daughter|wife|s\/o|d\/o|w\/o|proprietor|prop|aged|residing|r\/o|through|is\b|referred).*$/i, '')
    .replace(/[.,;]\s*(?:monthly|the|and|dated|drawn).*$/i, '')
    .replace(/[.,;]+$/,'')
    .trim();
}

/** Clamp a loose captured value at the first clause boundary so it doesn't run
 *  into the next clause ("45/2026 at E4 Police Station under section…" -> "45/2026"). */
function clampValue(raw: string): string {
  let v = raw.trim();
  // Cut at connective clause words that clearly start a NEW fact.
  v = v.split(/\s+(?:at|under|drawn|residing|r\/o|dated|and\s+the|,\s*prop)/i)[0]!.trim();
  v = v.replace(/[.,;]+$/,'').trim();
  return v;
}

/** Find a value matched by `valRe` appearing within ~60 chars AFTER any of the
 *  given label synonyms. Returns the matched value string, or null. */
function findNearLabel(text: string, syns: string[], valRe: RegExp): string | null {
  for (const syn of syns) {
    const li = text.toLowerCase().indexOf(syn.toLowerCase());
    if (li === -1) continue;
    const window = text.slice(li, li + syn.length + 80);
    const m = window.match(valRe);
    if (m) return (m[1] ?? m[0]).trim();
  }
  return null;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Loosely parse an amount (with optional lakh/crore) to integer rupees. */
function parseAmountLoose(s: string): number | null {
  const m = s.match(/([\d,]+(?:\.\d+)?)\s*(lakh|lakhs|crore|cr)?/i);
  if (!m) return null;
  const n = parseFloat(m[1]!.replace(/,/g, ''));
  if (!isFinite(n)) return null;
  const unit = (m[2] ?? '').toLowerCase();
  const mult = unit.startsWith('cr') ? 10_000_000 : unit.startsWith('lakh') || unit === 'lakhs' ? 100_000 : 1;
  return Math.round(n * mult);
}

/** Normalise a loose date string to YYYY-MM-DD (day-first for numeric). */
function normaliseDate(s: string): string | null {
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return iso(+m[1]!, +m[2]!, +m[3]!);
  m = t.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
  if (m) { const y = +m[3]! < 100 ? 2000 + +m[3]! : +m[3]!; return iso(y, +m[2]!, +m[1]!); }
  m = t.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?\s+(\d{4})$/);
  if (m && _MONTHS_G.test(m[2]!)) { const mo = MONTHS[m[2]!.toLowerCase()]; if (mo) return iso(+m[3]!, mo, +m[1]!); }
  m = t.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/);
  if (m && _MONTHS_G.test(m[1]!)) { const mo = MONTHS[m[1]!.toLowerCase()]; if (mo) return iso(+m[3]!, mo, +m[2]!); }
  return null;
}
