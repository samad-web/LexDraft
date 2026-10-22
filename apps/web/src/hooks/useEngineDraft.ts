// =============================================================================
// useEngineDraft — the ENGINE-routed draft path (Phase 2, flagged).
//
// This file deliberately imports NOTHING from useDrafting.ts (the model hooks).
// The engine path for s.138 makes no model call at all — no EXTRACT, CLASSIFY,
// DRAFT, or VERIFY — so keeping it in a separate module makes that guarantee
// structural: there is no code path from here into the LLM pipeline.
// =============================================================================

import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

// ---- Engine response contract (mirrors the FastAPI wire shape) --------------

export interface EngineRefusal {
  code: string;
  severity: string;
  reason: string;
  computation: string | null;
  pipeline: string;
  spec: string;
  fields_implicated: string[]; // inbound keys/paths, already translated
  remedy_hint: string;
}

export interface EngineBlock {
  key: string;
  text: string;
}

export type RenderStatus = 'pending' | 'ready' | 'failed' | 'unavailable';

export type EngineDraftResult =
  | {
      outcome: 'generated';
      docType: string;
      signals: { review_banner: string; unverified_marker: string };
      // The Node engine-client maps the engine's snake_case wire keys to
      // camelCase before returning them, so the web contract is camelCase.
      unfilledSlots: string[];
      blocks: EngineBlock[];
      // SINGLE RENDERING PATH: the server no longer returns docx_base64. The engine
      // .docx is rendered to a filing PDF by a background job and stored; the client
      // gets a handle (renderId) and polls useDraftRender for the PDF/.docx URLs.
      // blocks[] above remain DISPLAY METADATA only, never the filing artifact.
      renderId: string | null;
      renderStatus: RenderStatus;
    }
  | {
      outcome: 'refused';
      docType: string;
      refusal: EngineRefusal;
    };

/** A render's status + (when ready) short-lived presigned artifact URLs. */
export interface DraftRenderState {
  id: string;
  renderStatus: RenderStatus;
  docType: string;
  templateId: string;
  templateVersion: number;
  sofficeVersion: string;
  pdfUrl?: string | null;
  docxUrl?: string | null;
  expiresAt?: string | null;
  error?: string | null;
}

/**
 * Poll a render until it is ready or failed. The PDF backs the PREVIEW (pdfjs) and
 * the .docx is the DOWNLOAD — both come from here, so preview and filing copy are the
 * SAME engine-produced document. Presigned URLs expire in 15 minutes; refetching this
 * query mints fresh ones.
 */
export function useDraftRender(renderId: string | null | undefined) {
  return useQuery({
    queryKey: ['draft-render', renderId],
    enabled: !!renderId,
    queryFn: () => api.get<DraftRenderState>(`/drafting/engine/render/${renderId}`),
    // Poll while the conversion is in flight; stop once terminal.
    refetchInterval: (query) => {
      const s = query.state.data?.renderStatus;
      return s === 'pending' ? 1500 : false;
    },
  });
}

export interface EngineValidationIssue {
  field: string;
  code: string; // 'required' | 'type' | 'enum' | 'malformed'
  message: string;
}

/** A 422 from the engine draft: the FORM is incomplete/malformed. This is a
 *  DIFFERENT thing from a refusal — a client/form problem, not a legal finding. */
export class EngineFormError extends Error {
  constructor(public issues: EngineValidationIssue[]) {
    super('form incomplete');
    this.name = 'EngineFormError';
  }
}

export interface EngineStatus {
  enabled: boolean;
  /** Documents the current user can draft through the engine right now. */
  docLabels: string[];
  /** The full engine format catalogue, independent of the per-user flag. Used by
   *  "My formats" to bind a saved house-style format to a real engine document. */
  formats: string[];
  /** The firm's own approved formats (also included in docLabels/formats). */
  firmFormats?: Array<{ id: string; label: string; title: string }>;
}

/** Is the engine-routed path available for this user + which documents? */
export function useEngineStatus() {
  return useQuery({
    queryKey: ['engine-status'],
    queryFn: () => api.get<EngineStatus>('/drafting/engine/status'),
    staleTime: 5 * 60_000,
  });
}

export interface EngineDraftRequest {
  docLabel: string;
  matterId: string;
  form: Record<string, unknown>;
  extra?: Record<string, unknown>;
}

/**
 * Draft through the engine. A REFUSAL is returned as data (outcome:'refused'),
 * never thrown — it is a legal finding the UI renders conversationally. A 422 is
 * thrown as EngineFormError so the caller renders the incomplete-form UI, which
 * is a distinct message from a refusal.
 */
export function useEngineDraft() {
  return useMutation<EngineDraftResult, Error, EngineDraftRequest>({
    mutationFn: async (req) => {
      try {
        return await api.post<EngineDraftResult>('/drafting/engine/draft', req);
      } catch (err) {
        // api throws on non-2xx; a 422 carries the validation issues.
        const status = (err as { response?: { status?: number } })?.response?.status;
        const data = (err as { response?: { data?: unknown } })?.response?.data as
          | { error?: string; issues?: EngineValidationIssue[] }
          | undefined;
        if (status === 422 && data?.error === 'validation') {
          throw new EngineFormError(data.issues ?? []);
        }
        throw err;
      }
    },
  });
}

/** Ensure a fact sheet exists (create v1, or revise to vN+1) and get its
 *  matterId + current version. The engine keys sign-off on this version. */
export function useEnsureMatter() {
  return useMutation<
    { matterId: string; version: number },
    Error,
    { matterId?: string; facts: Record<string, unknown> }
  >({
    mutationFn: (req) => api.post('/drafting/engine/ensure-matter', req),
  });
}

export interface EngineSignOffRequest {
  docLabel: string;
  matterId: string;
  signedOn: string;
  context: Record<string, unknown>;
}

/** Mark an engine draft final. Clears the review banner (server-side, via the
 *  sign-off audit); a 409 (unfilled slot) throws so the UI can explain it. */
export function useEngineSignOff() {
  return useMutation<{ outcome: 'signed_off'; version: number }, Error, EngineSignOffRequest>({
    mutationFn: (req) => api.post('/drafting/engine/sign-off', req),
  });
}
