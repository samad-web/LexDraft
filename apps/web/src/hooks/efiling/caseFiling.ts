import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

// =============================================================================
// Case Filing on the eFiling portal, live over the advocate's own portal
// session (apps/api efiling-portal-casefiling): New Case Filing (the PDE
// wizard), Draft / eFiled Cases, Manage Favourite Clients. Every answer is
// what the portal's page shows after the step.
// =============================================================================

export type CaseFilingScreen = 'new_case' | 'clients';
export type CaseFilingTabKey =
  | 'initial' | 'litigant' | 'legal_heir' | 'facts' | 'case_details' | 'police' | 'complainant138' | 'caveat'
  | 'mvc' | 'victim' | 'accident' | 'claim' | 'subordinate' | 'efile'
  | 'client' | 'organisation';
export type PartyListKey = 'parties' | 'prev_parties' | 'lh_parties';
export type CaseListKey = 'draft' | 'filed' | 'clients';

export interface CaseFilingField {
  key: string;
  id: string;
  name: string;
  kind: 'text' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'date' | 'number' | 'email' | 'tel';
  label: string;
  required: boolean;
  value: string;
  checked?: boolean;
  options?: Array<{ value: string; text: string; disabled?: boolean }>;
  placeholder: string;
  maxLength: number | null;
  disabled: boolean;
  readOnly: boolean;
  /** The portal reacts to it at once (cascades): set it on the portal as soon as it changes. */
  live: boolean;
  suggest?: 'act' | 'section';
  error?: string;
}

export interface CaseFilingButton { key: string; text: string; fn: string; kind: 'save' | 'efile' | 'delete' | 'action'; disabled: boolean }
export interface CaseFilingAction { label: string; fn: string; kind: 'open' | 'edit' | 'delete' | 'pdf' | 'status' | 'other'; arg: string | null; cell: number }
export type CaseFilingRow = { group: string } | { cells: string[]; actions?: CaseFilingAction[] };
export interface CaseFilingTable { headers: string[]; rows: CaseFilingRow[] }
/** A table as the portal showed it (no row buttons DifAi presses). */
export interface PortalTableData { headers: string[]; rows: Array<{ group: string } | { cells: string[]; actions?: string[] }> }

export interface CaseFilingTab {
  key: CaseFilingTabKey;
  label: string;
  present: boolean;
  shown: boolean;
  enabled: boolean;
  active: boolean;
  error: boolean;
  paneId: string;
  sections?: Array<{ title: string; fields: CaseFilingField[] }>;
  buttons?: CaseFilingButton[];
  lists?: Array<{ key: PartyListKey; title: string; total: number | null; table: CaseFilingTable }>;
  summary?: Array<{ title: string; tables: PortalTableData[]; text: string }>;
}

export interface CaseFilingWizard {
  screen: CaseFilingScreen;
  pdeNo: string | null;
  caseTitle: string;
  petLabel: string;
  resLabel: string;
  notice: string;
  mode: 'insert' | 'edit' | null;
  efileAllowed: boolean;
  tab: CaseFilingTabKey;
  tabs: CaseFilingTab[];
}

export interface CaseFilingStepResult {
  ok: boolean;
  portal: string[];
  notApplied?: Array<{ key: string; reason: string }>;
  wizard: CaseFilingWizard;
}

export interface CaseFilingList extends CaseFilingTable {
  list: CaseListKey;
  label: string;
  total: number | null;
  error: string | null;
  page: number;
  pages: number;
  info: string;
  search: string;
}

export interface CaseListActionResult {
  kind: CaseFilingAction['kind'];
  ok: boolean;
  portal: string[];
  wizard?: CaseFilingWizard;
  list?: CaseFilingList;
  pdeNo?: string | null;
  text?: string;
  tables?: PortalTableData[];
}

export interface EfileResult { ok: boolean; pdeNo: string; portal: string[]; errorTabs: CaseFilingTabKey[]; wizard: CaseFilingWizard | null }

export type FieldValue = { key: string; value: string | boolean };

const base = (sessionId: string) => `/efiling/live/session/${sessionId}/case-filing`;

const httpStatus = (err: unknown) =>
  (err as { response?: { status?: number }; status?: number })?.response?.status ?? (err as { status?: number })?.status;

/** The portal session is gone (404 expired, 410 signed out): re-check it so the screen goes back to the login. */
function useSessionCheck(sessionId: string | null) {
  const qc = useQueryClient();
  return (err: unknown) => {
    const s = httpStatus(err);
    if (s === 404 || s === 410) void qc.invalidateQueries({ queryKey: ['efiling', 'live', sessionId], exact: true });
  };
}

/** "Still working on your last eFiling step" (409): the portal does one step at a time. */
const retryBusy = (n: number, err: unknown) => n < 4 && httpStatus(err) === 409 && /still working/i.test(String((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? ''));

/** The portal's message for a failed request. */
export function portalError(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: { error?: string; message?: string } } })?.response?.data;
  return data?.error || data?.message || (err as Error)?.message || fallback;
}

