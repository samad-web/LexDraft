import { useNavigate } from 'react-router-dom';
import { LogoMark, Wordmark } from '@/components/brand/Logo';

// =============================================================================
// AppWelcomeView - the Android app's first screen for a signed-out user.
//
// The app used to open straight onto the sign-in form. Now the brand comes
// first: the seal settles in, the DifAi name and line appear, then the two
// ways forward rise into place - Sign in (existing members) and Create your
// free account (the sign-up flow). The website keeps its landing page; this is
// only rendered on the native platform (see App.tsx).
// =============================================================================

export function AppWelcomeView() {
  const navigate = useNavigate();
  return (
    <main className="welcome">
      <div className="welcome-brand">
        <span className="welcome-mark"><LogoMark size={104} title="DifAi" /></span>
        <h1 className="welcome-name"><Wordmark /></h1>
        <p className="welcome-line">Your legal practice, drafted with AI.</p>
      </div>

      <div className="welcome-actions">
        <button type="button" className="btn btn-primary btn-lg btn-block btn-pill" onClick={() => navigate('/auth')}>
          Sign in
        </button>
        <button type="button" className="btn btn-lg btn-block btn-pill" onClick={() => navigate('/signup')}>
          Create your free account
        </button>
        <p className="welcome-note">Free for advocates &amp; law students till 1 June 2027</p>
      </div>
    </main>
  );
}
