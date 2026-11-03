import { useEffect, useRef, type ReactNode } from 'react';
import { unlock, useLockStore } from '@/lib/app-lock';
import { Wordmark } from '@/components/brand/Logo';
import { useSplashStore } from '@/components/Splash';

/**
 * Covers the app while it is locked. The app stays mounted underneath (so
 * work in progress survives) but is made inert, so neither taps nor TalkBack
 * can reach it.
 */
export function AppLock({ children }: { children: ReactNode }) {
  const locked = useLockStore((s) => s.locked);
  const busy = useLockStore((s) => s.busy);
  const insecure = useLockStore((s) => s.insecureDevice);
  const splashing = useSplashStore((s) => s.showing);
  const appRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // React 18 has no `inert` prop.
    appRef.current?.toggleAttribute('inert', locked);
    // Wait for the launch animation so the prompt doesn't cover it.
    if (locked && !splashing) void unlock();
  }, [locked, splashing]);

  return (
    <>
      <div ref={appRef} style={{ display: 'contents' }} aria-hidden={locked || undefined}>
        {children}
      </div>
      {locked && (
        <div className="app-lock" role="dialog" aria-modal="true" aria-labelledby="app-lock-title">
          <Wordmark height={28} />
          <h1 id="app-lock-title" className="app-lock-title">DifAi is locked</h1>
          <p className="app-lock-sub">
            {insecure
              ? 'Set a screen lock on this phone to protect client data.'
              : 'Use your fingerprint, face or phone PIN to open your matters.'}
          </p>
          <button type="button" className="btn btn-primary btn-lg" onClick={() => void unlock()} disabled={busy}>
            {busy ? 'Waiting…' : 'Unlock'}
          </button>
        </div>
      )}
    </>
  );
}
