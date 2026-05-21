/**
 * matter-chat.service — per-matter chat grounded in the ingested matter
 * corpus. Companion to matter-intel.service.
 *
 * Retrieval:
 *   * Postgres FTS (plainto_tsquery) over matter_document_chunks scoped
 *     to (firm_id, case_id). Embedding-based ANN retrieval was removed
 *     deliberately — the typical matter corpus is small enough that
 *     keyword retrieval + the LLM's reasoning over the cited chunks
 *     gives good answers without the operational cost of running a
 *     separate embedding service.
 *   * When FTS yields no hits we fall back to a recency-ordered slice
 *     so chat still has something grounded to cite for synonym-heavy
 *     questions.
 *
 * Generation:
 *   * Streams the assistant reply via an async generator. Each yielded
 *     chunk is a delta string. The route turns this into Server-Sent
 *     Events.
 *   * Persists the full reply + citations at end-of-stream.
 *   * AI-disabled fallback: when env.llmProvider === 'none', yields a
 *     deterministic "AI is disabled in this environment; relevant chunks:"
 *     response that lists the retrieval hits so the UI is usable in dev.
 *
 * Citation contract:
 *   Every factual claim in an assistant message must cite a source via
 *   `[doc:<matter_document_id> p:<page>]`. The post-stream parser scans
 *   for that pattern, dedupes against the retrieval set, and persists
 *   the resulting array as the message's `citations` JSONB.
 */

import type {
  MatterChatMessage,
  MatterChatThread,
  MatterCitation,
} from '@lexdraft/types';
import { db } from '../db/client';
import { env } from '../env';
import { logger } from '../logger';
import { auditService } from './audit.service';

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

interface ThreadRow {
  id: string;
  firm_id: string;
  case_id: string;
  user_id: string;
  title: string | null;
  created_at: Date;
  last_message_at: Date;
}

function toThread(r: ThreadRow): MatterChatThread {
  return {
    id: r.id,
    caseId: r.case_id,
    userId: r.user_id,
    title: r.title,
    createdAt: r.created_at.toISOString(),
    lastMessageAt: r.last_message_at.toISOString(),
  };
}

interface MessageRow {
  id: string;
  firm_id: string;
  thread_id: string;
  role: 'user' | 'assistant';
  content: string;
  citations: unknown;
  model_used: string | null;
  created_at: Date;
}

function jsonish<T>(raw: unknown, fallback: T): T {
  if (raw == null) return fallback;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as T; } catch { return fallback; }
  }
  return raw as T;
}

