import type { DraftRequest, DraftResponse } from '@lexdraft/types';
import { env } from '../env';
import { logger } from '../logger';
import { withRetry, HttpRetryError } from '../lib/retry';

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

/** Split into system + user so Anthropic's top-level `system` param and xAI's
 *  `{role:'system'}` message both carry the persona/style instructions, while
 *  the user message carries only the request-specific task and brief. Same
 *  split is applied to both providers - A/B remains apples-to-apples. */
function buildPrompt(req: DraftRequest): BuiltPrompt {
  const langName = req.language === 'EN' ? 'English' : req.language === 'HI' ? 'Hindi' : 'Tamil';
  const briefLines = Object.entries(req.fields)
    .filter(([, v]) => v && v.toString().trim())
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');
  const dated = req.draftDate ?? new Date().toISOString().slice(0, 10);

  const system = `You are an experienced Indian advocate. Draft court-ready documents in ${langName} following Indian legal conventions, statutes, and pleading style. Number paragraphs where appropriate. Include proper headings, parties block, prayer/conclusion, and verification/jurat where applicable. Be precise and concise - under 500 words. Output ONLY the document text - no commentary, no markdown.`;

  const user = `Draft a "${req.docType}" with tone: ${req.tone}. Date the document "${dated}".

# Brief
${briefLines}`;

  return { system, user };
}

type ProviderOverride = 'xai' | 'anthropic' | undefined;

/** Resolve which provider to actually call for this request. An explicit
 *  override beats the env default; if the override picks a provider whose
 *  key is missing, we fall back to env.llmProvider rather than crashing. */
function resolveProvider(override: ProviderOverride): 'xai' | 'anthropic' | 'none' {
  if (override === 'xai' && env.XAI_API_KEY) return 'xai';
  if (override === 'anthropic' && env.ANTHROPIC_API_KEY) return 'anthropic';
  return env.llmProvider;
}

export const draftingService = {
  async generate(req: DraftRequest, override?: ProviderOverride): Promise<DraftResponse> {
    let text: string;
    const provider = resolveProvider(override);
    if (provider === 'xai') {
      try {
        text = await callGrok(req);
      } catch (err) {
        logger.warn({ err }, 'Grok call failed, falling back to template');
        text = SAMPLE_TEMPLATE(req);
      }
    } else if (provider === 'anthropic') {
      try {
        text = await callClaude(req);
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
    override?: ProviderOverride,
  ): AsyncGenerator<string, void, void> {
    const provider = resolveProvider(override);
    if (provider === 'none') {
      yield SAMPLE_TEMPLATE(req);
      return;
    }
    try {
      if (provider === 'xai') {
        yield* streamGrok(req);
      } else {
        yield* streamClaude(req);
      }
    } catch (err) {
      logger.warn({ err, provider }, 'LLM stream failed, falling back to template');
      yield SAMPLE_TEMPLATE(req);
    }
  },
};

async function callClaude(req: DraftRequest): Promise<string> {
  const { system, user } = buildPrompt(req);
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
      const data = (await response.json()) as { content: Array<{ type: string; text: string }> };
      return data.content
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('');
    },
    {
      onRetry: (err, attempt, waitMs) =>
        logger.warn({ err, attempt, waitMs }, 'Claude call retry'),
    },
  );
}

async function callGrok(req: DraftRequest): Promise<string> {
  const { system, user } = buildPrompt(req);
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
      };
      return data.choices[0]?.message?.content ?? '';
    },
    {
      onRetry: (err, attempt, waitMs) =>
        logger.warn({ err, attempt, waitMs }, 'Grok call retry'),
    },
  );
}

async function* streamGrok(req: DraftRequest): AsyncGenerator<string, void, void> {
  const { system, user } = buildPrompt(req);
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
          };
          const text = evt.choices?.[0]?.delta?.content;
          if (text) yield text;
        } catch {
          // ignore malformed frames - keepalive comments etc.
        }
      }
    }
  }
}

async function* streamClaude(req: DraftRequest): AsyncGenerator<string, void, void> {
  const { system, user } = buildPrompt(req);
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
          };
          if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta' && evt.delta.text) {
            yield evt.delta.text;
          }
        } catch {
          // ignore malformed frames - keepalive comments etc.
        }
      }
    }
  }
}
