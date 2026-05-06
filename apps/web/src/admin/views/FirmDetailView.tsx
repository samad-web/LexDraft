import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DatePicker, Select } from '@lexdraft/ui';
import type {
  BillingStatus, FeatureFlag, FeatureModule, FirmPlanTier, FirmStatus,
} from '@lexdraft/types';
import {
  useDeleteFirm, useFirm, useUpdateBranding, useUpdateFirm,
  useUpdateFlags, useUpdatePlan,
} from '../queries';

const ALL_MODULES: FeatureModule[] = [
  'drafting', 'cases', 'contracts', 'billing', 'research',
  'limitation', 'ecourts', 'analytics', 'firm_dashboard',
];
const PLAN_TIERS: FirmPlanTier[] = ['Solo', 'Practice', 'Firm'];
const BILLING_STATUSES: BillingStatus[] = ['trial', 'active', 'past_due', 'cancelled'];

export function FirmDetailView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: firm, isLoading } = useFirm(id);

  if (isLoading || !firm) {
    return <div style={{ padding: 32 }} className="muted">Loading firm…</div>;
  }

  return (
    <div style={{ padding: 32, maxWidth: 1320, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
      <Header firm={firm} onBack={() => navigate('/admin/firms')} />

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)', gap: 24 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <BrandingCard firmId={firm.id} initial={firm.branding} />
          <FlagsCard firmId={firm.id} initial={firm.flags} />
          <MembersCard firm={firm} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <PlanCard firmId={firm.id} initial={firm.plan} status={firm.status} />
          <DangerCard firmId={firm.id} status={firm.status} onDeleted={() => navigate('/admin/firms')} />
          <RecentAuditCard entries={firm.recentAudit} />
        </div>
      </div>
    </div>
  );
}

// ---------- header -----------------------------------------------------------

function Header({ firm, onBack }: { firm: NonNullable<ReturnType<typeof useFirm>['data']>; onBack: () => void }) {
  return (
    <div>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onBack} style={{ marginBottom: 8 }}>
        ← All firms
      </button>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
        <div>
          <div className="eyebrow">Firm</div>
          <h1 className="display" style={{ fontSize: 32, fontWeight: 600, letterSpacing: '-0.02em' }}>{firm.name}</h1>
          <div className="mono muted" style={{ fontSize: 12, marginTop: 4 }}>{firm.id}</div>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span className="badge">{firm.plan.tier}</span>
          <span className={`badge ${firm.status === 'active' ? 'badge-sage' : 'badge-vermillion'}`}>{firm.status}</span>
          <span className="mono">{firm.seatsUsed} / {firm.seats} seats</span>
          <span className="mono">{firm.caseCount} matters</span>
        </div>
      </div>
    </div>
  );
}

// ---------- branding ---------------------------------------------------------

function BrandingCard({ firmId, initial }: { firmId: string; initial: { displayName: string; logoUrl: string | null; accentColor: string | null } }) {
  const update = useUpdateBranding(firmId);
  const [name, setName] = useState(initial.displayName);
  const [logo, setLogo] = useState(initial.logoUrl ?? '');
  const [accent, setAccent] = useState(initial.accentColor ?? '');

  useEffect(() => { setName(initial.displayName); setLogo(initial.logoUrl ?? ''); setAccent(initial.accentColor ?? ''); }, [initial.displayName, initial.logoUrl, initial.accentColor]);

  return (
    <section className="card" style={{ padding: 24 }}>
      <h2 className="heading-lg" style={{ marginBottom: 16 }}>Branding</h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Field label="DISPLAY NAME">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="ACCENT COLOR (HEX)">
          <input className="input" value={accent} placeholder="#0A0A0A" onChange={(e) => setAccent(e.target.value)} />
        </Field>
        <Field label="LOGO URL" wide>
          <input className="input" value={logo} onChange={(e) => setLogo(e.target.value)} />
        </Field>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => update.mutate({
            displayName: name,
            logoUrl: logo.trim() === '' ? null : logo.trim(),
            accentColor: accent.trim() === '' ? null : accent.trim(),
          })}
          disabled={update.isPending}
        >
          {update.isPending ? 'Saving…' : 'Save branding'}
        </button>
      </div>
    </section>
  );
}

// ---------- flags ------------------------------------------------------------

