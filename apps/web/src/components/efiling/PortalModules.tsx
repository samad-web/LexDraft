import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useCase, useCases } from '@/hooks/useCases';
import { useCalendarMonth } from '@/hooks/useCalendar';
import {
  useCreateEfiling,
  useDeleteEfiling,
  useEfilingFiling,
  useEfilingFilings,
  useEfilingPortalSteps,
  useFilingParticulars,
  useTransitionEfiling,
  useUpdateEfiling,
  type EfilingFiling,
  type FilingDetail as FilingDetailDto,
  type FilingKind,
  type FilingParticulars,
  type FilingStatus,
  type ParticularsBundle,
  type PortalStepKey,
  type PortalStepState,
} from '@/hooks/useEfiling';
import { DocumentsCard, PaymentsCard, ReadinessCard, StageTracker } from './FilingDetail';
import { ParticularsEditor, isMactCase, type ParticularsSection } from './ParticularsEditor';
import { KIND_LABEL, STATUS_LABEL, STATUS_TONE, errMsg, formatDateTime } from './format';
import {
  CauseTitle,
  EfiledBadge,
  PButton,
  PRadios,
  PortalButtons,
  PortalSection,
  PortalTable,
  PortalTabs,
  PortalTitle,
  SuccessNote,
  SummaryBanner,
  type PortalColumn,
} from './PortalUi';

// =============================================================================
// The eFiling 3.0 portal's own screens (official user manual), rebuilt in
// LexDraft so an advocate finds everything where the portal keeps it:
//
//   Dashboard      Draft / Completed Pleadings · Draft / Completed IAs ·
//                  Objections · My Cases, then Calendar | Cases Listed Today
//   Case Filing    New Case Filing (Initial Inputs > Litigant > [Legal Heir] >
//                  Fact Details > Case Details > [MVC] > e-File), with the
//                  portal's + / Edit / PDF buttons
//   Vakalat        Assign Partners to Case · Accept Offer · Print Vakalat
//   Pleadings      Pleading Upload | Indexing | Pleading eSign · Oath Recording
//   ePayments      Payment · Court Fee Wallet
//   Applications   Applications | Pay Fees | Authentication · Submitted
//
// Every module works on a filing picked the way the portal's "Search Case"
// block does it. Colours stay LexDraft monochrome.
// =============================================================================

export type PortalModule =
  | 'dashboard' | 'new_case'
  | 'vakalat' | 'accept_offer' | 'print_vakalat'
  | 'pleadings' | 'oath'
  | 'payments' | 'wallet'
  | 'applications' | 'submitted_ias'
  | 'objections';

export const PORTAL_URL = 'https://filing.ecourts.gov.in/pdedev/';
const PLEADING_KINDS: FilingKind[] = ['new_case', 'misc_document', 'deficit_court_fee', 'caveat'];
const DRAFT_STATES: FilingStatus[] = ['draft', 'ready', 'efiled'];
const DONE_STATES: FilingStatus[] = ['submitted', 'objected', 'refiled', 'accepted', 'registered', 'rejected'];

const label = (f: EfilingFiling) => `${f.efilingNo ?? 'No eFiling no. yet'} · ${f.title}`;

/** "Ramesh Kumar v. Suresh Babu" -> ["Ramesh Kumar", "Suresh Babu"]. */
function splitTitle(title: string): [string, string] {
  const parts = title.split(/\s+(?:v\.?|vs\.?|versus)\s+/i);
  return [parts[0]?.trim() ?? title, parts.slice(1).join(' v. ').trim()];
}

function dmy(iso: string | null | undefined): string {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : iso;
}

function Card({ title, children, aside }: { title?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="card col" style={{ gap: 12 }}>
      {title || aside ? (
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {title ? <h3 className="h5">{title}</h3> : <span />}
          {aside}
        </div>
      ) : null}
      {children}
    </section>
  );
}

// ---- "Search Case" block ---------------------------------------------------------

/** The portal asks for the case first ("Search Case" > "Search Keyword"). */
export function FilingPicker({ value, onChange, kinds, statuses, placeholder = 'Select the e-Filing number / filing' }: {
  value: string | null;
  onChange: (id: string | null) => void;
  kinds?: FilingKind[];
  statuses?: FilingStatus[];
  placeholder?: string;
}) {
  const { data: filings, isLoading } = useEfilingFilings();
  const options = (filings ?? []).filter((f) => (!kinds || kinds.includes(f.kind)) && (!statuses || statuses.includes(f.status)));
  return (
    <label className="col" style={{ gap: 4, maxWidth: 640, flex: 1, minWidth: 240 }}>
      <span className="body-sm muted">Filing</span>
      <select className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} disabled={isLoading}>
        <option value="">{isLoading ? 'Loading filings…' : options.length === 0 ? 'No filings here yet' : placeholder}</option>
        {options.map((f) => <option key={f.id} value={f.id}>{label(f)} ({STATUS_LABEL[f.status]})</option>)}
      </select>
    </label>
  );
}

/**
 * Search Case: the case picker, then the portal's three boxes - cause title,
 * My Clients, and establishment + next date / stage.
 */
