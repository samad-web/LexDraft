/**
 * Two-step confirmation for account deletion under DPDP §11.
 *
 *   1. Pick a retention window (default 30 days; max 365 server-side).
 *   2. Type your own email address verbatim to arm the "Confirm deletion"
 *      button - defends against muscle-memory clicks on a destructive flow.
 *
 * The submission itself is handled by the parent (it owns the mutation), this
 * modal just collects intent and hands back `{ retentionDays }`.
 */

import { useEffect, useState } from 'react';
import { Modal } from './Modal';

interface DeletionConfirmModalProps {
  open: boolean;
  onClose: () => void;
  /** The user's verified email - typed-confirmation must match exactly. */
  userEmail: string;
  /** Called when the user types their email correctly and clicks confirm. */
  onConfirm: (input: { retentionDays: number }) => void;
  /** True while the parent mutation is in flight - disables the form. */
  submitting?: boolean;
  /** Optional inline error string surfaced from the parent's mutation. */
  error?: string | null;
}

const RETENTION_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 7,  label: '7 days' },
  { value: 30, label: '30 days (default)' },
  { value: 60, label: '60 days' },
];

export function DeletionConfirmModal({
  open,
  onClose,
  userEmail,
  onConfirm,
  submitting,
  error,
}: DeletionConfirmModalProps) {
  const [retentionDays, setRetentionDays] = useState<number>(30);
  const [typedEmail, setTypedEmail] = useState('');

  // Wipe state every time the dialog re-opens so a previous attempt's email
  // string can't pre-arm the confirm button on the next open.
  useEffect(() => {
    if (open) {
      setRetentionDays(30);
      setTypedEmail('');
    }
  }, [open]);

  const armed = typedEmail === userEmail;

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="DPDP §11 · Right to erasure"
      title="Delete my account permanently"
      description="Your data will be soft-deleted immediately and purged after the retention window you pick. You can cancel any time before purge."
      width={520}
      onSubmit={(e) => {
        e.preventDefault();
        if (!armed || submitting) return;
        onConfirm({ retentionDays });
      }}
      footer={
        <>
          <button
            type="button"
            className="btn"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn"
            disabled={!armed || submitting}
            style={
              armed
                ? { borderColor: 'var(--danger)', color: 'var(--danger)' }
                : undefined
            }
          >
            {submitting ? 'Scheduling…' : 'Confirm deletion'}
          </button>
        </>
      }
    >
      <fieldset
        style={{
          border: 'none',
          padding: 0,
          margin: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <legend
          className="mono"
          style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 4 }}
        >
          RETENTION WINDOW
        </legend>
        {RETENTION_OPTIONS.map((opt) => (
          <label
            key={opt.value}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 10px',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
              background:
                retentionDays === opt.value ? 'var(--bg-surface-2)' : 'transparent',
            }}
          >
            <input
              type="radio"
              name="retentionDays"
              value={opt.value}
              checked={retentionDays === opt.value}
              onChange={() => setRetentionDays(opt.value)}
              disabled={submitting}
            />
            <span className="body-md">{opt.label}</span>
          </label>
        ))}
      </fieldset>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
          TYPE YOUR EMAIL TO CONFIRM
        </span>
        <input
          type="text"
          autoComplete="off"
          spellCheck={false}
          className="input"
          placeholder={userEmail}
          value={typedEmail}
          onChange={(e) => setTypedEmail(e.target.value)}
          disabled={submitting}
          style={{
            padding: '10px 12px',
            border: `1px solid ${armed ? 'var(--success)' : 'var(--border-default)'}`,
            borderRadius: 'var(--radius-md)',
            fontFamily: 'var(--font-mono)',
            fontSize: 13,
            background: 'var(--bg-surface)',
            color: 'var(--text-primary)',
          }}
        />
        <span className="muted body-xs">
          Must match <code>{userEmail}</code> exactly.
        </span>
      </label>

      {error && (
        <div
          className="body-sm"
          style={{
            color: 'var(--danger)',
            background: 'var(--danger-bg)',
            border: '1px solid var(--danger)',
            borderRadius: 'var(--radius-md)',
            padding: '8px 10px',
          }}
        >
          {error}
        </div>
      )}
    </Modal>
  );
}
