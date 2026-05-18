import { useEffect, useState, type ReactNode } from 'react';
import { useReducedMotion } from '../hooks/useReducedMotion';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  eyebrow?: string;
  description?: string;
  children: ReactNode;
  width?: number;
  /** Submission handler - when present, the modal renders as a <form>. */
  onSubmit?: (e: React.FormEvent) => void;
  footer?: ReactNode;
}

const ANIM_MS = 160;

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
  const prefersReduced = useReducedMotion();
  // Honour OS-level "reduce motion" - instant open/close, no scale, no fade.
  const animMs = prefersReduced ? 0 : ANIM_MS;
  // Two-state lifecycle so we can animate BOTH enter and exit:
  //   open=true        → rendered=true, visible=true (transitions in)
  //   open=false       → visible=false (transitions out), then unmount
  // The unmount delay must match ANIM_MS so the exit animation completes
  // before the DOM is torn down.
  const [rendered, setRendered] = useState(open);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setRendered(true);
      // Apply visible-state on the next frame so the transition sees the
      // "from" state first. Without rAF, React batches both setStates and
      // the browser never paints the initial off-state.
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    if (rendered) {
      setVisible(false);
      const t = setTimeout(() => setRendered(false), animMs);
      return () => clearTimeout(t);
    }
    return;
  }, [open, rendered, animMs]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!rendered) return null;

  const Body = onSubmit ? 'form' : 'div';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      onClick={onClose}
      className={`modal-overlay${visible ? ' is-visible' : ''}`}
      style={{ transitionDuration: `${animMs}ms` }}
    >
      <Body
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
        onSubmit={onSubmit}
        className={`modal-shell${visible ? ' is-visible' : ''}`}
        style={{
          ['--modal-width' as string]: `${width}px`,
          transitionDuration: `${animMs}ms`,
        }}
      >
        {/* Mobile-only grab handle, hidden on desktop via CSS */}
        <span aria-hidden className="modal-grabber" />
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
          <div className="modal-footer">{footer}</div>
        )}
      </Body>
    </div>
  );
}

export function Field({
  label,
  wide,
  required,
  hint,
  error,
  children,
}: {
  label: string;
  wide?: boolean;
  required?: boolean;
  hint?: ReactNode;
  error?: ReactNode | null | false;
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
      <span className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
        {label}
        {required && <span style={{ color: 'var(--danger)', marginLeft: 4 }}>*</span>}
        {hint && (
          <span style={{ marginLeft: 8, textTransform: 'none', color: 'var(--text-tertiary)' }}>
            {hint}
          </span>
        )}
      </span>
      {children}
      {error && (
        <span role="alert" style={{ fontSize: 12, color: 'var(--danger)', lineHeight: 1.4 }}>
          {error}
        </span>
      )}
    </label>
  );
}
