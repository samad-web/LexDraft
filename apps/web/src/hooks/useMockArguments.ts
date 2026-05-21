import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiClient } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

/**
 * Mock Arguments hooks. Type definitions are kept local to the web app for
 * now (mirror of apps/api/src/services/mock-arguments.service.ts) — same
 * pattern useReview.ts uses while the feature is in preview.
 */

export type MaRole =
  | 'petitioner' | 'respondent' | 'prosecution' | 'defense' | 'appellant' | 'appellee';
export type MaJudgePersona = 'neutral' | 'strict' | 'socratic';
export type MaStatus = 'setup' | 'active' | 'concluded' | 'abandoned';
export type MaInputMode = 'voice' | 'text';
export type MaSpeaker = 'user' | 'ai';

export interface MaCitation {
  citation: string | null;
  sectionNumber: string | null;
  sectionHeading: string | null;
  actTitle: string | null;
  jurisdiction: 'Central' | 'State' | 'Unknown';
  state: string | null;
  excerpt: string;
  sourceUrl: string | null;
}

export interface MaMatterSummary {
  title: string;
  court: string | null;
  parties: { petitioner: string | null; respondent: string | null };
  facts: string[];
  issues: string[];
  applicableStatutes: string[];
  priorJudgments: string[];
}

export interface MaTurnRating {
  legalSoundness: number;
  citationUse: number;
  structure: number;
  persuasiveness: number;
  responsiveness: number;
  comment: string;
}

export interface MaTurn {
  id: string;
  sessionId: string;
  turnNumber: number;
  speaker: MaSpeaker;
  transcript: string;
  citations: MaCitation[] | null;
  rating: MaTurnRating | null;
  createdAt: string;
}

export interface MaSession {
  id: string;
  firmId: string;
  userId: string;
  caseId: string | null;
  uploadId: string | null;
  matterSummary: MaMatterSummary;
  role: MaRole;
  judgePersona: MaJudgePersona;
  plannedDurationSeconds: number | null;
  inputMode: MaInputMode;
  /** BCP-47 code chosen at session start. Drives both the AI prompt and
   *  the STT/TTS locale for the live session. */
  languageCode: string;
  status: MaStatus;
  startedAt: string;
  endedAt: string | null;
  overallScore: number | null;
  rollingSummary: string | null;
  lastSummarizedTurn: number;
  createdAt: string;
  updatedAt: string;
}

export interface MaImprovement {
  turnNumber: number;
  weakDimensions: string[];
  currentExcerpt: string;
  betterVersion: string;
  rationale: string;
  /** Estimated overall-score lift (0-100 scale). */
  projectedLift: number;
}

export interface MaReview {
  id: string;
  sessionId: string;
  rubric: {
    legalSoundness: number;
    citationUse: number;
    structure: number;
    persuasiveness: number;
    responsiveness: number;
    overall: number;
  };
  strengths: string[];
  weaknesses: string[];
  missedArguments: Array<{ point: string; statute?: string; judgment?: string; why?: string }>;
  studyList: Array<{ title: string; citation?: string; why?: string }>;
  /** "Where to improve" — concrete rewrites for the weakest user turns,
   *  each with a projected score lift. */
  improvements: MaImprovement[];
  qualitativeSummary: string;
  generatedAt: string;
  /** Raw text the LLM returned for this run, captured so the user can see
   *  exactly what the model said when the parsed scores look wrong. Null
   *  on demo-mode reviews (no LLM was called) and on rows persisted
   *  before migration 0037. */
  llmRawResponse: string | null;
}

export interface MaSessionWithTurns extends MaSession {
  turns: MaTurn[];
  review: MaReview | null;
}

export interface MaSessionSummary {
  id: string;
  caseId: string | null;
  uploadId: string | null;
  matterTitle: string;
  /** Display name of the advocate who created the session — shown as the
   *  primary label on the list card, with the matter as the subtitle. */
  preparedByName: string;
  role: MaRole;
  judgePersona: MaJudgePersona;
  languageCode: string;
  status: MaStatus;
  startedAt: string;
  endedAt: string | null;
  overallScore: number | null;
  turnCount: number;
}

export interface MaUpload {
  id: string;
  fileName: string;
  fileMime: string;
  fileSize: number;
  extractionStatus: 'pending' | 'ok' | 'failed';
  extractionError: string | null;
  createdAt: string;
  summary: MaMatterSummary;
}

// ---- query keys -----------------------------------------------------------

const SESSIONS_KEY = ['mock-arguments', 'sessions'] as const;
const sessionKey = (id: string) => ['mock-arguments', 'session', id] as const;

// ---- list / detail --------------------------------------------------------

export function useMockArgSessions() {
  return useQuery({
    queryKey: SESSIONS_KEY,
    queryFn: () => api.get<{ items: MaSessionSummary[] }>('/mock-arguments/sessions'),
  });
}

export function useMockArgSession(id: string | null) {
  return useQuery({
    queryKey: id ? sessionKey(id) : ['mock-arguments', 'session', 'none'],
    queryFn: () => api.get<MaSessionWithTurns>(`/mock-arguments/sessions/${id}`),
    enabled: !!id,
  });
}

// ---- setup helpers --------------------------------------------------------

export function useCaseSummary() {
  return useMutation({
    mutationFn: (caseId: string) =>
      api.get<MaMatterSummary>(`/mock-arguments/case-summary/${caseId}`),
  });
}

