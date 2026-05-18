import { env } from '../env';
import { lawsDb } from '../lib/laws-db';
import { embeddingsService } from './embeddings.service';
import { logger } from '../logger';

// ---- Wire-shape returned to the web client ---------------------------------

export type Jurisdiction = 'Central' | 'State' | 'Unknown';

export interface LawHit {
  id: string;
  content: string;
  sectionId: string | null;
  actId: string | null;
  citation: string | null;
  sectionNumber: string | null;
  sectionHeading: string | null;
  actTitle: string | null;
  pdfStoragePath: string | null;
  sourceUrl: string | null;
  /** Reciprocal-rank-fusion score from match_laws (higher is better). */
  score: number;
  /** Cross-encoder rerank score when reranking was applied. */
  rerankScore?: number;
  /** Whether the act is a central (parliamentary) or state-level statute.
   *  Derived from the act title since the corpus has no explicit column. */
  jurisdiction: Jurisdiction;
  /** When jurisdiction === 'State', the canonical state name. */
  state: string | null;
}

// ---- Row shape returned by the match_laws RPC ------------------------------

interface MatchRow {
  id: string;
  content: string;
  section_id: string | null;
  act_id: string | null;
  citation: string | null;
  section_number: string | null;
  section_heading: string | null;
  act_title: string | null;
  pdf_storage_path: string | null;
  source_url: string | null;
  rrf_score: number | string;
}

function fromMatchRow(r: MatchRow): LawHit {
  const j = detectJurisdiction(r.act_title);
  return {
    id: r.id,
    content: r.content,
    sectionId: r.section_id,
    actId: r.act_id,
    citation: r.citation,
    sectionNumber: r.section_number,
    sectionHeading: r.section_heading,
    actTitle: r.act_title,
    pdfStoragePath: r.pdf_storage_path,
    sourceUrl: r.source_url,
    score: Number(r.rrf_score),
    jurisdiction: j.jurisdiction,
    state: j.state,
  };
}

// ----------------------------------------------------------------------------
// Jurisdiction detection
// ----------------------------------------------------------------------------
//
// The upstream `acts` table has no jurisdiction column, but Indian state
// acts almost always begin their title with the state name. This is
// reliable enough for surface labelling (CENTRAL / STATE · KERALA badges
// in the UI). Pre-existing names (Bombay → Maharashtra, Orissa → Odisha)
// are mapped to the modern canonical state.

interface StateMatcher {
  /** Canonical modern name. */
  canonical: string;
  /** Patterns matched against the LEADING tokens of the act title. */
  patterns: string[];
}

/** All states/UTs the detector recognises, in canonical form. Exported
 *  so the frontend dropdown can render them without hard-coding. */
export const CANONICAL_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka',
  'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya',
  'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim',
  'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand',
  'West Bengal',
  // Union territories with their own legislative powers.
  'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Puducherry',
  'Andaman and Nicobar Islands', 'Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Lakshadweep',
] as const;

