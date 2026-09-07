// =============================================================================
// intake-compose — the ONE place the engine-routed intake path lets the model
// draft prose, and only under a strict contract (see intake-no-draft.test.ts):
//
//   compose(...) runs ONLY AFTER the engine has returned outcome:'generated' —
//   every fact already extracted, validated, and hard-stop-checked by the
//   engine. Its INPUT is the engine's own rendered blocks + the validated fact
//   map — NEVER the raw advocate transcript or attachment text. Its job is to
//   turn the engine's bare deterministic skeleton into a fuller, better-argued
//   notice (the way a real advocate writes one — invoice tables, a deferment-
//   agreement argument, verbatim memo quotes — only when those facts are
//   actually present), while being CONSTITUTIONALLY FORBIDDEN from stating
//   anything not traceable to a supplied fact.
//
//   verify(...) then fact-checks the composed draft against the same fact map
//   and REJECTS (falls back to the engine's plain draft) if it finds a claim
//   that isn't backed by a fact — this is the safety net that makes "the model
//   drafts" survivable: it never gets the last word on what's true.
//
// This module must NEVER import the general drafting orchestrator/agent/auto/
// chat pipeline — that pipeline extracts its OWN facts from raw prose with no
// engine hard-stops, which is exactly the fabrication risk this session spent
// its effort eliminating. compose only ever ARGUES facts the engine already
// verified; it never discovers new ones.
// =============================================================================

import { env } from '../env';
import { logger } from '../logger';
import { withRetry, HttpRetryError } from '../lib/retry';
import { anthropicUsage, xaiUsage, type NormalizedUsage } from '../lib/llm-usage';
import type { IntakeDraft } from '@lexdraft/types';

type Provider = 'xai' | 'anthropic' | 'none';

interface LlmResult extends NormalizedUsage {
  text: string;
}

export interface ComposeResult {
  /** The composed blocks, ready to show the advocate — either the model's
   *  enriched prose (if it passed VERIFY) or the engine's own plain draft
   *  (if composition failed or didn't pass verification). */
  blocks: Array<{ key: string; text: string }>;
  /** True when the model's composed prose was used; false = fell back to the
   *  engine's plain deterministic draft (composition unavailable or rejected). */
  composed: boolean;
  /** Present only when composed=false because VERIFY rejected the draft. */
  rejectedReason?: string;
  modelUsed: string;
}

function resolveProvider(override?: 'xai' | 'anthropic'): Provider {
  if (override === 'xai' && env.XAI_API_KEY) return 'xai';
  if (override === 'anthropic' && env.ANTHROPIC_API_KEY) return 'anthropic';
  if (env.intakeProvider === 'xai' && env.XAI_API_KEY) return 'xai';
  if (env.intakeProvider === 'anthropic' && env.ANTHROPIC_API_KEY) return 'anthropic';
  return env.llmProvider;
}

function modelFor(provider: Provider): string {
  if (env.intakeModel && (env.intakeProvider === provider || env.intakeProvider === '')) {
    return env.intakeModel;
  }
  return provider === 'anthropic' ? env.ANTHROPIC_MODEL : env.XAI_MODEL;
}

function providerTag(provider: Provider): string {
  if (provider === 'anthropic' || provider === 'xai') return `${provider}:${modelFor(provider)}`;
  return 'fallback:none';
}

async function complete(provider: Provider, system: string, user: string, maxTokens: number): Promise<LlmResult> {
  if (provider === 'anthropic') return callClaude(system, user, maxTokens, modelFor('anthropic'));
  if (provider === 'xai') return callGrok(system, user, maxTokens, modelFor('xai'));
  throw new Error('LLM disabled');
}

async function callClaude(system: string, user: string, maxTokens: number, model: string): Promise<LlmResult> {
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
          model,
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
      const text = data.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
      return { text, ...anthropicUsage(data.usage) };
    },
    { onRetry: (err, attempt, waitMs) => logger.warn({ err, attempt, waitMs }, 'compose Claude retry') },
  );
}

