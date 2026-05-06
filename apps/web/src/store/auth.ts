import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@lexdraft/types';

export interface ActAs {
  adminId: string;
  adminEmail: string;
}

interface PreviousSession {
  user: User;
  token: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  /** Admin id+email when this session is an impersonation, otherwise null. */
  actAs: ActAs | null;
  /** The admin's prior session, kept so "End impersonation" can swap back without a re-login. */
  previousSession: PreviousSession | null;
  setSession: (user: User, token: string) => void;
  startImpersonation: (target: User, token: string, actAs: ActAs) => void;
  endImpersonation: () => void;
  clear: () => void;
}

/** Decode a JWT payload without verification — for surfacing the actAs claim to the UI. */
function decodeActAs(token: string): ActAs | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    if (json && typeof json === 'object' && json.actAs && typeof json.actAs.adminId === 'string') {
      return { adminId: json.actAs.adminId, adminEmail: json.actAs.adminEmail };
    }
  } catch {
    // ignore malformed tokens — caller treats as no impersonation
  }
  return null;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      actAs: null,
      previousSession: null,
      setSession: (user, token) => set({ user, token, actAs: decodeActAs(token), previousSession: null }),
      startImpersonation: (target, token, actAs) => {
        const current = get();
        const prior = current.user && current.token
          ? { user: current.user, token: current.token }
          : null;
        set({ user: target, token, actAs, previousSession: prior });
      },
      endImpersonation: () => {
        const prior = get().previousSession;
        if (prior) set({ user: prior.user, token: prior.token, actAs: null, previousSession: null });
        else set({ actAs: null, previousSession: null });
      },
      clear: () => set({ user: null, token: null, actAs: null, previousSession: null }),
    }),
    { name: 'lexdraft-auth' },
  ),
);
