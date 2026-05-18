import type { ReactNode } from 'react';

interface FABProps {
  onClick: () => void;
  ariaLabel: string;
  children: ReactNode;
}

// Mobile-only floating action button. Hidden via CSS on tablet+ so the
// same view can keep its top-right primary button on desktop and surface
// a thumb-reachable FAB on phones without conditional rendering.

export function FAB({ onClick, ariaLabel, children }: FABProps) {
  return (
    <button type="button" className="fab" aria-label={ariaLabel} onClick={onClick}>
      {children}
    </button>
  );
}
