import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Lang = 'EN' | 'HI' | 'TA';
export type Theme = 'light' | 'dark';

interface UIState {
  lang: Lang;
  theme: Theme;
  cmdK: boolean;
  toast: { type: 'sage' | 'cobalt' | 'amber' | 'vermillion'; text: string } | null;
  setLang: (l: Lang) => void;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  toggleCmdK: (open?: boolean) => void;
  showToast: (toast: { type: 'sage' | 'cobalt' | 'amber' | 'vermillion'; text: string }) => void;
  hideToast: () => void;
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
      setLang: (lang) => set({ lang }),
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
