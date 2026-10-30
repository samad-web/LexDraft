// =============================================================================
// intake-compose — the ONE place the engine-routed intake path lets the model
// draft prose, and only under a strict contract (see intake-no-draft.test.ts):
//
//   compose(...) runs ONLY AFTER the engine has returned outcome:'generated' —
//   every fact already extracted, validated, and hard-stop-checked by the
//   engine. Its INPUT is the engine's own rendered blocks + the validated fact
//   map — NEVER the raw advocate transcript or attachment text. Its job is to
//   turn the engine's bare deterministic skeleton into a fuller, better-argued
//   document (the way a real advocate writes one — a proper narrative of facts,
//   numbered grounds, the "[to be drafted]" sections actually drafted) while being
//   CONSTITUTIONALLY FORBIDDEN from stating anything not traceable to a supplied fact.
//
//   Only the numbered BODY is composed. The engine's head (title, banners, cause
//   title) and tail (place, signature, verification) stay byte-identical, and the
//   PRAYER paragraphs are kept verbatim (only renumbered) — the relief and the
//   formal blocks are legal structure, not prose to improve. segmentBlocks() finds
//   that body; the caller splices the composed paragraphs into the engine .docx
//   over exactly that line range, so the filing copy matches the preview.
//
//   Checks before the advocate sees anything (draft-guards):
//     LOST        a section, amount, date, day-period, citation or [marker] in the
//                 skeleton body that the composed body dropped  -> reject.
//     INTRODUCED  such a particular found in neither the skeleton nor the facts
//                 -> strip just those sentences (then re-check LOST).
//     VERIFY      a model fact-check; flagged claims are stripped the same way, and
//                 a claim that can't be located rejects the composition.
//   Any rejection falls back to the engine's plain draft — never a document that
//   failed a check.
//
// This module must NEVER import the general drafting orchestrator/agent/auto/
// chat pipeline — that pipeline extracts its OWN facts from raw prose with no
// engine hard-stops, which is exactly the fabrication risk this session spent
// its effort eliminating. compose only ever ARGUES facts the engine already
// verified; it never discovers new ones.
// =============================================================================

import { env } from '../env';
import { logger } from '../logger';
import { withRetry } from '../lib/retry';
import { type NormalizedUsage } from '../lib/llm-usage';
import { claudeComplete } from '../lib/anthropic-client';
import { grokComplete } from '../lib/grok-client';
import { introducedParticulars, lostParticulars, stripSentences } from '../lib/draft-guards';
import { COMPOSE_FAMILY, type ComposeFamily } from '../lib/compose-families';
import type { IntakeDraft } from '@lexdraft/types';

type Provider = 'xai' | 'anthropic' | 'none';

interface LlmResult extends NormalizedUsage {
  text: string;
}

export interface ComposeResult {
  /** The composed blocks, ready to show the advocate — either the model's
   *  enriched prose (if it passed every check) or the engine's own plain draft
   *  (if composition failed or didn't pass). */
  blocks: Array<{ key: string; text: string }>;
  /** True when the model's composed prose was used; false = fell back to the
   *  engine's plain deterministic draft (composition unavailable or rejected). */
  composed: boolean;
  /** Present only when composed=false because a check rejected the draft. */
  rejectedReason?: string;
  /** When composed: the engine block range [start, end] (inclusive) the composed
   *  paragraphs replace — the caller writes the same splice into the .docx. */
  splice?: { start: number; end: number; paragraphs: string[] };
  /** Sentences removed by the checks (shown to nobody; logged for tuning). */
  removedSentences?: string[];
  modelUsed: string;
}

function resolveProvider(override?: 'xai' | 'anthropic'): Provider {
  if (override === 'xai' && env.XAI_API_KEY) return 'xai';
  if (override === 'anthropic' && env.ANTHROPIC_API_KEY) return 'anthropic';
  if (env.intakeProvider === 'xai' && env.XAI_API_KEY) return 'xai';
  if (env.intakeProvider === 'anthropic' && env.ANTHROPIC_API_KEY) return 'anthropic';
  return env.llmProvider;
}

