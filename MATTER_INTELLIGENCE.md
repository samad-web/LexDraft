# Matter Intelligence

**Status:** v1 · shipped against migration `0041_matter_intelligence.sql`
**Companion docs:** [APPLICATION_ARCHITECTURE.md](./APPLICATION_ARCHITECTURE.md), [design-system.md](./design-system.md).

> ### ⚠ Retrieval mechanism changed (post-v1)
>
> The retrieval path described in earlier drafts of this document — embed the
> question, ANN search over `matter_document_chunks.embedding`, optional
> rerank — has been **removed**. Matter Intelligence now runs **without
> embeddings**: chunks are stored text-only and chat retrieval uses Postgres
> full-text search (`plainto_tsquery` over `matter_document_chunks.text`)
> with a recency-ordered fallback when FTS yields no hits.
>
> Why the change: for the typical matter (a handful of documents, tens of
> pages) keyword retrieval plus the LLM's reasoning over the cited chunks
> gives sufficient answer quality without the operational cost of running an
> embedding service. The `vector(1024)` column and HNSW index from
> migration `0041` are kept for backwards compatibility but are not written
> by new ingests and not read by chat. Re-embedding is documented in §12
> as a v2 consideration.
>
> Sections updated for this change: §1, §2 (flow diagram), §5.3 (chat
> prompt), §6 (degraded mode), §7 (pipeline), §11 (runbook). Other sections
> still describe v1 as shipped.

A feature inside LexDraft that ingests matter documents, generates per-document AI summaries, synthesises a matter-level "brief", and lets an advocate chat against the matter corpus with cited answers. Lives inside [`CaseDetailView`](./apps/web/src/views/CaseDetailView.tsx) as an **Intelligence** tab and at the standalone route `/app/matter-intel/:caseId`.

---

## 1. What it does

| Surface | What the user does | What the system does |
|---|---|---|
| **Left pane — Documents** | Drops PDF/DOCX/TXT/MD files, or opens a "Pull from matter" sheet to register existing matter documents. | Hashes the file, persists a `matter_documents` row, kicks off extract → chunk → summarise. Status chip flips Queued → Extracting → Indexing → Ready (polled every 4s while transient). No embedding step. |
| **Centre pane — Brief tab** | Reviews posture, key facts, disputed issues, timeline, open questions. Clicks **Regenerate**. | Synthesises a brief by feeding every per-document summary into Claude (or returns a deterministic stub when no LLM key is set). Persists the new brief and marks the previous row `superseded_at`. |
| **Centre pane — Document tab** | Reads the structured summary for a selected document. Clicks **Re-summarise**. | Runs Claude over the document's extracted text with a strict JSON schema (parties, dates, operative content, citations, executive summary). Upserts `matter_document_summaries`. |
| **Right pane — Chat** | Asks questions in natural language. Citations are inline pill links. | Postgres FTS (`plainto_tsquery` + `ts_rank`) over `matter_document_chunks.text` scoped to this matter. Recency-ordered fallback when no FTS hits. Builds a context prompt, streams Claude/xAI's reply via SSE. Parses `[doc:<uuid> p:<n>]` citations out of the reply and persists them. |
| **Citation drawer** | Clicks a citation pill. | Opens a right-side drawer showing the source document at the cited page. |

---

## 2. End-to-end data flow

```
                ┌──────────────────────────────┐
   1 Upload     │ POST /api/matter-intel/      │
   (multi-file) │  :caseId/upload-url          │  ← presigned PUT URL
                └──────────────┬───────────────┘
                               │
                  client PUTs bytes to storage
                               │
                ┌──────────────▼───────────────┐
   2 Finalise   │ POST /api/matter-intel/      │
                │  :caseId/upload              │
                │  { storageKey, fileName, …}  │
                └──────────────┬───────────────┘
                               │
                  matterIntelService.ingestUpload()
                  ─ sha256 → idempotency check
                  ─ insert matter_documents (status='pending')
                  ─ enqueue pg-boss job  (≥ 5 MB)  OR  run inline
                               │
                ┌──────────────▼───────────────┐
   3 Processing │ processMatterDocument()       │
                │  ─ text-extraction.ts         │
                │  ─ buildChunks() (page-aware) │
                │  ─ insert chunks (text-only)  │
                │  ─ status = 'ready'           │
                └──────────────┬───────────────┘
                               │
                  auto-trigger summary
                               │
                ┌──────────────▼───────────────┐
   4 Summary    │ matterIntelService            │
                │   .summariseDocument()        │
                │  → Claude (strict-JSON)       │
                │  → matter_document_summaries  │
                └──────────────┬───────────────┘
                               │
              ┌────────────────┴────────────────┐
              │                                 │
   5 Brief    POST /:caseId/                    │  6 Chat
              brief/regenerate                  │  POST /threads/:tid/messages
              over ALL summaries                │  (SSE)
              for this matter                   │     ─ Postgres FTS over chunks
                                                │       (plainto_tsquery)
                                                │     ─ recency fallback if 0 hits
                                                │     ─ build prompt with top-K text
                                                │     ─ stream Claude / xAI
                                                │     ─ parse citations
                                                │     ─ persist messages
```

