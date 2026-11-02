import type { PartnersView } from '@/hooks/efiling/vakalat';
import { PARTNERS_ITEMS, PortalVakalat } from './PortalVakalat';

// =============================================================================
// The portal's My Partners menu (Add Partners, Accept Partnership, Revoke
// Partnership, Accept Revocation, My Partners Report), live - the same live
// screen as the Vakalat menu (PortalVakalat.tsx).
// =============================================================================

export { PARTNERS_ITEMS };

export function PortalPartners({ sessionId, view }: { sessionId: string; view: PartnersView }) {
  return <PortalVakalat sessionId={sessionId} view={view} />;
}
