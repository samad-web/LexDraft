import { useQuery } from '@tanstack/react-query';
import type { AdminActivationFunnel } from '@lexdraft/types';
import { api } from '@/lib/api';

const week = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
/** "3 · 60%" — share of the row's sign-ups (or of `of` when given). */
const cell = (n: number, of: number) => (of > 0 ? `${n} · ${Math.round((n / of) * 100)}%` : String(n));

/** Sign-up → paid → first draft → active in week 2 → paid again (activation-funnel.md). */
export function ActivationFunnel() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin', 'business', 'funnel'],
    queryFn: () => api.get<AdminActivationFunnel>('/admin/business/funnel'),
  });
  if (isLoading) return <section className="card" style={{ padding: 24 }} aria-busy="true"><div className="muted">Loading sign-up funnel…</div></section>;
  if (isError || !data) return <section className="card" style={{ padding: 24 }}><div role="alert">Could not load the sign-up funnel.</div></section>;
  return (
    <section className="card" style={{ padding: 24 }} aria-labelledby="funnel-h">
      <div className="row" style={{ alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <h2 id="funnel-h" className="heading-lg">Sign-up funnel</h2>
        <span className="spacer" />
        <span className="body-sm muted">By sign-up week · test, admin and free-launch firms left out</span>
      </div>
      <div style={{ overflowX: 'auto', marginTop: 12 }}>
        <table className="tbl">
          <caption className="sr-only">Firms by sign-up week and how far each got</caption>
          <thead>
            <tr>
              <th scope="col">Week of</th>
              <th scope="col" style={{ textAlign: 'right' }}>Signed up</th>
              <th scope="col" style={{ textAlign: 'right' }}>Paid</th>
              <th scope="col" style={{ textAlign: 'right' }}>First draft</th>
              <th scope="col" style={{ textAlign: 'right' }} title="Of paid firms whose second week is over">Active week 2</th>
              <th scope="col" style={{ textAlign: 'right' }}>Paid again</th>
            </tr>
          </thead>
          <tbody>
            {data.weeks.map((w) => (
              <tr key={w.weekStart}>
                <th scope="row" style={{ fontWeight: 'normal' }}>{week(w.weekStart)}</th>
                <td className="mono tabular" style={{ textAlign: 'right' }}>{w.signedUp}</td>
                <td className="mono tabular" style={{ textAlign: 'right' }}>{cell(w.paid, w.signedUp)}</td>
                <td className="mono tabular" style={{ textAlign: 'right' }}>{cell(w.firstDraft, w.signedUp)}</td>
                <td className="mono tabular" style={{ textAlign: 'right' }}>{w.week2Due > 0 ? cell(w.activeWeek2, w.week2Due) : '—'}</td>
                <td className="mono tabular" style={{ textAlign: 'right' }}>{cell(w.paidAgain, w.paid)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
