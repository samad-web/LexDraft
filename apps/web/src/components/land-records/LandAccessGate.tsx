import { useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { INDIA_STATES } from '@/lib/india-states';
import { useLandAccess, useSaveLandState } from '@/hooks/useLandAccess';

/**
 * Land Records is for Tamil Nadu advocates (land-records-tn-gate.md). Renders
 * `children` only when access is available; otherwise asks for the state once,
 * or says Land Records for the advocate's state is coming soon / switched off.
 */
export function LandAccessGate({ children }: { children: React.ReactNode }) {
  const access = useLandAccess();
  const save = useSaveLandState();
  const [state, setState] = useState('');
  const [editing, setEditing] = useState(false);

  if (access.isLoading) return <div className="muted" aria-busy="true">Loading Land Records…</div>;
  if (access.isError || !access.data) return <div role="alert">Could not load Land Records. Please try again.</div>;
  if (access.data.status === 'available') return <>{children}</>;

  const header = <PageHeader title="Land Records" description="Patta, A-Register, FMB and TSLR records, fetched live from the state's land records site." />;
  const box = (body: React.ReactNode) => (
    <div className="col" style={{ gap: 20, maxWidth: 720 }}>{header}<section className="card" style={{ padding: 24 }}>{body}</section></div>
  );

  if (access.data.status === 'disabled') {
    return box(<p className="body">Land Records is switched off for now. Please check back later.</p>);
  }
  if (access.data.status === 'coming_soon' && !editing) {
    return box(
      <>
        <h2 className="heading-lg" style={{ marginBottom: 8 }}>Land Records for {access.data.state} is coming soon</h2>
        <p className="body muted">It works for Tamil Nadu advocates today. We will let you know when your state is added.</p>
        <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => setEditing(true)}>Change state</button>
      </>,
    );
  }
  // state_required: ask once, saved to the profile.
  return box(
    <form className="col" style={{ gap: 12 }} onSubmit={(e) => { e.preventDefault(); if (state) save.mutate(state, { onSuccess: () => setEditing(false) }); }}>
      <h2 className="heading-lg">Which state do you practise in?</h2>
      <p className="body-sm muted">Land Records is available for Tamil Nadu advocates today; other states are coming soon. We save this to your profile.</p>
      <label className="body-sm">State
        <select className="input" value={state} onChange={(e) => setState(e.target.value)} required>
          <option value="">Choose your state</option>
          {INDIA_STATES.map((s) => <option key={s.code} value={s.name}>{s.name}</option>)}
        </select>
      </label>
      {save.isError && <div role="alert" className="body-sm">{save.error.message}</div>}
      <button type="submit" className="btn btn-primary" disabled={!state || save.isPending}>{save.isPending ? 'Saving…' : 'Continue'}</button>
    </form>,
  );
}
