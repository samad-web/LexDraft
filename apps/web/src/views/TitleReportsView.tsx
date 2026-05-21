/**
 * Title Reports list view.
 *
 * Surface for /app/title-reports. Header carries the Solo monthly quota chip
 * (mirrors the AI-draft quota UI), filter controls (status + jurisdiction),
 * search box, and the "New title report" CTA. Body is a table of reports.
 * Clicking a row navigates to /app/title-reports/:id (the wizard).
 *
 * The CTA is hidden when the Solo quota is exhausted and the API returns
 * 429 on a creation attempt — but a soft check here keeps the user from
 * even clicking when remaining=0.
 */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon, Skeleton, ErrorState, Select, type SelectOption } from '@lexdraft/ui';
import type {
  TitleReportJurisdiction,
  TitleReportStatus,
  CreateTitleReportDto,
} from '@lexdraft/types';
import {
  useTitleReports,
  useCreateTitleReport,
  STATUS_LABEL,
  JURISDICTION_LABEL,
} from '@/hooks/useTitleReports';
import { useUIStore } from '@/store/ui';

const STATUS_OPTIONS: SelectOption[] = [
  { value: '',          label: 'All statuses' },
  { value: 'draft',     label: STATUS_LABEL.draft },
  { value: 'in_review', label: STATUS_LABEL.in_review },
  { value: 'finalised', label: STATUS_LABEL.finalised },
  { value: 'issued',    label: STATUS_LABEL.issued },
  { value: 'withdrawn', label: STATUS_LABEL.withdrawn },
];

const JURISDICTION_OPTIONS: SelectOption[] = [
  { value: '', label: 'All jurisdictions' },
  ...Object.entries(JURISDICTION_LABEL).map(([value, label]) => ({ value, label })),
];

const STATUS_BADGE_CLASS: Record<TitleReportStatus, string> = {
  draft:     'badge-cream',
  in_review: 'badge-amber',
  finalised: 'badge-cobalt',
  issued:    'badge-sage',
  withdrawn: 'badge-vermillion',
};

const VERDICT_LABEL: Record<string, string> = {
  pending:               'Pending',
  clear:                 'Clear',
  clear_with_conditions: 'Clear (conditions)',
  not_clear:             'Not clear',
};

export function TitleReportsView() {
  const navigate = useNavigate();
  const showToast = useUIStore((s) => s.showToast);

  const [status, setStatus] = useState<TitleReportStatus | ''>('');
  const [jurisdiction, setJurisdiction] = useState<TitleReportJurisdiction | ''>('');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);

  const query = useMemo(() => {
    const out: { status?: TitleReportStatus; jurisdictionState?: TitleReportJurisdiction; q?: string } = {};
    if (status) out.status = status;
    if (jurisdiction) out.jurisdictionState = jurisdiction;
    if (q.trim()) out.q = q.trim();
    return out;
  }, [status, jurisdiction, q]);

  const list = useTitleReports(query);
  const create = useCreateTitleReport();

  const items = list.data?.items ?? [];
  // Title-report creation now consumes one slot of the shared AI-generation
  // cap (plan_ai_caps) — the same cap drafting uses. The button stays
  // enabled here; if the user is over cap the API returns 429
  // ai_quota_exceeded and the axios interceptor surfaces CapExceededModal.

  return (
    <div className="tr-view">
      <header className="tr-header">
        <div className="tr-header__lead">
          <h1 className="tr-h1">Title Reports</h1>
          <p className="tr-sub">
            Indian title investigation reports (TIR) for banks, NBFCs, and buyers.
            AI-assisted defect analysis and marketability opinion.
          </p>
        </div>
        <div className="tr-header__actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={creating}
            onClick={() => setCreating(true)}
          >
            <Icon name="plus" /> New title report
          </button>
        </div>
      </header>

      <div className="tr-filters">
        <div className="tr-filter">
          <label className="tr-filter__label">Status</label>
          <Select
            value={status}
            onChange={(v) => setStatus((v as TitleReportStatus) || '')}
            options={STATUS_OPTIONS}
          />
        </div>
        <div className="tr-filter">
          <label className="tr-filter__label">Jurisdiction</label>
          <Select
            value={jurisdiction}
            onChange={(v) => setJurisdiction((v as TitleReportJurisdiction) || '')}
            options={JURISDICTION_OPTIONS}
          />
        </div>
        <div className="tr-filter tr-filter--grow">
          <label className="tr-filter__label">Search</label>
          <input
            className="input"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Applicant, report number, bank…"
          />
        </div>
      </div>

      {list.isLoading ? (
        <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
          <Skeleton height={56} />
          <Skeleton height={56} />
          <Skeleton height={56} />
        </div>
      ) : list.isError ? (
        <ErrorState
          title="Couldn't load title reports"
          description={list.error instanceof Error ? list.error.message : 'Unknown error'}
          onRetry={() => { void list.refetch(); }}
        />
      ) : items.length === 0 ? (
        <EmptyState onCreate={() => setCreating(true)} disabled={false} />
      ) : (
        <div className="tr-table">
          <div className="tr-table__head">
            <div className="tr-col tr-col--num">Report</div>
            <div className="tr-col tr-col--applicant">Applicant / Bank</div>
            <div className="tr-col">Jurisdiction</div>
            <div className="tr-col">Status</div>
            <div className="tr-col">Opinion</div>
            <div className="tr-col tr-col--date">Updated</div>
          </div>
          <ul className="tr-table__body" role="list">
            {items.map((it) => (
              <li
                key={it.id}
                className="tr-row"
                role="link"
                tabIndex={0}
                onClick={() => navigate(`/app/title-reports/${it.id}`)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    navigate(`/app/title-reports/${it.id}`);
                  }
                }}
              >
                <div className="tr-col tr-col--num">
                  <strong>{it.reportNumber}</strong>
                </div>
                <div className="tr-col tr-col--applicant">
                  <div className="tr-applicant">{it.applicantName}</div>
                  {it.bankName ? <div className="tr-bank">{it.bankName}</div> : null}
                </div>
                <div className="tr-col">{JURISDICTION_LABEL[it.jurisdictionState] ?? it.jurisdictionState}</div>
                <div className="tr-col">
                  <span className={`badge ${STATUS_BADGE_CLASS[it.status]}`}>{STATUS_LABEL[it.status]}</span>
                </div>
                <div className="tr-col">{VERDICT_LABEL[it.opinionVerdict] ?? it.opinionVerdict}</div>
                <div className="tr-col tr-col--date">{formatRelative(it.updatedAt)}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {creating && (
        <NewTitleReportModal
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            navigate(`/app/title-reports/${id}`);
          }}
          onError={(msg) => showToast({ type: 'vermillion', text: msg })}
          submit={(body) => create.mutateAsync(body)}
          pending={create.isPending}
        />
      )}
    </div>
  );
}

