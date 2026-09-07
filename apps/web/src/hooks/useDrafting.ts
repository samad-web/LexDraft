import { useCallback, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type {
  DraftRequest,
  DraftResponse,
  DraftPipelineRequest,
  DraftPipelineResponse,
  AutoDraftRequest,
  AutoDraftResponse,
  DraftChatRequest,
  DraftChatResponse,
  ExtractDraftFieldsRequest,
  ExtractDraftFieldsResponse,
} from '@lexdraft/types';
import { api, apiClient } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

export type LlmProvider = 'xai' | 'anthropic';

/**
 * The one-input auto draft: the advocate gives only a plain-language brief
 * (typed or dictated). The server decides the document type, resolves BNS/BNSS
 * sections, and drafts it — no tab-picking, no form. Returns the triage decision
 * plus the grounded pipeline result.
 */
export function useAutoDraft() {
  return useMutation({
    mutationFn: (req: AutoDraftRequest) =>
      api.post<AutoDraftResponse>('/drafting/auto', req),
  });
}

/**
 * Conversational drafting chat. The advocate talks in plain words; the server
 * routes intent (greeting / question / off-topic / ready-to-draft), replies
 * naturally, and only runs the grounded drafting engine when there's a real
 * matter. Returns the reply plus an optional grounded draft.
 */
export function useDraftChat() {
  return useMutation({
    mutationFn: (req: DraftChatRequest) =>
      api.post<DraftChatResponse>('/drafting/chat', req),
  });
}

/** A section hit from the offence-KB search (for the add/swap-section control). */
export interface KbSectionHit {
  id: string;
  citation: string;
  offenceName: string;
  law: string;
  section: string;
  sectionTitle: string;
  verified: boolean;
  status: string;
}

/** Search the offence knowledge base for sections to add/swap by hand. */
export function useKbSectionSearch() {
  return useMutation({
    mutationFn: (q: string) =>
      api.get<{ items: KbSectionHit[] }>(`/drafting/kb/search?q=${encodeURIComponent(q)}`),
  });
}

/**
 * Runs the grounded four-stage pipeline (reason -> BNS/BNSS sections -> draft
 * -> audit). The advocate types/dictates a plain-language matter and gets back
 * KB-grounded sections, drafted blocks, and a self-audit verdict. Export must
 * be disabled while `data.blocked` is true.
 */
export function usePipelineDraft() {
  return useMutation({
    mutationFn: (req: DraftPipelineRequest) =>
      api.post<DraftPipelineResponse>('/drafting/pipeline', req),
  });
}

export function useGenerateDraft() {
  return useMutation({
    mutationFn: (req: DraftRequest & { provider?: LlmProvider }) =>
      api.post<DraftResponse>('/drafting/generate', req),
  });
}

/** Extract structured field values from a free-form (typed/dictated) brief. */
export function useExtractDraftFields() {
  return useMutation({
    mutationFn: (req: ExtractDraftFieldsRequest) =>
      api.post<ExtractDraftFieldsResponse>('/drafting/extract-fields', req),
  });
}

/** A pipeline stage reported by the drafting agent (plan/draft/review/refine). */
export interface DraftStageInfo {
  stage: 'plan' | 'draft' | 'review' | 'refine' | 'done';
  label: string;
  detail?: string;
}

interface StreamState {
  text: string;
  isStreaming: boolean;
  error: string | null;
  data: DraftResponse | null;
  /** Latest agent stage, or null for the single-shot (non-agent) path. */
  stage: DraftStageInfo | null;
}

const INITIAL: StreamState = { text: '', isStreaming: false, error: null, data: null, stage: null };

/**
 * Streams generation deltas from the API. State updates on every chunk so the
 * preview can show the document being written in real time.
 */
export function useStreamDraft() {
  const [state, setState] = useState<StreamState>(INITIAL);

  const reset = useCallback(() => setState(INITIAL), []);

  /** Populate the preview from a saved draft without making an API call. */
  const seed = useCallback((data: DraftResponse) => {
    setState({ text: data.text, isStreaming: false, error: null, data, stage: null });
  }, []);

  const generate = useCallback(
    async (
      req: DraftRequest & { provider?: LlmProvider },
      opts?: { agent?: boolean },
    ) => {
    setState({ text: '', isStreaming: true, error: null, data: null, stage: null });
    const baseURL = apiClient.defaults.baseURL ?? '';
    const token = useAuthStore.getState().token;
    // Agent mode runs the plan→draft→review→refine pipeline; the default path
    // is the single-shot stream. Both share the same SSE event contract.
    const endpoint = opts?.agent ? '/api/drafting/agent/stream' : '/api/drafting/generate/stream';

    let response: Response;
    try {
      response = await fetch(`${baseURL}${endpoint}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(req),
      });
    } catch (err) {
      setState({
        text: '',
        isStreaming: false,
        error: err instanceof Error ? err.message : 'Network error',
        data: null,
        stage: null,
      });
      return;
    }

    if (!response.ok || !response.body) {
      const msg = await response.text().catch(() => '');
      setState({
        text: '',
        isStreaming: false,
        error: msg || `Request failed (${response.status})`,
        data: null,
        stage: null,
      });
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let acc = '';

    // Standard streaming-reader pattern; loop exits on `done`.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep = buffer.indexOf('\n\n');
      while (sep !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        sep = buffer.indexOf('\n\n');

        let event = 'message';
        let data = '';
        for (const line of frame.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).trim();
        }
        if (!data) continue;

        try {
          const payload = JSON.parse(data);
          if (event === 'delta' && typeof payload.text === 'string') {
            acc += payload.text;
            setState((prev) => ({ ...prev, text: acc }));
          } else if (event === 'stage' && typeof payload.stage === 'string') {
            // Agent-only progress event. Clear it on the terminal 'done' stage
            // so the stage chip disappears once the document is final.
            setState((prev) => ({
              ...prev,
              stage: payload.stage === 'done' ? null : (payload as DraftStageInfo),
            }));
          } else if (event === 'done') {
            setState({
              text: acc,
              isStreaming: false,
              error: null,
              data: { docType: req.docType, text: acc, generatedAt: payload.generatedAt },
              stage: null,
            });
          } else if (event === 'error') {
            setState({
              text: acc,
              isStreaming: false,
              error: typeof payload.message === 'string' ? payload.message : 'Generation failed',
              data: null,
              stage: null,
            });
          }
        } catch {
          // ignore malformed frames
        }
      }
    }
  }, []);

  return { ...state, generate, reset, seed };
}
