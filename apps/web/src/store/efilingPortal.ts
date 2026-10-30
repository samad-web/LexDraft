import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

// =============================================================================
// The advocate's connection to filing.ecourts.gov.in. eFiling starts the way
// the portal does - with the advocate's own login - and every eFiling screen
// works over that one server-side session until they log out.
//
// Kept in sessionStorage (this tab only): the portal allows one session per
// account, and it must not outlive the browser tab that opened it. Never
// holds the password - only the session id and who is connected.
// =============================================================================

export interface PortalConnection {
  sessionId: string;
  username: string;
  stateName: string;
  connectedAt: string;
}

interface State {
  connection: PortalConnection | null;
  /** The advocate chose to prepare filings without logging in (this tab). */
  offline: boolean;
  connect: (c: PortalConnection) => void;
  disconnect: () => void;
  setOffline: (v: boolean) => void;
}

export const useEfilingPortalStore = create<State>()(
  persist(
    (set) => ({
      connection: null,
      offline: false,
      connect: (connection) => set({ connection, offline: false }),
      disconnect: () => set({ connection: null }),
      setOffline: (offline) => set({ offline }),
    }),
    { name: 'difai.efiling.portal', version: 1, storage: createJSONStorage(() => sessionStorage) },
  ),
);
