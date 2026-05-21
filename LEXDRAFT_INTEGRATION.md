# LexDraft ↔ indiacode-rag integration

Everything LexDraft needs to call our legal-corpus retrieval pipeline.
Hand this file to the LexDraft team **after** rotating credentials (see §5).

---

## 1. Embedding model

| Field | Value |
|---|---|
| Model | `BAAI/bge-m3` |
| Revision pin | `refs/pr/130` (safetensors; main branch ships unsafe pickle) |
| Dimensions | **1024** |
| Normalization | L2-normalized at embed time (`normalize_embeddings=true`) |
| Distance operator | **`<=>` (cosine)** — matches HNSW index `vector_cosine_ops` |
| Max sequence length | 1024 tokens (truncates beyond) |
| Hosting | Self-hosted FastAPI (CUDA + FP16 / CPU fallback) — not Voyage/Cohere/OpenAI |
| Reranker (optional) | `BAAI/bge-reranker-v2-m3` on the same box |

> **Critical:** LexDraft MUST embed queries with the exact same model + revision. Any other model (including `bge-large`, `bge-small`, voyage-*, etc.) produces vectors in an incompatible space — cosine scores will be noise.

### Embed service contract

```
POST {EMBED_SERVICE_URL}/embed
Authorization: Bearer {EMBED_API_KEY}
Content-Type: application/json

{ "texts": ["section 420 ipc cheating dishonest inducement"] }
```

```
200 OK
{
  "embeddings": [[0.0123, -0.0456, ...]],   // length = 1024
  "model": "BAAI/bge-m3",
  "dims": 1024
}
```

- Batch up to 256 texts per call.
- `/rerank` exists with the same auth: `{ query, documents } → { scores }`. Use after retrieval to re-sort top 50 → top K.
- `/health` is unauthenticated (liveness checks).

Source of truth: [packages/embeddings/server.py](packages/embeddings/server.py).

---

## 2. Database schema

**Not a single flat table.** Normalized across four tables. Full DDL: [drizzle/0000_init.sql](drizzle/0000_init.sql). Drizzle TS mirror: [apps/web/lib/db/schema.ts](apps/web/lib/db/schema.ts).

```
acts ──┐
       ├─→ documents ──→ sections ──→ chunks (embedding vector(1024), fts tsvector)
       │
       └── id, short_title, long_title, act_number, enacted_year, ministry,
           handle_url, handle_id

documents:  id, act_id, doc_type, title, source_url, storage_path,
            content_hash, language, effective_from, effective_to, page_count

sections:   id, document_id, parent_section_id, node_type, number, heading,
            content, sequence, citation, raw_refs jsonb, page_start, page_end

chunks:     id, section_id, document_id, act_id, chunk_index,
            content, token_count, embedding vector(1024),
            fts tsvector  -- generated, English, GIN indexed
```

### What a chunk represents

One chunk per **section** by default. Subsections / clauses / provisos / explanations / illustrations are folded into the parent section's chunk. Sections over 1500 tokens are split on subsection boundaries with the section breadcrumb prepended so the embedding stays anchored. Paragraph-fallback chunks are emitted only when structural parsing fails.

See [packages/ingest/src/chunk.ts](packages/ingest/src/chunk.ts).

### Indexes on `chunks`

| Index | Type | Purpose |
|---|---|---|
| `chunks_embedding_idx` | HNSW (`vector_cosine_ops`) | Vector search via `<=>` |
| `chunks_fts_idx` | GIN on `fts` | Keyword search via `websearch_to_tsquery('english', ...)` |
| `chunks_section_idx` | btree | Join to `sections` |
| `chunks_act_idx` | btree | Filter by act |

---

## 3. RPCs (added in [drizzle/0004_match_laws_rpc.sql](drizzle/0004_match_laws_rpc.sql))

### `match_laws` — hybrid retrieval

```sql
match_laws(
  query_embedding vector(1024),   -- required, bge-m3 normalized
  query_text      text DEFAULT '',-- optional; empty → pure-vector search
  p_act_id        uuid DEFAULT NULL,
  match_count     int  DEFAULT 20
) RETURNS TABLE (
  id, content, section_id, act_id,
  citation, section_number, section_heading, act_title,
  pdf_storage_path, source_url, rrf_score
)
```

Vector leg (top 50 cosine) + FTS leg (top 50 BM25-style) fused via **Reciprocal Rank Fusion, k=60**. Returns citation-ready rows joined to `sections` / `documents` / `acts`.

**Call from supabase-js:**

