import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@lexdraft/ui';
import { useCases, type CaseListItem } from '@/hooks/useCases';
import { useEcourtsCourtStore } from '@/store/ecourtsCourt';
import { EcourtsSyncStatusStrip } from './EcourtsSyncStatusStrip';
import { linkStatusDisplay } from './linkStatus';
import { L, useEcourtsT } from '@/hooks/useEcourtsLabels';
import { MyCasesImportExport } from './MyCasesImportExport';
import { AnchoredMenu, SectionBar, TextSearchBox } from './app/AppUi';

// "My Cases" laid out like the eCourts app: a toolbar with [My Cases ▾]
// (Date wise / District wise), the calendar with today's count, and refresh;
// "My Cases Related to District Court" with a text search; then
//   Date wise:     Disposed Cases (n) · Undated Cases (n) · month headings ·
//                  one bar per hearing date "dd-mm-yyyy (n)"
//   District wise: one bar per district (cases grouped by the CNR's
//                  state+district code)
//   Calendar:      the month with a count on each listed date.
// In DifAI the saved cases ARE the matters, so a case opens its matter.

/** Today's date in the advocate's local time, yyyy-mm-dd. */
export function localToday(): string {
  return new Intl.DateTimeFormat('en-CA').format(new Date());
}

/** Number of matters listed today - the "My Cases" tab badge. */
export function useTodaysCasesCount(): number {
  const { data } = useCases();
  const today = localToday();
  return (data ?? []).filter((c) => c.next === today && c.status !== 'Closed').length;
}

const isHighCourt = (c: CaseListItem) => /high\s*court/i.test(c.court ?? '');
const dmy = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d}-${m}-${y}`; };
const monthTitle = (iso: string) => new Date(`${iso.slice(0, 7)}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

type View = 'date' | 'district' | 'calendar';

export function MyCasesPanel() {
  const { t } = useEcourtsT();
  const tier = useEcourtsCourtStore((s) => s.scope.court);
  const { data, isLoading, refetch, isFetching } = useCases();
  const [view, setView] = useState<View>('date');
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLButtonElement | null>(null);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const [filter, setFilter] = useState('');
  const today = localToday();

  // The app keeps District Court and High Court cases apart.
  const all = useMemo(
    () => (data ?? []).filter((c) => c.status !== 'Archived' && (tier === 'HC') === isHighCourt(c)),
    [data, tier],
  );
  const q = filter.trim().toLowerCase();
  const shown = useMemo(
    () => (q ? all.filter((c) => [c.title, c.cnr, c.court, c.stage, c.next].some((v) => String(v ?? '').toLowerCase().includes(q))) : all),
    [all, q],
  );
  const todays = all.filter((c) => c.next === today && c.status !== 'Closed').length;

  return (
    <div className="col stagger" style={{ gap: 14 }}>
      <div className="card" style={{ padding: '12px 16px' }}>
        <EcourtsSyncStatusStrip />
      </div>

      {/* The app's grey toolbar. */}
      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: 8, borderRadius: 10, background: 'var(--bg-surface-2)' }}>
        <button ref={setMenuAnchor} type="button" className={`btn${view !== 'calendar' ? ' btn-primary' : ''}`} onClick={() => setMenuOpen((o) => !o)} aria-haspopup="menu" aria-expanded={menuOpen}>
          {t(L.myCases, 'My Cases')} <Icon name="chevronD" size={12} />
        </button>
        <AnchoredMenu anchor={menuAnchor} open={menuOpen} onClose={closeMenu} minWidth={170}>
          {(['date', 'district'] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="menuitemradio"
              aria-checked={view === v}
              className="btn btn-ghost"
              style={{ width: '100%', justifyContent: 'flex-start', fontWeight: view === v ? 700 : 400 }}
              onClick={() => { setView(v); setMenuOpen(false); }}
            >
              {v === 'date' ? t(L.dateWise, 'Date Wise') : t(L.districtWise, 'District Wise')}
            </button>
          ))}
        </AnchoredMenu>
        <button
          type="button"
          className={`btn${view === 'calendar' ? ' btn-primary' : ''}`}
          onClick={() => setView(view === 'calendar' ? 'date' : 'calendar')}
          title={t(L.calendar, 'Calendar')}
          aria-label={`${t(L.calendar, 'Calendar')}: ${todays} today`}
        >
          <Icon name="calendar" size={14} /> <span className="badge" style={{ marginLeft: 2 }}>{todays}</span>
        </button>
        <button type="button" className="btn" onClick={() => void refetch()} disabled={isFetching} title="Refresh" aria-label="Refresh">
          <span aria-hidden style={{ display: 'inline-block', transform: isFetching ? 'rotate(180deg)' : undefined, transition: 'transform 300ms' }}>⟳</span>
        </button>
        <span className="spacer" style={{ flex: 1 }} />
        <MyCasesImportExport cases={all} />
      </div>

      <h2 className="heading-md" style={{ textAlign: 'center' }}>
        {t(L.myCases, 'My Cases')} Related to {tier === 'HC' ? t(L.highCourt, 'High Court') : t(L.districtCourt, 'District Court')}
      </h2>

      {view !== 'calendar' ? <TextSearchBox value={filter} onChange={setFilter} /> : null}

      {isLoading ? (
        <span className="muted">Loading your cases…</span>
      ) : all.length === 0 ? (
        <div className="card">
          <p className="body-md muted">
            No cases yet. Find a case under CNR or Case Status and choose “{t(L.addCase, 'Add Case')}”, or use Import.
          </p>
        </div>
      ) : view === 'date' ? (
        <DateWise cases={shown} />
      ) : view === 'district' ? (
        <DistrictWise cases={shown} />
      ) : (
        <CalendarView cases={all} />
      )}
    </div>
  );
}