// Compose WRITES the pleading, so it always uses the heavy drafting model.
// INTAKE_MODEL is the fast extractor/classifier model; compose once borrowed it,
// which silently drafted every pleading on the small model.
function modelFor(provider: Provider): string {
  return provider === 'anthropic' ? env.ANTHROPIC_MODEL : env.XAI_MODEL;
}

function providerTag(provider: Provider): string {
  if (provider === 'anthropic' || provider === 'xai') return `${provider}:${modelFor(provider)}`;
  return 'fallback:none';
}

async function complete(provider: Provider, system: string, user: string, maxTokens: number): Promise<LlmResult> {
  if (provider === 'anthropic') return callClaude(system, user, maxTokens, modelFor('anthropic'));
  if (provider === 'xai') return callGrok(system, user, maxTokens, modelFor('xai'));
  throw new Error('no LLM provider configured');
}

async function callClaude(system: string, user: string, maxTokens: number, model: string): Promise<LlmResult> {
  // claudeComplete throws HttpRetryError on API errors (incl. 429/5xx), so
  // withRetry backs off and retries exactly as the old inline fetch did.
  return withRetry(
    () => claudeComplete({ system, user, maxTokens, model }),
    { onRetry: (err, attempt, waitMs) => logger.warn({ err, attempt, waitMs }, 'intake-compose Claude retry') },
  );
}

async function callGrok(system: string, user: string, maxTokens: number, model: string): Promise<LlmResult> {
  return withRetry(
    () => grokComplete({ system, user, maxTokens, model }),
    { onRetry: (err, attempt, waitMs) => logger.warn({ err, attempt, waitMs }, 'intake-compose Grok retry') },
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

// ---- SEGMENT ----------------------------------------------------------------

const NUMBERED = /^\s*(\d+)([A-Z]?)\s*[.)]\s/;
const SUB_ITEM = /^\s+\S|^\s*(?:\([0-9a-z]{1,4}\)|[A-Z][.)]|[a-z][.)]|[ivx]+[.)])\s/;
const PRAYER = /\bPRAYER\b|\bit is (?:therefore )?(?:most )?(?:humbly |respectfully )?prayed\b/i;
/** An un-numbered all-capitals line: a section heading ("LIST OF DOCUMENTS"). */
const SECTION_HEADING = (t: string): boolean => {
  const letters = t.replace(/[^A-Za-z]/g, '');
  return letters.length >= 4 && t.trim().length <= 90
    && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.85;
};

export interface Segments {
  /** First line of the numbered run (the composed body starts here). */
  start: number;
  /** Last line of the composed body (inclusive). */
  bodyEnd: number;
  /** Last line of the numbered run, incl. the prayer (inclusive) — the splice end. */
  end: number;
  /** The number the body opens with ("1" usually). */
  startNumber: number;
}

/**
 * Find the engine draft's numbered body. Engine renders are: banners/title/cause
 * title (unnumbered) -> a run of numbered paragraphs with indented sub-items ->
 * place/date/signature (unnumbered). Within the run, the first numbered paragraph
 * that is a prayer starts the kept-verbatim prayer. null = no usable body.
 */
export function segmentBlocks(blocks: Array<{ text: string }>): Segments | null {
  const start = blocks.findIndex((b) => NUMBERED.test(b.text));
  if (start === -1) return null;
  // The run may hold un-numbered lines between numbered ones (the s.138
  // complaint's "1. Description of the Complainant" / address line / "humbly
  // submits as follows:"): they belong to the body, else the composed body would
  // replace only the first line and the skeleton body would print after it. The
  // run ends at the last numbered line before a section heading (PRAYER, LIST OF
  // DOCUMENTS …), an un-numbered prayer, or the Place / Date line.
  let end = start;
  for (let i = start + 1; i < blocks.length; i += 1) {
    const t = blocks[i]!.text;
    if (NUMBERED.test(t) || SUB_ITEM.test(t)) {
      end = i;
      continue;
    }
    if (SECTION_HEADING(t) || PRAYER.test(t) || /^\s*(?:Place|Date)\s*:/i.test(t)) break;
  }
  let bodyEnd = end;
  for (let i = start; i <= end; i += 1) {
    if (NUMBERED.test(blocks[i]!.text) && PRAYER.test(blocks[i]!.text)) {
      bodyEnd = i - 1;
      break;
    }
  }
  if (bodyEnd < start) return null;
  return { start, bodyEnd, end, startNumber: Number(NUMBERED.exec(blocks[start]!.text)![1]) };
}

