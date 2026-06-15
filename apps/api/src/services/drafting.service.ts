import type { DraftRequest, DraftResponse } from '@lexdraft/types';
import { env } from '../env';
import { logger } from '../logger';
import { withRetry, HttpRetryError } from '../lib/retry';
import { anthropicUsage, xaiUsage, type NormalizedUsage } from '../lib/llm-usage';

const SAMPLE_TEMPLATE = (req: DraftRequest): string => {
  const lines: string[] = [];
  lines.push(req.docType.toUpperCase());
  lines.push('');
  const dated = req.draftDate ?? new Date().toISOString().slice(0, 10);
  lines.push(`Dated: ${dated}`);
  lines.push(`Drafted in ${req.language === 'EN' ? 'English' : req.language === 'HI' ? 'Hindi' : 'Tamil'} · Tone: ${req.tone}`);
  lines.push('');
  for (const [k, v] of Object.entries(req.fields)) {
    if (!v) continue;
    lines.push(`${k.replace(/_/g, ' ')}: ${v}`);
  }
  lines.push('');
  lines.push(
    `This document is generated as a working draft for advocate review. It follows Indian procedural conventions for ${req.docType} and is to be revised before filing or service. All facts and citations should be verified against the case record.`,
  );
  lines.push('');
  lines.push('Yours faithfully,');
  lines.push('Counsel for the Petitioner');
  return lines.join('\n');
};

interface BuiltPrompt {
  system: string;
  user: string;
}

/** Case-note context folded into the user message. Title is shown as a
 *  human-readable label; body is the typed text or PDF/DOCX extraction
 *  output produced by case-notes.service. */
export interface NoteContextItem {
  id: string;
  title: string;
  body: string;
}

/** Trim a single note body so the combined context stays within a sane
 *  token budget. Per-note cap keeps one giant note from crowding everything
 *  else out; the corpus cap (in buildPrompt) is the global limit. */
const PER_NOTE_CHAR_CAP = 8_000;
const ALL_NOTES_CHAR_CAP = 24_000;

function clipNoteBody(body: string): string {
  if (body.length <= PER_NOTE_CHAR_CAP) return body;
  return `${body.slice(0, PER_NOTE_CHAR_CAP)}\n[... truncated for prompt budget]`;
}

function renderNotesBlock(notes: NoteContextItem[]): string {
  if (notes.length === 0) return '';
  let total = 0;
  const sections: string[] = [];
  for (const n of notes) {
    const clipped = clipNoteBody(n.body.trim());
    if (total + clipped.length > ALL_NOTES_CHAR_CAP) {
      sections.push(`\n[remaining ${notes.length - sections.length} notes omitted - prompt budget reached]`);
      break;
    }
    total += clipped.length;
    sections.push(`## ${n.title}\n${clipped}`);
  }
  return `\n\n# Case notes (advocate-supplied background)\n${sections.join('\n\n')}`;
}

/** Split into system + user so Anthropic's top-level `system` param and xAI's
 *  `{role:'system'}` message both carry the persona/style instructions, while
 *  the user message carries only the request-specific task and brief. Same
 *  split is applied to both providers - A/B remains apples-to-apples. */
function buildPrompt(req: DraftRequest, notes: NoteContextItem[] = []): BuiltPrompt {
  const langName = req.language === 'EN' ? 'English' : req.language === 'HI' ? 'Hindi' : 'Tamil';
  const briefLines = Object.entries(req.fields)
    .filter(([, v]) => v && v.toString().trim())
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');
  const dated = req.draftDate ?? new Date().toISOString().slice(0, 10);

  const system = `You are an experienced Indian advocate. Draft court-ready documents in ${langName} following Indian legal conventions, statutes, and pleading style. Number paragraphs where appropriate. Include proper headings, parties block, prayer/conclusion, and verification/jurat where applicable. Be precise and concise - under 500 words. Output ONLY the document text - no commentary, no markdown.${notes.length > 0 ? ' Use the case notes only when they directly inform a fact or pleading; do not pad the draft with unrelated context.' : ''}`;

  const user = `Draft a "${req.docType}" with tone: ${req.tone}. Date the document "${dated}".

# Brief
${briefLines}${renderNotesBlock(notes)}`;

  return { system, user };
}

