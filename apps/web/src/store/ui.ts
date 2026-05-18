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

interface UIState {
  lang: Lang;
  theme: Theme;
  cmdK: boolean;
  toast: ToastModel | null;
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
  showToast: (toast: ToastModel) => void;
  hideToast: () => void;
  setForceMfaEnrollment: (v: boolean) => void;
}

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.style.colorScheme = theme;
}

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      lang: 'EN',
      theme: 'light',
      cmdK: false,
      toast: null,
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
      showToast: (toast) => set({ toast }),
      hideToast: () => set({ toast: null }),
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
