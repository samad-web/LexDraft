import { useNavigate } from 'react-router-dom';
import { Icon } from '@lexdraft/ui';
import type { DraftLock } from '@lexdraft/types';
import { useCredits, useUnlockDraft } from '@/hooks/useCredits';
import { creditLabel } from '@/lib/credit-costs';
import { isNativeApp } from '@/lib/google';

/**
 * Shown while part of a draft is locked (its pages went past the credit
 * balance). The locked text is not in the browser at all; unlocking pays the
 * rest and fetches it. Download, signing and filing stay off until then.
 * Android: no buy button (Play payments policy), text only.
 */
export function LockedDraftCard({ lock, onUnlocked }: {
  lock: DraftLock;
  onUnlocked: (out: { text?: string; rec?: Record<string, string> }) => void | Promise<void>;
}) {
  const navigate = useNavigate();
  const { data } = useCredits();
  const unlock = useUnlockDraft();
  const enough = !!data && data.balance >= lock.lockedCredits;
  const pages = Math.ceil(lock.lockedCredits);
  return (
    <section className="dc-card" role="status" aria-live="polite">
      <div className="dc-eyebrow"><Icon name="key" size={12} /> Part of this draft is locked</div>
      <p className="body-sm" style={{ margin: '6px 0 10px' }}>
        About {pages} more page{pages === 1 ? ' was' : 's were'} drafted past your credits. Unlocking needs {creditLabel(lock.lockedCredits)}.
        Download, signing and filing open once the whole draft is unlocked.
      </p>
      {enough ? (
        <button type="button" className="btn btn-primary dw-wide" disabled={unlock.isPending}
          onClick={async () => onUnlocked(await unlock.mutateAsync(lock.draftKey))}>
          {unlock.isPending ? 'Unlocking…' : `Unlock · ${creditLabel(lock.lockedCredits)}`}
        </button>
      ) : isNativeApp() ? (
        <p className="body-sm muted" style={{ margin: 0 }}>Credits finished. Manage your plan from the DifAi website.</p>
      ) : (
        <button type="button" className="btn btn-primary dw-wide" onClick={() => navigate('/app/billing')}>
          See plans and Brief Packs
        </button>
      )}
      {unlock.isError && <p className="cm-error-line" role="alert">{unlock.error.message}</p>}
    </section>
  );
}
