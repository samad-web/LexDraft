// =============================================================================
// intake-compose — the ONE place the engine-routed intake path lets the model
// draft prose, and only under a strict contract (see intake-no-draft.test.ts):
//
//   compose(...) runs ONLY AFTER the engine has returned outcome:'generated' —
//   every fact already extracted, validated, and hard-stop-checked by the
//   engine. Its INPUT is the engine's own rendered blocks + the validated fact
//   map, plus (deep mode) the advocate's own account for narrative detail and a
//   verified authority set (compose-authorities). Dates, amounts and numbers are
//   checked against the skeleton + validated facts ONLY. Its job is to
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
import { introducedParticulars, lostParticulars, misnamedActs, sentencesOf, stripSentences, unauthorisedCitations } from '../lib/draft-guards';
import { COMPOSE_FAMILY, type ComposeFamily } from '../lib/compose-families';
import {
  authoritiesBlock, citedAuthorities, judgmentAuthority, unauthorisedCases, type Authority, type JudgmentRef,
} from '../lib/compose-authorities';
import type { IntakeDraft } from '@lexdraft/types';

type Provider = 'xai' | 'anthropic' | 'none';

interface LlmResult extends NormalizedUsage {
  text: string;
  /** Who actually answered when not the configured model (key failover / dev route). */
  servedBy?: string;
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
  /** Authorities the composed body cites beyond the skeleton (for advocate review). */
  addedAuthorities?: Authority[];
  /** A verification line whose paragraph count the composed body changed: the
   *  caller rewrites `from` to `to` in the .docx too. */
  verification?: { from: string; to: string };
  /** What the pass did, for quality telemetry. Absent when compose never ran. */
  stats?: { planned: boolean; repaired: boolean; authorities: number; judgments: number };
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
export function segmentBlocks(blocks: Array<{ text: string }>, from = 0): Segments | null {
  const start = blocks.findIndex((b, i) => i >= from && NUMBERED.test(b.text));
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

const LETTERED = /^\s*[A-Z][.)]\s+\S/;

/**
 * A letter-style body lettered "A. That …", "B. That …" (the s.138 reply notice)
 * instead of numbered. The run of lettered paragraphs is the body; the composed
 * body is numbered 1., 2. … like any other. null = none.
 */
export function segmentLettered(blocks: Array<{ text: string }>): Segments | null {
  const start = blocks.findIndex((b) => LETTERED.test(b.text));
  if (start === -1) return null;
  let end = start;
  for (let i = start + 1; i < blocks.length && LETTERED.test(blocks[i]!.text); i += 1) end = i;
  return { start, bodyEnd: end, end, startNumber: 1 };
}

/** What a removed sentence leaves behind: the averment's slot stays visible for
 *  the advocate, and nothing that referred to it dangles (round-2 QA: deleting
 *  whole sentences erased s.22 SRA, s.166(3) and s.138 cause-of-action averments). */
const GAP = '[to be drafted]';

/** Text addressed to us, not the court — never part of a pleading. */
const META_TALK = /\b(?:please confirm|let me know|I have (?:removed|kept|restored|added|deleted)|the (?:checker|facts list|skeleton)|as you (?:asked|requested)|removed sentences|previous draft|hard rules)\b/i;

/** "contents of paras 1 to 12" in a verification. */
const PARAS_RANGE = /(\bpara(?:graph)?s?\.?\s+(?:no\.?\s*)?1\s+to\s+)(\d+)/i;

/** "MOST RESPECTFULLY SHOWETH:" — the line a pleading's body follows. */
const SHOWETH = /\bSH[OE]WETH\b/i;

/**
 * Where the body may begin: after the SHOWETH line when the document has one, so a
 * numbered party list in the cause title ("1. The District Collector …") is never
 * mistaken for the body. Documents without one (notices, complaints) scan from 0.
 */
export function bodyStart(blocks: Array<{ text: string }>): number {
  const i = blocks.findIndex((b) => SHOWETH.test(b.text));
  return i === -1 ? 0 : i + 1;
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
    // A heading the model numbered ("6. GROUNDS") is a heading, not a paragraph.
    const bare = p.replace(NUMBERED, '');
    if (bare !== p && SECTION_HEADING(bare)) return bare.trim();
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
/** Documents the family guide misfits: the writ guide's "legal right and duty" /
 *  "alternative remedy" blocks bled into contempt petitions and SLPs (round-2 QA). */
const GUIDE_FOR_DOC: Record<string, string> = {
  contempt_petition: `1. The order of this Court said to be disobeyed: case number, date, and its operative direction quoted exactly as given.
2. Service or knowledge of the order on each contemnor, with dates.
3. Each act or omission of wilful disobedience, dated, and the contemnor responsible — named by name and designation.
4. That the disobedience is wilful and continuing, only as the facts show; limitation under Section 20 of the Contempt of Courts Act, 1971, only as stated in the skeleton.
No "legal right and corresponding duty" or "alternative remedy" paragraphs — this is not a writ petition.`,
  special_leave_petition: `1. The judgment or order impugned: court, case number, date and result.
2. The facts in brief, chronologically, as the facts give them.
3. The QUESTIONS OF LAW of general public importance, numbered, each a single question.
4. GROUNDS, lettered, each a distinct error in the impugned judgment.
5. That no other petition has been filed against the same order, and the limitation position, only as the skeleton states.
No "legal right and corresponding duty" or "alternative remedy" paragraphs.`,
  writ_criminal: `1. The petitioner and the detenu / the person affected, and the impugned order (detention or other), with its number and date.
2. The facts chronologically: the order, its service, the representation made and its fate, with dates.
3. GROUNDS, lettered, each a distinct constitutional or statutory infirmity (non-application of mind, delay in execution or in deciding the representation, non-supply of documents) — only provisions in the skeleton or the Authorities list.
4. Where delay is a ground, whether the person was available and not absconding throughout, as the facts show.
Do NOT invoke Section 482 / 528 (inherent powers) in a writ petition.`,
  counter_affidavit: `Each numbered paragraph answers the petition / affidavit paragraph with the SAME number. Keep every paragraph's number and its stance (admitted / denied / not admitted) exactly; never merge, split, drop, add or renumber.
Within each paragraph: open with the stance, then traverse each material allegation specifically (not a bare denial) and state the respondent's version where a fact supports it. Do not cite the Code of Civil Procedure — it does not govern Article 226 proceedings.`,
};

/** Per document type: the averments a court checks for, which a family guide is
 *  too general to name (QA review 2026-11-02 found each of these missing). */
const MUST_PLEAD: Record<string, string> = {
  s138_notice: '- That the drawer is liable for the offence under Section 138 if payment is not made within 15 days of receipt of this notice (the offence is NOT complete on dishonour alone).',
  s138_complaint: '- The cause of action arose on the failure to pay within 15 days of receipt of the statutory notice (proviso (c) to Section 138 read with Section 142) — not on supply of goods or issue of the cheque.\n- The complainant as payee / holder of the cheque (not "holder in due course" unless an endorsee).',
  default_bail: '- That NO charge sheet / final report had been filed as on the date of this application, and the date the statutory period expired.',
  regular_bail: '- If custody has run past the statutory period without a charge sheet, assert the default-bail right outright, not hesitantly.',
  maintenance: '- The wife (or child / parent) is unable to maintain herself; the respondent has sufficient means and has neglected or refused to maintain.\n- She lives separately for sufficient reason, and is not living in adultery or separately by mutual consent (the bars in Section 144(4) BNSS / 125(4) CrPC).\n- Maintenance is claimed from the date of the application (not from an earlier date of neglect).',
  divorce_mutual_first: '- Living separately for one year or more immediately before presentation; that they have not been able to live together; that they have mutually agreed the marriage be dissolved — Section 13B(1).',
  divorce_mutual_second: '- The second motion is moved not earlier than six months and not later than eighteen months after the PRESENTATION of the first-motion petition — Section 13B(2); consent continues.',
  specific_performance: '- Readiness and willingness to perform, continuously from the agreement to date (Section 16(c) Specific Relief Act).\n- Where the property lies (territorial jurisdiction for immovable property is Section 16 CPC, not Section 20).\n- Refund of the earnest / advance money as alternative relief, which must be specifically claimed (Section 22(2) Specific Relief Act).',
  ejectment: '- That the premises are outside the Tamil Nadu Regulation of Rights and Responsibilities of Landlords and Tenants Act, 2017, or why the civil court has jurisdiction — only if the facts say so.\n- A description of the suit property (schedule).',
  permanent_injunction: '- A description of the suit property (schedule) and the plaintiff\'s possession of it on the date of suit.',
  mact_claim: '- The compensation figures and heads exactly as the skeleton computes them; do not describe or re-derive the method (multiplicand, future prospects, deduction) yourself.\n- The deceased / injured by NAME and each claimant\'s relationship and dependency; every legal representative is a claimant or a respondent.\n- Filed within six months of the accident (Section 166(3) Motor Vehicles Act) — only as the facts give the dates.',
  consumer_complaint: '- A defect in GOODS is a "defect" under Section 2(10); a shortfall in a SERVICE is a "deficiency" under Section 2(11) — use the one that fits.\n- Pecuniary jurisdiction (the value of goods/services paid) and that the complaint is within two years of the cause of action.',
  quash_petition: '- The FIR / complaint particulars and what each offence\'s ingredients are, then why the allegations, taken at face value, do not make them out.',
  criminal_appeal: '- If grounds attack only the sentence, say so; if they attack the conviction, plead the errors in appreciating evidence first.',
  condone_delay_petition: '- The exact period of delay, and a continuous, day-by-day explanation of it from the facts — vague causes are rejected.',
  adjournment_petition: '- A reason the law accepts. Counsel being engaged in another court is NOT by itself a ground (proviso to Order XVII Rule 1 CPC) — if that is the only reason given, plead it plainly and leave "[to be drafted]" for any other cause.',
  written_statement: '- A specific traverse of each allegation; a bare "denies each and every allegation" is an evasive denial (Order VIII Rules 3–5 CPC).',
  counter_affidavit: '- The deponent\'s designation and authority to swear for the respondent; a specific traverse of each paragraph.',
};

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
4. GROUNDS, lettered A, B, C…, each a distinct legal proposition (arbitrariness under Article 14, failure to exercise jurisdiction, violation of the stated rule) — only provisions in the skeleton or the Authorities list.
5. The legal right and corresponding duty. 6. Alternative remedy / why it is not efficacious — where the grievance is INACTION (no order passed), plead that no statutory appeal or revision lies against mere inaction, so no efficacious alternative remedy exists; that is law, not a missing fact, so never leave it "[to be drafted]". 7. That no other petition is pending on the same cause.`,
  family: `1. The parties' particulars. 2. Marriage — date, place, rites, registration; children with ages.
3. The facts in chronological order, each incident in its own paragraph with its date.
4. The statutory ground relied on and how the facts establish it.
5. The statutory declarations the skeleton contains (no collusion, no condonation, jurisdiction, no other proceedings).`,
  notice: `1. Opening: instructed by and on behalf of the client. 2. The relationship/agreement between the parties with dates.
3. The facts giving rise to the claim, chronologically. 4. The client's legal position (only provisions in the skeleton or the Authorities list).
5. The specific demand and the period to comply. 6. The consequence of non-compliance; reservation of rights.`,
  consumer: `1. The complainant as a "consumer". 2. Each opposite party and its role (manufacturer / dealer / service provider).
3. The purchase or service — date, invoice, price. 4. The defect or deficiency and each complaint/service visit, dated.
5. The refusal to remedy. 6. Deficiency in service / unfair trade practice. 7. Pecuniary and territorial jurisdiction and limitation, as in the skeleton.`,
  mact: `1. The accident — date, time, place, vehicles (registration numbers) and how it occurred (rash and negligent driving).
2. The deceased/injured — age, occupation, income. 3. The claimants and their relationship and dependency.
4. The FIR and the owner and insurer of the offending vehicle, with policy number. 5. The heads of compensation claimed, as given.`,
  reply: `Each numbered paragraph answers the plaint/petition paragraph with the SAME number. Keep every paragraph's number exactly as given and its stance exactly as given (admitted / denied / not admitted); never merge, split, drop, add or renumber a paragraph, and never turn a denial into an admission.
Within each paragraph: open with the stance ("The averments in paragraph 5 of the plaint are denied."), then deny each material allegation specifically, not evasively (Order VIII Rules 3 to 5 CPC), and state the respondent's true version where a given fact or the advocate's account supports it. Where a paragraph is admitted, admit only what the skeleton admits.`,
  application: `1. Who applies, and in which proceeding, as the skeleton states it.
2. The circumstance giving rise to the application, chronologically, from the facts.
3. Why the relief is just and necessary: concise numbered grounds, each tied to a given fact (e.g. the reason for absence, the urgency, the prejudice that would otherwise be caused).
4. That the application is bona fide and causes the other side no prejudice, only if the facts support it.
For DELAY: the period from the last day of limitation to filing, explained continuously with every date in the facts — never vague. For AMENDMENT: what is to be changed, why it is needed to decide the real controversy, and (after trial has begun) why it could not be raised earlier despite due diligence.
Keep it short: an application is one to two pages, not a pleading.`,
  quash: `1. The petitioner's position in the impugned proceeding (accused number) and the FIR / final report / complaint, with its number, date, police station or court and the sections.
2. The prosecution allegations exactly as recorded, taken at their face value.
3. Why, even so taken, the ingredients of each offence are not made out — one offence per paragraph, element by element.
4. Any civil or commercial character of the dispute, mala fides or abuse of process, only if a fact shows it.
5. GROUNDS, lettered A, B, C…, each a distinct proposition. 6. For a compromise, the settlement's terms and date and the de facto complainant's consent.
7. That no other petition for the same relief is pending.`,
  appeal: `1. The order or judgment under challenge — court, case number, date and its operative result.
2. The case below in brief: the pleadings or charge, the evidence (witness and exhibit numbers only if in the facts) and the findings, chronologically.
3. Where the court below went wrong — each error tied to the finding it vitiates.
4. GROUNDS, lettered A, B, C…, each a self-standing ground of objection without argument padding (misreading of evidence, wrong burden, error of law or jurisdiction, procedural irregularity) — only provisions in the skeleton or the Authorities list.
5. Limitation and any delay, only as stated in the skeleton.`,
  generic: `Write the body as a practising advocate would: the parties, the facts in chronological order (one event per paragraph), then the legal grounds as numbered self-standing propositions, then any statutory declarations the skeleton contains.`,
};

// ---- REPLY mode ---------------------------------------------------------------

const MERITS_HEADING = /^\s*(?:ON MERITS|REPLY ON MERITS|PARA-?WISE (?:REPLY|COMMENTS))\b/i;

type Stance = { admitted: boolean; denied: boolean; notAdmitted: boolean };

function stanceOf(text: string): Stance {
  const t = text.toLowerCase();
  const notAdmitted = /\bnot\s+admitted\b/.test(t);
  return {
    notAdmitted,
    denied: /\bden(?:y|ied|ies)\b/.test(t),
    // an admission that isn't "not admitted"
    admitted: /\b(?<!not\s)admit(?:ted|s)?\b/.test(t.replace(/\bnot\s+admitted\b/g, '')),
  };
}

/** Group a para-wise body by its paragraph number (sub-lines join their paragraph). */
function byNumber(lines: string[]): Map<string, string> {
  const out = new Map<string, string>();
  let cur: string | null = null;
  for (const l of lines) {
    const m = NUMBERED.exec(l);
    if (m) {
      cur = `${m[1]}${m[2] ?? ''}`;
      out.set(cur, `${out.get(cur) ?? ''} ${l}`);
    } else if (cur) {
      out.set(cur, `${out.get(cur)} ${l}`);
    }
  }
  return out;
}

/**
 * How a composed para-wise reply drifted from the skeleton, or null. Each skeleton
 * paragraph number must survive once, keep every stance it had, and gain no
 * admission — a dropped or softened reply is a deemed admission (O8 R5 CPC).
 */
export function replyDrift(skeletonBody: string, composed: string[]): string | null {
  const want = byNumber(skeletonBody.split('\n'));
  const got = byNumber(composed.flatMap((p) => p.split('\n')));
  const missing = [...want.keys()].filter((n) => !got.has(n));
  if (missing.length) return `dropped paragraph(s) ${missing.join(', ')}`;
  const extra = [...got.keys()].filter((n) => !want.has(n));
  if (extra.length) return `added paragraph number(s) ${extra.join(', ')} that the skeleton does not have`;
  for (const [n, text] of want) {
    const a = stanceOf(text);
    const b = stanceOf(got.get(n)!);
    if ((a.denied && !b.denied) || (a.notAdmitted && !b.notAdmitted) || (a.admitted && !b.admitted) || (!a.admitted && b.admitted)) {
      return `changed the stance of paragraph ${n}`;
    }
  }
  return null;
}

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
  authorities?: Authority[];
  account?: string;
  plan?: string;
  /** REPLY mode: paragraph numbers mirror the pleading answered — keep them. */
  keepNumbers?: boolean;
}): { system: string; user: string } {
  const guide = guideFor(args.docType);
  const system = `You are a senior Indian advocate's drafting associate. You redraft the BODY of "${args.docLabel}" from a deterministic engine's skeleton, which is already legally validated: every citation, statutory averment, computation and legal conclusion in it is correct and MUST survive into your draft. Your output must read like a document actually filed by a practising advocate: thorough, well-organised and precisely argued, not a terse fill-in-the-blank form.

STRUCTURE of the body (include each item ONLY if its underlying fact exists; skip it rather than pad it):
${guide}

HARD RULES — you argue given facts, you never discover new ones:
- State ONLY facts in the "Facts" list, the skeleton or the "Advocate's account". If a fact is not there, do not mention, imply or elaborate it, and drop the paragraph that would need it.
- NEVER invent a date, amount, name, number, section, Act, case citation or event. Do not compute new dates.
- FIGURES: state each given amount as given. Never describe how a figure was arrived at ("at 12% … comes to", "works out to", "for the period of N months") unless the skeleton itself states that computation — you cannot verify arithmetic.
- ACTS: name each Act exactly as the skeleton does. The new codes are: BNS = Bharatiya Nyaya Sanhita, 2023 (offences); BNSS = Bharatiya Nagarik Suraksha Sanhita, 2023 (procedure); BSA = Bharatiya Sakshya Adhiniyam, 2023 (evidence). Never expand one as another.
- LAW: you may cite a provision only if it is in the skeleton or in the "Authorities" list, and only for what its heading or text actually says. Cite an authority in full the first time ("Section 480 of the Bharatiya Nagarik Suraksha Sanhita, 2023") and in short form after that ("Section 480 BNSS"), always naming the Act. Cite a provision where it carries a ground, not as a closing flourish on every paragraph: most grounds stand on their facts. JUDGMENTS: cite a judgment ONLY if it is in the Authorities list (marked JUDGMENT), written exactly as listed, and only for what its quoted paragraph holds; at most one or two, where they carry the strongest grounds. Never cite any other case, by name or citation.
- The "Advocate's account" (when given) is the advocate's own narration and documents: use it for the story and its detail, and state its dates, amounts and numbers exactly as written there. Where the Facts or the skeleton give a different value for the same thing, theirs wins.
- Every section/Act citation, amount, date, day-period and computation in the skeleton body must appear in your body (you may restate, reorder and argue them).
- "[to be drafted]" in the skeleton means: draft that part from the facts. If the facts can't support it, leave "[to be drafted]" in place. A "[... to be provided]" marker whose particular the Facts or the advocate's account plainly state (the property schedule, the district named in the court or police station) is replaced with that particular; keep every other [bracketed marker] exactly as written.
- Do NOT write the title, cause title, prayer, verification, place/date or signature — they are assembled separately. Your grounds must support the prayer given for context.
- Formal Indian legal English, respectful to the court ("It is respectfully submitted that…"). VOICE: only a notice or reply notice speaks as counsel ("My client states that…"); a petition, plaint, complaint, application or affidavit speaks as the party ("The petitioner states…", "I state…") — never "my client" there. Connected, flowing prose within each paragraph; never paste a raw fact value mid-sentence — reword it; never join two facts with a semicolon or "namely X; Y".
- PRECISION: cite the operative sub-section or clause, not the parent section (Section 13B(1), not Section 13, for a first-motion mutual-consent divorce; Section 13(1)(ia) for cruelty; Section 2(10) "defect" for goods, Section 2(11) "deficiency" for services).
- GAPS: where a fact is missing, leave "[to be drafted]" for it and do NOT argue from it elsewhere — no "as pleaded above", "as set out herein", "save as stated herein" pointing at something not actually pleaded, and no ground that depends on an unpleaded fact.
- ECONOMY: each point once. No ground repeated in a later paragraph or summary; no commentary about the document itself ("this plaint contains the particulars required by…"); no long pre-emptive rebuttals of objections nobody has raised. An application is one to two pages.
- CASES: never name a case — not even by short name, "(supra)" or "as laid down in X" — unless it is a JUDGMENT in the Authorities list.
- Plain text only: no Markdown, no bold, no tables. ${args.keepNumbers ? 'Keep every paragraph’s existing number exactly as in the skeleton' : `Number paragraphs "${args.startNumber}.", "${args.startNumber + 1}." … consecutively`}; sub-items as (a), (b) or A., B. on their own lines. Separate paragraphs with a blank line. Output ONLY the body, no preamble or commentary.`;

  const user =
    `# Facts (the ONLY dates, amounts and numbers you may state)\n${factLinesOf(args.facts) || '(none beyond what is in the skeleton)'}\n\n` +
    (args.account ? `# Advocate's account (narrative detail only)\n${args.account}\n\n` : '') +
    `# Authorities (the only provisions you may add)\n${authoritiesBlock(args.authorities ?? [])}\n\n` +
    (args.plan ? `# Argument plan (follow it; drop any ground the facts cannot carry)\n${args.plan}\n\n` : '') +
    `# Document head (context only — do not repeat)\n${args.head || '(none)'}\n\n` +
    `# Skeleton body (redraft this)\n${args.body}\n\n` +
    `# Prayer (context only — do not repeat)\n${args.prayer || '(none)'}\n\n` +
    `# Task\nRedraft the skeleton body into the full structure above, following the hard rules exactly.`;
  return { system, user };
}

// ---- PLAN ---------------------------------------------------------------
// For argued documents a senior first decides WHICH grounds, in what order, each
// tied to the fact and the provision that carry it, and what the other side will
// say. Writing from that plan gives sharper grounds than one pass straight to prose.

const PLANNED_FAMILIES = new Set<ComposeFamily>(['bail', 'writ', 'suit', 'family', 'consumer', 'quash', 'appeal', 'generic']);

/** The structure guide + must-plead list for a doc type (the general-AI fallback
 *  draft uses it too, so both paths plead the same essentials). */
export function guideFor(docType: string): string {
  return (GUIDE_FOR_DOC[docType] ?? GUIDES[COMPOSE_FAMILY[docType] ?? 'generic'])
    + (MUST_PLEAD[docType] ? `\nFor THIS document, these must be pleaded (from the facts; where a fact is missing leave "[to be drafted]" for it):\n${MUST_PLEAD[docType]}` : '');
}

export function plansFor(docType: string | undefined): boolean {
  return PLANNED_FAMILIES.has(COMPOSE_FAMILY[docType ?? ''] ?? 'generic');
}

interface PlanRaw {
  grounds?: Array<{ proposition?: string; facts?: string[]; authority?: string; answers?: string }>;
}

async function planArgument(provider: Provider, args: {
  docLabel: string;
  body: string;
  prayer: string;
  facts: Record<string, string>;
  authorities: Authority[];
  account?: string;
}, onUsage?: (u: LlmResult) => void): Promise<{ text: string; propositions: string[] } | null> {
  const system = `You are a senior Indian advocate planning the grounds of "${args.docLabel}" before it is written. Output ONLY JSON: { "grounds": [ { "proposition": "<one self-standing legal proposition>", "facts": ["<the given facts that carry it>"], "authority": "<a provision from the skeleton or the Authorities list, or empty>", "answers": "<the objection the other side or the court will raise that this ground meets>" } ] }.
Order the grounds strongest and most objective first. Use ONLY the given facts, the skeleton and the advocate's account; never a fact, provision or judgment that is not supplied. Drop any ground the facts cannot carry. At most 8 grounds.`;
  const user =
    `# Facts\n${factLinesOf(args.facts) || '(none)'}\n\n` +
    (args.account ? `# Advocate's account\n${args.account}\n\n` : '') +
    `# Authorities\n${authoritiesBlock(args.authorities)}\n\n` +
    `# Skeleton body\n${args.body}\n\n# Prayer\n${args.prayer || '(none)'}`;
  try {
    const result = await complete(provider, system, user, 2000);
    onUsage?.(result);
    const raw = parseJsonLoose<PlanRaw>(result.text);
    const grounds = (raw?.grounds ?? []).filter((g) => g.proposition?.trim());
    if (!grounds.length) return null;
    const text = grounds
      .map((g, i) => [
        `${i + 1}. ${g.proposition!.trim()}`,
        g.facts?.length ? `   Facts: ${g.facts.join('; ')}` : '',
        g.authority?.trim() ? `   Authority: ${g.authority.trim()}` : '',
        g.answers?.trim() ? `   Answers: ${g.answers.trim()}` : '',
      ].filter(Boolean).join('\n'))
      .join('\n');
    return { text, propositions: grounds.map((g) => g.proposition!.trim()) };
  } catch (err) {
    // A failed plan only costs depth: compose writes without one.
    logger.warn({ err }, 'intake-compose: plan call failed, composing without a plan');
    return null;
  }
}

// ---- VERIFY -------------------------------------------------------------

interface VerifyRaw {
  pass: boolean;
  unsupported_claims: string[];
}

function buildVerifyPrompt(args: {
  composedText: string;
  skeleton: string;
  facts: Record<string, string>;
  authorities?: Authority[];
  account?: string;
}): { system: string; user: string } {
  const system = `You fact-check a drafted legal document against KNOWN FACTS, the advocate's own account (when given) and the engine skeleton it was drafted from. Output ONLY JSON: { "pass": boolean, "unsupported_claims": ["<the shortest exact phrase from the draft that states the unsupported fact>"] }. A claim is UNSUPPORTED if it states a specific date, amount, name, number, place or event present in none of the known facts, the advocate's account or the skeleton; or if it attributes to a provision or judgment something its heading, text or quoted paragraph in the Authorities list does not say.

NOT unsupported: legal boilerplate and advocacy ("constrained to prosecute", "the petitioner is not a flight risk as he is a permanent resident" when residence is a known fact); a legal argument connecting known facts; a restatement, reordering or renumbering of a known fact; a value written in words; a total that is the correct arithmetic sum of known amounts (check it); any citation or section that is in the skeleton; a provision or judgment from the Authorities list cited for what it says.

Quote each unsupported claim EXACTLY as it appears in the draft so it can be located. pass=false if unsupported_claims is non-empty.`;
  const user =
    `# Known facts\n${factLinesOf(args.facts)}\n\n` +
    (args.account ? `# Advocate's account\n${args.account}\n\n` : '') +
    (args.authorities?.length ? `# Authorities\n${authoritiesBlock(args.authorities)}\n\n` : '') +
    `# Engine skeleton\n${args.skeleton}\n\n# Drafted body to check\n${args.composedText}`;
  return { system, user };
}

async function verify(args: {
  composedText: string;
  skeleton: string;
  facts: Record<string, string>;
  authorities?: Authority[];
  account?: string;
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
  // "Rs. 0" is draft-now's sentinel for a missing figure, never a pleaded one.
  return normaliseComposedMarkdown(text).replace(/\bRs\.?\s*0(?:\/-)?(?![\d,.]*\d)/g, 'Rs. [amount to be provided]')
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
  /** Provisions the body may cite beyond the skeleton's (compose-authorities). */
  authorities?: Authority[];
  /** The advocate's own narration and attached-document text — narrative detail
   *  only: dates, amounts and numbers are still checked against skeleton + facts. */
  account?: string;
  /** Plan the grounds before writing (argued families only — see plansFor). */
  plan?: boolean;
  /** On a lost particular or an unlocatable claim, ask for one corrected redraft
   *  before falling back to the skeleton. */
  repair?: boolean;
  /** Judgments supporting the planned grounds (judgments.service.forGrounds). Only
   *  these may be cited; any other case citation or case name is stripped. */
  findJudgments?: (grounds: string[]) => Promise<JudgmentRef[]>;
  /** Progress for the Draft screen (draft-progress). */
  onStage?: (stage: 'planning' | 'judgments' | 'writing' | 'checking' | 'repairing') => void;
  provider?: 'xai' | 'anthropic';
  onUsage?: (u: NormalizedUsage & { provider: Provider; model: string }) => void;
}): Promise<ComposeResult> {
  const plain = { blocks: args.engineBlocks, composed: false as const, modelUsed: 'engine:template' };
  const reject = (reason: string): ComposeResult => {
    logger.warn({ docType: args.docType, reason }, 'intake-compose: rejected, falling back to engine skeleton');
    return { ...plain, rejectedReason: reason, stats: { ...stats } };
  };
  // For quality telemetry (compose-outcomes): what this pass did.
  const stats = { planned: false, repaired: false, authorities: args.authorities?.length ?? 0, judgments: 0 };
  let authorities = args.authorities ?? [];
  const account = args.account?.trim() || undefined;

  // REPLY documents (written statement, counter) have preliminary objections, then
  // the para-wise reply under its own heading: compose the para-wise reply.
  const reply = COMPOSE_FAMILY[args.docType ?? ''] === 'reply';
  const meritsAt = reply ? args.engineBlocks.findIndex((b) => MERITS_HEADING.test(b.text)) : 0;
  if (meritsAt === -1) return plain;
  const seg = segmentBlocks(args.engineBlocks, reply ? meritsAt + 1 : bodyStart(args.engineBlocks))
    ?? (COMPOSE_FAMILY[args.docType ?? ''] === 'notice' ? segmentLettered(args.engineBlocks) : null);
  if (!seg) return plain;
  const lines = args.engineBlocks.map((b) => b.text);
  const head = lines.slice(0, seg.start).join('\n');
  const body = lines.slice(seg.start, seg.bodyEnd + 1).join('\n');
  const prayerLines = lines.slice(seg.bodyEnd + 1, seg.end + 1);
  const tail = lines.slice(seg.end + 1);
  const skeleton = lines.join('\n');

  const provider = resolveProvider(args.provider);
  if (provider === 'none') return plain;
  // Bill the model that actually answered: a key-exhausted failover is Grok, not Sonnet.
  const usage = (result: LlmResult) => {
    const failover = result.servedBy?.startsWith('xai:');
    args.onUsage?.({ ...result, provider: failover ? 'xai' : provider, model: failover ? result.servedBy!.slice(4) : modelFor(provider) });
  };

  if (args.plan && plansFor(args.docType)) args.onStage?.('planning');
  const plan = args.plan && plansFor(args.docType)
    ? await planArgument(provider, {
      docLabel: args.docLabel, body, prayer: prayerLines.join('\n'), facts: args.facts, authorities,
      ...(account ? { account } : {}),
    }, usage)
    : null;
  stats.planned = Boolean(plan);
  if (plan && args.findJudgments) {
    args.onStage?.('judgments');
    const found = await args.findJudgments(plan.propositions).catch(() => [] as JudgmentRef[]);
    authorities = [...authorities, ...found.map(judgmentAuthority)];
    stats.judgments = found.length;
  }

  const { system, user } = buildComposePrompt({
    docLabel: args.docLabel,
    docType: args.docType ?? 's138_notice',
    head, body, prayer: prayerLines.join('\n'), startNumber: seg.startNumber, facts: args.facts,
    authorities,
    ...(account ? { account } : {}),
    ...(plan ? { plan: plan.text } : {}),
    ...(reply ? { keepNumbers: true } : {}),
  });
  let composedText: string;
  try {
    args.onStage?.('writing');
    const result = await complete(provider, system, user, 8000);
    usage(result);
    composedText = result.text.trim();
  } catch (err) {
    logger.warn({ err }, 'intake-compose: compose call failed, falling back to engine draft');
    return plain;
  }
  if (!composedText) return plain;

  const factText = Object.values(args.facts).join('\n');

  // The checks, in order. `retry` = a redraft told exactly what went wrong could pass.
  type Checked =
    | { ok: true; paragraphs: string[]; removed: string[] }
    | { ok: false; reason: string; retry?: string };
  const check = async (text: string): Promise<Checked> => {
    let paragraphs = toParagraphs(text);
    const removed: string[] = [];

    // INTRODUCED: amounts/dates/periods/citations from nowhere -> strip those sentences.
    // The advocate's own account is a source too: a date they typed is not invented
    // (suite r4: "married 25.08.2017" in the brief came out as "[to be drafted]").
    const introduced = introducedParticulars(paragraphs.join('\n'), [skeleton, factText, account ?? ''])
      .filter((p) => p.kind !== 'section' && p.kind !== 'article' && p.kind !== 'order' && p.kind !== 'citation');
    if (introduced.length) {
      const s = stripSentences(paragraphs, introduced.map((p) => p.raw), GAP);
      paragraphs = s.paragraphs;
      removed.push(...s.removed);
    }

    // PROVISIONS: a section/article not in the skeleton or facts must be an authority,
    // with its Act named in the sentence.
    const uncited = [
      // Model chatter that is not pleading ("Please confirm…", "the Facts list…").
      ...paragraphs.flatMap((p) => sentencesOf(p)).filter((x) => META_TALK.test(x)).map((x) => x.trim()),
      ...unauthorisedCitations(paragraphs, [skeleton, factText], authorities),
      // CASES: only a retrieved judgment (or one the skeleton/facts carry) may be cited.
      ...unauthorisedCases(paragraphs, authorities, [skeleton, factText]),
      // An Act named as another ("Nagarik Suraksha Sanhita (BNS)").
      ...misnamedActs(paragraphs),
    ];
    if (uncited.length) {
      const s = stripSentences(paragraphs, uncited, GAP);
      paragraphs = s.paragraphs;
      removed.push(...s.removed);
    }

    // VERIFY: a model fact-check of what's left; flagged claims stripped the same way.
    args.onStage?.('checking');
    const verdict = await verify({
      composedText: paragraphs.join('\n\n'), skeleton, facts: args.facts, authorities,
      ...(account ? { account } : {}),
      ...(args.provider ? { provider: args.provider } : {}),
    });
    if (!verdict.ok) return { ok: false, reason: verdict.unsupportedClaims.join('; ') };
    if (verdict.unsupportedClaims.length) {
      const s = stripSentences(paragraphs, verdict.unsupportedClaims, GAP);
      if (s.unresolved.length) {
        const reason = `unlocated claims: ${verdict.unsupportedClaims.join('; ')}`;
        return { ok: false, reason, retry: `Remove these statements, which no given fact supports: ${s.unresolved.join('; ')}.` };
      }
      paragraphs = s.paragraphs;
      removed.push(...s.removed);
    }

    // LOST: anything load-bearing from the skeleton body that didn't survive.
    // A dropped "[… to be provided]" gap is usually the model filling it from the
    // advocate's account (suite r4 ejectment: the notice date) — not worth losing the
    // whole compose over. A dropped date, amount or section still is.
    const lostAll = lostParticulars(body, paragraphs.join('\n'));
    const lost = lostAll.filter((p) => p.kind !== 'marker');
    if (lostAll.length > lost.length) {
      logger.info({ docType: args.docType, markers: lostAll.filter((p) => p.kind === 'marker').map((p) => p.raw) }, 'intake-compose: skeleton gaps not carried');
    }
    if (lost.length) {
      const items = lost.map((p) => p.raw).join(', ');
      return { ok: false, reason: `dropped from the skeleton: ${items}`, retry: `Your draft dropped these particulars from the skeleton; every one must appear: ${items}.` };
    }
    if (!paragraphs.length) return { ok: false, reason: 'nothing left after checks' };
    if (reply) {
      const drift = replyDrift(body, paragraphs);
      if (drift) return { ok: false, reason: `reply ${drift}`, retry: `Your para-wise reply ${drift}. Every paragraph must keep its number and its stance exactly.` };
    }
    return { ok: true, paragraphs, removed };
  };

  let checked = await check(composedText);
  // REPAIR: a redraft told what failed, run through the same checks - better than
  // handing the advocate the bare skeleton for one dropped date. Twice, each from the
  // latest attempt (r9b: DV, contested divorce, default bail still dropped one item).
  let lastText = composedText;
  for (let attempt = 0; attempt < 2 && !checked.ok && checked.retry && args.repair; attempt++) {
    logger.info({ docType: args.docType, reason: checked.reason, attempt }, 'intake-compose: repairing');
    args.onStage?.('repairing');
    try {
      const result = await complete(provider, system,
        `${user}\n\n# Your previous draft\n${lastText}\n\n# Correction\n${checked.retry} Return the whole corrected body, following the hard rules.`,
        8000);
      usage(result);
      if (!result.text.trim()) break;
      lastText = result.text.trim();
      checked = await check(lastText);
      stats.repaired = checked.ok;
    } catch (err) {
      logger.warn({ err }, 'intake-compose: repair call failed');
      break;
    }
  }
  // RESTATE: a passing draft can still show "[to be drafted]" holes - sentences the
  // checks cut, or skeleton parts the model left (suite r7: 30 of 46 drafts, the top
  // defect reviewers marked). Ask once for each hole drafted from the facts, or named
  // as the exact missing particular; keep it only if it passes with fewer holes.
  const holes = (c: Checked) => (c.ok ? c.removed.length + c.paragraphs.join('\n').split(GAP).length - 1 : Infinity);
  if (checked.ok && holes(checked) > 0 && args.repair && !stats.repaired) {
    args.onStage?.('repairing');
    const cut = checked.removed.length
      ? `These sentences were cut because each states a date, amount, provision or claim found in none of the Facts, the skeleton, the advocate's account or the Authorities:\n- ${checked.removed.join('\n- ')}\nKeep each point, stated without the untraced detail (or drop the point if nothing is left of it).\n`
      : '';
    try {
      const result = await complete(provider, system,
        `${user}\n\n# Your previous draft\n${checked.paragraphs.join('\n\n')}\n\n# Correction\n${cut}Replace EVERY "${GAP}" in your draft: draft that part from the Facts and the advocate's account where they support it; where they genuinely do not, write the specific missing particular in brackets instead, e.g. "[date of service of the notice to be provided]". Never leave "${GAP}" anywhere. Return the whole corrected body, following the hard rules.`,
        8000);
      usage(result);
      const again = result.text.trim() ? await check(result.text.trim()) : null;
      if (again?.ok && holes(again) < holes(checked)) {
        checked = again;
        stats.repaired = true;
      }
    } catch (err) {
      logger.warn({ err }, 'intake-compose: restate call failed');
    }
  }
  if (!checked.ok) return reject(checked.reason);
  const removed = checked.removed;
  const paragraphs = reply ? checked.paragraphs : numberBody(checked.paragraphs, seg.startNumber);

  const prayer = renumberFrom(prayerLines, lastNumber(paragraphs, seg.startNumber - 1) + 1);
  const spliced = [...paragraphs, ...prayer];
  // The verification counts the paragraphs ("contents of paras 1 to 12"): recount.
  const lastPara = lastNumber(spliced, 0);
  let verification: { from: string; to: string } | undefined;
  const newTail = tail.map((t) => {
    const m = PARAS_RANGE.exec(t);
    if (!m || !lastPara || Number(m[2]) === lastPara) return t;
    const to = t.replace(PARAS_RANGE, `$1${lastPara}`);
    verification = { from: t, to };
    return to;
  });
  const blocks = [...lines.slice(0, seg.start), ...spliced, ...newTail].map((text, i) => ({ key: `composed_${i}`, text }));
  if (removed.length) logger.info({ docType: args.docType, removed }, 'intake-compose: sentences removed by checks');
  const added = citedAuthorities(paragraphs, authorities, skeleton);
  logger.info(
    { docType: args.docType, removed: removed.length, authorities: authorities.length, cited: added.length, planned: Boolean(plan) },
    'intake-compose: composed',
  );
  return {
    blocks,
    composed: true,
    splice: { start: seg.start, end: seg.end, paragraphs: spliced },
    ...(removed.length ? { removedSentences: removed } : {}),
    ...(added.length ? { addedAuthorities: added } : {}),
    ...(verification ? { verification } : {}),
    modelUsed: providerTag(provider),
    stats,
  };
}

/**
 * What to tell the advocate when compose fell back to the engine's plain draft —
 * plain language, and what they can do about it. null = nothing worth saying
 * (compose was off or not applicable).
 */
export function composeNoticeFor(result: ComposeResult): string | null {
  if (result.composed || !result.rejectedReason) return null;
  const r = result.rejectedReason;
  if (r.startsWith('dropped from the skeleton:')) {
    return `This is the plain draft: the fuller version left out ${r.slice('dropped from the skeleton:'.length).trim()}, so I didn't use it. Ask me to redraft, or expand the body in the editor.`;
  }
  if (r.startsWith('unlocated claims:')) {
    return `This is the plain draft: the fuller version stated details I couldn't trace to your facts (${r.slice('unlocated claims:'.length).trim()}). Add those details if they're true, then redraft.`;
  }
  if (r === 'nothing left after checks') {
    return 'This is the plain draft: the fuller version did not survive the fact checks. Add more facts about the matter, then redraft.';
  }
  if (r.startsWith('reply ')) {
    return `This is the plain draft: the fuller version ${r.slice('reply '.length)}, and every paragraph must keep its number and its admit / deny stance. Redraft, or expand the replies in the editor.`;
  }
  return 'This is the plain draft: the fact-check step was unavailable, so I kept the version that needs no checking. Try redrafting in a minute.';
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
