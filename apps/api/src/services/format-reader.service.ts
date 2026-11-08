// =============================================================================
// format-reader.service — read an advocate's uploaded drafting FORMAT into an
// engine template spec, for review before it is saved (firm-formats.service).
//
//   1. GET the engine's format-spec contract (prompt + JSON schema + vocabulary),
//      so the engine — not this file — owns what a valid spec is;
//   2. send the file to Claude (PDF / scan / photo natively; Word / text as text)
//      with structured output against that schema;
//   3. POST the result to the engine's check endpoint, which validates it and
//      renders a preview with sample data.
// Nothing is stored here; the advocate reviews the preview and then saves.
// =============================================================================

import { createHash } from 'node:crypto';
import mammoth from 'mammoth';
import type Anthropic from '@anthropic-ai/sdk';
import type OpenAI from 'openai';
import { env } from '../env';
import { logger } from '../logger';
import { anthropic, usageFrom } from '../lib/anthropic-client';
import { claudeCodeComplete, devViaClaudeCode } from '../lib/claude-code-dev';
import { grok, outputLimit } from '../lib/grok-client';
import { xaiUsage, type NormalizedUsage } from '../lib/llm-usage';
import { LABEL_TO_ENGINE_DOC } from '../lib/engine-field-map';
import { engineClient, type EngineFormatContract } from './engine-client.service';
import type { FirmFormatReviewNotes, FirmFormatSpec } from './firm-formats.service';

/** Placeholder doc type for checking a spec that has no saved id yet. */
export const PREVIEW_DOC_TYPE = 'firm_format_preview';

const MEDIA_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

export class FormatReadError extends Error {
  constructor(message: string, public status = 422) {
    super(message);
    this.name = 'FormatReadError';
  }
}

export interface FormatReadResult {
  /** false when the file is not a legal drafting format at all. */
  isLegalFormat: boolean;
  title: string;
  spec: FirmFormatSpec;
  reviewNotes: FirmFormatReviewNotes;
  /** Engine verdict: may this spec be saved? */
  ok: boolean;
  problems: string[];
  /** The format rendered with sample values, one line per paragraph. */
  preview: string[];
  /** A built-in format that already drafts the same document, if the reader found one. */
  equivalent: { docType: string; label: string | null } | null;
  sourceName: string;
  sourceSha256: string;
  usage: NormalizedUsage & { model: string };
}

let contractCache: { at: number; value: EngineFormatContract } | null = null;
const CONTRACT_TTL_MS = 10 * 60_000;

async function contract(): Promise<EngineFormatContract> {
  if (contractCache && Date.now() - contractCache.at < CONTRACT_TTL_MS) return contractCache.value;
  const value = await engineClient.formatContract();
  contractCache = { at: Date.now(), value };
  return value;
}

function extOf(fileName: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(fileName);
  return m ? m[1]!.toLowerCase() : '';
}

/** The content blocks that carry the source format to the model. */
async function sourceBlocks(
  fileName: string,
  mime: string,
  data: Buffer,
): Promise<Anthropic.Beta.Messages.BetaContentBlockParam[]> {
  const ext = extOf(fileName);
  const media = MEDIA_TYPES[ext] ?? (Object.values(MEDIA_TYPES).includes(mime) ? mime : '');
  const b64 = data.toString('base64');
  if (media === 'application/pdf') {
    return [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }];
  }
  if (media.startsWith('image/')) {
    return [{
      type: 'image',
      source: { type: 'base64', media_type: media as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif', data: b64 },
    }];
  }
  let text: string;
  if (ext === 'docx' || mime.includes('wordprocessingml')) {
    text = (await mammoth.extractRawText({ buffer: data })).value;
  } else if (ext === 'txt' || ext === 'md' || mime.startsWith('text/')) {
    text = data.toString('utf8');
  } else {
    throw new FormatReadError('Upload the format as a PDF, a photo/scan (PNG, JPG, WEBP), a Word .docx, or a text file.');
  }
  if (!text.trim()) throw new FormatReadError('That file has no readable text.');
  return [{ type: 'text', text: `SOURCE FORMAT (text of the document):\n\n${text}` }];
}

function instructions(c: EngineFormatContract, titleHint: string): string {
  const listing = [...c.existing]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([slug, title]) => `- ${slug}: ${title}`)
    .join('\n');
  const hint = titleHint ? `\nThe source is titled: ${titleHint}\n` : '';
  return `${hint}\nExisting doc types (slug: title):\n${listing}\n\n`
    + `Common field keys to reuse: ${c.common_keys.join(', ')}\n\n`
    + 'Transcribe the source format above into the spec.';
}

const READ_FAILED = 'This PDF or photo could not be read just now. Please try again shortly, or attach the format as a Word or text file.';

function openAiPart(b: Anthropic.Beta.Messages.BetaContentBlockParam, fileName: string): OpenAI.Chat.ChatCompletionContentPart {
  if (b.type === 'image' && b.source.type === 'base64') {
    return { type: 'image_url', image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } };
  }
  if (b.type === 'document' && b.source.type === 'base64') {
    return { type: 'file', file: { filename: fileName, file_data: `data:application/pdf;base64,${b.source.data}` } };
  }
  return { type: 'text', text: (b as { text: string }).text };
}

