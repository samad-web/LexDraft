import crypto from 'node:crypto';
import type { DraftLock, IntakeDraft, IntakeState } from '@lexdraft/types';
import { countWords, WORDS_PER_CREDIT } from '../lib/credit-costs';
import { ConflictError } from '../lib/errors';
import { logger } from '../logger';
import { creditService, type CreditCtx } from './credit.service';
import { engineClient } from './engine-client.service';

// =============================================================================
// Drafted pages beyond the credit balance are LOCKED (features/ai-credits.md).
// The cut happens here, server-side, before anything is sent: the browser only
// ever gets the paid pages (JSON blocks, .docx and text alike). The full
// intake draft stays in the matter on the server; a plain-text draft's full
// text is kept in metered_drafts.payload until it is unlocked.
// =============================================================================

/** Every cut copy carries this, so a locked draft is recognised wherever it goes. */
export const LOCK_MARKER = '[The rest of this draft is locked';

/** 409 draft_locked: a cut (locked) draft can't be saved, signed or filed. */
export function assertNotLocked(...texts: Array<string | null | undefined>): void {
  if (texts.some((t) => t?.includes(LOCK_MARKER))) {
    throw new ConflictError('Part of this draft is locked. Unlock it from Plan & Billing before saving, signing or filing it.', { code: 'draft_locked' });
  }
}

export function lockNotice(credits: number): string {
  const n = credits === 1 ? '1 credit' : `${credits} credits`;
  return `${LOCK_MARKER}: about ${Math.ceil(credits)} more page${Math.ceil(credits) === 1 ? '' : 's'}. Unlock it with ${n} from Plan & Billing.]`;
}

/** Keeps whole blocks while they fit in `paidWords`; always at least one cut. */
export function cutBlocks<T extends { text: string }>(blocks: T[], paidWords: number): { kept: T[]; cutAt: number | null } {
  let used = 0;
  for (let i = 0; i < blocks.length; i++) {
    used += countWords(blocks[i]!.text);
    if (used > paidWords) return { kept: blocks.slice(0, i), cutAt: i };
  }
  return { kept: blocks, cutAt: null };
}

/** Plain text cut at the last paragraph break that fits (else a word boundary). */
export function cutText(text: string, paidWords: number): { text: string; cut: boolean } {
  if (countWords(text) <= paidWords) return { text, cut: false };
  const paras = text.split(/(\n\s*\n)/);
  let out = '';
  let used = 0;
  for (const p of paras) {
    const w = countWords(p);
    if (used + w > paidWords) break;
    out += p;
    used += w;
  }
  if (!out.trim()) out = (text.match(/\S+\s*/g) ?? []).slice(0, Math.max(0, Math.floor(paidWords))).join('');
  return { text: out.trimEnd(), cut: true };
}

/** A record of drafted blocks (pipeline output), cut in key order. */
export function cutRecord(rec: Record<string, string>, paidWords: number): { rec: Record<string, string>; cut: boolean } {
  const entries = Object.entries(rec);
  const { kept, cutAt } = cutBlocks(entries.map(([key, text]) => ({ key, text })), paidWords);
  return { rec: Object.fromEntries(kept.map((b) => [b.key, b.text])), cut: cutAt !== null };
}

const blockWords = (d: IntakeDraft | null | undefined) => (d ? d.blocks.reduce((n, b) => n + countWords(b.text), 0) : 0);

/** The client copy of an intake draft with only `paidWords` visible. */
async function cutIntakeDraft<D extends IntakeDraft>(draft: D, paidWords: number, notice: string): Promise<D> {
  const { kept, cutAt } = cutBlocks(draft.blocks, paidWords);
  if (cutAt === null) return draft;
  let docxBase64: string | null = null;
  if (draft.docxBase64 && engineClient.enabled) {
    // Same paragraph count as the engine file: paid text kept, the notice in
    // the first locked paragraph, the rest emptied. Unmatched -> no .docx at all
    // (the client exports from the cut blocks), never the full file.
    const paragraphs = draft.blocks.map((b, i) => (i < cutAt ? b.text : i === cutAt ? notice : ''));
    docxBase64 = await engineClient.applyEdits(draft.docxBase64, paragraphs).catch((err) => {
      logger.warn({ err }, 'locked draft: docx cut failed, sending no docx');
      return null;
    });
  }
  return { ...draft, blocks: [...kept, { key: '__locked__', text: notice }], docxBase64, unfilledSlots: [] };
}

