/**
 * Flags a law-search result whose text hasn't been checked by counsel
 * against the primary source yet (e.g. the local BNS corpus, parsed from
 * the gazette PDF by regex — see bns-search.service.ts). Renders nothing
 * when `verified` is true or undefined (the external corpus doesn't track
 * this distinction, so there's nothing to warn about).
 *
 * Visual treatment mirrors JurisdictionBadge's chrome, vermillion-tinted so
 * it reads as a caution, not a neutral label.
 */
export function VerificationBadge({ verified, compact }: { verified?: boolean; compact?: boolean }) {
  if (verified !== false) return null;
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
        background: 'var(--vermillion-bg, rgba(220,38,38,0.1))',
        color: 'var(--vermillion, #b91c1c)',
        border: '1px solid',
        borderColor: 'var(--vermillion, #dc2626)',
        whiteSpace: 'nowrap',
      }}
      title="Parsed from the official gazette text, not yet checked by counsel against the primary source — verify before citing in a filing."
    >
      NEEDS REVIEW
    </span>
  );
}