function SearchCaseBlock({ value, onChange, kinds, statuses, placeholder }: {
  value: string | null;
  onChange: (id: string | null) => void;
  kinds?: FilingKind[];
  statuses?: FilingStatus[];
  placeholder?: string;
}) {
  const { data: filing } = useEfilingFiling(value);
  const { data: bundle } = useFilingParticulars(filing?.caseId ?? null);
  const { data: matter } = useCase(filing?.caseId ?? null);
  const parties = bundle?.parties ?? [];
  const pet = parties.find((p) => p.side === 'petitioner')?.name ?? (filing ? splitTitle(filing.caseTitle)[0] : null);
  const res = parties.find((p) => p.side === 'respondent')?.name ?? (filing ? splitTitle(filing.caseTitle)[1] : null);
  const clients = parties.filter((p) => p.isClient);
  const box: React.CSSProperties = { flex: '1 1 200px', minWidth: 0, padding: 10, borderRadius: 8, border: '1px solid var(--border-default)', background: 'var(--bg-surface-2, var(--bg-subtle))' };
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <span className="body-sm" style={{ fontWeight: 700, paddingBottom: 10 }}>Search Case</span>
        <FilingPicker value={value} onChange={onChange} kinds={kinds} statuses={statuses} placeholder={placeholder} />
      </div>
      {filing ? (
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'stretch' }}>
          <div style={box}><CauseTitle petitioner={pet} respondent={res} /></div>
          <div style={box} className="col">
            <strong className="body-sm">My Clients</strong>
            {clients.length === 0 ? <span className="body-sm muted">None marked (Case Filing &gt; Litigant)</span>
              : clients.map((c) => <span key={c.id} className="body-sm">☑ {c.name}-({c.side === 'petitioner' ? 'Petitioner' : 'Respondent'})</span>)}
          </div>
          <div style={box} className="col">
            <strong className="body-sm" style={{ textTransform: 'uppercase' }}>{bundle?.particulars?.establishmentName ?? matter?.court ?? 'Establishment not set'}</strong>
            <span className="body-sm">{matter?.judge ?? ''}</span>
            <span className="body-sm" style={{ fontWeight: 700 }}>{matter?.next ? `${dmy(matter.next)}/${String(matter.stage ?? '')}` : 'No next date'}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** One portal step's status, with its official hint. */
function StepControl({ filing, stepKey }: { filing: FilingDetailDto; stepKey: PortalStepKey }) {
  const steps = useEfilingPortalSteps(filing.kind);
  const update = useUpdateEfiling(filing.id);
  const [error, setError] = useState<string | null>(null);
  const step = steps.data?.find((s) => s.key === stepKey);
  if (!step) return null;
  const state: PortalStepState = filing.steps[stepKey] ?? 'pending';
  const locked = DONE_STATES.includes(filing.status) || filing.status === 'withdrawn';
  return (
    <div className="col" style={{ gap: 6, padding: 12, borderRadius: 8, border: '1px solid var(--border-default)' }}>
      <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="body-sm" style={{ fontWeight: 600, flex: 1 }}>
          {step.label}{step.required ? <span className="muted" style={{ fontWeight: 400 }}> · required</span> : null}
        </span>
        <select
          className="input"
          style={{ width: 150 }}
          value={state}
          disabled={locked || update.isPending}
          aria-label={`${step.label} status`}
          onChange={(e) => {
            setError(null);
            update.mutate({ steps: { [stepKey]: e.target.value as PortalStepState } }, { onError: (err) => setError(errMsg(err, 'Could not update')) });
          }}
        >
          <option value="pending">Pending</option>
          <option value="done">Done</option>
          {!step.required ? <option value="not_applicable">Not needed</option> : null}
        </select>
      </div>
      <span className="body-sm muted">On the portal: {step.hint}</span>
      {error ? <span className="body-sm" style={{ color: 'var(--danger)' }}>{error}</span> : null}
    </div>
  );
}

function usePicked(initial: string | null) {
  const [id, setId] = useState<string | null>(initial);
  const { data: filing } = useEfilingFiling(id);
  return { id, setId, filing };
}

const stepText = (f: EfilingFiling, k: PortalStepKey, done: string, pending: string) => {
  const v = f.steps[k];
  return v === 'done' ? done : v === 'not_applicable' ? 'Not needed' : pending;
};

// =============================================================================
// Dashboard
// =============================================================================

type Tile = 'draft_pleadings' | 'completed_pleadings' | 'draft_ias' | 'completed_ias' | 'objections' | 'my_cases';

export function EfilingDashboard({ onOpen, onNav }: { onOpen: (id: string) => void; onNav: (m: PortalModule) => void }) {
  const { data: filings, isLoading } = useEfilingFilings();
  const { data: cases, isLoading: casesLoading } = useCases();
  const [tile, setTile] = useState<Tile>('draft_pleadings');
  const all = filings ?? [];
  const groups: Record<Exclude<Tile, 'my_cases'>, EfilingFiling[]> = {
    draft_pleadings: all.filter((f) => f.kind !== 'ia' && DRAFT_STATES.includes(f.status)),
    completed_pleadings: all.filter((f) => f.kind !== 'ia' && DONE_STATES.includes(f.status)),
    draft_ias: all.filter((f) => f.kind === 'ia' && DRAFT_STATES.includes(f.status)),
    completed_ias: all.filter((f) => f.kind === 'ia' && DONE_STATES.includes(f.status)),
    objections: all.filter((f) => f.status === 'objected'),
  };
  const count = (t: Tile) => (t === 'my_cases' ? (casesLoading ? null : (cases ?? []).length) : isLoading ? null : groups[t].length);
  const TILES: Record<Tile, string> = {
    draft_pleadings: 'Draft Pleadings',
    completed_pleadings: 'Completed Pleadings',
    draft_ias: 'Draft IAs',
    completed_ias: 'Completed IAs',
    objections: 'Objections',
    my_cases: 'My Cases',
  };
  const tileBtn = (t: Tile) => (
    <button
      key={t}
      type="button"
      className="card"
      onClick={() => setTile(t)}
      aria-pressed={tile === t}
      style={{
        textAlign: 'center', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 150, flex: 1,
        background: tile === t ? 'var(--bg-inverse)' : undefined, color: tile === t ? 'var(--text-inverse)' : undefined,
      }}
    >
      {/* color: inherit - .body-sm's grey is unreadable on the selected (inverse) tile */}
      <span className="body-sm" style={{ fontWeight: 700, color: 'inherit' }}>{TILES[t]}</span>
      <span style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.1 }}>{count(t) ?? '…'}</span>
    </button>
  );
  const panel = (tiles: Tile[]) => (
    <div className="row" style={{ gap: 10, padding: 10, borderRadius: 10, border: '1px solid var(--border-default)', background: 'var(--bg-surface-2, var(--bg-subtle))', flex: '2 1 320px' }}>
      {tiles.map(tileBtn)}
    </div>
  );

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'stretch' }}>
        {panel(['draft_pleadings', 'completed_pleadings'])}
        {panel(['draft_ias', 'completed_ias'])}
        <div className="row" style={{ gap: 10, padding: 10, flex: '2 1 320px' }}>
          {tileBtn('objections')}
          {tileBtn('my_cases')}
        </div>
      </div>

      <Card title={TILES[tile]} aside={<button type="button" className="btn btn-primary btn-sm" onClick={() => onNav('new_case')}>+ New Case Filing</button>}>
        {tile === 'my_cases' ? <MyCasesTable /> : null}
        {tile === 'draft_pleadings' || tile === 'completed_pleadings' ? <PleadingsTable rows={groups[tile]} completed={tile === 'completed_pleadings'} onOpen={onOpen} /> : null}
        {tile === 'draft_ias' || tile === 'completed_ias' ? <IaTable rows={groups[tile]} onOpen={onOpen} /> : null}
        {tile === 'objections' ? <ObjectionsTable rows={groups.objections} onOpen={onOpen} /> : null}
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 16 }}>
        <DashboardCalendar />
      </div>
    </div>
  );
}

function EfilingNoCell({ f }: { f: EfilingFiling }) {
  return (
    <span>
      <span className="mono" style={{ fontSize: 12 }}>{f.cnr ?? f.efilingNo ?? '—'}</span>
      {f.efilingNo ? <EfiledBadge /> : null}
      <div className="body-sm muted">{KIND_LABEL[f.kind]}</div>
    </span>
  );
}

function PleadingsTable({ rows, completed, onOpen }: { rows: EfilingFiling[]; completed: boolean; onOpen: (id: string) => void }) {
  const cols: PortalColumn<EfilingFiling>[] = [
    { key: 'sr', header: 'Sr.No.', cell: (_r, i) => i + 1, width: 60 },
    { key: 'no', header: 'e-Filing Number / Case Number', cell: (f) => <EfilingNoCell f={f} />, text: (f) => `${f.efilingNo ?? ''} ${f.cnr ?? ''}` },
    { key: 'title', header: 'Cause Title', cell: (f) => { const [p, r] = splitTitle(f.caseTitle); return <CauseTitle petitioner={p} respondent={r} />; }, text: (f) => f.caseTitle },
    { key: 'upload', header: 'Upload Pleadings', cell: (f) => stepText(f, 'upload', 'Documents uploaded', 'Document is not uploaded') },
    { key: 'oath', header: 'oath Recording', cell: (f) => stepText(f, 'oath', 'Oath recorded', 'Oath is not Recorded') },
    { key: 'pay', header: 'ePayments', cell: (f) => stepText(f, 'court_fee', 'GRN recorded', 'No GRN') },
    completed
      ? { key: 'status', header: 'Status', cell: (f) => <span className="col" style={{ gap: 4, alignItems: 'flex-start' }}><span className={STATUS_TONE[f.status]}>{STATUS_LABEL[f.status]}</span><button type="button" className="btn btn-sm" onClick={() => onOpen(f.id)}>Open</button></span> }
      : { key: 'action', header: 'Action', cell: (f) => <button type="button" className="btn btn-sm" onClick={() => onOpen(f.id)}>Open</button> },
  ];
  return <PortalTable rows={rows} columns={cols} label={completed ? 'Completed Pleadings' : 'Draft Pleadings'} defaultPageSize={25} />;
}

