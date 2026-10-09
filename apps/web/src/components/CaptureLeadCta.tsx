import { useState } from 'react';
import { Icon } from '@lexdraft/ui';
import { Gate } from '@/components/Gate';
import { NewLeadModal } from '@/components/NewLeadModal';

/**
 * Capture-lead CTA — used in the three plan-specific dashboards. Renders
 * a button that opens the existing NewLeadModal so users can record a
 * prospect without leaving the dashboard.
 *
 * Self-gated by the `leads.create` feature: roles without lead permission
 * (e.g. paralegals on some role matrices) don't see the button at all.
 *
 * Variants:
 *   - `default`  → primary-styled small button, fits in a masthead row.
 *   - `prominent`→ btn-lg, fits inline with §I "Today's work" CTAs on
 *                  Solo where the existing actions are also lg.
 *   - `on-dark`  → btn-lg with an outline style, for use on dark/inverse
 *                  surfaces (e.g. the §I hero panel) where `.btn-primary`
 *                  would render near-invisible (black-on-near-black).
 */
export function CaptureLeadCta(props: { variant?: 'default' | 'prominent' | 'on-dark' }): JSX.Element {
  const [open, setOpen] = useState(false);
  const cls =
    props.variant === 'prominent'
      ? 'btn btn-primary btn-lg'
      : props.variant === 'on-dark'
      ? 'btn btn-lg'
      : 'btn btn-primary';
  const style =
    props.variant === 'on-dark'
      ? { background: 'transparent', borderColor: 'var(--border-strong)', color: 'var(--text-inverse)' }
      : undefined;
  return (
    <Gate feature="leads.create">
      <button
        type="button"
        className={cls}
        style={style}
        onClick={() => setOpen(true)}
        title="Capture a new lead"
      >
        <Icon name="plus" size={14} /> Capture lead
      </button>
      <NewLeadModal open={open} onClose={() => setOpen(false)} />
    </Gate>
  );
}
