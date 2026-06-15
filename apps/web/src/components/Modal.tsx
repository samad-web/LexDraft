import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
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
  // Instance-scoped `aria-labelledby`. Hardcoding "modal-title" meant
  // stacked modals (e.g. confirm dialog over a parent form) referenced the
  // same id, so the SR announcement was wrong for the topmost dialog.
  const titleId = useId();
  // Two-state lifecycle so we can animate BOTH enter and exit:
  //   open=true        → rendered=true, visible=true (transitions in)
  //   open=false       → visible=false (transitions out), then unmount
  // The unmount delay must match ANIM_MS so the exit animation completes
  // before the DOM is torn down.
  const [rendered, setRendered] = useState(open);
  const [visible, setVisible] = useState(false);
  // Refs for focus management: the shell receives initial focus on open;
  // when the modal closes we return focus to whichever element opened it.
  const shellRef = useRef<HTMLDivElement | HTMLFormElement | null>(null);
  const triggerRef = useRef<Element | null>(null);

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

  // Scroll lock on the document body for the lifetime of the dialog so the
  // page behind doesn't scroll under the user. Restores the prior overflow
  // value on close (works correctly with nested modals — each tracks its
  // own snapshot).
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Focus management: capture the trigger element on open, focus the shell,
  // and restore focus to the trigger on close. Keyboard users keep their
  // place instead of being dumped at the top of the document.
  useEffect(() => {
    if (!open) return;
    triggerRef.current = document.activeElement;
    const t = window.setTimeout(() => {
      // Prefer the first focusable inside the shell; fall back to the shell
      // itself (tabIndex=-1 below makes it programmatically focusable).
      const root = shellRef.current;
      if (!root) return;
      const first = root.querySelector<HTMLElement>(
        'input, textarea, select, button, [href], [tabindex]:not([tabindex="-1"])',
      );
      (first ?? root).focus();
    }, 30);
    return () => {
      window.clearTimeout(t);
      const trigger = triggerRef.current;
      if (trigger && trigger instanceof HTMLElement) {
        // Restore on cleanup. The trigger may have unmounted; guard against
        // that by checking it's still in the document.
        if (document.contains(trigger)) trigger.focus();
      }
    };
  }, [open]);

  // Lightweight focus trap: when Tab would move focus outside the shell,
  // wrap to the other end. Full inert-the-rest-of-the-page trapping needs
  // the `inert` attribute / aria-hidden on siblings — left as a follow-up.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const root = shellRef.current;
      if (!root) return;
      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>(
          'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!rendered) return null;

  const Body = onSubmit ? 'form' : 'div';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={onClose}
      className={`modal-overlay${visible ? ' is-visible' : ''}`}
      style={{ transitionDuration: `${animMs}ms` }}
    >
      <Body
        // ref-forwarding through a union element type — assign in a callback
        // so the unioned ref works for both <div> and <form>.
        ref={(el: HTMLDivElement | HTMLFormElement | null) => { shellRef.current = el; }}
        tabIndex={-1}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
        onSubmit={onSubmit}
        className={`modal-shell${visible ? ' is-visible' : ''}`}
        style={{
          ['--modal-width' as string]: `${width}px`,
          transitionDuration: `${animMs}ms`,
          outline: 'none',
        }}
      >
        {/* Mobile-only grab handle, hidden on desktop via CSS */}
        <span aria-hidden className="modal-grabber" />
        <div>
          {eyebrow && <div className="eyebrow" style={{ marginBottom: 4 }}>{eyebrow}</div>}
          <h3
            id={titleId}
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
  help,
  error,
  children,
}: {
  label: string;
  wide?: boolean;
  required?: boolean;
  hint?: ReactNode;
  /** Longer guidance rendered BELOW the control, so the label line stays a
   *  single row and side-by-side fields keep their inputs aligned. */
  help?: ReactNode;
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
        // Bottom-align so a wrapped label/help in a neighbouring field can't
        // shove this field's input out of line with it.
        justifyContent: 'flex-end',
      }}
    >
      <span
        className="mono"
        style={{ fontSize: 11, color: 'var(--text-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
      >
        {label}
        {required && <span style={{ color: 'var(--danger)', marginLeft: 4 }}>*</span>}
        {hint && (
          <span style={{ marginLeft: 8, textTransform: 'none', color: 'var(--text-tertiary)' }}>
            {hint}
          </span>
        )}
      </span>
      {children}
      {help && (
        <span style={{ fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.4 }}>
          {help}
        </span>
      )}
      {error && (
        <span role="alert" style={{ fontSize: 12, color: 'var(--danger)', lineHeight: 1.4 }}>
          {error}
        </span>
      )}
    </label>
  );
}
