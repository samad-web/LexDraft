import { useCopyToClipboard } from '../hooks/useCopyToClipboard';

/**
 * Click-to-copy wrapper. Renders the value as inline text with a copy icon
 * that fades in on hover; on click, the icon swaps to a checkmark and a
 * subtle "Copied" pill appears for ~1.5s.
 *
 * Designed for long identifiers advocates copy constantly - CNRs, case
 * IDs, invoice numbers. The whole element is clickable and keyboard-
 * focusable so it works for accessibility users too.
 *
 * Visual restraint is intentional - the legal design system is monochrome,
 * so the only motion is a brief opacity transition on the feedback pill.
 */
export function CopyButton({
  value,
  label,
  mono = true,
  className,
}: {
  /** The string to write to clipboard. */
  value: string;
  /** Optional visible label override - defaults to `value`. Useful when
   *  the visible text is shorter than the actual identifier (rare). */
  label?: string;
  /** Render with monospaced + tabular numerals - the default for legal
   *  identifiers. Set to false for plain text. */
  mono?: boolean;
  className?: string;
}) {
  const { copied, copy } = useCopyToClipboard();
  const visible = label ?? value;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void copy(value);
      }}
      aria-label={`Copy ${visible}`}
      title={copied ? 'Copied' : 'Click to copy'}
      className={[
        'copy-btn',
        mono ? 'mono tabular' : '',
        className ?? '',
      ].filter(Boolean).join(' ')}
      style={{
        appearance: 'none',
        background: 'transparent',
        border: 0,
        padding: '2px 6px',
        margin: '-2px -6px', // compensate so layout doesn't shift
        borderRadius: 'var(--radius-sm, 4px)',
        cursor: 'pointer',
        color: 'inherit',
        font: 'inherit',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        position: 'relative',
        transition: 'background 120ms ease-out',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--bg-surface-2)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
      }}
    >
      <span>{visible}</span>
      <span
        aria-hidden="true"
        style={{
          fontSize: 11,
          color: copied ? 'var(--success)' : 'var(--text-tertiary)',
          transition: 'color 120ms ease-out',
          lineHeight: 1,
        }}
      >
        {copied ? '✓' : '⧉'}
      </span>
      {copied && (
        <span
          role="status"
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 4px)',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--bg-inverse)',
            color: 'var(--text-inverse)',
            padding: '2px 8px',
            borderRadius: 'var(--radius-sm, 4px)',
            fontSize: 11,
            fontFamily: 'var(--font-sans)',
            letterSpacing: '0.02em',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            // Fade-in handled by mounting - keep it minimal so the
            // pill feels instant rather than animated.
            animation: 'copy-pill-in 140ms ease-out',
          }}
        >
          Copied
        </span>
      )}
    </button>
  );
}
