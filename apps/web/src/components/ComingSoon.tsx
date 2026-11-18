import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '@lexdraft/ui';
import { PageHeader } from './PageHeader';

/**
 * A feature marked "Coming soon" by the owner (2026-11-18). The page it wraps
 * stays in the code; remove the wrapper in App.tsx (and `comingSoon` in
 * nav-config) to switch it back on.
 */
export function ComingSoon({ feature }: { feature: string; children?: ReactNode }) {
  return (
    <div className="col" style={{ gap: 16 }}>
      <PageHeader title={feature} description="Coming soon to DifAi." />
      <EmptyState
        icon="sparkle"
        title={`${feature} is coming soon`}
        description="We're finishing this feature. It will appear here as soon as it's ready."
        action={<Link to="/app/dashboard" className="btn">Back to dashboard</Link>}
      />
    </div>
  );
}
