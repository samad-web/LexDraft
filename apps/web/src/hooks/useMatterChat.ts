import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  MatterChatMessage,
  MatterChatStreamEvent,
  MatterChatThread,
} from '@lexdraft/types';
import { api, apiClient } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

// =============================================================================
// Matter Intelligence — chat hooks.
//
// The "post message" mutation streams via SSE rather than going through the
// shared axios client. The hook builds an absolute URL the same way
// useMockArguments does (apiClient.baseURL is empty in dev because of the
// Vite proxy; in prod it's VITE_API_URL).
//
// Streaming contract: see MatterChatStreamEvent in @lexdraft/types. Frames
// arrive in order: user_message → many delta → assistant_message (terminal)
// or error (terminal). The hook surfaces this via a callback-based API
// because React Query's useMutation isn't a great fit for token-by-token
// streaming — the caller manages its own in-flight assistant-bubble state.
// =============================================================================

const RETRY_DELAYS_MS = [500, 1500, 4000];

function isNetworkError(err: unknown): boolean {
  // fetch() raises TypeError for DNS / refused / aborted-pre-response. Any
  // HTTP status (even 5xx) comes back as res.ok=false instead and is NOT
  // a network error — the server saw the request, so retrying may double-
  // commit. Same heuristic as useMockArguments.
  return err instanceof TypeError;
}

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

export function useMatterChatThreads(caseId: string | null | undefined) {
  return useQuery({
    queryKey: ['matter-chat', 'threads', caseId],
    queryFn: () =>
      api.get<{ items: MatterChatThread[] }>(`/matter-chat/${caseId}/threads`),
    select: (r) => r.items,
    enabled: !!caseId,
  });
}

export function useCreateMatterChatThread(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { title?: string | null } = {}) =>
      api.post<MatterChatThread>(`/matter-chat/${caseId}/threads`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['matter-chat', 'threads', caseId] }),
  });
}

// ---------------------------------------------------------------------------
// Messages — read
// ---------------------------------------------------------------------------

export function useMatterChatMessages(threadId: string | null | undefined) {
  return useQuery({
    queryKey: ['matter-chat', 'messages', threadId],
    queryFn: () =>
      api.get<{ items: MatterChatMessage[] }>(`/matter-chat/threads/${threadId}/messages`),
    select: (r) => r.items,
    enabled: !!threadId,
    // Disable refetch-on-focus: the client controls message state via the
    // SSE stream + optimistic update path. A focus refetch would race with
    // an in-flight stream and clobber the optimistic bubble.
    refetchOnWindowFocus: false,
  });
}

// ---------------------------------------------------------------------------
// Messages — post with SSE streaming
// ---------------------------------------------------------------------------

export interface StreamMessageCallbacks {
  /** Persisted user-message row, including server-assigned id and timestamps.
   *  Fires once, immediately after the server records the user's message. */
  onUserMessage: (m: MatterChatMessage) => void;
  /** Token batch delta. Fires many times during generation; the caller
   *  appends each `text` to the in-flight assistant bubble. */
  onDelta: (text: string) => void;
  /** Final assistant message with parsed citations. Fires once when the
   *  stream completes successfully. */
  onAssistantMessage: (m: MatterChatMessage) => void;
  /** Terminal error. The user message may already be persisted; the
   *  assistant message is not. The caller should clear the optimistic
   *  bubble and surface this string. */
  onError: (message: string) => void;
  /** Optional: fires while we're waiting between retry attempts on a
   *  pre-response network failure. Lets the UI show "reconnecting…". */
  onReconnecting?: (attempt: number, delayMs: number) => void;
}

/**
 * Stream a chat turn. Plain async function rather than a useMutation
 * because:
 *   1. The hook can't carry token-by-token state through React Query's
 *      mutation cache cleanly.
 *   2. The caller wants synchronous control over the optimistic assistant
 *      bubble's text content, which a mutation can't provide.
 *
 * Cancellation: pass an AbortSignal to stop the stream. We honour it
 * during the retry loop and during the read loop.
 */
export async function streamMatterChatMessage(
  threadId: string,
  content: string,
  cb: StreamMessageCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const token = useAuthStore.getState().token;
  const base = (apiClient.defaults.baseURL ?? '').replace(/\/+$/, '');
  const url = `${base}/api/matter-chat/threads/${threadId}/messages`;

  // Connect with retry — only retries network errors (pre-response). HTTP
  // statuses fall through to the caller because the server already
  // committed at least the user-message persist.
  let res: Response | null = null;
  for (let attempt = 1; attempt <= RETRY_DELAYS_MS.length + 1; attempt++) {
    if (signal?.aborted) return;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'text/event-stream',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ content }),
        ...(signal ? { signal } : {}),
      });
      break;
    } catch (err) {
      if (signal?.aborted) return;
      if (!isNetworkError(err) || attempt > RETRY_DELAYS_MS.length) {
        cb.onError(err instanceof Error ? err.message : 'network error');
        return;
      }
      const delay = RETRY_DELAYS_MS[attempt - 1]!;
      cb.onReconnecting?.(attempt, delay);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  if (!res) return;

  if (!res.ok || !res.body) {
    let detail = `${res.status}`;
    try {
      const body = await res.text();
      detail = body.slice(0, 300) || detail;
    } catch { /* ignore */ }
    cb.onError(`Stream request failed: ${detail}`);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel().catch(() => undefined);
        return;
      }
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames: blank-line separated. Each frame contains exactly one
      // event:/data: pair in this server's contract.
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
        let payload: unknown;
        try {
          payload = JSON.parse(data);
        } catch {
          continue; // malformed frame; skip
        }
        switch (event as MatterChatStreamEvent['type']) {
          case 'user_message':
            cb.onUserMessage(payload as MatterChatMessage);
            break;
          case 'delta':
            cb.onDelta((payload as { text: string }).text);
            break;
          case 'assistant_message':
            cb.onAssistantMessage(payload as MatterChatMessage);
            break;
          case 'error':
            cb.onError((payload as { message: string }).message);
            break;
        }
      }
    }
  } catch (err) {
    if (signal?.aborted) return;
    cb.onError(err instanceof Error ? err.message : 'stream read failed');
  }
}

/**
 * Thin hook around `streamMatterChatMessage` that wires React Query cache
 * invalidation so the messages list flips to the canonical persisted rows
 * once the stream completes.
 *
 * Returns a `post(content, cb, signal)` function — NOT a useMutation —
 * because of the streaming-state reasons documented on
 * `streamMatterChatMessage`.
 */
export function usePostMatterChatMessage(threadId: string, caseId: string) {
  const qc = useQueryClient();
  return {
    post: async (
      content: string,
      cb: StreamMessageCallbacks,
      signal?: AbortSignal,
    ): Promise<void> => {
      const wrapped: StreamMessageCallbacks = {
        ...cb,
        onAssistantMessage: (m) => {
          cb.onAssistantMessage(m);
          // Refresh the canonical messages list (cheap; the SSE already
          // delivered the content but this picks up any server-side
          // normalisation we add later).
          qc.invalidateQueries({ queryKey: ['matter-chat', 'messages', threadId] });
          // Bump the thread's last_message_at via a thread-list invalidation
          // so the switcher reorders.
          qc.invalidateQueries({ queryKey: ['matter-chat', 'threads', caseId] });
        },
      };
      await streamMatterChatMessage(threadId, content, wrapped, signal);
    },
  };
}
