// =============================================================================
// diary-assistant.service — turns the court Diary into an action-taking helper.
//
// Three capabilities, all provider-aware (Anthropic / xAI / none) and all with
// a deterministic fallback so the feature works in demo mode and degrades
// gracefully when AI is disabled or the monthly quota is spent:
//
//   parseCommand   natural language -> a *proposed* action (never writes; the
//                  route/UI confirm via the existing /diary + /hearings paths)
//   briefing       a today/week digest aggregated from hearings + diary +
//                  limitations, with an optional AI narrative
//   analyzeJudgment read a judgment PDF attached to a diary entry -> summary,
//                  holding and suggested follow-ups, cached per content hash
//
// The LLM client mirrors drafting.service.ts (native fetch, withRetry, prompt
// caching, system/user split) so behaviour and retries stay consistent.
// =============================================================================

import { createHash } from 'node:crypto';
import type {
  DiaryAssistantIntent,
  DiaryAssistantProposal,
  DiaryBriefing,
  DiaryBriefingItem,
  DiaryEntry,
  DiaryKind,
  JudgmentFollowUp,
  JudgmentInsight,
} from '@lexdraft/types';
import { env } from '../env';
import { logger } from '../logger';
import { withRetry, HttpRetryError } from '../lib/retry';
import { db } from '../db/client';
import { diaryService } from './diary.service';
import { hearingsService } from './hearings.service';
import { limitationsService } from './limitations.service';
import { aiQuotaService, AiQuotaExceededError } from './ai-quota.service';
import { aiUsageService } from './ai-usage.service';
import { anthropicUsage, xaiUsage, type NormalizedUsage } from '../lib/llm-usage';
import { extractText } from '../lib/text-extraction';

// ---- date helpers (UTC, to match the rest of the diary surface) ------------

function todayIso(): string {
  // Local calendar day — must agree with limitationsService.daysBetween (which
  // is local-midnight based) so the briefing window and a limitation's
  // daysRemaining line up even in the early-IST hours when UTC is still on the
  // previous day.
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

function weekdayName(iso: string): string {
  return WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()] ?? '';
}

function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  // Reject well-shaped but impossible dates (e.g. 2026-02-31) by round-tripping
  // through Date so a bad value never flows into a diary entry / hearing.
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m! - 1 && dt.getUTCDate() === d;
}

function isHhMm(v: unknown): v is string {
  return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

function providerTag(): string {
  if (env.llmProvider === 'anthropic') return `anthropic:${env.ANTHROPIC_MODEL}`;
  if (env.llmProvider === 'xai') return `xai:${env.XAI_MODEL}`;
  return 'fallback:none';
}

/** Fire-and-forget quota record that can never reject — a dropped insert is
 *  non-fatal (the user already has their result). Mirrors the catch used on
 *  drafting.routes' streaming record. */
function recordQuota(firmId: string | null, userId: string, docType: string): void {
  void aiQuotaService
    .record(firmId, userId, 'generate', { provider: env.llmProvider, docType })
    .catch((err) => logger.warn({ err, docType }, 'diary-assistant: ai-quota record failed'));
}

// ---- LLM client (mirrors drafting.service.ts) ------------------------------

/** Non-streaming completion against the resolved provider. Throws on failure
 *  (the caller catches and uses its deterministic fallback). Throws
 *  'LLM disabled' when no provider is configured so callers branch cleanly. */
interface LlmResult extends NormalizedUsage {
  text: string;
}

/** Token-usage sink so callers (which hold firmId/userId) can record spend. */
type UsageSink = (u: NormalizedUsage) => void;

async function complete(system: string, user: string, maxTokens: number, onUsage?: UsageSink): Promise<string> {
  let result: LlmResult;
  if (env.llmProvider === 'anthropic') result = await callClaude(system, user, maxTokens);
  else if (env.llmProvider === 'xai') result = await callGrok(system, user, maxTokens);
  else throw new Error('LLM disabled');
  onUsage?.({ tokensIn: result.tokensIn, tokensOut: result.tokensOut, cacheRead: result.cacheRead, cacheWrite: result.cacheWrite });
  return result.text;
}

async function callClaude(system: string, user: string, maxTokens: number): Promise<LlmResult> {
  return withRetry(
    async () => {
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
      return { text, ...anthropicUsage(data.usage) };
    },
    { onRetry: (err, attempt, waitMs) => logger.warn({ err, attempt, waitMs }, 'diary-assistant Claude retry') },
  );
}

async function callGrok(system: string, user: string, maxTokens: number): Promise<LlmResult> {
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
          max_tokens: maxTokens,
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
        ...xaiUsage(data.usage),
      };
    },
    { onRetry: (err, attempt, waitMs) => logger.warn({ err, attempt, waitMs }, 'diary-assistant Grok retry') },
  );
}

