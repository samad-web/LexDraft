import type { Jurisdiction } from '@/hooks/useLawsSearch';

/**
 * Compact badge that signals whether a law is central (parliamentary)
 * or state-level. State acts also show the state name.
 *
 * Visual treatment: muted mono pill, identical chrome to the eyebrows /
 * citation labels already used in the corpus result cards. Central is
 * neutral, State is amber-tinted so the eye can sort jurisdictions at
 * a glance.
 */
export function JurisdictionBadge({
  jurisdiction,
  state,
  compact,
}: {
  jurisdiction: Jurisdiction;
  state: string | null;
  /** Set true inside the dense LawSidePanel cards. */
  compact?: boolean;
}) {
  if (jurisdiction === 'Unknown') return null;
  const isState = jurisdiction === 'State' && state;
  const label = isState ? `STATE · ${state.toUpperCase()}` : 'CENTRAL';
  return (
    <span
      className="mono"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        fontSize: compact ? 9 : 10,
        fontWeight: 600,
        letterSpacing: '0.08em',
        padding: compact ? '1px 6px' : '2px 8px',
        borderRadius: 'var(--radius-sm)',
        background: isState ? 'var(--warning-bg, rgba(202,138,4,0.12))' : 'var(--bg-surface-2)',
        color: isState ? 'var(--warning, #92400e)' : 'var(--text-secondary)',
        border: '1px solid',
        borderColor: isState ? 'var(--warning, #d97706)' : 'var(--border-default)',
        whiteSpace: 'nowrap',
      }}
      title={isState ? `${state} state legislature` : 'Parliament of India'}
    >
      {label}
    </span>
  );
}
