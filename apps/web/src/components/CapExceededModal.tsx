import { useNavigate } from 'react-router-dom';
import { Modal } from './Modal';
import { useUIStore, type CapPromptModel } from '@/store/ui';

/**
 * Single source of truth for "you hit a cap" UX. Pushed by the axios
 * interceptor (apps/web/src/lib/api.ts) when the API responds with a
 * 429 `ai_quota_exceeded` or 402 `seat_cap_exceeded`. The modal does the
 * pricing-page redirect for both — generic enough that we don't need a
 * separate component per cap type.
 */
export function CapExceededModal() {
  const navigate = useNavigate();
  const cap = useUIStore((s) => s.capPrompt);
  const hide = useUIStore((s) => s.hideCapPrompt);
  if (!cap) return null;

  const { title, description, primaryLabel } = describeCap(cap);
  const upgradeTarget = cap.planTier === 'Firm' ? null : '/app/settings';

  return (
    <Modal
      open
      onClose={hide}
      title={title}
      eyebrow={cap.kind === 'ai_quota' ? 'AI generation cap' : 'Seat cap'}
      description={description}
      width={500}
      footer={
        <>
          <button type="button" className="btn" onClick={hide}>
            Got it
          </button>
          {upgradeTarget && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                hide();
                navigate(upgradeTarget);
              }}
            >
              {primaryLabel}
            </button>
          )}
        </>
      }
    >
      <div className="col" style={{ gap: 12 }}>
        <div className="row" style={{ gap: 24, alignItems: 'baseline' }}>
          <div>
            <div className="eyebrow">Used</div>
            <div className="mono tabular" style={{ fontSize: 20, fontWeight: 600 }}>
              {cap.used} / {cap.cap}
            </div>
          </div>
          {cap.planTier && (
            <div>
              <div className="eyebrow">Plan</div>
              <div className="body-md">{cap.planTier}</div>
            </div>
          )}
          {cap.kind === 'ai_quota' && cap.resetsAt && (
            <div>
              <div className="eyebrow">Resets</div>
              <div className="body-md">{formatDate(cap.resetsAt)}</div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function describeCap(cap: CapPromptModel): {
  title: string;
  description: string;
  primaryLabel: string;
} {
  if (cap.kind === 'ai_quota') {
    return {
      title: 'Monthly AI drafts used up',
      description:
        cap.planTier === 'Firm'
          ? `You've used all ${cap.cap} AI drafts on your Firm plan this cycle. Drafts will be available again at your next renewal.`
          : `You've used all ${cap.cap} AI drafts on your ${cap.planTier ?? 'current'} plan this cycle. Upgrade for a higher monthly cap, or wait for the cycle to renew.`,
      primaryLabel: 'Upgrade plan',
    };
  }
  return {
    title: 'Seat cap reached',
    description:
      cap.planTier === 'Firm'
        ? `Your Firm plan currently provisions ${cap.cap} seats and ${cap.used} are in use. Contact support to provision more.`
        : `Your ${cap.planTier ?? 'current'} plan includes ${cap.cap} seats and all are in use. Upgrade to invite more advocates.`,
    primaryLabel: 'Upgrade plan',
  };
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso.slice(0, 10);
  }
}