export const draftMeterService = {
  /** Charges an intake draft's pages (once per matter + document) and cuts
   *  what the balance doesn't cover. Every intake response goes through here. */
  async intake(ctx: CreditCtx, state: IntakeState): Promise<IntakeState> {
    if (state.status !== 'generated' || !state.draft) return state;
    const draftKey = `intake:${state.matterId}:${state.docLabel}`;
    const primaryWords = blockWords(state.draft);
    const words = primaryWords + blockWords(state.companionDraft);
    const m = await creditService.meterDraft(ctx, draftKey, words);
    if (m.lockedCredits <= 0) return state;
    const lock: DraftLock = { draftKey, lockedCredits: m.lockedCredits };
    const notice = lockNotice(m.lockedCredits);
    const draft = await cutIntakeDraft(state.draft, m.paidWords, notice);
    const leftForCompanion = Math.max(0, m.paidWords - primaryWords);
    const companionDraft = state.companionDraft
      ? (draft !== state.draft || leftForCompanion <= 0
        ? null // primary already cut: the companion is wholly locked
        : await cutIntakeDraft(state.companionDraft, leftForCompanion, notice))
      : state.companionDraft;
    return { ...state, draft, companionDraft, locked: lock };
  },

  /** A plain-text draft: charged by its pages, cut at the balance; the full
   *  text is held server-side for unlock. */
  async text(ctx: CreditCtx, text: string): Promise<{ text: string; locked?: DraftLock }> {
    const draftKey = `text:${crypto.randomUUID()}`;
    const words = countWords(text);
    if (words === 0) return { text };
    const m = await creditService.meterDraft(ctx, draftKey, words, { text });
    if (m.lockedCredits <= 0) return { text };
    const cut = cutText(text, m.paidWords);
    return { text: `${cut.text}\n\n${lockNotice(m.lockedCredits)}`, locked: { draftKey, lockedCredits: m.lockedCredits } };
  },

  /** A streamed draft: deltas flow only up to what the balance covers; the rest
   *  is held back, charged by `finish`, and sent as a `locked` event. */
  async stream(ctx: CreditCtx): Promise<{ push: (chunk: string) => string; finish: (send: (event: string, data: unknown) => void) => Promise<void> }> {
    const b = await creditService.balance(ctx.firmId);
    const budget = b.unlimited ? Number.POSITIVE_INFINITY : Math.floor(b.balance * 2) / 2 * WORDS_PER_CREDIT;
    let full = '';
    let sent = '';
    let capped = false;
    return {
      push(chunk) {
        full += chunk;
        if (capped) return '';
        const next = sent + chunk;
        if (countWords(next) <= budget) { sent = next; return chunk; }
        capped = true;
        const lead = next.match(/^\s*/)?.[0] ?? '';
        const allowed = lead + (next.match(/\S+\s*/g) ?? []).slice(0, Math.floor(budget)).join('');
        const out = allowed.startsWith(sent) ? allowed.slice(sent.length) : '';
        sent += out;
        return out;
      },
      async finish(send) {
        const words = countWords(full);
        if (words === 0) return;
        const draftKey = `text:${crypto.randomUUID()}`;
        const m = await creditService.meterDraft(ctx, draftKey, words, { text: full });
        if (m.lockedCredits > 0) {
          send('locked', { draftKey, lockedCredits: m.lockedCredits, notice: lockNotice(m.lockedCredits) });
        } else if (capped && full.length > sent.length) {
          send('delta', { text: full.slice(sent.length) }); // credits arrived meanwhile: all paid
        }
      },
    };
  },

  /** Pipeline / auto-draft result: cut its drafted blocks. Nothing to charge
   *  when the model produced no text (the orchestrator never throws). */
  async pipeline<P extends { draft: Record<string, string> } | null>(ctx: CreditCtx, p: P): Promise<P & { locked?: DraftLock }> {
    if (!p || !Object.values(p.draft).some((t) => countWords(t) > 0)) return p as P & { locked?: DraftLock };
    const out = await draftMeterService.record(ctx, p.draft);
    return { ...p, draft: out.rec, ...(out.locked ? { locked: out.locked } : {}) };
  },

  /** Pipeline output (blocks by key). */
  async record(ctx: CreditCtx, rec: Record<string, string>): Promise<{ rec: Record<string, string>; locked?: DraftLock }> {
    const draftKey = `text:${crypto.randomUUID()}`;
    const words = Object.values(rec).reduce((n, t) => n + countWords(t), 0);
    const m = await creditService.meterDraft(ctx, draftKey, words, { rec });
    if (m.lockedCredits <= 0) return { rec };
    const cut = cutRecord(rec, m.paidWords);
    return { rec: { ...cut.rec, __locked__: lockNotice(m.lockedCredits) }, locked: { draftKey, lockedCredits: m.lockedCredits } };
  },
};
