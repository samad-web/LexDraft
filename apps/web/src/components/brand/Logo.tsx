import { useId } from 'react';

// =============================================================================
// DifAi brand: the mark and the wordmark.
//
// "Seal D": the embossed rosette seal of a notarised document or stamp paper,
// with a bold D at its heart - signed, sealed, official. The scalloped edge is
// a silhouette no other legal app owns, so it reads at 48px on a phone. Black
// and white like the app: a graphite tile (soft top highlight, fine light edge
// so it holds on dark pages) with a white seal; the rings and the D are cut
// into the seal. Below 28px the fine inner rings drop out. `tone="mono"` draws
// it flat in the UI's ink/paper tokens instead.
// Geometry is shared with apps/web/public/favicon.svg and the Android
// launcher icons (android/app/src/main/res/drawable/ic_launcher_*.xml).
// =============================================================================

export const BRAND_NAME = 'DifAi';
export const BRAND_TILE = { from: '#3a3a40', mid: '#18181b', to: '#050507', cut: '#141417' };

/** 48-unit grid. 28-point scalloped seal edge, centred on (24, 24). */
export const SEAL_PATH = 'M24.00 6.40L25.75 8.50L27.92 6.84L29.15 9.28L31.64 8.14L32.30 10.79L34.97 10.24L35.03 12.97L37.76 13.03L37.21 15.70L39.86 16.36L38.72 18.85L41.16 20.08L39.50 22.25L41.60 24.00L39.50 25.75L41.16 27.92L38.72 29.15L39.86 31.64L37.21 32.30L37.76 34.97L35.03 35.03L34.97 37.76L32.30 37.21L31.64 39.86L29.15 38.72L27.92 41.16L25.75 39.50L24.00 41.60L22.25 39.50L20.08 41.16L18.85 38.72L16.36 39.86L15.70 37.21L13.03 37.76L12.97 35.03L10.24 34.97L10.79 32.30L8.14 31.64L9.28 29.15L6.84 27.92L8.50 25.75L6.40 24.00L8.50 22.25L6.84 20.08L9.28 18.85L8.14 16.36L10.79 15.70L10.24 13.03L12.97 12.97L13.03 10.24L15.70 10.79L16.36 8.14L18.85 9.28L20.08 6.84L22.25 8.50Z';
/** The D (outer + counter; even-odd), centred in the seal. */
export const SEAL_D = 'M18.46 17.52H23.06C27.02 17.52 29.54 20.33 29.54 24.00C29.54 27.67 27.02 30.48 23.06 30.48H18.46ZM21.05 20.11V27.89H22.92C25.44 27.89 26.88 26.38 26.88 24.00C26.88 21.62 25.44 20.11 22.92 20.11Z';

export function LogoMark({
  size = 24,
  tone = 'brand',
  ink = 'var(--text-primary)',
  paper = 'var(--bg-base)',
  title,
  className,
}: {
  size?: number;
  /** 'brand' = graphite tile (default); 'mono' = flat UI ink/paper tokens. */
  tone?: 'brand' | 'mono';
  ink?: string;
  paper?: string;
  /** Accessible name; omit when the wordmark is next to it. */
  title?: string;
  className?: string;
}) {
  const uid = useId().replace(/:/g, '');
  const brand = tone === 'brand';
  const tile = brand ? `url(#t${uid})` : ink;
  const seal = brand ? `url(#n${uid})` : paper;
  const cut = brand ? BRAND_TILE.cut : ink;
  const detailed = size >= 28;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
      style={{ display: 'block', flexShrink: 0 }}
    >
      {brand && (
        <defs>
          <linearGradient id={`t${uid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={BRAND_TILE.from} />
            <stop offset="0.55" stopColor={BRAND_TILE.mid} />
            <stop offset="1" stopColor={BRAND_TILE.to} />
          </linearGradient>
          <linearGradient id={`n${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="1" stopColor="#e4e4e7" />
          </linearGradient>
          <linearGradient id={`g${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.14" />
            <stop offset="0.6" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
        </defs>
      )}
      <rect width="48" height="48" rx="11" fill={tile} />
      {brand && <rect width="48" height="48" rx="11" fill={`url(#g${uid})`} />}
      {brand && <rect x="0.5" y="0.5" width="47" height="47" rx="10.5" fill="none" stroke="#ffffff" strokeOpacity="0.14" />}
      <path d={SEAL_PATH} fill={seal} />
      <circle cx="24" cy="24" r="12.6" fill="none" stroke={cut} strokeWidth={detailed ? 1 : 1.4} />
      {detailed && <circle cx="24" cy="24" r="11" fill="none" stroke={cut} strokeWidth="0.6" strokeDasharray="1 1.4" />}
      <path d={SEAL_D} fill={cut} fillRule="evenodd" />
    </svg>
  );
}

/** "DifAi" set as Dif + Ai: same family, Ai heavier and tracked a touch wider. */
export function Wordmark({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <span className={className} style={{ whiteSpace: 'nowrap', ...style }}>
      Dif<span style={{ fontWeight: 800, letterSpacing: '0.01em' }}>Ai</span>
    </span>
  );
}
