// =============================================================================
// draft-chat.service — the CONVERSATIONAL brain in front of the drafting engine.
//
// The old chat wired the UI straight to /drafting/auto, so every message — even
// "hi" — was forced through "which document is this?". That is a drafting form
// wearing a chat costume, not a chatbot.
//
// This service adds a real conversational layer. For each advocate message (with
// the running conversation) it does ONE cheap LLM call that decides intent and
// writes a natural reply:
//
//   greeting / smalltalk   -> reply warmly, invite the matter. No drafting.
//   question               -> answer briefly about drafting / their matters /
//                             the process. No free-form legal opinion.
//   off_topic              -> politely decline; steer back to legal drafting.
//   ready_to_draft         -> the message describes a real matter -> the ROUTE
//                             then hands the assembled brief to draftAutoService
//                             (the grounded engine), which is where any legal
//                             content and citations actually come from.
//
// Scope (user choice): converse naturally, but only about drafting/legal work.
// The conversational layer NEVER states law or cites a section itself — that is
// the grounded engine's job. This keeps the chat friendly at the front and safe
// at the core.
//
// Provider-aware (Anthropic / xAI / none) with a deterministic fallback, mirroring
// diary-assistant.service so behaviour, retries and prompt-caching stay consistent.
// =============================================================================

import { env } from '../env';
import { logger } from '../logger';
import { withRetry, HttpRetryError } from '../lib/retry';
import { anthropicUsage, xaiUsage, type NormalizedUsage } from '../lib/llm-usage';

export type ChatIntent = 'greeting' | 'question' | 'off_topic' | 'ready_to_draft';

export interface DraftChatMessage {
  role: 'advocate' | 'assistant';
  text: string;
}

export interface DraftChatRequest {
  /** Prior turns for context (most recent last). Capped by the route. */
  history: DraftChatMessage[];
  /** The new advocate message. */
  message: string;
  provider?: 'xai' | 'anthropic';
}

export interface DraftChatResult {
  intent: ChatIntent;
  /** The assistant's natural-language reply to show in the thread. */
  reply: string;
  /** When intent === 'ready_to_draft', the matter text to hand to the grounded
   *  drafting engine (usually the running conversation distilled to a brief). */
  draftBrief?: string;
  modelUsed: string;
}

// ---- LLM plumbing (mirrors diary-assistant.service) ------------------------

interface LlmResult extends NormalizedUsage { text: string }

function modelTag(): string {
  if (env.llmProvider === 'anthropic') return `anthropic:${env.ANTHROPIC_MODEL}`;
  if (env.llmProvider === 'xai') return `xai:${env.XAI_MODEL}`;
  return 'none';
}

async function complete(system: string, user: string, maxTokens: number): Promise<LlmResult> {
  if (env.llmProvider === 'anthropic') return callClaude(system, user, maxTokens);
  if (env.llmProvider === 'xai') return callGrok(system, user, maxTokens);
  throw new Error('no-llm'); // caller falls back
}

async function callClaude(system: string, user: string, maxTokens: number): Promise<LlmResult> {
  return withRetry(async () => {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: env.ANTHROPIC_MODEL,
        max_tokens: maxTokens,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!response.ok) {
      throw new HttpRetryError(response.status, `anthropic ${response.status}`);
    }
    const data = (await response.json()) as {
      content?: Array<{ text?: string }>;
      usage?: Parameters<typeof anthropicUsage>[0];
    };
    const text = data.content?.map((c) => c.text ?? '').join('') ?? '';
    return { text, ...anthropicUsage(data.usage) };
  });
}

