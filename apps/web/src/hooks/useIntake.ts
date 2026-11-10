// =============================================================================
// useIntake — the conversational fact-gathering loop, engine-driven.
//
// The advocate narrates the matter; each turn returns the whole IntakeState (the
// transcript AND the always-visible fact sheet are two views of it). This hook
// does NOT import useDrafting or any model hook: the model calls (extractor +
// phraser) happen SERVER-SIDE inside intake.service, never here. A refusal is
// returned as state (status:'refused'), never thrown — it's a finding, and while
// it stands the loop keeps listening (the advocate can correct anything).
//
// See docs/conversational-intake-plan.md.
// =============================================================================

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  IntakeState,
  IntakeStartRequest,
  IntakeReplyRequest,
  IntakeEditRequest,
  IntakeAttachRequest,
  IntakeAttachmentFile,
} from '@lexdraft/types';
import { api } from '@/lib/api';

/** Begin a conversation from the advocate's opening description. */
export function useIntakeStart() {
  return useMutation<IntakeState, Error, IntakeStartRequest>({
    mutationFn: (req) => api.post<IntakeState>('/drafting/engine/intake/start', req),
  });
}

/** Begin a conversation with NO format chosen — the opening description is
 *  classified into an engine document, and the returned state names the detected
 *  format (detectedDocLabel) so the UI can confirm/override it. */
/** A question typed in the Draft box, answered instead of drafted. */
export interface DraftBoxAnswer { text: string; verify: string[]; draftOffer?: string }

/** Thrown by start-auto when the message was a question: no matter was created. */
export class QuestionAnswered extends Error {
  constructor(public readonly answer: DraftBoxAnswer) { super('answered'); }
}

/** Which document the text is for and the facts it still lacks. Never rewrites the text. */
export interface BriefCheck { docLabel: string | null; title: string; missing: string[]; question: boolean }

export function useCheckBrief() {
  return useMutation<BriefCheck, Error, { message: string }>({
    mutationFn: (req) => api.post<BriefCheck>('/drafting/engine/intake/check-brief', req),
  });
}

export function useIntakeStartAuto() {
  return useMutation<IntakeState, Error, { message: string; instruction?: string }>({
    mutationFn: async (req) => {
      const r = await api.post<IntakeState | { answer: DraftBoxAnswer }>('/drafting/engine/intake/start-auto', req);
      if ('answer' in r) throw new QuestionAnswered(r.answer);
      return r;
    },
  });
}

/** Begin a conversation that drafts IN a format attached in the chat ("draft in
 *  this format"). The file is read into a format for this conversation only. */
export function useIntakeStartFormat() {
  const qc = useQueryClient();
  return useMutation<IntakeState, Error, { message: string; format: IntakeAttachmentFile; save?: boolean }>({
    mutationFn: (req) => api.post<IntakeState>('/drafting/engine/intake/start-format', req),
    onSuccess: (s) => {
      // "Save to my formats" adds it to the Formats library.
      if (s.formatSave?.saved) {
        qc.invalidateQueries({ queryKey: ['firm-formats'] });
        qc.invalidateQueries({ queryKey: ['engine-status'] });
      }
    },
  });
}

/** Continue the conversation with the advocate's next message. */
export function useIntakeReply() {
  return useMutation<IntakeState, Error, IntakeReplyRequest>({
    mutationFn: (req) => api.post<IntakeState>('/drafting/engine/intake/reply', req),
  });
}

/** DRAFT NOW (DraftBot-style): render the WHOLE document from what's on record,
 *  filling genuinely-missing required fields with [placeholders] instead of
 *  asking. Hard-stop refusals still block. */
export function useIntakeDraftNow() {
  return useMutation<
    IntakeState,
    Error,
    { matterId: string; docLabel: string; language?: 'EN' | 'HI' | 'TA' }
  >({
    mutationFn: (req) => api.post<IntakeState>('/drafting/engine/intake/draft-now', req),
  });
}

/** Edit fact-sheet fields directly (§10) — equivalent to stating them in chat. */
export function useIntakeEdit() {
  return useMutation<IntakeState, Error, IntakeEditRequest>({
    mutationFn: (req) => api.post<IntakeState>('/drafting/engine/intake/edit', req),
  });
}

/** Attach files (cheque/memo image, scanned PDF, .docx) as an extraction source.
 *  Values read off the documents land `inferred` for the advocate to confirm;
 *  the engine still enforces every hard-stop. Files are not persisted. */
export function useIntakeAttach() {
  return useMutation<IntakeState, Error, IntakeAttachRequest>({
    mutationFn: (req) => api.post<IntakeState>('/drafting/engine/intake/attach', req),
  });
}

/** What the in-flight draft is doing ("Planning the grounds"), polled while `active`. */
export function useDraftProgress(active: boolean): string | null {
  const q = useQuery({
    queryKey: ['drafting', 'progress'],
    queryFn: () => api.get<{ stage: string | null; label: string | null }>('/drafting/progress'),
    enabled: active,
    refetchInterval: active ? 1500 : false,
    staleTime: 0,
  });
  return active ? q.data?.label ?? null : null;
}
