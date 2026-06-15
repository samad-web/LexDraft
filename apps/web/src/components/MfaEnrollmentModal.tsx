import { useEffect, useState, type FormEvent } from 'react';
import { Modal } from './Modal';
import { useMfaEnrollStart, useMfaEnrollConfirm } from '@/hooks/useMfa';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import { useUIStore } from '@/store/ui';
import type {
  MfaEnrollStartResponse,
  MfaEnrollConfirmResponse,
} from '@/lib/auth-types';

/**
 * Three-step TOTP enrolment.
 *   1. SCAN     - display the server-rendered QR + manual base32 secret
 *   2. CONFIRM  - 6-digit code → POST /enroll/confirm
 *   3. BACKUP   - show the 8 one-time backup codes, force the user to ack
 *
 * State is held locally - once the dialog closes, the secret/backup codes are
 * gone for good (the server only retains hashed versions). This is the only
 * place in the product where backup codes are surfaced.
 */
type Step = 'scan' | 'confirm' | 'backup';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function MfaEnrollmentModal({ open, onClose }: Props) {
  const enrollStart = useMfaEnrollStart();
  const enrollConfirm = useMfaEnrollConfirm();
  const showToast = useUIStore((s) => s.showToast);

  const [step, setStep] = useState<Step>('scan');
  const [code, setCode] = useState('');
  const [startData, setStartData] = useState<MfaEnrollStartResponse | null>(null);
  const [backup, setBackup] = useState<MfaEnrollConfirmResponse | null>(null);
  const [acked, setAcked] = useState(false);

  // Kick off the server-side challenge on open. We only do this once per
  // mount cycle; if the user closes and reopens the modal we'll mint a fresh
  // challenge - the previous one is rendered useless server-side.
  useEffect(() => {
    if (!open) return;
    setStep('scan');
    setCode('');
    setStartData(null);
    setBackup(null);
    setAcked(false);
    enrollStart.mutate(undefined, {
      onSuccess: (data) => setStartData(data),
      onError: () => {
        showToast({ type: 'vermillion', text: 'Could not start MFA enrolment' });
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submitConfirm = (e: FormEvent) => {
    e.preventDefault();
    if (!startData) return;
    enrollConfirm.mutate(
      { challengeId: startData.challengeId, code: code.trim() },
      {
        onSuccess: (data) => {
          setBackup(data);
          setStep('backup');
          showToast({ type: 'sage', text: 'Two-factor authentication enabled' });
        },
      },
    );
  };

  const handleClose = () => {
    // Don't let users dismiss the backup-codes step without acknowledging -
    // they'll be locked out if they lose their phone otherwise. The "I have
    // saved my codes" tick is the only path off step 3.
    if (step === 'backup' && !acked) return;
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={
        step === 'scan'
          ? 'Set up two-factor authentication'
          : step === 'confirm'
            ? 'Enter the 6-digit code'
            : 'Save your backup codes'
      }
      eyebrow={`STEP ${step === 'scan' ? '1' : step === 'confirm' ? '2' : '3'} OF 3`}
      description={
        step === 'scan'
          ? 'Open your authenticator app (Authy, 1Password, Google Authenticator) and scan the QR below.'
          : step === 'confirm'
            ? 'Type the code your authenticator app shows right now to finish enrolment.'
            : 'These backup codes let you sign in if you lose access to your authenticator. They are shown ONCE - save them somewhere safe.'
      }
      width={520}
    >
      {step === 'scan' && (
        <ScanStep
          loading={enrollStart.isPending}
          data={startData}
          onContinue={() => setStep('confirm')}
          onCancel={onClose}
        />
      )}

      {step === 'confirm' && startData && (
        <ConfirmStep
          code={code}
          setCode={setCode}
          isPending={enrollConfirm.isPending}
          error={(enrollConfirm.error as Error | null)?.message ?? null}
          onSubmit={submitConfirm}
          onBack={() => setStep('scan')}
        />
      )}

      {step === 'backup' && backup && (
        <BackupStep
          codes={backup.backupCodes}
          acked={acked}
          setAcked={setAcked}
          onDone={onClose}
        />
      )}
    </Modal>
  );
}

// ---- Step 1: Scan ---------------------------------------------------------

function ScanStep({
  loading,
  data,
  onContinue,
  onCancel,
}: {
  loading: boolean;
  data: MfaEnrollStartResponse | null;
  onContinue: () => void;
  onCancel: () => void;
}) {
  const { copied, copy } = useCopyToClipboard();

  if (loading || !data) {
    return (
      <div
        style={{
          padding: 32,
          textAlign: 'center',
          color: 'var(--text-tertiary)',
          fontSize: 13,
        }}
      >
        Preparing your secret…
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          padding: 16,
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-lg)',
        }}
      >
        <img
          src={data.qrCodeDataUrl}
          alt="TOTP QR code"
          width={192}
          height={192}
          style={{ display: 'block', imageRendering: 'pixelated' }}
        />
      </div>
      <div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 6 }}>
          OR ENTER THE KEY MANUALLY
        </div>
        <button
          type="button"
          className="mono"
          onClick={() => void copy(data.secret)}
          title="Click to copy"
          style={{
            display: 'block',
            width: '100%',
            textAlign: 'left',
            wordBreak: 'break-all',
            padding: '10px 12px',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            fontSize: 13,
            cursor: 'pointer',
            color: 'var(--text-primary)',
          }}
        >
          {data.secret}
          <span
            style={{
              float: 'right',
              fontSize: 11,
              color: copied ? 'var(--success)' : 'var(--text-tertiary)',
            }}
          >
            {copied ? '✓ COPIED' : '⧉ COPY'}
          </span>
        </button>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={onContinue}
        >
          I’ve scanned it
        </button>
      </div>
    </div>
  );
}

// ---- Step 2: Confirm ------------------------------------------------------

function ConfirmStep({
  code,
  setCode,
  isPending,
  error,
  onSubmit,
  onBack,
}: {
  code: string;
  setCode: (v: string) => void;
  isPending: boolean;
  error: string | null;
  onSubmit: (e: FormEvent) => void;
  onBack: () => void;
}) {
  return (
    <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <label className="label" htmlFor="mfa-confirm-code">Authenticator code</label>
        <input
          id="mfa-confirm-code"
          className="input mono"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          placeholder="000000"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ''))}
          autoFocus
          style={{ fontSize: 24, letterSpacing: '0.4em', textAlign: 'center' }}
        />
      </div>
      {error && (
        <div
          role="alert"
          style={{
            fontSize: 13,
            color: 'var(--danger)',
            background: 'var(--danger-bg)',
            border: '1px solid var(--danger)',
            borderRadius: 'var(--radius-md)',
            padding: '10px 12px',
          }}
        >
          {error}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <button type="button" className="btn" onClick={onBack} disabled={isPending}>
          Back
        </button>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={isPending || code.length < 6}
        >
          {isPending ? 'Verifying…' : 'Verify & enable'}
        </button>
      </div>
    </form>
  );
}

