import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BillingCheckoutRequest, BillingStateResponse, OnboardingCompleteRequest, OnboardingCompleteResponse,
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

/** Opens Dodo's hosted checkout for the chosen plan. */
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
 *  (role, plan) and, for Solo, hands back Dodo's payment page. */
export function useCompleteOnboarding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: OnboardingCompleteRequest) =>
      api.post<OnboardingCompleteResponse>('/onboarding/complete', body),
    onSuccess: (r) => {
      const { token, setSession } = useAuthStore.getState();
      if (token) setSession(r.user, token);
      void qc.invalidateQueries();
    },
  });
}