```ts
const { data, error } = await supabase.rpc("match_laws", {
  query_embedding: vector,          // number[] of length 1024
  query_text: userQuery,            // string; pass '' for vector-only
  p_act_id: null,                   // or a UUID to scope to one act
  match_count: 20,
});
```

### `lookup_section` — direct "BNS 103"-style lookup (no embedding)

```sql
lookup_section(act_query text, section_number text, match_count int DEFAULT 5)
```

Use this when the user types something like "show me IPC 420" — skip embedding entirely.

### Granted to

`anon, authenticated, service_role`. Safe because the corpus is public reference data and the functions are `STABLE` (read-only).

### Apply the migration

```bash
psql "$DATABASE_URL" -f drizzle/0004_match_laws_rpc.sql
```

---

## 4. Connection details (Supabase — self-hosted)

| Var | Value (template) | Notes |
|---|---|---|
| `SUPABASE_URL` | `http://187.77.186.31:8000` | Kong/REST. **Put TLS in front before prod.** |
| `SUPABASE_SERVICE_KEY` | _rotated, send out of band_ | Bypasses RLS; OK for server-side use |
| `SUPABASE_STORAGE_BUCKET` | `indiacode` | PDFs (`acts/{handleId}/{language}/{filename}.pdf`) |
| `DATABASE_URL` | `postgresql://...@187.77.186.31:6543/postgres?sslmode=disable` | Pooler port |
| `EMBED_SERVICE_URL` | _public URL once we expose it_ | Currently `http://127.0.0.1:8001` |
| `EMBED_API_KEY` | _generate fresh; share out of band_ | Bearer token for `/embed` and `/rerank` |
| `EMBEDDING_MODEL` | `BAAI/bge-m3` | For LexDraft's config / assertion |
| `EMBEDDING_DIMS` | `1024` | Validate against `chunks.embedding` |

Client choice: prefer **supabase-js with `.rpc('match_laws', …)`** now that the RPC exists. Direct Postgres connection (`pg` / `postgres.js`) also works for backend services that want pooled connections.

### End-to-end pseudocode (LexDraft side)

```ts
// 1. Embed
const { embeddings } = await fetch(`${EMBED_SERVICE_URL}/embed`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${EMBED_API_KEY}`,
  },
  body: JSON.stringify({ texts: [userQuery] }),
}).then((r) => r.json());

// 2. Search
const { data: hits } = await supabase.rpc("match_laws", {
  query_embedding: embeddings[0],
  query_text: userQuery,
  p_act_id: null,
  match_count: 20,
});

// 3. (Optional) Rerank top 20 with cross-encoder
const { scores } = await fetch(`${EMBED_SERVICE_URL}/rerank`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${EMBED_API_KEY}`,
  },
  body: JSON.stringify({
    query: userQuery,
    documents: hits.map((h) => h.content),
  }),
}).then((r) => r.json());

// 4. (Optional) Signed URL for the PDF
const { data: signed } = await supabase.storage
  .from("indiacode")
  .createSignedUrl(hits[0].pdf_storage_path, 3600);
```

---

## 5. Security — DO BEFORE SHARING

The file [apps/web/.env.local](apps/web/.env.local) contains live secrets and was previously exposed in a chat transcript. **Rotate everything before this hand-off:**

1. Supabase Studio → Settings → API → regenerate `anon` + `service_role` keys.
2. Postgres: `ALTER USER postgres WITH PASSWORD '…';` (update pooler config too).
3. Generate a fresh `EMBED_API_KEY`:
   ```
   openssl rand -hex 32
   ```
   Put it in both the Python process env (where `server.py` runs) and the consumer env. The bearer is enforced only when `EMBED_API_KEY` is set; otherwise the server logs a warning and accepts open requests.
4. Put nginx + TLS in front of `:8000` (Supabase Kong) and `:8001` (embed). Cloudflare Tunnel is the fastest path here.
5. Send rotated values to LexDraft via 1Password / Doppler / SOPS — **not** chat, not email, not PR description.

---

## 6. Files changed in this hand-off

- `drizzle/0004_match_laws_rpc.sql` — new RPCs (`match_laws`, `lookup_section`).
- `packages/embeddings/server.py` — bearer auth on `/embed` and `/rerank`.
- `packages/embeddings/client.ts`, `apps/web/lib/embeddings.ts` — forward `EMBED_API_KEY` as `Authorization: Bearer …` when set.
- `apps/web/.env.local` — documented `EMBED_API_KEY` placeholder.
