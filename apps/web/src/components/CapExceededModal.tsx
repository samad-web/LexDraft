import { useNavigate } from 'react-router-dom';
import { Modal } from './Modal';
import { isNativeApp } from '@/lib/google';
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
  // No purchase prompts in the Android app (Play payments policy).
  const upgradeTarget = cap.planTier === 'Firm' || isNativeApp() ? null : '/app/billing';

  return (
    <Modal
      open
      onClose={hide}
      title={title}
      eyebrow={cap.kind === 'credits' ? 'AI credits' : cap.kind === 'ai_quota' ? 'Monthly drafts' : 'Seat cap'}
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
            <div className="eyebrow">{cap.kind === 'credits' ? 'Needed / left' : 'Used'}</div>
            <div className="mono tabular" style={{ fontSize: 20, fontWeight: 600 }}>
              {cap.used} / {cap.cap}
            </div>
          </div>
          {cap.planTier && (
            <div>
              <div className="eyebrow">Plan</div>
              <div className="body-md">{planLabel(cap.planTier)}</div>
            </div>
          )}
          {(cap.kind === 'ai_quota' || cap.kind === 'credits') && cap.resetsAt && (
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
  if (cap.kind === 'credits') {
    return {
      title: 'Not enough AI credits',
      description:
        `This needs ${cap.used} credit${cap.used === 1 ? '' : 's'} and ${cap.cap} ${cap.cap === 1 ? 'is' : 'are'} left. Nothing was charged.`
        + (cap.resetsAt ? ` Your plan's credits renew on ${formatDate(cap.resetsAt)}.` : '')
        + (isNativeApp() ? ' Manage your plan from the DifAi website.' : ' A bigger plan or a Brief Pack adds more now.'),
      primaryLabel: 'See plans and Brief Packs',
    };
  }
  if (cap.kind === 'ai_quota') {
    return {
      title: 'Drafting limit reached',
      description:
        `You've made all ${cap.cap} drafts on your ${planLabel(cap.planTier)} plan this month.`
        + (cap.resetsAt ? ` Your limit renews on ${formatDate(cap.resetsAt)}.` : '')
        + (cap.planTier === 'Firm' ? '' : ' Upgrade for more.'),
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

/** Plan names as advocates see them (`Practice` is sold as Chamber). */
function planLabel(tier: string | null | undefined): string {
  if (!tier) return 'current';
  return tier === 'Practice' ? 'Chamber' : tier;
}
