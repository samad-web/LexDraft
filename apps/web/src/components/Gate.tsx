import type { ReactNode } from 'react';
import { useCan } from '@/hooks/useFirmAdmin';

interface GateProps {
  /** Feature key from the platform catalog (e.g. 'matter.create'). */
  feature: string;
  /** Render iff the resolved feature set contains `feature`. */
  children: ReactNode;
  /** Optional fallback shown when the feature is missing. Defaults to nothing. */
  fallback?: ReactNode;
}

/**
 * Conditional renderer driven by the resolved permission set from
 * `/me/features`. Mirrors the server-side `requireFeature` so the UI doesn't
 * surface affordances the API would 403 — purely a UX nicety; the server is
 * always the authority.
 *
 * Note: while `useMeFeatures()` is loading we render nothing (rather than
 * the fallback) so a momentary flash of "no permission" doesn't appear when
 * the user actually has it.
 */
export function Gate({ feature, children, fallback = null }: GateProps): JSX.Element | null {
  const allowed = useCan(feature);
  if (allowed) return <>{children}</>;
  return <>{fallback}</>;
}
