import { db } from '../db/client';
import { env } from '../env';
import { logger } from '../logger';
import { formatCite } from '../lib/judgment-parse';
import { embeddingsService } from './embeddings.service';

// =============================================================================
// Judgment corpus retrieval — REAL judgments only (0098_judgments_corpus.sql,
// loaded by scripts/ingest-judgments.ts from the CC-BY-4.0 AWS Open Data
// buckets: Supreme Court + Madras High Court to start).
//
// Every hit is a paragraph we actually hold, with the judgment's citation, the
// court's own paragraph number and a link to the source PDF — so a draft or a
// research answer can cite it and the advocate can open it and check.
//
// Retrieval is hybrid: Postgres full-text search over each paragraph (always
// available) + bge-m3 vector search (when the embed service is up and rows
// were embedded), merged with reciprocal-rank fusion. With no embeddings it is
// FTS-only — same results shape, just lexical ranking.
//
// forGrounds() is the drafting hook: it FAILS SOFT. A missing table, a DB error
// or a slow query (~4s budget) returns [] so drafting never breaks on it.
// =============================================================================

/** One retrieved paragraph of a judgment. */
export interface JudgmentHit {
  /** judgments.id */
  id: string;
  paragraphId: string;
  caseTitle: string;
  /** "Case Title v. Other, (citation)" */
  cite: string;
  court: string;
  courtCode: string;
  neutralCitation: string | null;
  reportedCitations: string[];
  decisionDate: string | null;
  paraNo: number;
  /** The paragraph, trimmed to a readable excerpt. */
  excerpt: string;
  /** Source PDF (falls back to the court's portal). */
  url: string | null;
  /** RRF score — comparable only within one search. */
  score: number;
}

/** What drafting cites. Shape agreed with the compose pipeline. */
export interface JudgmentAuthority {
  id: string;
  cite: string;
  court: string;
  decisionDate: string | null;
  paraNo: number;
  excerpt: string;
  url: string | null;
}

export interface JudgmentDetail {
  id: string;
  caseTitle: string;
  cite: string;
  court: string;
  courtCode: string;
  bench: string | null;
  caseNumber: string | null;
  neutralCitation: string | null;
  reportedCitations: string[];
  decisionDate: string | null;
  disposal: string | null;
  sourceUrl: string | null;
  pdfUrl: string | null;
  paragraphs: Array<{ seq: number; paraNo: number; text: string }>;
}

interface HitRow {
  paragraph_id: string;
  judgment_id: string;
  para_no: number;
  text: string;
  case_title: string;
  court: string;
  court_code: string;
  case_number: string | null;
  neutral_citation: string | null;
  reported_citations: string[] | null;
  decision_date: string | null;
  source_url: string | null;
  pdf_url: string | null;
}

// A draft takes ~a minute; 4s was cutting off judgment lookup entirely on a remote
// DB (each per-ground FTS ~3.5s from here) and drafts silently got no case law.
const FORGROUNDS_TIMEOUT_MS = 12_000;
// Server-side cap per search query. The JS timeout only stops waiting; without
// this, abandoned queries ran on for 15+ min and starved the whole DB pool.
const QUERY_TIMEOUT_MS = FORGROUNDS_TIMEOUT_MS;
const EMBED_TIMEOUT_MS = 2_500;
const RRF_K = 60;
const POOL = 40;
const EXCERPT_CHARS = 600;

// ---- pure helpers (exported for tests) --------------------------------------

// Words that carry no retrieval signal in a pleading ground; Postgres drops the
// English stop words itself, these are the legal boilerplate on top.
const NOISE = new Set([
  'the', 'and', 'that', 'this', 'with', 'from', 'which', 'under', 'said', 'such', 'shall', 'been', 'have',
  'has', 'was', 'were', 'are', 'not', 'for', 'any', 'all', 'its', 'his', 'her', 'their', 'there', 'upon',
  'hon', 'ble', 'learned', 'petitioner', 'respondent', 'respondents', 'petitioners', 'court', 'honourable',
]);

/** Free text -> an OR tsquery string ("bail | custody | parity"). Only
 *  [a-z0-9] terms reach to_tsquery, so user text can never break its syntax.
 *  Empty string when nothing is left. */
