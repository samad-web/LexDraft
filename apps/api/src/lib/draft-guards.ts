// =============================================================================
// draft-guards — deterministic checks on model-written legal prose.
//
// The model is told not to invent or drop facts; these checks don't take its word
// for it. They reduce a text to its LOAD-BEARING particulars — amounts, dates,
// statutory sections/articles, day-periods, reported citations and bracketed
// markers — in a format-independent form, so "Rs. 450000/-" == "Rs. 4,50,000/-",
// "2024-11-04" == "04.11.2024" == "4th November 2024", "s.303(2)" == "Section 303(2)".
//
//   lostParticulars(source, composed)       -> what the composed text DROPPED
//   introducedParticulars(composed, allowed) -> what it ADDED from nowhere
//   stripSentences(paragraphs, needles)      -> remove just the offending sentences
// =============================================================================

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const RX = {
  amount: /(?:₹|\bRs\.?|\bINR)\s*([\d,]+(?:\.\d+)?)/gi,
  dmy: /\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/g,
  ymd: /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g,
  wordy: /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:day\s+of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+(\d{4})\b/gi,
  section: /\b(?:sections?|secs?\.?|s\.|ss\.|u\/s\.?|§)\s*(\d+[A-Z]?(?:\s*\(\s*[\da-z]+\s*\))*)/gi,
  // "BNS 318(4)", "IPC 420" — an Act abbreviation then the bare number (never a
  // year). "BNS s.303(2)" is already read by `section`.
  actSection: /\b(?:BNSS|BNS|BSA|IPC|CrPC|Cr\.P\.C\.?|CPC|C\.P\.C\.?|IEA)\s+(?!(?:19|20)\d\d\b)(\d+[A-Z]?(?:\s*\(\s*[\da-z]+\s*\))*)/g,
  article: /\b(?:article|art\.)\s*(\d+[A-Z]?(?:\s*\(\s*[\da-z]+\s*\))*)/gi,
  // CPC "Order VIII Rule 5", "Order XXXIX Rules 1 and 2", "O.VI R.17" — any case:
  // engine titles write "ORDER XVII RULE 1", which must count as the same provision.
  order: /\b(?:Order|O\.)\s*([IVXLC]+|\d+)\s*,?\s*(?:Rules?|R\.)\s*(\d+[A-Z]?(?:\s*(?:,|and|&|to)\s*\d+[A-Z]?)*)/gi,
  // "15 days", "fifteen (15) days", "one day", "1 days" — all the same period.
  days: /\b(\d+|[a-z]+(?:[-\s][a-z]+)?)\s+(?:\(\s*\d+\s*\)\s+)?days?\b/gi,
  citation: /\(\d{4}\)\s*\d+\s*SCC\s*\d+|\d{4}\s*SCC\s*OnLine\s*[A-Za-z]+\s*\d+|AIR\s*\d{4}\s*[A-Z][A-Za-z]*\s*\d+/g,
  marker: /\[[^\]\n]{2,60}\]/g,
};

/** Markers the composer is SUPPOSED to replace with drafted prose. */
const FILLABLE_MARKERS = new Set(['[to be drafted]']);

export interface Particular {
  kind: 'amount' | 'date' | 'section' | 'article' | 'order' | 'days' | 'citation' | 'marker';
  /** Canonical comparison key. */
  key: string;
  /** As written, for messages. */
  raw: string;
}

const UNITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven',
  'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/** "15" / "fifteen" / "forty-five" / "ninety" -> 15 / 15 / 45 / 90; null if not a number. */
function countOf(word: string): number | null {
  if (/^\d+$/.test(word)) return Number(word);
  const parts = word.toLowerCase().split(/[-\s]/);
  let n = 0;
  for (const p of parts) {
    const u = UNITS.indexOf(p);
    const t = TENS.indexOf(p);
    if (u >= 0) n += u;
    else if (t >= 2) n += t * 10;
    else return null;
  }
  return n;
}

const pad = (n: number) => String(n).padStart(2, '0');
const dateKey = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

