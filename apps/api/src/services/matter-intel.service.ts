/**
 * matter-intel.service — orchestrates document ingestion, per-document AI
 * summarisation, and matter-level brief synthesis for the Matter Intelligence
 * feature (see migration 0041_matter_intelligence.sql).
 *
 * Tenant safety:
 *   Every read and write filters by `firm_id`. Callers pass the resolved
 *   firmId from req.user; we never read it from the row being mutated.
 *
 * AI-disabled fallback:
 *   When `env.llmProvider === 'none'` (no ANTHROPIC_API_KEY / XAI_API_KEY),
 *   summarisation and brief generation return a deterministic stub so the
 *   UI renders end-to-end. The stub carries `model_used = 'fallback:none'`
 *   and the UI surfaces a "degraded mode" badge.
 *
 * Idempotent re-ingest:
 *   Files are content-hashed (SHA-256). The (case_id, content_hash) unique
 *   constraint on matter_documents means re-uploading the same bytes for
 *   the same matter is a no-op and returns the existing row.
 *
 * Background work:
 *   Files above LARGE_FILE_BYTES_THRESHOLD are enqueued on pg-boss
 *   (`matter-intel.process` job). The synchronous path is used for smaller
 *   files so the typical-case dev experience stays snappy. The job handler
 *   is registered at the bottom of this module so a single import wires
 *   everything up.
 */

import crypto from 'node:crypto';
import { z } from 'zod';
import type {
  MatterBrief,
  MatterDocument,
  MatterDocumentSummary,
  MatterDocumentStatus,
  MatterDocumentSource,
} from '@lexdraft/types';
import { db } from '../db/client';
import { env } from '../env';
import { logger } from '../logger';
import { withRetry, HttpRetryError } from '../lib/retry';
import { extractText, SUPPORTED_NOTE_MIME_TYPES } from '../lib/text-extraction';
import { storage } from './storage.service';
import { auditService } from './audit.service';
import { jobs } from './jobs.service';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Files above this size go through the pg-boss queue. The synchronous path
// stays usable for the small documents that dominate dev/test traffic. The
// 5 MB threshold is the same heuristic case-notes uses for "this might
// stall the request, push it to background" — keep them in sync.
const LARGE_FILE_BYTES_THRESHOLD = 5 * 1024 * 1024;

// Target chunk size in characters (approximate; pg-vector cares about
// tokens at retrieval time, but at chunk time char-count is the cheap
// proxy). 800 tokens ≈ 3,200 chars for English; we use 3,000 as a safer
// upper bound to leave headroom for the overlap window.
const CHUNK_CHARS = 3_000;
const CHUNK_OVERLAP_CHARS = 400;

// Maximum chunks we'll embed for a single matter document. Far beyond the
// expected ceiling (a 200-page PDF rarely produces more than ~120 chunks
// at this sizing); we cap to keep one pathological file from running the
// embedding budget dry.
const MAX_CHUNKS_PER_DOC = 240;

// Approximate "page" size for DOCX / text files that have no native page
// breaks. Each window of this many characters maps to one logical page
// for citation rendering.
const APPROX_PAGE_CHARS = 3_000;

export const ACCEPTED_MIME_TYPES = SUPPORTED_NOTE_MIME_TYPES;

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

interface MatterDocumentRow {
  id: string;
  firm_id: string;
  case_id: string;
  ingested_by: string;
  source_type: MatterDocumentSource;
  source_document_id: string | null;
  file_name: string;
  file_size_bytes: string | number | null;
  mime_type: string | null;
  storage_ref: string | null;
  content_hash: string | null;
  extracted_text: string | null;
  page_count: number | null;
  status: MatterDocumentStatus;
  status_error: string | null;
  ingested_at: Date;
  updated_at: Date;
}

function toMatterDocument(r: MatterDocumentRow): MatterDocument {
  return {
    id: r.id,
    firmId: r.firm_id,
    caseId: r.case_id,
    ingestedBy: r.ingested_by,
    sourceType: r.source_type,
    sourceDocumentId: r.source_document_id,
    fileName: r.file_name,
    fileSizeBytes: r.file_size_bytes != null ? Number(r.file_size_bytes) : null,
    mimeType: r.mime_type,
    storageRef: r.storage_ref,
    contentHash: r.content_hash,
    pageCount: r.page_count,
    status: r.status,
    statusError: r.status_error,
    ingestedAt: r.ingested_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

interface SummaryRow {
  id: string;
  firm_id: string;
  matter_document_id: string;
  document_type: string | null;
  parties: unknown;
  key_dates: unknown;
  operative_content: string | null;
  citations: unknown;
  executive_summary: string | null;
  model_used: string;
  generated_at: Date;
}

function jsonish<T>(raw: unknown, fallback: T): T {
  if (raw == null) return fallback;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as T; } catch { return fallback; }
  }
  return raw as T;
}

