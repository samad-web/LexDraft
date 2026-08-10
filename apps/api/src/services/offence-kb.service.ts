/**
 * Offence KB retrieval service.
 *
 * Feeds Stage 2 (CLASSIFY) of the drafting pipeline with CANDIDATE offences drawn
 * from offence-kb.json, so the classifier can only ever choose from real,
 * KB-backed sections — never from the model's memory. See drafting-prompts.ts and
 * offence-kb.types.ts for the grounding contract.
 *
 * Retrieval here is lexical (alias / keyword / ingredient match) — deliberately
 * simple and dependency-free, mirroring sanhita.service.ts. A vector layer can be
 * added later behind the same `search()` signature without changing callers; the
 * scoring is kept transparent so results are explainable to counsel.
 *
 * All functions are pure and synchronous (the JSON loads at import time). The
 * `verification` gate is NOT applied here — retrieval returns candidates
 * regardless of status; the orchestrator applies the gate when deciding whether a
 * chosen section may be cited as VERIFIED vs SUGGESTED.
 */

import kb from '../data/offence-kb.json';
import type { OffenceEntry, OffenceKb } from '../types/offence-kb.types';

const DATA = kb as OffenceKb;
const ENTRIES: OffenceEntry[] = DATA.entries;

// ---- Indexes (built once at module load) -----------------------------------

const byId: Map<string, OffenceEntry> = (() => {
  const m = new Map<string, OffenceEntry>();
  for (const e of ENTRIES) m.set(e.id, e);
  return m;
})();

/** Index by "LAW::SECTION" (e.g. "BNS::318(4)") for exact section lookups. */
const bySection: Map<string, OffenceEntry> = (() => {
  const m = new Map<string, OffenceEntry>();
  for (const e of ENTRIES) m.set(`${e.law.toUpperCase()}::${e.section.toUpperCase()}`, e);
  return m;
})();

// ---- Text helpers ----------------------------------------------------------

/** Lowercase, collapse whitespace, drop punctuation that hurts token overlap. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Very light suffix stemmer so "misappropriated"/"misappropriation",
// "attacked"/"attack", "inducing"/"induce" collapse to a shared stem. This is a
// crude Porter-lite step, NOT linguistic stemming — enough to lift lexical recall
// on loosely-worded briefs. A proper analyzer / vector layer supersedes it later.
const STOPWORDS = new Set([
  'the', 'and', 'was', 'were', 'with', 'for', 'from', 'that', 'this', 'his', 'her',
  'him', 'she', 'has', 'have', 'had', 'are', 'any', 'out', 'who', 'not', 'into',
  'per', 'via', 'said', 'says', 'client', 'complainant', 'accused',
]);

function stem(token: string): string {
  let t = token;
  for (const suf of ['ation', 'ing', 'edly', 'ied', 'ies', 'ed', 'es', 's']) {
    if (t.length > suf.length + 2 && t.endsWith(suf)) {
      t = t.slice(0, -suf.length);
      break;
    }
  }
  return t;
}

/** Split into unique stemmed content tokens, dropping noise and stopwords. */
function tokenize(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of normalize(text).split(' ')) {
    if (raw.length <= 1 || STOPWORDS.has(raw)) continue;
    out.add(stem(raw));
  }
  return out;
}

// Pre-tokenise each entry's searchable surface once, so search() is cheap.
interface Indexed {
  entry: OffenceEntry;
  /** Normalised alias phrases, for phrase (substring) hits. */
  aliasPhrases: string[];
  /** Bag of tokens from name + aliases + ingredients, for token-overlap. */
  tokens: Set<string>;
}
const INDEXED: Indexed[] = ENTRIES.map((entry) => {
  const aliasPhrases = entry.aliases.map(normalize);
  const bag = [entry.offenceName, ...entry.aliases, ...entry.essentialIngredients].join(' ');
  return { entry, aliasPhrases, tokens: tokenize(bag) };
});

// ---- Search ----------------------------------------------------------------

export interface OffenceHit {
  entry: OffenceEntry;
  /** 0..1 relevance; higher is better. Explainable, not a black box. */
  score: number;
  /** Why it matched, for surfacing to counsel / debugging. */
  reason: 'alias-phrase' | 'token-overlap';
}

