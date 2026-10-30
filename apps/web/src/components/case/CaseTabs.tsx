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
// Styles: .cs-* in styles/chambers/case.css.
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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-30" -> "30 Oct 2026"; anything else is shown as given. */
function fmtDay(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!m) return iso ?? '';
  return `${+m[3]!} ${MONTHS[+m[2]! - 1]} ${m[1]}`;
}

function SectionHead({ title, count, sub, action }: { title: string; count?: number; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="cs-card-head">
      <div className="cs-card-titles">
        <h2 className="cs-card-title">
          {title}
          {count !== undefined && <span className="cs-count" style={{ marginLeft: 10 }}>{count}</span>}
        </h2>
        {sub && <p className="cs-card-sub">{sub}</p>}
      </div>
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

  if (isLoading) return <div className="card"><p className="cs-muted">Loading hearings…</p></div>;
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
    <div className="cs-tab-body">
      <section className="card">
        <SectionHead title="Upcoming" count={upcoming.length} sub="Posted dates for this matter, soonest first." action={addBtn} />
        {upcoming.length === 0
          ? <p className="cs-muted">No upcoming hearing. Post the next date so it shows on the cause list.</p>
          : <HearingList rows={upcoming} today={today} />}
      </section>
      {past.length > 0 && (
        <section className="card">
          <SectionHead title="History" count={past.length} sub="What happened at each earlier hearing." />
          <HearingList rows={past} today={today} />
        </section>
      )}
    </div>
  );
}