function toSummary(r: SummaryRow): MatterDocumentSummary {
  return {
    id: r.id,
    matterDocumentId: r.matter_document_id,
    documentType: r.document_type,
    parties: jsonish(r.parties, []),
    keyDates: jsonish(r.key_dates, []),
    operativeContent: r.operative_content,
    citations: jsonish(r.citations, []),
    executiveSummary: r.executive_summary,
    modelUsed: r.model_used,
    generatedAt: r.generated_at.toISOString(),
  };
}

interface BriefRow {
  id: string;
  firm_id: string;
  case_id: string;
  generated_by: string | null;
  posture: string | null;
  key_facts: unknown;
  disputed_issues: unknown;
  timeline: unknown;
  open_questions: unknown;
  model_used: string;
  generated_at: Date;
  superseded_at: Date | null;
}

function toBrief(r: BriefRow): MatterBrief {
  return {
    id: r.id,
    caseId: r.case_id,
    generatedBy: r.generated_by,
    posture: r.posture,
    keyFacts: jsonish(r.key_facts, []),
    disputedIssues: jsonish(r.disputed_issues, []),
    timeline: jsonish(r.timeline, []),
    openQuestions: jsonish(r.open_questions, []),
    modelUsed: r.model_used,
    generatedAt: r.generated_at.toISOString(),
    supersededAt: r.superseded_at?.toISOString() ?? null,
  };
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

export interface BuiltChunk {
  index: number;
  pageNumber: number;
  charStart: number;
  charEnd: number;
  text: string;
}

/**
 * Page-aware chunking. For PDFs we expect the caller to have segmented the
 * extracted text by page (using the `\f` form-feed character pdf-parse
 * already emits at page boundaries). For DOCX / TXT we fall back to
 * APPROX_PAGE_CHARS windows.
 */
export function buildChunks(text: string): BuiltChunk[] {
  if (!text.trim()) return [];

  // Split on form-feed first. pdf-parse emits \f between pages; if there
  // are none we treat the whole document as one logical page and the
  // approximate-page logic kicks in inside the splitter.
  const hasFormFeeds = text.includes('\f');
  const pages = hasFormFeeds ? text.split('\f') : [text];
  const chunks: BuiltChunk[] = [];

  let cursor = 0;          // absolute char offset in `text`
  let chunkIndex = 0;

  for (let p = 0; p < pages.length; p++) {
    const pageText = pages[p];
    if (!pageText) {
      // page boundary character itself adds 1 char to the absolute cursor.
      cursor += hasFormFeeds ? 1 : 0;
      continue;
    }

    let local = 0;
    while (local < pageText.length) {
      if (chunks.length >= MAX_CHUNKS_PER_DOC) return chunks;
      const end = Math.min(local + CHUNK_CHARS, pageText.length);
      const slice = pageText.slice(local, end).trim();
      if (slice.length > 0) {
        // Page number: 1-based for PDFs (real pages), 1-based for
        // approximate-page fallback (every APPROX_PAGE_CHARS).
        const pageNumber = hasFormFeeds
          ? p + 1
          : Math.floor(local / APPROX_PAGE_CHARS) + 1;
        chunks.push({
          index: chunkIndex++,
          pageNumber,
          charStart: cursor + local,
          charEnd: cursor + end,
          text: slice,
        });
      }
      // Advance by chunk size minus overlap; never go backwards.
      const next = end - CHUNK_OVERLAP_CHARS;
      local = next > local ? next : end;
    }
    cursor += pageText.length + (hasFormFeeds ? 1 : 0);
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// Verification helpers
// ---------------------------------------------------------------------------

interface CaseGate {
  ok: boolean;
}

async function assertCaseInFirm(firmId: string, caseId: string): Promise<CaseGate> {
  const sql = db();
  if (!sql) return { ok: true }; // demo mode — no DB means no check
  const [row] = await sql<{ id: string }[]>`
    select id from cases where id = ${caseId}::uuid and firm_id = ${firmId}::uuid limit 1
  `;
  return { ok: Boolean(row) };
}

async function fetchMatterDocumentRow(firmId: string, id: string): Promise<MatterDocumentRow | null> {
  const sql = db();
  if (!sql) return null;
  const [row] = await sql<MatterDocumentRow[]>`
    select * from matter_documents
    where id = ${id}::uuid and firm_id = ${firmId}::uuid
    limit 1
  `;
  return row ?? null;
}

// ---------------------------------------------------------------------------
// AI summary — per document
// ---------------------------------------------------------------------------

const SummarySchema = z.object({
  document_type: z.string().nullable().optional(),
  parties: z.array(z.object({
    name: z.string().nullable().optional(),
    role: z.string().nullable().optional(),
  })).optional().default([]),
  key_dates: z.array(z.object({
    date: z.string().nullable().optional(),
    event: z.string().nullable().optional(),
  })).optional().default([]),
  operative_content: z.string().nullable().optional(),
  citations: z.array(z.object({
    statute_or_case: z.string().nullable().optional(),
    reference: z.string().nullable().optional(),
  })).optional().default([]),
  executive_summary: z.string().nullable().optional(),
});

type ParsedSummary = z.infer<typeof SummarySchema>;

const SUMMARY_SYSTEM = `You are a legal analyst assisting an Indian advocate. Read the document and return STRICT JSON with the schema below. Do not include any prose outside the JSON. Be precise. If a field is unknown, return null or an empty array — do not guess.

Schema:
{
  "document_type": string | null,
  "parties": [{ "name": string, "role": string }],
  "key_dates": [{ "date": string (ISO-8601), "event": string }],
  "operative_content": string | null,
  "citations": [{ "statute_or_case": string, "reference": string }],
  "executive_summary": string | null
}`;

const BRIEF_SYSTEM = `You are briefing an Indian advocate on a matter. Given the per-document summaries below, return STRICT JSON synthesising the matter. Reflect the current procedural posture, key facts both sides have asserted, genuinely disputed issues, a chronological timeline, and open questions that the advocate should address. Indian legal context: respect BNS/BNSS/BSA where the matter is criminal; use CPC/Evidence Act/Contract Act vocabulary where civil. Do not fabricate facts.

Schema:
{
  "posture": string | null,
  "key_facts": string[],
  "disputed_issues": string[],
  "timeline": [{ "date": string, "event": string }],
  "open_questions": string[]
}`;

const BriefSchema = z.object({
  posture: z.string().nullable().optional(),
  key_facts: z.array(z.string()).optional().default([]),
  disputed_issues: z.array(z.string()).optional().default([]),
  timeline: z.array(z.object({
    date: z.string().nullable().optional(),
    event: z.string().nullable().optional(),
  })).optional().default([]),
  open_questions: z.array(z.string()).optional().default([]),
});

type ParsedBrief = z.infer<typeof BriefSchema>;

const SUMMARY_INPUT_CHAR_CAP = 30_000;
const BRIEF_INPUT_CHAR_CAP   = 40_000;

function modelTag(): string {
  return env.llmProvider === 'anthropic'
    ? `anthropic:${env.ANTHROPIC_MODEL}`
    : env.llmProvider === 'xai'
      ? `xai:${env.XAI_MODEL}`
      : 'fallback:none';
}

/** First well-formed JSON object in `s`. Tolerates leading prose / fences. */
function extractFirstJsonObject(s: string): string | null {
  const start = s.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i]!;
    if (escape) { escape = false; continue; }
    if (c === '\\') { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

async function callClaudeJson(system: string, user: string): Promise<string> {
  return withRetry(
    async () => {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: env.ANTHROPIC_MODEL,
          max_tokens: 2048,
          system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: user }],
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new HttpRetryError(res.status, `Claude ${res.status}: ${body}`);
      }
      const data = (await res.json()) as { content: Array<{ type: string; text: string }> };
      return data.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
    },
    {
      onRetry: (err, attempt, waitMs) =>
        logger.warn({ err, attempt, waitMs }, 'Claude (matter-intel) retry'),
    },
  );
}

async function callXaiJson(system: string, user: string): Promise<string> {
  return withRetry(async () => {
    const res = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.XAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.XAI_MODEL,
        max_tokens: 2048,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new HttpRetryError(res.status, `xAI ${res.status}: ${body}`);
    }
    const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    return data.choices[0]?.message?.content ?? '';
  });
}

