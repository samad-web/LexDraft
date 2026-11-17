import { useNavigate } from 'react-router-dom';
import { Wordmark } from '@/components/brand/Logo';
import { useSignOut } from '@/hooks/useAuth';
import { NATIVE_COPY } from '@/lib/play-policy';

// =============================================================================
// AppWelcomeView - the Android app's first screen for a signed-out user.
//
// The brand comes first: the seal settles in, the DifAi name and line appear,
// then Sign in rises into place. The app is sign-in only (Play payments
// policy, features/play-sign-in-only.md): no sign-up, no prices. The website
// keeps its landing page; this is only rendered on the native platform
// (see App.tsx).
// =============================================================================

export function AppWelcomeView() {
  const navigate = useNavigate();
  return (
    <main className="welcome">
      <div className="welcome-brand">
        <h1 className="welcome-name"><Wordmark height={64} motion /></h1>
        <p className="welcome-line">Your legal practice, drafted with AI.</p>
      </div>

      <div className="welcome-actions">
        <button type="button" className="btn btn-primary btn-lg btn-block btn-pill" onClick={() => navigate('/auth')}>
          Sign in
        </button>
        <p className="welcome-note">{NATIVE_COPY.welcome}</p>
      </div>
    </main>
  );
}

/** Android app, signed in but onboarding (plan + payment) not finished: a
 *  neutral notice in place of OnboardingView. Sign out is the only action. */
export function NativeSetupIncompleteView() {
  const signOut = useSignOut();
  return (
    <main className="welcome">
      <div className="welcome-brand">
        <h1 className="welcome-name"><Wordmark height={64} /></h1>
        <p className="welcome-line" role="status">{NATIVE_COPY.setupIncomplete}</p>
      </div>
      <div className="welcome-actions">
        <button type="button" className="btn btn-lg btn-block btn-pill" onClick={signOut}>
          Sign out
        </button>
      </div>
    </main>
  );
}
