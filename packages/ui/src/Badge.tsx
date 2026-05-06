import type { HTMLAttributes, ReactNode } from 'react';

export type BadgeTone = 'default' | 'vermillion' | 'cobalt' | 'sage' | 'amber' | 'cream';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  children?: ReactNode;
}

export function Badge({ tone = 'default', className = '', children, ...rest }: BadgeProps) {
  const cls = ['badge', tone !== 'default' && `badge-${tone}`, className].filter(Boolean).join(' ');
  return (
    <span className={cls} {...rest}>
      {children}
    </span>
  );
}