export function particularsOf(text: string): Particular[] {
  const out: Particular[] = [];
  const push = (kind: Particular['kind'], key: string, raw: string) => out.push({ kind, key, raw: raw.trim() });
  for (const m of text.matchAll(RX.amount)) {
    const digits = m[1]!.split('.')[0]!.replace(/\D/g, '');
    if (digits) push('amount', String(Number(digits)), m[0]);
  }
  for (const m of text.matchAll(RX.dmy)) push('date', dateKey(+m[3]!, +m[2]!, +m[1]!), m[0]);
  for (const m of text.matchAll(RX.ymd)) push('date', dateKey(+m[1]!, +m[2]!, +m[3]!), m[0]);
  for (const m of text.matchAll(RX.wordy)) {
    const mon = MONTHS[m[2]!.slice(0, 3).toLowerCase()];
    if (mon) push('date', dateKey(+m[3]!, mon, +m[1]!), m[0]);
  }
  for (const m of text.matchAll(RX.section)) push('section', m[1]!.replace(/\s+/g, '').toLowerCase(), m[0]);
  for (const m of text.matchAll(RX.actSection)) push('section', m[1]!.replace(/\s+/g, '').toLowerCase(), m[0]);
  for (const m of text.matchAll(RX.article)) push('article', m[1]!.replace(/\s+/g, '').toLowerCase(), m[0]);
  for (const m of text.matchAll(RX.order)) {
    const rules = m[2]!.split(/\s*(?:,|and|&|to)\s*/).map((r) => r.toUpperCase()).join(',');
    push('order', `${orderNumber(m[1]!)}:${rules}`, m[0]);
  }
  for (const m of text.matchAll(RX.days)) {
    // A two-word capture like "within fifteen" falls back to its last word.
    const n = countOf(m[1]!) ?? countOf(m[1]!.split(/[-\s]/).pop()!);
    if (n !== null) push('days', String(n), m[0]);
  }
  for (const m of text.matchAll(RX.citation)) push('citation', m[0].replace(/\s+/g, '').toLowerCase(), m[0]);
  for (const m of text.matchAll(RX.marker)) {
    const k = m[0].toLowerCase();
    if (!FILLABLE_MARKERS.has(k)) push('marker', k, m[0]);
  }
  return out;
}

const keyOf = (p: Particular) => `${p.kind}:${p.key}`;

/** Particulars present in `source` but missing from `composed` (one per key). */
export function lostParticulars(source: string, composed: string): Particular[] {
  const have = new Set(particularsOf(composed).map(keyOf));
  const haveList = [...have];
  const seen = new Set<string>();
  return particularsOf(source).filter((p) => {
    const k = keyOf(p);
    if (have.has(k) || seen.has(k)) return false;
    if (k === 'amount:0') return false; // draft-now's sentinel for a missing figure
    // "s.13(1)" is kept by its own clause "s.13(1)(ia)" — the precision rule asks
    // for the operative clause, which must not read as dropping the parent.
    if ((p.kind === 'section' || p.kind === 'article') && haveList.some((h) => h.startsWith(`${k}(`))) return false;
    seen.add(k);
    return true;
  });
}

/** Particulars in `composed` that appear in none of `allowedSources`. Totals are
 *  allowed: the sum of all source amounts, and of any two, is not an invention. */
