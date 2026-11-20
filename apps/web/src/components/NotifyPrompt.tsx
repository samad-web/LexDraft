import { useState } from 'react';
import { Icon } from '@lexdraft/ui';
import { usePushNotifications } from '@/hooks/usePush';
import { useAuthStore } from '@/store/auth';

// "Turn on notifications" where advocates will see it (reminders.md): a slim
// banner over the page until turned on or dismissed, and a row in the bell
// panel. Hidden where web push can't work (the Android app uses its own push).

const dismissKey = (userId: string) => `difai-notify-prompt-dismissed:${userId}`;

function readDismissed(userId: string | undefined): boolean {
  if (!userId) return true;
  try { return localStorage.getItem(dismissKey(userId)) === '1'; } catch { return false; }
}

export function NotifyPrompt({ variant }: { variant: 'banner' | 'row' }) {
  const userId = useAuthStore((s) => s.user?.id);
  const push = usePushNotifications();
  const [dismissed, setDismissed] = useState(() => variant === 'banner' && readDismissed(userId));

  const offerable = push.state === 'off' || push.state === 'ios-install';
  if (!offerable || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try { if (userId) localStorage.setItem(dismissKey(userId), '1'); } catch { /* private mode */ }
  };

  const text = push.state === 'ios-install'
    ? 'On iPhone, add DifAi to your Home Screen (Share → Add to Home Screen) to get hearing reminders as notifications.'
    : 'Get hearing reminders on this device, even when DifAi is closed.';

  return (
    <div className={`notify-prompt notify-prompt--${variant}`} role="status">
      <Icon name="bell" size={15} aria-hidden />
      <span className="notify-prompt-text">{text}</span>
      {push.state === 'off' && (
        <button type="button" className="btn btn-primary btn-sm" disabled={push.busy} onClick={() => void push.enable()}>
          {push.busy ? 'Turning on…' : 'Turn on'}
        </button>
      )}
      {variant === 'banner' && (
        <button type="button" className="btn btn-ghost btn-sm" aria-label="Dismiss" onClick={dismiss}>
          <Icon name="close" size={13} />
        </button>
      )}
    </div>
  );
}