function IaTable({ rows, onOpen }: { rows: EfilingFiling[]; onOpen: (id: string) => void }) {
  const cols: PortalColumn<EfilingFiling>[] = [
    { key: 'sr', header: 'Sr. No.', cell: (_r, i) => i + 1, width: 60 },
    { key: 'app', header: 'Application', cell: (f) => f.title, text: (f) => f.title },
    { key: 'no', header: 'E-Filing No/Case Number', cell: (f) => <EfilingNoCell f={f} />, text: (f) => `${f.efilingNo ?? ''} ${f.cnr ?? ''}` },
    { key: 'title', header: 'Case Title', cell: (f) => f.caseTitle, text: (f) => f.caseTitle },
    { key: 'date', header: 'Date', cell: (f) => dmy(f.createdAt) },
    {
      key: 'auth', header: 'Authentication', cell: (f) => (
        <span className="col" style={{ gap: 4, alignItems: 'flex-start' }}>
          <span className="body-sm">Advocate: {stepText(f, 'ia_auth_advocate', '✓ Authenticated', 'Pending')}</span>
          <span className="body-sm">Litigant: {stepText(f, 'ia_auth_litigant', '✓ Authenticated', 'Pending')}</span>
          <button type="button" className="btn btn-sm" onClick={() => onOpen(f.id)}>Open</button>
        </span>
      ),
    },
  ];
  return <PortalTable rows={rows} columns={cols} groupBy={(f) => f.caseTitle} label="Applications" defaultPageSize={25} />;
}

function ObjectionsTable({ rows, onOpen }: { rows: EfilingFiling[]; onOpen: (id: string) => void }) {
  const cols: PortalColumn<EfilingFiling>[] = [
    { key: 'sr', header: 'Sr.No.', cell: (_r, i) => i + 1, width: 60 },
    { key: 'reason', header: 'Reason', cell: (f) => <span style={{ whiteSpace: 'pre-wrap' }}>{f.objections ?? '—'}</span>, text: (f) => f.objections ?? '' },
    { key: 'date', header: 'Date', cell: (f) => <span className="col" style={{ gap: 4, alignItems: 'flex-start' }}>{dmy(f.objectionsRaisedAt)}<button type="button" className="btn btn-sm" onClick={() => onOpen(f.id)}>Open</button></span> },
  ];
  return <PortalTable rows={rows} columns={cols} groupBy={(f) => `${f.efilingNo ?? 'No eFiling no.'} - ${f.title}`} label="Objections" />;
}

function MyCasesTable() {
  const { data: cases } = useCases();
  type Row = NonNullable<typeof cases>[number];
  const cols: PortalColumn<Row>[] = [
    { key: 'sr', header: 'Sr.No.', cell: (_r, i) => i + 1, width: 60 },
    { key: 'title', header: 'Cause Title', cell: (c) => <Link to={`/app/cases/${c.id}`}>{c.title}</Link>, text: (c) => `${c.title} ${c.cnr ?? ''}` },
    { key: 'court', header: 'Court', cell: (c) => c.court, text: (c) => c.court ?? '' },
    { key: 'next', header: 'Next Date', cell: (c) => dmy(c.next) },
  ];
  return (
    <div className="col" style={{ gap: 8 }}>
      <PortalTable rows={cases ?? []} columns={cols} label="My Cases" />
      <Link className="btn btn-ghost btn-sm" to="/app/cases" style={{ alignSelf: 'flex-start' }}>Open My Cases →</Link>
    </div>
  );
}