function toMessage(r: MessageRow): MatterChatMessage {
  return {
    id: r.id,
    threadId: r.thread_id,
    role: r.role,
    content: r.content,
    citations: jsonish(r.citations, []),
    modelUsed: r.model_used,
    createdAt: r.created_at.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Retrieval
// ---------------------------------------------------------------------------

interface RetrievedChunk {
  matterDocumentId: string;
  fileName: string;
  page: number;
  text: string;
  score: number;
}

const RETRIEVAL_K       = 8;
const CONTEXT_CHAR_BUDGET = 12_000;

async function retrieve(firmId: string, caseId: string, query: string): Promise<RetrievedChunk[]> {
  const sql = db();
  if (!sql) return [];

  const trimmed = query.trim();
  if (!trimmed) return [];

  // Matter Intelligence chat runs without vector retrieval — we use Postgres
  // FTS (plainto_tsquery sanitises the input). The matter corpus is small
  // enough that keyword ranking + the LLM's own reasoning over the cited
  // chunks gives sufficient answer quality, while avoiding the operational
  // cost of running an embedding service. If a chunk matches no FTS tokens
  // we also surface a recency-ordered fallback so chat still has something
  // grounded to cite when the user's question doesn't share vocabulary
  // with the document text (common for synonym-heavy legal questions).
  const ftsRows = await sql<Array<{
    matter_document_id: string;
    file_name: string;
    page_number: number;
    text: string;
    rank: number;
  }>>`
    select c.matter_document_id, md.file_name, c.page_number, c.text,
           ts_rank(to_tsvector('simple', c.text), plainto_tsquery('simple', ${trimmed})) as rank
    from matter_document_chunks c
    join matter_documents md on md.id = c.matter_document_id
    where c.firm_id = ${firmId}::uuid
      and md.case_id = ${caseId}::uuid
      and to_tsvector('simple', c.text) @@ plainto_tsquery('simple', ${trimmed})
    order by rank desc
    limit ${RETRIEVAL_K}
  `;
  if (ftsRows.length > 0) {
    return ftsRows.map((r) => ({
      matterDocumentId: r.matter_document_id,
      fileName: r.file_name,
      page: r.page_number,
      text: r.text,
      score: r.rank,
    }));
  }

  // No FTS hits — fall through to a recency-ordered slice so chat still has
  // grounded context. Bounded by RETRIEVAL_K to keep the prompt manageable.
  const recentRows = await sql<Array<{
    matter_document_id: string;
    file_name: string;
    page_number: number;
    text: string;
  }>>`
    select c.matter_document_id, md.file_name, c.page_number, c.text
    from matter_document_chunks c
    join matter_documents md on md.id = c.matter_document_id
    where c.firm_id = ${firmId}::uuid
      and md.case_id = ${caseId}::uuid
    order by md.ingested_at desc, c.chunk_index asc
    limit ${RETRIEVAL_K}
  `;
  return recentRows.map((r) => ({
    matterDocumentId: r.matter_document_id,
    fileName: r.file_name,
    page: r.page_number,
    text: r.text,
    score: 0,
  }));
}

function buildContextBlock(chunks: RetrievedChunk[]): string {
  let total = 0;
  const parts: string[] = [];
  for (const c of chunks) {
    const header = `[doc:${c.matterDocumentId} p:${c.page} file:"${c.fileName}"]`;
    const body = c.text.replace(/\s+/g, ' ').trim();
    const block = `${header}\n${body}`;
    if (total + block.length > CONTEXT_CHAR_BUDGET) {
      parts.push('[remaining chunks omitted — context budget reached]');
      break;
    }
    total += block.length;
    parts.push(block);
  }
  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// Citation parsing
// ---------------------------------------------------------------------------

const CITATION_RE = /\[doc:([0-9a-f-]{36})\s+p:(\d+)\]/gi;

function parseCitations(reply: string, chunks: RetrievedChunk[]): MatterCitation[] {
  const byKey = new Map<string, RetrievedChunk>();
  for (const c of chunks) byKey.set(`${c.matterDocumentId}|${c.page}`, c);

  const seen = new Set<string>();
  const out: MatterCitation[] = [];
  for (const m of reply.matchAll(CITATION_RE)) {
    const docId = m[1]!;
    const page = Number.parseInt(m[2]!, 10);
    const key = `${docId}|${page}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const hit = byKey.get(key);
    out.push({
      matterDocumentId: docId,
      page,
      snippet: hit ? hit.text.slice(0, 240) : '',
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const CHAT_SYSTEM = `You are answering an Indian advocate's question about a specific matter. You have been given retrieved chunks from the matter's documents. Answer ONLY from the retrieved context. Every factual claim MUST cite the source document and page using the format [doc:<matter_document_id> p:<page>]. If the retrieved context does not contain the answer, say so plainly — do not speculate. Use Indian legal vocabulary. Respond in the user's language if they wrote in Hindi or another Indic language.

Citation rules:
* Place the citation immediately after the sentence (or clause) it supports.
* Multiple sentences from the same chunk: cite at the end of the last one.
* Multiple supporting chunks: chain citations e.g. "...as held in para 12. [doc:abc p:3][doc:def p:7]"
* Never invent doc-id / page values. Only cite ids that appear in the provided context.`;

function modelTag(): string {
  return env.llmProvider === 'anthropic'
    ? `anthropic:${env.ANTHROPIC_MODEL}`
    : env.llmProvider === 'xai'
      ? `xai:${env.XAI_MODEL}`
      : 'fallback:none';
}

// ---------------------------------------------------------------------------
// Streaming providers
// ---------------------------------------------------------------------------

async function* streamClaude(system: string, user: string): AsyncGenerator<string, void, void> {
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
      stream: true,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok || !res.body) {
    const body = res.body ? await res.text() : '';
    throw new Error(`Claude ${res.status}: ${body.slice(0, 300)}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep = buffer.indexOf('\n\n');
    while (sep !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      sep = buffer.indexOf('\n\n');
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const evt = JSON.parse(payload) as { type?: string; delta?: { type?: string; text?: string } };
          if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta' && evt.delta.text) {
            yield evt.delta.text;
          }
        } catch { /* ignore malformed frames */ }
      }
    }
  }
}

