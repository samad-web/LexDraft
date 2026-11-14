import { useId } from 'react';
import { randomPin, validPdfPassword } from '@/lib/pdf-lock';

export interface PdfLock {
  on: boolean;
  password: string;
}

export const PDF_LOCK_OFF: PdfLock = { on: false, password: '' };

/** "Lock with password" tick box + password field, for any PDF share/download. */
export function PdfLockOption({ value, onChange, disabled }: {
  value: PdfLock;
  onChange: (v: PdfLock) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const bad = value.on && !validPdfPassword(value.password);
  return (
    <div className="pdf-lock" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label htmlFor={`${id}-on`} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
        <input
          id={`${id}-on`}
          type="checkbox"
          checked={value.on}
          disabled={disabled}
          onChange={(e) => onChange({ on: e.target.checked, password: e.target.checked ? value.password || randomPin() : value.password })}
        />
        Lock PDF with password
      </label>
      {value.on && (
        <>
          <input
            className="input"
            aria-label="PDF password"
            aria-invalid={bad}
            aria-describedby={`${id}-hint`}
            value={value.password}
            maxLength={64}
            disabled={disabled}
            onChange={(e) => onChange({ on: true, password: e.target.value })}
            style={{ fontFamily: 'var(--font-mono, monospace)' }}
          />
          <span id={`${id}-hint`} style={{ fontSize: 12, color: 'var(--ink-3, #666)' }}>
            {bad ? 'Use 4 to 64 characters.' : 'Send this password to the client separately (call or SMS), not in the same chat.'}
          </span>
        </>
      )}
    </div>
  );
}
