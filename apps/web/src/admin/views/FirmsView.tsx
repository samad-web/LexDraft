import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Select } from '@lexdraft/ui';
import type { FirmPlanTier } from '@lexdraft/types';
import { useCreateFirm, useFirms } from '../queries';

export function FirmsView() {
  const { data: firms = [], isLoading } = useFirms();
  const [creating, setCreating] = useState(false);

  return (
    <div style={{ padding: 32, maxWidth: 1320, margin: '0 auto' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 24 }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Tenants</div>
          <h1 className="display" style={{ fontSize: 28, fontWeight: 600 }}>Firms · {firms.length}</h1>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>+ Create firm</button>
      </header>

      {isLoading ? (
        <div className="muted">Loading firms…</div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Firm</th>
              <th style={{ width: 140 }}>Plan</th>
              <th style={{ width: 100 }}>Seats</th>
              <th style={{ width: 100 }}>Matters</th>
              <th style={{ width: 130 }}>MRR</th>
              <th style={{ width: 120 }}>Status</th>
              <th style={{ width: 60 }} />
            </tr>
          </thead>
          <tbody>
            {firms.map((f) => (
              <tr key={f.id}>
                <td>
                  <Link to={`/admin/firms/${f.id}`} className="no-underline" style={{ fontWeight: 500 }}>
                    {f.name}
                  </Link>
                  <div className="mono muted" style={{ fontSize: 11 }}>{f.id.slice(0, 8)}</div>
                </td>
                <td><span className="badge">{f.plan.tier}</span></td>
                <td className="mono">{f.seatsUsed} / {f.seats}</td>
                <td className="mono">{f.caseCount}</td>
                <td className="mono">₹{f.plan.mrrInr.toLocaleString('en-IN')}</td>
                <td>
                  <span className={`badge ${f.status === 'active' ? 'badge-sage' : 'badge-vermillion'}`}>
                    {f.status}
                  </span>
                </td>
                <td>
                  <Link to={`/admin/firms/${f.id}`} className="no-underline">Open →</Link>
                </td>
              </tr>
            ))}
            {firms.length === 0 && (
              <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 32 }}>No firms yet — create one.</td></tr>
            )}
          </tbody>
        </table>
      )}

      {creating && <CreateFirmModal onClose={() => setCreating(false)} />}
    </div>
  );
}

function CreateFirmModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [seats, setSeats] = useState(8);
  const [plan, setPlan] = useState<FirmPlanTier>('Practice');
  const create = useCreateFirm();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await create.mutateAsync({ name: name.trim(), seats, plan });
    onClose();
  };

  return (
    <div
      role="dialog"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(10,10,10,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
      }}
    >
      <form
        onSubmit={submit}
        style={{
          background: 'var(--bg-base)', border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)', padding: 28, width: 480,
          display: 'flex', flexDirection: 'column', gap: 16,
        }}
      >
        <div className="eyebrow">New firm</div>
        <h3 className="display" style={{ fontSize: 22, fontWeight: 600 }}>Create a tenant</h3>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>FIRM NAME</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className="input" autoFocus required />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>SEATS</span>
          <input type="number" min={1} max={500} value={seats} onChange={(e) => setSeats(Number(e.target.value))} className="input" />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>PLAN</span>
          <Select
            value={plan}
            onChange={(v) => setPlan(v as FirmPlanTier)}
            options={[
              { value: 'Solo', label: 'Solo' },
              { value: 'Practice', label: 'Practice' },
              { value: 'Firm', label: 'Firm' },
            ]}
          />
        </label>
        {create.isError && <div className="muted" style={{ color: 'var(--danger)' }}>Failed to create firm.</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create firm'}
          </button>
        </div>
      </form>
    </div>
  );
}