export function introducedParticulars(composed: string, allowedSources: string[]): Particular[] {
  const allowed = particularsOf(allowedSources.join('\n'));
  const keys = new Set(allowed.map(keyOf));
  const amounts = [...new Set(allowed.filter((p) => p.kind === 'amount').map((p) => Number(p.key)))];
  if (amounts.length > 1) {
    keys.add(`amount:${amounts.reduce((a, b) => a + b, 0)}`);
    for (let i = 0; i < amounts.length; i += 1) {
      for (let j = i + 1; j < amounts.length; j += 1) keys.add(`amount:${amounts[i]! + amounts[j]!}`);
    }
  }
  const seen = new Set<string>();
  return particularsOf(composed).filter((p) => {
    const k = keyOf(p);
    if (keys.has(k) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Sentences that cite a section/article found in no allowed source and not
 * covered by an authority. A citation is covered when an authority carries the
 * same provision AND its Act is named in that sentence (so "Section 480" is
 * authorised for the BNSS, not for some other Act's s.480). An article needs no
 * Act name: in a pleading "Article 21" is the Constitution's.
 *  -> the sentences to strip (pass them to stripSentences as needles).
 */
export function unauthorisedCitations(
  paragraphs: string[],
  allowedSources: string[],
  authorities: Array<{ cite: string; actPattern: string }>,
): string[] {
  const allowed = new Set(particularsOf(allowedSources.join('\n')).filter(isProvision).map(keyOf));
  const granted = authorities.map((a) => ({
    keys: new Set(particularsOf(a.cite).filter(isProvision).map(keyOf)),
    act: new RegExp(a.actPattern, 'i'),
  }));
  const bad: string[] = [];
  for (const para of paragraphs) {
    for (const s of sentencesOf(para)) {
      const ok = particularsOf(s).filter(isProvision).every((p) => {
        const k = keyOf(p);
        if (allowed.has(k)) return true;
        return granted.some((g) => g.keys.has(k) && (p.kind === 'article' || p.kind === 'order' || g.act.test(s)));
      });
      if (!ok) bad.push(s.trim());
    }
  }
  return bad;
}

const isProvision = (p: Particular) => p.kind === 'section' || p.kind === 'article' || p.kind === 'order';

/** "XXXIX" / "39" -> 39. */
function orderNumber(s: string): number {
  if (/^\d+$/.test(s)) return Number(s);
  const v: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };
  let n = 0;
  for (let i = 0; i < s.length; i += 1) {
    const cur = v[s[i]!.toUpperCase()] ?? 0;
    const next = v[s[i + 1]?.toUpperCase() ?? ''] ?? 0;
    n += cur < next ? -cur : cur;
  }
  return n;
}

// An Act's name paired with ANOTHER Act's abbreviation — the classic slip of the new
// criminal codes: "Bharatiya Nagarik Suraksha Sanhita (BNS)" (BNS is the Nyaya Sanhita).
const ACT_MISNAMES: RegExp[] = [
  /Nagarik\s+Suraksha\s+Sanhita[^.;()]{0,12}\(\s*BNS\s*\)/i,
  /Nyaya\s+Sanhita[^.;()]{0,12}\(\s*BNSS\s*\)/i,
  /Sakshya\s+Adhiniyam[^.;()]{0,12}\(\s*BNSS?\s*\)/i,
  /Nyaya\s+Sanhita[^.;()]{0,12}\(\s*BSA\s*\)/i,
  /Nagarik\s+Suraksha\s+Sanhita[^.;()]{0,12}\(\s*BSA\s*\)/i,
  /Indian\s+Penal\s+Code[^.;()]{0,12}\(\s*Cr\.?P\.?C\.?\s*\)/i,
  /Code\s+of\s+Criminal\s+Procedure[^.;()]{0,12}\(\s*IPC\s*\)/i,
];

/** Sentences that name an Act and abbreviate it as a different Act. */
export function misnamedActs(paragraphs: string[]): string[] {
  return paragraphs.flatMap((p) => sentencesOf(p)).filter((s) => ACT_MISNAMES.some((re) => re.test(s))).map((s) => s.trim());
}

const squash = (s: string) => s.toLowerCase().replace(/[\s.,;:'"“”‘’()/-]+/g, '');

// Sentence split that does not break on "Rs.", "No.", "s.", "Hon'ble", initials or numbering.
const SENTENCE = /(?<!\b(?:Rs|No|Nos|s|ss|Sec|Art|Thiru|Tmt|Mr|Mrs|Ms|Dr|M\/s|v|vs|viz|Ors|ors|Anr|anr|Etc|etc|i\.e|e\.g|Ltd|Pvt|Co|[A-Z]|\d+))[.;](?=\s+[A-Z(“"])/;

export function sentencesOf(paragraph: string): string[] {
  const parts: string[] = [];
  let rest = paragraph;
  for (;;) {
    const m = SENTENCE.exec(rest);
    if (!m) break;
    parts.push(rest.slice(0, m.index + 1));
    rest = rest.slice(m.index + 1);
  }
  parts.push(rest);
  return parts.filter((s) => s.trim());
}

/** Remove every sentence that contains one of `needles` (compared squashed).
 *  A paragraph emptied this way is dropped. `unresolved` = needles found nowhere —
 *  the caller should then not trust the text. */
export function stripSentences(
  paragraphs: string[],
  needles: string[],
  /** Put this in place of each removed sentence (once per run) instead of
   *  deleting it, so a mandatory averment keeps its slot and nothing dangles. */
  replacement?: string,
): { paragraphs: string[]; removed: string[]; unresolved: string[] } {
  const wanted = needles.map((n) => ({ raw: n, sq: squash(n) })).filter((n) => n.sq.length >= 3);
  const hit = new Set<string>();
  const removed: string[] = [];
  const out: string[] = [];
  for (const para of paragraphs) {
    const kept: string[] = [];
    for (const s of sentencesOf(para)) {
      const sq = squash(s);
      const match = wanted.filter((n) => sq.includes(n.sq));
      if (match.length) {
        match.forEach((n) => hit.add(n.raw));
        removed.push(s.trim());
        // One marker for a run of removed sentences.
        if (replacement && !kept[kept.length - 1]?.trim().endsWith(replacement)) {
          // A removed opening sentence keeps its paragraph number / ground letter.
          const lead = /^\s*(?:\d+[A-Z]?|[A-Z])[.)]\s+/.exec(s)?.[0] ?? '';
          kept.push(`${kept.length ? ' ' : ''}${lead.trim() ? `${lead.trim()} ` : ''}${replacement}`);
        }
      } else {
        kept.push(s);
      }
    }
    const text = kept.join('').trim();
    // A paragraph reduced to just its number ("7.") carries nothing.
    if (text && !/^\s*\d+[A-Z]?\s*[.)]?\s*$/.test(text)) out.push(text);
  }
  return {
    paragraphs: out,
    removed,
    unresolved: wanted.filter((n) => !hit.has(n.raw)).map((n) => n.raw),
  };
}

// ---- judgment citations ------------------------------------------------------
//
// Every form a case citation takes in an Indian pleading, so a citation can be
// checked against the judgments we actually hold (judgments.service /
// research.service) instead of trusted:
//   (2021) 4 SCC 412 · 2023 SCC OnLine Mad 1187 · AIR 1978 SC 597   (as RX.citation)
//   2024 INSC 735                                                    (SC neutral)
//   2023:MHC:1234 · 2024:AHC-LKO:123                                (HC neutral)
//   (2019) 5 MLJ 100 · (2019) 2 MLJ (Crl) 100 · [2024] 10 S.C.R. 108 (reporters)
//   2011 [5] SCC 244 · 2004 (3) CTC 100                              (year-first reporters)
const REPORTER = String.raw`(?:[A-Z][A-Za-z]*\.?\s*){1,4}(?:\((?:[A-Z][a-z]*|[A-Z]{2,4})\.?\)\s*)?\d{1,5}\b`;
const JUDGMENT_CITATION = new RegExp(
  [
    String.raw`\b\d{4}\s*SCC\s*OnLine\s*[A-Z][A-Za-z]*\.?\s*\d+\b`,
    String.raw`\bAIR\s*\d{4}\s*[A-Z][A-Za-z]*\.?\s*\d+\b`,
    String.raw`\b\d{4}\s*INSC\s*\d+\b`,
    String.raw`\b\d{4}:[A-Z]{2,8}(?:-[A-Z]{2,4})?:\d{1,6}\b`,
    String.raw`\(\d{4}\)\s*\d{1,3}\s*${REPORTER}`,
    String.raw`\[\d{4}\]\s*\d{1,3}\s*${REPORTER}`,
    String.raw`\b\d{4}\s*[[(]\d{1,3}[\])]\s*${REPORTER}`,
  ].join('|'),
  'g',
);

/** Comparison key for a citation: "(2019) 5 M.L.J. 100" == "(2019)5 MLJ 100". */
export function citationKey(citation: string): string {
  return citation.toLowerCase().replace(/[\s.,]+/g, '');
}

/** Case citations in `text`, as written, in order, one per distinct key. */
export function judgmentCitationsIn(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(JUDGMENT_CITATION)) {
    const raw = m[0].replace(/\s+/g, ' ').trim();
    const key = citationKey(raw);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(raw);
  }
  return out;
}
