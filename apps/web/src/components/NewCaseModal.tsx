import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { DatePicker, Select } from '@lexdraft/ui';
import type { Case, CaseStage, CaseStatus, CaseType } from '@lexdraft/types';
import { useCreateCase } from '@/hooks/useCases';
import { useUIStore } from '@/store/ui';
import { useConflictsCheck, type ConflictHit, type ConflictsResult } from '@/hooks/useConflicts';

interface NewCaseModalProps {
  open: boolean;
  onClose: () => void;
  /** Pre-fill the type field from the active list filter (e.g. "Civil"). */
  defaultType?: CaseType | string;
}

const TYPES: CaseType[] = ['Civil', 'Criminal', 'Commercial', 'Property', 'Banking', 'Family', 'Tax', 'Other'];
const STAGES: CaseStage[] = ['Filing', 'Summons', 'WS', 'Evidence', 'Arguments', 'Judgment', 'Appeal', 'Other'];
const STATUSES: CaseStatus[] = ['Active', 'Pending', 'Closed', 'Archived'];

function placeholderCnr(): string {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `TEMP-${today}-${rand}`;
}

function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Pull the opposing party out of the matter title. Indian filings overwhelmingly
 * use "X v. Y" / "X vs Y" / "X versus Y" - the right-hand-side is the opposing
 * party. We split on the first separator and trim. If no separator is found we
 * return undefined; the conflict-check still runs against the client name.
 */
function deriveOpposingFromTitle(title: string): string | undefined {
  const t = title.trim();
  if (!t) return undefined;
  const sep = /\s+(?:v\.?|vs\.?|versus)\s+/i;
  const parts = t.split(sep);
  if (parts.length < 2) return undefined;
  const rhs = parts.slice(1).join(' ').trim();
  return rhs.length > 0 ? rhs : undefined;
}