async function llmJson(system: string, user: string): Promise<string | null> {
  if (env.llmProvider === 'anthropic') return callClaudeJson(system, user);
  if (env.llmProvider === 'xai')       return callXaiJson(system, user);
  return null;
}

/**
 * Call the LLM with the supplied system/user prompts, parse + validate the
 * JSON output with the supplied schema. Retries once on validation failure
 * before returning null.
 */
async function llmStructured<T>(
  system: string,
  user: string,
  schema: z.ZodType<T>,
): Promise<T | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await llmJson(system, user).catch((err) => {
      logger.warn({ err, attempt }, 'matter-intel LLM call threw');
      return null;
    });
    if (raw == null) return null;
    const json = extractFirstJsonObject(raw);
    if (!json) {
      logger.warn({ attempt }, 'matter-intel LLM returned no JSON object');
      continue;
    }
    try {
      const parsed = schema.parse(JSON.parse(json));
      return parsed;
    } catch (err) {
      logger.warn({ err, attempt }, 'matter-intel structured-output validation failed');
    }
  }
  return null;
}

function fallbackSummary(_text: string): ParsedSummary {
  return {
    document_type: 'unknown',
    parties: [],
    key_dates: [],
    operative_content: null,
    citations: [],
    executive_summary:
      'AI summarisation is disabled in this environment (no LLM provider configured). The document was ingested and is searchable, but no structured summary is available.',
  };
}