function HearingList({ rows, today }: { rows: MatterTimelineEvent[]; today: string }) {
  return (
    <ul className="cs-lines">
      {rows.map((h) => {
        const d = new Date(h.at);
        const isToday = h.at.slice(0, 10) === today;
        return (
          <li key={h.id} className="cs-line">
            <span className={`adv-dateblock${isToday ? ' is-today' : ''}`} aria-hidden="true">
              <span className="adv-dateblock-m">{MONTHS[d.getMonth()]}</span>
              <span className="adv-dateblock-d">{d.getDate()}</span>
            </span>
            <span className="cs-line-main">
              <span className="cs-line-title">{h.title}</span>
              <span className="cs-line-sub">
                {d.toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' })}
                {isToday ? ' · Today' : ''}
              </span>
              {h.body && <span className="cs-line-sub">{h.body}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// ---- Filings ----------------------------------------------------------------

export function CaseFilingsTab({ caseId }: { caseId: string }) {
  const navigate = useNavigate();
  return (
    <div className="cs-tab-body">
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
          title="Tasks"
          count={open.length}
          sub={done.length > 0 ? `${done.length} done` : 'Also on the firm Tasks board.'}
          action={
            <button type="button" className="btn btn-primary btn-sm" onClick={onAddTask}>
              <Icon name="plus" size={12} /> Add pending
            </button>
          }
        />
        {tasksLoading ? (
          <p className="cs-muted">Loading pendings…</p>
        ) : tasks.length === 0 ? (
          <EmptyState variant="inline" title="No tasks" description="Things to do on this case appear here and on the Tasks board." />
        ) : (
          <ul className="cs-lines">
            {[...open, ...done].map((t) => {
              const isDone = t.column === 'done';
              return (
                <li key={t.id} className={`cs-line${isDone ? ' is-done' : ''}`}>
                  <span className="cs-line-icon" aria-hidden="true"><Icon name={isDone ? 'check' : 'tasks'} size={14} /></span>
                  <span className="cs-line-main">
                    <span className="cs-line-title">{t.title}</span>
                    <span className="cs-line-sub">Due {fmtDay(t.due)} · {t.assignee}</span>
                  </span>
                  {isDone && <span className="cs-status is-quiet">Done</span>}
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
          <p className="cs-muted">Loading deadlines…</p>
        ) : mine.length === 0 ? (
          <EmptyState
            variant="inline"
            title="No deadlines tracked"
            description="Add one in the Limitation tracker using this matter's title or CNR."
          />
        ) : (
          <ul className="cs-lines">
            {mine.map((l) => (
              <li key={l.id} className="cs-line">
                <span
                  className={`cs-urgency ${l.daysRemaining <= 7 ? 'is-near' : l.daysRemaining <= 30 ? '' : 'is-far'}`}
                  aria-hidden="true"
                />
                <span className="cs-line-main">
                  <span className="cs-line-title">{l.filingType}</span>
                  <span className="cs-line-sub">{l.forum ? `${l.forum} · ` : ''}due {fmtDay(l.deadline)}</span>
                </span>
                <span className="cs-line-end">
                  <span className="cs-days">
                    {l.daysRemaining < 0 ? -l.daysRemaining : l.daysRemaining}
                    <small>{l.daysRemaining < 0 ? 'days overdue' : 'days left'}</small>
                  </span>
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
  const spent = matterExpenses.reduce((s, e) => s + e.amountInr, 0);
  const loading = invoices.isLoading || expenses.isLoading;

  return (
    <div className="cs-tab-body">
      <div className="cs-money" aria-label="Billing summary">
        <div className="cs-money-tile">
          <span className="cs-count">Outstanding</span>
          <span className="cs-figure">{loading ? '…' : inr(outstanding)}</span>
          <div className="cs-money-note">Unpaid invoices for {client || 'this client'}</div>
        </div>
        <div className="cs-money-tile">
          <span className="cs-count">Not yet billed</span>
          <span className="cs-figure">{loading ? '…' : inr(unbilled)}</span>
          <div className="cs-money-note">Billable expenses on this matter</div>
        </div>
        <div className="cs-money-tile">
          <span className="cs-count">Spent on matter</span>
          <span className="cs-figure">{loading ? '…' : inr(spent)}</span>
          <div className="cs-money-note">{matterExpenses.length} {matterExpenses.length === 1 ? 'expense' : 'expenses'} logged</div>
        </div>
      </div>

      <div className="case-body split-2-wide" style={{ gap: 24 }}>
        <section className="card">
          <SectionHead
            title={`Invoices · ${client || 'client'}`}
            count={clientInvoices.length}
            sub={<>Invoices are raised per client, so this shows every invoice for {client || 'this client'}.</>}
            action={<button type="button" className="btn btn-sm" onClick={() => navigate('/app/invoices')}>All invoices</button>}
          />
          {invoices.isLoading ? <p className="cs-muted">Loading invoices…</p> : clientInvoices.length === 0 ? (
            <EmptyState variant="inline" title="No invoices for this client" />
          ) : (
            <ul className="cs-lines">
              {clientInvoices.map((i) => (
                <li key={i.id} className="cs-line">
                  <span className="cs-line-main">
                    <span className="cs-code">{i.invoiceNo}</span>
                    <span className="cs-line-sub">Issued {fmtDay(i.issuedDate)} · due {fmtDay(i.dueDate)}</span>
                  </span>
                  <span className="cs-line-end">
                    <span className="cs-figure" style={{ fontSize: 18 }}>{inr(i.amountInr)}</span>
                    <span className={`cs-status ${i.status === 'paid' ? 'is-quiet' : i.status === 'overdue' ? 'is-ink' : 'is-strong'}`}>
                      {i.status}
                    </span>
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
          {expenses.isLoading ? <p className="cs-muted">Loading expenses…</p> : matterExpenses.length === 0 ? (
            <EmptyState variant="inline" title="No expenses logged" description="Court fees, stamp paper, travel and clerkage logged against this matter appear here." />
          ) : (
            <ul className="cs-lines">
              {matterExpenses.map((e) => (
                <li key={e.id} className="cs-line">
                  <span className="cs-line-main">
                    <span className="cs-line-title">{e.description}</span>
                    <span className="cs-line-sub">{fmtDay(e.date)} · {e.category}{e.billable ? ' · billable' : ''}</span>
                  </span>
                  <span className="cs-line-end">
                    <span className="cs-figure" style={{ fontSize: 16 }}>{inr(e.amountInr)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
