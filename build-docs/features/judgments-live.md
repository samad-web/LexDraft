# judgments-live (Stage 1) — DRAFT

## Purpose
Drafts and research need real judgments. Code exists (0098/0099, `scripts/ingest-judgments.ts`, `scripts/embed-judgments.ts`, `services/judgments.service.ts`); the data is not on prod.

## Architecture
- Source: AWS Open Data `indian-supreme-court-judgments` + `indian-high-court-judgments` (CC-BY-4.0; attribution shown on judgment views).
- Store: VPS Postgres (pgvector), not Supabase (2026-11-03 throttling). Public reference data, no firm_id.
- Order: SC 1950→ → Madras HC → HCs chosen by owner.
- Nightly incremental ingest (cron on VPS), resumable by `source_key`; embeddings in batches with a CPU/IO cap, off-peak.
- Search stays capped (1,500 FTS candidates, NN-200) + statement_timeout.

## Impact map
- Migrations 0098/0099 on prod (owner's go); VPS disk.
- Readers of the corpus — each re-checked once real data is present: `judgments.service.ts`, `lib/compose-authorities.ts`, `lib/draft-guards.ts`, `draft-review.service.ts`, `draft-revise.service.ts`, `mock-arguments.service.ts`, `diary-assistant.service.ts`, `intake-compose.service.ts`, `intake.service.ts`.
- Embed service load. Risk: ingest slowing the live app → off-peak, throttled, separate DB role with its own timeout.

## Edge cases
- Scanned PDFs with no text → metadata only, marked "text not available", never cited.
- Duplicates across sets → upsert on `source_key`.
- Embed service down → FTS-only rows, re-embedded later (already designed).
- Ingest killed mid-run → resumes; a judgment and its paragraphs are written in one transaction.

## Acceptance criteria
- SC + Madras HC counts on prod match the source manifest (unreadable PDFs listed).
- Judgment search p95 < 2 s; app API p95 unchanged during nightly ingest.
- Re-running ingest adds 0 duplicates.