function fallbackBrief(): ParsedBrief {
  return {
    posture: 'Unknown — AI is disabled in this environment.',
    key_facts: [],
    disputed_issues: [],
    timeline: [],
    open_questions: [],
  };
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface IngestUploadInput {
  firmId: string;
  caseId: string;
  userId: string;
  userEmail: string;
  file: { buffer: Buffer; fileName: string; mimeType: string };
}

export interface IngestExistingInput {
  firmId: string;
  caseId: string;
  userId: string;
  userEmail: string;
  documentId: string;
}

export const matterIntelService = {
  // -------------------------------------------------------------------------
  // Quick-study sandbox matters
  //
  // A "quick study" is a sandbox case (`cases.kind = 'sandbox'`) that lets a
  // user upload a file and chat against it without first creating a real
  // matter. They reuse the full matter-intel pipeline; the only difference
  // is that the casesService.list filter hides them from the Cases view and
  // every downstream surface that lists matters (clients, leads, billing,
  // analytics). Sandboxes are user-private — `created_by_user_id` is set so
  // other users in the same firm can't see them.
  // -------------------------------------------------------------------------
  async createQuickStudy({
    firmId,
    userId,
    title,
  }: {
    firmId: string;
    userId: string;
    title?: string;
  }): Promise<{ id: string; title: string; createdAt: string }> {
    const sql = db();
    if (!sql) throw new Error('Database not configured');
    const ts = Date.now();
    const rnd = crypto.randomBytes(2).toString('hex');
    // Synthetic CNR; the `cases.cnr` column is NOT NULL UNIQUE so we need
    // something distinguishable yet collision-free. `QS-<ms>-<rand>` is
    // both human-recognisable and safely unique.
    const cnr = `QS-${ts}-${rnd}`;
    const resolvedTitle = (title?.trim() || `Quick study · ${new Date(ts).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`).slice(0, 200);
    const [row] = await sql<{ id: string; title: string; created_at: Date }[]>`
      insert into cases (
        firm_id, cnr, title, court, stage, client, status, type,
        kind, created_by_user_id
      ) values (
        ${firmId}::uuid, ${cnr}, ${resolvedTitle},
        '—', '—', '—', 'Active', 'Quick study',
        'sandbox', ${userId}::uuid
      )
      returning id, title, created_at
    `;
    if (!row) throw new Error('Failed to create quick study');
    return { id: row.id, title: row.title, createdAt: row.created_at.toISOString() };
  },

  async listQuickStudies({
    firmId,
    userId,
  }: {
    firmId: string;
    userId: string;
  }): Promise<Array<{ id: string; title: string; createdAt: string; documentCount: number }>> {
    const sql = db();
    if (!sql) return [];
    const rows = await sql<{ id: string; title: string; created_at: Date; document_count: string }[]>`
      select
        c.id,
        c.title,
        c.created_at,
        coalesce(
          (select count(*)::text from matter_documents md
            where md.case_id = c.id and md.firm_id = c.firm_id),
          '0'
        ) as document_count
      from cases c
      where c.firm_id = ${firmId}::uuid
        and c.kind = 'sandbox'
        and c.created_by_user_id = ${userId}::uuid
      order by c.created_at desc
      limit 100
    `;
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      createdAt: r.created_at.toISOString(),
      documentCount: Number.parseInt(r.document_count, 10) || 0,
    }));
  },

  async listMatterDocuments({ firmId, caseId }: { firmId: string; caseId: string }): Promise<Array<MatterDocument & { summary?: MatterDocumentSummary }>> {
    const sql = db();
    if (!sql) return [];
    const rows = await sql<(MatterDocumentRow & {
      s_id: string | null;
      s_document_type: string | null;
      s_parties: unknown;
      s_key_dates: unknown;
      s_operative_content: string | null;
      s_citations: unknown;
      s_executive_summary: string | null;
      s_model_used: string | null;
      s_generated_at: Date | null;
    })[]>`
      select
        md.*,
        s.id                as s_id,
        s.document_type     as s_document_type,
        s.parties           as s_parties,
        s.key_dates         as s_key_dates,
        s.operative_content as s_operative_content,
        s.citations         as s_citations,
        s.executive_summary as s_executive_summary,
        s.model_used        as s_model_used,
        s.generated_at      as s_generated_at
      from matter_documents md
      left join matter_document_summaries s on s.matter_document_id = md.id
      where md.firm_id = ${firmId}::uuid and md.case_id = ${caseId}::uuid
      order by md.ingested_at desc
    `;
    return rows.map((r) => {
      const doc = toMatterDocument(r);
      if (!r.s_id || !r.s_model_used || !r.s_generated_at) return doc;
      const summary: MatterDocumentSummary = {
        id: r.s_id,
        matterDocumentId: doc.id,
        documentType: r.s_document_type,
        parties: jsonish(r.s_parties, []),
        keyDates: jsonish(r.s_key_dates, []),
        operativeContent: r.s_operative_content,
        citations: jsonish(r.s_citations, []),
        executiveSummary: r.s_executive_summary,
        modelUsed: r.s_model_used,
        generatedAt: r.s_generated_at.toISOString(),
      };
      return { ...doc, summary };
    });
  },

  async getMatterDocument({ firmId, id }: { firmId: string; id: string }): Promise<(MatterDocument & { summary?: MatterDocumentSummary }) | null> {
    const sql = db();
    if (!sql) return null;
    const row = await fetchMatterDocumentRow(firmId, id);
    if (!row) return null;
    const doc = toMatterDocument(row);
    const [s] = await sql<SummaryRow[]>`
      select * from matter_document_summaries
      where matter_document_id = ${id}::uuid and firm_id = ${firmId}::uuid
      limit 1
    `;
    return s ? { ...doc, summary: toSummary(s) } : doc;
  },

  async ingestUpload(input: IngestUploadInput): Promise<MatterDocument> {
    if (!ACCEPTED_MIME_TYPES.some((m) => input.file.mimeType.startsWith(m))) {
      throw new Error(`Unsupported file type "${input.file.mimeType}". Allowed: PDF, DOCX, TXT, MD.`);
    }
    const gate = await assertCaseInFirm(input.firmId, input.caseId);
    if (!gate.ok) throw new Error('Case not found in this firm.');

    const hash = sha256(input.file.buffer);

    // Idempotency: if we already have this exact byte stream for this matter,
    // return it. The unique constraint would catch this at insert time too,
    // but a lookup-first path avoids racing with the constraint error path.
    const existing = await findByHash(input.firmId, input.caseId, hash);
    if (existing) return toMatterDocument(existing);

    // Store the bytes. `storage()` is keyed under a matter-scoped path so
    // operators eyeballing buckets can map keys back to a firm + case.
    const storageKey = `matter-intel/${input.firmId}/${input.caseId}/${hash.slice(0, 16)}-${safeFileName(input.file.fileName)}`;
    await storage().putObject({ key: storageKey, body: input.file.buffer, contentType: input.file.mimeType });

    const sql = db();
    if (!sql) throw new Error('Database not configured.');

    const [row] = await sql<MatterDocumentRow[]>`
      insert into matter_documents (
        firm_id, case_id, ingested_by, source_type, source_document_id,
        file_name, file_size_bytes, mime_type, storage_ref, content_hash, status
      ) values (
        ${input.firmId}::uuid,
        ${input.caseId}::uuid,
        ${input.userId}::uuid,
        'upload',
        null,
        ${input.file.fileName},
        ${input.file.buffer.length},
        ${input.file.mimeType},
        ${storageKey},
        ${hash},
        'pending'
      )
      returning *
    `;
    if (!row) throw new Error('Failed to insert matter_documents row.');

    void auditService.write({
      actorUserId: input.userId,
      actorEmail: input.userEmail,
      action: 'matter.intelligence.ingest',
      targetType: 'matter_document',
      targetId: row.id,
      payload: { caseId: input.caseId, sourceType: 'upload', fileName: input.file.fileName, sizeBytes: input.file.buffer.length },
    });

    // Background vs sync. Large files go through pg-boss; small files run
    // inline so the UI doesn't have to poll for trivial uploads.
    if (input.file.buffer.length >= LARGE_FILE_BYTES_THRESHOLD) {
      await jobs.enqueue('matter-intel.process', { matterDocumentId: row.id, firmId: input.firmId });
    } else {
      await processMatterDocument(row.id, input.firmId).catch((err) => {
        logger.error({ err, id: row.id }, 'sync matter-intel processing failed');
      });
    }

    const fresh = (await fetchMatterDocumentRow(input.firmId, row.id)) ?? row;
    return toMatterDocument(fresh);
  },

  async ingestExistingMatterDocument(input: IngestExistingInput): Promise<MatterDocument> {
    const gate = await assertCaseInFirm(input.firmId, input.caseId);
    if (!gate.ok) throw new Error('Case not found in this firm.');

    const sql = db();
    if (!sql) throw new Error('Database not configured.');

    const [src] = await sql<{
      id: string;
      case_id: string | null;
      storage_key: string | null;
      file_name: string | null;
      file_mime: string | null;
      file_size: string | number | null;
    }[]>`
      select id, case_id, storage_key, file_name, file_mime, file_size
      from documents
      where id = ${input.documentId}::uuid and firm_id = ${input.firmId}::uuid
      limit 1
    `;
    if (!src) throw new Error('Source document not found in this firm.');
    if (!src.storage_key || !src.file_name || !src.file_mime) {
      throw new Error('Source document has no attached file to ingest.');
    }

    const obj = await storage().getObject(src.storage_key);
    if (!obj) throw new Error('Source document blob is missing from storage.');

    const hash = sha256(obj.body);
    const existing = await findByHash(input.firmId, input.caseId, hash);
    if (existing) return toMatterDocument(existing);

    const [row] = await sql<MatterDocumentRow[]>`
      insert into matter_documents (
        firm_id, case_id, ingested_by, source_type, source_document_id,
        file_name, file_size_bytes, mime_type, storage_ref, content_hash, status
      ) values (
        ${input.firmId}::uuid,
        ${input.caseId}::uuid,
        ${input.userId}::uuid,
        'matter_document',
        ${input.documentId}::uuid,
        ${src.file_name},
        ${src.file_size != null ? Number(src.file_size) : obj.body.length},
        ${src.file_mime},
        ${src.storage_key},
        ${hash},
        'pending'
      )
      returning *
    `;
    if (!row) throw new Error('Failed to insert matter_documents row.');

    void auditService.write({
      actorUserId: input.userId,
      actorEmail: input.userEmail,
      action: 'matter.intelligence.ingest',
      targetType: 'matter_document',
      targetId: row.id,
      payload: { caseId: input.caseId, sourceType: 'matter_document', sourceDocumentId: input.documentId },
    });

    if ((src.file_size != null ? Number(src.file_size) : obj.body.length) >= LARGE_FILE_BYTES_THRESHOLD) {
      await jobs.enqueue('matter-intel.process', { matterDocumentId: row.id, firmId: input.firmId });
    } else {
      await processMatterDocument(row.id, input.firmId).catch((err) => {
        logger.error({ err, id: row.id }, 'sync matter-intel processing failed (existing document)');
      });
    }

    const fresh = (await fetchMatterDocumentRow(input.firmId, row.id)) ?? row;
    return toMatterDocument(fresh);
  },

  async summariseDocument(input: { firmId: string; matterDocumentId: string; userId: string; userEmail: string }): Promise<MatterDocumentSummary> {
    const sql = db();
    if (!sql) throw new Error('Database not configured.');

    const row = await fetchMatterDocumentRow(input.firmId, input.matterDocumentId);
    if (!row) throw new Error('Matter document not found.');
    if (!row.extracted_text || !row.extracted_text.trim()) {
      throw new Error('Document has no extracted text yet — extraction may still be in progress.');
    }

    const text = row.extracted_text.length > SUMMARY_INPUT_CHAR_CAP
      ? `${row.extracted_text.slice(0, SUMMARY_INPUT_CHAR_CAP)}\n[... truncated for prompt budget]`
      : row.extracted_text;

    const userMsg = `Summarise this document. Return JSON only.\n\n# Document\n${text}`;
    const parsed = (await llmStructured(SUMMARY_SYSTEM, userMsg, SummarySchema)) ?? fallbackSummary(text);

    const model = parsed === undefined ? 'fallback:none' : modelTag();

    const [stored] = await sql<SummaryRow[]>`
      insert into matter_document_summaries (
        firm_id, matter_document_id, document_type, parties, key_dates,
        operative_content, citations, executive_summary, model_used
      ) values (
        ${input.firmId}::uuid,
        ${input.matterDocumentId}::uuid,
        ${parsed.document_type ?? null},
        ${JSON.stringify(parsed.parties ?? [])}::jsonb,
        ${JSON.stringify(parsed.key_dates ?? [])}::jsonb,
        ${parsed.operative_content ?? null},
        ${JSON.stringify(parsed.citations ?? [])}::jsonb,
        ${parsed.executive_summary ?? null},
        ${model}
      )
      on conflict (matter_document_id) do update set
        document_type     = excluded.document_type,
        parties           = excluded.parties,
        key_dates         = excluded.key_dates,
        operative_content = excluded.operative_content,
        citations         = excluded.citations,
        executive_summary = excluded.executive_summary,
        model_used        = excluded.model_used,
        generated_at      = now()
      returning *
    `;
    if (!stored) throw new Error('Failed to upsert matter_document_summaries row.');

    void auditService.write({
      actorUserId: input.userId,
      actorEmail: input.userEmail,
      action: 'matter.intelligence.summarise',
      targetType: 'matter_document',
      targetId: input.matterDocumentId,
      payload: { modelUsed: model },
    });

    return toSummary(stored);
  },

  async getCurrentBrief({ firmId, caseId }: { firmId: string; caseId: string }): Promise<MatterBrief | null> {
    const sql = db();
    if (!sql) return null;
    const [row] = await sql<BriefRow[]>`
      select * from matter_briefs
      where firm_id = ${firmId}::uuid and case_id = ${caseId}::uuid and superseded_at is null
      limit 1
    `;
    return row ? toBrief(row) : null;
  },

  async generateMatterBrief(input: { firmId: string; caseId: string; userId: string; userEmail: string }): Promise<MatterBrief> {
    const gate = await assertCaseInFirm(input.firmId, input.caseId);
    if (!gate.ok) throw new Error('Case not found in this firm.');

    const sql = db();
    if (!sql) throw new Error('Database not configured.');

    const summaries = await sql<{ file_name: string; summary: unknown }[]>`
      select md.file_name, to_jsonb(s) as summary
      from matter_documents md
      join matter_document_summaries s on s.matter_document_id = md.id
      where md.firm_id = ${input.firmId}::uuid and md.case_id = ${input.caseId}::uuid
      order by md.ingested_at asc
    `;

    const blob = summaries.length === 0
      ? '[No document summaries yet for this matter.]'
      : summaries
          .map((s, i) => `## Document ${i + 1} — ${s.file_name}\n${JSON.stringify(s.summary)}`)
          .join('\n\n')
          .slice(0, BRIEF_INPUT_CHAR_CAP);

    const parsed = (await llmStructured(BRIEF_SYSTEM, `# Per-document summaries\n\n${blob}\n\nReturn JSON only.`, BriefSchema))
      ?? fallbackBrief();
    const model = env.llmProvider === 'none' ? 'fallback:none' : modelTag();

    await sql.begin(async (tx) => {
      await tx`
        update matter_briefs
        set superseded_at = now()
        where firm_id = ${input.firmId}::uuid and case_id = ${input.caseId}::uuid and superseded_at is null
      `;
      await tx`
        insert into matter_briefs (
          firm_id, case_id, generated_by, posture, key_facts, disputed_issues,
          timeline, open_questions, model_used
        ) values (
          ${input.firmId}::uuid,
          ${input.caseId}::uuid,
          ${input.userId}::uuid,
          ${parsed.posture ?? null},
          ${JSON.stringify(parsed.key_facts ?? [])}::jsonb,
          ${JSON.stringify(parsed.disputed_issues ?? [])}::jsonb,
          ${JSON.stringify(parsed.timeline ?? [])}::jsonb,
          ${JSON.stringify(parsed.open_questions ?? [])}::jsonb,
          ${model}
        )
      `;
    });

    void auditService.write({
      actorUserId: input.userId,
      actorEmail: input.userEmail,
      action: 'matter.intelligence.brief.regenerate',
      targetType: 'matter_brief',
      targetId: input.caseId,
      payload: { modelUsed: model, sourceSummaries: summaries.length },
    });

    const current = await this.getCurrentBrief({ firmId: input.firmId, caseId: input.caseId });
    if (!current) throw new Error('Brief insert succeeded but read-back returned no row.');
    return current;
  },

  async removeMatterDocument(input: { firmId: string; id: string; userId: string; userEmail: string }): Promise<void> {
    const sql = db();
    if (!sql) return;
    const [row] = await sql<{ storage_ref: string | null; source_type: MatterDocumentSource }[]>`
      delete from matter_documents
      where id = ${input.id}::uuid and firm_id = ${input.firmId}::uuid
      returning storage_ref, source_type
    `;
    if (!row) return;
    // Only delete the blob if we own it (source_type='upload'). For pulled
    // documents the blob is owned by the documents table and must persist.
    if (row.source_type === 'upload' && row.storage_ref) {
      await storage().delete(row.storage_ref).catch((err) =>
        logger.warn({ err, key: row.storage_ref }, 'failed to delete matter-intel blob'));
    }
    void auditService.write({
      actorUserId: input.userId,
      actorEmail: input.userEmail,
      action: 'matter.intelligence.remove',
      targetType: 'matter_document',
      targetId: input.id,
      payload: {},
    });
  },
};

