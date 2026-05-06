import type { DraftRequest, DraftResponse } from '@lexdraft/types';
import { env } from '../env';
import { logger } from '../logger';

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

function buildPrompt(req: DraftRequest): string {
  const langName = req.language === 'EN' ? 'English' : req.language === 'HI' ? 'Hindi' : 'Tamil';
  const briefLines = Object.entries(req.fields)
    .filter(([, v]) => v && v.toString().trim())
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');
  const dated = req.draftDate ?? new Date().toISOString().slice(0, 10);

  return `You are an experienced Indian advocate drafting a "${req.docType}" in ${langName}. Tone: ${req.tone}.

Use the structured brief below to compose a complete, court-ready document following Indian legal conventions, statutes, and pleading style. Number paragraphs where appropriate. Include proper headings, parties block, prayer/conclusion, and verification/jurat where applicable. Date the document "${dated}". Be precise and concise — under 500 words. Output ONLY the document text — no commentary, no markdown.

# Brief
${briefLines}`;
}

export const draftingService = {
  async generate(req: DraftRequest): Promise<DraftResponse> {
    let text: string;
    if (env.ANTHROPIC_API_KEY) {
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
   * arrives from Claude. If no API key is set, the deterministic template
   * is yielded as a single chunk so the UI behaves the same in dev.
   */
  async *generateStream(req: DraftRequest): AsyncGenerator<string, void, void> {
    if (!env.ANTHROPIC_API_KEY) {
      yield SAMPLE_TEMPLATE(req);
      return;
    }
    try {
      yield* streamClaude(req);
    } catch (err) {
      logger.warn({ err }, 'Claude stream failed, falling back to template');
      yield SAMPLE_TEMPLATE(req);
    }
  },
};

async function callClaude(req: DraftRequest): Promise<string> {
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
      messages: [{ role: 'user', content: buildPrompt(req) }],
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Claude API ${response.status}: ${body}`);
  }
  const data = (await response.json()) as { content: Array<{ type: string; text: string }> };
  return data.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('');
}

async function* streamClaude(req: DraftRequest): AsyncGenerator<string, void, void> {
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
      messages: [{ role: 'user', content: buildPrompt(req) }],
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
          // ignore malformed frames — keepalive comments etc.
        }
      }
    }
  }
}
