import { useMutation } from '@tanstack/react-query';
import type { BriefPack, BriefPackId } from '@lexdraft/types';
import { api } from '@/lib/api';

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

/** Brief Packs: one-time AI credit top-ups (valid 12 months). Web only: the
 *  Android app shows no purchase UI (Play payments policy). */
export function BriefPacks({ packs, canBuy }: { packs: BriefPack[]; canBuy: boolean }) {
  const buy = useMutation({
    mutationFn: (pack: BriefPackId) => api.post<{ checkoutUrl: string }>('/billing/packs/checkout', { pack }),
    onSuccess: (r) => window.location.assign(r.checkoutUrl),
  });
  if (!packs.length) return null;
  return (
    <section aria-label="Brief Packs" id="brief-packs">
      <h2 className="cm-plans-title" style={{ marginBottom: 4 }}>Brief Packs</h2>
      <p className="body-sm muted" style={{ marginTop: 0 }}>
        Extra AI credits for this month and the next twelve. 1 credit = one 400-word drafted page. Used after your plan&apos;s credits. Prices include GST.
      </p>
      <div className="cm-plans cm-plans--cols">
        {packs.map((p) => (
          <div key={p.id} className="cm-plan">
            <span className="cm-plan-name">{p.credits} credits</span>
            <span className="cm-plan-price">{inr(p.priceInr)}</span>
            <span className="cm-plan-sub">{inr(Math.round((p.priceInr / p.credits) * 10) / 10)} a page · valid 12 months</span>
            {canBuy && (
              <button type="button" className="btn btn-primary btn-sm" disabled={!p.purchasable || buy.isPending}
                onClick={() => buy.mutate(p.id)}>
                {buy.isPending && buy.variables === p.id ? 'Opening payment…' : `Buy ${p.credits} credits`}
              </button>
            )}
          </div>
        ))}
      </div>
      {!canBuy && <p className="body-sm muted">Only the account owner can buy Brief Packs.</p>}
      {buy.isError && <div role="alert" className="cm-error-line">{buy.error.message}</div>}
    </section>
  );
}