function EmptyState({ onCreate, disabled }: { onCreate: () => void; disabled: boolean }) {
  return (
    <div className="tr-empty">
      <div className="tr-empty__icon"><Icon name="shield" /></div>
      <h2 className="tr-empty__title">No title reports yet</h2>
      <p className="tr-empty__body">
        Title Investigation Reports (TIR) certify marketability of title to immovable property —
        the deliverable banks and NBFCs need before disbursing a loan. Start one to record the
        chain of title, encumbrances, and statutory approvals; the AI flags defects and synthesises
        the marketability opinion.
      </p>
      <button type="button" className="btn btn-primary" onClick={onCreate} disabled={disabled}>
        <Icon name="plus" /> New title report
      </button>
    </div>
  );
}

interface NewModalProps {
  onClose: () => void;
  onCreated: (id: string) => void;
  onError: (msg: string) => void;
  submit: (body: CreateTitleReportDto) => Promise<{ id: string }>;
  pending: boolean;
}

function NewTitleReportModal({ onClose, onCreated, onError, submit, pending }: NewModalProps) {
  const [applicantName, setApplicantName] = useState('');
  const [applicantType, setApplicantType] = useState<'buyer' | 'owner' | 'borrower'>('buyer');
  const [jurisdiction, setJurisdiction] = useState<TitleReportJurisdiction>('TN');
  const [bankName, setBankName] = useState('');
  const [bankBranch, setBankBranch] = useState('');

  const onSubmit = async () => {
    if (!applicantName.trim()) {
      onError('Applicant name is required');
      return;
    }
    try {
      const body: CreateTitleReportDto = {
        jurisdictionState: jurisdiction,
        applicantName: applicantName.trim(),
        applicantType,
      };
      if (bankName.trim()) body.bankName = bankName.trim();
      if (bankBranch.trim()) body.bankBranch = bankBranch.trim();
      const created = await submit(body);
      onCreated(created.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not create title report';
      onError(msg);
    }
  };

  return (
    <div className="modal-overlay is-visible" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal__head">
          <h2 className="modal__title">New title report</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>
        <div className="modal__body" style={{ display: 'grid', gap: 'var(--space-3)' }}>
          <Field label="Applicant name">
            <input
              className="input"
              value={applicantName}
              onChange={(e) => setApplicantName(e.target.value)}
              placeholder="e.g. Ramesh Iyer"
              autoFocus
            />
          </Field>
          <Field label="Applicant type">
            <Select
              value={applicantType}
              onChange={(v) => setApplicantType((v as 'buyer' | 'owner' | 'borrower') || 'buyer')}
              options={[
                { value: 'buyer',    label: 'Buyer (applying for a loan)' },
                { value: 'owner',    label: 'Current owner' },
                { value: 'borrower', label: 'Borrower (refinance / mortgage)' },
              ]}
            />
          </Field>
          <Field label="Jurisdiction">
            <Select
              value={jurisdiction}
              onChange={(v) => setJurisdiction((v as TitleReportJurisdiction) || 'TN')}
              options={Object.entries(JURISDICTION_LABEL).map(([value, label]) => ({ value, label }))}
            />
          </Field>
          <Field label="Bank / NBFC (optional)">
            <input
              className="input"
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              placeholder="e.g. State Bank of India"
            />
          </Field>
          <Field label="Branch (optional)">
            <input
              className="input"
              value={bankBranch}
              onChange={(e) => setBankBranch(e.target.value)}
              placeholder="e.g. T. Nagar"
            />
          </Field>
        </div>
        <footer className="modal__foot">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={pending}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={onSubmit} disabled={pending}>
            {pending ? 'Creating…' : 'Create'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
    </label>
  );
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'now';
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