export type WizardStep =
  | { op: 'open'; body: { screen?: CaseFilingScreen; pdeNo?: string | null; tab?: CaseFilingTabKey; fresh?: boolean } }
  | { op: 'tab'; body: { screen?: CaseFilingScreen; pdeNo?: string | null; tab: CaseFilingTabKey } }
  | { op: 'fields'; body: { screen?: CaseFilingScreen; pdeNo?: string | null; tab: CaseFilingTabKey; values: FieldValue[] } }
  | { op: 'save'; body: { screen?: CaseFilingScreen; pdeNo?: string | null; tab: CaseFilingTabKey; values: FieldValue[] } }
  | { op: 'button'; body: { screen?: CaseFilingScreen; pdeNo?: string | null; tab: CaseFilingTabKey; key: string; text?: string; values?: FieldValue[]; confirmed?: boolean } }
  | { op: 'party'; body: { pdeNo?: string | null; list: PartyListKey; match: string[]; action: string; confirmed?: boolean } }
  | { op: 'pick'; body: { pdeNo?: string | null; tab: CaseFilingTabKey; key: string; term: string; index: number } };

const STEP_PATH: Record<WizardStep['op'], string> = {
  open: 'wizard/open', tab: 'wizard/tab', fields: 'wizard/fields', save: 'wizard/save', button: 'wizard/button', party: 'wizard/party', pick: 'wizard/suggest/pick',
};

/** One step on New Case Filing / Manage Favourite Clients: what the portal's page shows afterwards. */
export function useCaseFilingStep(sessionId: string | null) {
  const check = useSessionCheck(sessionId);
  return useMutation({
    mutationFn: (s: WizardStep) => api.post<CaseFilingStepResult>(`${base(sessionId!)}/${STEP_PATH[s.op]}`, s.body),
    onError: check,
    retry: retryBusy,
    retryDelay: 1500,
  });
}

/** The portal's suggestions for an act / section box (3+ letters, as on the portal). */
export function useCaseFilingSuggest(sessionId: string | null) {
  return useMutation({
    mutationFn: (v: { pdeNo?: string | null; tab: CaseFilingTabKey; key: string; term: string }) =>
      api.post<{ items: string[] }>(`${base(sessionId!)}/wizard/suggest`, v),
  });
}

/** "eFile Case" - irreversible; only after the advocate confirmed it. */
export function useCaseFilingEfile(sessionId: string | null) {
  const qc = useQueryClient();
  const check = useSessionCheck(sessionId);
  return useMutation({
    mutationFn: (pdeNo: string) => api.post<EfileResult>(`${base(sessionId!)}/efile`, { pdeNo, confirmed: true }),
    onError: check,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['efiling', 'live', sessionId, 'case-filing', 'list'] }); },
  });
}

/** Draft Cases / eFiled Cases / favourite clients, one page as the portal sends it. */
export function useCaseFilingList(sessionId: string | null, list: CaseListKey, o: { page: number; search: string }) {
  const check = useSessionCheck(sessionId);
  return useQuery({
    queryKey: ['efiling', 'live', sessionId, 'case-filing', 'list', list, o.page, o.search],
    queryFn: async () => {
      try {
        return await api.get<CaseFilingList>(`${base(sessionId!)}/lists/${list}`, { page: o.page, ...(o.search ? { search: o.search } : {}) });
      } catch (err) {
        check(err);
        throw err;
      }
    },
    enabled: !!sessionId,
    staleTime: 30 * 1000,
    retry: retryBusy,
    retryDelay: 1500,
  });
}

/** A row's button in one of those lists (Edit, Delete, View, status, a client's cases). */
export function useCaseFilingListAction(sessionId: string | null, list: CaseListKey) {
  const qc = useQueryClient();
  const check = useSessionCheck(sessionId);
  return useMutation({
    mutationFn: (v: { match: string[]; action: string; confirmed?: boolean; page?: number; search?: string }) =>
      api.post<CaseListActionResult>(`${base(sessionId!)}/lists/${list}/action`, v),
    onError: check,
    onSuccess: (r, v) => {
      if (r.list) qc.setQueryData(['efiling', 'live', sessionId, 'case-filing', 'list', list, v.page ?? 1, v.search ?? ''], r.list);
    },
  });
}

/** The case PDF the portal makes (generateCasePDF), as a URL to show. */
export function useCaseFilingPdf(sessionId: string | null) {
  return useMutation({
    mutationFn: async (pdeNo: string) => {
      const blob = await api.postBlob(`${base(sessionId!)}/pdf`, { pdeNo });
      return { name: `${pdeNo}.pdf`, url: URL.createObjectURL(blob) };
    },
  });
}
