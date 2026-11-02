import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

// =============================================================================
// The portal's ePayments menu over the advocate's own eFiling session:
// Payment (form -> OTP -> gateway hand-off), transactions (GRN / bank CIN /
// verification / challan) and Court Fee Wallet. Shapes mirror
// apps/api/src/services/efiling-portal-epay.service.ts.
// =============================================================================

export interface EpayOption { value: string; text: string; disabled?: boolean }
export interface EpayChoice { value: string; label: string; id: string; checked: boolean; disabled: boolean }
export interface EpayField {
  key: string;
  id: string;
  name: string;
  tag: 'input' | 'select' | 'textarea' | 'radio';
  type: string;
  label: string;
  value: string;
  required: boolean;
  disabled: boolean;
  readOnly: boolean;
  placeholder: string;
  maxLength: number | null;
  options?: EpayOption[];
  choices?: EpayChoice[];
}
export type EpayButtonKind = 'otp' | 'verify' | 'transactions' | 'other';
export interface EpayButton { label: string; id: string; kind: EpayButtonKind; disabled: boolean }
export interface EpayGateway { method: 'GET' | 'POST'; url: string; target: string; fields: Array<{ name: string; value: string }> }
export interface EpayFormView {
  title: string;
  fields: EpayField[];
  caseDetails: string;
  amountWords: Record<string, string>;
  amountError: string;
  /** title / text: the portal's Terms and Conditions box above "I agree", when shown. */
  terms: { label: string; checked: boolean; title?: string; text?: string } | null;
  otp: { shown: boolean; label: string; message: string; buttons: EpayButton[] };
  buttons: EpayButton[];
  redirect: { text: string; gateway: EpayGateway | null } | null;
  messages: string[];
}
export interface EpayProceedResult { form: EpayFormView; gateway: EpayGateway | null; messages: string[] }

export interface EpayTxnAction { label: string; fn: string }
export type EpayTxnRow = { group: string } | { ref: string; cells: string[]; actions: EpayTxnAction[] };
export interface EpayTxnTable { headers: string[]; rows: EpayTxnRow[] }
export interface EpayTransactions { tables: EpayTxnTable[]; text: string; messages: string[]; /** The portal window's title. */ title?: string }
export interface EpayOpened { url: string; file: { name: string; contentType: string; base64: string } | null }
export interface EpayTxnActionResult { transactions: EpayTransactions; opened: EpayOpened[]; messages: string[] }

export interface WalletCheck { id: string; checked: boolean; disabled: boolean }
export type WalletRow = { group: string; check?: WalletCheck } | { cells: string[]; check?: WalletCheck };
export interface WalletTable { headers: string[]; rows: WalletRow[] }
export interface EpayPayFees {
  tables: WalletTable[];
  balances: Array<{ est: string; label: string; balance: string; subTotal: string }>;
  pages: Array<{ label: string; page: number; current: boolean }>;
  info: string;
  search: string;
  payButton: { label: string; disabled: boolean } | null;
  refreshButton: string | null;
  text: string;
}
export interface EpayWalletView {
  page: { title: string; headings: string[]; tables: Array<{ headers: string[]; rows: Array<{ group: string } | { cells: string[]; actions?: string[] }> }>; text: string } | null;
  payFees: EpayPayFees | null;
  messages: string[];
}
export interface EpayWalletPayResult { paid: boolean; messages: string[]; wallet: EpayWalletView }

const base = (sessionId: string) => `/efiling/live/session/${sessionId}/epay`;

const httpStatus = (err: unknown) =>
  (err as { response?: { status?: number }; status?: number })?.response?.status ?? (err as { status?: number })?.status;

/** The portal ended the session (410) or it expired (404): back to the login. */
function useSessionGone(sessionId: string) {
  const qc = useQueryClient();
  return (err: unknown) => {
    const s = httpStatus(err);
    if (s === 404 || s === 410) void qc.invalidateQueries({ queryKey: ['efiling', 'live', sessionId], exact: true });
  };
}