/** Calendar (month, hearing counts per day) and "Cases Listed Today". */
function DashboardCalendar() {
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const [ym, setYm] = useState({ y: today.getFullYear(), m: today.getMonth() + 1 });
  const [selected, setSelected] = useState(todayIso);
  const { data: month, isLoading } = useCalendarMonth(ym.y, ym.m);
  const shift = (d: number) => setYm(({ y, m }) => {
    const n = m + d;
    return n < 1 ? { y: y - 1, m: 12 } : n > 12 ? { y: y + 1, m: 1 } : { y, m: n };
  });
  const days = month?.days ?? [];
  // The portal's calendar starts on Sunday; eCourts-style weekdayIndex is Mon=0.
  const lead = days.length ? (days[0]!.weekdayIndex + 1) % 7 : 0;
  const listed = (month?.hearings ?? []).filter((h) => h.date === selected);
  const monthName = new Date(ym.y, ym.m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  return (
    <>
      <section className="card col" style={{ gap: 10 }} aria-label="Calendar">
        <h3 className="h5">Calendar</h3>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => shift(-1)} aria-label="Previous month">◀</button>
          <strong className="body-sm">{monthName}</strong>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => shift(1)} aria-label="Next month">▶</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, textAlign: 'center' }}>
          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => <span key={d} className="body-sm muted" style={{ fontWeight: 600 }}>{d}</span>)}
          {Array.from({ length: lead }).map((_, i) => <span key={`l${i}`} />)}
          {days.map((d) => {
            const on = d.date === selected;
            return (
              <button
                key={d.date}
                type="button"
                onClick={() => setSelected(d.date)}
                aria-pressed={on}
                aria-label={`${dmy(d.date)}${d.count ? `, ${d.count} case(s)` : ''}`}
                style={{
                  position: 'relative', padding: '6px 0', borderRadius: 6, cursor: 'pointer', font: 'inherit', fontSize: 13,
                  border: d.isToday ? '1px solid var(--text-primary)' : '1px solid transparent',
                  background: on ? 'var(--bg-inverse)' : 'transparent', color: on ? 'var(--text-inverse)' : 'inherit',
                }}
              >
                {Number(d.date.slice(8))}
                {d.count ? (
                  <span style={{ position: 'absolute', top: 1, left: 2, fontSize: 9, fontWeight: 700, padding: '0 3px', borderRadius: 3, background: on ? 'var(--bg-surface)' : 'var(--bg-inverse)', color: on ? 'var(--text-primary)' : 'var(--text-inverse)' }}>
                    {d.count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        {isLoading ? <span className="body-sm muted">Loading…</span> : null}
      </section>
      <section className="card col" style={{ gap: 10 }} aria-label="Cases Listed">
        <h3 className="h5">{selected === todayIso ? 'Cases Listed Today' : 'Cases Listed'} - {dmy(selected)}</h3>
        {listed.length === 0 ? (
          <div className="col" style={{ alignItems: 'center', gap: 6, padding: 24 }}>
            <span aria-hidden style={{ fontSize: 28 }}>🗀</span>
            <span className="body-sm muted">No Cases</span>
          </div>
        ) : listed.map((h, i) => (
          <div key={`${h.id ?? i}`} className="col" style={{ gap: 2, padding: '8px 0', borderTop: i ? '1px solid var(--border-default)' : undefined }}>
            {h.caseId ? <Link to={`/app/cases/${h.caseId}`} style={{ fontWeight: 600 }}>{h.case}</Link> : <strong>{h.case}</strong>}
            <span className="body-sm muted">{[h.time, h.court, h.purpose].filter(Boolean).join(' · ')}</span>
          </div>
        ))}
      </section>
    </>
  );
}

// =============================================================================
// Case Filing > New Case Filing - the portal's tabbed wizard
// =============================================================================

type WizardTab = 'initial' | 'litigant' | 'legal_heir' | 'facts' | 'case_details' | 'mvc' | 'efile';
type CaseFilingView = 'wizard' | 'edit' | 'pdf';

/** The tab forms render their own Prev / Next (wired to the wizard). */
const Particulars = ParticularsEditor;

export function NewCaseFiling({ filingId, initialCaseId, onFiling, onOpen }: {
  filingId: string | null;
  /** Matter to start with (the case page's "eFiling" button). */
  initialCaseId?: string | null;
  onFiling: (id: string | null) => void;
  onOpen: (id: string) => void;
}) {
  const { data: filing } = useEfilingFiling(filingId);
  const { data: bundle } = useFilingParticulars(filing?.caseId ?? null);
  const [tab, setTab] = useState<WizardTab>('initial');
  const [view, setView] = useState<CaseFilingView>('wizard');
  const [created, setCreated] = useState<string[]>([]);
  const p = bundle?.particulars ?? null;
  const parties = bundle?.parties ?? [];
  const mact = isMactCase(p);
  const heirTab = parties.some((x) => x.legalHeirOf || x.extra?.['addLegalHeir'] === 'Y');

  const tabs: Array<{ id: WizardTab; label: string; icon: string; disabled?: boolean; done?: boolean }> = [
    { id: 'initial', label: 'Initial Inputs', icon: '★', done: Boolean(filing) },
    { id: 'litigant', label: 'Litigant', icon: '♟︎', disabled: !filing, done: parties.length > 0 },
    ...(heirTab ? [{ id: 'legal_heir' as const, label: 'Legal Heir', icon: '⚖︎', disabled: !filing, done: parties.some((x) => x.legalHeirOf) }] : []),
    { id: 'facts', label: 'Fact Details', icon: '✎︎', disabled: !filing, done: (bundle?.facts.length ?? 0) > 0 },
    { id: 'case_details', label: 'Case Details', icon: '▤', disabled: !filing, done: Boolean(p?.causeOfAction || p?.prayer) },
    ...(mact ? [{ id: 'mvc' as const, label: 'MVC', icon: '◈', disabled: !filing, done: Boolean(p?.mact) }] : []),
    { id: 'efile', label: 'e-File', icon: '✔︎', disabled: !filing, done: Boolean(filing && !['draft', 'ready'].includes(filing.status)) },
  ];
  const order = tabs.map((t) => t.id);
  const current: WizardTab = order.includes(tab) ? tab : 'initial';
  const idx = order.indexOf(current);
  const go = (d: -1 | 1) => setTab(order[Math.min(order.length - 1, Math.max(0, idx + d))]!);
  const [pet, res] = [parties.find((x) => x.side === 'petitioner')?.name, parties.find((x) => x.side === 'respondent')?.name];

  const floating = (
    <div className="row" role="toolbar" aria-label="Case Filing actions" style={{ gap: 6, padding: 6, borderRadius: 999, border: '1px solid var(--border-default)', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
      <button type="button" className={`btn btn-sm ${view === 'wizard' && !filing ? 'btn-primary' : ''}`} title="Add Case" aria-label="Add Case"
        onClick={() => { setView('wizard'); setTab('initial'); setCreated([]); onFiling(null); }}>+</button>
      <button type="button" className={`btn btn-sm ${view === 'edit' ? 'btn-primary' : ''}`} title="Edit a draft" onClick={() => setView('edit')}>Edit</button>
      <button type="button" className={`btn btn-sm ${view === 'pdf' ? 'btn-primary' : ''}`} title="eFiled cases" onClick={() => setView('pdf')}>PDF</button>
      {filing ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => onOpen(filing.id)} title="Everything about this filing on one page">Open full filing →</button> : null}
    </div>
  );

  if (view === 'edit') {
    return (
      <div className="col" style={{ gap: 16 }}>
        <div className="row" style={{ justifyContent: 'flex-end' }}>{floating}</div>
        <Card title="Select Case">
          <DraftList onEdit={(id) => { onFiling(id); setTab('litigant'); setView('wizard'); }} />
        </Card>
      </div>
    );
  }
  if (view === 'pdf') {
    return (
      <div className="col" style={{ gap: 16 }}>
        <div className="row" style={{ justifyContent: 'flex-end' }}>{floating}</div>
        <Card title="eFiled Cases">
          <EfiledList onView={onOpen} />
        </Card>
      </div>
    );
  }

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <PortalTabs tabs={tabs} value={current} onChange={setTab} label="New Case Filing" />
        {floating}
      </div>
      {filing && current !== 'initial' ? (
        <SummaryBanner
          court={p?.establishmentName}
          efilingNo={filing.efilingNo}
          relief={p?.extra?.reliefSought}
          caseType={p?.caseTypeName}
          causeTitle={pet || res ? `${pet ?? ''} Vs ${res ?? ''}` : filing.caseTitle}
        />
      ) : null}
      <SuccessNote lines={created} onClose={() => setCreated([])} />

      {current === 'initial' ? (
        <InitialInputs
          filing={filing ?? null}
          initialCaseId={initialCaseId ?? ''}
          onCreated={(f) => { setCreated(['New case added', `E-Filing Number: ${f.efilingNo ?? 'temporary until eFiled on the portal'}`]); onFiling(f.id); }}
          onNext={() => go(1)}
        />
      ) : null}
      {filing && current !== 'initial' && current !== 'efile' ? (
        <section className="card col" style={{ gap: 12 }}>
          <Particulars caseId={filing.caseId} section={current as ParticularsSection} onPrev={() => go(-1)} onNext={() => go(1)} />
        </section>
      ) : null}
      {filing && current === 'efile' ? <EFileTab filing={filing} bundle={bundle ?? null} mact={mact} onPrev={() => go(-1)} /> : null}
    </div>
  );
}

function InitialInputs({ filing, initialCaseId = '', onCreated, onNext }: {
  filing: FilingDetailDto | null;
  initialCaseId?: string;
  onCreated: (f: EfilingFiling) => void;
  onNext: () => void;
}) {
  const { data: cases, isLoading } = useCases();
  const create = useCreateEfiling();
  const [caseId, setCaseId] = useState(initialCaseId);
  const [error, setError] = useState<string | null>(null);

  if (!filing) {
    return (
      <section className="card col" style={{ gap: 14 }}>
        <PortalTitle>Initial Inputs</PortalTitle>
        <PortalSection title="Matter" note="Note: Following fields are Compulsar">
          <p className="body-sm muted">Pick the matter you are filing. LexDraft copies in its court, parties and acts, the way the portal starts a new case from Initial Inputs.</p>
          <label className="col" style={{ gap: 4, maxWidth: 520 }}>
            <span className="body-sm" style={{ fontWeight: 600 }}>Matter</span>
            <select className="input" value={caseId} onChange={(e) => setCaseId(e.target.value)} disabled={isLoading}>
              <option value="">{isLoading ? 'Loading matters…' : 'Select matter'}</option>
              {(cases ?? []).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </label>
        </PortalSection>
        <PortalButtons>
          <PButton
            primary
            disabled={!caseId || create.isPending}
            onClick={() => {
              setError(null);
              create.mutate({ caseId, kind: 'new_case' }, { onSuccess: onCreated, onError: (err) => setError(errMsg(err, 'Could not start the filing')) });
            }}
          >
            {create.isPending ? 'Starting…' : 'Submit'}
          </PButton>
          <PButton onClick={() => setCaseId('')}>Reset</PButton>
        </PortalButtons>
        {error ? <p className="body-sm" style={{ color: 'var(--danger)' }}>{error}</p> : null}
      </section>
    );
  }
  return (
    <section className="card col" style={{ gap: 12 }}>
      <Particulars caseId={filing.caseId} section="initial" onNext={onNext} />
    </section>
  );
}

/** Edit: the draft new-case filings (portal: Select Case). */
function DraftList({ onEdit }: { onEdit: (id: string) => void }) {
  const { data: filings } = useEfilingFilings();
  const del = useDeleteEfiling();
  const rows = (filings ?? []).filter((f) => f.kind === 'new_case' && (f.status === 'draft' || f.status === 'ready'));
  const cols: PortalColumn<EfilingFiling>[] = [
    { key: 'sr', header: 'Sr. No.', cell: (_r, i) => i + 1, width: 60 },
    { key: 'no', header: 'E-Filing Number', cell: (f) => f.efilingNo ?? 'Not issued yet', text: (f) => f.efilingNo ?? '' },
    { key: 'name', header: 'Litigant Name', cell: (f) => splitTitle(f.caseTitle)[0], text: (f) => f.caseTitle },
    { key: 'mobile', header: 'Mobile Number', cell: (f) => <ClientMobile caseId={f.caseId} /> },
    { key: 'date', header: 'Date', cell: (f) => dmy(f.createdAt) },
    {
      key: 'action', header: 'Action', cell: (f) => (
        <span className="row" style={{ gap: 6 }}>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => onEdit(f.id)}>Edit</button>
          <button
            type="button"
            className="btn btn-sm"
            style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
            disabled={del.isPending}
            onClick={() => { if (window.confirm('Are you sure you want to delete this record?')) del.mutate(f.id); }}
          >
            Delete
          </button>
        </span>
      ),
    },
  ];
  return <PortalTable rows={rows} columns={cols} groupBy={(f) => f.caseTitle} label="Draft case filings" empty="No draft case filings." />;
}

function ClientMobile({ caseId }: { caseId: string }) {
  const { data } = useFilingParticulars(caseId);
  const p = data?.parties ?? [];
  return <>{(p.find((x) => x.isClient) ?? p[0])?.mobile ?? '—'}</>;
}

/** PDF: the eFiled new cases. */
function EfiledList({ onView }: { onView: (id: string) => void }) {
  const { data: filings } = useEfilingFilings();
  const rows = (filings ?? []).filter((f) => f.kind === 'new_case' && !['draft', 'ready', 'withdrawn'].includes(f.status));
  const cols: PortalColumn<EfilingFiling>[] = [
    { key: 'sr', header: 'Sr.No.', cell: (_r, i) => i + 1, width: 60 },
    { key: 'no', header: 'E-Filing No', cell: (f) => <span className="mono" style={{ fontSize: 12 }}>{f.efilingNo ?? '—'}</span>, text: (f) => f.efilingNo ?? '' },
    { key: 'pet', header: 'Petitioner Name', cell: (f) => splitTitle(f.caseTitle)[0], text: (f) => f.caseTitle },
    { key: 'res', header: 'Respondent Name', cell: (f) => splitTitle(f.caseTitle)[1] || '—' },
    { key: 'reg', header: 'Registration date', cell: (f) => dmy(f.registeredAt ?? f.efiledAt) },
    { key: 'action', header: 'Action', cell: (f) => <button type="button" className="btn btn-primary btn-sm" onClick={() => onView(f.id)}>View</button> },
  ];
  return <PortalTable rows={rows} columns={cols} groupBy={(f) => KIND_LABEL[f.kind]} label="eFiled cases" empty="No case eFiled yet." />;
}

// ---- e-File tab -------------------------------------------------------------------

function KvGrid({ rows }: { rows: Array<[string, string | number | null | undefined]> }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: 0, border: '1px solid var(--border-default)', borderRadius: 6 }}>
      {rows.map(([k, v]) => (
        <div key={k} className="row" style={{ gap: 8, padding: '6px 10px', borderBottom: '1px solid var(--border-default)' }}>
          <span className="body-sm" style={{ fontWeight: 700, minWidth: 110 }}>{k}:</span>
          <span className="body-sm" style={{ overflowWrap: 'anywhere', color: v === null || v === undefined || v === '' ? 'var(--text-tertiary)' : undefined }}>
            {v === null || v === undefined || v === '' ? '—' : String(v)}
          </span>
        </div>
      ))}
    </div>
  );
}

function Accordion({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className="col" style={{ gap: 0 }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        style={{
          textAlign: 'left', padding: '9px 12px', borderRadius: open ? '6px 6px 0 0' : 6, border: '1px solid var(--border-default)', cursor: 'pointer', font: 'inherit', fontWeight: 700,
          background: open ? 'var(--bg-inverse)' : 'var(--bg-surface-2, var(--bg-subtle))', color: open ? 'var(--text-inverse)' : 'inherit',
        }}
      >
        {open ? '▾' : '▸'} {title}
      </button>
      {open ? <div className="col" style={{ gap: 10, padding: 12, border: '1px solid var(--border-default)', borderTop: 'none', borderRadius: '0 0 6px 6px', maxHeight: 420, overflowY: 'auto' }}>{children}</div> : null}
    </div>
  );
}

function EFileTab({ filing, bundle, mact, onPrev }: { filing: FilingDetailDto; bundle: ParticularsBundle | null; mact: boolean; onPrev: () => void }) {
  const transition = useTransitionEfiling(filing.id);
  const [efilingNo, setEfilingNo] = useState(filing.efilingNo ?? '');
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string>('litigant');
  const [done, setDone] = useState<string | null>(null);
  const p: FilingParticulars | null = bundle?.particulars ?? null;
  const parties = bundle?.parties ?? [];
  const onPortal = !['draft', 'ready'].includes(filing.status);
  const toggle = (k: string) => setOpen((o) => (o === k ? '' : k));

  const submit = () => {
    if (!window.confirm('Do you want to submit the case?\n Once submitted, case details can not be modfied.')) return;
    setError(null);
    transition.mutate({ to: 'efiled', efilingNo }, {
      onSuccess: () => setDone(`Case registration successfully ${efilingNo.trim()}`),
      onError: (err) => setError(errMsg(err, 'Could not record the eFiling number')),
    });
  };

  return (
    <div className="col" style={{ gap: 14 }}>
      <StageTracker f={filing} />
      {!onPortal ? <ReadinessCard filingId={filing.id} /> : null}
      <section className="card col" style={{ gap: 10 }}>
        <PortalTitle>e-File</PortalTitle>
        <Accordion title="Litigant" open={open === 'litigant'} onToggle={() => toggle('litigant')}>
          {parties.length === 0 ? <span className="body-sm muted">No parties yet.</span> : parties.map((x, i) => (
            <div key={x.id} className="col" style={{ gap: 6 }}>
              <strong className="body-sm">
                {x.legalHeirOf ? 'Legal Heir' : `${i === parties.findIndex((y) => y.side === x.side) ? 'Main' : 'Extra'} ${x.side === 'petitioner' ? 'Petitioner' : 'Respondent'}`}
                {x.isClient ? ' (client)' : ''}
              </strong>
              <KvGrid rows={[
                [x.isOrganization ? 'Organisation Name' : 'Name', x.name],
                ['Organisation Type', x.isOrganization ? (x.extra?.['organisationType'] ?? '') : ''],
                ['Gender', x.gender === 'M' ? 'Male' : x.gender === 'F' ? 'Female' : x.gender === 'T' ? 'Other' : ''],
                ['Age', x.age],
                ['Relation', x.relationType ? `${x.relationType} ${x.relationName ?? ''}` : ''],
                ['Email', x.email],
                ['Mobile No.', x.mobile],
                ['Address', [x.address, x.district, x.state, x.pinCode].filter(Boolean).join(', ')],
              ]} />
            </div>
          ))}
        </Accordion>
        <Accordion title="Fact Details" open={open === 'facts'} onToggle={() => toggle('facts')}>
          {(bundle?.facts ?? []).length === 0 ? <span className="body-sm muted">No facts entered (this tab is not compulsory).</span>
            : <KvGrid rows={(bundle?.facts ?? []).map((f, i) => [`${i + 1}. ${dmy(f.factDate)}${f.factTime ? ` ${f.factTime}` : ''}`, f.description])} />}
        </Accordion>
        <Accordion title="Case Details" open={open === 'case'} onToggle={() => toggle('case')}>
          <KvGrid rows={[
            ['Establishment', p?.establishmentName],
            ['Case Type', p?.caseTypeName],
            ['Relief Sought', p?.extra?.reliefSought],
            ['Cause of Action', p?.causeOfAction],
            ['Date of Cause of Action', dmy(p?.causeOfActionDate)],
            ['Important Information', p?.subject],
            ['Prayer', p?.prayer],
            ['Valuation [₹]', p?.valuationInr != null ? p.valuationInr.toLocaleString('en-IN') : ''],
            ['Acts', (p?.acts ?? []).map((a) => `${a.act} ${a.section}`).join('; ')],
          ]} />
        </Accordion>
        {mact ? (
          <Accordion title="MVC" open={open === 'mvc'} onToggle={() => toggle('mvc')}>
            <KvGrid rows={[
              ['Police Station', p?.mact?.policeStation],
              ['FIR Number', p?.mact?.firNo ? `${p.mact.firNo}/${p.mact.firYear ?? ''}` : ''],
              ['Date of Accident', dmy(p?.mact?.accidentDate)],
              ['Place of Accident', p?.mact?.accidentPlace],
              ['Vehicle Regn. No.', p?.mact?.vehicleRegNo],
              ['Compensation Claimed', p?.mact?.compensationClaimedInr],
            ]} />
          </Accordion>
        ) : null}

        <SuccessNote lines={done ? [done] : []} />
        {onPortal ? (
          <p className="body-sm" style={{ textAlign: 'center' }}>
            Entered on the portal{filing.efilingNo ? ` as eFiling number ${filing.efilingNo}` : ''}{filing.efiledAt ? ` on ${formatDateTime(filing.efiledAt)}` : ''}. Next: Vakalat, then Pleadings.
          </p>
        ) : (
          <div className="col" style={{ gap: 10, alignItems: 'center' }}>
            <p className="body-sm muted" style={{ textAlign: 'center', maxWidth: 640 }}>
              On the portal, check every tab and press “eFile Case”. It shows “Case registration successfully” with the eFiling number. Record that number here.
            </p>
            <label className="col" style={{ gap: 4, width: 'min(100%, 340px)' }}>
              <span className="body-sm" style={{ fontWeight: 600 }}>eFiling number from the portal</span>
              <input className="input" value={efilingNo} onChange={(e) => setEfilingNo(e.target.value)} placeholder="e.g. KL02010045672026" />
            </label>
            <PortalButtons>
              <PButton onClick={onPrev}>Prev</PButton>
              <PButton primary disabled={!efilingNo.trim() || transition.isPending} onClick={submit}>eFile Case</PButton>
              <a className="btn btn-ghost btn-sm" href={PORTAL_URL} target="_blank" rel="noopener noreferrer">Open eFiling portal ↗</a>
            </PortalButtons>
          </div>
        )}
        {error ? <p className="body-sm" style={{ color: 'var(--danger)', textAlign: 'center' }}>{error}</p> : null}
      </section>
    </div>
  );
}

// =============================================================================
// Vakalat: Assign Partners to Case · Accept Offer · Print Vakalat
// =============================================================================

const VAKALAT_KINDS: FilingKind[] = ['new_case', 'caveat'];

export function VakalatModule({ view = 'assign', onOpen }: { view?: 'assign' | 'accept' | 'print'; onOpen: (id: string) => void }) {
  const { data: filings } = useEfilingFilings();
  const rows = (filings ?? []).filter((f) => VAKALAT_KINDS.includes(f.kind));
  const printLink = <Link className="btn btn-ghost btn-sm" to="/app/draft">Draft a vakalatnama →</Link>;

  if (view === 'print') {
    const cols: PortalColumn<EfilingFiling>[] = [
      { key: 'sr', header: 'Sr. No.', cell: (_r, i) => i + 1, width: 60 },
      { key: 'no', header: 'E-Filing Number', cell: (f) => f.efilingNo ?? '—', text: (f) => f.efilingNo ?? '' },
      { key: 'title', header: 'Cause Title', cell: (f) => { const [p, r] = splitTitle(f.caseTitle); return <CauseTitle petitioner={p} respondent={r} />; }, text: (f) => f.caseTitle },
      { key: 'lit', header: 'Name of Litigant', cell: (f) => <ClientName caseId={f.caseId} /> },
      { key: 'adv', header: 'Advocate', cell: () => 'MySelf' },
      { key: 'mob', header: 'Mobile No.', cell: (f) => <ClientMobile caseId={f.caseId} /> },
      { key: 'dl', header: 'Download Template', cell: () => <Link className="btn btn-primary btn-sm" to="/app/draft">Draft</Link> },
    ];
    return (
      <Card>
        <PortalTitle>Vakalat Templates</PortalTitle>
        <div className="row" style={{ justifyContent: 'flex-end' }}>{printLink}</div>
        <PortalTable rows={rows} columns={cols} label="Vakalat Templates" empty="No case filings yet." />
      </Card>
    );
  }

  if (view === 'accept') {
    const cols: PortalColumn<EfilingFiling>[] = [
      { key: 'sr', header: 'Sr. No.', cell: (_r, i) => i + 1, width: 60 },
      { key: 'no', header: 'E-Filing Number', cell: (f) => f.efilingNo ?? '—', text: (f) => f.efilingNo ?? '' },
      { key: 'title', header: 'Cause Title', cell: (f) => { const [p, r] = splitTitle(f.caseTitle); return <CauseTitle petitioner={p} respondent={r} />; }, text: (f) => f.caseTitle },
      { key: 'client', header: 'Name of Client', cell: (f) => <ClientName caseId={f.caseId} /> },
      { key: 'adv', header: 'Advocate', cell: () => 'MySelf' },
      { key: 'mob', header: 'Mobile No.', cell: (f) => <ClientMobile caseId={f.caseId} /> },
      { key: 'check', header: 'Check', cell: (f) => <AcceptOfferCheck f={f} /> },
    ];
    return (
      <Card>
        <PortalTitle>Vakalat</PortalTitle>
        <p className="body-sm muted">
          The client offers the vakalat on the portal; you accept it there with an OTP to your mobile. Tick the case here once you have accepted it.
        </p>
        <PortalTable rows={rows} columns={cols} label="Accept Offer" empty="No case filings yet." />
        {printLink}
      </Card>
    );
  }

  return (
    <Card>
      <PortalTitle>Vakalat</PortalTitle>
      <p className="body-sm muted">
        Assign Partners to Case on the portal: pick the case and your client, add partners (you are always in, as “MySelf”), tick the consent and
        Submit. The client then sends <strong>Offer to Advocate</strong> by OTP and you <strong>Accept Offer</strong> by OTP. Mark each case once the
        offer is accepted.
      </p>
      <div className="row" style={{ justifyContent: 'flex-end' }}>{printLink}</div>
      {rows.length === 0 ? <p className="body-sm muted">No case filings yet.</p> : rows.map((f) => <VakalatRow key={f.id} f={f} onOpen={onOpen} />)}
    </Card>
  );
}

function ClientName({ caseId }: { caseId: string }) {
  const { data } = useFilingParticulars(caseId);
  const p = data?.parties ?? [];
  const c = p.filter((x) => x.isClient);
  return <>{c.length ? c.map((x) => `${x.name} (${x.side === 'petitioner' ? 'P' : 'R'})`).join(', ') : '—'}</>;
}

function AcceptOfferCheck({ f }: { f: EfilingFiling }) {
  const update = useUpdateEfiling(f.id);
  const on = f.steps.vakalat === 'done';
  return (
    <label className="row body-sm" style={{ gap: 6, alignItems: 'center' }}>
      <input type="checkbox" checked={on} disabled={update.isPending || DONE_STATES.includes(f.status)}
        onChange={(e) => update.mutate({ steps: { vakalat: e.target.checked ? 'done' : 'pending' } })} />
      I accept the offer.
    </label>
  );
}

function VakalatRow({ f, onOpen }: { f: EfilingFiling; onOpen: (id: string) => void }) {
  const update = useUpdateEfiling(f.id);
  const state = f.steps.vakalat ?? 'pending';
  return (
    <div className="row" style={{ gap: 10, alignItems: 'center', padding: '8px 0', borderTop: '1px solid var(--border-default)', flexWrap: 'wrap' }}>
      <div className="col" style={{ flex: 1, minWidth: 220 }}>
        <span className="body-sm" style={{ fontWeight: 600 }}>{f.caseTitle}</span>
        <span className="body-sm muted">{label(f)} · Client: <ClientName caseId={f.caseId} /></span>
      </div>
      <select className="input" style={{ width: 170 }} value={state} aria-label={`Vakalat for ${f.caseTitle}`}
        disabled={update.isPending || DONE_STATES.includes(f.status)}
        onChange={(e) => update.mutate({ steps: { vakalat: e.target.value as PortalStepState } })}>
        <option value="pending">Pending</option>
        <option value="done">Offer accepted</option>
        <option value="not_applicable">Not needed</option>
      </select>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => onOpen(f.id)}>Open</button>
    </div>
  );
}

// =============================================================================
// Pleadings: Pleading Upload | Indexing | Pleading eSign · Oath Recording
// =============================================================================

type PleadingTab = 'upload' | 'indexing' | 'esign';

export function PleadingsModule({ initialFiling }: { initialFiling: string | null }) {
  const { id, setId, filing } = usePicked(initialFiling);
  const [tab, setTab] = useState<PleadingTab>('upload');
  return (
    <div className="col" style={{ gap: 14 }}>
      <Card>
        <PortalTitle>Pleadings</PortalTitle>
        <PortalTabs
          label="Pleadings"
          tabs={[{ id: 'upload', label: 'Pleading Upload', icon: '⬆︎' }, { id: 'indexing', label: 'Indexing', icon: '☰' }, { id: 'esign', label: 'Pleading eSign', icon: '✍︎' }]}
          value={tab}
          onChange={setTab}
        />
        <SearchCaseBlock value={id} onChange={setId} kinds={PLEADING_KINDS} />
      </Card>
      {!filing ? <Card><p className="body-sm muted">Choose the case above, the way the portal asks for it under Search Case.</p></Card> : (
        <>
          {tab === 'upload' ? (
            <>
              <StepControl filing={filing} stepKey="upload" />
              <DocumentsCard f={filing} editable={['draft', 'ready', 'efiled', 'objected'].includes(filing.status)} />
            </>
          ) : null}
          {tab === 'indexing' ? <IndexingTab filing={filing} /> : null}
          {tab === 'esign' ? <EsignTab filing={filing} /> : null}
        </>
      )}
    </div>
  );
}

/** Pleadings > Video Recording ("Oath Recording"). */
export function OathModule({ initialFiling }: { initialFiling: string | null }) {
  const { id, setId, filing } = usePicked(initialFiling);
  return (
    <div className="col" style={{ gap: 14 }}>
      <Card>
        <PortalTitle>Oath Recording</PortalTitle>
        <SearchCaseBlock value={id} onChange={setId} kinds={PLEADING_KINDS} />
        <p className="body-sm muted">
          The oath is a webcam video recorded on the portal (Pleadings &gt; Video Recording &gt; Record your Oath) for the document that needs it,
          then uploaded to the server. Where your court doesn’t require it, mark it “Not needed”.
        </p>
      </Card>
      {filing ? <StepControl filing={filing} stepKey="oath" /> : null}
    </div>
  );
}

function IndexingTab({ filing }: { filing: FilingDetailDto }) {
  // Same page arithmetic as the bundle: index page(s) first, then each document.
  const rows = useMemo(() => {
    const indexPages = Math.max(1, Math.ceil(filing.documents.length / 32));
    let next = indexPages + 1;
    return filing.documents.map((d) => {
      const n = d.pageCount ?? 0;
      const r = { title: d.label, from: n ? next : null, to: n ? next + n - 1 : null };
      next += n;
      return r;
    });
  }, [filing.documents]);
  const missing = filing.documents.some((d) => d.pageCount == null);
  return (
    <Card>
      <p className="body-sm muted">On the portal’s Indexing tab, use “Add Index” for each document: Index Title, From Page No., To Page No. Copy them from here.</p>
      {filing.documents.length === 0 ? <p className="body-sm muted">No Index Created for This Document. Add documents under Pleading Upload.</p> : (
        <table className="tbl" aria-label="Indexing">
          <thead><tr><th style={{ width: 70 }}>Sr. No.</th><th>Index Title</th><th style={{ width: 140 }}>Page Nos.</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.title}><td>{i + 1}</td><td>{r.title}</td><td className="mono">{r.from != null ? `${r.from} - ${r.to}` : '—'}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      {missing && filing.documents.length > 0 ? <p className="body-sm" style={{ color: 'var(--warning)' }}>Build the bundle under Pleading Upload to fill in the page numbers.</p> : null}
      <StepControl filing={filing} stepKey="indexing" />
    </Card>
  );
}

function EsignTab({ filing }: { filing: FilingDetailDto }) {
  const { data } = useFilingParticulars(filing.caseId);
  const clients = (data?.parties ?? []).filter((x) => x.isClient);
  const signatories: Array<{ name: string; type: string }> = [
    { name: 'MySelf (advocate)', type: 'eSign or OTP' },
    ...clients.map((c) => ({ name: c.name, type: c.mobile ? `OTP to ${c.mobile}` : 'eSign (no mobile on record)' })),
  ];
  return (
    <Card>
      <p className="body-sm muted">
        On the portal: <strong>Authorize Signatories</strong> (“To be signed By” - Advocate / Client, eSign or OTP each), then each signatory signs.
        eSign is Aadhaar-based through C-DAC, so the signatory must do it themselves.
      </p>
      <table className="tbl" aria-label="Pleading eSign">
        <thead><tr><th style={{ width: 70 }}>Sr. No.</th><th>Signatories</th><th>Signature Type</th></tr></thead>
        <tbody>
          {signatories.map((s, i) => <tr key={s.name}><td>{i + 1}</td><td>{s.name}</td><td>{s.type}</td></tr>)}
        </tbody>
      </table>
      {clients.length === 0 ? <span className="body-sm muted">No client marked yet (Case Filing &gt; Litigant).</span> : null}
      <StepControl filing={filing} stepKey="esign" />
    </Card>
  );
}

// =============================================================================
// ePayments: Payment · Court Fee Wallet
// =============================================================================

export function PaymentsModule({ initialFiling, view = 'payment' }: { initialFiling: string | null; view?: 'payment' | 'wallet' }) {
  const { id, setId, filing } = usePicked(initialFiling);
  return (
    <div className="col" style={{ gap: 14 }}>
      <Card aside={<Link className="btn btn-ghost btn-sm" to="/app/calculators?tab=court-fee">Court fee calculator →</Link>}>
        <PortalTitle>{view === 'wallet' ? 'Court Fee Wallet' : 'ePayments'}</PortalTitle>
        {view === 'wallet' ? (
          <p className="body-sm muted">
            The wallet lives on the portal (ePayments &gt; Court Fee Wallet) and is <strong>per establishment</strong>: a balance added for one court
            can’t pay fees in another. IA fees are paid from it. When you pay a fee from the wallet, record it on the filing with “Paid via: Court fee wallet”.
          </p>
        ) : null}
        <SearchCaseBlock value={id} onChange={setId} />
      </Card>
      {filing ? <PaymentsCard f={filing} /> : <Card><p className="body-sm muted">Choose the case under Search Case to pay and record its GRN.</p></Card>}
    </div>
  );
}

// =============================================================================
// Applications: Interlocutory Application Filing · Submitted Applications
// =============================================================================

type IaTab = 'applications' | 'fees' | 'auth';

export function ApplicationsModule({ initialFiling, onOpen, view = 'filing' }: { initialFiling: string | null; onOpen: (id: string) => void; view?: 'filing' | 'submitted' }) {
  const [shown, setShown] = useState<'filing' | 'submitted'>(view);
  const { id, setId, filing } = usePicked(initialFiling);
  const [tab, setTab] = useState<IaTab>('applications');
  const { data: cases } = useCases();
  const create = useCreateEfiling();
  const [newCase, setNewCase] = useState('');
  const [newTitle, setNewTitle] = useState('');

  return (
    <div className="col" style={{ gap: 14 }}>
      <Card>
        <PortalTitle>{shown === 'submitted' ? 'Submitted Applications' : 'Applications'}</PortalTitle>
        <div className="row" style={{ gap: 6, justifyContent: 'center' }}>
          <button type="button" className={`btn btn-sm ${shown === 'filing' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setShown('filing')}>Interlocutory Application Filing</button>
          <button type="button" className={`btn btn-sm ${shown === 'submitted' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setShown('submitted')}>Submitted Applications</button>
        </div>
      </Card>

      {shown === 'submitted' ? <SubmittedApplications onOpen={onOpen} /> : (
        <>
          <Card>
            <PortalTabs
              label="Applications"
              tabs={[
                { id: 'applications', label: 'Applications', icon: '▤' },
                { id: 'fees', label: 'Pay Fees', icon: '₹', disabled: !filing },
                { id: 'auth', label: 'Authentication', icon: '✓', disabled: !filing },
              ]}
              value={tab}
              onChange={setTab}
            />
            <SearchCaseBlock value={id} onChange={setId} kinds={['ia']} placeholder="Select an application (IA)" />
            <PortalSection title="New Application">
              <div className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <label className="col" style={{ gap: 4, minWidth: 240 }}>
                  <span className="body-sm muted">New application in matter</span>
                  <select className="input" value={newCase} onChange={(e) => setNewCase(e.target.value)}>
                    <option value="">Select matter</option>
                    {(cases ?? []).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                  </select>
                </label>
                <label className="col" style={{ gap: 4, flex: 1, minWidth: 220 }}>
                  <span className="body-sm muted">Application</span>
                  <input className="input" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Application Type, e.g. Taking Adjournment" />
                </label>
                <button type="button" className="btn btn-primary btn-sm" disabled={!newCase || create.isPending}
                  onClick={() => create.mutate({ caseId: newCase, kind: 'ia', title: newTitle || undefined }, { onSuccess: (f) => { setId(f.id); setNewTitle(''); setTab('applications'); } })}>
                  + New application
                </button>
              </div>
            </PortalSection>
          </Card>
          {filing ? (
            <>
              <StageTracker f={filing} />
              {tab === 'applications' ? <IaApplicationTab filing={filing} /> : null}
              {tab === 'fees' ? (
                <>
                  <StepControl filing={filing} stepKey="ia_fee" />
                  <PaymentsCard f={filing} />
                </>
              ) : null}
              {tab === 'auth' ? <IaAuthTab filing={filing} /> : null}
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

function SubmittedApplications({ onOpen }: { onOpen: (id: string) => void }) {
  const { data: filings } = useEfilingFilings();
  const [which, setWhich] = useState<'submitted' | 'pending'>('submitted');
  const ias = (filings ?? []).filter((f) => f.kind === 'ia');
  const rows = which === 'submitted' ? ias.filter((f) => DONE_STATES.includes(f.status)) : ias.filter((f) => DRAFT_STATES.includes(f.status));
  return (
    <Card>
      <div className="row" style={{ justifyContent: 'center' }}>
        <PRadios
          label="Show"
          name="submitted-ias"
          value={which}
          options={[{ value: 'submitted', label: 'Submitted' }, { value: 'pending', label: 'Pending' }]}
          onChange={setWhich}
        />
      </div>
      <IaTable rows={rows} onOpen={onOpen} />
    </Card>
  );
}

function IaApplicationTab({ filing }: { filing: FilingDetailDto }) {
  const transition = useTransitionEfiling(filing.id);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="col" style={{ gap: 14 }}>
      <Card>
        <p className="body-sm muted">
          On the portal: pick the case and the Application Type. The Preamble, Prayer and Court Fee (₹) fill in; you add Paragraph1, Paragraph2…
          and Submit (“Application added successfully”). Draft the application in LexDraft and attach it below.
        </p>
        <StepControl filing={filing} stepKey="ia_application" />
        {['draft', 'ready'].includes(filing.status) ? (
          <div>
            <button type="button" className="btn btn-primary btn-sm" disabled={transition.isPending}
              onClick={() => { setError(null); transition.mutate({ to: 'efiled' }, { onError: (err) => setError(errMsg(err, 'Could not update')) }); }}>
              Added on the portal
            </button>
          </div>
        ) : null}
        {error ? <p className="body-sm" style={{ color: 'var(--danger)' }}>{error}</p> : null}
      </Card>
      <DocumentsCard f={filing} editable={['draft', 'ready', 'efiled', 'objected'].includes(filing.status)} />
    </div>
  );
}

function IaAuthTab({ filing }: { filing: FilingDetailDto }) {
  const transition = useTransitionEfiling(filing.id);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card>
      <p className="body-sm muted">
        “I have viewed the application and wish to submit”: you authenticate by OTP and so does the litigant - in their own login, or you enter
        the OTP sent to their mobile (Litigant OTP Verification), with their permission. The portal submits the application once both are done.
      </p>
      <StepControl filing={filing} stepKey="ia_auth_advocate" />
      <StepControl filing={filing} stepKey="ia_auth_litigant" />
      {filing.status === 'efiled' ? (
        <div>
          <button type="button" className="btn btn-primary btn-sm" disabled={transition.isPending}
            onClick={() => { setError(null); transition.mutate({ to: 'submitted' }, { onError: (err) => setError(errMsg(err, 'Could not submit')) }); }}>
            Authenticated &amp; submitted
          </button>
        </div>
      ) : null}
      {error ? <p className="body-sm" style={{ color: 'var(--danger)' }}>{error}</p> : null}
    </Card>
  );
}

// =============================================================================
// Objections
// =============================================================================

export function ObjectionsModule({ onOpen }: { onOpen: (id: string) => void }) {
  const { data: filings } = useEfilingFilings();
  const rows = (filings ?? []).filter((f) => f.status === 'objected');
  const cols: PortalColumn<EfilingFiling>[] = [
    { key: 'sr', header: 'Sr.No.', cell: (_r, i) => i + 1, width: 60 },
    { key: 'reason', header: 'Reason', cell: (f) => <span style={{ whiteSpace: 'pre-wrap' }}>{f.objections ?? '—'}</span>, text: (f) => f.objections ?? '' },
    { key: 'date', header: 'Date', cell: (f) => dmy(f.objectionsRaisedAt) },
    { key: 'action', header: 'Action', cell: (f) => <ObjectionActions f={f} onOpen={onOpen} /> },
  ];
  return (
    <Card>
      <PortalTitle>Objections</PortalTitle>
      <p className="body-sm muted">Objections the registry raised on submitted cases, pleadings and IAs. Cure them on the portal, then mark the filing re-filed.</p>
      <PortalTable rows={rows} columns={cols} groupBy={(f) => `${f.efilingNo ?? 'No eFiling no.'} - ${f.title} (${f.caseTitle})`} label="Objections" empty="No objections." />
    </Card>
  );
}

function ObjectionActions({ f, onOpen }: { f: EfilingFiling; onOpen: (id: string) => void }) {
  const transition = useTransitionEfiling(f.id);
  return (
    <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
      <button type="button" className="btn btn-primary btn-sm" disabled={transition.isPending} onClick={() => transition.mutate({ to: 'refiled' })}>Re-filed after curing</button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => onOpen(f.id)}>Open</button>
    </span>
  );
}