type ProviderOverride = 'xai' | 'anthropic' | undefined;

/** Token usage surfaced to the caller after a successful provider call, so the
 *  route (which knows firmId/userId) can record it. Best-effort - callers must
 *  never let an onUsage handler throw into the generation path. */
export interface LlmUsage extends NormalizedUsage {
  provider: 'anthropic' | 'xai';
  model: string;
}

export interface GenerateOpts {
  provider?: ProviderOverride;
  /** Optional case-notes context. Caller resolves access rules before
   *  passing them in - the drafting service trusts whatever it receives. */
  notes?: NoteContextItem[];
  /** Invoked once when the provider returns token usage. */
  onUsage?: (usage: LlmUsage) => void;
}

/** Resolve which provider to actually call for this request. An explicit
 *  override beats the env default; if the override picks a provider whose
 *  key is missing, we fall back to env.llmProvider rather than crashing. */
function resolveProvider(override: ProviderOverride): 'xai' | 'anthropic' | 'none' {
  if (override === 'xai' && env.XAI_API_KEY) return 'xai';
  if (override === 'anthropic' && env.ANTHROPIC_API_KEY) return 'anthropic';
  return env.llmProvider;
}

export const draftingService = {
  async generate(req: DraftRequest, opts: GenerateOpts = {}): Promise<DraftResponse> {
    let text: string;
    const provider = resolveProvider(opts.provider);
    const notes = opts.notes ?? [];
    if (provider === 'xai') {
      try {
        const r = await callGrok(req, notes);
        text = r.text;
        opts.onUsage?.({ provider: 'xai', model: env.XAI_MODEL, ...r.usage });
      } catch (err) {
        logger.warn({ err }, 'Grok call failed, falling back to template');
        text = SAMPLE_TEMPLATE(req);
      }
    } else if (provider === 'anthropic') {
      try {
        const r = await callClaude(req, notes);
        text = r.text;
        opts.onUsage?.({ provider: 'anthropic', model: env.ANTHROPIC_MODEL, ...r.usage });
      } catch (err) {
        logger.warn({ err }, 'Claude call failed, falling back to template');
        text = SAMPLE_TEMPLATE(req);
      }
    } else {
      text = SAMPLE_TEMPLATE(req);
    }
    return { docType: req.docType, text, generatedAt: new Date().toISOString() };
  },

  /**
   * Streams text chunks for the brief. The caller receives each delta as it
   * arrives from the provider. If no key is set, the deterministic template
   * is yielded as a single chunk so the UI behaves the same in dev.
   */
  async *generateStream(
    req: DraftRequest,
    opts: GenerateOpts = {},
  ): AsyncGenerator<string, void, void> {
    const provider = resolveProvider(opts.provider);
    const notes = opts.notes ?? [];
    if (provider === 'none') {
      yield SAMPLE_TEMPLATE(req);
      return;
    }
    try {
      if (provider === 'xai') {
        yield* streamGrok(req, notes, opts.onUsage);
      } else {
        yield* streamClaude(req, notes, opts.onUsage);
      }
    } catch (err) {
      logger.warn({ err, provider }, 'LLM stream failed, falling back to template');
      yield SAMPLE_TEMPLATE(req);
    }
  },
};

interface ProviderResult {
  text: string;
  usage: NormalizedUsage;
}

async function callClaude(req: DraftRequest, notes: NoteContextItem[]): Promise<ProviderResult> {
  const { system, user } = buildPrompt(req, notes);
  return withRetry(
    async () => {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        // Prompt caching: the system block is identical across requests,
        // so marking it cache_control='ephemeral' lets Anthropic reuse
        // the encoded prefix across calls. The savings are token-count
        // dependent (≥1024 input tokens for Sonnet to actually cache)
        // and harmless when the prompt is small - request shape is correct
        // for when we grow the system instructions or fold in firm-grounded
        // few-shot examples.
        body: JSON.stringify({
          model: env.ANTHROPIC_MODEL,
          max_tokens: 2048,
          system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: user }],
        }),
      });
      if (!response.ok) {
        const body = await response.text();
        throw new HttpRetryError(response.status, `Claude API ${response.status}: ${body}`);
      }
      const data = (await response.json()) as {
        content: Array<{ type: string; text: string }>;
        usage?: Parameters<typeof anthropicUsage>[0];
      };
      const text = data.content
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('');
      return { text, usage: anthropicUsage(data.usage) };
    },
    {
      onRetry: (err, attempt, waitMs) =>
        logger.warn({ err, attempt, waitMs }, 'Claude call retry'),
    },
  );
}