// "Still working on your last eFiling step" (409 while another step runs): retry shortly.
const retryBusy = (n: number, err: unknown) => n < 4 && httpStatus(err) === 409 && /still working/i.test(String((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? ''));

/** Open ePayments > Payment on the portal (fresh) and read its form. */
export function useOpenEpayForm(sessionId: string) {
  const gone = useSessionGone(sessionId);
  return useMutation({
    mutationFn: (fresh: boolean) => api.post<EpayFormView>(`${base(sessionId)}/form/open`, { fresh }),
    retry: retryBusy,
    retryDelay: 1500,
    onError: gone,
  });
}

/** Set controls on the portal's form, in order; returns the form as it now stands. */
export function useSetEpayFields(sessionId: string) {
  const gone = useSessionGone(sessionId);
  return useMutation({
    mutationFn: (fields: Array<{ key: string; value: string }>) => api.post<EpayFormView>(`${base(sessionId)}/form/fields`, { fields }),
    retry: retryBusy,
    retryDelay: 1500,
    onError: gone,
  });
}

/** "I agree" + the portal's Send OTP. Nothing is paid. */
export function useSendEpayOtp(sessionId: string) {
  const gone = useSessionGone(sessionId);
  return useMutation({
    mutationFn: () => api.post<EpayFormView>(`${base(sessionId)}/form/otp`, { agreed: true }),
    onError: gone,
  });
}

/** Verify the OTP: the portal prepares the payment and hands over its gateway. Needs the advocate's confirmation. */
export function useProceedToGateway(sessionId: string) {
  const qc = useQueryClient();
  const gone = useSessionGone(sessionId);
  return useMutation({
    mutationFn: (otp: string) => api.post<EpayProceedResult>(`${base(sessionId)}/form/proceed`, { otp, confirmed: true }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['efiling', 'live', sessionId, 'epay', 'transactions'] }); },
    onError: gone,
  });
}

/** The portal's transaction list (viewDetails), read when opened. */
export function useEpayTransactions(sessionId: string, enabled: boolean) {
  const gone = useSessionGone(sessionId);
  return useQuery({
    queryKey: ['efiling', 'live', sessionId, 'epay', 'transactions'],
    queryFn: async () => {
      try { return await api.get<EpayTransactions>(`${base(sessionId)}/transactions`); } catch (err) { gone(err); throw err; }
    },
    enabled,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
    retry: retryBusy,
    retryDelay: 1500,
  });
}

/** Press a row's own link: Get GRN, Get Bank Details, Verify, View Challan (status reads). */
export function useEpayTransactionAction(sessionId: string) {
  const qc = useQueryClient();
  const gone = useSessionGone(sessionId);
  return useMutation({
    mutationFn: (v: { ref: string; fn: string }) => api.post<EpayTxnActionResult>(`${base(sessionId)}/transactions/action`, v),
    onSuccess: (r) => { qc.setQueryData(['efiling', 'live', sessionId, 'epay', 'transactions'], r.transactions); },
    onError: gone,
  });
}

/** Court Fee Wallet: the menu page as shown, and the wallet's Pay Fees list. */
export function useEpayWallet(sessionId: string, o: { page: number; search: string; refresh: number }) {
  const gone = useSessionGone(sessionId);
  return useQuery({
    queryKey: ['efiling', 'live', sessionId, 'epay', 'wallet', o.page, o.search, o.refresh],
    queryFn: async () => {
      try {
        return await api.get<EpayWalletView>(`${base(sessionId)}/wallet`, {
          page: o.page,
          ...(o.search ? { search: o.search } : {}),
          ...(o.refresh ? { refresh: '1' } : {}),
        });
      } catch (err) { gone(err); throw err; }
    },
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
    retry: retryBusy,
    retryDelay: 1500,
  });
}

/** Pay the ticked fees from the wallet. Needs the advocate's confirmation. */
export function usePayFromWallet(sessionId: string) {
  const qc = useQueryClient();
  const gone = useSessionGone(sessionId);
  return useMutation({
    mutationFn: (checks: string[]) => api.post<EpayWalletPayResult>(`${base(sessionId)}/wallet/pay`, { checks, confirmed: true }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['efiling', 'live', sessionId, 'epay', 'wallet'] }); },
    onError: gone,
  });
}

/**
 * Open the gateway the portal produced in the advocate's own browser (a new
 * tab), with exactly the method, address and fields the portal gave it.
 */
export function openGateway(g: EpayGateway): void {
  if (g.method === 'GET' && !g.fields.length) {
    window.open(g.url, '_blank', 'noopener');
    return;
  }
  const form = document.createElement('form');
  form.method = g.method.toLowerCase();
  form.action = g.url;
  form.target = '_blank';
  form.style.display = 'none';
  for (const f of g.fields) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = f.name;
    input.value = f.value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
  form.remove();
}

/** A file the portal showed (challan / receipt), as a local URL to open. */
export function openedFileUrl(f: NonNullable<EpayOpened['file']>): string {
  const bin = atob(f.base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: f.contentType }));
}
