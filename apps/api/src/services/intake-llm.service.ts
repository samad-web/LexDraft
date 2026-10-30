// =============================================================================
// intake-llm.service — the ONLY model calls on the conversational-intake path.
//
// Two narrow jobs, both pure TRANSLATION (see docs/conversational-intake-plan.md):
//
//   extract(...)  prose  -> {field: value} patch, with per-field confidence and
//                 provenance. Closed vocabulary (the engine's field contract),
//                 grounding-required (no span -> no field), no legal reasoning.
//   phrase(...)   engine 422 issues -> one natural question PER issue. Wording
//                 only; the SET of questions is the engine's, never the model's.
//
// This module must NEVER import the drafting orchestrator / agent / auto path.
// The model may translate INTO and OUT OF the engine; it may never draft the
// document. A static test (intake-no-draft.test.ts) enforces that. The LLM
// plumbing (provider resolve, retry, usage) mirrors draft-extract.service.ts.
// =============================================================================

import { env } from '../env';
import { logger } from '../logger';
import { withRetry } from '../lib/retry';
import { xaiUsage, type NormalizedUsage } from '../lib/llm-usage';
import { anthropic, usageFrom, asRetryError } from '../lib/anthropic-client';
import { grok, outputLimit, asRetryError as asGrokRetryError } from '../lib/grok-client';

type Provider = 'xai' | 'anthropic' | 'none';

interface LlmResult extends NormalizedUsage {
  text: string;
  /** Provider's stop signal: Anthropic `stop_reason` / xAI `finish_reason`. A
   *  value of 'max_tokens' (Anthropic) / 'length' (xAI) means the output was
   *  CUT OFF at the token cap — even when the JSON happened to stay parseable. */
  stopReason?: string;
}

/** A field the extractor is allowed to fill — the engine's inbound contract. */
export interface IntakeFieldSpec {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'date' | 'number' | 'currency';
  options?: string[];
  required: boolean;
}

/** One extracted field: value + how sure + why. */
export interface ExtractedField {
  key: string;
  value: string;
  confidence: 'stated' | 'inferred';
  /** The supporting span from what the advocate said. */
  source: string;
  /** For `inferred`: how the value was derived. */
  derivation?: string;
}

export interface ExtractionPatch {
  fields: ExtractedField[];
  /** Salient facts with no matching field — parked, surfaced quietly. */
  unmappedNotes: string[];
  /** Values the model extracted but is unsure of — echo back to confirm. */
  lowConfidence: string[];
  /** One value that could fill 2+ fields — ask which, don't guess. */
  collisions: Array<{ value: string; candidates: string[] }>;
  modelUsed: string;
}

// ---- provider plumbing (mirrors draft-extract.service.ts) ------------------

function resolveProvider(override?: 'xai' | 'anthropic'): Provider {
  if (override === 'xai' && env.XAI_API_KEY) return 'xai';
  if (override === 'anthropic' && env.ANTHROPIC_API_KEY) return 'anthropic';
  // An explicit INTAKE_PROVIDER wins (the fast intake model), when its key is set.
  if (env.intakeProvider === 'xai' && env.XAI_API_KEY) return 'xai';
  if (env.intakeProvider === 'anthropic' && env.ANTHROPIC_API_KEY) return 'anthropic';
  return env.llmProvider;
}

/** The model intake uses for a provider: the fast INTAKE_MODEL when set (and it
 *  matches the resolved provider's vendor), else the drafting model. */
function intakeModelFor(provider: Provider): string {
  if (env.intakeModel && (env.intakeProvider === provider || env.intakeProvider === '')) {
    return env.intakeModel;
  }
  return provider === 'anthropic' ? env.ANTHROPIC_MODEL : env.XAI_MODEL;
}

function providerTag(provider: Provider): string {
  if (provider === 'anthropic' || provider === 'xai') return `${provider}:${intakeModelFor(provider)}`;
  return 'fallback:none';
}

async function complete(provider: Provider, system: string, user: string, maxTokens: number): Promise<LlmResult> {
  if (provider === 'anthropic') return callClaude(system, user, maxTokens, intakeModelFor('anthropic'));
  if (provider === 'xai') return callGrok(system, user, maxTokens, intakeModelFor('xai'));
  throw new Error('LLM disabled');
}

async function callClaude(system: string, user: string, maxTokens: number, model: string): Promise<LlmResult> {
  return withRetry(
    // Goes through the shared SDK client (auth, prompt-cache defaults, error
    // shaping) via anthropic() rather than claudeComplete(), because this site
    // also needs `stop_reason` for its truncation-escalation logic, which the
    // high-level claudeComplete() helper does not surface. Same request shape as
    // the former hand-rolled fetch: same model, max_tokens, ephemeral-cached
    // system block, and single user message.
    async () => {
      let msg;
      try {
        msg = await anthropic().messages.create({
          model,
          max_tokens: maxTokens,
          system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: user }],
        });
      } catch (err) {
        // Reshape SDK API errors into HttpRetryError so withRetry() still
        // triggers on 429/5xx exactly as the raw-fetch path did.
        throw asRetryError(err);
      }
      const text = msg.content
        .filter((c): c is Extract<typeof c, { type: 'text' }> => c.type === 'text')
        .map((c) => c.text)
        .join('');
      return { text, stopReason: msg.stop_reason ?? undefined, ...usageFrom(msg.usage) };
    },
    { onRetry: (err, attempt, waitMs) => logger.warn({ err, attempt, waitMs }, 'intake Claude retry') },
  );
}