export function orTsQuery(text: string, maxTerms = 32): string {
  const terms: string[] = [];
  for (const w of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (w.length < 3 || NOISE.has(w)) continue;
    if (!terms.includes(w)) terms.push(w);
    if (terms.length >= maxTerms) break;
  }
  return terms.join(' | ');
}

/** Reciprocal-rank fusion: each list contributes 1/(k + rank) per item (rank
 *  1-based). Items found by both lists rise; order within ties follows first
 *  appearance. Returns ids best-first with their fused score. */
export function rrfMerge(lists: string[][], k = RRF_K): Array<{ id: string; score: number }> {
  const score = new Map<string, number>();
  for (const list of lists) {
    const seen = new Set<string>();
    list.forEach((id, i) => {
      if (seen.has(id)) return;
      seen.add(id);
      score.set(id, (score.get(id) ?? 0) + 1 / (k + i + 1));
    });
  }
  return [...score.entries()]
    .map(([id, s]) => ({ id, score: s }))
    .sort((a, b) => b.score - a.score);
}

/** Trim a paragraph to ~`max` chars, ending on a sentence when one is close. */
export function trimExcerpt(text: string, max = EXCERPT_CHARS): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
  return end > max * 0.5 ? cut.slice(0, end + 1) : `${cut.replace(/\s+\S*$/, '')} …`;
}

// ---- internals ---------------------------------------------------------------

