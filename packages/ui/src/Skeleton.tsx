import type { CSSProperties, HTMLAttributes } from 'react';

// Shimmer-style loading placeholder. Pair with the .lex-skeleton CSS in
// apps/web/src/styles/globals.css (gradient sweep, prefers-reduced-motion
// degrades to a static surface). Compose shape-matched skeletons by
// nesting Skeleton blocks inside a layout that mirrors the loaded UI.

export interface SkeletonProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** Width in px or any CSS length. Defaults to 100% of the parent. */
  width?: number | string;
  /** Height in px or any CSS length. Defaults to 1em (text-line height). */
  height?: number | string;
  /** Corner radius token; 'pill' for fully rounded, 'none' for sharp. */
  radius?: 'sm' | 'md' | 'lg' | 'pill' | 'none';
  /** Render as a circle (avatar/icon placeholder). Overrides radius. */
  circle?: boolean;
}

const RADIUS: Record<NonNullable<SkeletonProps['radius']>, string> = {
  sm:   'var(--radius-sm)',
  md:   'var(--radius-md)',
  lg:   'var(--radius-lg)',
  pill: 'var(--radius-full)',
  none: '0',
};

export function Skeleton({
  width,
  height = '1em',
  radius = 'sm',
  circle = false,
  className = '',
  style,
  ...rest
}: SkeletonProps) {
  const cls = ['lex-skeleton', className].filter(Boolean).join(' ');
  const computed: CSSProperties = {
    width: width ?? '100%',
    height: circle ? width ?? height : height,
    borderRadius: circle ? '50%' : RADIUS[radius],
    ...style,
  };
  return <span aria-hidden className={cls} style={computed} {...rest} />;
}

export interface SkeletonTextProps {
  /** Number of lines to render. */
  lines?: number;
  /** Width of the last line as a fraction of the rest (defaults to 0.6). */
  lastLineWidth?: number;
  /** Spacing between lines (px). */
  gap?: number;
  /** Line height (px or CSS length). */
  lineHeight?: number | string;
}

export function SkeletonText({
  lines = 3,
  lastLineWidth = 0.6,
  gap = 10,
  lineHeight = 12,
}: SkeletonTextProps) {
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap, width: '100%' }}>
      {Array.from({ length: lines }, (_, i) => {
        const isLast = i === lines - 1 && lines > 1;
        return (
          <Skeleton
            key={i}
            height={lineHeight}
            width={isLast ? `${Math.round(lastLineWidth * 100)}%` : '100%'}
          />
        );
      })}
    </span>
  );
}