/** Build a usage sink that records this feature's token spend. */
function diaryUsageSink(firmId: string | null, userId: string): UsageSink {
  return (u) =>
    aiUsageService.recordAsync({
      firmId, userId, feature: 'diary_assistant',
      provider: env.llmProvider,
      model: env.llmProvider === 'anthropic' ? env.ANTHROPIC_MODEL : env.XAI_MODEL,
      tokensIn: u.tokensIn, tokensOut: u.tokensOut,
      cacheReadTokens: u.cacheRead, cacheWriteTokens: u.cacheWrite,
    });
}

/** Pull a JSON object out of an LLM reply that may be wrapped in prose or a
 *  ```json fence. Returns null when nothing parses. */
function parseJsonLoose<T>(raw: string): T | null {
  if (!raw) return null;
  const fenced = raw.replace(/```(?:json)?/gi, '');
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(fenced.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

// ---- command parsing -------------------------------------------------------

interface ParsedCommand {
  intent: DiaryAssistantIntent;
  date: string;
  time: string;
  kind: DiaryKind;
  matter: string;
  cnr: string;
  forum: string;
  detail: string;
  briefingRange?: 'today' | 'week';
  confirmation?: string;
}

const INTENTS: ReadonlyArray<DiaryAssistantIntent> = [
  'create_diary_entry',
  'create_hearing',
  'create_filing_reminder',
  'briefing_query',
  'unknown',
];

const KINDS: ReadonlyArray<DiaryKind> = ['hearing', 'judgment', 'filing'];

function buildParsePrompt(text: string, today: string): { system: string; user: string } {
  const system = `You are the scheduling assistant inside an Indian advocate's court diary. Convert ONE instruction into a single structured action.

Today is ${today} (${weekdayName(today)}). Resolve every relative date ("today", "tomorrow", "day after", "next Monday", "this Friday") to an absolute YYYY-MM-DD against today. Times are 24-hour HH:mm — convert "11am"->"11:00", "2.30pm"->"14:30"; use "" when no time is given.

Output ONLY a JSON object (no prose, no markdown fence) with exactly these keys:
{
  "intent": "create_diary_entry" | "create_hearing" | "create_filing_reminder" | "briefing_query" | "unknown",
  "date": "YYYY-MM-DD" | "",
  "time": "HH:mm" | "",
  "kind": "hearing" | "judgment" | "filing",
  "matter": "case / matter name, e.g. Mehta v. Skyline",
  "cnr": "the eCourts CNR if the user gave one, else \\"\\"",
  "forum": "court + hall, e.g. High Court of Karnataka",
  "detail": "purpose or short note, e.g. arguments / evidence / file appeal",
  "briefingRange": "today" | "week" | "",
  "confirmation": "one short line summarising the action for the user to confirm"
}

Rules:
- "remind me to file ...", filing deadlines, "limitation" -> intent create_filing_reminder, kind "filing".
- "log/add a hearing", "listed on", "appearance", "matter is up" -> create_hearing, kind "hearing".
- "judgment", "order pronounced", "verdict reserved" -> create_diary_entry, kind "judgment".
- "what's on", "my day", "this week", "schedule", "briefing", "agenda" with NO create verb -> briefing_query; set briefingRange ("week" if a week is implied, else "today").
- If the matter name is missing on a create intent, still return the action with "matter": "" and say so in confirmation.
- NEVER invent a CNR, court, or facts. Leave a field "" when the user did not supply it.`;
  const user = `Instruction: ${text}`;
  return { system, user };
}

/** Coerce a raw parsed object (LLM or heuristic) into a validated proposal. */
function buildProposal(p: ParsedCommand, today: string, modelUsed: string): DiaryAssistantProposal {
  const intent: DiaryAssistantIntent = INTENTS.includes(p.intent) ? p.intent : 'unknown';

  if (intent === 'briefing_query') {
    const range = p.briefingRange === 'week' ? 'week' : 'today';
    return {
      intent,
      briefingRange: range,
      confirmation: range === 'week' ? 'Showing this week.' : 'Showing your day.',
      message: p.confirmation ?? '',
      modelUsed,
    };
  }

  if (intent === 'unknown') {
    return {
      intent,
      confirmation: '',
      message:
        p.confirmation ||
        "I couldn't read that as a diary action. Try e.g. \"log Mehta v. Skyline hearing tomorrow 11am at HC Karnataka, arguments\".",
      modelUsed,
    };
  }

  // create_* intents.
  const date = isIsoDate(p.date) ? p.date : today;
  const time = isHhMm(p.time) ? p.time : '';
  const kind: DiaryKind = KINDS.includes(p.kind)
    ? p.kind
    : intent === 'create_filing_reminder'
      ? 'filing'
      : 'hearing';
  const matter = (p.matter || '').trim();

  const diaryEntry = {
    date,
    time,
    kind,
    caseLabel: matter,
    cnr: (p.cnr || '').trim(),
    detail: (p.detail || '').trim(),
    forum: (p.forum || '').trim(),
  };

  // The client rebuilds the optional calendar-hearing payload from the edited
  // diary draft on confirm, so we don't ship a separate (and immediately stale)
  // hearing object on the wire.
  const proposal: DiaryAssistantProposal = {
    intent,
    diaryEntry,
    confirmation: p.confirmation || defaultConfirmation(intent, kind, matter, date, time, diaryEntry.forum),
    modelUsed,
  };

  return proposal;
}

function defaultConfirmation(
  intent: DiaryAssistantIntent,
  kind: DiaryKind,
  matter: string,
  date: string,
  time: string,
  forum: string,
): string {
  const verb = intent === 'create_filing_reminder' ? 'Add filing reminder' : 'Log';
  const who = matter || '(unnamed matter)';
  const when = time ? `${date} at ${time}` : date;
  const where = forum ? ` — ${forum}` : '';
  return `${verb}: ${kind} for ${who} on ${when}${where}`;
}

// ---- deterministic fallback parser (demo mode / quota spent / LLM error) ----

function heuristicParse(text: string, today: string): ParsedCommand {
  const lower = text.toLowerCase();
  const base: ParsedCommand = {
    intent: 'unknown',
    date: '',
    time: '',
    kind: 'hearing',
    matter: '',
    cnr: '',
    forum: '',
    detail: '',
  };

  const hasCreateVerb = /\b(log|add|create|note|schedule a|put|remind|reminder|set)\b/.test(lower);
  // A concrete create signal (a thing to log) outranks query-ish phrasing, so
  // "schedule filing deadline ..." is a reminder, not a "show my schedule" query.
  const hasCreateSignal = /\b(file|filing|deadline|limitation|hearing|judg?ment|verdict|appeal|listed|appearance|mention)\b/.test(lower);
  const looksLikeQuery = /\b(what'?s on|whats on|my day|my week|this week|coming up|agenda|briefing|brief me)\b/.test(lower);

  if (!hasCreateVerb && !hasCreateSignal && looksLikeQuery) {
    base.intent = 'briefing_query';
    base.briefingRange = /\bweek\b/.test(lower) ? 'week' : 'today';
    return base;
  }

  // kind + intent. A filing reminder needs a real filing signal — NOT a bare
  // "remind", since "remind me about the Mehta hearing" is a hearing. ("remind
  // me to file ..." still matches via the `file` keyword.)
  if (/\b(file|filing|deadline|limitation)\b/.test(lower)) {
    base.intent = 'create_filing_reminder';
    base.kind = 'filing';
  } else if (/\b(judg?ment|verdict|order pronounced|reserved)\b/.test(lower)) {
    base.intent = 'create_diary_entry';
    base.kind = 'judgment';
  } else if (/\b(hearing|listed|appearance|up before|matter is up|mention)\b/.test(lower)) {
    base.intent = 'create_hearing';
    base.kind = 'hearing';
  } else if (hasCreateVerb) {
    base.intent = 'create_diary_entry';
    base.kind = 'hearing';
  } else {
    base.intent = 'unknown';
    return base;
  }

  base.date = heuristicDate(lower, today) || today;
  base.time = heuristicTime(lower);
  base.matter = heuristicMatter(text);
  base.forum = heuristicForum(text);
  return base;
}

function heuristicDate(lower: string, today: string): string {
  if (/\bday after tomorrow\b/.test(lower)) return addDaysIso(today, 2);
  if (/\btomorrow\b/.test(lower)) return addDaysIso(today, 1);
  if (/\btoday\b/.test(lower)) return today;

  // explicit YYYY-MM-DD
  const iso = lower.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso?.[1]) return iso[1];

  // DD/MM/YYYY or DD-MM-YYYY
  const dmy = lower.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/);
  if (dmy) {
    const dd = dmy[1]!.padStart(2, '0');
    const mm = dmy[2]!.padStart(2, '0');
    return `${dmy[3]}-${mm}-${dd}`;
  }

  // next <weekday> / <weekday>
  const wd = lower.match(/\b(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (wd?.[2]) {
    const target = WEEKDAYS.findIndex((w) => w.toLowerCase() === wd[2]);
    const todayDow = new Date(`${today}T00:00:00Z`).getUTCDay();
    let delta = (target - todayDow + 7) % 7;
    if (delta === 0) delta = 7; // a named weekday means the upcoming one
    if (wd[1]) delta += 7; // "next <weekday>" means the occurrence in the following week
    return addDaysIso(today, delta);
  }

  return '';
}

function heuristicTime(lower: string): string {
  // 11:30, 14:00
  const colon = lower.match(/\b([01]?\d|2[0-3]):([0-5]\d)\s*(am|pm)?\b/);
  if (colon) {
    let h = parseInt(colon[1]!, 10);
    const m = colon[2]!;
    const ap = colon[3];
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${m}`;
  }
  // 11am, 2.30pm
  const ampm = lower.match(/\b(\d{1,2})(?:[.](\d{2}))?\s*(am|pm)\b/);
  if (ampm) {
    let h = parseInt(ampm[1]!, 10);
    const m = ampm[2] ?? '00';
    const ap = ampm[3];
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${m}`;
  }
  return '';
}

const MATTER_STOPWORD = /^(today|tomorrow|next|on|at|by|am|pm|morning|afternoon|evening|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|arguments?|evidence|hearing|judg?ment|filing|file|appeal|reminder|mention)$/i;

function heuristicMatter(text: string): string {
  // "A v. B" / "A vs B"
  const vs = text.match(/([A-Z][\w.&'-]*(?:\s+[A-Z][\w.&'-]*){0,3})\s+v(?:s\.?|\.)?\s+([A-Z][\w.&'-]*(?:\s+[A-Z][\w.&'-]*){0,3})/);
  if (vs) return `${vs[1]!.trim()} v. ${vs[2]!.trim()}`;
  // "for <Name>" — but stop before any date/time/purpose word so we don't fold
  // "tomorrow", "11am" or "arguments" into the matter label. Prefer returning ''
  // over a confident-but-wrong name (the confirm card forces a matter anyway).
  const forM = text.match(/\bfor\s+([A-Za-z][\w.&'-]*(?:\s+[A-Za-z][\w.&'-]*){0,4})/);
  if (forM?.[1]) {
    const words: string[] = [];
    for (const w of forM[1].trim().split(/\s+/)) {
      if (MATTER_STOPWORD.test(w)) break;
      words.push(w);
    }
    return words.join(' ');
  }
  return '';
}

function heuristicForum(text: string): string {
  const at = text.match(/\bat\s+([^,.]+?)(?:[,.]|$)/i);
  if (at?.[1] && !/^\d/.test(at[1].trim())) return at[1].trim();
  return '';
}

// ---- briefing --------------------------------------------------------------

function hearingItemKey(date: string, time: string, title: string): string {
  return `${date}|${time}|${title.toLowerCase().trim()}`;
}

async function hearingsInRange(firmId: string | null, from: string, to: string) {
  if (!firmId) return [];
  const out: Array<{ date: string; time: string; case: string; court: string; purpose: string }> = [];
  for (let d = from; d <= to; d = addDaysIso(d, 1)) {
    const day = await hearingsService.listForDay(firmId, d);
    for (const h of day) {
      out.push({ date: h.date, time: h.time, case: h.case, court: h.court, purpose: h.purpose });
    }
  }
  return out;
}

function buildBriefingNarrativePrompt(range: 'today' | 'week', today: string, roster: string): { system: string; user: string } {
  const system = `You are an Indian advocate's chambers assistant. Given a roster of the advocate's ${range === 'week' ? 'week' : 'day'}, write a brief plain-English digest (2-4 sentences) of what they need to prepare for. Lead with the most time-critical items; call out any limitation deadlines that are overdue or due within a few days by name. Be concrete and concise. No markdown, no bullet lists, no preamble. Today is ${today}.`;
  const user = `Roster:\n${roster}`;
  return { system, user };
}

// ---- judgment analysis -----------------------------------------------------

function buildJudgmentPrompt(text: string): { system: string; user: string } {
  const system = `You are an Indian advocate's research assistant. Read the judgment / order text and return a STRICT JSON object — output ONLY the JSON, no markdown fence, no preamble:
{
  "summary": "a neutral 3-5 sentence summary of what the court decided and why",
  "holding": "the ratio decidendi / operative holding in 1-3 sentences",
  "followUps": [ { "title": "a concrete next action for the advocate", "rationale": "why, in one line" } ]
}
Give 2-4 follow-ups (e.g. draft grounds of appeal, note the limitation for an SLP/appeal, brief the client, comply with a direction). Never invent citations, party names, or facts that are not in the text. If the text is too garbled to read, say so in "summary" and return an empty followUps array.`;
  const user = `# Judgment text\n${text.slice(0, 48_000)}`;
  return { system, user };
}

function fallbackInsight(entryId: string, text: string): JudgmentInsight {
  const snippet = text.trim().slice(0, 800);
  return {
    entryId,
    summary: snippet
      ? `AI analysis is disabled, so here is the opening of the document:\n\n${snippet}${text.length > 800 ? '…' : ''}`
      : 'AI analysis is disabled and no readable text could be extracted from this PDF.',
    holding: '',
    followUps: [],
    modelUsed: 'fallback:none',
    cached: false,
  };
}

interface InsightRow {
  summary: string;
  holding: string;
  follow_ups: JudgmentFollowUp[] | string;
  model_used: string;
}

function normaliseFollowUps(raw: unknown): JudgmentFollowUp[] {
  const arr = typeof raw === 'string' ? safeParseArray(raw) : Array.isArray(raw) ? raw : [];
  return arr
    .map((f) => ({
      title: String((f as JudgmentFollowUp)?.title ?? '').trim(),
      rationale: String((f as JudgmentFollowUp)?.rationale ?? '').trim(),
    }))
    .filter((f) => f.title.length > 0)
    .slice(0, 6);
}

function safeParseArray(raw: string): unknown[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export const diaryAssistantService = {
  /**
   * Parse a natural-language command into a proposed action. Never writes.
   * Uses the LLM when available (and within quota); otherwise falls back to a
   * deterministic heuristic so the command bar always returns something the
   * user can edit and confirm.
   */
  async parseCommand(text: string, ctx: { firmId: string | null; userId: string }): Promise<DiaryAssistantProposal> {
    const today = todayIso();

    if (env.llmProvider !== 'none' && ctx.userId && ctx.firmId) {
      try {
        await aiQuotaService.assertCanGenerate(ctx.firmId, ctx.userId);
        const { system, user } = buildParsePrompt(text, today);
        const raw = await complete(system, user, 600, diaryUsageSink(ctx.firmId, ctx.userId));
        const obj = parseJsonLoose<ParsedCommand>(raw);
        if (obj) {
          recordQuota(ctx.firmId, ctx.userId, 'diary-parse');
          return buildProposal(obj, today, providerTag());
        }
        logger.warn({ raw: raw.slice(0, 200) }, 'diary-assistant parse: unparseable JSON, using heuristic');
      } catch (err) {
        // Quota or network failure — degrade to the heuristic, never hard-fail
        // the command bar.
        logger.warn({ err }, 'diary-assistant parse: LLM failed, using heuristic');
      }
    }

    const tag = env.llmProvider === 'none' ? 'fallback:none' : 'fallback:heuristic';
    return buildProposal(heuristicParse(text, today), today, tag);
  },

  /**
   * Aggregate a today/week briefing from calendar hearings + diary entries +
   * limitation deadlines, then (when AI is on and within quota) add a short
   * narrative. The structured counts/items always return so the card renders
   * even with AI off.
   */
  async briefing(firmId: string | null, range: 'today' | 'week', userId: string): Promise<DiaryBriefing> {
    const today = todayIso();
    const from = today;
    const to = range === 'week' ? addDaysIso(today, 6) : today;

    const allEntries = await diaryService.list(firmId);
    const inWindow = (e: DiaryEntry) => e.date >= from && e.date <= to;
    const entries = allEntries.filter(inWindow);

    const calHearings = await hearingsInRange(firmId, from, to);
    const seen = new Set<string>();
    const hearingItems: DiaryBriefingItem[] = [];
    for (const h of calHearings) {
      const key = hearingItemKey(h.date, h.time, h.case);
      if (seen.has(key)) continue;
      seen.add(key);
      hearingItems.push({ date: h.date, time: h.time, kind: 'hearing', title: h.case, detail: h.purpose, forum: h.court, daysRemaining: null });
    }
    for (const e of entries) {
      if (e.kind !== 'hearing') continue;
      const key = hearingItemKey(e.date, e.time, e.caseLabel);
      if (seen.has(key)) continue;
      seen.add(key);
      hearingItems.push({ date: e.date, time: e.time, kind: 'hearing', title: e.caseLabel, detail: e.detail, forum: e.forum, daysRemaining: null });
    }

    const judgmentItems: DiaryBriefingItem[] = entries
      .filter((e) => e.kind === 'judgment')
      .map((e) => ({ date: e.date, time: e.time, kind: 'judgment', title: e.caseLabel, detail: e.detail, forum: e.forum, daysRemaining: null }));

    const filingItems: DiaryBriefingItem[] = entries
      .filter((e) => e.kind === 'filing')
      .map((e) => ({ date: e.date, time: e.time, kind: 'filing', title: e.caseLabel, detail: e.detail, forum: e.forum, daysRemaining: null }));

    // Limitation deadlines: overdue or due within the window. A "today" brief
    // still surfaces a deadline a few days out — those are the ones an advocate
    // most wants warned about early.
    const windowDays = range === 'week' ? 7 : 3;
    // Surface deadlines due within the window AND recently-missed ones, but floor
    // the overdue side so a year-old un-cleared deadline can't flood the card and
    // out-rank what's actually due (limitation rows otherwise sort by their past date).
    const OVERDUE_GRACE_DAYS = 30;
    const limitItems: DiaryBriefingItem[] = (await limitationsService.list(firmId))
      .filter((l) => l.daysRemaining <= windowDays && l.daysRemaining >= -OVERDUE_GRACE_DAYS)
      .map((l) => ({ date: l.deadline, time: '', kind: 'limitation', title: l.caseLabel, detail: l.filingType, forum: l.forum, daysRemaining: l.daysRemaining }));

    const items = [...hearingItems, ...judgmentItems, ...filingItems, ...limitItems].sort((a, b) =>
      a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date),
    );

    const counts = {
      hearings: hearingItems.length,
      judgments: judgmentItems.length,
      filings: filingItems.length,
      limitations: limitItems.length,
    };

    let narrative = '';
    let modelUsed = 'fallback:none';
    if (items.length > 0 && env.llmProvider !== 'none' && userId && firmId) {
      try {
        await aiQuotaService.assertCanGenerate(firmId, userId);
        const roster = items
          .map((i) => {
            const days = i.daysRemaining === null ? '' : ` (${i.daysRemaining < 0 ? `${-i.daysRemaining}d overdue` : `${i.daysRemaining}d left`})`;
            return `- ${i.date}${i.time ? ` ${i.time}` : ''} [${i.kind}] ${i.title || '(unnamed)'}${i.detail ? ` — ${i.detail}` : ''}${i.forum ? ` @ ${i.forum}` : ''}${days}`;
          })
          .join('\n');
        const { system, user } = buildBriefingNarrativePrompt(range, today, roster);
        narrative = (await complete(system, user, 400, diaryUsageSink(firmId, userId))).trim();
        modelUsed = providerTag();
        recordQuota(firmId, userId, 'diary-briefing');
      } catch (err) {
        logger.warn({ err }, 'diary-assistant briefing narrative failed; returning counts only');
        narrative = '';
        modelUsed = err instanceof AiQuotaExceededError ? 'fallback:quota' : 'fallback:error';
      }
    }

    return { range, from, to, counts, items, narrative, modelUsed };
  },

  /**
   * Read the judgment PDF attached to a diary entry and distil it. Results are
   * cached per (entry, content-hash). Cache hits and demo-mode fallbacks do not
   * consume quota; a fresh LLM call asserts + records quota (the route turns a
   * quota error into 429).
   */
  async analyzeJudgment(
    entryId: string,
    ctx: { firmId: string | null; userId: string; force?: boolean },
  ): Promise<JudgmentInsight> {
    const { firmId, userId, force } = ctx;
    const entry = await diaryService.getWithAttachment(entryId, firmId);
    if (!entry) {
      throw Object.assign(new Error('Diary entry not found'), { status: 404 });
    }
    if (entry.kind !== 'judgment' || !entry.attachmentBase64) {
      throw Object.assign(new Error('This diary entry has no judgment PDF to analyse'), { status: 422 });
    }

    const extraction = await extractText({
      body: Buffer.from(entry.attachmentBase64, 'base64'),
      mime: entry.attachmentMime ?? 'application/pdf',
      fileName: entry.attachmentFileName ?? 'judgment.pdf',
    });
    if (!extraction.ok) {
      throw Object.assign(new Error(`Could not read the PDF: ${extraction.error}`), { status: 422 });
    }
    const text = extraction.text;
    const contentHash = createHash('sha256').update(text).digest('hex');

    // Cache hit (skipped on a forced re-analysis). Cache hits never touch quota.
    if (!force) {
      const cached = await readCachedInsight(entryId, contentHash, firmId);
      if (cached) {
        return { entryId, summary: cached.summary, holding: cached.holding, followUps: normaliseFollowUps(cached.follow_ups), modelUsed: cached.model_used, cached: true };
      }
    }

    if (env.llmProvider === 'none' || !userId || !firmId) {
      return fallbackInsight(entryId, text);
    }

    // Real analysis — guard quota (may throw -> route 429), then call.
    await aiQuotaService.assertCanGenerate(firmId, userId);

    let raw: string;
    try {
      const { system, user } = buildJudgmentPrompt(text);
      raw = await complete(system, user, 1200, diaryUsageSink(firmId, userId));
    } catch (err) {
      logger.warn({ err }, 'diary-assistant judgment LLM call failed; returning fallback');
      return fallbackInsight(entryId, text);
    }

    const obj = parseJsonLoose<{ summary?: string; holding?: string; followUps?: unknown }>(raw);
    if (!obj) {
      logger.warn({ raw: raw.slice(0, 200) }, 'diary-assistant judgment: unparseable JSON');
      return fallbackInsight(entryId, text);
    }

    const insight: JudgmentInsight = {
      entryId,
      summary: String(obj.summary ?? '').trim(),
      holding: String(obj.holding ?? '').trim(),
      followUps: normaliseFollowUps(obj.followUps),
      modelUsed: providerTag(),
      cached: false,
    };

    // Only cache a usable result — never persist a degenerate empty summary, so a
    // one-off thin response can't become a permanent cache hit. A forced re-run
    // upserts over any prior row (see writeCachedInsight).
    if (insight.summary) {
      await writeCachedInsight(firmId, entryId, contentHash, insight);
    }
    recordQuota(firmId, userId, 'judgment-insight');
    return insight;
  },
};

// ---- insight cache (DB) ----------------------------------------------------

async function readCachedInsight(entryId: string, contentHash: string, firmId: string | null): Promise<InsightRow | null> {
  if (!firmId) return null;
  const sql = db();
  if (!sql) return null;
  const rows = await sql<InsightRow[]>`
    select summary, holding, follow_ups, model_used
    from diary_entry_insights
    where diary_entry_id = ${entryId}::uuid
      and content_hash = ${contentHash}
      and firm_id = ${firmId}::uuid
    limit 1
  `;
  return rows[0] ?? null;
}

async function writeCachedInsight(firmId: string, entryId: string, contentHash: string, insight: JudgmentInsight): Promise<void> {
  const sql = db();
  if (!sql) return;
  try {
    await sql`
      insert into diary_entry_insights
        (firm_id, diary_entry_id, content_hash, summary, holding, follow_ups, model_used)
      values
        (${firmId}::uuid, ${entryId}::uuid, ${contentHash}, ${insight.summary}, ${insight.holding},
         ${JSON.stringify(insight.followUps)}::jsonb, ${insight.modelUsed})
      on conflict (diary_entry_id, content_hash) do update set
        summary = excluded.summary,
        holding = excluded.holding,
        follow_ups = excluded.follow_ups,
        model_used = excluded.model_used,
        created_at = now()
    `;
  } catch (err) {
    // A failed cache write is non-fatal — the user still gets their insight.
    logger.warn({ err }, 'diary-assistant: failed to cache judgment insight');
  }
}