function CaseRows({ cases }: { cases: CaseListItem[] }) {
  const navigate = useNavigate();
  const { t } = useEcourtsT();
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="tbl">
        <thead>
          <tr>
            <th>{t(L.caseNumber, 'Case')}</th>
            <th>{t(L.cnrNumber, 'CNR Number')}</th>
            <th>{t(L.caseStage, 'Case Stage')}</th>
            <th>eCourts</th>
          </tr>
        </thead>
        <tbody>
          {cases.map((c) => {
            const d = linkStatusDisplay(c.ecourtsLinkStatus);
            return (
              <tr key={c.id} onClick={() => navigate(`/app/cases/${c.id}`)} style={{ cursor: 'pointer' }}>
                <td>
                  {c.title ? <em className="case-name">{c.title}</em> : <span className="muted">Awaiting eCourts details</span>}
                  {c.court ? <div className="body-sm muted">{c.court}</div> : null}
                </td>
                <td className="mono">{c.cnr}</td>
                <td>{c.stage || '—'}</td>
                <td><span className={`badge ${d.badge}`}>{d.label.toUpperCase()}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Group({ title, cases, defaultOpen = false, warn }: { title: string; cases: CaseListItem[]; defaultOpen?: boolean; warn?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  if (cases.length === 0) return null;
  return (
    <div className="col">
      <SectionBar
        title={`${title} (${cases.length})`}
        open={open}
        onToggle={() => setOpen((o) => !o)}
        right={warn ? <span title="Needs a date" aria-label="Needs attention">⚠</span> : undefined}
      />
      {open ? <div style={{ paddingTop: 6 }}><CaseRows cases={cases} /></div> : null}
    </div>
  );
}

function DateWise({ cases }: { cases: CaseListItem[] }) {
  const { t } = useEcourtsT();
  const today = localToday();
  const disposed = cases.filter((c) => c.status === 'Closed');
  const live = cases.filter((c) => c.status !== 'Closed');
  const undated = live.filter((c) => !/^\d{4}-\d{2}-\d{2}$/.test(c.next ?? ''));
  const dated = live.filter((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.next ?? ''));
  // As in the app: upcoming dates first, then past ones.
  const dates = [...new Set(dated.map((c) => c.next))].sort((a, b) => {
    const fa = a >= today; const fb = b >= today;
    return fa === fb ? (fa ? a.localeCompare(b) : b.localeCompare(a)) : fa ? -1 : 1;
  });
  let lastMonth = '';
  return (
    <div className="col" style={{ gap: 8 }}>
      <Group title={t(L.disposedCasesList, 'Disposed Cases')} cases={disposed} />
      <Group title={t(L.undatedCases, 'Undated Cases')} cases={undated} warn />
      {dates.map((d) => {
        const month = d.slice(0, 7);
        const header = month !== lastMonth ? monthTitle(d) : null;
        lastMonth = month;
        return (
          <div key={d} className="col" style={{ gap: 8 }}>
            {header ? (
              <div className="body-md" style={{ textAlign: 'center', fontWeight: 700, padding: '6px 0', borderRadius: 8, background: 'var(--bg-surface-2)' }}>{header}</div>
            ) : null}
            <Group title={dmy(d)} cases={dated.filter((c) => c.next === d)} defaultOpen={d === today} />
          </div>
        );
      })}
    </div>
  );
}

function DistrictWise({ cases }: { cases: CaseListItem[] }) {
  // The CNR's first four letters are the state + district code.
  const groups = new Map<string, CaseListItem[]>();
  for (const c of cases) {
    const cnr = (c.cnr ?? '').toUpperCase();
    const key = /^[A-Z]{4}[A-Z0-9]{12}$/.test(cnr) ? cnr.slice(0, 4) : 'Not on eCourts yet';
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const titled = [...groups.entries()].map(([key, list]) => {
    const court = list.find((c) => c.court)?.court ?? '';
    return { key, title: key.length === 4 ? `${court || key}${court ? ` (${key})` : ''}` : key, list };
  }).sort((a, b) => a.title.localeCompare(b.title));
  return (
    <div className="col" style={{ gap: 8 }}>
      {titled.map((g) => <Group key={g.key} title={g.title} cases={g.list} />)}
    </div>
  );
}

/** The app's round arrows on the calendar's month bar. */
const NAV_BTN = {
  width: 34, height: 34, borderRadius: 999, border: '2px solid var(--text-inverse)', background: 'transparent',
  color: 'var(--text-inverse)', cursor: 'pointer', fontSize: 16, lineHeight: 1,
} as const;

function CalendarView({ cases }: { cases: CaseListItem[] }) {
  const today = localToday();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [picked, setPicked] = useState<string | null>(today);
  const counts = new Map<string, number>();
  for (const c of cases) if (c.status !== 'Closed' && /^\d{4}-\d{2}-\d{2}$/.test(c.next ?? '')) counts.set(c.next, (counts.get(c.next) ?? 0) + 1);
  const first = new Date(`${month}-01T00:00:00`);
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const lead = first.getDay();
  const cells: Array<string | null> = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];
  const shift = (n: number) => {
    const d = new Date(first.getFullYear(), first.getMonth() + n, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };
  const dayCases = picked ? cases.filter((c) => c.next === picked && c.status !== 'Closed') : [];
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="card" style={{ padding: 0, overflow: 'hidden', maxWidth: 560, width: '100%', alignSelf: 'center' }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: 'var(--bg-inverse)', color: 'var(--text-inverse)' }}>
          <button type="button" onClick={() => shift(-1)} aria-label="Previous month" style={NAV_BTN}>←</button>
          <strong>{monthTitle(`${month}-01`)}</strong>
          <button type="button" onClick={() => shift(1)} aria-label="Next month" style={NAV_BTN}>→</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
            <div key={d} className="body-sm" style={{ textAlign: 'center', padding: 6, background: 'var(--bg-surface-2)', fontWeight: 600 }}>{d}</div>
          ))}
          {cells.map((iso, i) => {
            const n = iso ? counts.get(iso) ?? 0 : 0;
            const isPicked = iso === picked;
            return (
              <button
                key={i}
                type="button"
                disabled={!iso}
                onClick={() => iso && setPicked(iso)}
                style={{
                  minHeight: 58, border: '1px solid var(--border-subtle)', background: isPicked ? 'var(--bg-surface-2)' : 'var(--bg-surface)',
                  color: 'inherit', cursor: iso ? 'pointer' : 'default', display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
                  justifyContent: 'space-between', padding: 6, font: 'inherit', outline: iso === today ? '2px solid var(--text-primary)' : undefined, outlineOffset: -2,
                }}
                aria-label={iso ? `${dmy(iso)}: ${n} case${n === 1 ? '' : 's'}` : undefined}
              >
                <span className="body-sm">{iso ? Number(iso.slice(8)) : ''}</span>
                {n > 0 ? <span className="badge" style={{ alignSelf: 'center', background: 'var(--bg-inverse)', color: 'var(--text-inverse)' }}>{n}</span> : null}
              </button>
            );
          })}
        </div>
      </div>
      {picked ? (
        dayCases.length > 0 ? (
          <div className="col" style={{ gap: 6 }}>
            <div className="body-md" style={{ fontWeight: 700 }}>{dmy(picked)} ({dayCases.length})</div>
            <CaseRows cases={dayCases} />
          </div>
        ) : <p className="body-md muted" style={{ textAlign: 'center' }}>No cases listed on {dmy(picked)}.</p>
      ) : null}
    </div>
  );
}
