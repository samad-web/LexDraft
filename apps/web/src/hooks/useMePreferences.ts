import { useMutation } from '@tanstack/react-query';
import type { User } from '@lexdraft/types';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

/**
 * Patch the current user's preferences. Today this is just the BCP-47
 * default language used by AI features (Mock Arguments); future prefs land
 * here too. On success the auth store is refreshed in place so the new
 * value is visible everywhere `user.defaultLanguageCode` is read without
 * a re-login.
 */
export interface PreferencesInput {
  defaultLanguageCode?: string;
}

export function useUpdatePreferences() {
  const refreshUser = useAuthStore((s) => s.refreshUser);
  return useMutation({
    mutationFn: (input: PreferencesInput) =>
      api.patch<User>('/me/preferences', input),
    onSuccess: (user) => {
      refreshUser(user);
    },
  });
}
