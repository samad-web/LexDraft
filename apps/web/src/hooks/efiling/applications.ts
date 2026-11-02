import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiClient } from '@/lib/api';

// =============================================================================
// The portal's Applications menu, live over the advocate's eFiling session
// (shapes mirror apps/api/src/services/efiling-portal-applications.service.ts).
// Every step returns the screen as the portal now shows it.
// =============================================================================

export type AppsScreenKey = 'applications' | 'submitted';

export interface AppControl {
  ref: string;
  tag: string;
  type: string;
  id: string;
  name: string;
  label: string;
  value: string;
  checked?: boolean;
  disabled: boolean;
  readOnly?: boolean;
  options?: Array<{ value: string; text: string }>;
  error?: string;
  risky?: boolean;
}

export type AppRow = { group: string } | { cells: Array<{ text: string; controls: AppControl[] }> };

export type AppItem =
  | { kind: 'heading'; text: string }
  | { kind: 'text'; id: string; label: string; text: string }
  | { kind: 'field'; control: AppControl }
  | { kind: 'button'; control: AppControl }
  | { kind: 'table'; id: string; headers: string[]; rows: AppRow[] };

export interface AppsModal {
  id: string;
  title: string;
  closeRef: string | null;
  items: AppItem[];
}

export interface AppsScreen {
  screen: AppsScreenKey;
  label: string;
  onScreen: boolean;
  tabs: Array<{ ref: string; id: string; text: string; active: boolean }>;
  items: AppItem[];
  modals: AppsModal[];
  messages: string[];
  confirm: string | null;
  confirmRef: string | null;
}

const httpStatus = (err: unknown) =>
  (err as { response?: { status?: number }; status?: number })?.response?.status ?? (err as { status?: number })?.status;

const base = (sessionId: string) => `/efiling/live/session/${sessionId}/applications`;
const screenKey = (sessionId: string | null, screen: AppsScreenKey) => ['efiling', 'live', sessionId, 'applications', screen] as const;

/** A step that finds the session gone (404 / 410) re-checks it, so the screen goes back to the login. */
function useSessionGone(sessionId: string | null) {
  const qc = useQueryClient();
  return (err: unknown) => {
    const s = httpStatus(err);
    if (s === 404 || s === 410) void qc.invalidateQueries({ queryKey: ['efiling', 'live', sessionId], exact: true });
  };
}

/** Open (or re-read) Interlocutory Application Filing / Submitted Applications on the portal. */
export function useApplicationsScreen(sessionId: string | null, screen: AppsScreenKey) {
  const gone = useSessionGone(sessionId);
  return useQuery({
    queryKey: screenKey(sessionId, screen),
    queryFn: async () => {
      try {
        return await api.get<AppsScreen>(`${base(sessionId!)}/screen`, { screen });
      } catch (err) {
        gone(err);
        throw err;
      }
    },
    enabled: !!sessionId,
    // The portal page is the state: never re-read behind the advocate's back.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: (n, err) => n < 3 && httpStatus(err) === 409,
    retryDelay: 1500,
  });
}

export type AppsStep =
  | { kind: 'reopen' }
  | { kind: 'field'; ref: string; value?: string; checked?: boolean }
  | { kind: 'press'; ref: string; confirmed?: boolean }
  | { kind: 'submit' }
  | { kind: 'pay' }
  | { kind: 'otp_send' }
  | { kind: 'otp_verify'; otp: string }
  | { kind: 'search_submitted'; fromDate: string; toDate: string };

/** One step on the screen; the screen the portal then shows replaces the cached one. */
export function useApplicationsStep(sessionId: string | null, screen: AppsScreenKey) {
  const qc = useQueryClient();
  const gone = useSessionGone(sessionId);
  return useMutation({
    mutationFn: (s: AppsStep): Promise<AppsScreen> => {
      const b = base(sessionId!);
      switch (s.kind) {
        case 'reopen': return api.get<AppsScreen>(`${b}/screen`, { screen, fresh: '1' });
        case 'field': return api.post<AppsScreen>(`${b}/field`, { screen, ref: s.ref, value: s.value, checked: s.checked });
        case 'press': return api.post<AppsScreen>(`${b}/press`, { screen, ref: s.ref, confirmed: s.confirmed === true });
        case 'submit': return api.post<AppsScreen>(`${b}/submit`, { confirmed: true });
        case 'pay': return api.post<AppsScreen>(`${b}/fees/pay`, { confirmed: true });
        case 'otp_send': return api.post<AppsScreen>(`${b}/otp/send`);
        case 'otp_verify': return api.post<AppsScreen>(`${b}/otp/verify`, { otp: s.otp, confirmed: true });
        case 'search_submitted': return api.post<AppsScreen>(`${b}/submitted/search`, { fromDate: s.fromDate, toDate: s.toDate });
      }
    },
    onSuccess: (data) => { qc.setQueryData(screenKey(sessionId, screen), data); },
    onError: (err) => {
      gone(err);
      // The page changed under the step (409): read it again.
      if (httpStatus(err) === 409) void qc.invalidateQueries({ queryKey: screenKey(sessionId, screen), exact: true });
    },
  });
}

/** A link that shows a document (an application): the PDF the portal shows, as a blob URL. */
export function useApplicationsDocument(sessionId: string | null, screen: AppsScreenKey) {
  const gone = useSessionGone(sessionId);
  return useMutation({
    mutationFn: async (v: { ref: string; name: string }) => {
      try {
        const r = await apiClient.post<Blob>(`/api${base(sessionId!)}/document`, { screen, ref: v.ref }, { responseType: 'blob' });
        return { url: URL.createObjectURL(r.data), name: v.name, type: r.data.type };
      } catch (err) {
        gone(err);
        const data = (err as { response?: { data?: unknown } })?.response?.data;
        if (data instanceof Blob) {
          const msg = await data.text().then((t) => { try { return (JSON.parse(t) as { error?: string }).error; } catch { return undefined; } });
          if (msg) throw new Error(msg);
        }
        throw err;
      }
    },
  });
}