// ---- Step 3: Backup codes -------------------------------------------------

function BackupStep({
  codes,
  acked,
  setAcked,
  onDone,
}: {
  codes: string[];
  acked: boolean;
  setAcked: (v: boolean) => void;
  onDone: () => void;
}) {
  const { copied, copy } = useCopyToClipboard();
  const showToast = useUIStore((s) => s.showToast);

  const allText = codes.join('\n');

  const handleDownload = () => {
    const blob = new Blob(
      [
        'LexDraft - Two-factor backup codes\n',
        'Each code can be used ONCE. Keep this file somewhere safe.\n',
        `Generated: ${new Date().toISOString()}\n\n`,
        allText,
        '\n',
      ],
      { type: 'text/plain' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'lexdraft-backup-codes.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast({ type: 'sage', text: 'Backup codes downloaded' });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div
        role="alert"
        style={{
          fontSize: 13,
          color: 'var(--text-primary)',
          background: 'var(--warning-bg, #fff7e6)',
          border: '1px solid var(--warning, #b8860b)',
          borderRadius: 'var(--radius-md)',
          padding: '10px 12px',
        }}
      >
        These codes will <strong>not be shown again</strong>. Save them in your
        password manager or print them. Each code works once.
      </div>

      <div
        className="form-row"
        style={{
          gap: 8,
          padding: 16,
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-lg)',
        }}
      >
        {codes.map((c) => (
          <span
            key={c}
            className="mono tabular"
            style={{ fontSize: 14, letterSpacing: '0.08em', textAlign: 'center' }}
          >
            {c}
          </span>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => void copy(allText)}
          style={{ flex: 1 }}
        >
          {copied ? '✓ Copied' : 'Copy all'}
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={handleDownload}
          style={{ flex: 1 }}
        >
          Download as text
        </button>
      </div>

      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 13,
          color: 'var(--text-secondary)',
          cursor: 'pointer',
        }}
      >
        <input
          type="checkbox"
          checked={acked}
          onChange={(e) => setAcked(e.target.checked)}
        />
        I have saved my backup codes somewhere safe.
      </label>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!acked}
          onClick={onDone}
        >
          Done
        </button>
      </div>
    </div>
  );
}
