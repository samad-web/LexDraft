import { env } from '../env';
import { logger } from '../logger';

// Thin client for the self-hosted embed/rerank FastAPI. See §1 of
// LEXDRAFT_INTEGRATION.md for the contract.

export interface EmbedResponse {
  embeddings: number[][];
  model: string;
  dims: number;
}

export interface RerankResponse {
  scores: number[];
}

interface FetchOpts {
  signal?: AbortSignal;
}

function authHeader(): Record<string, string> {
  return env.EMBED_API_KEY
    ? { authorization: `Bearer ${env.EMBED_API_KEY}` }
    : {};
}

export const embeddingsService = {
  /**
   * Embed up to 256 texts in a single call. Returns vectors of length
   * `EMBEDDING_DIMS` (validated against the response). Throws if the
   * service is not configured — callers must surface that as a 503,
   * not silently return empty results.
   */
  async embed(texts: string[], opts: FetchOpts = {}): Promise<EmbedResponse> {
    if (!env.EMBED_SERVICE_URL) {
      throw new Error('EMBED_SERVICE_URL not configured — cannot embed query.');
    }
    if (texts.length === 0) return { embeddings: [], model: env.EMBEDDING_MODEL, dims: env.EMBEDDING_DIMS };
    if (texts.length > 256) {
      throw new Error(`embed: batch size ${texts.length} exceeds 256-text cap.`);
    }

    const res = await fetch(`${env.EMBED_SERVICE_URL}/embed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeader() },
      body: JSON.stringify({ texts }),
      signal: opts.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`embed: ${res.status} ${res.statusText} — ${body.slice(0, 200)}`);
    }

    const json = (await res.json()) as EmbedResponse;

    // Assertion guard. If the upstream model ever changes silently, the
    // resulting vectors live in a different space and cosine scores
    // become noise. Loud failure is the right call here.
    if (json.dims !== env.EMBEDDING_DIMS) {
      throw new Error(
        `embed: expected ${env.EMBEDDING_DIMS}-d vectors (${env.EMBEDDING_MODEL}), got ${json.dims}-d from ${json.model}.`,
      );
    }
    if (json.embeddings.length !== texts.length) {
      throw new Error(`embed: requested ${texts.length} vectors, got ${json.embeddings.length}.`);
    }

    return json;
  },

  /**
   * Re-rank an existing list of documents against the query with the
   * cross-encoder. Use only after retrieval (typically top 20-50 →
   * top K) — running rerank on the full corpus is prohibitive.
   */
  async rerank(query: string, documents: string[], opts: FetchOpts = {}): Promise<number[]> {
    if (!env.EMBED_SERVICE_URL) {
      throw new Error('EMBED_SERVICE_URL not configured — cannot rerank.');
    }
    if (documents.length === 0) return [];

    const res = await fetch(`${env.EMBED_SERVICE_URL}/rerank`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeader() },
      body: JSON.stringify({ query, documents }),
      signal: opts.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // Rerank is best-effort — if it fails we'd rather return the
      // base ranking than an error. Log and return identity scores.
      logger.warn({ status: res.status, body: body.slice(0, 200) }, 'rerank failed; falling back to base order');
      return documents.map((_, i) => documents.length - i);
    }

    const json = (await res.json()) as RerankResponse;
    if (!Array.isArray(json.scores) || json.scores.length !== documents.length) {
      logger.warn({ got: json.scores?.length, expected: documents.length }, 'rerank score-count mismatch');
      return documents.map((_, i) => documents.length - i);
    }
    return json.scores;
  },
};