Detailed file map:

| Concern | File |
|---|---|
| Schema | [apps/api/migrations/0041_matter_intelligence.sql](./apps/api/migrations/0041_matter_intelligence.sql) |
| Ingest + summarise + brief | [apps/api/src/services/matter-intel.service.ts](./apps/api/src/services/matter-intel.service.ts) |
| Chat + retrieval + streaming | [apps/api/src/services/matter-chat.service.ts](./apps/api/src/services/matter-chat.service.ts) |
| HTTP routes | [matter-intel.routes.ts](./apps/api/src/routes/matter-intel.routes.ts), [matter-chat.routes.ts](./apps/api/src/routes/matter-chat.routes.ts) |
| Shared types | [packages/types/src/index.ts](./packages/types/src/index.ts) (search "Matter Intelligence") |
| React Query hooks | [useMatterIntel.ts](./apps/web/src/hooks/useMatterIntel.ts), [useMatterChat.ts](./apps/web/src/hooks/useMatterChat.ts) |
| UI | [components/matter-intel/MatterIntelPanel.tsx](./apps/web/src/components/matter-intel/MatterIntelPanel.tsx), [views/MatterIntelView.tsx](./apps/web/src/views/MatterIntelView.tsx) |
| CaseDetailView tab | "Intelligence" tab in [CaseDetailView.tsx](./apps/web/src/views/CaseDetailView.tsx) |

---

## 3. Database

Migration `0041_matter_intelligence.sql` enables pgvector and creates six tables, all firm-scoped:

```
matter_documents               source row + extracted text + status
  └─ matter_document_chunks    page-aware retrieval units (vector(1024))
  └─ matter_document_summaries one canonical summary per document
matter_briefs                  matter-level synthesis (history via superseded_at)
matter_chat_threads            per-(case, user) conversations
matter_chat_messages           role-tagged log with citations JSONB
```

Indexes:

- `(firm_id, case_id, ingested_at desc)` on `matter_documents` for list view.
- Partial index `where status in transient states` for the worker's pickup query.
- HNSW (`m=16, ef_construction=64`, cosine ops) on `matter_document_chunks.embedding`.
- Partial unique `(case_id) where superseded_at is null` on `matter_briefs` — O(1) "current brief" lookup.
- `(thread_id, created_at asc)` on `matter_chat_messages` for the chat scroll.

Idempotent ingest is enforced by `unique (case_id, content_hash)` on `matter_documents`. Re-uploading the same bytes for the same matter returns the existing row.

---

## 4. Tenant isolation

Every query path filters by `firm_id`. The service layer takes `firmId` from `req.user` via `firmIdForUser()` — never from a row being mutated. The route surface uses `requireAuth + requireActivePlan` + `requireFeature('matter.intelligence')`. The feature key is added with `default_baseline = true` in the migration so every user sees the surface today; tightening to per-plan or per-role is a `plan_features` / `role_features` change with no code touch.

Cross-tenant defences (in order, each independently sufficient):
1. The migration's foreign keys cascade on firm deletion.
2. Every `select / insert / update / delete` filters `firm_id`.
3. The case-existence guard (`assertCaseInFirm`) verifies the requesting firm owns the case before any ingest / summarise / brief / chat operation.
4. Chat-thread access is additionally gated on `thread.user_id = caller` — threads are not shared across users in v1.

---

## 5. AI prompt design

Three Claude calls. Each uses a strict JSON contract validated with Zod; on validation failure the service retries once before falling back to a deterministic stub.

### 5.1 Per-document summary

**System** ([`SUMMARY_SYSTEM`](./apps/api/src/services/matter-intel.service.ts)):

> You are a legal analyst assisting an Indian advocate. Read the document and return STRICT JSON with the schema below. Do not include any prose outside the JSON. Be precise. If a field is unknown, return null or an empty array — do not guess.
>
> Schema: `{ document_type, parties: [{ name, role }], key_dates: [{ date, event }], operative_content, citations: [{ statute_or_case, reference }], executive_summary }`

**User:** the document's extracted text, truncated to 30k characters with a `[... truncated]` marker.