async function callGrok(system: string, user: string, maxTokens: number, model: string): Promise<LlmResult> {
  return withRetry(
    async () => {
      const response = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${env.XAI_API_KEY}` },
        body: JSON.stringify({
          model,
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
      return { text: data.choices[0]?.message?.content ?? '', ...xaiUsage(data.usage) };
    },
    { onRetry: (err, attempt, waitMs) => logger.warn({ err, attempt, waitMs }, 'compose Grok retry') },
  );
}

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

/**
 * Turn the light Markdown the compose model emits (**bold**, | tables |) into CLEAN
 * plain text for the block data. Bold markers are removed (keeping the words); a
 * Markdown table becomes aligned rows with " | " separators and its "|---|" rule line
 * dropped. The result reads as a normal document paragraph/table in the preview, Copy,
 * Save and export — no raw asterisks or pipe-rules leak anywhere.
 */
export function normaliseComposedMarkdown(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  for (const line of lines) {
    // Drop a Markdown table separator rule ( |---|---| ).
    if (/^\s*\|?[\s:-]*\|[\s:|-]*$/.test(line) && line.includes('-')) continue;
    let l = line;
    // A table row: strip the outer pipes, keep cells separated by " | ".
    if (/^\s*\|.*\|\s*$/.test(l)) {
      l = l.replace(/^\s*\|/, '').replace(/\|\s*$/, '');
      l = l.split('|').map((c) => c.trim()).join('  |  ');
    }
    // Strip **bold** / __bold__ markers (keep the text); also stray single * emphasis.
    l = l.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1');
    out.push(l);
  }
  return out.join('\n');
}

// ---- COMPOSE ----------------------------------------------------------------

function buildComposePrompt(args: {
  docLabel: string;
  engineBlocks: Array<{ key: string; text: string }>;
  facts: Record<string, string>;
}): { system: string; user: string } {
  const system = `You are a senior Indian advocate's drafting associate, redrafting the FULL PROSE of "${args.docLabel}" from a deterministic engine's bare-bones skeleton (already legally validated — every citation, hard-stop, and legal conclusion in it is correct and MUST survive into your draft). Your output must read like a notice actually filed by a practising advocate: thorough, well-organised, and precisely argued — not a terse fill-in-the-blank form. Every fact you state must be traceable to the "Facts" list or the skeleton; you decide nothing about what is true or legally required, only how to ARGUE and PRESENT what is already given.

TARGET STRUCTURE for a cheque-dishonour (s.138) notice — include EACH paragraph below ONLY IF the underlying fact exists in your Facts/skeleton; skip a paragraph entirely (don't pad it with placeholders) when its fact is absent:
1. Opening: instructed by and on behalf of the client, issuing this notice.
2. The business/commercial relationship between the parties (if a nature-of-liability fact describes an ongoing relationship, not just a bare debt).
3. Itemised particulars of the underlying transaction — render as a TABLE if the facts list multiple dated items (invoices, deliveries, agreements) with amounts; a single line if there is only one.
4. The cheque(s) issued in discharge of that liability — a TABLE when there is more than one cheque (columns: S.No., Cheque No., Date, Amount, Bank & Branch), a single sentence for one cheque.
5. If the facts mention a SEPARATE agreement about the cheques themselves (e.g. a deferment/settlement/standstill agreement, its date, and any admission-of-liability figure within it) — a dedicated paragraph arguing that this agreement is a clear, unequivocal, and continuing acknowledgment of the debt, strengthening (never substituting for) the dishonour claim. Quote the agreement's admission figure if given.
6. Presentation of the cheque(s) for encashment (date, bank).
7. Dishonour — the return memo, its date, and its stated reason. If a VERBATIM reason/endorsement text is in the facts, quote it in quotation marks exactly as given.
8. Receipt of the dishonour memo by the client (the limitation anchor).
9. The legal characterisation: state plainly that the above facts constitute an offence punishable under Section 138 of the Negotiable Instruments Act, 1881, committed by the drawer — and, ONLY IF a fact indicates the drawer/client is a company/firm/entity (not a natural person), that the persons in charge of and responsible for its conduct of business are liable under Section 141, and note Section 142 governs the procedure/limitation for taking cognizance. Do NOT cite 141/142 for an individual drawer with no entity fact given.
10. The demand: pay the total sum (state the arithmetic clearly if it is a sum of several cheques) within the statutory period.
11. Consequence of non-payment: prosecution under Section 138 (and 141 if cited above), at the drawer's risk as to costs and consequences.
12. Signature block, then a closing line: "This notice is issued without prejudice to any other civil or criminal remedies available to my client in law."

HARD RULES — you are arguing given facts, not discovering new ones:
- You may ONLY state facts that appear in the "Facts" list below or the engine's own skeleton text. If a fact is not there, DO NOT mention it, DO NOT imply it, DO NOT invent a plausible-sounding elaboration, and DO NOT include the paragraph that would need it.
- NEVER invent a date, amount, name, section number, invoice number, agreement date, or any other specific data point not given to you.
- If a "[placeholder]" or "[DATE TO BE CONFIRMED]" marker appears in the engine's skeleton, KEEP that exact marker in your output, verbatim — do not fill it with a real value and do not delete it.
- Preserve every citation, statute reference, and legal conclusion from the engine's skeleton exactly — you may add supporting sentences and paragraphs, never remove or alter a legal conclusion the engine already reached.
- Render a table as a Markdown table (header row + |---| separator row + data rows) — the caller converts it to a real document table.
- BOLD (using **double asterisks**) every operative fact the first time it appears in the body: party names, cheque numbers, amounts, dates, the dishonour reason, and section numbers. Do not bold ordinary connective prose.

PROSE QUALITY — this is filing-ready legal drafting, not a fact dump:
- A FACT VALUE may be raw/unpunctuated prose lifted from the source document. NEVER paste such a value into your output verbatim mid-sentence — reword it into a grammatically complete, properly punctuated sentence of your own.
- NEVER join two different facts into one sentence with a semicolon, comma-splice, or "namely X; Y" construction.
- Write CONNECTED, flowing prose within each paragraph — not a string of short disconnected sentences. Use subordinate clauses and transitions ("in discharge of the said liability", "notwithstanding the said undertaking", "by reason of the foregoing") the way an advocate would, so a paragraph reads as one continuous argument, not a bullet list in sentence form.
- Match the register of a practising advocate's notice: formal, precise, unhurried. Prefer "My client states that..." / "It is submitted that..." / "You are hereby called upon to..." framing.
- Output ONLY the redrafted document body as plain paragraphs/tables (numbered where the source is numbered), no preamble, no markdown fences around the whole thing, no commentary.`;

  const factLines = Object.entries(args.facts)
    .filter(([, v]) => v && String(v).trim())
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');

  const skeleton = args.engineBlocks.map((b) => b.text).join('\n\n');

  const user = `# Facts (the ONLY facts you may state)\n${factLines || '(none beyond what is in the skeleton)'}\n\n# Engine's validated skeleton (the legal structure + citations you must preserve)\n${skeleton}\n\n# Task\nRewrite the skeleton above into the full target structure, including only the paragraphs whose underlying facts are actually present, following the hard rules exactly.`;
  return { system, user };
}

/**
 * Compose enriched prose from the engine's ALREADY-VALIDATED draft. Never
 * called with raw prose — only with `outcome.blocks` (already legally checked)
 * and the flat fact map the engine drafted from. Returns null on any failure
 * (no key, network error, empty response) so the caller falls back to the
 * engine's plain draft — composition is a pure enhancement, never a
 * requirement to produce SOME document.
 */
async function compose(args: {
  docLabel: string;
  engineBlocks: Array<{ key: string; text: string }>;
  facts: Record<string, string>;
  provider?: 'xai' | 'anthropic';
  onUsage?: (u: NormalizedUsage & { provider: Provider; model: string }) => void;
}): Promise<{ text: string; modelUsed: string } | null> {
  const provider = resolveProvider(args.provider);
  if (provider === 'none') return null;
  const { system, user } = buildComposePrompt(args);
  try {
    const result = await complete(provider, system, user, 3000);
    const modelUsed = providerTag(provider);
    args.onUsage?.({ ...result, provider, model: modelFor(provider) });
    const text = result.text.trim();
    return text ? { text, modelUsed } : null;
  } catch (err) {
    logger.warn({ err }, 'intake-compose: compose call failed, falling back to engine draft');
    return null;
  }
}

// ---- VERIFY -------------------------------------------------------------

interface VerifyRaw {
  pass: boolean;
  unsupported_claims: string[];
}

function buildVerifyPrompt(args: { composedText: string; facts: Record<string, string> }): { system: string; user: string } {
  const system = `You fact-check a drafted legal document against a list of KNOWN FACTS. Output ONLY JSON: { "pass": boolean, "unsupported_claims": ["<verbatim sentence or specific claim not backed by any known fact>"] }. A claim is UNSUPPORTED if it states a specific date, amount, name, number, or event not present in the known facts and not a standard legal-boilerplate phrase (boilerplate like "without prejudice to all rights" or "constrained to prosecute" is always fine — only flag INVENTED FACTS, not legal phrasing).

NOT UNSUPPORTED — do NOT flag these, they are legitimate: a TOTAL/SUM/AGGREGATE amount that is the arithmetic sum of two or more individual amounts that ARE in the known facts (e.g. if the facts list "Cheque amount: 399088" and "Cheque 2 — amount: 300000", a demand for "699088" is SUPPORTED — check the arithmetic yourself before flagging; if it sums correctly, it is not a fabrication). Also not unsupported: a plain restatement, reordering, or renumbering of a known fact; a value converted to words (e.g. "399088" written as "three lakh ninety-nine thousand eighty-eight"); standard section citations (138, 141, 142 of the NI Act) accompanying a cheque-dishonour notice — these are legal boilerplate for this document type, not invented facts; bold markup (**text**) or a markdown table — formatting is not a factual claim, evaluate only the words inside it; a legal ARGUMENT connecting two given facts (e.g. "the said agreement therefore constitutes a continuing acknowledgment of the debt" when both the agreement and the debt ARE known facts) is legitimate advocacy, not fabrication — only flag it if it asserts a NEW factual detail (a date, amount, or name) that isn't in the known facts.

pass=false if unsupported_claims is non-empty.`;
  const factLines = Object.entries(args.facts)
    .filter(([, v]) => v && String(v).trim())
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');
  const user = `# Known facts\n${factLines}\n\n# Drafted document to check\n${args.composedText}`;
  return { system, user };
}

/** Fact-check a composed draft. Returns {pass:true} if it cannot run the check
 *  (fail CLOSED on error would block every draft; instead we log and let the
 *  caller decide — intake-compose.compose's caller always treats a verify
 *  failure/timeout the same as an explicit fail, per composeAndVerify below). */
async function verify(args: {
  composedText: string;
  facts: Record<string, string>;
  provider?: 'xai' | 'anthropic';
}): Promise<{ pass: boolean; unsupportedClaims: string[] }> {
  const provider = resolveProvider(args.provider);
  if (provider === 'none') return { pass: false, unsupportedClaims: ['verify unavailable (no LLM provider)'] };
  const { system, user } = buildVerifyPrompt(args);
  try {
    const result = await complete(provider, system, user, 800);
    const raw = parseJsonLoose<VerifyRaw>(result.text);
    if (!raw) return { pass: false, unsupportedClaims: ['verify response unparseable'] };
    return { pass: Boolean(raw.pass) && (raw.unsupported_claims ?? []).length === 0, unsupportedClaims: raw.unsupported_claims ?? [] };
  } catch (err) {
    logger.warn({ err }, 'intake-compose: verify call failed');
    return { pass: false, unsupportedClaims: ['verify call failed'] };
  }
}

/**
 * The full COMPOSE -> VERIFY pipeline. ONLY call this after the engine has
 * returned outcome:'generated'. Falls back to the engine's own plain draft
 * (composed:false) on ANY failure — a missing LLM key, a network error, or a
 * VERIFY rejection — so the advocate ALWAYS gets a document, and it is NEVER
 * one that failed a fact-check.
 */
export async function composeAndVerify(args: {
  docLabel: string;
  engineBlocks: Array<{ key: string; text: string }>;
  facts: Record<string, string>;
  provider?: 'xai' | 'anthropic';
  onUsage?: (u: NormalizedUsage & { provider: Provider; model: string }) => void;
}): Promise<ComposeResult> {
  const plain = { blocks: args.engineBlocks, composed: false as const, modelUsed: 'engine:template' };
  const composed = await compose(args);
  if (!composed) return plain;

  const verdict = await verify({ composedText: composed.text, facts: args.facts, provider: args.provider });
  if (!verdict.pass) {
    logger.warn({ unsupportedClaims: verdict.unsupportedClaims }, 'intake-compose: VERIFY rejected composed draft, falling back to engine skeleton');
    return { ...plain, rejectedReason: verdict.unsupportedClaims.join('; ') };
  }

  // Normalise the light Markdown the compose prompt emits into CLEAN text before it
  // becomes block data. The blocks are plain-text and flow to the preview, Copy, Save
  // and export alike — so raw "**" / table pipes must not survive here (a rendered-only
  // fix leaves asterisks in the copied/saved document). Bold emphasis is a display
  // concern the filing .docx carries via its template; the block text stays clean prose.
  const clean = normaliseComposedMarkdown(composed.text);
  const paragraphs = clean.split(/\n{2,}/).map((t) => t.trim()).filter(Boolean);
  const blocks = paragraphs.map((text, i) => ({ key: `composed_${i}`, text }));
  return { blocks, composed: true, modelUsed: composed.modelUsed };
}

// Namespaced export (mirrors intakeLlm.extract/.phrase) so intake.service calls
// `intakeCompose.compose(...)` — the exact call the no-draft guard test checks
// for, textually, to confirm this module (not the general pipeline) is what's
// enriching the engine's already-validated draft.
export const intakeCompose = {
  compose: composeAndVerify,
};

// Re-export the shape used by callers that just want the type.
export type { IntakeDraft };
