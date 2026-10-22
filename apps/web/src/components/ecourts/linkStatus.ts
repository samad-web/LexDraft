/** Display for a matter's eCourts connection status (shared by the matters
 *  list badge and the matter page's connection card). */
export type EcourtsLinkStatusValue = 'unlinked' | 'pending' | 'linked' | 'not_found' | 'error';

export const LINK_STATUS_DISPLAY: Record<EcourtsLinkStatusValue, { badge: string; label: string }> = {
  linked:    { badge: 'badge-sage',       label: 'Connected' },
  pending:   { badge: 'badge-amber',      label: 'Waiting for eCourts' },
  not_found: { badge: 'badge-vermillion', label: 'CNR not found' },
  error:     { badge: 'badge-vermillion', label: 'Could not sync' },
  unlinked:  { badge: 'badge-cream',      label: 'No CNR' },
};

export function linkStatusDisplay(s: string | null | undefined): { badge: string; label: string } {
  return LINK_STATUS_DISPLAY[(s ?? 'unlinked') as EcourtsLinkStatusValue] ?? LINK_STATUS_DISPLAY.unlinked;
}
