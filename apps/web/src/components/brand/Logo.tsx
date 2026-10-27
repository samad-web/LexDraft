// =============================================================================
// DifAI brand: the mark and the wordmark.
//
// The mark is a "D" built from the architecture of a court: its stem is a
// classical column (capital, fluted shaft, base) and its bowl curves off the
// column like an arch. In the counter hang the scales of justice, balanced on
// a four-point AI spark - justice, weighed with AI. Two colours (ink tile,
// paper mark). Below 28px the fluting and pans drop out so it stays crisp as a
// favicon. Colours are tokens by default (inverts with the theme); pass
// `ink`/`paper` to place it on an inverse surface.
// =============================================================================

export const BRAND_NAME = 'DifAI';

/** Column + bowl (the D). */
const CAPITAL = { x: 6.6, y: 6.4, w: 8, h: 2.2 };
const SHAFT = { x: 7.8, y: 8.6, w: 5.6, h: 14.8 };
const BASE = { x: 6.6, y: 23.4, w: 8, h: 2.2 };
const BOWL = 'M14.6 6.4H17.4C22.5 6.4 25.8 10.5 25.8 16C25.8 21.5 22.5 25.6 17.4 25.6H14.6V22H17.2C20.1 22 22 19.6 22 16C22 12.4 20.1 10 17.2 10H14.6Z';
/** Scales of justice in the counter, pivoting on the spark. */
const SPARK = 'M18.3 10.5C18.46 11.85 18.78 12.17 20.1 12.32C18.78 12.47 18.46 12.79 18.3 14.15C18.14 12.79 17.82 12.47 16.5 12.32C17.82 12.17 18.14 11.85 18.3 10.5Z';
const PAN_L = 'M16.1 14.4L15.15 16.9H17.05Z';
const PAN_R = 'M20.5 14.4L19.55 16.9H21.45Z';

export function LogoMark({
  size = 24,
  ink = 'var(--text-primary)',
  paper = 'var(--bg-base)',
  title,
  className,
}: {
  size?: number;
  ink?: string;
  paper?: string;
  /** Accessible name; omit when the wordmark is next to it. */
  title?: string;
  className?: string;
}) {
  const detailed = size >= 28;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
      style={{ display: 'block', flexShrink: 0 }}
    >
      <rect width="32" height="32" rx="8" fill={ink} />
      {/* Optical centring + breathing room inside the tile. */}
      <g transform="translate(16 16) scale(0.88) translate(-16.2 -16)">
        <g fill={paper}>
          <rect x={CAPITAL.x} y={CAPITAL.y} width={CAPITAL.w} height={CAPITAL.h} rx="0.5" />
          <rect x={SHAFT.x} y={SHAFT.y} width={SHAFT.w} height={SHAFT.h} />
          <rect x={BASE.x} y={BASE.y} width={BASE.w} height={BASE.h} rx="0.5" />
          <path d={BOWL} />
        </g>
        {detailed && (
          <g fill={ink}>
            <rect x="9.6" y="9.8" width="0.7" height="12.4" rx="0.35" />
            <rect x="11" y="9.8" width="0.7" height="12.4" rx="0.35" />
          </g>
        )}
        <g fill={paper}>
          <rect x="17.85" y="13.3" width="0.9" height="6.1" rx="0.3" />
          <rect x="16.4" y="19.1" width="3.8" height="1" rx="0.4" />
          <rect x="15.7" y="13.6" width="5.2" height="0.8" rx="0.4" />
          {detailed && <path d={PAN_L} />}
          {detailed && <path d={PAN_R} />}
          <path d={SPARK} />
        </g>
      </g>
    </svg>
  );
}

/** "DifAI" set as Dif + AI: same family, AI heavier and tracked a touch wider. */
export function Wordmark({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <span className={className} style={{ whiteSpace: 'nowrap', ...style }}>
      Dif<span style={{ fontWeight: 800, letterSpacing: '0.01em' }}>AI</span>
    </span>
  );
}