/** The same read on OpenAI, for when the Anthropic read failed (no credit, outage). */
async function readViaOpenAI(
  system: string,
  blocks: Anthropic.Beta.Messages.BetaContentBlockParam[],
  fileName: string,
  ask: string,
): Promise<{ text: string; usage: NormalizedUsage }> {
  // xAI takes no PDFs, so only the OpenAI vendor of this slot can stand in.
  if (env.openaiCompat.vendor !== 'openai' || !env.XAI_API_KEY) throw new FormatReadError(READ_FAILED, 503);
  const res = await grok().chat.completions.create({
    model: env.XAI_MODEL,
    ...outputLimit(64_000),
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: [...blocks.map((b) => openAiPart(b, fileName)), { type: 'text', text: ask }] },
    ],
  }).catch((err: unknown) => {
    logger.error({ err }, 'format-reader: OpenAI read failed');
    throw new FormatReadError(READ_FAILED, 503);
  });
  const choice = res.choices[0];
  if (choice?.finish_reason === 'length') throw new FormatReadError('The format is too long to read in one go.');
  return { text: choice?.message.content ?? '', usage: xaiUsage(res.usage as Parameters<typeof xaiUsage>[0]) };
}

function labelForDocType(docType: string): string | null {
  const hit = Object.entries(LABEL_TO_ENGINE_DOC).find(([, d]) => d === docType);
  return hit ? hit[0] : null;
}

export const formatReader = {
  async read(input: { fileName: string; mime: string; data: Buffer; titleHint?: string }): Promise<FormatReadResult> {
    if (!env.ANTHROPIC_API_KEY) throw new FormatReadError('Format reading is not configured (no AI key).', 503);
    const c = await contract();
    const blocks = await sourceBlocks(input.fileName, input.mime, input.data);
    const model = env.FORMAT_READER_MODEL;
    const ask = instructions(c, input.titleHint ?? '');
    const jsonSystem = `${c.system_prompt}\n\nReply with ONLY one JSON object matching this JSON schema, no prose, no code fence:\n${JSON.stringify(c.schema)}`;
    let servedBy = model;

    let text: string;
    let usage: NormalizedUsage;
    // Dev: every format goes through the local Claude Code route (no API credit needed).
    if (devViaClaudeCode()) {
      const out = await claudeCodeComplete({
        model,
        system: jsonSystem,
        user: [...blocks.flatMap((b) => (b.type === 'text' ? [b.text] : [])), ask].join('\n\n'),
        attachments: blocks.filter((b) => b.type !== 'text'),
      });
      text = out.text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
      usage = out;
    } else {
      const stream = anthropic().beta.messages.stream({
        model,
        max_tokens: 64_000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: c.system_prompt,
        output_config: { effort: 'high', format: { type: 'json_schema', schema: c.schema } },
        messages: [{
          role: 'user',
          content: [...blocks, { type: 'text', text: ask }],
        }],
      });
      const message = await stream.finalMessage().catch((err: unknown) => {
        // The provider's own text (billing, keys) is never shown to the advocate.
        logger.error({ err }, 'format-reader: AI read failed');
        return null;
      });
      if (!message) {
        ({ text, usage } = await readViaOpenAI(jsonSystem, blocks, input.fileName, ask));
        servedBy = env.XAI_MODEL;
      } else {
        if (message.stop_reason === 'refusal') throw new FormatReadError('The reader declined this file.');
        if (message.stop_reason === 'max_tokens') throw new FormatReadError('The format is too long to read in one go.');
        text = message.content
          .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('');
        usage = usageFrom(message.usage as unknown as Anthropic.Usage);
      }
    }
    let raw: Record<string, any>;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new FormatReadError('The format could not be read — try a clearer scan.');
    }

    const title = String(raw.title ?? '').trim() || input.titleHint?.trim() || 'Untitled format';
    const draftSpec = {
      title,
      court_issued: Boolean(raw.court_issued),
      fields: Array.isArray(raw.fields) ? raw.fields : [],
      blocks: Array.isArray(raw.blocks) ? raw.blocks : [],
    };
    const check = await engineClient.checkSpec(PREVIEW_DOC_TYPE, draftSpec);
    const checked = (check.spec ?? draftSpec) as FirmFormatSpec;
    const spec: FirmFormatSpec = {
      title,
      court_issued: Boolean(checked.court_issued),
      fields: checked.fields,
      blocks: checked.blocks,
    };
    const equivalentType = String(raw.equivalent_existing_doc_type ?? '').trim();
    return {
      isLegalFormat: raw.is_legal_format !== false,
      title,
      spec,
      reviewNotes: {
        summary: String(raw.summary ?? ''),
        corrections: Array.isArray(raw.corrections) ? raw.corrections : [],
        law_updates: Array.isArray(raw.law_updates) ? raw.law_updates : [],
        uncertain: Array.isArray(raw.uncertain) ? raw.uncertain : [],
      },
      ok: check.ok,
      problems: check.problems,
      preview: check.preview,
      equivalent: equivalentType && c.existing.some(([slug]) => slug === equivalentType)
        ? { docType: equivalentType, label: labelForDocType(equivalentType) }
        : null,
      sourceName: input.fileName,
      sourceSha256: createHash('sha256').update(input.data).digest('hex'),
      usage: { ...usage, model: servedBy },
    };
  },
};
