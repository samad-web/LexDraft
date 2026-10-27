import { useNavigate } from 'react-router-dom';
import { EmptyState } from '@lexdraft/ui';

/** Shown in place of a page whose feature is locked on the free launch plan
 *  (the superadmin opens or locks these; api: lib/free-plan.ts). */
export function FreePlanLocked({ feature }: { feature: string }) {
  const navigate = useNavigate();
  return (
    <EmptyState
      icon="flag"
      title="Not included in the free plan"
      description={`${feature} is part of the paid plans. Your drafting, matters and AI tools stay free until 1 June 2027.`}
      action={
        <span style={{ display: 'inline-flex', gap: 8 }}>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => navigate('/app/billing')}>
            See plans
          </button>
          <button type="button" className="btn btn-sm" onClick={() => navigate('/app/dashboard')}>
            Back to Dashboard
          </button>
        </span>
      }
    />
  );
}
