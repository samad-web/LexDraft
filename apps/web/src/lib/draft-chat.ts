// draft-chat — the plain-language layer that turns the drafting engine's
// structured response into what a junior advocate would actually SAY across the
// table. The chat panel renders these; no software terms, no JSON, no "triage".
//
// Two responsibilities:
//   1. Compose the assistant's reply text for each kind of turn (asking for
//      details, confirming the document, presenting the draft).
//   2. Fold the advocate's plain-language answers back into the brief the engine
//      re-reads, so the next turn drafts from real facts.

import type { AutoDraftResponse, DraftChatResponse } from '@lexdraft/types';

export type ChatRole = 'advocate' | 'assistant';

/** What kind of assistant turn this is — drives how the panel renders it.
 *  'say' is a plain conversational reply (greeting / answer / decline). */
export type AssistantTurnKind = 'say' | 'ask' | 'confirm' | 'draft' | 'error';

export interface AssistantTurn {
  role: 'assistant';
  kind: AssistantTurnKind;
  /** The plain-language message shown as the bubble text. */
  text: string;
  /** For 'ask': the questions to render as quick chips + inputs. */
  questions?: string[];
  /** For 'confirm': the detected doc type + alternatives to offer as buttons. */
  docType?: string;
  alternatives?: string[];
  /** For 'draft': carry the full response so the panel can offer "Use draft". */
  response?: AutoDraftResponse;
}

export interface AdvocateTurn {
  role: 'advocate';
  text: string;
}

export type ChatTurn = AssistantTurn | AdvocateTurn;

/**
 * Interpret a DraftChatResponse into the assistant's next turn. The server's
 * conversational layer already wrote a natural `reply` and classified `intent`.
 * When it also ran the drafting engine (`draft` present), we surface the draft
 * or its clarifying questions inside the same turn — so one assistant message
 * carries the natural line plus (if drafted) the document.
 */
export function chatResponseToTurn(res: DraftChatResponse): AssistantTurn {
  // Conversational-only turn (greeting / question / off-topic): just the reply.
  if (!res.draft) {
    return { role: 'assistant', kind: 'say', text: res.reply };
  }

  const draft = res.draft;
  const docType = draft.triage?.docType ?? 'document';

  // Engine ran but is uncertain about the document — confirm.
  if (draft.needsConfirmation || !draft.pipeline) {
    return {
      role: 'assistant',
      kind: 'confirm',
      docType,
      alternatives: draft.triage?.alternatives ?? [],
      text: res.reply || `This looks like a ${lower(docType)}. Shall I draft that, or is it one of these?`,
    };
  }

  const questions = draft.pipeline.facts?.needs_clarification ?? [];
  if (questions.length > 0) {
    return {
      role: 'assistant',
      kind: 'ask',
      docType,
      questions,
      text: res.reply || `Right — a ${lower(docType)}. A few quick things and I'll draft it. Tap the answer or just tell me; anything you skip stays a blank, I won't make it up.`,
    };
  }

  // Draft ready.
  return {
    role: 'assistant',
    kind: 'draft',
    docType,
    response: draft,
    text: res.reply || `Here's the ${lower(docType)} — read it over, then "Use this draft" to open it in the editor, or tell me what to change.`,
  };
}

/** A polite opening line, shown once when the chat is empty. */
export const CHAT_GREETING =
  "Tell me what happened — in your own words. For example: \"bail for my client Ramesh, arrested yesterday for cheating, took ₹4 lakh, no prior record, before the Sessions Court.\" I'll work out the document and the BNS/BNSS sections, ask if I'm missing anything, and draft it.";

export const CHAT_ERROR =
  "Something went wrong reaching the drafter. Give it another try in a moment — if it keeps failing, the drafting service may be down.";

/**
 * Fold the advocate's answers to the ask-turn questions into a brief appendix
 * the engine treats as authoritative facts. Answers come in as {question: answer}.
 * Blank answers are omitted — they stay ____ placeholders, never invented.
 */
export function answersToBrief(answers: Record<string, string>): string {
  const lines = Object.entries(answers)
    .map(([q, a]) => {
      const val = (a ?? '').trim();
      if (!val || /^not sure/i.test(val)) return null;
      return `- ${q.replace(/\s*\?\s*$/, '')}: ${val}`;
    })
    .filter(Boolean);
  if (lines.length === 0) return '';
  return `\n\nConfirmed details (advocate-supplied — treat as authoritative facts):\n${lines.join('\n')}`;
}

function lower(s: string): string {
  // "Bail Application" → "bail application", but keep acronyms (NDA, RTI, NI).
  if (/^[A-Z0-9 ()/]+$/.test(s)) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}