export function NewCaseModal({ open, onClose, defaultType }: NewCaseModalProps) {
  const navigate = useNavigate();
  const create = useCreateCase();
  const showToast = useUIStore((s) => s.showToast);
  const conflicts = useConflictsCheck();

  const [title, setTitle] = useState('');
  const [client, setClient] = useState('');
  const [court, setCourt] = useState('');
  const [cnr, setCnr] = useState('');
  const [type, setType] = useState<CaseType | string>(defaultType ?? 'Civil');
  const [stage, setStage] = useState<CaseStage | string>('Filing');
  const [status, setStatus] = useState<CaseStatus>('Active');
  const [next, setNext] = useState<string>(todayPlus(14));

  // Conflict-check state. `lastResult` survives between debounce refires so
  // the panel doesn't flicker to empty during typing.
  const [conflictResult, setConflictResult] = useState<ConflictsResult | null>(null);
  const [conflictDismissed, setConflictDismissed] = useState(false);
  const [overrideAck, setOverrideAck] = useState(false);

  const opposingDerived = useMemo(() => deriveOpposingFromTitle(title), [title]);

  // Debounce 400ms after the user stops typing in client/title. We send both
  // the typed client (party we represent) and the derived opposing party.
  useEffect(() => {
    if (!open) return undefined;
    const c = client.trim();
    const o = (opposingDerived ?? '').trim();
    if (!c && !o) {
      setConflictResult(null);
      setOverrideAck(false);
      return undefined;
    }
    const handle = window.setTimeout(() => {
      conflicts.mutate(
        {
          partyNames: c ? [c] : [],
          opposingNames: o ? [o] : [],
        },
        {
          onSuccess: (r) => {
            setConflictResult(r);
            // Re-typing resets the override gate so the user can't bypass a
            // fresh red flag by having acked an older one.
            setOverrideAck(false);
            setConflictDismissed(false);
          },
          // Silent failure: don't blow up the form if the feature is gated
          // off or the API hiccups - the lawyer can still file the matter.
          onError: () => setConflictResult(null),
        },
      );
    }, 400);
    return () => window.clearTimeout(handle);
    // We intentionally exclude `conflicts` to avoid re-firing on mutation
    // identity changes; client + opposing changes are what we care about.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, client, opposingDerived]);

  if (!open) return null;

  const severity = conflictResult?.severity ?? 'green';
  const hasRed = severity === 'red';
  const submitBlocked = hasRed && !overrideAck;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitBlocked) return;
    const payload: Omit<Case, 'id'> = {
      cnr: cnr.trim() || placeholderCnr(),
      title: title.trim(),
      client: client.trim(),
      court: court.trim(),
      type,
      stage,
      status,
      next,
    };
    try {
      const created = await create.mutateAsync(payload);
      showToast({ type: 'sage', text: `Case "${created.title}" created` });
      onClose();
      navigate(`/app/cases/${created.id}`);
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
        ?? (err as Error).message
        ?? 'Failed to create case';
      showToast({ type: 'vermillion', text: msg });
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-case-title"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(10,10,10,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
        padding: 16,
      }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        style={{
          background: 'var(--bg-base)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)',
          padding: 28,
          width: 'min(640px, 100%)',
          maxHeight: '90vh',
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div>
          <div className="eyebrow" style={{ marginBottom: 4 }}>New matter</div>
          <h3 id="new-case-title" className="display" style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em' }}>
            Open a case file
          </h3>
          <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
            Required fields marked with *. Leave CNR blank to auto-generate a placeholder you can update later.
          </p>
        </div>

        <Field label="MATTER TITLE *" wide>
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Mehta v. Skyline Constructions"
            required
            autoFocus
          />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Field label="CLIENT *">
            <input
              className="input"
              value={client}
              onChange={(e) => setClient(e.target.value)}
              placeholder="Primary client (party we represent)"
              required
            />
          </Field>
          <Field label="COURT *">
            <input
              className="input"
              value={court}
              onChange={(e) => setCourt(e.target.value)}
              placeholder="e.g. High Court of Karnataka"
              required
            />
          </Field>
          <Field label="CNR (optional)">
            <input
              className="input mono"
              value={cnr}
              onChange={(e) => setCnr(e.target.value)}
              placeholder={placeholderCnr()}
            />
          </Field>
          <Field label="NEXT HEARING *">
            <DatePicker value={next} onChange={setNext} />
          </Field>
          <Field label="TYPE *">
            <Select
              value={String(type)}
              onChange={(v) => setType(v as CaseType)}
              options={TYPES.map((t) => ({ value: t, label: t }))}
            />
          </Field>
          <Field label="STAGE *">
            <Select
              value={String(stage)}
              onChange={(v) => setStage(v as CaseStage)}
              options={STAGES.map((s) => ({ value: s, label: s }))}
            />
          </Field>
          <Field label="STATUS *">
            <Select
              value={status}
              onChange={(v) => setStatus(v as CaseStatus)}
              options={STATUSES.map((s) => ({ value: s, label: s }))}
            />
          </Field>
        </div>

        <ConflictPanel
          result={conflictResult}
          loading={conflicts.isPending}
          dismissed={conflictDismissed}
          onDismiss={() => setConflictDismissed(true)}
          overrideAck={overrideAck}
          onOverrideChange={setOverrideAck}
        />

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={create.isPending || submitBlocked}
            title={submitBlocked ? 'Confirm conflict review to proceed' : undefined}
          >
            {create.isPending ? 'Opening case…' : 'Open case file'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, gridColumn: wide ? '1 / -1' : undefined }}>
      <span className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{label}</span>
      {children}
    </label>
  );
}

interface ConflictPanelProps {
  result: ConflictsResult | null;
  loading: boolean;
  dismissed: boolean;
  onDismiss: () => void;
  overrideAck: boolean;
  onOverrideChange: (v: boolean) => void;
}

/**
 * Surfaces conflict-check output above the submit button. Green is subtle
 * and dismissible - we don't want to congratulate the lawyer on every new
 * matter. Amber + red are sticky.
 */
function ConflictPanel({ result, loading, dismissed, onDismiss, overrideAck, onOverrideChange }: ConflictPanelProps) {
  if (!result && loading) {
    return (
      <div
        role="status"
        aria-live="polite"
        style={{
          fontSize: 12,
          color: 'var(--text-tertiary)',
          padding: '8px 10px',
          border: '1px dashed var(--border-default)',
          borderRadius: 'var(--radius-md)',
        }}
      >
        Scanning conflicts…
      </div>
    );
  }
  if (!result) return null;

  if (result.severity === 'green') {
    if (dismissed) return null;
    return (
      <div
        role="status"
        aria-live="polite"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12,
          fontSize: 12,
          color: 'var(--text-tertiary)',
          padding: '8px 10px',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-md)',
        }}
      >
        <span>No conflicts found across firm matters.</span>
        <button
          type="button"
          onClick={onDismiss}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-tertiary)', fontSize: 12, padding: 0,
          }}
          aria-label="Dismiss conflict notice"
        >
          Dismiss
        </button>
      </div>
    );
  }

  const isRed = result.severity === 'red';
  const accent = isRed ? 'var(--danger)' : 'var(--warning)';
  const heading = isRed
    ? 'Existing client / direct conflict detected'
    : 'Potential conflict - name appears in a past matter';

  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        border: `1px solid ${accent}`,
        borderLeft: `4px solid ${accent}`,
        borderRadius: 'var(--radius-md)',
        padding: '12px 14px',
        background: 'var(--bg-base)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: accent }}>{heading}</div>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {result.hits.slice(0, 6).map((h, i) => (
          <li key={hitKey(h, i)}>
            <HitLine hit={h} />
          </li>
        ))}
        {result.hits.length > 6 ? (
          <li style={{ color: 'var(--text-tertiary)' }}>
            + {result.hits.length - 6} more match{result.hits.length - 6 === 1 ? '' : 'es'}…
          </li>
        ) : null}
      </ul>
      {isRed ? (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
          <input
            type="checkbox"
            checked={overrideAck}
            onChange={(e) => onOverrideChange(e.target.checked)}
          />
          I have reviewed and proceed anyway
        </label>
      ) : null}
    </div>
  );
}

function hitKey(h: ConflictHit, i: number): string {
  return `${h.classification}-${h.side}-${h.matchedName}-${h.matterId ?? ''}-${h.clientId ?? ''}-${i}`;
}

function HitLine({ hit }: { hit: ConflictHit }) {
  const where = hit.matterTitle
    ? `matter “${hit.matterTitle}”`
    : hit.clientName
      ? `client “${hit.clientName}”`
      : 'firm records';
  const label = (() => {
    switch (hit.classification) {
      case 'existing_client':
        return `“${hit.matchedName}” is an existing client (${where})`;
      case 'same_advocate_other_side':
        return `Firm has previously acted for “${hit.matchedName}” in ${where}`;
      case 'past_matter_party':
      default:
        return `“${hit.matchedName}” appears in ${where}`;
    }
  })();
  return <span>{label}</span>;
}