const STATES: StateMatcher[] = [
  { canonical: 'Andhra Pradesh',    patterns: ['Andhra Pradesh', 'Andhra'] },
  { canonical: 'Arunachal Pradesh', patterns: ['Arunachal Pradesh', 'Arunachal'] },
  { canonical: 'Assam',             patterns: ['Assam'] },
  { canonical: 'Bihar',             patterns: ['Bihar'] },
  { canonical: 'Chhattisgarh',      patterns: ['Chhattisgarh'] },
  { canonical: 'Goa',               patterns: ['Goa'] },
  { canonical: 'Gujarat',           patterns: ['Gujarat'] },
  { canonical: 'Haryana',           patterns: ['Haryana'] },
  { canonical: 'Himachal Pradesh',  patterns: ['Himachal Pradesh', 'Himachal'] },
  { canonical: 'Jharkhand',         patterns: ['Jharkhand'] },
  { canonical: 'Karnataka',         patterns: ['Karnataka'] },
  { canonical: 'Kerala',            patterns: ['Kerala'] },
  { canonical: 'Madhya Pradesh',    patterns: ['Madhya Pradesh', 'M.P.', 'MP'] },
  { canonical: 'Maharashtra',       patterns: ['Maharashtra', 'Bombay'] }, // pre-1960
  { canonical: 'Manipur',           patterns: ['Manipur'] },
  { canonical: 'Meghalaya',         patterns: ['Meghalaya'] },
  { canonical: 'Mizoram',           patterns: ['Mizoram'] },
  { canonical: 'Nagaland',          patterns: ['Nagaland'] },
  { canonical: 'Odisha',            patterns: ['Odisha', 'Orissa'] },
  { canonical: 'Punjab',            patterns: ['Punjab'] },
  { canonical: 'Rajasthan',         patterns: ['Rajasthan'] },
  { canonical: 'Sikkim',            patterns: ['Sikkim'] },
  { canonical: 'Tamil Nadu',        patterns: ['Tamil Nadu', 'Tamilnadu'] },
  { canonical: 'Telangana',         patterns: ['Telangana'] },
  { canonical: 'Tripura',           patterns: ['Tripura'] },
  { canonical: 'Uttar Pradesh',     patterns: ['Uttar Pradesh', 'U.P.', 'UP'] },
  { canonical: 'Uttarakhand',       patterns: ['Uttarakhand', 'Uttaranchal'] },
  { canonical: 'West Bengal',       patterns: ['West Bengal'] },
  // Union territories with their own legislative powers.
  { canonical: 'Delhi',             patterns: ['Delhi', 'National Capital Territory'] },
  { canonical: 'Jammu and Kashmir', patterns: ['Jammu and Kashmir', 'Jammu & Kashmir', 'J&K'] },
  { canonical: 'Ladakh',            patterns: ['Ladakh'] },
  { canonical: 'Puducherry',        patterns: ['Puducherry', 'Pondicherry'] },
  { canonical: 'Andaman and Nicobar Islands', patterns: ['Andaman and Nicobar', 'Andaman'] },
  { canonical: 'Chandigarh',        patterns: ['Chandigarh'] },
  { canonical: 'Dadra and Nagar Haveli and Daman and Diu', patterns: ['Dadra', 'Daman'] },
  { canonical: 'Lakshadweep',       patterns: ['Lakshadweep'] },
];

function matchesScope(hit: LawHit, scope: { type: 'central' | 'state'; state?: string }): boolean {
  if (scope.type === 'central') return hit.jurisdiction === 'Central';
  if (scope.type === 'state') {
    if (hit.jurisdiction !== 'State') return false;
    if (scope.state) return hit.state === scope.state;
    return true;
  }
  return true;
}

function detectJurisdiction(actTitle: string | null): { jurisdiction: Jurisdiction; state: string | null } {
  if (!actTitle) return { jurisdiction: 'Unknown', state: null };

  // Normalise: strip leading whitespace/punctuation; lowercase for matching.
  const trimmed = actTitle.replace(/^[\s.,_·:]+/, '').trim();
  const lower = trimmed.toLowerCase();

  for (const s of STATES) {
    for (const p of s.patterns) {
      const pl = p.toLowerCase();
      // Match at the very start of the title, followed by a word boundary
      // (space, comma, period). Avoids 'Goa' matching 'Goanese' etc.
      if (lower.startsWith(pl) && /^[\s.,]/.test(lower.slice(pl.length) || ' ')) {
        return { jurisdiction: 'State', state: s.canonical };
      }
    }
  }
  return { jurisdiction: 'Central', state: null };
}

// ----------------------------------------------------------------------------
// Content-quality filter
// ----------------------------------------------------------------------------
//
// About 3.6% of the upstream corpus has broken PDF text extraction —
// mostly state-level Acts in regional scripts where the PDF used custom
// fonts the extractor couldn't map. We drop those at query time instead
// of returning them. The proper fix lives in indiacode-rag (re-ingest
// with a better extractor); this is the SaaS-side band-aid so users
// never see garbage.
//
// The heuristic catches the *broken* shape (mangled punctuation, mojibake
// markers, control chars), NOT non-English content. Legitimate Hindi /
// Tamil / Malayalam sections — e.g. the Hindi version of the Electricity
// Act, 2003 — pass through unchanged.

