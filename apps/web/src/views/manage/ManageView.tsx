import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { PillNav } from '@/components/PillNav';
import { useMeFeatures } from '@/hooks/useFirmAdmin';
import { ManageUsersPanel } from './ManageUsersPanel';
import { ManageInvitationsPanel } from './ManageInvitationsPanel';
import { ManageRolesPanel } from './ManageRolesPanel';
import { ManagePracticeGroupsPanel } from './ManagePracticeGroupsPanel';
import { ManageAuditPanel } from './ManageAuditPanel';

type TabId = 'users' | 'roles' | 'groups' | 'invitations' | 'audit';

const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: 'users',       label: 'Users' },
  { id: 'roles',       label: 'Roles' },
  { id: 'groups',      label: 'Practice groups' },
  { id: 'invitations', label: 'Invitations' },
  { id: 'audit',       label: 'Audit' },
];

/**
 * Firm-Admin Console — User Management section per spec §7.
 *
 * Gated on the `admin.users` feature: the resolver only grants this when the
 * user's plan and role both include it (Firm Admin role on Practice/Firm
 * plan). Other users are bounced back to the dashboard.
 */
export function ManageView() {
  const features = useMeFeatures();
  const [tab, setTab] = useState<TabId>('users');

  if (features.isLoading) {
    return <div className="muted">Checking access…</div>;
  }

  const granted = features.data?.features ?? [];
  if (!granted.includes('admin.users')) {
    return <Navigate to="/app/dashboard" replace />;
  }

  const canSeeAudit = granted.includes('admin.audit');
  const visibleTabs = TABS.filter((t) => t.id !== 'audit' || canSeeAudit);

  return (
    <div className="col stagger" style={{ gap: 24 }}>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          flexWrap: 'wrap',
          gap: 16,
        }}
      >
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Firm administration</div>
          <h1 className="display-md">User management</h1>
          <p className="body-md muted" style={{ marginTop: 8, maxWidth: 640 }}>
            Manage who is in your firm, what they can do, and how they're organised. Roles,
            practice groups, and audit are scoped to your firm only.
          </p>
        </div>
      </header>

      <PillNav
        items={visibleTabs}
        value={tab}
        onChange={setTab}
        ariaLabel="User management sections"
      />

      <div>
        {tab === 'users'       && <ManageUsersPanel />}
        {tab === 'roles'       && <ManageRolesPanel />}
        {tab === 'groups'      && <ManagePracticeGroupsPanel />}
        {tab === 'invitations' && <ManageInvitationsPanel />}
        {tab === 'audit'       && canSeeAudit && <ManageAuditPanel />}
      </div>
    </div>
  );
}