/**
 * Number every body paragraph in sequence. A paragraph whose opening sentence the
 * checks stripped loses its typed "6." with it; a pleading never has an
 * un-numbered body paragraph. Sub-items "(a)", lead-ins ending in ":" and section
 * headings stay as they are.
 */
export function numberBody(paragraphs: string[], first: number): string[] {
  let n = first;
  return paragraphs.map((p) => {
    // (a numbered paragraph that introduces a list also ends in ":" — it is numbered)
    if (SUB_ITEM.test(p) || (!NUMBERED.test(p) && /:\s*$/.test(p)) || SECTION_HEADING(p)) return p;
    return `${n++}. ${p.replace(NUMBERED, '')}`;
  });
}

/** Renumber the numbered prayer lines to continue after the composed body. */
function renumberFrom(lines: string[], next: number): string[] {
  let n = next;
  return lines.map((l) => (NUMBERED.test(l) ? l.replace(NUMBERED, (_m, _d, _s) => `${n++}. `) : l));
}

function lastNumber(paragraphs: string[], fallback: number): number {
  for (let i = paragraphs.length - 1; i >= 0; i -= 1) {
    const m = NUMBERED.exec(paragraphs[i]!);
    if (m) return Number(m[1]);
  }
  return fallback;
}

// ---- DRAFTING GUIDES ----------------------------------------------------------

/** How a practising advocate structures the BODY of each document family. Each item
 *  is included only when its underlying fact exists — never padded. */
const GUIDES: Record<ComposeFamily, string> = {
  s138_notice: `1. Opening: instructed by and on behalf of the client, issuing this notice.
2. The business/commercial relationship between the parties, if a fact describes one.
3. The underlying transaction — each dated item (invoice, delivery, loan) as its own sub-paragraph (a), (b)… with its amount.
4. The cheque(s) issued in discharge of that liability — one sub-paragraph per cheque (number, date, amount, bank and branch).
5. If a SEPARATE agreement about the cheques exists (deferment/settlement), a paragraph arguing it is a clear and continuing acknowledgment of the debt, quoting its admission figure if given.
6. Presentation for encashment (date, bank). 7. Dishonour — memo date and reason, quoting a verbatim reason exactly. 8. Receipt of the memo by the client.
9. Legal characterisation: an offence under Section 138 of the Negotiable Instruments Act, 1881; Section 141 ONLY if the drawer is a company/firm.
10. The demand within the statutory period (state the arithmetic if several cheques). 11. Consequence of non-payment. Close with: "This notice is issued without prejudice to any other civil or criminal remedies available to my client in law."`,
  bail: `1. The petitioner's particulars (age, occupation, residence) and roots in the community.
2. The prosecution case in brief — a neutral narrative of the FIR allegations as given; no argument here.
3. Arrest, remand and custody period; the stage of investigation (charge sheet filed or not).
4. GROUNDS, numbered, each ONE self-standing proposition opening "That…", strongest and most objective first. Each ground answers a specific objection (gravity, flight risk, tampering, antecedents, stage of investigation, parity, period in custody, health/family) using a FACT given — never a bare character assurance.
5. The undertaking to abide by conditions and cooperate.`,
  complaint: `1. The complainant's description and capacity (proprietor / authorised representative).
2. The accused — and, where an accused is a company/firm, the persons in charge of and responsible for its business (Section 141), only if such facts are given.
3. The transaction and the legally enforceable debt. 4. The cheque(s). 5. Presentation and dishonour (memo, reason).
6. The statutory notice, its dispatch and service; failure to pay within 15 days. 7. The cause of action and when it arose.
8. Territorial jurisdiction under Section 142(2)(a): the court where the branch of the bank in which the PAYEE (complainant) maintains the account — the collecting branch — is situated; never the drawee (accused's) bank branch, and name the collecting branch only as the skeleton or facts give it. 9. Limitation — filed within one month of the cause of action.
10. The documents relied on and that the complainant will lead evidence.`,
  suit: `1. The parties' descriptions. 2. The facts in chronological order, each event in its own paragraph with dates and amounts.
3. Any demand, notice and reply. 4. The cause of action and when and where it arose.
5. Jurisdiction (territorial and pecuniary) and valuation/court fee — only as stated in the skeleton.
6. Limitation, as stated in the skeleton. 7. That no other suit on the same cause of action is pending, if the skeleton says so.`,
  writ: `1. The petitioner's description and locus standi. 2. The respondents and why each is "State" or a public authority.
3. The facts in chronological order: the representations made (with dates) and the action or inaction complained of.
4. GROUNDS, lettered A, B, C…, each a distinct legal proposition (arbitrariness under Article 14, failure to exercise jurisdiction, violation of the stated rule) — only provisions already in the skeleton.
5. The legal right and corresponding duty. 6. Alternative remedy / why it is not efficacious. 7. That no other petition is pending on the same cause.`,
  family: `1. The parties' particulars. 2. Marriage — date, place, rites, registration; children with ages.
3. The facts in chronological order, each incident in its own paragraph with its date.
4. The statutory ground relied on and how the facts establish it.
5. The statutory declarations the skeleton contains (no collusion, no condonation, jurisdiction, no other proceedings).`,
  notice: `1. Opening: instructed by and on behalf of the client. 2. The relationship/agreement between the parties with dates.
3. The facts giving rise to the claim, chronologically. 4. The client's legal position (no new citations).
5. The specific demand and the period to comply. 6. The consequence of non-compliance; reservation of rights.`,
  consumer: `1. The complainant as a "consumer". 2. Each opposite party and its role (manufacturer / dealer / service provider).
3. The purchase or service — date, invoice, price. 4. The defect or deficiency and each complaint/service visit, dated.
5. The refusal to remedy. 6. Deficiency in service / unfair trade practice. 7. Pecuniary and territorial jurisdiction and limitation, as in the skeleton.`,
  mact: `1. The accident — date, time, place, vehicles (registration numbers) and how it occurred (rash and negligent driving).
2. The deceased/injured — age, occupation, income. 3. The claimants and their relationship and dependency.
4. The FIR and the owner and insurer of the offending vehicle, with policy number. 5. The heads of compensation claimed, as given.`,
  generic: `Write the body as a practising advocate would: the parties, the facts in chronological order (one event per paragraph), then the legal grounds as numbered self-standing propositions, then any statutory declarations the skeleton contains.`,
};

