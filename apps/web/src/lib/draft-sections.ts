// =============================================================================
// draft-sections — find the named sections of a draft (facts, grounds, prayer…)
// and map a text selection back to paragraph indices, for the Redraft card's
// "Change only…" scope.
//
// Mirrors detectSections in apps/api/src/services/draft-revise.service.ts (the
// API uses its copy to auto-scope "rewrite the grounds"). Keep the two in step;
// the API re-labels whatever range the client sends, so a drift only affects
// which choices the menu offers.
// =============================================================================

const SECTION_WORDS =
  '(?:brief\\s+)?(?:statement\\s+of\\s+)?facts?(?:\\s+of\\s+the\\s+case)?|grounds?(?:\\s+of\\s+\\w+)?|prayers?|reliefs?(?:\\s+sought)?|' +
  'interim\\s+(?:relief|prayer)|jurisdiction|limitation|cause\\s+of\\s+action|valuation(?:\\s+and\\s+court\\s+fee)?|court\\s+fees?|' +
  'verification|list\\s+of\\s+(?:documents|witnesses)|submissions?|averments?|particulars|description\\s+of\\s+the\\s+\\w+';
const NUMBERING = '(?:[A-Z]\\.|[IVXL]+\\.|\\d+\\.|\\(\\w+\\))?\\s*';
const HEADING_ONLY = new RegExp(`^\\s*${NUMBERING}(${SECTION_WORDS})\\s*[:.\\-–—]?\\s*$`, 'i');
const HEADING_INLINE = new RegExp(`^\\s*${NUMBERING}(${SECTION_WORDS})\\s*[:\\-–—]\\s*\\S`, 'i');
const END_MARKER = /^\s*(?:place|dated?|station)\s*[:-]|^\s*(?:advocate|counsel)s?\s+for\b|^\s*(?:through|filed\s+by)\b|^\s*in\s+the\s+(?:hon'?ble\s+)?(?:high\s+)?court\b|^\s*before\s+the\b|^\s*\/*\s*true\s+copy/i;

export interface DraftSection {
  title: string;
  /** Inclusive 0-based paragraph range of the section's content. */
  from: number;
  to: number;
}

export function detectSections(paragraphs: string[]): DraftSection[] {
  const opens: Array<{ title: string; index: number; inline: boolean }> = [];
  const closes = new Set<number>();
  paragraphs.forEach((p, i) => {
    if (HEADING_ONLY.test(p)) { opens.push({ title: p.trim().replace(/[:.\-–—\s]+$/, ''), index: i, inline: false }); return; }
    const inline = HEADING_INLINE.exec(p);
    if (inline) { opens.push({ title: inline[1]!.trim().toUpperCase(), index: i, inline: true }); return; }
    if (END_MARKER.test(p)) closes.add(i);
  });
  const out: DraftSection[] = [];
  opens.forEach((o, k) => {
    const from = o.inline ? o.index : o.index + 1;
    let to = (opens[k + 1]?.index ?? paragraphs.length) - 1;
    for (let i = from + 1; i <= to; i += 1) {
      if (closes.has(i)) { to = i - 1; break; }
    }
    if (from <= to && from < paragraphs.length) out.push({ title: o.title, from, to });
  });
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** The paragraph range a selection of the draft text covers, or null when it
 *  can't be placed (e.g. it came from somewhere else on the page). */
export function rangeFromSelection(paragraphs: string[], selection: string): { from: number; to: number } | null {
  const lines = selection.split(/\n+/).map(norm).filter((l) => l.length >= 3);
  if (!lines.length) return null;
  const paras = paragraphs.map(norm);
  const covers = (para: string, probe: string) => para.length >= 3 && (para.includes(probe) || probe.includes(para));
  const head = lines[0]!.slice(0, 60);
  const from = paras.findIndex((p) => covers(p, head));
  if (from < 0) return null;
  const tail = lines[lines.length - 1]!.slice(-60);
  let to = from;
  for (let i = from; i < paras.length; i += 1) {
    if (covers(paras[i]!, tail)) { to = i; break; }
  }
  return { from, to };
}
