import type { CSSProperties, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

// Reusable empty/error states for data-driven views. Two variants:
//  - `card` (default): full panel, icon + title + description + optional CTA
//  - `inline`: compact, fits in a table row or sparse list. No icon, smaller padding.
//
// ErrorState is the same shape but with a danger-toned title and an optional
// `onRetry` callback that renders a retry button alongside the action slot.

export interface EmptyStateProps {
  icon?: IconName;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  variant?: 'card' | 'inline';
  /** Override max-width of the description block (px). Default 360. */
  descriptionMaxWidth?: number;
}

const cardStyle: CSSProperties = {
  textAlign: 'center',
  padding: 'var(--space-9, 36px)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 10,
};

const inlineStyle: CSSProperties = {
  padding: '28px 8px',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 6,
  textAlign: 'center',
};

export function EmptyState({
  icon,
  title,
  description,
  action,
  variant = 'card',
  descriptionMaxWidth = 360,
}: EmptyStateProps) {
  const isCard = variant === 'card';
  return (
    <div
      role="status"
      className={isCard ? 'card' : undefined}
      style={isCard ? cardStyle : inlineStyle}
    >
      {icon && isCard && (
        <span
          aria-hidden
          style={{
            width: 44,
            height: 44,
            borderRadius: 'var(--radius-full)',
            background: 'var(--bg-surface-2)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-tertiary)',
            marginBottom: 2,
          }}
        >
          <Icon name={icon} size={20} />
        </span>
      )}
      <div className={isCard ? 'heading-sm' : 'heading-sm'} style={{ marginTop: isCard ? 2 : 0 }}>
        {title}
      </div>
      {description && (
        <p
          className="body-sm muted"
          style={{
            maxWidth: descriptionMaxWidth,
            margin: 0,
            lineHeight: 1.55,
          }}
        >
          {description}
        </p>
      )}
      {action && <div style={{ marginTop: isCard ? 8 : 4 }}>{action}</div>}
    </div>
  );
}

export interface ErrorStateProps {
  icon?: IconName;
  title?: string;
  description?: ReactNode;
  action?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  variant?: 'card' | 'inline';
}

export function ErrorState({
  icon = 'flag',
  title = "Couldn't load this",
  description,
  action,
  onRetry,
  retryLabel = 'Try again',
  variant = 'card',
}: ErrorStateProps) {
  const isCard = variant === 'card';
  return (
    <div
      role="alert"
      className={isCard ? 'card' : undefined}
      style={isCard ? cardStyle : inlineStyle}
    >
      {icon && isCard && (
        <span
          aria-hidden
          style={{
            width: 44,
            height: 44,
            borderRadius: 'var(--radius-full)',
            background: 'var(--danger-bg, rgba(220, 38, 38, 0.08))',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--danger)',
            marginBottom: 2,
          }}
        >
          <Icon name={icon} size={20} />
        </span>
      )}
      <div
        className="heading-sm"
        style={{ marginTop: isCard ? 2 : 0, color: 'var(--danger)' }}
      >
        {title}
      </div>
      {description && (
        <p
          className="body-sm muted"
          style={{ maxWidth: 360, margin: 0, lineHeight: 1.55 }}
        >
          {description}
        </p>
      )}
      {(action || onRetry) && (
        <div className="row" style={{ marginTop: isCard ? 8 : 4, gap: 8, justifyContent: 'center' }}>
          {onRetry && (
            <button type="button" className="btn btn-sm" onClick={onRetry}>
              {retryLabel}
            </button>
          )}
          {action}
        </div>
      )}
    </div>
  );
}
