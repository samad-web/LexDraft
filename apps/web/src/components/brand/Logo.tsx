// =============================================================================
// DifAi brand: the "Draft Lines" logo (approved 2026-11-16, build-docs/features/new-logo.md).
//
// The symbol is a D outline with three ragged text lines and a cursor bar;
// the wordmark is the hand-built "DifAi" lettering whose last i-dot is the
// cursor. Three lockups, picked by space (owner's usage guide):
//   FullLogo  - symbol + wordmark: website header, sign-in, splash.
//   Wordmark  - wordmark only ("compact"): app sidebar, small headers.
//   LogoMark  - symbol only: collapsed rail, avatars. Under 24 px it switches
//               to the pixel-drawn favicon drawing.
//   LogoLoader - the symbol's signature motion, looping, for loading states.
// Everything draws in currentColor, so it follows the light/dark theme.
// The same geometry is copied into index.html (boot loader),
// public/favicon.svg, public/offline.html, seo/render.mjs and the API's GST
// invoice; tests keep those copies in step with this file.
// =============================================================================

import type { CSSProperties } from 'react';

export const BRAND_NAME = 'DifAi';

/** Symbol, master drawing on a 100-unit grid (viewBox 0 0 101.5 100). */
export const ICON = {
  frame: 'M0 0H50C80.9 0 101.5 20 101.5 50C101.5 80 80.9 100 50 100H0ZM17 15H50C71.3 15 85.5 29 85.5 50C85.5 71 71.3 85 50 85H17Z',
  lines: ['M29 28H68V39H29Z', 'M29 46H76V57H29Z', 'M29 64H44V75H29Z'],
  cursor: 'M51 60H59V79H51Z',
};

/** Symbol drawn on whole pixels for 16-23 px (viewBox 0 0 16 16, = public/favicon.svg). */
export const ICON_16 = {
  frame: 'M1 1H8A7 7 0 0 1 8 15H1ZM3 3V13H8A5 5 0 0 0 8 3Z',
  lines: ['M5 5H10V7H5Z', 'M5 9H7V11H5Z'],
  cursor: 'M9 8H11V12H9Z',
};

/** Wordmark "DifAi" (viewBox 0 -1.5 266 101.5). The first path is the D (evenodd). */
export const WORD = [
  'M0 0H44C75.93 0 95.5 19 95.5 50C95.5 81 75.93 100 44 100H0ZM14 12H44C66.63 12 80.5 26.44 80.5 50C80.5 73.56 66.63 88 44 88H14Z',
  'M111.18 30H111.18A7 7 0 0 1 118.18 37V93A7 7 0 0 1 111.18 100H111.18A7 7 0 0 1 104.18 93V37A7 7 0 0 1 111.18 30Z',
  'M103.2 6.98A7.98 7.98 0 1 0 119.16 6.98A7.98 7.98 0 1 0 103.2 6.98Z',
  'M137.08 100V21.7A21.7 21.7 0 0 1 158.78 0H165.78V12.88H158.78A7.7 8.82 0 0 0 151.08 21.7V100Z',
  'M125.18 30H167.18V41.48H125.18Z',
  'M156.68 100L195.8 -1.5H207.56L171.52 100Z',
  'M229.6 100L195.8 -1.5H207.56L246.68 100Z',
  'M178.47 63H223.34V74.2H178.47Z',
  'M259 30H259A7 7 0 0 1 266 37V93A7 7 0 0 1 259 100H259A7 7 0 0 1 252 93V37A7 7 0 0 1 259 30Z',
  'M252 -1H266V15.8H252Z',
];

const WORD_VB = { x: 0, y: -1.5, w: 266, h: 101.5 };
const FULL_VB = { x: 0, y: -1.5, w: 253.86, h: 101.5 };

/** Accessible-name props: an image named DifAi, or hidden when decorative. */
function a11y(title: string | undefined) {
  return title
    ? { role: 'img' as const, 'aria-label': title }
    : { 'aria-hidden': true as const };
}

/** The symbol's parts, classed for the signature motion (globals.css .difai-sig / .difai-loader). */
function SymbolPaths({ d = ICON }: { d?: typeof ICON }) {
  return (
    <>
      <path className="frame" d={d.frame} fillRule="evenodd" />
      {d.lines.map((p, i) => <path key={p} className={`ln l${i + 1}`} d={p} />)}
      <path className="cursor" d={d.cursor} />
    </>
  );
}

function WordPaths() {
  return <>{WORD.map((p, i) => <path key={p} d={p} fillRule={i === 0 ? 'evenodd' : undefined} />)}</>;
}

/** The symbol alone, square. Omit `title` when the name is already next to it. */
export function LogoMark({ size = 24, title, className }: { size?: number; title?: string; className?: string }) {
  const small = size < 24;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={small ? '0 0 16 16' : '0 -0.75 101.5 101.5'}
      fill="currentColor"
      focusable="false"
      style={{ flexShrink: 0 }}
      {...a11y(title)}
    >
      <SymbolPaths d={small ? ICON_16 : ICON} />
    </svg>
  );
}

type LockupProps = { height?: number; className?: string; style?: CSSProperties; title?: string };

function lockupStyle(vb: { w: number; h: number }, height: number | undefined, style?: CSSProperties): CSSProperties {
  return {
    // Left to CSS when sized, so classes such as the sidebar's can hide it.
    ...(height ? {} : { display: 'inline-block' }),
    // Unsized: cap height matches the surrounding text, sitting on the baseline.
    height: height ?? '0.74em',
    width: 'auto',
    aspectRatio: `${vb.w} / ${vb.h}`,
    flexShrink: 0,
    overflow: 'visible',
    ...style,
  };
}

/** The "DifAi" wordmark alone (compact lockup). */
export function Wordmark({ height, className, style, title = BRAND_NAME }: LockupProps) {
  const v = WORD_VB;
  return (
    <svg
      className={className}
      viewBox={`${v.x} ${v.y} ${v.w} ${v.h}`}
      fill="currentColor"
      focusable="false"
      style={lockupStyle(v, height, style)}
      {...a11y(title)}
    >
      <WordPaths />
    </svg>
  );
}

/** Symbol + wordmark (full lockup). `motion` plays the signature animation once. */
export function FullLogo({ height, className, style, title = BRAND_NAME, motion = false }: LockupProps & { motion?: boolean }) {
  const v = FULL_VB;
  return (
    <svg
      className={[motion ? 'difai-sig' : '', className].filter(Boolean).join(' ') || undefined}
      viewBox={`${v.x} ${v.y} ${v.w} ${v.h}`}
      fill="currentColor"
      focusable="false"
      style={lockupStyle(v, height, style)}
      {...a11y(title)}
    >
      <SymbolPaths />
      <g className="lk-word" transform="translate(131.5 27) scale(0.46)"><WordPaths /></g>
    </svg>
  );
}

/** Looping loader: the lines type in, the cursor blinks. Decorative: the caller announces loading. */
export function LogoLoader({ size = 56, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={['difai-loader', className].filter(Boolean).join(' ')}
      width={size}
      height={size}
      viewBox="-4 -4 109.5 108"
      fill="currentColor"
      focusable="false"
      aria-hidden
    >
      <SymbolPaths />
    </svg>
  );
}
