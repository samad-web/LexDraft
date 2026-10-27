import { useNavigate } from 'react-router-dom';
import { EmptyState, Icon } from '@lexdraft/ui';
import type { ReactNode } from 'react';
import type { MatterTimelineEvent, Task } from '@lexdraft/types';
import { FilingsList } from '@/components/efiling/FilingsList';
import { ApplicationsPanel } from '@/components/ApplicationsPanel';
import { useLimitations } from '@/hooks/useLimitations';
import { useCan } from '@/hooks/useFirmAdmin';
import { useInvoices } from '@/hooks/useInvoices';
import { useExpenses } from '@/hooks/useExpenses';

// =============================================================================
// The matter-scoped tabs of CaseDetailView: Hearings, Filings, Tasks &
// Deadlines, Billing. Each reads existing firm-wide data and narrows it to this
// matter. Tasks, limitations and expenses carry `caseId` (migration 0089);
// rows without one (unmatched, or DB not yet migrated) fall back to the old
// title / CNR text match. Invoices are per client, and the tab says so.
// =============================================================================

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/** Linked by id, else (only when unlinked) by the matter's title / CNR text. */
export function belongsToMatter(
  row: { caseId?: string | null; label: string; cnr?: string },
  matter: { id: string; title: string; cnr?: string },
): boolean {
  if (row.caseId) return row.caseId === matter.id;
  if (matter.cnr && row.cnr && norm(row.cnr) === norm(matter.cnr)) return true;
  return norm(row.label) === norm(matter.title);
}

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function SectionHead({ title, count, action }: { title: string; count?: number; action?: ReactNode }) {
  return (
    <div className="row" style={{ alignItems: 'center', gap: 10, marginBottom: 12 }}>
      <h2 className="heading-md">{title}</h2>
      {count !== undefined && <span className="badge">{count}</span>}
      <span className="spacer" />
      {action}
    </div>
  );
}

// ---- Hearings ---------------------------------------------------------------

export function CaseHearingsTab({
  timeline, isLoading, onAddHearing,
}: { timeline: MatterTimelineEvent[] | undefined; isLoading: boolean; onAddHearing: () => void }) {
  const today = localToday();
  const hearings = (timeline ?? []).filter((e) => e.kind === 'hearing');
  const upcoming = hearings.filter((h) => h.at.slice(0, 10) >= today).sort((a, b) => a.at.localeCompare(b.at));
  const past = hearings.filter((h) => h.at.slice(0, 10) < today);

  const addBtn = (
    <button type="button" className="btn btn-primary btn-sm" onClick={onAddHearing}>
      <Icon name="plus" size={12} /> Add hearing
    </button>
  );

  if (isLoading) return <p className="body-sm muted">Loading hearings…</p>;
  if (hearings.length === 0) {
    return (
      <EmptyState
        icon="causelist"
        title="No hearings yet"
        description="Add a hearing, or sync from eCourts to import the full hearing history."
        action={addBtn}
      />
    );
  }
  return (
    <div className="col" style={{ gap: 24 }}>
      <section className="card">
        <SectionHead title="Upcoming" count={upcoming.length} action={addBtn} />
        {upcoming.length === 0
          ? <p className="body-sm muted">No upcoming hearing. Post the next date so it shows on the cause list.</p>
          : <HearingList rows={upcoming} />}
      </section>
      {past.length > 0 && (
        <section className="card">
          <SectionHead title="History" count={past.length} />
          <HearingList rows={past} />
        </section>
      )}
    </div>
  );
}