function FlagsCard({ firmId, initial }: { firmId: string; initial: FeatureFlag[] }) {
  const update = useUpdateFlags(firmId);
  const [flags, setFlags] = useState<Record<FeatureModule, boolean>>(() => {
    const map = {} as Record<FeatureModule, boolean>;
    for (const m of ALL_MODULES) map[m] = initial.find((f) => f.module === m)?.enabled ?? true;
    return map;
  });

  return (
    <section className="card" style={{ padding: 24 }}>
      <h2 className="heading-lg" style={{ marginBottom: 4 }}>Feature flags</h2>
      <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
        Toggle modules on/off for this firm. Disabled modules are hidden in the firm's app shell.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
        {ALL_MODULES.map((module) => (
          <label
            key={module}
            style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: 12,
              border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={flags[module]}
              onChange={(e) => setFlags((p) => ({ ...p, [module]: e.target.checked }))}
            />
            <span style={{ textTransform: 'capitalize' }}>{module.replace('_', ' ')}</span>
          </label>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => update.mutate({ flags: ALL_MODULES.map((m) => ({ module: m, enabled: flags[m] })) })}
          disabled={update.isPending}
        >
          {update.isPending ? 'Saving…' : 'Save flags'}
        </button>
      </div>
    </section>
  );
}

// ---------- members ----------------------------------------------------------

function MembersCard({ firm }: { firm: NonNullable<ReturnType<typeof useFirm>['data']> }) {
  return (
    <section className="card" style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 className="heading-lg">Members · {firm.members.length}</h2>
      </div>
      {firm.members.length === 0 ? (
        <div className="muted">No members yet.</div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {firm.members.map((m) => (
              <tr key={m.id}>
                <td>{m.name}{m.isSuperadmin && <span className="badge badge-vermillion mono" style={{ marginLeft: 8, fontSize: 9 }}>SUPER</span>}</td>
                <td className="mono" style={{ fontSize: 12 }}>{m.email}</td>
                <td>{m.role}</td>
                <td>
                  <span className={`badge ${m.status === 'active' ? 'badge-sage' : 'badge-vermillion'}`}>{m.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ---------- plan -------------------------------------------------------------

function PlanCard({ firmId, initial, status }: { firmId: string; initial: { tier: FirmPlanTier; status: BillingStatus; mrrInr: number; renewsAt: string | null }; status: FirmStatus }) {
  const update = useUpdatePlan(firmId);
  const updateFirm = useUpdateFirm(firmId);
  const [tier, setTier]   = useState<FirmPlanTier>(initial.tier);
  const [bs, setBs]       = useState<BillingStatus>(initial.status);
  const [mrr, setMrr]     = useState(initial.mrrInr);
  const [renews, setRenews] = useState(initial.renewsAt ?? '');

  return (
    <section className="card" style={{ padding: 24 }}>
      <h2 className="heading-lg" style={{ marginBottom: 16 }}>Plan & billing</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="TIER">
          <Select
            value={tier}
            onChange={(v) => setTier(v as FirmPlanTier)}
            options={PLAN_TIERS.map((t) => ({ value: t, label: t }))}
          />
        </Field>
        <Field label="BILLING STATUS">
          <Select
            value={bs}
            onChange={(v) => setBs(v as BillingStatus)}
            options={BILLING_STATUSES.map((s) => ({ value: s, label: s }))}
          />
        </Field>
        <Field label="MRR (₹)">
          <input className="input" type="number" value={mrr} onChange={(e) => setMrr(Number(e.target.value))} />
        </Field>
        <Field label="RENEWS ON">
          <DatePicker value={renews} onChange={setRenews} />
        </Field>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => update.mutate({ tier, status: bs, mrrInr: mrr, renewsAt: renews || null })}
          disabled={update.isPending}
        >
          {update.isPending ? 'Saving…' : 'Save plan'}
        </button>
      </div>
      <div style={{ borderTop: '1px solid var(--border-subtle)', marginTop: 20, paddingTop: 16 }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Tenant status</div>
        {status === 'active' ? (
          <button type="button" className="btn" onClick={() => updateFirm.mutate({ status: 'suspended' })}>
            Suspend firm
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => updateFirm.mutate({ status: 'active' })}>
            Reactivate firm
          </button>
        )}
      </div>
    </section>
  );
}

// ---------- danger zone ------------------------------------------------------

function DangerCard({ firmId, status: _status, onDeleted }: { firmId: string; status: FirmStatus; onDeleted: () => void }) {
  const del = useDeleteFirm();
  const [confirmText, setConfirmText] = useState('');
  return (
    <section className="card" style={{ padding: 24, borderColor: 'var(--danger)' }}>
      <h2 className="heading-lg" style={{ color: 'var(--danger)', marginBottom: 8 }}>Danger zone</h2>
      <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
        Deleting cascades to all cases, members, and templates owned by this firm. Type <code>DELETE</code> to enable.
      </p>
      <input className="input" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="DELETE" />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
        <button
          type="button"
          className="btn"
          style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
          disabled={confirmText !== 'DELETE' || del.isPending}
          onClick={async () => { await del.mutateAsync(firmId); onDeleted(); }}
        >
          {del.isPending ? 'Deleting…' : 'Delete firm permanently'}
        </button>
      </div>
    </section>
  );
}

// ---------- recent audit -----------------------------------------------------

function RecentAuditCard({ entries }: { entries: NonNullable<ReturnType<typeof useFirm>['data']>['recentAudit'] }) {
  return (
    <section className="card" style={{ padding: 24 }}>
      <h2 className="heading-lg" style={{ marginBottom: 12 }}>Recent activity</h2>
      {entries.length === 0 ? (
        <div className="muted">No activity yet.</div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {entries.map((e) => (
            <li key={e.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: 13, paddingBottom: 8, borderBottom: '1px solid var(--border-subtle)' }}>
              <div>
                <div className="mono" style={{ fontSize: 11 }}>{e.action}</div>
                <div className="muted" style={{ fontSize: 11 }}>{e.actorEmail}</div>
              </div>
              <div className="mono muted" style={{ fontSize: 11 }}>{new Date(e.createdAt).toLocaleString()}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------- field helper -----------------------------------------------------

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, gridColumn: wide ? '1 / -1' : undefined }}>
      <span className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{label}</span>
      {children}
    </label>
  );
}