async function findByHash(firmId: string, caseId: string, hash: string): Promise<MatterDocumentRow | null> {
  const sql = db();
  if (!sql) return null;
  const [row] = await sql<MatterDocumentRow[]>`
    select * from matter_documents
    where firm_id = ${firmId}::uuid and case_id = ${caseId}::uuid and content_hash = ${hash}
    limit 1
  `;
  return row ?? null;
}

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
}

// ---------------------------------------------------------------------------
// Processing pipeline: extract → chunk → embed → mark ready
// Exposed so the pg-boss handler and the sync path share one implementation.
// ---------------------------------------------------------------------------

export async function processMatterDocument(matterDocumentId: string, firmId: string): Promise<void> {
  const sql = db();
  if (!sql) return;

  const row = await fetchMatterDocumentRow(firmId, matterDocumentId);
  if (!row) {
    logger.warn({ matterDocumentId, firmId }, 'matter-intel: row vanished mid-processing');
    return;
  }
  if (row.status === 'ready') return;

  try {
    await sql`
      update matter_documents set status = 'extracting', status_error = null
      where id = ${matterDocumentId}::uuid and firm_id = ${firmId}::uuid
    `;

    const obj = row.storage_ref ? await storage().getObject(row.storage_ref) : null;
    if (!obj) throw new Error('Blob missing from storage.');

    const extraction = await extractText({
      body: obj.body,
      mime: row.mime_type ?? obj.contentType ?? 'application/octet-stream',
      fileName: row.file_name,
    });
    if (!extraction.ok) throw new Error(`Text extraction failed: ${extraction.error}`);

    const text = extraction.text;
    const pageCount = text.includes('\f') ? text.split('\f').length : Math.max(1, Math.ceil(text.length / APPROX_PAGE_CHARS));

    await sql`
      update matter_documents
      set extracted_text = ${text},
          page_count     = ${pageCount},
          status         = 'embedding'
      where id = ${matterDocumentId}::uuid and firm_id = ${firmId}::uuid
    `;

    const chunks = buildChunks(text);
    if (chunks.length > 0) {
      // Existing rows belong to a previous (failed) attempt — wipe first so
      // chunk_index stays canonical and the unique constraint isn't violated
      // by retry. Cascading via FK would not help here; same firm+matter row.
      await sql`
        delete from matter_document_chunks
        where matter_document_id = ${matterDocumentId}::uuid and firm_id = ${firmId}::uuid
      `;

      // Matter Intelligence runs without embeddings — chunks are persisted
      // text-only and chat retrieval uses Postgres FTS. Embedding adds
      // complexity (separate service, vector DB tuning, latency budget)
      // that isn't justified for the typical matter (a handful of docs,
      // tens of pages) where LLM context windows can ingest relevant text
      // directly. The `embedding vector(1024)` column on
      // matter_document_chunks stays for backwards-compat but is left
      // NULL for new ingests.
      for (const c of chunks) {
        await sql`
          insert into matter_document_chunks (
            firm_id, matter_document_id, chunk_index, page_number,
            char_start, char_end, text, token_count
          ) values (
            ${firmId}::uuid,
            ${matterDocumentId}::uuid,
            ${c.index},
            ${c.pageNumber},
            ${c.charStart},
            ${c.charEnd},
            ${c.text},
            ${Math.ceil(c.text.length / 4)}
          )
          on conflict (matter_document_id, chunk_index) do nothing
        `;
      }
    }

    await sql`
      update matter_documents set status = 'ready'
      where id = ${matterDocumentId}::uuid and firm_id = ${firmId}::uuid
    `;

    // Best-effort: kick off summary generation now that extraction is done.
    // Wrap in a try so a summary failure doesn't roll back the ready state.
    try {
      const [actor] = await sql<{ id: string; email: string }[]>`
        select id, email from users where id = ${row.ingested_by}::uuid limit 1
      `;
      if (actor) {
        await matterIntelService.summariseDocument({
          firmId,
          matterDocumentId,
          userId: actor.id,
          userEmail: actor.email,
        });
      }
    } catch (err) {
      logger.warn({ err, matterDocumentId }, 'matter-intel summary auto-trigger failed');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await sql`
      update matter_documents
      set status = 'failed', status_error = ${message.slice(0, 1000)}
      where id = ${matterDocumentId}::uuid and firm_id = ${firmId}::uuid
    `;
    logger.error({ err, matterDocumentId }, 'matter-intel processing failed');
  }
}

// ---------------------------------------------------------------------------
// pg-boss handler — registered at import time so the worker picks it up
// during `jobs.start()` in index.ts (which already imports all services).
// ---------------------------------------------------------------------------

interface ProcessJobPayload {
  matterDocumentId: string;
  firmId: string;
}

jobs.register<ProcessJobPayload>('matter-intel.process', async (data) => {
  await processMatterDocument(data.matterDocumentId, data.firmId);
});
