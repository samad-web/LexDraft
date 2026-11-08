// =============================================================================
// draft-local-edit — redraft instructions that need no AI.
//
// "change 10.11.2026 to 15.11.2026", "replace Mr. Kumar with Mr. Ravi",
// "delete para 5", "add para after 7: <text>" are exact edits: a model call would
// only cost money and risk touching something else. This turns such an instruction
// into paragraph edits; anything it cannot read with certainty returns null and
// goes to the AI as before. Same output shape, so the advocate still sees
// before/after and accepts or discards.
// =============================================================================

import type { ReviseEdit } from '../services/draft-revise.service';

export interface LocalEdit {
  edits: ReviseEdit[];
  summary: string;
  warnings: string[];
}

const LEAD = /^(?:please\s+|kindly\s+)?/i;
const unquote = (s: string) => s.trim().replace(/[.;]+$/, '').replace(/^["'“‘](.*)["'”’]$/, '$1').trim();
const quoted = (s: string) => /^\s*["'“‘].*["'”’][.;]?\s*$/.test(s);
const DATE = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/;
const AMOUNT = /^(?:(?:rs\.?|inr|₹)\s*)?(\d[\d,]*)(?:\/-)?$/i;

/** An exact value: quoted, or carrying a number, or a proper name ("Mr. A. Kumar",
 *  "Chennai"). "grounds" or "be stronger" are not, and go to the AI. */
function isExact(raw: string): boolean {
  const v = unquote(raw);
  if (!v || v.length > 200) return false;
  if (quoted(raw) || /\d/.test(v)) return true;
  return v.split(/\s+/).every((w) => /^[A-Z]/.test(w) || /^(?:of|and|the|&)$/.test(w)) && !/^(?:The|A|An)\s/.test(v);
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Matches the value as the draft may print it: 10.11.2026 = 10-11-2026 = 10/11/2026;
 *  Rs. 3,50,000 = 350000 = 3,50,000. Never inside a longer number or word. */
function valueRegex(value: string): RegExp {
  const date = DATE.exec(value);
  if (date) return new RegExp(`(?<![\\d./-])${date[1]}[./-]${date[2]}[./-]${date[3]}(?![\\d])`, 'g');
  const amount = AMOUNT.exec(value);
  if (amount) {
    const digits = amount[1]!.replace(/,/g, '').split('').map(esc).join(',?');
    return new RegExp(`(?<![\\d,])${digits}(?![\\d,]*\\d)`, 'g');
  }
  return new RegExp(`(?<![\\w])${esc(value)}(?![\\w])`, 'g');
}

function replaceEverywhere(oldRaw: string, newRaw: string, paragraphs: string[]): LocalEdit | null {
  if (!isExact(oldRaw) || !isExact(newRaw)) return null;
  const from = unquote(oldRaw);
  let to = unquote(newRaw);
  if (from === to) return null;
  const rx = valueRegex(from);
  // The draft's own way of writing the amount: only the digits change, "Rs. " stays.
  const fromAmount = AMOUNT.exec(from);
  const toAmount = AMOUNT.exec(to);
  if (fromAmount && toAmount) to = toAmount[1]!;
  let count = 0;
  const edits: ReviseEdit[] = [];
  paragraphs.forEach((p, index) => {
    const text = p.replace(rx, () => { count += 1; return to; });
    if (text !== p) edits.push({ op: 'replace', index, text });
  });
  if (!count) return null; // not in the draft: maybe a description of it, the AI can tell
  const warnings: string[] = [];
  if (fromAmount || /rs\.?\s*\d/i.test(from)) warnings.push('Amount changed: check the amount in words and any total, interest or court fee worked out from it.');
  if (DATE.test(from)) warnings.push('Date changed: check any limitation, period or later date worked out from it.');
  return { edits, summary: `Changed "${from}" to "${to}" in ${count} place${count === 1 ? '' : 's'}.`, warnings };
}

/** The paragraph printed with this number ("5." / "5)"), only if exactly one is. */
function printedPara(n: string, paragraphs: string[]): number | null {
  const rx = new RegExp(`^\\s*${n}\\s*[.)]\\s`);
  const hits = paragraphs.flatMap((p, i) => (rx.test(p) ? [i] : []));
  return hits.length === 1 ? hits[0]! : null;
}

const RENUMBER = 'Paragraph numbers were not changed: renumber, and check any reference to them.';

export function localEdit(instruction: string, paragraphs: string[]): LocalEdit | null {
  const text = instruction.trim().replace(LEAD, '');

  const del = /^(?:delete|remove|omit|strike\s+out|drop)\s+(?:the\s+)?(?:para(?:graph)?\.?\s*(?:no\.?\s*)?(\d{1,3})|(\d{1,3})(?:st|nd|rd|th)?\s+para(?:graph)?)\s*(?:fully|completely|entirely)?\s*\.?$/i.exec(text)
    ?? /^()para(?:graph)?\.?\s*(?:no\.?\s*)?(\d{1,3})\s+(?:delete|remove|omit|to be deleted|should be deleted|not needed)\s*\.?$/i.exec(text);
  if (del) {
    const n = del[1] || del[2]!;
    const index = printedPara(n, paragraphs);
    return index === null ? null : { edits: [{ op: 'delete', index }], summary: `Deleted paragraph ${n}.`, warnings: [RENUMBER] };
  }

  const add = /^(?:add|insert)\s+(?:a\s+|new\s+|a\s+new\s+)?para(?:graph)?\s+after\s+(?:para(?:graph)?\.?\s*)?(\d{1,3})\s*[:-]\s*(.+)$/is.exec(text);
  if (add) {
    const index = printedPara(add[1]!, paragraphs);
    return index === null ? null : { edits: [{ op: 'insert_after', index, text: add[2]!.trim() }], summary: `Added a paragraph after paragraph ${add[1]}.`, warnings: [RENUMBER] };
  }

  // How advocates phrase a correction. Each yields [old, new].
  const verb = '(?:change|replace|correct|update|substitute|modify|make)';
  const should = String.raw`(?:it\s+)?(?:should\s+be|must\s+be|should\s+read|must\s+read|to\s+be\s+read\s+as)`;
  const pick = (rx: RegExp, oldAt: number, newAt: number): [string, string] | null => {
    const m = rx.exec(text);
    return m ? [m[oldAt]!, m[newAt]!] : null;
  };
  const pair = pick(new RegExp(String.raw`^${verb}\s+.*?\bfrom\s+(.+?)\s+to\s+(.+)$`, 'is'), 1, 2)
    ?? pick(new RegExp(String.raw`^${verb}\s+(.+?)\s+(?:with|by)\s+(.+)$`, 'is'), 1, 2)
    ?? pick(new RegExp(String.raw`^${verb}\s+(.+?)\s+(?:to|as)\s+(.+)$`, 'is'), 1, 2)
    ?? pick(/^(?:instead\s+of|in\s+place\s+of)\s+(.+?)\s*,?\s*(?:put|use|write|type|mention|insert|read|keep)\s+(.+)$/is, 1, 2)
    ?? pick(new RegExp(String.raw`^(?:instead\s+of|in\s+place\s+of)\s+(.+?)\s*,?\s*${should}\s+(.+)$`, 'is'), 1, 2)
    ?? pick(new RegExp(String.raw`^.*?${should}\s+(.+?)\s+(?:instead\s+of|in\s+place\s+of|and\s+not|not)\s+(.+)$`, 'is'), 2, 1)
    ?? pick(new RegExp(String.raw`^(.+?)\s+(?:is\s+)?(?:wrong|incorrect)\s*[,.;-]*\s*${should}\s+(.+)$`, 'is'), 1, 2)
    ?? pick(new RegExp(String.raw`^(.+?)\s+${should}\s+(.+)$`, 'is'), 1, 2);
  return pair ? replaceEverywhere(pair[0], pair[1], paragraphs) : null;
}