function toHit(r: HitRow, score: number): JudgmentHit {
  return {
    id: r.judgment_id,
    paragraphId: r.paragraph_id,
    caseTitle: r.case_title,
    cite: formatCite({
      caseTitle: r.case_title,
      neutralCitation: r.neutral_citation,
      reportedCitations: r.reported_citations,
      caseNumber: r.case_number,
      court: r.court,
      decisionDate: r.decision_date,
    }),
    court: r.court,
    courtCode: r.court_code,
    neutralCitation: r.neutral_citation,
    reportedCitations: r.reported_citations ?? [],
    decisionDate: r.decision_date,
    paraNo: r.para_no,
    excerpt: trimExcerpt(r.text),
    url: r.pdf_url ?? r.source_url,
    score,
  };
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const t = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

/** Query vectors for `texts`, or null (no embed service / it failed) -> FTS-only. */
async function embedQueries(texts: string[]): Promise<number[][] | null> {
  if (!env.EMBED_SERVICE_URL || texts.length === 0) return null;
  try {
    const res = await embeddingsService.embed(texts, { signal: AbortSignal.timeout(EMBED_TIMEOUT_MS) });
    return res.embeddings;
  } catch (err) {
    logger.debug({ err }, 'judgments: query embed failed, FTS-only');
    return null;
  }
}

const HIT_COLUMNS = `
  p.id as paragraph_id, p.judgment_id, p.para_no, p.text,
  j.case_title, j.court, j.court_code, j.case_number, j.neutral_citation,
  j.reported_citations, to_char(j.decision_date, 'YYYY-MM-DD') as decision_date,
  j.source_url, j.pdf_url`;

// A citable paragraph states law, not procedure: skip the short procedural ones
// ("The appeal is partly allowed.", "The essential facts are not in dispute.") and
// rank paragraphs that reason ("held", "well settled", "the principle") higher.
const MIN_PARA_CHARS = 250;
const REASONING_RX = String.raw`\m(held|holds|settled|principle|principles|it is clear|we are of the (view|opinion)|the law|ratio|is not maintainable|abuse of (the )?process)\M`;
const REASONING_BOOST = 1.6;
const RERANK = 200;
const CANDIDATES = 1500;

/** One query: FTS + (optional) vector, RRF-merged, best paragraph per judgment. */
async function hybrid(query: string, vector: number[] | null, court: string | null, k: number): Promise<JudgmentHit[]> {
  const sql = db();
  if (!sql) return [];
  const tsq = orTsQuery(query);

  // `set local` scopes the timeout to this transaction, so pooled connections stay clean.
  const bounded = (q: (tx: NonNullable<typeof sql>) => Promise<HitRow[]>) =>
    sql.begin(async (tx) => {
      await tx`select set_config('statement_timeout', ${String(QUERY_TIMEOUT_MS)}, true)`;
      return q(tx as unknown as NonNullable<typeof sql>);
    }) as Promise<HitRow[]>;

  const fts = tsq
    // An OR query matches most of the corpus, and ranking every match read the whole
    // table and saturated Supabase IO. So: rank at most CANDIDATES matches, then run
    // the reasoning regex on the top RERANK only.
    // shortcut: the candidate cap is unordered (physical order), so ranking covers a
    // sample once a query matches more; move to a ranked index (pg_search/RUM) then.
    ? bounded((sql) => sql<HitRow[]>`
        with cand as (
          select p.id, p.search_vector
          from judgment_paragraphs p
          join judgments j on j.id = p.judgment_id
          where p.search_vector @@ to_tsquery('english', ${tsq})
            and length(p.text) >= ${MIN_PARA_CHARS}
            and (${court}::text is null or j.court_code = ${court} or j.court = ${court})
          limit ${CANDIDATES}),
        top as (
          select id, ts_rank_cd(search_vector, to_tsquery('english', ${tsq})) as rank
          from cand order by rank desc limit ${RERANK})
        select ${sql.unsafe(HIT_COLUMNS)}
        from top
        join judgment_paragraphs p on p.id = top.id
        join judgments j on j.id = p.judgment_id
        order by top.rank * (case when p.text ~* ${REASONING_RX} then ${REASONING_BOOST}::float8 else 1.0 end) desc
        limit ${POOL}`)
    : Promise.resolve([] as HitRow[]);

  const vec = vector
    // Nearest neighbours first, as a bare ORDER BY <=> LIMIT the HNSW index can
    // serve; joins and filters inside it made Postgres scan every embedding.
    ? bounded((sql) => sql<HitRow[]>`
        with nn as (
          select id, embedding <=> ${`[${vector.join(',')}]`}::vector as dist
          from judgment_paragraphs
          order by embedding <=> ${`[${vector.join(',')}]`}::vector
          limit ${RERANK})
        select ${sql.unsafe(HIT_COLUMNS)}
        from nn
        join judgment_paragraphs p on p.id = nn.id
        join judgments j on j.id = p.judgment_id
        where length(p.text) >= ${MIN_PARA_CHARS}
          and (${court}::text is null or j.court_code = ${court} or j.court = ${court})
        order by nn.dist
        limit ${POOL}`)
    : Promise.resolve([] as HitRow[]);

  const [ftsRows, vecRows] = await Promise.all([fts, vec]);
  const byId = new Map<string, HitRow>();
  for (const r of [...ftsRows, ...vecRows]) byId.set(r.paragraph_id, r);
  const merged = rrfMerge([ftsRows.map((r) => r.paragraph_id), vecRows.map((r) => r.paragraph_id)]);

  const out: JudgmentHit[] = [];
  const judgmentsSeen = new Set<string>();
  for (const { id, score } of merged) {
    const row = byId.get(id)!;
    if (judgmentsSeen.has(row.judgment_id)) continue;
    judgmentsSeen.add(row.judgment_id);
    out.push(toHit(row, score));
    if (out.length >= k) break;
  }
  return out;
}

let configuredCache: { at: number; value: boolean } | null = null;
const CONFIGURED_TTL_MS = 60_000;

export const judgmentsService = {
  /** True once the corpus table exists and has at least one judgment. Never
   *  throws (a missing table is "not configured"). A yes is cached for a
   *  minute; a no is re-checked each call so a fresh ingest lights up at once. */
  async configured(): Promise<boolean> {
    if (!env.judgmentsSearch) return false;
    if (configuredCache?.value && Date.now() - configuredCache.at < CONFIGURED_TTL_MS) return true;
    const sql = db();
    let value = false;
    if (sql) {
      try {
        const rows = await sql<{ exists: boolean }[]>`select exists(select 1 from judgments limit 1) as exists`;
        value = rows[0]?.exists ?? false;
      } catch (err) {
        logger.debug({ err }, 'judgments: corpus not available');
      }
    }
    configuredCache = { at: Date.now(), value };
    return value;
  },

  /** Hybrid search — best paragraph per judgment, best-first. Throws on a DB
   *  error (callers decide); an embed-service failure only drops to FTS. */
  async search(query: string, opts: { court?: string; k?: number } = {}): Promise<JudgmentHit[]> {
    const q = query.trim();
    if (!q) return [];
    const k = Math.min(20, Math.max(1, opts.k ?? 8));
    const [vector] = (await embedQueries([q])) ?? [null];
    return hybrid(q, vector ?? null, opts.court ?? null, k);
  },

  async getById(id: string): Promise<JudgmentDetail | null> {
    const sql = db();
    if (!sql || !/^[0-9a-f-]{36}$/i.test(id)) return null;
    const rows = await sql<Array<{
      id: string; case_title: string; court: string; court_code: string; bench: string | null;
      case_number: string | null; neutral_citation: string | null; reported_citations: string[] | null;
      decision_date: string | null; disposal: string | null; source_url: string | null; pdf_url: string | null;
    }>>`
      select id, case_title, court, court_code, bench, case_number, neutral_citation, reported_citations,
             to_char(decision_date, 'YYYY-MM-DD') as decision_date, disposal, source_url, pdf_url
      from judgments where id = ${id}
    `;
    const j = rows[0];
    if (!j) return null;
    const paras = await sql<Array<{ seq: number; para_no: number; text: string }>>`
      select seq, para_no, text from judgment_paragraphs where judgment_id = ${id} order by seq
    `;
    return {
      id: j.id,
      caseTitle: j.case_title,
      cite: formatCite({
        caseTitle: j.case_title, neutralCitation: j.neutral_citation, reportedCitations: j.reported_citations,
        caseNumber: j.case_number, court: j.court, decisionDate: j.decision_date,
      }),
      court: j.court,
      courtCode: j.court_code,
      bench: j.bench,
      caseNumber: j.case_number,
      neutralCitation: j.neutral_citation,
      reportedCitations: j.reported_citations ?? [],
      decisionDate: j.decision_date,
      disposal: j.disposal,
      sourceUrl: j.source_url,
      pdfUrl: j.pdf_url,
      paragraphs: paras.map((p) => ({ seq: p.seq, paraNo: p.para_no, text: p.text })),
    };
  },

  /**
   * Authorities for a draft's grounds: one retrieval per ground (one batched
   * embed call), then taken round-robin so every ground gets its best support
   * before any ground gets a second. Distinct judgments only.
   *
   * FAILS SOFT: no DB, no table, a DB error or the ~4s budget running out all
   * return [] — drafting must never break on case-law lookup.
   */
  async forGrounds(
    grounds: string[],
    opts: { docType?: string; court?: string; k?: number } = {},
  ): Promise<JudgmentAuthority[]> {
    const list = grounds.map((g) => g.trim()).filter((g) => g.length >= 10).slice(0, 8);
    if (list.length === 0 || !db()) return [];
    const k = Math.min(12, Math.max(1, opts.k ?? 5));
    // The doc type ("bail application") nudges FTS toward the right area of law.
    const queries = list.map((g) => (opts.docType ? `${g} ${opts.docType}` : g));

    const run = async (): Promise<JudgmentAuthority[]> => {
      if (!(await judgmentsService.configured())) return [];
      const vectors = await embedQueries(queries);
      const perGround = await Promise.all(
        queries.map((q, i) => hybrid(q, vectors?.[i] ?? null, opts.court ?? null, k)),
      );
      const out: JudgmentAuthority[] = [];
      const seen = new Set<string>();
      for (let round = 0; out.length < k && perGround.some((l) => l.length > round); round += 1) {
        for (const hits of perGround) {
          const h = hits[round];
          if (!h || seen.has(h.id)) continue;
          seen.add(h.id);
          out.push({ id: h.id, cite: h.cite, court: h.court, decisionDate: h.decisionDate, paraNo: h.paraNo, excerpt: h.excerpt, url: h.url });
          if (out.length >= k) break;
        }
      }
      return out;
    };

    try {
      return await withTimeout(run(), FORGROUNDS_TIMEOUT_MS, 'judgments.forGrounds');
    } catch (err) {
      logger.warn({ err }, 'judgments.forGrounds failed; drafting continues without case law');
      return [];
    }
  },
};