async function callGrok(system: string, user: string, maxTokens: number): Promise<LlmResult> {
  return withRetry(async () => {
    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.XAI_API_KEY}` },
      body: JSON.stringify({
        model: env.XAI_MODEL,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!response.ok) {
      throw new HttpRetryError(response.status, `xai ${response.status}`);
    }
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: Parameters<typeof xaiUsage>[0];
    };
    const text = data.choices?.[0]?.message?.content ?? '';
    return { text, ...xaiUsage(data.usage) };
  });
}

// ---- Prompt ----------------------------------------------------------------

const SYSTEM = `You are the drafting assistant inside LexDraft, used by Indian advocates. You talk like a helpful junior in chambers: warm, brief, plain English. You help ONLY with legal drafting and the advocate's matters — not general chit-chat, not coding, not trivia.

Your job on each turn is to read the conversation and the new message, then reply naturally AND classify what the advocate needs.

Return ONLY a JSON object, no prose, no markdown fence:
{
  "intent": "greeting" | "question" | "off_topic" | "ready_to_draft",
  "reply": "<your natural reply to the advocate>",
  "draftBrief": "<ONLY when intent is ready_to_draft: the matter distilled into a clear brief for the drafting engine, weaving in every fact from the whole conversation>"
}

How to choose intent:
- "greeting": hello / hi / thanks / how are you. Reply warmly in one line and invite them to tell you the matter. Example reply: "Hello! Tell me what happened and I'll draft it — say the matter in your own words."
- "question": they ask about drafting, a document type, their case, or how to use the tool. Answer briefly and helpfully. Do NOT state black-letter law or cite any section number yourself — if they need the law, say you'll ground it when you draft.
- "off_topic": anything not about legal drafting or their matters (sports, coding, news, personal). Decline politely in one line and steer back: "I'm here for your drafting — tell me the matter and I'll help."
- "ready_to_draft": the message (with the conversation) describes a real matter to draft — an offence, a party, a document they want. Set draftBrief to the full matter. Your reply should be a short "on it" line; the draft itself comes from the engine, not you.

HARD RULES:
- Never state a legal proposition or cite a statute/section/case in "reply". That is the grounded engine's job. You converse; it drafts the law.
- Never invent facts about their matter. If unsure whether there's enough to draft, choose "question" and ask what you need.
- Keep "reply" to 1-3 short sentences. Plain English. No legalese, no software jargon.`;

function buildUser(req: DraftChatRequest): string {
  const convo = req.history
    .slice(-10)
    .map((m) => `${m.role === 'advocate' ? 'Advocate' : 'Assistant'}: ${m.text}`)
    .join('\n');
  return `# Conversation so far\n${convo || '(none)'}\n\n# New message from the advocate\n${req.message}`;
}

// ---- Deterministic fallback (no API key / quota spent) ----------------------
//
// Cheap heuristics so the chat still behaves sensibly with no LLM. It errs
// toward "ready_to_draft" only when the message clearly names a document/offence
// with some substance; otherwise it greets or asks.

const GREETING_RE = /^\s*(hi|hii+|hey|hello|namaste|good\s(morning|afternoon|evening)|thanks?|thank you|ok|okay)\b/i;
const DRAFT_HINT_RE = /\b(bail|anticipatory|notice|petition|complaint|application|affidavit|plaint|written statement|reply|quash|exemption|agreement|deed|138|arrested|cheating|fir|accused|client)\b/i;

function fallback(req: DraftChatRequest): DraftChatResult {
  const msg = req.message.trim();
  const words = msg.split(/\s+/).filter((w) => w.length > 2).length;

  if (GREETING_RE.test(msg) && words <= 3) {
    return {
      intent: 'greeting',
      reply: "Hello! Tell me what happened — say the matter in your own words and I'll work out the document and draft it.",
      modelUsed: 'fallback',
    };
  }
  if (DRAFT_HINT_RE.test(msg) && words >= 3) {
    // Enough substance to attempt a draft: hand the whole conversation as brief.
    const brief = [...req.history.filter((m) => m.role === 'advocate').map((m) => m.text), msg].join(' ');
    return {
      intent: 'ready_to_draft',
      reply: "On it — let me work out the document and what applies.",
      draftBrief: brief,
      modelUsed: 'fallback',
    };
  }
  if (DRAFT_HINT_RE.test(msg)) {
    return {
      intent: 'question',
      reply: "Tell me a bit more — who's involved and what happened — and I'll draft the right document.",
      modelUsed: 'fallback',
    };
  }
  return {
    intent: 'question',
    reply: "I'm here for your legal drafting. Describe the matter — what happened, who's involved — and I'll help.",
    modelUsed: 'fallback',
  };
}

// ---- Public API ------------------------------------------------------------

export const draftChatService = {
  async converse(req: DraftChatRequest): Promise<DraftChatResult> {
    if (env.llmProvider === 'none') {
      return fallback(req);
    }
    try {
      const { text } = await complete(SYSTEM, buildUser(req), 700);
      const parsed = parseReply(text);
      if (!parsed) return fallback(req);
      return { ...parsed, modelUsed: modelTag() };
    } catch (err) {
      logger.warn({ err }, 'draft-chat: LLM failed, using fallback');
      return fallback(req);
    }
  },
};

/** Parse the model's JSON reply defensively. Returns null on anything off so the
 *  caller can fall back rather than surface a broken turn. */
function parseReply(raw: string): Omit<DraftChatResult, 'modelUsed'> | null {
  const jsonStart = raw.indexOf('{');
  const jsonEnd = raw.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1) return null;
  try {
    const obj = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as {
      intent?: string; reply?: string; draftBrief?: string;
    };
    const intent = obj.intent as ChatIntent;
    const valid: ChatIntent[] = ['greeting', 'question', 'off_topic', 'ready_to_draft'];
    if (!valid.includes(intent) || typeof obj.reply !== 'string' || !obj.reply.trim()) return null;
    const out: Omit<DraftChatResult, 'modelUsed'> = { intent, reply: obj.reply.trim() };
    if (intent === 'ready_to_draft' && typeof obj.draftBrief === 'string' && obj.draftBrief.trim()) {
      out.draftBrief = obj.draftBrief.trim();
    }
    return out;
  } catch {
    return null;
  }
}