// ---- COMPOSE ----------------------------------------------------------------

function factLinesOf(facts: Record<string, string>): string {
  return Object.entries(facts)
    .filter(([, v]) => v && String(v).trim())
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');
}

function buildComposePrompt(args: {
  docLabel: string;
  docType: string;
  head: string;
  body: string;
  prayer: string;
  startNumber: number;
  facts: Record<string, string>;
}): { system: string; user: string } {
  const guide = GUIDES[COMPOSE_FAMILY[args.docType] ?? 'generic'];
  const system = `You are a senior Indian advocate's drafting associate. You redraft the BODY of "${args.docLabel}" from a deterministic engine's skeleton, which is already legally validated: every citation, statutory averment, computation and legal conclusion in it is correct and MUST survive into your draft. Your output must read like a document actually filed by a practising advocate: thorough, well-organised and precisely argued, not a terse fill-in-the-blank form.

STRUCTURE of the body (include each item ONLY if its underlying fact exists; skip it rather than pad it):
${guide}

HARD RULES — you argue given facts, you never discover new ones:
- State ONLY facts in the "Facts" list or the skeleton. If a fact is not there, do not mention, imply or elaborate it, and drop the paragraph that would need it.
- NEVER invent a date, amount, name, number, section, Act, case citation or event. Do not compute new dates.
- Every section/Act citation, amount, date, day-period and computation in the skeleton body must appear in your body (you may restate, reorder and argue them).
- "[to be drafted]" in the skeleton means: draft that part from the facts. If the facts can't support it, leave "[to be drafted]" in place. Keep every OTHER [bracketed marker] exactly as written.
- Do NOT write the title, cause title, prayer, verification, place/date or signature — they are assembled separately. Your grounds must support the prayer given for context.
- Formal Indian legal English, respectful to the court ("It is respectfully submitted that…", "My client states that…" for notices). Connected, flowing prose within each paragraph; never paste a raw fact value mid-sentence — reword it; never join two facts with a semicolon or "namely X; Y".
- Plain text only: no Markdown, no bold, no tables. Number paragraphs "${args.startNumber}.", "${args.startNumber + 1}." … consecutively; sub-items as (a), (b) or A., B. on their own lines. Separate paragraphs with a blank line. Output ONLY the body, no preamble or commentary.`;

  const user =
    `# Facts (the ONLY facts you may state)\n${factLinesOf(args.facts) || '(none beyond what is in the skeleton)'}\n\n` +
    `# Document head (context only — do not repeat)\n${args.head || '(none)'}\n\n` +
    `# Skeleton body (redraft this)\n${args.body}\n\n` +
    `# Prayer (context only — do not repeat)\n${args.prayer || '(none)'}\n\n` +
    `# Task\nRedraft the skeleton body into the full structure above, following the hard rules exactly.`;
  return { system, user };
}

