import { env } from '../env';
import { lawsDb } from '../lib/laws-db';
import { embeddingsService } from './embeddings.service';
import { logger } from '../logger';

// ---- Wire-shape returned to the web client ---------------------------------

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
  };
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

function cacheKey(query: string, actId: string | null, k: number): string {
  return `${actId ?? '*'}::${k}::${query.trim().toLowerCase()}`;
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
    const cacheKey_ = !opts.rerank ? cacheKey(trimmed, actId, k) : null;
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

    const rows = await sql<MatchRow[]>`
      select id, content, section_id, act_id,
             citation, section_number, section_heading, act_title,
             pdf_storage_path, source_url, rrf_score
      from match_laws(${vecLiteral}::vector(1024), ${trimmed}, ${actId}::uuid, ${k})
    `;
    let hits = rows.map(fromMatchRow);

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
    const rows = await sql<MatchRow[]>`
      select id, content, section_id, act_id,
             citation, section_number_out as section_number, section_heading, act_title,
             pdf_storage_path, source_url, 1.0 as rrf_score
      from lookup_section(${actQuery}, ${sectionNumber}, ${k})
    `;
    return rows.map(fromMatchRow);
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
