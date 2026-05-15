/**
 * Sanhita translator service.
 *
 * Maps the colonial-era criminal trilogy onto the 2023 Sanhitas:
 *   IPC  → Bharatiya Nyaya Sanhita        (BNS)
 *   CrPC → Bharatiya Nagarik Suraksha     (BNSS)
 *   IEA  → Bharatiya Sakshya Adhiniyam    (BSA)
 *
 * Data lives in apps/api/src/data/sanhita-map.json - a curated, hand-edited
 * table of the most-cited renumberings. Coverage is intentionally narrow:
 * we'd rather be silent than wrong on cross-referencing. Entries marked with
 * `substantiveChange: "UNVERIFIED - counsel review required"` are best-guesses
 * pending verification; callers should surface that wording verbatim.
 *
 * All three exported functions are pure and synchronous (the JSON loads at
 * import time) - no database, no firm scoping.
 */

import mappings from '../data/sanhita-map.json';
import type {
  NewAct,
  OldAct,
  SanhitaMapping,
  ScanHit,
  ScanResult,
  ScanSuggestion,
} from '../types/sanhita.types';

const TABLE: SanhitaMapping[] = mappings as SanhitaMapping[];

// Pre-computed indexes so lookups are O(1) and scan() doesn't re-scan the
// table for every match. Keys are uppercased so callers can pass "ipc"/"IPC".
const byOld: Map<string, SanhitaMapping> = (() => {
  const m = new Map<string, SanhitaMapping>();
  for (const row of TABLE) {
    m.set(`${row.fromAct.toUpperCase()}::${row.fromSection.toUpperCase()}`, row);
  }
  return m;
})();

const byNew: Map<string, SanhitaMapping> = (() => {
  const m = new Map<string, SanhitaMapping>();
  for (const row of TABLE) {
    if (!row.toSection) continue;
    m.set(`${row.toAct.toUpperCase()}::${row.toSection.toUpperCase()}`, row);
  }
  return m;
})();

function normalizeSection(s: string): string {
  // Strip a leading "S." / "Sec." / "§" / "section" if a caller passes it.
  // Keep alphanumeric + parenthesised sub-clauses (e.g. "120A", "61(2)").
  return s
    .trim()
    .replace(/^(section|sec\.?|s\.?|§)\s*/i, '')
    .toUpperCase();
}

export interface LookupInput {
  act: string;
  section: string;
}

/**
 * Match an old (IPC/CrPC/IEA) section and return its replacement in BNS/BNSS/BSA.
 * Returns null when the section is outside our curated table.
 */
export function lookupByOldSection(input: LookupInput): SanhitaMapping | null {
  const key = `${input.act.toUpperCase()}::${normalizeSection(input.section)}`;
  return byOld.get(key) ?? null;
}

/**
 * Reverse lookup: given a new section number (e.g. BNS 103), return the old
 * IPC/CrPC/IEA section it derives from. Useful when a user is reading the
 * Sanhita and wants to find pre-2024 case law.
 */
export function lookupByNewSection(input: LookupInput): SanhitaMapping | null {
  const key = `${input.act.toUpperCase()}::${normalizeSection(input.section)}`;
  return byNew.get(key) ?? null;
}

// ---- Text scanning ---------------------------------------------------------
//
// We look for the common Indian-drafting patterns:
//   "Sec. 302 IPC", "Section 138 of the NI Act", "S. 161 Cr.P.C.",
//   "§65B of the Evidence Act", "u/s 420 IPC", "IPC § 420", etc.
//
// The regex is deliberately tolerant - it accepts an optional sub-clause in
// parentheses (e.g. "120(A)") because counsel write these inconsistently.

