import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PortalSession } from '@lexdraft/types';

interface PortalAuthState {
  client: PortalSession['client'] | null;
  token: string | null;
  expiresAt: string | null;
  setSession: (session: PortalSession) => void;
  clear: () => void;
}

/**
 * Storage for the read-only client-portal session. Deliberately separate
 * from the advocate session in `useAuthStore` so a single browser can hold
 * both at once (e.g. an advocate testing the portal as a client) without
 * either overwriting the other.
 */
export const usePortalAuthStore = create<PortalAuthState>()(
  persist(
    (set) => ({
      client: null,
      token: null,
      expiresAt: null,
      setSession: (session) =>
        set({ client: session.client, token: session.token, expiresAt: session.expiresAt }),
      clear: () => set({ client: null, token: null, expiresAt: null }),
    }),
    { name: 'lexdraft-portal-auth' },
  ),
);
