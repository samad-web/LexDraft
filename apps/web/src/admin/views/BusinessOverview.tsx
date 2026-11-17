import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { AdminBusinessOverview } from '@lexdraft/types';
import { api } from '@/lib/api';

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;
const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

/** Revenue by current plan, plans ending soon, sign-ups that never paid (admin-firm-360). */
export function BusinessOverview() {
  const { data, isLoading, isError } = useQuery({ queryKey: ['admin', 'business'], queryFn: () => api.get<AdminBusinessOverview>('/admin/business') });
  if (isLoading) return <section className="card" style={{ padding: 24 }} aria-busy="true"><div className="muted">Loading plans…</div></section>;
  if (isError || !data) return <section className="card" style={{ padding: 24 }}><div role="alert">Could not load the plan overview.</div></section>;
  return (
    <div className="grid-2" style={{ gap: 20 }}>
      <section className="card" style={{ padding: 24 }} aria-labelledby="mix-h">
        <div className="row" style={{ alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
          <h2 id="mix-h" className="heading-lg">Plans</h2>
          <span className="spacer" />
          <span className="body-sm muted">MRR {inr(data.mrrInr)} · ARR {inr(data.arrInr)} (excl. GST)</span>
        </div>
        {data.planMix.length === 0 ? <div className="muted body-sm" style={{ marginTop: 12 }}>No active firms.</div> : (
          <table className="tbl" style={{ marginTop: 12 }}>
            <thead><tr><th>Plan</th><th style={{ textAlign: 'right' }}>Firms</th><th style={{ textAlign: 'right' }}>Paid now</th><th style={{ textAlign: 'right' }}>MRR</th></tr></thead>
            <tbody>
              {data.planMix.map((p) => (
                <tr key={p.plan}>
                  <td>{p.label}</td>
                  <td className="mono tabular" style={{ textAlign: 'right' }}>{p.firms}</td>
                  <td className="mono tabular" style={{ textAlign: 'right' }}>{p.paidFirms}</td>
                  <td className="mono tabular" style={{ textAlign: 'right' }}>{inr(p.mrrInr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="card" style={{ padding: 24 }} aria-labelledby="todo-h">
        <h2 id="todo-h" className="heading-lg" style={{ marginBottom: 12 }}>Needs attention</h2>
        <h3 className="eyebrow" style={{ marginBottom: 6 }}>Plan ends in 7 days · {data.endingSoon.length}</h3>
        {data.endingSoon.length === 0 ? <div className="muted body-sm">None.</div> : (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {data.endingSoon.slice(0, 8).map((e) => (
              <li key={e.firmId} className="body-sm"><Link to={`/admin/firms/${e.firmId}`}>{e.name}</Link> · {e.plan} · ends {day(e.renewsAt)}</li>
            ))}
          </ul>
        )}
        <h3 className="eyebrow" style={{ margin: '16px 0 6px' }}>Signed up, never paid · {data.stuckSignups.length}</h3>
        {data.stuckSignups.length === 0 ? <div className="muted body-sm">None.</div> : (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {data.stuckSignups.slice(0, 8).map((s) => (
              <li key={s.firmId} className="body-sm"><Link to={`/admin/firms/${s.firmId}`}>{s.name}</Link> · {s.plan} · {day(s.createdAt)}{s.ownerEmail ? ` · ${s.ownerEmail}` : ''}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