async function callGrok(req: DraftRequest, notes: NoteContextItem[]): Promise<ProviderResult> {
  const { system, user } = buildPrompt(req, notes);
  return withRetry(
    async () => {
      const response = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${env.XAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: env.XAI_MODEL,
          max_tokens: 2048,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      });
      if (!response.ok) {
        const body = await response.text();
        throw new HttpRetryError(response.status, `xAI API ${response.status}: ${body}`);
      }
      const data = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
        usage?: Parameters<typeof xaiUsage>[0];
      };
      return {
        text: data.choices[0]?.message?.content ?? '',
        usage: xaiUsage(data.usage),
      };
    },
    {
      onRetry: (err, attempt, waitMs) =>
        logger.warn({ err, attempt, waitMs }, 'Grok call retry'),
    },
  );
}

async function* streamGrok(
  req: DraftRequest,
  notes: NoteContextItem[],
  onUsage?: (usage: LlmUsage) => void,
): AsyncGenerator<string, void, void> {
  const { system, user } = buildPrompt(req, notes);
  const response = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.XAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: env.XAI_MODEL,
      max_tokens: 2048,
      stream: true,
      // Ask xAI to emit a terminal usage chunk so we can record token spend.
      stream_options: { include_usage: true },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!response.ok || !response.body) {
    const body = response.body ? await response.text() : '';
    throw new Error(`xAI API ${response.status}: ${body}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let usage: NormalizedUsage = {};

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
          const evt = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
            usage?: Parameters<typeof xaiUsage>[0];
          };
          const text = evt.choices?.[0]?.delta?.content;
          if (text) yield text;
          if (evt.usage) usage = xaiUsage(evt.usage);
        } catch {
          // ignore malformed frames - keepalive comments etc.
        }
      }
    }
  }
  onUsage?.({ provider: 'xai', model: env.XAI_MODEL, ...usage });
}

async function* streamClaude(
  req: DraftRequest,
  notes: NoteContextItem[],
  onUsage?: (usage: LlmUsage) => void,
): AsyncGenerator<string, void, void> {
  const { system, user } = buildPrompt(req, notes);
  // Streaming responses can't be transparently retried mid-stream (we'd
  // emit duplicate deltas), so the connection itself isn't wrapped in
  // withRetry. The non-streaming generate() path remains the resilient
  // fallback when the stream call fails outright.
  const response = await fetch('https://api.anthropic.com/v1/messages', {
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
  if (!response.ok || !response.body) {
    const body = response.body ? await response.text() : '';
    throw new Error(`Claude API ${response.status}: ${body}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  // Anthropic reports input + cache tokens on `message_start` and the running
  // output token total on `message_delta` (the last one wins).
  let usage: NormalizedUsage = {};

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by blank lines. Each frame contains one or more
    // `event:` / `data:` lines. We only care about content_block_delta payloads.
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
          const evt = JSON.parse(payload) as {
            type?: string;
            delta?: { type?: string; text?: string };
            message?: { usage?: Parameters<typeof anthropicUsage>[0] };
            usage?: { output_tokens?: number };
          };
          if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta' && evt.delta.text) {
            yield evt.delta.text;
          } else if (evt.type === 'message_start' && evt.message?.usage) {
            usage = anthropicUsage(evt.message.usage);
          } else if (evt.type === 'message_delta' && evt.usage?.output_tokens != null) {
            usage = { ...usage, tokensOut: evt.usage.output_tokens };
          }
        } catch {
          // ignore malformed frames - keepalive comments etc.
        }
      }
    }
  }
  onUsage?.({ provider: 'anthropic', model: env.ANTHROPIC_MODEL, ...usage });
}
