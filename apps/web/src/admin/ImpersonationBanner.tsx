import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';
import { adminApi } from './api';

export function ImpersonationBanner() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const actAs = useAuthStore((s) => s.actAs);
  const endImpersonation = useAuthStore((s) => s.endImpersonation);

  if (!actAs || !user) return null;

  const handleEnd = async () => {
    try { await adminApi.endImpersonation(user.id); } catch { /* best-effort */ }
    endImpersonation();
    navigate('/admin');
  };

  return (
    <div
      role="alert"
      style={{
        background: '#0A0A0A',
        color: '#FAFAFA',
        padding: '10px 24px',
        display: 'flex',
        gap: 16,
        alignItems: 'center',
        justifyContent: 'space-between',
        fontSize: 13,
        borderBottom: '1px solid var(--border-default)',
      }}
    >
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <span
          className="mono"
          style={{ fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', opacity: 0.7 }}
        >
          Impersonating
        </span>
        <span>
          <strong>{user.name}</strong>
          <span style={{ opacity: 0.6, marginLeft: 8 }}>· {user.email}</span>
          {user.firm && <span style={{ opacity: 0.6, marginLeft: 8 }}>· {user.firm}</span>}
        </span>
        <span className="mono" style={{ fontSize: 11, opacity: 0.6 }}>
          as {actAs.adminEmail}
        </span>
      </div>
      <button
        type="button"
        onClick={handleEnd}
        className="btn btn-sm"
        style={{
          background: '#FAFAFA',
          color: '#0A0A0A',
          borderColor: '#FAFAFA',
        }}
      >
        End impersonation
      </button>
    </div>
  );
}
