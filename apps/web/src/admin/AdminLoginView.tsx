import { useState, type FormEvent } from 'react';
import { useAdminSignIn } from '@/hooks/useAuth';
import { isMfaChallenge } from '@/lib/auth-types';

// Superadmin console sign-in, shown at /admin when signed out. Username +
// password only (no Google); the api refuses anyone who isn't a superadmin.
export function AdminLoginView() {
  const signIn = useAdminSignIn();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    signIn.mutate(
      { username: username.trim(), password },
      {
        onSuccess: (r) => {
          if (isMfaChallenge(r)) setProblem('This account uses two-factor authentication. Sign in from the main sign-in page.');
        },
        onError: (err) => setProblem(err.message || 'Invalid username or password'),
      },
    );
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'var(--bg-base)' }}>
      <form onSubmit={onSubmit} className="card" style={{ width: 380, maxWidth: '100%', padding: 28, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>DifAI</div>
          <h1 className="display" style={{ fontSize: 22, fontWeight: 600 }}>Admin sign in</h1>
        </div>
        <div>
          <label className="label required" htmlFor="admin-username">Username</label>
          <input
            id="admin-username"
            className="input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            required
          />
        </div>
        <div>
          <label className="label required" htmlFor="admin-password">Password</label>
          <input
            id="admin-password"
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>
        {problem && <div role="alert" className="body-sm" style={{ color: 'var(--danger)' }}>{problem}</div>}
        <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={signIn.isPending || !username.trim() || !password}>
          {signIn.isPending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