// Common English words that appear in nearly every real legal text
// over ~30 chars. Used as a sanity-check signal for predominantly-Latin
// content: if NONE of these appear, the chunk is almost certainly
// garbled OCR rather than valid English. Includes legal-domain anchors
// (act / section / court / shall) plus the basic function-word set.
const ENGLISH_ANCHORS = /\b(the|of|and|or|to|in|by|is|be|for|with|a|an|act|section|shall|any|no|all|such|under|this|that|government|state|central|rules|court|person|provided)\b/i;

// Out-of-context symbols that legitimate legal text never sprinkles
// through prose: currency, dagger, bullet variants, geometric shapes.
// We DO NOT include the middle-dot '·' here — the upstream corpus uses
// it as a section separator across many acts ('· Section 1 Short title…').
// We also don't include § / ¶ / ° — those are legitimate legal glyphs
// that appear in non-garbled text.
const NOISE_SYMBOLS = /[€£¥¢†‡•◦▪▫■□¤¦]/g;

function isGarbled(content: string): boolean {
  // Note: we don't treat the Unicode replacement character (U+FFFD, "�")
  // as a garbled-content signal. In this corpus it often appears where
  // the section symbol "§" failed to round-trip during ingestion, in
  // otherwise-clean English chunks. The other checks are stronger signals.
  //
  // Control characters that should never appear in real text (excluding
  // newline U+000A and tab U+0009).
  if (/[\x00-\x08\x0E-\x1F]/.test(content)) return true;
  // Mangled escape sequences like \:\1O'Tf — common output of PDF
  // extractors stumbling on encrypted / custom-font streams.
  if (/\\[:0-9]/.test(content)) return true;
  // Long runs of mixed punctuation that don't appear in legitimate prose.
  if (/[~:=*\\|]{4,}/.test(content)) return true;

  const trimmed = content.trim();
  if (trimmed.length < 30) return false; // too short to judge

  // Script bias: legitimate Hindi / Tamil / Malayalam / etc. chunks are
  // dominated by non-Latin letters and don't need the English-anchor check.
  const allLetters = (trimmed.match(/\p{L}/gu) ?? []).length;
  const latinLetters = (trimmed.match(/[A-Za-z]/g) ?? []).length;
  const isPredominantlyLatin = allLetters > 0 && latinLetters / allLetters > 0.5;

  if (isPredominantlyLatin) {
    // English-language sanity: a real legal text >30 chars in Latin script
    // has at least one common English word. Garbled OCR (random letters
    // glued into pseudo-words) has none.
    if (!ENGLISH_ANCHORS.test(trimmed)) return true;

    // Out-of-context symbol pollution: legitimate prose rarely uses
    // currency / degree symbols. >0.5% of chars being these is suspicious.
    const noiseCount = (trimmed.match(NOISE_SYMBOLS) ?? []).length;
    if (noiseCount > 0 && noiseCount / trimmed.length > 0.005) return true;

    // Token-level garbage: tokens with internal underscores like
    // 'QUIAAT_' or that mix Latin with non-Latin random codepoints
    // ('wé', '2eQ', 'Qg'). Count tokens that look like real words —
    // 2+ Latin letters with optional simple punctuation — vs total
    // alpha tokens. Real text is mostly word-like; OCR garbage isn't.
    const tokens = trimmed.split(/\s+/).filter((t) => /\p{L}/u.test(t));
    if (tokens.length >= 8) {
      const wordLike = tokens.filter((t) => /^[A-Za-z]{2,}[A-Za-z'.,;:!?\-]*$/.test(t)).length;
      if (wordLike / tokens.length < 0.55) return true;
    }
  }

  // Final ratio check: how much of the non-whitespace content is
  // recognisable word matter? Includes letters in any script, marks
  // (Devanagari halants, etc.), digits, and basic punctuation.
  const nonSpace = trimmed.replace(/\s+/g, '');
  const valid = nonSpace.match(/[\p{L}\p{M}\p{N}.,;:()'"\-–—]/gu);
  const ratio = (valid?.length ?? 0) / nonSpace.length;
  return ratio < 0.65;
}

// ---- In-memory query cache -------------------------------------------------
//
// The drafting side-panel re-emits as the user types; without a cache we'd
// embed + query for every keystroke. Cache by (query, actId, k) for 60s.
// Keep small — 200 entries is enough for the side-panel use case.

interface CacheEntry { ts: number; value: LawHit[] }
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 200;

function cacheKey(
  query: string,
  actId: string | null,
  k: number,
  scope: SearchOptions['scope'],
): string {
  // Scope is part of the cache identity — without it, /search?scope=central
  // would receive cached results from an earlier unscoped query.
  const scopeKey = scope
    ? (scope.type === 'central' ? 'c' : `s:${scope.state ?? '*'}`)
    : '*';
  return `${actId ?? '*'}::${k}::${scopeKey}::${query.trim().toLowerCase()}`;
}

function cacheGet(key: string): LawHit[] | undefined {
  const e = cache.get(key);
  if (!e) return undefined;
  if (Date.now() - e.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return e.value;
}

function cacheSet(key: string, value: LawHit[]): void {
  if (cache.size >= CACHE_MAX) {
    const first = cache.keys().next().value;
    if (first) cache.delete(first);
  }
  cache.set(key, { ts: Date.now(), value });
}

// ---- Search options --------------------------------------------------------

export interface SearchOptions {
  /** Restrict results to a single act by uuid. Null = whole corpus. */
  actId?: string | null;
  /** Default 20; capped at 50 to keep payloads sane. */
  k?: number;
  /** When true, re-rank the top-N hits with the cross-encoder. Slower
   *  but better ordering — use for one-off searches (Research view),
   *  skip for the side-panel where latency matters more. */
  rerank?: boolean;
  /** Restrict to central, all state, or one specific state. Filter is
   *  applied post-RPC against the derived jurisdiction; over-fetch is
   *  bumped to compensate. */
  scope?: { type: 'central' | 'state'; state?: string };
}

export const lawsSearchService = {
  configured(): boolean {
    return env.hasLawsCorpus;
  },

  /**
   * Hybrid search: embed the query → match_laws RPC (vector + FTS RRF)
   * → optional cross-encoder rerank. Returns citation-ready chunks
   * joined to sections/documents/acts.
   */
  async search(query: string, opts: SearchOptions = {}): Promise<LawHit[]> {
    const k = Math.min(50, Math.max(1, opts.k ?? 20));
    const actId = opts.actId ?? null;
    const trimmed = query.trim();
    if (!trimmed) return [];

    // Cache only on non-reranked queries; rerank is expensive enough that
    // we want fresh ordering when the caller asks for it explicitly.
    const cacheKey_ = !opts.rerank ? cacheKey(trimmed, actId, k, opts.scope) : null;
    if (cacheKey_) {
      const cached = cacheGet(cacheKey_);
      if (cached) return cached;
    }

    const sql = lawsDb();
    if (!sql) {
      throw new Error('LAWS_DATABASE_URL not configured — cannot search the corpus.');
    }

    const { embeddings } = await embeddingsService.embed([trimmed]);
    const vec = embeddings[0]!;
    // postgres.js doesn't infer vector(1024) from a number[]; serialise to
    // the Postgres array literal `[0.1,0.2,...]` and cast on the SQL side.
    const vecLiteral = `[${vec.join(',')}]`;

    // Over-fetch from the RPC so post-RPC filters (garble + jurisdiction)
    // can drop matches without leaving the caller short. Scope filters
    // can be quite selective (one state out of 35), so we bump over-fetch
    // when a scope is set. RPC max is 100 to keep payloads bounded.
    const overFetchMultiplier = opts.scope ? 5 : 2;
    const overFetch = Math.min(100, k * overFetchMultiplier);
    const rows = await sql<MatchRow[]>`
      select id, content, section_id, act_id,
             citation, section_number, section_heading, act_title,
             pdf_storage_path, source_url, rrf_score
      from match_laws(${vecLiteral}::vector(1024), ${trimmed}, ${actId}::uuid, ${overFetch})
    `;
    const allHits = rows.map(fromMatchRow);
    const beforeFilter = allHits.length;
    let hits = allHits.filter((h) => !isGarbled(h.content));
    if (opts.scope) {
      hits = hits.filter((h) => matchesScope(h, opts.scope!));
    }
    hits = hits.slice(0, k);
    if (hits.length < beforeFilter) {
      logger.debug(
        {
          query: trimmed.slice(0, 80),
          scope: opts.scope,
          dropped: beforeFilter - hits.length,
          kept: hits.length,
        },
        'filtered chunks from search',
      );
    }

    if (opts.rerank && hits.length > 1) {
      try {
        const scores = await embeddingsService.rerank(
          trimmed,
          hits.map((h) => h.content),
        );
        hits = hits
          .map((h, i) => ({ ...h, rerankScore: scores[i] ?? 0 }))
          .sort((a, b) => (b.rerankScore ?? 0) - (a.rerankScore ?? 0));
      } catch (err) {
        // Rerank failure is non-fatal — keep the RRF ordering.
        logger.warn({ err }, 'rerank step failed; returning base RRF order');
      }
    }

    if (cacheKey_) cacheSet(cacheKey_, hits);
    return hits;
  },

  /**
   * Direct citation lookup. Use when the user types "BNS 103" or
   * "show me IPC 420" — skips the embedding leg entirely.
   */
  async lookup(actQuery: string, sectionNumber: string, k = 5): Promise<LawHit[]> {
    const sql = lawsDb();
    if (!sql) throw new Error('LAWS_DATABASE_URL not configured.');
    // lookup_section returns section_number_out (the function renames the
    // column to avoid colliding with the input parameter name). Alias it
    // back to section_number for the shared fromMatchRow shape.
    const overFetch = Math.min(20, k * 2);
    const rows = await sql<MatchRow[]>`
      select id, content, section_id, act_id,
             citation, section_number_out as section_number, section_heading, act_title,
             pdf_storage_path, source_url, 1.0 as rrf_score
      from lookup_section(${actQuery}, ${sectionNumber}, ${overFetch})
    `;
    return rows.map(fromMatchRow).filter((h) => !isGarbled(h.content)).slice(0, k);
  },

  /**
   * Mint a short-lived signed URL for a PDF in the Supabase storage
   * bucket. Calls the storage REST API directly (no supabase-js dep).
   */
  async signedPdfUrl(storagePath: string, expiresInSeconds = 3600): Promise<string | null> {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
      logger.warn('SUPABASE_URL/SUPABASE_SERVICE_KEY not set; cannot sign PDF URLs.');
      return null;
    }
    const path = encodeURI(storagePath.replace(/^\/+/, ''));
    const res = await fetch(
      `${env.SUPABASE_URL}/storage/v1/object/sign/${env.SUPABASE_STORAGE_BUCKET}/${path}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          apikey: env.SUPABASE_SERVICE_KEY,
        },
        body: JSON.stringify({ expiresIn: expiresInSeconds }),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logger.warn({ status: res.status, body: body.slice(0, 200), storagePath }, 'signedPdfUrl failed');
      return null;
    }
    const json = (await res.json()) as { signedURL?: string };
    if (!json.signedURL) return null;
    // signedURL comes back as a path; prefix with base.
    return `${env.SUPABASE_URL}/storage/v1${json.signedURL}`;
  },
};