async function callGrok(system: string, user: string, maxTokens: number, model: string): Promise<LlmResult> {
  return withRetry(
    // Goes through the shared official-SDK client (grok-client.ts) via the raw
    // grok() client rather than grokComplete(), because this site also needs the
    // `finish_reason` for its truncation-escalation logic, which the high-level
    // grokComplete() helper does not surface. Same request shape as the former
    // hand-rolled fetch: same model, max_tokens, and system+user messages; usage
    // still mapped through xaiUsage; SDK errors reshaped to HttpRetryError so
    // withRetry() triggers on 429/5xx exactly as the raw-fetch path did.
    async () => {
      let res;
      try {
        res = await grok().chat.completions.create({
          model,
          ...outputLimit(maxTokens),
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        });
      } catch (err) {
        throw asGrokRetryError(err);
      }
      return {
        text: res.choices[0]?.message?.content ?? '',
        stopReason: res.choices[0]?.finish_reason ?? undefined,
        ...xaiUsage(res.usage as Parameters<typeof xaiUsage>[0]),
      };
    },
    { onRetry: (err, attempt, waitMs) => logger.warn({ err, attempt, waitMs }, 'intake Grok retry') },
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
 * Salvage a TRUNCATED extraction. On a rich paste (e.g. an s.138 complaint with
 * 8 cheques) the model emits ~40 well-formed field objects but the JSON output
 * is cut off at the max_tokens cap mid-object — the top-level `JSON.parse` in
 * parseJsonLoose then throws and returns null, and extract() would treat that as
 * TOTAL failure, dropping every field the model DID emit fully. This walks the
 * `"fields"` array element-by-element with a brace/bracket-depth + in-string
 * tracker, JSON.parses each COMPLETE top-level element independently, keeps every
 * one that parses, and discards only the final partial element. It also
 * best-effort recovers unmapped_notes / low_confidence / collisions if they
 * appear BEFORE the truncation point (they usually don't for a truncated tail).
 * Returns null only when not even one complete field element can be recovered —
 * turning "lose all 60" into "keep the 55 complete ones".
 */
function salvageTruncatedExtraction(raw: string): RawExtraction | null {
  if (!raw) return null;
  const fenced = raw.replace(/```(?:json)?/gi, '');

  // Locate the `"fields"` array's opening bracket.
  const fieldsKey = fenced.search(/"fields"\s*:\s*\[/);
  if (fieldsKey === -1) return null;
  const arrOpen = fenced.indexOf('[', fieldsKey);
  if (arrOpen === -1) return null;

  // Walk the array collecting each top-level element substring that closes
  // cleanly (depth returns to the array level). A brace/bracket-depth counter
  // plus an in-string tracker (with backslash escaping) keeps us from splitting
  // on commas/brackets inside string values.
  const elements: string[] = [];
  let depth = 0; // nesting depth INSIDE the fields array (0 == between elements)
  let elStart = -1;
  let inStr = false;
  let esc = false;
  for (let i = arrOpen + 1; i < fenced.length; i++) {
    const ch = fenced[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{' || ch === '[') {
      if (depth === 0) elStart = i; // start of a new top-level element
      depth++;
    } else if (ch === '}' || ch === ']') {
      if (depth === 0) break; // the array's own closing ']' — end of complete data
      depth--;
      if (depth === 0 && elStart !== -1) {
        elements.push(fenced.slice(elStart, i + 1));
        elStart = -1;
      }
    }
  }

  // JSON.parse each complete element independently; keep every one that parses,
  // silently discarding the final partial (unclosed) element.
  const fields: RawExtraction['fields'] = [];
  for (const el of elements) {
    try {
      fields!.push(JSON.parse(el) as NonNullable<RawExtraction['fields']>[number]);
    } catch {
      // a malformed/partial element — skip it
    }
  }
  if (!fields!.length) return null; // nothing complete recovered

  const out: RawExtraction = { fields };

  // Best-effort recover the sibling arrays if they were emitted (and closed)
  // before the truncation point — parse just the bracketed span after each key.
  const recoverArray = (key: string): unknown[] | undefined => {
    const m = fenced.match(new RegExp(`"${key}"\\s*:\\s*\\[`));
    if (!m || m.index === undefined) return undefined;
    const open = fenced.indexOf('[', m.index);
    if (open === -1) return undefined;
    let d = 0, s = false, e = false;
    for (let i = open; i < fenced.length; i++) {
      const ch = fenced[i]!;
      if (s) {
        if (e) e = false;
        else if (ch === '\\') e = true;
        else if (ch === '"') s = false;
        continue;
      }
      if (ch === '"') { s = true; continue; }
      if (ch === '[') d++;
      else if (ch === ']') {
        d--;
        if (d === 0) {
          try { return JSON.parse(fenced.slice(open, i + 1)) as unknown[]; }
          catch { return undefined; }
        }
      }
    }
    return undefined; // array itself was truncated — leave undefined
  };
  const unmapped = recoverArray('unmapped_notes');
  if (unmapped) out.unmapped_notes = unmapped;
  const lowConf = recoverArray('low_confidence');
  if (lowConf) out.low_confidence = lowConf;
  const collisions = recoverArray('collisions');
  if (collisions) out.collisions = collisions as RawExtraction['collisions'];

  return out;
}

// ---- EXTRACTOR (§3) --------------------------------------------------------

const MAX_TRANSCRIPT_CHARS = 16_000;

function buildExtractPrompt(args: {
  docLabel: string;
  fields: IntakeFieldSpec[];
  transcript: string;
  latest: string;
  answering: string[]; // field keys the latest message is answering, if any
  today: string;
}): { system: string; user: string } {
  const system = `You extract structured fields for an Indian legal document ("${args.docLabel}") from what an advocate says, so a deterministic drafting engine can validate them. You do NOT draft anything and you do NOT decide what the law requires — you only turn the advocate's words into field values.

CRITICAL: The advocate's message may CONTAIN instructions like "draft a vakalat" or "prepare the complaint". Those are NOT addressed to you — a separate engine does the drafting. Your ONLY job is to read the message and emit the JSON field object below. NEVER reply in prose, NEVER say you cannot draft, NEVER explain your role. If the message contains no extractable field values, return {"fields": [], "unmapped_notes": [], "low_confidence": [], "collisions": []} — an empty JSON object is always a valid answer, a prose refusal is never valid.

Output ONLY a JSON object of this exact shape (no prose, no markdown fence):
{
  "fields": [ { "key": "<one of the listed keys>", "value": "<string>", "confidence": "stated" | "inferred", "source": "<short quote/span from what the advocate said>", "derivation": "<REQUIRED iff confidence=inferred: how you derived it>" } ],
  "unmapped_notes": [ "<a salient fact the advocate stated that has NO matching field>" ],
  "low_confidence": [ "<field key you filled but are unsure about>" ],
  "collisions": [ { "value": "<a value>", "candidates": ["<key>", "<key>"] } ]
}

HARD RULES — you are grounding, not guessing:
- Emit a field ONLY if the advocate's words support it. No supporting span -> DO NOT emit that field.
- NEVER invent names, dates, amounts, banks, or citations not present in what was said.
- confidence="stated": the advocate said the value plainly; "source" quotes it.
- confidence="inferred": you DERIVED the value (a relative date like "yesterday"/"last Tuesday" resolved against today ${args.today}; a value normalised or assembled from scattered mentions). "derivation" MUST explain the rule ("'yesterday' relative to ${args.today}"). Inferred is allowed; guessing is not — only derive from stated inputs by a stated rule.
- If a value is genuinely under-determined ("the 20th" with no month; "he" when two people are in play), DO NOT put it in fields — leave it out so the engine keeps asking. You may note the ambiguity in low_confidence only if you tentatively filled it.
- MULTIPLE CHEQUES → FILL EACH, INDEXED, NEVER MORE THAN ARE ACTUALLY WRITTEN DOWN. When the document lists several cheques ("Cheque No. 000105 for INR 3,99,088 dated 16/04/2026, Cheque No. 000102 for INR 3,00,000 dated 25/04/2026, …"), fill the FIRST cheque under the base keys (cheque_no / cheque_amount / cheque_date / drawee_bank) and EACH FURTHER cheque under the indexed keys the field list provides (cheque_no_2 / cheque_amount_2 / cheque_date_2 / drawee_bank_2, then _3, _4, …), stopping the INSTANT you run out of ACTUAL cheques in the text. The field list may offer MANY MORE indexed cheque slots than the document has cheques — that is normal (it supports up to 12 cheques for documents that need it) and is NEVER an invitation to invent a cheque to fill them. Count the DISTINCT "Cheque No." mentions in the text FIRST; fill exactly that many indexed groups and STOP — leave every remaining cheque_no_N/cheque_amount_N/cheque_date_N/drawee_bank_N key OUT of your output entirely. A field being AVAILABLE is not evidence it is TRUE. Keep each cheque's number, amount, and date TOGETHER (all from the SAME cheque — never cross a #2 amount onto #1). Never take a cheque number from a document TITLE, heading, or agreement name — a cheque number is always a short digit sequence immediately after "Cheque No./Number/#", never a sentence or phrase.
- If one value could fill two GENUINELY DIFFERENT fields, DO NOT pick — record it in "collisions" with the TWO distinct field keys and emit neither. NEVER list the same field key twice in a collision (that is not a collision — just fill the field).
- A NAME field gets the party's NAME ONLY. Strip trailing role/description clauses: "THOORIGAI PRINTS, Proprietor: Ambeth Arivukarasan" -> value "THOORIGAI PRINTS"; "M/s VENKI PUBLICATIONS, Prop. R. Venkatesh Bhat" -> value "M/s VENKI PUBLICATIONS". Do not fold the proprietor, PAN, GST, or address into a name field.
- ROLE ANCHORS decide WHICH party a name/address belongs to. A legal document labels each party by role — "hereinafter referred to as the Payee / Vendor / Complainant / Lessor / First Party" vs "the Drawer / Customer / Accused / Lessee / Second Party". Match EACH party field to the block carrying that role, and take that SAME block's address for the matching address field. NEVER copy one party's address into the other party's address field. Worked example: a block "THOORIGAI PRINTS … Address: No. 8/2, Nair Vardha Pillai Street … referred to as the Vendor/Payee" fills payee_name="THOORIGAI PRINTS" AND payee/sender address="No. 8/2, Nair Vardha Pillai Street …"; a SEPARATE block "VENKI PUBLICATIONS … Address: No.102, Govindappa Naicken Street, Parrys … referred to as the Customer/Drawer" fills drawer/recipient name="VENKI PUBLICATIONS" AND drawer/recipient address="No.102, Govindappa Naicken Street, Parrys …". The two addresses are DIFFERENT — if you are about to write the same address into both, STOP: you have mismatched a role; re-read the role anchors. When the roles cannot be told apart, leave the address out (do not guess) — better empty than swapped.
- AMOUNT fields take a full money figure with a currency cue ("INR 3,99,088", "Rs. 3,99,088", "₹3,99,088") — NEVER a bare digit pulled from prose (a list number "2.", a count "the first two cheques", a clause number). The value is the digits of that figure only (3,99,088 -> 399088). For per-cheque amounts across several cheques, pair EACH amount with its own cheque's number/date under the matching index (see MULTIPLE CHEQUES). A single digit like "2" is NEVER a valid amount — if that is all you can find, emit NOTHING for the amount.
- For a "textarea" field, "value" is the NARRATIVE / LIST content that field holds, taken from what was said — several sentences or items, ONE PER LINE (separate them with newlines). This is where the substantive facts go. A textarea named for the facts/averments/grounds/statement (e.g. "body_paras", "facts", "grounds", "averments", "narrative") MUST be filled with the actual factual statements the document/brief contains — the events, the transaction, what happened, the dates and amounts in prose form — NOT left empty just because no single word "labels" it. If the source recites facts of the matter, those facts ARE the value of the narrative field. Do not paraphrase away specifics (names, dates, amounts, section numbers) — carry them through. Only leave a narrative field empty if the source genuinely states no facts at all.
- For a "select" field, "value" MUST be EXACTLY one of its options (verbatim).
- For a "date" field, "value" MUST be YYYY-MM-DD.
- For "currency"/"number", "value" is digits only (no symbols, commas, words). A currency value must come from a figure that HAD a currency cue (Rs./INR/₹) or an explicit amount context — never a stray numeral.`;

  const fieldLines = args.fields
    .map((f) => {
      const opts = f.type === 'select' && f.options?.length ? `; one of: ${f.options.join(' | ')}` : '';
      const req = f.required ? '; required' : '; optional';
      return `- ${f.key} — ${f.label} [${f.type}${opts}${req}]`;
    })
    .join('\n');

  const answeringLine = args.answering.length
    ? `\n\n# The advocate's latest message is answering questions about these fields\n${args.answering.join(', ')}\n(Prioritise extracting these, but still extract anything else clearly stated.)`
    : '';

  const user = `# Fields you may fill\n${fieldLines}\n\n# Conversation so far\n${args.transcript.slice(-MAX_TRANSCRIPT_CHARS)}${answeringLine}\n\n# The advocate's latest message\n${args.latest}`;
  return { system, user };
}

/** Coerce/validate a raw extracted value to the field's type. '' => drop it. */
/** A cheque number is always a short alphanumeric token (digits, maybe a
 *  leading letter/dash) — never a sentence, a document title, or a phrase with
 *  spaces. Guards against the model misreading something like "CHEQUE
 *  PRESENTATION DEFERMENT AGREEMENT" (the document's own title) as a cheque
 *  number. Applies to `cheque_no`, `cheque_no_2`, … `cheque_no_12`. */
function isPlausibleChequeNumber(s: string): boolean {
  return /^[A-Za-z0-9-]{1,20}$/.test(s.trim());
}

/** Full English month names, index 0 = January. Shared with markSyntheticDates
 *  (intake.service.ts) so the DMY month-name handling lives in ONE place. */
export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

const MONTH_INDEX: ReadonlyMap<string, number> = new Map(
  MONTH_NAMES.flatMap((name, i) => [
    [name.toLowerCase(), i + 1] as const,
    [name.slice(0, 3).toLowerCase(), i + 1] as const, // Jan, Feb, …
  ]),
);

/** Zero-pad a numeric month/day to two digits. */
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Build a validated YYYY-MM-DD string from numeric parts, or '' if the parts
 *  don't form a real calendar date (guards e.g. month 13, day 32). */
function toIso(y: number, mo: number, d: number): string {
  if (!Number.isInteger(y) || !Number.isInteger(mo) || !Number.isInteger(d)) return '';
  if (y < 1000 || y > 9999 || mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  return `${y}-${pad2(mo)}-${pad2(d)}`;
}

/**
 * Normalise the common ways a date reaches us — from Haiku echoing the paste or
 * emitting a loosely-formatted ISO — to a strict zero-padded YYYY-MM-DD, or ''
 * if nothing parses. Without this, a value the advocate plainly stated
 * ('16/04/2026', '2026-4-16', '16 April 2026') is coerced to '' and falsely
 * reported "couldn't find". Indian DD/MM ordering is the default for all-numeric
 * day-first forms, matching the rest of the codebase (markSyntheticDates,
 * isDocumentPaste).
 */
export function normalizeToIsoDate(input: string): string {
  let s = input.trim();
  if (!s) return '';
  // Drop any trailing time component: '2026-04-16T00:00:00', '2026-04-16 12:30'.
  s = s.replace(/[T\s]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/i, '').trim();

  // ISO-ish 'YYYY-M-D' / 'YYYY/M/D' (already year-first) — just zero-pad.
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return toIso(Number(m[1]), Number(m[2]), Number(m[3]));

  // All-numeric day-first: 'DD/MM/YYYY', 'DD-MM-YYYY', 'DD.MM.YYYY' (Indian order).
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return toIso(Number(m[3]), Number(m[2]), Number(m[1]));

  // 'D Month YYYY' / 'Month D, YYYY' with an ordinal suffix allowed on the day.
  const dayFirst = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\.?,?\s+(\d{4})$/i);
  if (dayFirst) {
    const mo = MONTH_INDEX.get(dayFirst[2]!.toLowerCase());
    if (mo) return toIso(Number(dayFirst[3]), mo, Number(dayFirst[1]));
  }
  const monthFirst = s.match(/^([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i);
  if (monthFirst) {
    const mo = MONTH_INDEX.get(monthFirst[1]!.toLowerCase());
    if (mo) return toIso(Number(monthFirst[3]), mo, Number(monthFirst[2]));
  }

  return '';
}

function coerceValue(spec: IntakeFieldSpec, raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  const s = String(raw).trim();
  if (!s) return '';
  if (/^cheque_no(_\d+)?$/.test(spec.key) && !isPlausibleChequeNumber(s)) return '';
  switch (spec.type) {
    case 'select': {
      if (!spec.options?.length) return s;
      return spec.options.find((o) => o.toLowerCase() === s.toLowerCase()) ?? '';
    }
    case 'date':
      // Accept strict ISO as-is; otherwise normalise the common Indian/ISO forms
      // Haiku emits ('16/04/2026', '2026-4-16', '2026-04-16T00:00:00', '16 April
      // 2026') to zero-padded YYYY-MM-DD. Only genuinely unparseable input yields
      // '' (dropped by patchFromRaw) — a stated date is no longer lost to format.
      return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : normalizeToIsoDate(s);
    case 'currency': {
      const digits = s.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1').replace(/\.$/, '');
      // Guard against a stray numeral mistaken for money (the "amount = 2" bug):
      // a real cheque/claim/consideration amount is not a 1-2 digit number. If the
      // model handed us something that small, it almost certainly grabbed a list
      // marker or a word like "two" — drop it so the engine keeps asking rather
      // than drafting a notice demanding "Rs. 2".
      if (!digits) return '';
      const whole = digits.split('.')[0] ?? '';
      if (whole.length < 3) return '';
      return digits;
    }
    case 'number': {
      const digits = s.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
      return digits.replace(/\.$/, '');
    }
    default:
      return s;
  }
}

interface RawExtraction {
  fields?: Array<{ key?: string; value?: unknown; confidence?: string; source?: string; derivation?: string }>;
  unmapped_notes?: unknown[];
  low_confidence?: unknown[];
  collisions?: Array<{ value?: unknown; candidates?: unknown[] }>;
}

/**
 * Strip the prayer WRAPPER an advocate (or the LLM) naturally includes when
 * dictating relief. Every prayer-bearing template already supplies its own frame
 * — "It is therefore prayed that this Hon'ble Court may be pleased to {{ prayer }}"
 * — so the `prayer` field must hold ONLY the operative relief ("allow the
 * petition"). Without this, a captured "that the Hon'ble Court be pleased to allow
 * the petition" renders as "...pleased to that the Hon'ble Court be pleased to
 * allow the petition" (the double-stub). Doc-type-agnostic: applied to any field
 * named `prayer`, so it fixes every template with a prayer, not just the affidavit.
 *
 * Only LEADING wrapper clauses are removed, and only when they're clearly the
 * frame (not part of the relief). The apostrophe may be straight (') or curly (’).
 */
export function stripPrayerWrapper(value: string): string {
  let v = value.trim();
  // Iteratively peel any stacked leading frames, e.g. "it is prayed that the
  // Hon'ble Court may be pleased to ...". Each pattern is anchored at the start.
  const WRAPPERS: RegExp[] = [
    // "it is (therefore) (most respectfully/humbly) prayed that"
    /^it\s+is\s+(?:therefore\s+)?(?:most\s+)?(?:respectfully\s+|humbly\s+)?prayed\s+that\b[\s,:-]*/i,
    // "(that) this/the Hon'ble Court may/be/would be (graciously) pleased to"
    /^(?:that\s+)?(?:this|the)\s+hon(?:['’]|\s+)?ble\s+court\s+(?:may\s+be|be|would\s+be|will\s+be)\s+(?:graciously\s+)?pleased\s+to\b[\s,:-]*/i,
    // bare "may be pleased to" / "be pleased to"
    /^(?:may\s+be|be)\s+pleased\s+to\b[\s,:-]*/i,
    // a leading bare "that " left over after the above
    /^that\s+/i,
  ];
  let changed = true;
  while (changed) {
    changed = false;
    for (const re of WRAPPERS) {
      const next = v.replace(re, '');
      if (next !== v) { v = next.trim(); changed = true; }
    }
  }
  return v || value.trim(); // never strip to empty; fall back to the original
}

/** Post-coercion value normalization, keyed by field. Currently: prayer-wrapper
 *  stripping (see stripPrayerWrapper). Extend here for other per-field cleanups. */
export function normalizeFieldValue(key: string, value: string): string {
  if (key === 'prayer' && value) return stripPrayerWrapper(value);
  return value;
}

/**
 * Turn a raw model JSON extraction into a validated ExtractionPatch against the
 * field contract: closed vocabulary (hallucinated keys dropped), type coercion,
 * inferred-needs-derivation, and collisions committed to neither field.
 * Exported for unit testing (the collision-dedup + coercion logic).
 */
export function patchFromRaw(
  obj: RawExtraction,
  specs: IntakeFieldSpec[],
  modelUsed: string,
): ExtractionPatch {
  const allowed = new Map(specs.map((f) => [f.key, f]));
  const fields: ExtractedField[] = [];
  // Keys we salvaged from a mislabelled 'inferred' (see below) — kept but flagged
  // for the advocate to confirm, rather than silently dropped.
  const salvagedLowConfidence: string[] = [];
  for (const f of obj.fields ?? []) {
    if (!f.key) continue;
    const spec = allowed.get(f.key);
    if (!spec) continue; // drop hallucinated keys not in the contract
    const value = normalizeFieldValue(f.key, coerceValue(spec, f.value));
    if (!value) continue; // coercion rejected it -> engine keeps asking
    const confidence: 'stated' | 'inferred' = f.confidence === 'inferred' ? 'inferred' : 'stated';
    const field: ExtractedField = {
      key: f.key,
      value,
      confidence,
      source: typeof f.source === 'string' ? f.source.slice(0, 400) : '',
    };
    if (confidence === 'inferred') {
      if (typeof f.derivation === 'string' && f.derivation.trim()) {
        field.derivation = f.derivation.slice(0, 400);
      } else if (field.source) {
        // Haiku routinely mislabels a plainly STATED value as 'inferred' when it
        // merely normalised it ('3,99,088' -> '399088') and then omits the
        // derivation. The value is grounded (a non-empty source span quotes the
        // paste), so DON'T drop it — keep it, synthesize a derivation, and flag
        // it low-confidence so the advocate confirms rather than losing it.
        field.derivation = 'normalised from source span';
        salvagedLowConfidence.push(f.key);
      } else {
        // No derivation AND no source span: truly ungrounded — demote rather than
        // silently accept a guess dressed as a derivation.
        logger.warn({ key: f.key }, 'intake extract: inferred value lacks derivation and source; dropping');
        continue;
      }
    }
    fields.push(field);
  }

  const collisions = (obj.collisions ?? [])
    .map((c) => ({
      value: typeof c.value === 'string' ? c.value : String(c.value ?? ''),
      // DEDUPE candidates to DISTINCT known keys. The model sometimes returns the
      // same field twice (["cheque_no","cheque_no"]) — that is NOT a real
      // collision (a value that "could be the Cheque number or the Cheque
      // number"). Only 2+ DISTINCT candidates is a genuine ambiguity.
      candidates: Array.from(new Set((c.candidates ?? []).map(String).filter((k) => allowed.has(k)))),
    }))
    .filter((c) => c.value && c.candidates.length >= 2);

  // A field named in a REAL collision must NOT also be committed (don't pick). A
  // degenerate "collision" (one distinct candidate) was filtered out above, so its
  // field commits normally below.
  const collided = new Set(collisions.flatMap((c) => c.candidates));
  const committed = fields.filter((f) => !collided.has(f.key));

  return {
    fields: committed,
    unmappedNotes: (obj.unmapped_notes ?? []).map(String).filter(Boolean).slice(0, 10),
    lowConfidence: Array.from(
      new Set([...(obj.low_confidence ?? []).map(String), ...salvagedLowConfidence]),
    ).filter((k) => allowed.has(k)),
    collisions,
    modelUsed,
  };
}

// ---- PHRASER (§4) ----------------------------------------------------------

function buildPhrasePrompt(args: {
  docLabel: string;
  issues: Array<{ field: string; code: string; message: string; label: string; options?: string[] }>;
}): { system: string; user: string } {
  const system = `An advocate is briefing an Indian legal document ("${args.docLabel}") in conversation. A deterministic engine has reported exactly which details are still missing or malformed. Your ONLY job is to word a natural, warm, concise question for each one. You do NOT decide what to ask — the engine did. Ask for exactly what is listed, nothing more, nothing less.

Output ONLY a JSON object (no prose, no fence):
{ "questions": [ { "field": "<the EXACT field key given>", "question": "<one natural question>" } ] }

RULES:
- Produce a question for EVERY field listed. Do not skip any.
- Do NOT ask about anything not listed. Do not add questions of your own.
- Use the "field" key VERBATIM as given (so the system can match your wording to the engine's request).
- If two listed fields naturally belong in one question (e.g. a bank AND its branch), you may combine them into ONE question but you MUST still emit one entry PER field, each with the same combined question text.
- For a malformed/type/enum issue, gently ask for the corrected value; for an enum, name the allowed options.
- One sentence per question. No legal advice, no explanation of why it's needed unless the message says so.`;

  const lines = args.issues
    .map((i) => {
      const opts = i.options?.length ? `; options: ${i.options.join(' | ')}` : '';
      return `- key="${i.field}" — ${i.label} [${i.code}: ${i.message}${opts}]`;
    })
    .join('\n');
  const user = `# Details the engine still needs\n${lines}`;
  return { system, user };
}

export const intakeLlm = {
  get provider(): Provider {
    return env.llmProvider;
  },

  /**
   * Extract a field patch from the conversation. Never throws on LLM/parse
   * failure — returns an empty patch so the caller can fall back to asking
   * (the engine still knows what's missing). Closed-vocabulary + grounded.
   */
  async extract(args: {
    docLabel: string;
    fields: IntakeFieldSpec[];
    transcript: string;
    latest: string;
    answering: string[];
    today: string;
    provider?: 'xai' | 'anthropic';
    onUsage?: (u: NormalizedUsage & { provider: Provider; model: string }) => void;
  }): Promise<ExtractionPatch> {
    const provider = resolveProvider(args.provider);
    const empty: ExtractionPatch = {
      fields: [], unmappedNotes: [], lowConfidence: [], collisions: [], modelUsed: 'fallback:none',
    };
    if (provider === 'none' || !args.latest.trim() || args.fields.length === 0) return empty;

    const { system, user } = buildExtractPrompt(args);
    // Two attempts. A doc-rich paste over a 30+-field contract produces a large JSON
    // object; if the model's output is TRUNCATED at the token cap, the JSON is
    // unparseable and we used to drop the WHOLE extraction — reporting every field as
    // "not found" even though the model had correctly extracted them (it just ran out
    // of output room). So: a generous first cap, and on an unparseable/empty parse a
    // single retry with a HIGHER cap + a terse "JSON only, no prose" nudge (which also
    // recovers the occasional case where a small model answers conversationally instead
    // of emitting JSON). Genuinely-absent fields are still simply omitted by the model
    // and left for the engine to gap-fill — this only stops us LOSING fields that WERE
    // extracted.
    const CAPS = [4096, 8192];
    // The best (most-fields) patch recovered so far. A truncated-but-parseable
    // response commits a partial patch; if a higher CAP is still available we
    // re-extract and keep whichever patch has MORE fields (see below).
    let best: ExtractionPatch | null = null;
    for (let attempt = 0; attempt < CAPS.length; attempt++) {
      const sys = attempt === 0
        ? system
        : `${system}\n\nIMPORTANT: Output ONLY the JSON object — no prose, no explanation, no markdown fence. Emit the COMPLETE object; do not stop early.`;
      let raw: string;
      let stopReason: string | undefined;
      try {
        const result = await complete(provider, sys, user, CAPS[attempt]!);
        raw = result.text;
        stopReason = result.stopReason;
        args.onUsage?.({
          provider, model: intakeModelFor(provider),
          tokensIn: result.tokensIn, tokensOut: result.tokensOut,
          cacheRead: result.cacheRead, cacheWrite: result.cacheWrite,
        });
      } catch (err) {
        logger.warn({ err, attempt }, 'intake extract LLM failed');
        continue; // network/API error — try the next attempt, else fall through to empty
      }

      const obj = parseJsonLoose<RawExtraction>(raw);
      if (obj) {
        const patch = patchFromRaw(obj, args.fields, providerTag(provider));
        // Whether the JSON parsed is INDEPENDENT of whether the output was cut
        // off: a response truncated just after a clean outer '}' still parses,
        // but is missing every field the model would have emitted after the cut
        // (e.g. notice_date, advocate_name, place). The only trustworthy
        // truncation signal is the provider's stop reason. If the output was
        // cut off AND a higher cap is still available, DON'T commit this partial
        // set — escalate and re-extract, then keep whichever patch has more
        // fields. Otherwise the silently-dropped trailing fields are wrongly
        // reported "couldn't find".
        const truncated = stopReason === 'max_tokens' || stopReason === 'length';
        if (!best || patch.fields.length > best.fields.length) best = patch;
        if (truncated && attempt < CAPS.length - 1) {
          logger.warn(
            { recovered: patch.fields.length, attempt, cap: CAPS[attempt], stopReason },
            'intake extract: parseable but truncated at token cap — retrying with higher cap',
          );
          continue; // re-extract at the next CAP; best keeps the fuller patch
        }
        return best;
      }

      // The top-level JSON.parse failed — almost always because the output was
      // TRUNCATED at the token cap mid-object (a rich s.138 paste with many
      // cheques). Rather than treat this as total failure and lose every field
      // the model DID emit fully, salvage the complete elements of the `fields`
      // array. This runs BEFORE the higher-cap retry, so most truncations never
      // reach it; the retry remains as a fallback when nothing can be salvaged.
      const salvaged = salvageTruncatedExtraction(raw);
      if (salvaged) {
        logger.warn(
          { recovered: salvaged.fields?.length ?? 0, attempt, cap: CAPS[attempt] },
          'intake extract: JSON truncated — salvaged complete fields from partial output',
        );
        const salvagedPatch = patchFromRaw(salvaged, args.fields, providerTag(provider));
        // Don't regress below a fuller patch recovered on a prior (parseable but
        // truncated) attempt.
        return best && best.fields.length > salvagedPatch.fields.length ? best : salvagedPatch;
      }

      logger.warn({ raw: raw.slice(0, 200), attempt, cap: CAPS[attempt] }, 'intake extract: unparseable JSON (likely truncated) — retrying with higher cap');
    }

    // Exhausted all caps. Return the best patch we recovered along the way (if a
    // truncated-but-parseable attempt gave us one) rather than an empty error.
    return best ?? { ...empty, modelUsed: 'fallback:error' };
  },

  /**
   * Phrase one question per engine issue. The RETURNED wording is the model's;
   * the caller runs reconcile() so the SET of questions is exactly the engine's
   * (no invented, no skipped). Never throws — on failure the caller falls back
   * to the plain field labels.
   */
  async phrase(args: {
    docLabel: string;
    issues: Array<{ field: string; code: string; message: string; label: string; options?: string[] }>;
    provider?: 'xai' | 'anthropic';
    onUsage?: (u: NormalizedUsage & { provider: Provider; model: string }) => void;
  }): Promise<Array<{ field: string; question: string }>> {
    const provider = resolveProvider(args.provider);
    if (provider === 'none' || args.issues.length === 0) return [];
    try {
      const { system, user } = buildPhrasePrompt(args);
      const result = await complete(provider, system, user, 1000);
      args.onUsage?.({
        provider, model: intakeModelFor(provider),
        tokensIn: result.tokensIn, tokensOut: result.tokensOut,
        cacheRead: result.cacheRead, cacheWrite: result.cacheWrite,
      });
      const obj = parseJsonLoose<{ questions?: Array<{ field?: string; question?: string }> }>(result.text);
      if (!obj?.questions) return [];
      return obj.questions
        .filter((q): q is { field: string; question: string } =>
          typeof q.field === 'string' && typeof q.question === 'string' && q.question.trim().length > 0)
        .map((q) => ({ field: q.field, question: q.question.trim() }));
    } catch (err) {
      logger.warn({ err }, 'intake phrase LLM failed; caller falls back to labels');
      return [];
    }
  },

  /**
   * CLASSIFY a free-form brief into ONE of the engine's routable document labels,
   * so the conversation can auto-pick the format without the advocate choosing it
   * first. Grounded: the model must return a label VERBATIM from `labels` (the
   * engine's own catalogue) — anything else is snapped to the closest known label
   * or left null (the caller then asks). Never throws; on any failure returns a
   * null pick so the caller can prompt for the format. This is pure routing — no
   * drafting, no legal reasoning.
   */
  async classifyDocType(args: {
    brief: string;
    labels: string[];
    /** The advocate's OWN instruction ("draft a complaint under 138"), separate
     *  from any attached reference-document text folded into `brief`. When set, it
     *  is presented FIRST and authoritatively so a long reference document (e.g. a
     *  s.138 NOTICE on file) cannot pull the classification toward its own document
     *  type — the advocate asking for a "complaint" must beat a Notice PDF's prose. */
    instruction?: string;
    provider?: 'xai' | 'anthropic';
    onUsage?: (u: NormalizedUsage & { provider: Provider; model: string }) => void;
  }): Promise<{ label: string | null; confidence: 'high' | 'medium' | 'low' }> {
    const provider = resolveProvider(args.provider);
    const labelSet = new Set(args.labels);
    if (!args.brief.trim() || args.labels.length === 0) {
      return { label: null, confidence: 'low' };
    }
    if (provider === 'none') {
      return { label: null, confidence: 'low' };
    }

    const system = `You route an Indian advocate's plain-language matter to the SINGLE legal document they most likely need. You do NOT draft anything and you do NOT reason about the law — you only pick the document type.

You MUST return a docLabel copied VERBATIM from this list — never invent one:
${args.labels.map((l) => `- ${l}`).join('\n')}

Output ONLY a JSON object (no prose, no fence):
{ "docLabel": "<one label copied exactly from the list, or empty string if genuinely unclear>", "confidence": "high" | "medium" | "low" }

Rules:
- The advocate's OWN INSTRUCTION is authoritative. If it names or clearly implies a document type, pick THAT — even when an attached reference document is a DIFFERENT type. (A matter often INCLUDES a document of one type — e.g. a s.138 NOTICE already on file — while the advocate is asking you to draft the NEXT document — e.g. the s.138 COMPLAINT. Never let the attached document's type override what the advocate asked to draft.)
- Pick the most specific document that fits the matter.
- A s.138 (dishonoured/bounced cheque) matter has TWO documents — distinguish by intent:
  - the pre-litigation demand NOTICE (default when the advocate just describes the bounced cheque and wants to demand payment) -> the s.138 NOTICE label.
  - the court COMPLAINT (when the advocate says "complaint", "case", "prosecute", "file", or the 15-day notice period has already lapsed) -> the s.138 COMPLAINT label.
- Arrest/custody seeking release -> a bail label; apprehending arrest -> anticipatory bail.
- If you truly cannot tell, return an empty docLabel with confidence "low" (do not guess wildly).
- The docLabel MUST match a list entry character-for-character.`;
    // Lead with the advocate's own instruction (authoritative), THEN the matter
    // context / attached document text. This ordering + the rule above stops a long
    // reference document from dominating the classification.
    const user = args.instruction?.trim()
      ? `# The advocate's instruction (authoritative — draft THIS)\n${args.instruction.trim().slice(0, 1000)}\n\n# Matter context and attached documents (background only)\n${args.brief.slice(0, 8000)}`
      : `# The advocate's matter\n${args.brief.slice(0, 8000)}`;

    try {
      const result = await complete(provider, system, user, 200);
      args.onUsage?.({
        provider, model: intakeModelFor(provider),
        tokensIn: result.tokensIn, tokensOut: result.tokensOut,
        cacheRead: result.cacheRead, cacheWrite: result.cacheWrite,
      });
      const obj = parseJsonLoose<{ docLabel?: string; confidence?: string }>(result.text);
      const raw = typeof obj?.docLabel === 'string' ? obj.docLabel.trim() : '';
      const conf: 'high' | 'medium' | 'low' =
        obj?.confidence === 'high' || obj?.confidence === 'medium' || obj?.confidence === 'low'
          ? obj.confidence
          : 'medium';
      if (raw && labelSet.has(raw)) return { label: raw, confidence: conf };
      // Loose match: the model returned something close (case / partial).
      if (raw) {
        const low = raw.toLowerCase();
        const hit = args.labels.find(
          (l) => l.toLowerCase() === low || l.toLowerCase().includes(low) || low.includes(l.toLowerCase()),
        );
        if (hit) return { label: hit, confidence: 'low' };
      }
      return { label: null, confidence: 'low' };
    } catch (err) {
      logger.warn({ err }, 'intake classifyDocType LLM failed; caller will ask for the format');
      return { label: null, confidence: 'low' };
    }
  },
};
