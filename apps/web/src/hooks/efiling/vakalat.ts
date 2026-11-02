import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

// =============================================================================
// Vakalat menu (Assign Partners to Case, Accept Offer, Print Vakalat) and My
// Partners (Add Partners, Accept Partnership, Revoke Partnership, Accept
// Revocation, My Partners Report) - live screens of the advocate's own
// eFiling portal page. Shapes mirror apps/api/src/services/
// efiling-portal-vakalat.service.ts (the "live screen" the portfolio screens
// share too).
// =============================================================================

export interface LiveOption { value: string; text: string; selected: boolean; disabled?: boolean }

export interface LiveControl {
  /** CSS selector of the field on the portal page. */
  key: string;
  id: string;
  name: string;
  tag: 'input' | 'select' | 'textarea';
  type: string;
  label: string;
  value: string;
  checked?: boolean;
  options?: LiveOption[];
  required: boolean;
  disabled: boolean;
  readOnly: boolean;
  placeholder: string;
  maxLength?: number;
}

export interface LiveClick { text: string; nth: number; kind: 'button' | 'link'; disabled: boolean; id: string }
export interface LiveCell { text: string; controls: LiveControl[]; clicks: LiveClick[] }
export type LiveRow = { group: string } | { cells: LiveCell[] };
export interface LiveTable { id: string; headers: string[]; filters?: LiveCell[]; rows: LiveRow[] }

export type LiveItem =
  | { kind: 'heading'; text: string }
  | { kind: 'text'; lines: string[]; clicks: LiveClick[] }
  | { kind: 'control'; control: LiveControl }
  | { kind: 'click'; click: LiveClick }
  | { kind: 'table'; table: LiveTable };

export interface LiveScreen { view: string; label: string; title: string; url: string; items: LiveItem[] }

/** 'confirm' = the portal asked a question (its confirm()); answer OK by sending the step again with confirmed. */
export interface LiveMessage { kind: 'error' | 'success' | 'alert' | 'confirm'; text: string }
export interface LiveFile { name: string; contentType: string; base64: string }
export interface LiveStepResult { screen: LiveScreen; messages: LiveMessage[]; file?: LiveFile }

export interface FillEntry { key: string; value?: string | string[]; checked?: boolean }
export interface LiveStep { fill?: FillEntry[]; press?: { text: string; nth: number }; confirmed?: boolean }

/** Buttons that change the advocate's portal account (the API refuses them without `confirmed`). */
export const CHANGES_ACCOUNT = /\b(add|save|submit|assign|accept|approve|remove|delete|import|update|reject|withdraw|revoke|e-?sign|final)/i;

export type PartnersView = 'add_partner' | 'accept_partnership' | 'revoke_partnership' | 'accept_revocation' | 'partners_report';
export type VakalatView = PartnersView | 'vakalat' | 'accept_offer' | 'print_vakalat';

const PARTNER_VIEWS: ReadonlySet<string> = new Set(['add_partner', 'accept_partnership', 'revoke_partnership', 'accept_revocation', 'partners_report']);
const vakalatPath = (sessionId: string, view: VakalatView) =>
  `/efiling/live/session/${sessionId}/${PARTNER_VIEWS.has(view) ? 'partners' : 'vakalat'}/${view}`;

export const httpStatus = (err: unknown) =>
  (err as { response?: { status?: number }; status?: number })?.response?.status ?? (err as { status?: number })?.status;

/** The server's message for a failed portal step. */
export function portalError(err: unknown): string {
  const data = (err as { response?: { data?: { error?: unknown; message?: unknown } } })?.response?.data;
  const m = data?.error ?? data?.message ?? (err as Error)?.message;
  return typeof m === 'string' && m ? m : 'The eFiling portal step failed. Try again.';
}

/** A live screen: opened from the portal's menu and read as the portal draws it. */
export function useLiveScreen(key: unknown[], sessionId: string | null, path: string | null) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ['efiling', 'live', sessionId, ...key],
    queryFn: async () => {
      try {
        return await api.get<LiveScreen>(path!);
      } catch (err) {
        // The session is gone (expired / signed out by the portal): back to the login.
        const s = httpStatus(err);
        if (s === 404 || s === 410) void qc.invalidateQueries({ queryKey: ['efiling', 'live', sessionId], exact: true });
        throw err;
      }
    },
    enabled: !!sessionId && !!path,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: (n, err) => n < 4 && httpStatus(err) === 409 && /still working/i.test(portalError(err)),
    retryDelay: 1500,
  });
}

/** One step on a live screen; what the portal then shows replaces the screen. */
export function useLiveStep(key: unknown[], sessionId: string | null, path: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (step: LiveStep) => api.post<LiveStepResult>(`${path}/step`, step),
    onSuccess: (r) => { qc.setQueryData(['efiling', 'live', sessionId, ...key], r.screen); },
    onError: (err) => {
      const s = httpStatus(err);
      if (s === 404 || s === 410) void qc.invalidateQueries({ queryKey: ['efiling', 'live', sessionId], exact: true });
      // The portal page was replaced by another screen: open this one again.
      if (s === 409 && /open .* again/i.test(portalError(err))) void qc.invalidateQueries({ queryKey: ['efiling', 'live', sessionId, ...key] });
    },
  });
}

export function useVakalatScreen(sessionId: string | null, view: VakalatView) {
  return useLiveScreen(['vakalat', view], sessionId, sessionId ? vakalatPath(sessionId, view) : null);
}

export function useVakalatStep(sessionId: string | null, view: VakalatView) {
  return useLiveStep(['vakalat', view], sessionId, sessionId ? vakalatPath(sessionId, view) : null);
}

export interface PortalMenu { menu: string; items: Array<{ text: string; href: string; onclick: string }> }

/** The portal's own menu bar (labels and order as it draws them). */
export function usePortalMenus(sessionId: string | null) {
  return useQuery({
    queryKey: ['efiling', 'live', sessionId, 'menus'],
    queryFn: () => api.get<{ menus: PortalMenu[] }>(`/efiling/live/session/${sessionId}/vakalat/menu`),
    enabled: !!sessionId,
    staleTime: 10 * 60 * 1000,
    retry: (n, err) => n < 4 && httpStatus(err) === 409,
    retryDelay: 1500,
  });
}
