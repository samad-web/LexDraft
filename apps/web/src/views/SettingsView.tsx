import { useNavigate } from 'react-router-dom';
import { Card } from '@lexdraft/ui';
import { useAuthStore } from '@/store/auth';
import { useSignOut } from '@/hooks/useAuth';

export function SettingsView() {
  const user = useAuthStore((s) => s.user);
  const signOut = useSignOut();
  const navigate = useNavigate();

  return (
    <div className="col stagger" style={{ gap: 24 }}>
      <div>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Preferences</div>
        <h1 className="heading-xl">Settings</h1>
      </div>

      <Card>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Account</div>
        <div className="col" style={{ gap: 10 }}>
          <Row label="Name" value={user?.name || '—'} />
          <Row label="Email" value={user?.email || '—'} />
          <Row label="Role" value={user?.role || '—'} />
          {user?.firm && <Row label="Firm" value={user.firm} />}
        </div>
      </Card>

      <Card>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Session</div>
        <button
          className="btn btn-oxblood"
          onClick={() => {
            signOut();
            navigate('/');
          }}
        >
          Sign out
        </button>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between' }}>
      <span className="muted body-sm">{label}</span>
      <span className="body-md">{value}</span>
    </div>
  );
}
