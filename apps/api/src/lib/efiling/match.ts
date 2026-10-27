import type { CnrCandidateDto } from './types';

// =============================================================================
// Matching an e-filed case to its registered eCourts record.
//
// A party-name search on eCourts returns every case in the establishment
// whose petitioner matches, so the result has to be narrowed before DifAI
// links anything: a wrong CNR would import someone else's hearings into the
// advocate's diary. Rules:
//   - names are compared as normalised token sets (honorifics, "S/o …" tails,
//     punctuation and M/s dropped), so "Sri. K. Ramesh Kumar S/o Krishnan"
//     matches "K RAMESH KUMAR";
//   - BOTH sides must match when the respondent is known;
//   - CNRs already used by another matter in the firm are excluded;
//   - only a single surviving candidate is linked automatically. Anything
//     else is handed back to the advocate to choose.
// =============================================================================

const HONORIFICS = new Set([
  'MR', 'MRS', 'MS', 'MISS', 'SMT', 'SHRI', 'SRI', 'SHRIMATI', 'KUM', 'KUMARI', 'DR', 'ADV',
  'MS/S', 'M/S', 'MESSRS', 'THE', 'AND', 'ORS', 'OTHERS', 'ANR', 'ANOTHER',
]);

/** Uppercase token set with honorifics, parentage tails and punctuation removed. */
export function nameTokens(raw: string | null | undefined): string[] {
  let s = (raw ?? '').toUpperCase();
  // Cut parentage / alias tails: "X S/O Y", "X W/O Y", "X @ Y", "X ALIAS Y".
  s = s.replace(/\b(S|D|W|C)\s*\/\s*O\b.*$/, ' ').replace(/\b(SON|DAUGHTER|WIFE)\s+OF\b.*$/, ' ');
  s = s.replace(/\s@\s.*$/, ' ').replace(/\bALIAS\b.*$/, ' ');
  s = s.replace(/M\s*\/\s*S\.?/g, ' ');
  s = s.replace(/[^A-Z0-9 ]+/g, ' ');
  return s
    .split(/\s+/)
    .filter((t) => t.length > 0 && !HONORIFICS.has(t))
    // Single initials ("K", "R") are kept - they disambiguate common names.
    .filter((t, i, all) => all.indexOf(t) === i);
}

/** Share of the shorter name's meaningful tokens found in the longer one. */
export function nameSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  const [shorter, longer] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const set = new Set(longer);
  // Initials count half: "K RAMESH" vs "KRISHNAN RAMESH" shouldn't be a full hit.
  let score = 0;
  let weight = 0;
  for (const t of shorter) {
    const w = t.length === 1 ? 0.5 : 1;
    weight += w;
    if (set.has(t)) score += w;
  }
  return weight === 0 ? 0 : score / weight;
}

const MATCH_THRESHOLD = 0.75;

/** Split an eCourts "PET v. RES" candidate title into its two sides. */
export function splitTitle(title: string): { pet: string; res: string } {
  const m = title.split(/\s+v(?:s|\/s)?\.?\s+/i);
  return { pet: m[0] ?? '', res: m.slice(1).join(' v. ') };
}

export interface MatchInput {
  petitioner: string;
  respondent?: string | null;
  candidates: CnrCandidateDto[];
  /** CNRs already attached to other matters in the firm. */
  takenCnrs?: ReadonlySet<string>;
}

export function narrowCandidates(input: MatchInput): CnrCandidateDto[] {
  const out: CnrCandidateDto[] = [];
  for (const c of input.candidates) {
    if (input.takenCnrs?.has(c.cino)) continue;
    const { pet, res } = splitTitle(c.title);
    if (nameSimilarity(input.petitioner, pet) < MATCH_THRESHOLD) continue;
    if (input.respondent && res && nameSimilarity(input.respondent, res) < MATCH_THRESHOLD) continue;
    out.push(c);
  }
  return out;
}
