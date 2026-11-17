import { useAuthStore } from '@/store/auth';
import { isNativeApp } from '@/lib/google';
import { PLAY_STORE_URL } from '@/lib/play-policy';

/** After paying on the website: point to the Android app and the account to
 *  sign in with (features/app-handoff-and-renewal-reminders.md). Never in the
 *  app itself. A plain link in the DifAi style, not Google's badge artwork. */
export function GetTheApp() {
  const email = useAuthStore((s) => s.user?.email);
  if (isNativeApp()) return null;
  return (
    <div className="cm-notice" role="note">
      <span>
        Use DifAi on your Android phone too.
        {email ? ` Sign in with the same account (${email}).` : ' Sign in with the same account.'}
      </span>
      <a className="btn btn-sm" href={PLAY_STORE_URL} target="_blank" rel="noopener noreferrer">
        Get the DifAi app on Google Play
      </a>
    </div>
  );
}