/** Read a File into base64 (without the data: prefix). FileReader is async,
 *  so the consumer awaits this before posting. We keep the data URI form
 *  internal and strip the prefix because the server wants raw base64. */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Unexpected FileReader result'));
        return;
      }
      const comma = result.indexOf(',');
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsDataURL(file);
  });
}

export function useUploadMatterFile() {
  return useMutation({
    mutationFn: async (file: File) => {
      const contentBase64 = await fileToBase64(file);
      return api.post<MaUpload>('/mock-arguments/uploads', {
        fileName: file.name,
        fileMime: file.type || 'application/pdf',
        contentBase64,
      });
    },
  });
}

// ---- create / conclude ----------------------------------------------------

export interface CreateSessionInput {
  caseId?: string;
  uploadId?: string;
  matterSummary: MaMatterSummary;
  role: MaRole;
  judgePersona: MaJudgePersona;
  plannedDurationSeconds?: number | null;
  inputMode: MaInputMode;
  /** Optional. When omitted the API falls back to the user's profile default. */
  languageCode?: string;
}

export function useCreateMockArgSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSessionInput) =>
      api.post<MaSession>('/mock-arguments/sessions', input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SESSIONS_KEY });
    },
  });
}

export function useConcludeMockArgSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      api.post<MaSessionWithTurns>(`/mock-arguments/sessions/${sessionId}/conclude`),
    onSuccess: (data) => {
      qc.setQueryData(sessionKey(data.id), data);
      qc.invalidateQueries({ queryKey: SESSIONS_KEY });
    },
  });
}

/** Re-generate the review for a session that's already been concluded.
 *  Returns the updated session with the fresh review attached. The cache
 *  for both the detail view and the landing list is invalidated so the
 *  new overall_score lights up everywhere it's surfaced. */
export function useRerunMockArgReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      api.post<MaSessionWithTurns>(`/mock-arguments/sessions/${sessionId}/review/rerun`),
    onSuccess: (data) => {
      qc.setQueryData(sessionKey(data.id), data);
      qc.invalidateQueries({ queryKey: SESSIONS_KEY });
    },
  });
}

// ---------------------------------------------------------------------------
// Turn streaming
// ---------------------------------------------------------------------------
// The SSE stream doesn't fit the React-Query mutation shape (we need
// per-token callbacks), so we expose a plain async function the LiveArgument
// component drives directly. Cancellable via the AbortSignal.

export interface StreamTurnCallbacks {
  onUserTurn: (turn: MaTurn) => void;
  onCitations: (citations: MaCitation[]) => void;
  onDelta: (chunk: string) => void;
  onAiTurn: (turn: MaTurn) => void;
  onError: (message: string) => void;
  /** Fires before each retry attempt during the initial connect. `attempt`
   *  is 1-indexed (so attempt=2 means "retry #1"). Lets the UI show a
   *  "Reconnecting…" banner. Once the first byte arrives we never retry. */
  onReconnecting?: (attempt: number, nextDelayMs: number) => void;
}

const RETRY_DELAYS_MS = [250, 750, 2000];

function isNetworkError(err: unknown): boolean {
  // fetch() rejects with TypeError ('Failed to fetch') for DNS / TCP /
  // CORS-preflight failures — i.e. cases where the server never saw the
  // request. HTTP error statuses come back as `res.ok === false` instead,
  // which we don't retry (the server did see it and may have committed
  // partial state).
  return err instanceof TypeError;
}

export async function streamTurn(
  sessionId: string,
  transcript: string,
  cb: StreamTurnCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const token = useAuthStore.getState().token;
  // apiClient.baseURL is empty in dev (the Vite proxy hops to the API);
  // in prod it's VITE_API_URL. Reuse the same baseURL so this matches
  // the rest of the app's networking.
  const base = (apiClient.defaults.baseURL ?? '').replace(/\/+$/, '');
  const url = `${base}/api/mock-arguments/sessions/${sessionId}/turns/stream`;

  // Connect with retry. Only retries network-level failures (server never
  // saw the request); HTTP error responses fall through to the caller
  // because the server may have already persisted the user turn.
  let res: Response | null = null;
  for (let attempt = 1; attempt <= RETRY_DELAYS_MS.length + 1; attempt++) {
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'text/event-stream',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ transcript }),
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
    } catch {
      // ignore
    }
    cb.onError(`Stream request failed: ${detail}`);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Parse SSE frames: blank-line separated; each frame may have multiple
      // event:/data: lines but we keep it simple (one of each per frame).
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
          switch (event) {
            case 'user_turn':
              cb.onUserTurn(payload as MaTurn);
              break;
            case 'citations':
              cb.onCitations((payload as { citations: MaCitation[] }).citations);
              break;
            case 'delta':
              cb.onDelta((payload as { text: string }).text);
              break;
            case 'ai_turn':
              cb.onAiTurn(payload as MaTurn);
              break;
            case 'error':
              cb.onError((payload as { message: string }).message);
              break;
            case 'done':
            default:
              break;
          }
        } catch {
          // Malformed frame — keep parsing.
        }
      }
    }
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') return;
    // Reader errors after the connect succeeded mean the server may have
    // committed partial state. We surface the error but DO NOT retry — the
    // user re-submits if they want, and the server's partial-AI-turn row
    // is already on disk for context.
    cb.onError(err instanceof Error ? err.message : 'stream failed');
  }
}

// Re-export so the view can invalidate after streaming finishes.
export const mockArgQueryKeys = {
  sessions: SESSIONS_KEY,
  session: sessionKey,
};
