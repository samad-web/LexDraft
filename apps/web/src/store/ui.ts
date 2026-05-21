import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Lang = 'EN' | 'HI' | 'TA';
export type Theme = 'light' | 'dark';

export type ToastType = 'sage' | 'cobalt' | 'amber' | 'vermillion';

export interface ToastModel {
  type: ToastType;
  text: string;
  /** Optional action button rendered alongside the toast text — e.g. "Undo". */
  action?: { label: string; onClick: () => void };
  /** Override the default auto-hide duration (ms). Default 4000. */
  durationMs?: number;
}

/**
 * Cap-exceeded modal payload. Pushed by the axios interceptor when the API
 * returns a 429 ai_quota_exceeded or 402 seat_cap_exceeded. Rendered by
 * `<CapExceededModal />` mounted at the app shell.
 */
export interface CapPromptModel {
  kind: 'ai_quota' | 'seat_cap';
  cap: number;
  used: number;
  /** ISO timestamp when the quota resets — only meaningful for ai_quota. */
  resetsAt?: string;
  /** 'Solo' | 'Practice' | 'Firm' | null. Used to render the upgrade CTA. */
  planTier?: string | null;
}

interface UIState {
  lang: Lang;
  theme: Theme;
  cmdK: boolean;
  /**
   * Mobile-only drawer state for the main sidebar. The shell renders the
   * sidebar inline on ≥768px and as a slide-in drawer on smaller screens;
   * this flag controls the drawer's open/closed state.
   */
  sidebarOpen: boolean;
  toast: ToastModel | null;
  capPrompt: CapPromptModel | null;
  /**
   * Set to true on sign-in when the server reports `mustEnrollMfa` (the
   * user's role mandates MFA but no factor is on file). The MfaPromptBanner
   * reads this flag to decide whether to mount; it's cleared back to false
   * when enrolment completes or the session ends.
   *
   * Intentionally NOT persisted - it derives from the live sign-in response,
   * not user preference, so it should reset on every page reload (the next
   * /me + status fetch will refresh the true state).
   */
  forceMfaEnrollment: boolean;
  setLang: (l: Lang) => void;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  toggleCmdK: (open?: boolean) => void;
  toggleSidebar: (open?: boolean) => void;
  showToast: (toast: ToastModel) => void;
  hideToast: () => void;
  showCapPrompt: (p: CapPromptModel) => void;
  hideCapPrompt: () => void;
  setForceMfaEnrollment: (v: boolean) => void;
}

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.style.colorScheme = theme;
}

/** Read the user's OS-level preference. Defaults to light if unknown. */
function systemPreference(): Theme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      lang: 'EN',
      // System-preference is the first-load default. Once the user has
      // toggled, the persist middleware overrides this with their choice.
      theme: systemPreference(),
      cmdK: false,
      sidebarOpen: false,
      toast: null,
      capPrompt: null,
      forceMfaEnrollment: false,
      setLang: (lang) => set({ lang }),
      setForceMfaEnrollment: (forceMfaEnrollment) => set({ forceMfaEnrollment }),
      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
      },
      toggleTheme: () => {
        const next: Theme = get().theme === 'light' ? 'dark' : 'light';
        applyTheme(next);
        set({ theme: next });
      },
      toggleCmdK: (open) => set((s) => ({ cmdK: open ?? !s.cmdK })),
      toggleSidebar: (open) => set((s) => ({ sidebarOpen: open ?? !s.sidebarOpen })),
      showToast: (toast) => set({ toast }),
      hideToast: () => set({ toast: null }),
      showCapPrompt: (capPrompt) => set({ capPrompt }),
      hideCapPrompt: () => set({ capPrompt: null }),
    }),
    {
      name: 'lexdraft-ui',
      partialize: (s) => ({ lang: s.lang, theme: s.theme }),
    },
  ),
);

/** Apply persisted preferences to <html> on first load. */
export function hydrateUIAttributes(): void {
  const { theme } = useUIStore.getState();
  applyTheme(theme);
}