function HearingList({ rows }: { rows: MatterTimelineEvent[] }) {
  return (
    <ul className="dash-list">
      {rows.map((h) => (
        <li key={h.id} className="dash-row" style={{ cursor: 'default' }}>
          <span className="mono tabular" style={{ width: 96, flexShrink: 0, fontSize: 13 }}>
            {new Date(h.at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
          </span>
          <span className="dash-row-main">
            <span className="dash-row-title">{h.title}</span>
            {h.body && <span className="body-sm muted">{h.body}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ---- Filings ----------------------------------------------------------------

export function CaseFilingsTab({ caseId }: { caseId: string }) {
  const navigate = useNavigate();
  return (
    <div className="col" style={{ gap: 24 }}>
      <section className="card">
        <SectionHead title="eFiling" />
        <FilingsList caseId={caseId} onOpen={(id) => navigate(`/app/efiling?filing=${encodeURIComponent(id)}`)} />
      </section>
      {/* Interim applications, appeals, execution, review, bail - each with its
          own status lifecycle. */}
      <ApplicationsPanel caseId={caseId} />
    </div>
  );
}

// ---- Tasks & deadlines ------------------------------------------------------

export function CaseWorkTab({
  caseId, title, cnr, tasks, tasksLoading, onAddTask,
}: {
  caseId: string;
  title: string;
  cnr: string;
  tasks: Task[];
  tasksLoading: boolean;
  onAddTask: () => void;
}) {
  const navigate = useNavigate();
  // Free accounts can have the limitation tracker switched off.
  const canLimitation = useCan('limitation.use');
  const limitations = useLimitations({ enabled: canLimitation });
  const mine = (limitations.data ?? [])
    .filter((l) => belongsToMatter({ caseId: l.caseId, label: l.caseLabel, cnr: l.cnr }, { id: caseId, title, cnr }))
    .sort((a, b) => a.deadline.localeCompare(b.deadline));
  const open = tasks.filter((t) => t.column !== 'done');
  const done = tasks.filter((t) => t.column === 'done');

  return (
    <div className="case-body split-2-wide" style={{ gap: 24 }}>
      <section className="card">
        <SectionHead
          title="Pendings"
          count={open.length}
          action={
            <button type="button" className="btn btn-primary btn-sm" onClick={onAddTask}>
              <Icon name="plus" size={12} /> Add pending
            </button>
          }
        />
        {tasksLoading ? (
          <p className="body-sm muted">Loading pendings…</p>
        ) : tasks.length === 0 ? (
          <EmptyState variant="inline" title="No pendings" description="To-dos for this matter appear here and on the Tasks board." />
        ) : (
          <ul className="dash-list">
            {[...open, ...done].map((t) => {
              const isDone = t.column === 'done';
              return (
                <li key={t.id} className="dash-row" style={{ cursor: 'default' }}>
                  <Icon name={isDone ? 'check' : 'tasks'} size={14} />
                  <span className="dash-row-main">
                    <span className="dash-row-title" style={isDone ? { textDecoration: 'line-through', color: 'var(--text-tertiary)' } : undefined}>
                      {t.title}
                    </span>
                    <span className="body-xs muted">Due {t.due} · {t.assignee}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {canLimitation && <section className="card">
        <SectionHead
          title="Limitation deadlines"
          count={mine.length}
          action={<button type="button" className="btn btn-sm" onClick={() => navigate('/app/limitation')}>Open tracker</button>}
        />
        {limitations.isLoading ? (
          <p className="body-sm muted">Loading deadlines…</p>
        ) : mine.length === 0 ? (
          <EmptyState
            variant="inline"
            title="No deadlines tracked"
            description="Add one in the Limitation tracker using this matter's title or CNR."
          />
        ) : (
          <ul className="dash-list">
            {mine.map((l) => (
              <li key={l.id} className="dash-row" style={{ cursor: 'default' }}>
                <span className={`dot ${l.daysRemaining <= 7 ? 'dot-vermillion' : l.daysRemaining <= 30 ? 'dot-amber' : 'dot-cobalt'}`} />
                <span className="dash-row-main">
                  <span className="dash-row-title">{l.filingType}</span>
                  <span className="body-xs muted">{l.forum ? `${l.forum} · ` : ''}due {l.deadline}</span>
                </span>
                <span className="mono tabular body-sm">
                  {l.daysRemaining < 0 ? `${-l.daysRemaining}d overdue` : `${l.daysRemaining}d left`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>}
    </div>
  );
}

// ---- Billing ----------------------------------------------------------------

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

export function CaseBillingTab({ caseId, title, client }: { caseId: string; title: string; client: string }) {
  const navigate = useNavigate();
  const invoices = useInvoices();
  const expenses = useExpenses();
  const clientInvoices = (invoices.data ?? []).filter((i) => client && norm(i.client) === norm(client));
  const matterExpenses = (expenses.data ?? []).filter((e) =>
    belongsToMatter({ caseId: e.caseId, label: e.caseLabel }, { id: caseId, title }));
  const outstanding = clientInvoices.filter((i) => i.status !== 'paid').reduce((s, i) => s + i.amountInr, 0);
  const unbilled = matterExpenses.filter((e) => e.billable && e.status !== 'billed').reduce((s, e) => s + e.amountInr, 0);

  return (
    <div className="case-body split-2-wide" style={{ gap: 24 }}>
      <section className="card">
        <SectionHead
          title={`Invoices · ${client || 'client'}`}
          count={clientInvoices.length}
          action={<button type="button" className="btn btn-sm" onClick={() => navigate('/app/invoices')}>All invoices</button>}
        />
        <p className="body-xs muted" style={{ marginBottom: 10 }}>
          Invoices are raised per client, so this shows every invoice for {client || 'this client'}.
          {outstanding > 0 && <> Outstanding: <strong>{inr(outstanding)}</strong>.</>}
        </p>
        {invoices.isLoading ? <p className="body-sm muted">Loading invoices…</p> : clientInvoices.length === 0 ? (
          <EmptyState variant="inline" title="No invoices for this client" />
        ) : (
          <ul className="dash-list">
            {clientInvoices.map((i) => (
              <li key={i.id} className="dash-row" style={{ cursor: 'default' }}>
                <span className="mono body-sm" style={{ width: 96, flexShrink: 0 }}>{i.invoiceNo}</span>
                <span className="dash-row-main">
                  <span className="dash-row-title tabular">{inr(i.amountInr)}</span>
                  <span className="body-xs muted">Issued {i.issuedDate} · due {i.dueDate}</span>
                </span>
                <span className={`badge ${i.status === 'paid' ? 'badge-sage' : i.status === 'overdue' ? 'badge-vermillion' : 'badge-amber'}`}>
                  {i.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <SectionHead
          title="Expenses on this matter"
          count={matterExpenses.length}
          action={<button type="button" className="btn btn-sm" onClick={() => navigate('/app/expenses')}>All expenses</button>}
        />
        {unbilled > 0 && (
          <p className="body-xs muted" style={{ marginBottom: 10 }}>Billable, not yet billed: <strong>{inr(unbilled)}</strong></p>
        )}
        {expenses.isLoading ? <p className="body-sm muted">Loading expenses…</p> : matterExpenses.length === 0 ? (
          <EmptyState variant="inline" title="No expenses logged" description="Court fees, stamp paper, travel and clerkage logged against this matter appear here." />
        ) : (
          <ul className="dash-list">
            {matterExpenses.map((e) => (
              <li key={e.id} className="dash-row" style={{ cursor: 'default' }}>
                <span className="mono body-sm" style={{ width: 96, flexShrink: 0 }}>{e.date}</span>
                <span className="dash-row-main">
                  <span className="dash-row-title">{e.description}</span>
                  <span className="body-xs muted">{e.category}{e.billable ? ' · billable' : ''}</span>
                </span>
                <span className="tabular body-sm">{inr(e.amountInr)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