const ACT_ALIASES: Record<OldAct, RegExp> = {
  IPC: /\b(IPC|I\.P\.C\.|Indian\s+Penal\s+Code|Penal\s+Code,?\s*1860)\b/i,
  CrPC: /\b(Cr\.?P\.?C\.?|CrPC|Code\s+of\s+Criminal\s+Procedure(?:,?\s*1973)?)\b/i,
  IEA: /\b(IEA|Indian\s+Evidence\s+Act(?:,?\s*1872)?|Evidence\s+Act(?:,?\s*1872)?)\b/i,
};

// Capture group 1 = section number (with optional sub-clause). The two
// alternations let us catch both orderings: "Sec X <Act>" and "<Act> Sec X".
function buildScanRegex(act: OldAct): RegExp {
  const actSrc = ACT_ALIASES[act].source;
  // Section number: digits + optional letter (e.g. 304A) + optional (sub).
  const sectionSrc = String.raw`(\d{1,4}[A-Z]?(?:\([0-9A-Za-z]+\))?)`;
  // Order A: "Sec. 302 IPC" / "u/s 138 NI Act" / "§161 Cr.P.C."
  const orderA = String.raw`(?:(?:u\/s|under\s+section|sec(?:tion)?\.?|s\.?|§)\s*)?${sectionSrc}\s*(?:of\s+(?:the\s+)?)?${actSrc}`;
  // Order B: "IPC Sec. 302" / "Cr.P.C. §161"
  const orderB = String.raw`${actSrc}[\s,]*(?:sec(?:tion)?\.?|s\.?|§)?\s*${sectionSrc}`;
  return new RegExp(`(?:${orderA})|(?:${orderB})`, 'gi');
}

// Build once at module load.
const SCAN_REGEXES: Array<{ act: OldAct; rx: RegExp }> = (['IPC', 'CrPC', 'IEA'] as OldAct[])
  .map((act) => ({ act, rx: buildScanRegex(act) }));

/**
 * Scan a draft body for stale IPC/CrPC/IEA references and return the matches
 * along with their proposed replacements. The shape is `{ found, suggestions }`
 * so callers can render found-but-unmapped hits separately if they want.
 *
 * Implementation notes:
 *  - The regexes are run separately per Act to avoid combinatorial alternation
 *    blowups and to keep the per-Act group ordering deterministic.
 *  - Overlapping matches are de-duplicated by [index, length] - the same span
 *    won't be reported twice when multiple regexes happen to fire on it.
 */
export function scanText(body: string): ScanResult {
  if (!body || typeof body !== 'string') return { found: [], suggestions: [] };

  const seen = new Set<string>();
  const found: ScanHit[] = [];

  for (const { act, rx } of SCAN_REGEXES) {
    rx.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rx.exec(body)) !== null) {
      // The section number is in one of two capture groups depending on which
      // alternation matched. Find the first non-undefined numeric group.
      const sectionRaw = m.slice(1).find((g) => g && /^\d/.test(g));
      if (!sectionRaw) continue;
      const idx = m.index;
      const len = m[0].length;
      const key = `${idx}::${len}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({
        match: m[0],
        index: idx,
        length: len,
        fromAct: act,
        fromSection: normalizeSection(sectionRaw),
      });
    }
  }

  found.sort((a, b) => a.index - b.index);

  const suggestions: ScanSuggestion[] = found.map((hit) => ({
    ...hit,
    mapping: lookupByOldSection({ act: hit.fromAct, section: hit.fromSection }),
  }));

  return { found, suggestions };
}

// ---- Bulk export ----------------------------------------------------------

/** Return the full curated mapping table. Used by /api/sanhita?act=… etc. */
export function listMappings(filter?: { fromAct?: OldAct; toAct?: NewAct }): SanhitaMapping[] {
  if (!filter) return TABLE.slice();
  return TABLE.filter((row) =>
    (!filter.fromAct || row.fromAct === filter.fromAct) &&
    (!filter.toAct   || row.toAct   === filter.toAct),
  );
}

export const sanhitaService = {
  lookupByOldSection,
  lookupByNewSection,
  scanText,
  listMappings,
};