async function* streamXai(system: string, user: string): AsyncGenerator<string, void, void> {
  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.XAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: env.XAI_MODEL,
      max_tokens: 2048,
      stream: true,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok || !res.body) {
    const body = res.body ? await res.text() : '';
    throw new Error(`xAI ${res.status}: ${body.slice(0, 300)}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep = buffer.indexOf('\n\n');
    while (sep !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      sep = buffer.indexOf('\n\n');
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const evt = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> };
          const text = evt.choices?.[0]?.delta?.content;
          if (text) yield text;
        } catch { /* ignore */ }
      }
    }
  }
}

function fallbackReply(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) {
    return 'AI is disabled in this environment (no LLM provider is configured), and no relevant chunks were retrieved for your question. Ingest documents and configure ANTHROPIC_API_KEY (or XAI_API_KEY) to get cited answers.';
  }
  const lines: string[] = [
    'AI is disabled in this environment (no LLM provider is configured). Here are the most relevant excerpts from the matter corpus for your question:',
    '',
  ];
  for (const c of chunks.slice(0, 5)) {
    lines.push(`• "${c.text.slice(0, 240).replace(/\s+/g, ' ').trim()}" [doc:${c.matterDocumentId} p:${c.page}]`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const matterChatService = {
  async createThread(input: { firmId: string; caseId: string; userId: string; title?: string | null }): Promise<MatterChatThread> {
    const sql = db();
    if (!sql) throw new Error('Database not configured.');
    // Verify the case is in the firm — otherwise a client could spawn a
    // thread against a foreign matter id.
    const [c] = await sql<{ id: string }[]>`
      select id from cases where id = ${input.caseId}::uuid and firm_id = ${input.firmId}::uuid limit 1
    `;
    if (!c) throw new Error('Case not found in this firm.');

    const [row] = await sql<ThreadRow[]>`
      insert into matter_chat_threads (firm_id, case_id, user_id, title)
      values (${input.firmId}::uuid, ${input.caseId}::uuid, ${input.userId}::uuid, ${input.title ?? null})
      returning *
    `;
    if (!row) throw new Error('Failed to create chat thread.');
    return toThread(row);
  },

  async listThreads(input: { firmId: string; caseId: string; userId: string }): Promise<MatterChatThread[]> {
    const sql = db();
    if (!sql) return [];
    const rows = await sql<ThreadRow[]>`
      select * from matter_chat_threads
      where firm_id = ${input.firmId}::uuid
        and case_id = ${input.caseId}::uuid
        and user_id = ${input.userId}::uuid
      order by last_message_at desc
    `;
    return rows.map(toThread);
  },

  async listMessages(input: { firmId: string; threadId: string; userId: string }): Promise<MatterChatMessage[]> {
    const sql = db();
    if (!sql) return [];
    // Gate by (thread.user_id = caller). Threads aren't shared in v1.
    const [t] = await sql<ThreadRow[]>`
      select * from matter_chat_threads
      where id = ${input.threadId}::uuid and firm_id = ${input.firmId}::uuid and user_id = ${input.userId}::uuid
      limit 1
    `;
    if (!t) return [];
    const rows = await sql<MessageRow[]>`
      select * from matter_chat_messages
      where thread_id = ${input.threadId}::uuid and firm_id = ${input.firmId}::uuid
      order by created_at asc
    `;
    return rows.map(toMessage);
  },

  /**
   * Post a user message and stream the assistant reply. Yields a sequence
   * of events:
   *   { type: 'user_message',   message }            — once, immediately
   *   { type: 'delta',          text }               — many, while streaming
   *   { type: 'assistant_message', message }         — once, when complete
   *   { type: 'error',          message }            — on terminal failure
   *
   * The route translates these into SSE frames.
   */
  async *streamMessage(input: {
    firmId: string;
    threadId: string;
    userId: string;
    userEmail: string;
    content: string;
  }): AsyncGenerator<
    | { type: 'user_message'; message: MatterChatMessage }
    | { type: 'delta'; text: string }
    | { type: 'assistant_message'; message: MatterChatMessage }
    | { type: 'error'; message: string },
    void,
    void
  > {
    const sql = db();
    if (!sql) {
      yield { type: 'error', message: 'Database not configured.' };
      return;
    }

    const [t] = await sql<ThreadRow[]>`
      select * from matter_chat_threads
      where id = ${input.threadId}::uuid
        and firm_id = ${input.firmId}::uuid
        and user_id = ${input.userId}::uuid
      limit 1
    `;
    if (!t) {
      yield { type: 'error', message: 'Thread not found.' };
      return;
    }

    // Persist the user message immediately.
    const [userMsg] = await sql<MessageRow[]>`
      insert into matter_chat_messages (firm_id, thread_id, role, content, citations)
      values (${input.firmId}::uuid, ${input.threadId}::uuid, 'user', ${input.content}, '[]'::jsonb)
      returning *
    `;
    if (!userMsg) {
      yield { type: 'error', message: 'Failed to persist user message.' };
      return;
    }
    yield { type: 'user_message', message: toMessage(userMsg) };

    void auditService.write({
      actorUserId: input.userId,
      actorEmail: input.userEmail,
      action: 'matter.intelligence.chat.message',
      targetType: 'matter_chat_thread',
      targetId: input.threadId,
      payload: { caseId: t.case_id, role: 'user' },
    });

    // Retrieval.
    const chunks = await retrieve(input.firmId, t.case_id, input.content);
    const context = buildContextBlock(chunks);

    // Generation.
    const userPrompt = chunks.length === 0
      ? `The retrieval found no documents for this question. Tell the advocate you cannot answer without supporting documents in the matter corpus.\n\n# Question\n${input.content}`
      : `# Retrieved context\n${context}\n\n# Question\n${input.content}`;

    let assistantText = '';
    try {
      if (env.llmProvider === 'anthropic') {
        for await (const delta of streamClaude(CHAT_SYSTEM, userPrompt)) {
          assistantText += delta;
          yield { type: 'delta', text: delta };
        }
      } else if (env.llmProvider === 'xai') {
        for await (const delta of streamXai(CHAT_SYSTEM, userPrompt)) {
          assistantText += delta;
          yield { type: 'delta', text: delta };
        }
      } else {
        // Fallback. Emit as one delta so the UI's streaming append path
        // still exercises.
        assistantText = fallbackReply(chunks);
        yield { type: 'delta', text: assistantText };
      }
    } catch (err) {
      logger.warn({ err }, 'matter-chat LLM stream failed; emitting fallback reply');
      assistantText = fallbackReply(chunks);
      yield { type: 'delta', text: assistantText };
    }

    const citations = parseCitations(assistantText, chunks);
    const model = modelTag();

    const [assistantMsg] = await sql<MessageRow[]>`
      insert into matter_chat_messages (firm_id, thread_id, role, content, citations, model_used)
      values (
        ${input.firmId}::uuid,
        ${input.threadId}::uuid,
        'assistant',
        ${assistantText},
        ${JSON.stringify(citations)}::jsonb,
        ${model}
      )
      returning *
    `;
    if (!assistantMsg) {
      yield { type: 'error', message: 'Failed to persist assistant message.' };
      return;
    }

    await sql`
      update matter_chat_threads set last_message_at = now()
      where id = ${input.threadId}::uuid and firm_id = ${input.firmId}::uuid
    `;

    void auditService.write({
      actorUserId: input.userId,
      actorEmail: input.userEmail,
      action: 'matter.intelligence.chat.message',
      targetType: 'matter_chat_thread',
      targetId: input.threadId,
      payload: { caseId: t.case_id, role: 'assistant', modelUsed: model, citationCount: citations.length, retrievedChunks: chunks.length },
    });

    yield { type: 'assistant_message', message: toMessage(assistantMsg) };
  },
};