export interface SearchOptions {
  /** Max hits to return (default 6 — a sane candidate-list size for Stage 2). */
  limit?: number;
  /** Minimum score to include (default 0.12 — filters weak token noise). */
  minScore?: number;
}

const DEFAULT_LIMIT = 6;
// With stemming the overlap scores are meaningful at lower values; keep a small
// floor to drop single-common-word noise but not real partial matches.
const DEFAULT_MIN_SCORE = 0.04;
// Phrase hits always outrank token overlap. Within phrase hits, a closer
// length match (query ≈ alias) beats a generic short alias buried in a long
// query, so "grievous hurt" prefers the grievous-hurt entry over plain "hurt".
const PHRASE_BASE = 0.9;

/**
 * Retrieve candidate offences for a plain-language query (the advocate's words,
 * or a Stage-1 `alleged_offences` phrase). Alias phrase-hits rank above loose
 * token overlap so "cheating" lands squarely on the cheating entry.
 */
export function search(query: string, opts: SearchOptions = {}): OffenceHit[] {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const minScore = opts.minScore ?? DEFAULT_MIN_SCORE;
  const q = normalize(query);
  if (!q) return [];
  const qTokens = tokenize(query);
  if (qTokens.size === 0) return [];

  const hits: OffenceHit[] = [];
  for (const { entry, aliasPhrases, tokens } of INDEXED) {
    // 1) Strong signal: an alias phrase appears in the query (or vice-versa).
    //    Score by how specific the match is — the length ratio between the
    //    matched alias and the query — so a precise alias beats a generic one.
    let bestPhrase = 0;
    for (const a of aliasPhrases) {
      if (!a) continue;
      if (q.includes(a) || a.includes(q)) {
        const ratio = Math.min(a.length, q.length) / Math.max(a.length, q.length);
        bestPhrase = Math.max(bestPhrase, PHRASE_BASE + (1 - PHRASE_BASE) * ratio);
      }
    }
    if (bestPhrase > 0) {
      hits.push({ entry, score: bestPhrase, reason: 'alias-phrase' });
      continue;
    }
    // 2) Fallback: Jaccard-style token overlap against the entry's bag.
    let shared = 0;
    for (const t of qTokens) if (tokens.has(t)) shared += 1;
    if (shared === 0) continue;
    const denom = qTokens.size + tokens.size - shared;
    const score = denom > 0 ? shared / denom : 0;
    if (score >= minScore) hits.push({ entry, score, reason: 'token-overlap' });
  }

  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

/**
 * Convenience for Stage 1 → Stage 2: take the extractor's `alleged_offences`
 * (each a plain-language phrase) and return a de-duplicated, ranked candidate
 * pool across all of them. This is what the orchestrator hands to
 * buildClassifyStage().
 */
export function candidatesFor(allegedOffences: string[], opts: SearchOptions = {}): OffenceEntry[] {
  const perQueryLimit = opts.limit ?? DEFAULT_LIMIT;
  const seen = new Set<string>();
  const ordered: OffenceEntry[] = [];
  for (const phrase of allegedOffences) {
    for (const hit of search(phrase, { ...opts, limit: perQueryLimit })) {
      if (seen.has(hit.entry.id)) continue;
      seen.add(hit.entry.id);
      ordered.push(hit.entry);
    }
  }
  return ordered;
}

// ---- Direct lookups --------------------------------------------------------

export function getById(id: string): OffenceEntry | null {
  return byId.get(id) ?? null;
}

export interface SectionLookup {
  law: string;
  section: string;
}

export function getBySection(input: SectionLookup): OffenceEntry | null {
  return bySection.get(`${input.law.toUpperCase()}::${input.section.toUpperCase()}`) ?? null;
}

/** Resolve a confusion-pair id list to full entries (drops unknown ids). */
export function expandConfusedWith(entry: OffenceEntry): OffenceEntry[] {
  return entry.commonlyConfusedWith.map((id) => byId.get(id)).filter((e): e is OffenceEntry => Boolean(e));
}

export const offenceKbService = {
  search,
  candidatesFor,
  getById,
  getBySection,
  expandConfusedWith,
};
