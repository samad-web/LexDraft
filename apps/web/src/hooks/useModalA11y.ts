import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE =
  'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/**
 * Accessibility plumbing for the bespoke modals that don't sit on the shared
 * <Modal> component. Mirrors Modal.tsx so every dialog behaves the same:
 *   - Escape closes the dialog.
 *   - Body scroll is locked while open.
 *   - Focus moves into the dialog on open and returns to the trigger on close.
 *   - Tab wraps within the dialog (lightweight focus trap).
 *
 * Returns a ref to attach to the dialog's outermost element (the element that
 * contains every focusable control — usually the overlay or shell div).
 */
export function useModalA11y<T extends HTMLElement = HTMLElement>(
  open: boolean,
  onClose: () => void,
): RefObject<T> {
  const shellRef = useRef<T>(null);
  const triggerRef = useRef<Element | null>(null);

  // Escape to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Lock body scroll for the lifetime of the dialog.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Capture the trigger, focus the first control inside the dialog, and
  // restore focus to the trigger on close.
  useEffect(() => {
    if (!open) return;
    triggerRef.current = document.activeElement;
    const t = window.setTimeout(() => {
      const root = shellRef.current;
      if (!root) return;
      const first = root.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? root).focus();
    }, 30);
    return () => {
      window.clearTimeout(t);
      const trigger = triggerRef.current;
      if (trigger instanceof HTMLElement && document.contains(trigger)) {
        trigger.focus();
      }
    };
  }, [open]);

  // Lightweight focus trap: wrap Tab at the dialog boundaries.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const root = shellRef.current;
      if (!root) return;
      const focusables = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter((el) => el.offsetParent !== null);
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

  return shellRef;
}
