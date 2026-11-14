import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AiQuotaStatus, BillingCheckoutRequest, BillingStateResponse, OnboardingCompleteRequest, OnboardingCompleteResponse,
  SubscriptionInvoice,
} from '@lexdraft/types';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

/** Current plan + the plans on offer (/api/billing). */
export function useBilling(opts: { refetchInterval?: number | false } = {}) {
  return useQuery({
    queryKey: ['billing'],
    queryFn: () => api.get<BillingStateResponse>('/billing'),
    refetchInterval: opts.refetchInterval,
  });
}

/** Drafts used this cycle against the advocate's monthly limit (/api/me/ai-quota). */
export function useAiQuota() {
  return useQuery({
    queryKey: ['ai-quota'],
    queryFn: () => api.get<AiQuotaStatus>('/me/ai-quota'),
    staleTime: 60_000,
  });
}

/** GST tax invoices for the practice's subscription payments (owner only). */
export function useSubscriptionInvoices(enabled: boolean) {
  return useQuery({
    queryKey: ['billing', 'invoices'],
    queryFn: () => api.get<{ items: SubscriptionInvoice[] }>('/billing/invoices').then((r) => r.items),
    enabled,
  });
}

/** Downloads one invoice PDF (the request needs the session, so not a plain link). */
export async function downloadSubscriptionInvoice(inv: SubscriptionInvoice): Promise<void> {
  const blob = await api.getBlob(`/billing/invoices/${inv.id}/pdf`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${inv.invoiceNo.replace(/[^A-Za-z0-9-]/g, '_')}.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Opens Razorpay checkout (via /api/billing/pay) for the chosen plan. */
export function useStartCheckout() {
  return useMutation({
    mutationFn: (body: BillingCheckoutRequest) => api.post<{ checkoutUrl: string }>('/billing/checkout', body),
    onSuccess: (r) => window.location.assign(r.checkoutUrl),
  });
}

/** Same, from the sign-in page for an owner whose trial / plan ended. */
export function useRenewCheckout() {
  return useMutation({
    mutationFn: (body: BillingCheckoutRequest & { renewToken: string }) =>
      api.post<{ checkoutUrl: string }>('/billing/renew-checkout', body),
    onSuccess: (r) => window.location.assign(r.checkoutUrl),
  });
}

/** Finishes /onboarding: plan + practice details. Swaps in the updated user
 *  (role, plan) and, for Solo, hands back the Razorpay payment page. */
export function useCompleteOnboarding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: OnboardingCompleteRequest) =>
      api.post<OnboardingCompleteResponse>('/onboarding/complete', body),
    onSuccess: (r) => {
      // Paid plan: go straight to the Razorpay page. This must happen here, not
      // in the view: saving the onboarded session below routes away from
      // /onboarding at once, and a per-call onSuccess on an unmounted view
      // never runs (new sign-ups were landing in the app unpaid).
      if (r.checkoutUrl) { window.location.assign(r.checkoutUrl); return; }
      const { token, setSession } = useAuthStore.getState();
      if (token) setSession(r.user, token);
      void qc.invalidateQueries();
    },
  });
}