// ---- VERIFY -------------------------------------------------------------

interface VerifyRaw {
  pass: boolean;
  unsupported_claims: string[];
}

function buildVerifyPrompt(args: { composedText: string; skeleton: string; facts: Record<string, string> }): { system: string; user: string } {
  const system = `You fact-check a drafted legal document against KNOWN FACTS and the engine skeleton it was drafted from. Output ONLY JSON: { "pass": boolean, "unsupported_claims": ["<the shortest exact phrase from the draft that states the unsupported fact>"] }. A claim is UNSUPPORTED if it states a specific date, amount, name, number, place or event present in neither the known facts nor the skeleton.

NOT unsupported: legal boilerplate and advocacy ("constrained to prosecute", "the petitioner is not a flight risk as he is a permanent resident" when residence is a known fact); a legal argument connecting known facts; a restatement, reordering or renumbering of a known fact; a value written in words; a total that is the correct arithmetic sum of known amounts (check it); any citation or section that is in the skeleton.

Quote each unsupported claim EXACTLY as it appears in the draft so it can be located. pass=false if unsupported_claims is non-empty.`;
  const user = `# Known facts\n${factLinesOf(args.facts)}\n\n# Engine skeleton\n${args.skeleton}\n\n# Drafted body to check\n${args.composedText}`;
  return { system, user };
}

async function verify(args: {
  composedText: string;
  skeleton: string;
  facts: Record<string, string>;
  provider?: 'xai' | 'anthropic';
}): Promise<{ ok: boolean; unsupportedClaims: string[] }> {
  const provider = resolveProvider(args.provider);
  if (provider === 'none') return { ok: false, unsupportedClaims: ['verify unavailable (no LLM provider)'] };
  const { system, user } = buildVerifyPrompt(args);
  try {
    const result = await complete(provider, system, user, 1500);
    const raw = parseJsonLoose<VerifyRaw>(result.text);
    if (!raw) return { ok: false, unsupportedClaims: ['verify response unparseable'] };
    // ok = the check ran; claims (possibly empty) are what it flagged.
    return { ok: true, unsupportedClaims: (raw.unsupported_claims ?? []).filter((c) => typeof c === 'string' && c.trim()) };
  } catch (err) {
    logger.warn({ err }, 'intake-compose: verify call failed');
    return { ok: false, unsupportedClaims: ['verify call failed'] };
  }
}

