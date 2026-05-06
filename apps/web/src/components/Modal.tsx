import { useEffect, type ReactNode } from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  eyebrow?: string;
  description?: string;
  children: ReactNode;
  width?: number;
  /** Submission handler — when present, the modal renders as a <form>. */
  onSubmit?: (e: React.FormEvent) => void;
  footer?: ReactNode;
}

export function Modal({
  open,
  onClose,
  title,
  eyebrow,
  description,
  children,
  width = 640,
  onSubmit,
  footer,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const Body = onSubmit ? 'form' : 'div';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(10,10,10,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
        padding: 16,
      }}
    >
      <Body
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
        onSubmit={onSubmit}
        style={{
          background: 'var(--bg-base)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)',
          padding: 28,
          width: `min(${width}px, 100%)`,
          maxHeight: '90vh',
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div>
          {eyebrow && <div className="eyebrow" style={{ marginBottom: 4 }}>{eyebrow}</div>}
          <h3
            id="modal-title"
            className="display"
            style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em' }}
          >
            {title}
          </h3>
          {description && (
            <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
              {description}
            </p>
          )}
        </div>
        {children}
        {footer && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            {footer}
          </div>
        )}
      </Body>
    </div>
  );
}

export function Field({
  label,
  wide,
  children,
}: {
  label: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <label
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        gridColumn: wide ? '1 / -1' : undefined,
      }}
    >
      <span className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{label}</span>
      {children}
    </label>
  );
}
