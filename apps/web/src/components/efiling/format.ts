import type { FilingKind, FilingStatus, TrackingStatus } from '@/hooks/useEfiling';

export function errMsg(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { error?: string } }; message?: string };
  return e?.response?.data?.error ?? e?.message ?? fallback;
}

export const STATUS_LABEL: Record<FilingStatus, string> = {
  draft: 'Draft',
  ready: 'Ready to file',
  efiled: 'On the portal',
  submitted: 'Final submitted',
  objected: 'Objections raised',
  refiled: 'Re-filed',
  accepted: 'Accepted',
  registered: 'Registered',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
};

export const STATUS_TONE: Record<FilingStatus, string> = {
  draft: 'badge',
  ready: 'badge badge-cobalt',
  efiled: 'badge badge-amber',
  submitted: 'badge badge-cobalt',
  objected: 'badge badge-amber',
  refiled: 'badge badge-cobalt',
  accepted: 'badge badge-sage',
  registered: 'badge badge-sage',
  rejected: 'badge badge-vermillion',
  withdrawn: 'badge',
};

export const KIND_LABEL: Record<FilingKind, string> = {
  new_case: 'New case',
  ia: 'Interlocutory application',
  caveat: 'Caveat',
  misc_document: 'Documents in existing case',
  deficit_court_fee: 'Deficit court fee',
};

export const TRACKING_LABEL: Record<TrackingStatus, string> = {
  idle: 'Waiting for the next eCourts check',
  searching: 'eCourts not responding. Will retry.',
  matched: 'Connected to eCourts',
  ambiguous: 'Several matches on eCourts. Pick the right one.',
  not_found: 'Not registered on eCourts yet',
  error: 'Needs details before DifAi can look it up',
};

export function formatBytes(n: number | null | undefined): string {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function formatInr(n: number): string {
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

/** '' -> null, otherwise trimmed. For optional text inputs. */
export const orNull = (v: string): string | null => (v.trim() === '' ? null : v.trim());
export const numOrNull = (v: string): number | null => (v.trim() === '' || Number.isNaN(Number(v)) ? null : Number(v));
