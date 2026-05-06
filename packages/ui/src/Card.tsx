import type { HTMLAttributes, ReactNode } from 'react';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'cream';
  hover?: boolean;
  ruled?: boolean;
  children?: ReactNode;
}

export function Card({
  variant = 'default',
  hover,
  ruled,
  className = '',
  children,
  ...rest
}: CardProps) {
  const cls = [
    variant === 'cream' ? 'card-cream' : 'card',
    hover && 'card-hover',
    ruled && 'ruled',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cls} {...rest}>
      {children}
    </div>
  );
}