### 5.2 Matter brief

**System** ([`BRIEF_SYSTEM`](./apps/api/src/services/matter-intel.service.ts)):

> You are briefing an Indian advocate on a matter. Given the per-document summaries below, return STRICT JSON synthesising the matter. Reflect the current procedural posture, key facts both sides have asserted, genuinely disputed issues, a chronological timeline, and open questions that the advocate should address. Indian legal context: respect BNS/BNSS/BSA where the matter is criminal; use CPC/Evidence Act/Contract Act vocabulary where civil. Do not fabricate facts.
>
> Schema: `{ posture, key_facts: [], disputed_issues: [], timeline: [{ date, event }], open_questions: [] }`

**User:** every persisted per-document summary serialised as JSON, separated by file headings, truncated at 40k characters.

### 5.3 Chat

**Retrieval** (no embeddings): the user's question is passed to Postgres FTS as a `plainto_tsquery` over `matter_document_chunks.text`, scoped to `(firm_id, case_id)`. The top-K matches by `ts_rank` (currently K = 8) become the context. When FTS returns zero hits — common for short or synonym-heavy questions — the service falls back to the most recently ingested chunks for the matter so chat always has *something* grounded to cite.

**System** ([`CHAT_SYSTEM`](./apps/api/src/services/matter-chat.service.ts)):

> You are answering an Indian advocate's question about a specific matter. You have been given retrieved chunks from the matter's documents. Answer ONLY from the retrieved context. Every factual claim MUST cite the source document and page using the format `[doc:<matter_document_id> p:<page>]`. If the retrieved context does not contain the answer, say so plainly — do not speculate. Use Indian legal vocabulary. Respond in the user's language if they wrote in Hindi or another Indic language.
>
> **Citation rules:** place the citation immediately after the supported sentence; chain `[doc:…][doc:…]` when multiple chunks support; never invent doc-ids.

**User:** the retrieved chunks (formatted with `[doc:<uuid> p:<n> file:"<name>"]` headers + body), 12k-char budget, followed by the user's question.

### 5.4 Citation post-processing

After streaming, the server scans the reply for `/\[doc:UUID p:N\]/g`. Each match is deduped and looked up against the retrieval set: if the `(docId, page)` pair was in the retrieved chunks, the matching snippet is attached; otherwise the citation is recorded with empty `snippet`. The UI surfaces empty-snippet citations and zero-citation assistant messages with soft warnings rather than rejecting them.

---

## 6. AI-disabled fallback

This is a **first-class behaviour**, not an error path. When neither `ANTHROPIC_API_KEY` nor `XAI_API_KEY` is set (i.e. `env.llmProvider === 'none'`):

| Path | Fallback |
|---|---|
| **Per-document summary** | Returns `{ document_type: 'unknown', executive_summary: 'AI summarisation is disabled in this environment…' }`. `model_used = 'fallback:none'`. |
| **Matter brief** | Returns `{ posture: 'Unknown — AI is disabled in this environment.', key_facts: [], … }`. `model_used = 'fallback:none'`. |
| **Chat** | Returns a deterministic reply that **still emits the retrieval result** as a bulleted list with `[doc:<uuid> p:<page>]` citations, so the citation drawer + source preview remain usable. `model_used = 'fallback:none'`. |
| **Embeddings** | Removed from the v1 pipeline. Chunks are stored text-only. The `vector(1024)` column and HNSW index from migration `0041` are kept for backwards-compat but are not written or read. `EMBED_SERVICE_URL` is ignored by matter-intel. |

The UI surfaces this state with a small **Degraded mode** banner whenever a brief/summary/message carries `modelUsed.startsWith('fallback:')`. The full feature is exercisable end-to-end with no API keys configured — the deterministic outputs make local dev and CI fast and free.

---

## 7. Background processing

Large files (`≥ 5 MB`) are queued through `pg-boss` via the `matter-intel.process` job (registered at module-import time in [matter-intel.service.ts](./apps/api/src/services/matter-intel.service.ts)). Smaller files run inline so the typical dev/test flow doesn't have to wait for a worker tick. Either path:

1. Updates `status = 'extracting'`.
2. Runs `extractText()` from [`lib/text-extraction.ts`](./apps/api/src/lib/text-extraction.ts).
3. Updates `status = 'embedding'` and chunks the text page-aware (form-feed splits for PDFs; approximate-page windows for DOCX/TXT).
4. Calls `embeddings.service.embed()` in batches of 64 and inserts chunks.
5. Updates `status = 'ready'`.
6. Auto-triggers `summariseDocument()` (best-effort; failure here doesn't roll back the ready state).

Failures set `status = 'failed'` with the error message truncated to 1000 chars. The UI's status chip surfaces this; the user can re-trigger a per-document summary, and re-uploading the same file is a no-op (hash check).

### Chunking

- **PDFs:** split on `\f` (form-feed) — `pdf-parse` emits these at page boundaries.
- **DOCX / TXT / MD:** approximate-page windowing of `APPROX_PAGE_CHARS = 3000` so the citation contract (`page` number) is uniform across all sources.
- **Chunk size:** 3000 chars target with 400-char overlap. Caps at `MAX_CHUNKS_PER_DOC = 240` so one pathological file can't run the embedding budget dry.

---

## 8. Streaming contract (chat)

`POST /api/matter-chat/threads/:threadId/messages` returns an SSE stream. The shape of each frame is a discriminated union — `MatterChatStreamEvent` in [`packages/types`](./packages/types/src/index.ts):

```
event: user_message       data: { ...MatterChatMessage }
event: delta              data: { text: "…" }              (many)
event: assistant_message  data: { ...MatterChatMessage }   (terminal)
event: error              data: { message: "…" }           (terminal)
```

The client (`streamMatterChatMessage` in [useMatterChat.ts](./apps/web/src/hooks/useMatterChat.ts)) appends `delta.text` to an in-flight optimistic assistant bubble; on `assistant_message` it swaps the optimistic bubble for the persisted row (canonical id + parsed citations). On `error` it clears the optimistic bubble and surfaces the message.

Retries: only on pre-response network errors (TypeError from `fetch()`). HTTP statuses are NOT retried — the server may have already committed the user-message persist, and double-committing would create a duplicate row. AbortSignal cancellation is honoured at three points: pre-fetch, during retry waits, and inside the read loop (calls `reader.cancel()`).

---

## 9. Permission model

| Layer | Where | Value |
|---|---|---|
| Plan gate | `requireActivePlan` | 402 when `firms.plan_status` is past_due / cancelled |
| Auth gate | `requireAuth` | 401 when no/invalid JWT |
| Feature gate | `requireFeature('matter.intelligence')` | Layered: `BASELINE ∨ (Plan ∧ Role ∧ ¬deny ∨ grant)` |
| Case gate | `assertCaseInFirm(firmId, caseId)` | 404 if the matter isn't in the firm |
| Thread gate | `thread.user_id = caller` | Threads are private per user; not shared in v1 |
| SuperAdmin | Bypasses plan + feature gates per existing platform admin pattern | — |

The migration writes `matter.intelligence` with `default_baseline = true` so the feature is available to every authenticated tenant user today. To tighten:
- Set `default_baseline = false` and add rows to `role_features` / `plan_features`.
- The DB-resolved feature set in `GET /api/me` is what the web client reads — flip the bit in `features` and the sidebar entry disappears, all routes return 403, and the in-tab Intelligence tab hides (when we add a hide condition).

---

## 10. Audit log

Every meaningful action writes an entry via `auditService.write()`:

| Action | Target type | Payload |
|---|---|---|
| `matter.intelligence.ingest` | `matter_document` | `{ caseId, sourceType, fileName?, sourceDocumentId?, sizeBytes? }` |
| `matter.intelligence.summarise` | `matter_document` | `{ modelUsed }` |
| `matter.intelligence.brief.regenerate` | `matter_brief` | `{ modelUsed, sourceSummaries }` (`targetId = caseId`) |
| `matter.intelligence.chat.message` | `matter_chat_thread` | `{ caseId, role, modelUsed?, citationCount?, retrievedChunks? }` |
| `matter.intelligence.remove` | `matter_document` | `{}` |

These actions + target types are added to the union types in [`packages/types`](./packages/types/src/index.ts) so the audit-log viewer ([`AuditLogView`](./apps/web/src/admin/views/AuditLogView.tsx)) picks them up without per-action plumbing.

---

## 11. Operator runbook

### One-time setup

1. **pgvector** (legacy requirement). The migration `0041_matter_intelligence.sql` still runs `create extension if not exists vector;` because the `matter_document_chunks.embedding` column is kept for backwards-compat. The extension must therefore exist on the Postgres server (`apt install postgresql-16-pgvector`, the managed-DB UI, or a custom Docker image). On Supabase the extension is preinstalled. If you don't have it, install before migrating; the column will simply stay NULL on every row.

2. **Run the migration.**

   ```bash
   pnpm --filter @lexdraft/api db:migrate
   ```

   Idempotent. Status-only:

   ```bash
   pnpm --filter @lexdraft/api db:status
   ```

3. **No new dependencies** are introduced for this feature — `pdf-parse`, `mammoth`, and `pg-boss` are already in `apps/api`. The web side adds no new npm packages. A plain `pnpm install` is enough on a fresh checkout.

### Required env vars

The feature **works without** any new env vars. The fallbacks listed in §6 take over when keys are missing. To unlock full AI behaviour:

```bash
# apps/api/.env
ANTHROPIC_API_KEY=sk-ant-…            # or XAI_API_KEY for grok
ANTHROPIC_MODEL=claude-sonnet-4-6     # default; override to switch model
LLM_PROVIDER=anthropic                # or 'xai' / 'auto' / 'none'
```

`EMBED_SERVICE_URL` and other `EMBED_*` env vars are **not used** by matter-intel anymore (post-v1 change — see banner at top). They still affect `laws-search.service.ts`, which is a separate feature.

### Verifying end-to-end

1. Start the API + web (`pnpm dev`).
2. Open any case at `/app/cases/:id`.
3. Click the **Intelligence** tab.
4. Drop a sample PDF (the repo has [`Notice_u_s_138_NI_Act.pdf`](./Notice_u_s_138_NI_Act.pdf) and [`Stamp_duty_estimate_Maharashtra_Sale_Deed.pdf`](./Stamp_duty_estimate_Maharashtra_Sale_Deed.pdf) for this).
5. Watch the status chip flip Queued → Extracting → Indexing → Ready (poll every 4s). The "Indexing" step is now a no-op pass-through — kept in the enum for backwards-compat with the UI badge.
6. Click **Generate brief** in the centre pane — confirms Claude path (or shows the degraded-mode banner if no key).
7. Type a question in the right pane — first message auto-creates a thread, the assistant bubble streams in token-by-token, citation pills resolve to the source-preview drawer.

---

## 12. Future work (out of scope for v1)

- **PDF / DOCX inline preview** in the citation drawer (via `pdfjs-dist`) with scroll-to-page. v1 renders surrounding extracted text as a textual placeholder.
- **Shared chat threads.** Today each user has their own thread history per matter. Sharing requires a new visibility model + access checks at message-write time.
- **Cross-matter chat.** Today retrieval is scoped to `(firm_id, case_id)`. A "research-mode" toggle could broaden to all matters in the firm — needs an explicit consent surface so the lawyer knows the answer source set has changed.
- **Citations into research corpus.** Chat could optionally retrieve from `laws-search.service` in addition to matter documents (returning citations with the existing law-citation contract).
- **Per-document chat.** Useful for very large documents (>50 pages). Same retrieval primitive, scoped by `matter_document_id` instead of `case_id`.
- **Streaming summaries.** Per-document summary + brief generation could stream via SSE the same way chat does, instead of one-shot JSON.
- **Re-enable vector retrieval as a v2 toggle.** Embeddings were removed because the typical matter (handful of docs, tens of pages) gets good answers from FTS + LLM reasoning alone. If users hit retrieval-quality issues on very large corpora (hundreds of pages across many matters), a per-firm "enable semantic search" flag could turn the embed pipeline back on. The `vector(1024)` column and HNSW index are still in place; the ingest path just no longer populates them and chat no longer queries them.

---

## 13. Reference

- **Migration:** [`apps/api/migrations/0041_matter_intelligence.sql`](./apps/api/migrations/0041_matter_intelligence.sql)
- **Backend services:** [`matter-intel.service.ts`](./apps/api/src/services/matter-intel.service.ts), [`matter-chat.service.ts`](./apps/api/src/services/matter-chat.service.ts)
- **Backend routes:** [`matter-intel.routes.ts`](./apps/api/src/routes/matter-intel.routes.ts), [`matter-chat.routes.ts`](./apps/api/src/routes/matter-chat.routes.ts)
- **Shared types:** [`packages/types/src/index.ts`](./packages/types/src/index.ts) (look for "Matter Intelligence")
- **Frontend hooks:** [`useMatterIntel.ts`](./apps/web/src/hooks/useMatterIntel.ts), [`useMatterChat.ts`](./apps/web/src/hooks/useMatterChat.ts)
- **Frontend UI:** [`MatterIntelPanel.tsx`](./apps/web/src/components/matter-intel/MatterIntelPanel.tsx), [`MatterIntelView.tsx`](./apps/web/src/views/MatterIntelView.tsx)
- **CSS:** `.matter-intel-*` block in [`globals.css`](./apps/web/src/styles/globals.css)
- **Nav + route registration:** [`App.tsx`](./apps/web/src/App.tsx), [`nav-config.ts`](./apps/web/src/components/shell/nav-config.ts)