function toParagraphs(text: string): string[] {
  // A numbered paragraph or "(a)" sub-item on the very next line is its own
  // paragraph too — else "(a) Cheque …\n4. The said cheque …" stays one
  // paragraph that numberBody can't see into.
  return normaliseComposedMarkdown(text)
    .split(/\n{2,}|\n(?=\s*(?:\d{1,3}[A-Z]?\s*[.)]|\([0-9a-z]{1,4}\))\s)/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * The full COMPOSE -> CHECK -> VERIFY pipeline. ONLY call this after the engine has
 * returned outcome:'generated'. Falls back to the engine's own plain draft
 * (composed:false) on ANY failure — a missing LLM key, a network error, a lost
 * particular, or a verify claim that can't be located — so the advocate ALWAYS gets
 * a document, and it is NEVER one that failed a check.
 */
export async function composeAndVerify(args: {
  docLabel: string;
  /** Engine doc type (e.g. "regular_bail") — picks the drafting guide. */
  docType?: string;
  engineBlocks: Array<{ key: string; text: string }>;
  facts: Record<string, string>;
  provider?: 'xai' | 'anthropic';
  onUsage?: (u: NormalizedUsage & { provider: Provider; model: string }) => void;
}): Promise<ComposeResult> {
  const plain = { blocks: args.engineBlocks, composed: false as const, modelUsed: 'engine:template' };
  const reject = (reason: string): ComposeResult => {
    logger.warn({ docType: args.docType, reason }, 'intake-compose: rejected, falling back to engine skeleton');
    return { ...plain, rejectedReason: reason };
  };

  const seg = segmentBlocks(args.engineBlocks);
  if (!seg) return plain;
  const lines = args.engineBlocks.map((b) => b.text);
  const head = lines.slice(0, seg.start).join('\n');
  const body = lines.slice(seg.start, seg.bodyEnd + 1).join('\n');
  const prayerLines = lines.slice(seg.bodyEnd + 1, seg.end + 1);
  const tail = lines.slice(seg.end + 1);
  const skeleton = lines.join('\n');

  const provider = resolveProvider(args.provider);
  if (provider === 'none') return plain;
  const { system, user } = buildComposePrompt({
    docLabel: args.docLabel,
    docType: args.docType ?? 's138_notice',
    head, body, prayer: prayerLines.join('\n'), startNumber: seg.startNumber, facts: args.facts,
  });
  let composedText: string;
  try {
    const result = await complete(provider, system, user, 8000);
    args.onUsage?.({ ...result, provider, model: modelFor(provider) });
    composedText = result.text.trim();
  } catch (err) {
    logger.warn({ err }, 'intake-compose: compose call failed, falling back to engine draft');
    return plain;
  }
  if (!composedText) return plain;

  let paragraphs = toParagraphs(composedText);
  const removed: string[] = [];
  const factText = Object.values(args.facts).join('\n');

  // INTRODUCED: particulars from nowhere -> strip those sentences.
  const introduced = introducedParticulars(paragraphs.join('\n'), [skeleton, factText]);
  if (introduced.length) {
    const s = stripSentences(paragraphs, introduced.map((p) => p.raw));
    paragraphs = s.paragraphs;
    removed.push(...s.removed);
  }

  // VERIFY: a model fact-check of what's left; flagged claims stripped the same way.
  const verdict = await verify({ composedText: paragraphs.join('\n\n'), skeleton, facts: args.facts, provider: args.provider });
  if (!verdict.ok) return reject(verdict.unsupportedClaims.join('; '));
  if (verdict.unsupportedClaims.length) {
    const s = stripSentences(paragraphs, verdict.unsupportedClaims);
    if (s.unresolved.length) return reject(`unlocated claims: ${verdict.unsupportedClaims.join('; ')}`);
    paragraphs = s.paragraphs;
    removed.push(...s.removed);
  }

  // LOST: anything load-bearing from the skeleton body that didn't survive.
  const lost = lostParticulars(body, paragraphs.join('\n'));
  if (lost.length) return reject(`dropped from the skeleton: ${lost.map((p) => p.raw).join(', ')}`);
  if (!paragraphs.length) return reject('nothing left after checks');
  paragraphs = numberBody(paragraphs, seg.startNumber);

  const prayer = renumberFrom(prayerLines, lastNumber(paragraphs, seg.startNumber - 1) + 1);
  const spliced = [...paragraphs, ...prayer];
  const blocks = [...lines.slice(0, seg.start), ...spliced, ...tail].map((text, i) => ({ key: `composed_${i}`, text }));
  if (removed.length) logger.info({ docType: args.docType, removed }, 'intake-compose: sentences removed by checks');
  return {
    blocks,
    composed: true,
    splice: { start: seg.start, end: seg.end, paragraphs: spliced },
    ...(removed.length ? { removedSentences: removed } : {}),
    modelUsed: providerTag(provider),
  };
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
