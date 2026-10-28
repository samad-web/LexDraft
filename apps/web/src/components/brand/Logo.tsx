// =============================================================================
// DifAi brand: the wordmark and the mark.
//
// The logo is the user's own artwork, traced 1:1 into vectors: a heavy
// geometric "D" followed by "ifAi" in an even sans, flat ink, no tile.
// `Wordmark` is the full logo; `LogoMark` is the D on its own, for square
// spots (collapsed sidebar rail). Both draw in `currentColor` unless an ink is
// given, so they follow the UI's light/dark tokens.
// Geometry is shared with apps/web/public/favicon.svg and the Android
// launcher icons (android/app/src/main/res/drawable/ic_launcher_*.xml).
// =============================================================================

export const BRAND_NAME = 'DifAi';

/** Traced from the brand artwork; viewBox 0 0 758 266, cap height 262 (y 4-266). */
export const BRAND_PATHS = {
  d: 'M0 4H129C208.5 4 261.5 56.4 261.5 135C261.5 213.6 208.5 266 129 266H0Z'
    + 'M88 72V196H122C151.3 196 172.5 170 172.5 134C172.5 98 151.3 72 122 72Z',
  i1: 'M291 77H329.5V266H291Z',
  i1Dot: { cx: 310, cy: 23.5, r: 24.5 },
  f: 'M385.5 266V71C385.5 26 412 0 452 0C465 0 477 2 488.5 5L479 37C470 33.5 462 32 453 32C433 32 423.5 43 423.5 66V266Z',
  fBar: 'M352 78H473.5V110H352Z',
  a: 'M560 4H600L697.5 266H656L633.5 201.5H525.5L503 266H463Z M579.5 48L536.5 170H622.5Z',
  i2: 'M720 77H757.5V266H720Z',
  i2Dot: { cx: 738.5, cy: 23.5, r: 24.5 },
};

/** The bold D alone, square. */
export function LogoMark({
  size = 24,
  ink = 'currentColor',
  title,
  className,
}: {
  size?: number;
  ink?: string;
  /** Accessible name; omit when the wordmark is next to it. */
  title?: string;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="-2 3 266 266"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
      style={{ flexShrink: 0 }}
    >
      <path d={BRAND_PATHS.d} fill={ink} fillRule="evenodd" />
    </svg>
  );
}

/** The full "DifAi" logo. With no `height` it is sized like text: its cap
 *  height matches the surrounding font's, sitting on the baseline. */
export function Wordmark({
  height,
  ink = 'currentColor',
  className,
  style,
}: {
  height?: number;
  ink?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const P = BRAND_PATHS;
  return (
    <svg
      className={className}
      viewBox="0 0 758 266"
      role="img"
      aria-label={BRAND_NAME}
      focusable="false"
      style={{
        // Left to CSS when sized, so classes such as the sidebar's can hide it.
        ...(height ? {} : { display: 'inline-block' }),
        height: height ?? '0.74em',
        width: 'auto',
        aspectRatio: '758 / 266',
        flexShrink: 0,
        overflow: 'visible',
        ...style,
      }}
    >
      <g fill={ink}>
        <path d={P.d} fillRule="evenodd" />
        <path d={P.i1} />
        <circle {...P.i1Dot} />
        <path d={P.f} />
        <path d={P.fBar} />
        <path d={P.a} fillRule="evenodd" />
        <path d={P.i2} />
        <circle {...P.i2Dot} />
      </g>
    </svg>
  );
}
