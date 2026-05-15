import { useCallback, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { DraftRequest, DraftResponse } from '@lexdraft/types';
import { api, apiClient } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

export type LlmProvider = 'xai' | 'anthropic';

export function useGenerateDraft() {
  return useMutation({
    mutationFn: (req: DraftRequest & { provider?: LlmProvider }) =>
      api.post<DraftResponse>('/drafting/generate', req),
  });
}

interface StreamState {
  text: string;
  isStreaming: boolean;
  error: string | null;
  data: DraftResponse | null;
}

const INITIAL: StreamState = { text: '', isStreaming: false, error: null, data: null };

/**
 * Streams generation deltas from the API. State updates on every chunk so the
 * preview can show the document being written in real time.
 */
export function useStreamDraft() {
  const [state, setState] = useState<StreamState>(INITIAL);

  const reset = useCallback(() => setState(INITIAL), []);

  /** Populate the preview from a saved draft without making an API call. */
  const seed = useCallback((data: DraftResponse) => {
    setState({ text: data.text, isStreaming: false, error: null, data });
  }, []);

  const generate = useCallback(async (req: DraftRequest & { provider?: LlmProvider }) => {
    setState({ text: '', isStreaming: true, error: null, data: null });
    const baseURL = apiClient.defaults.baseURL ?? '';
    const token = useAuthStore.getState().token;

    let response: Response;
    try {
      response = await fetch(`${baseURL}/api/drafting/generate/stream`, {
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
          } else if (event === 'done') {
            setState({
              text: acc,
              isStreaming: false,
              error: null,
              data: { docType: req.docType, text: acc, generatedAt: payload.generatedAt },
            });
          } else if (event === 'error') {
            setState({
              text: acc,
              isStreaming: false,
              error: typeof payload.message === 'string' ? payload.message : 'Generation failed',
              data: null,
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
