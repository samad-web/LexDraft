import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@lexdraft/ui';
import {
  useEcourtsCourtComplexes,
  useEcourtsDistricts,
  useEcourtsStates,
  type Court,
  type EcourtsCourtComplex,
} from '@/hooks/useEcourts';
import { EMPTY_SCOPE, useEcourtsCourtStore } from '@/store/ecourtsCourt';
import { L, useEcourtsT } from '@/hooks/useEcourtsLabels';

// =============================================================================
// The eCourts app's inner-screen building blocks, in DifAi's monochrome
// design system. Advocates know the app's screens, so every search follows
// its exact shape:
//
//   [State ▾] [District ▾]                      (shared row under the tabs)
//   Case Status : Search by <X>                 (screen title)
//   Court Complex*  [▾]                         (whole complex is searched)
//   <fields>*  ( ) Pending ( ) Disposed ...
//   [ Go ] [ Reset ]
//   Total Number of Establishments in Court Complex: N
//   Total Number of Cases: N
//   ▌<Establishment> : n ▌                       (collapsible bar)
//   Sr No | Case Number (link) | Party Name
//
// The app's dark section bars become inverse bars (black in light mode,
// white in dark mode) - structure from the app, colour from DifAi.
// =============================================================================

/** "Case Status : Search by Case Number" - the app's centred screen title. */
export function ScreenTitle({ section, title }: { section: string; title: string }) {
  return (
    <h2 className="heading-md" style={{ textAlign: 'center', margin: '4px 0 8px' }}>
      {section} : {title}
    </h2>
  );
}

/** A form field with the app's required-star label. */
export function AppField({ label, required, children, wide }: { label: string; required?: boolean; children: ReactNode; wide?: boolean }) {
  return (
    <label className="col" style={{ gap: 6, gridColumn: wide ? '1 / -1' : undefined, minWidth: 0 }}>
      <span className="body-md" style={{ fontWeight: 600 }}>
        {label}
        {required ? <span aria-hidden style={{ color: 'var(--danger)', marginLeft: 2 }}>*</span> : null}
      </span>
      {children}
    </label>
  );
}

/** One column on phones, two on wider screens - like the app's stacked form. */
export function FormGrid({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: 14 }}>
      {children}
    </div>
  );
}

export function RadioRow<T extends string>({ name, value, options, onChange, label }: {
  name: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <div className="col" style={{ gap: 6 }} role="radiogroup" aria-label={label ?? name}>
      {label ? <span className="body-md" style={{ fontWeight: 600 }}>{label}<span aria-hidden style={{ color: 'var(--danger)', marginLeft: 2 }}>*</span></span> : null}
      <div className="row" style={{ gap: 18, flexWrap: 'wrap' }}>
        {options.map((o) => (
          <label key={o.value} className="row body-md" style={{ gap: 6, alignItems: 'center', cursor: 'pointer' }}>
            <input type="radio" name={name} checked={value === o.value} onChange={() => onChange(o.value)} />
            {o.label}
          </label>
        ))}
      </div>
    </div>
  );
}

/** The app's Go / Reset pair. */
export function GoReset({ disabled, pending, onReset, goLabel }: { disabled?: boolean; pending?: boolean; onReset: () => void; goLabel?: string }) {
  const { t } = useEcourtsT();
  return (
    <div className="row" style={{ gap: 10 }}>
      <button type="submit" className="btn btn-primary btn-lg" style={{ minWidth: 120 }} disabled={disabled || pending}>
        {pending ? '…' : goLabel ?? t(L.go, 'Go')}
      </button>
      <button type="button" className="btn btn-lg" style={{ minWidth: 120 }} onClick={onReset}>
        {t(L.reset, 'Reset')}
      </button>
    </div>
  );
}

/** The app's collapsible dark bar (establishments, Case History sections,
 *  My Cases date groups). */
export function SectionBar({ title, open, onToggle, right, id }: {
  title: ReactNode;
  open: boolean;
  onToggle: () => void;
  right?: ReactNode;
  id?: string;
}) {
  return (
    <button
      type="button"
      id={id}
      onClick={onToggle}
      aria-expanded={open}
      className="row"
      style={{
        width: '100%', justifyContent: 'space-between', alignItems: 'center', gap: 10,
        padding: '12px 16px', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
        background: open ? 'var(--bg-surface)' : 'var(--bg-inverse)',
        color: open ? 'var(--text-primary)' : 'var(--text-inverse)',
        border: `2px solid var(--bg-inverse)`,
        font: 'inherit', fontWeight: 600,
      }}
    >
      <span style={{ minWidth: 0, flex: 1 }}>{title}</span>
      <span className="row" style={{ gap: 8, alignItems: 'center', flexShrink: 0 }}>
        {right}
        <span aria-hidden style={{ display: 'inline-flex', transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 120ms' }}>
          <Icon name="chevronD" size={14} />
        </span>
      </span>
    </button>
  );
}

/** Two-column label | value table (Case Details, Case Status, ...). */
export function KvTable({ rows }: { rows: ReadonlyArray<readonly [string, ReactNode]> }) {
  return (
    <table className="tbl" style={{ tableLayout: 'fixed', width: '100%' }}>
      <tbody>
        {rows.map(([k, v], i) => (
          <tr key={i}>
            <td style={{ width: '42%', fontWeight: 600, verticalAlign: 'top', whiteSpace: 'normal', overflowWrap: 'anywhere', overflow: 'visible', textOverflow: 'clip', background: 'var(--bg-surface-2)' }}>{k}</td>
            <td style={{ whiteSpace: 'normal', overflowWrap: 'anywhere', overflow: 'visible', textOverflow: 'clip' }}>{v === '' || v === null || v === undefined ? '—' : v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The app's search box with search and reset buttons (My Cases, results). */
export function TextSearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const { t } = useEcourtsT();
  return (
    <div className="row" style={{ gap: 0, alignItems: 'stretch' }}>
      <input
        className="input"
        style={{ flex: 1, borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
        value={value}
        placeholder={placeholder ?? t(L.enterTextToSearch, 'Enter text to search')}
        onChange={(e) => onChange(e.target.value)}
        aria-label={placeholder ?? 'Search'}
      />
      <span className="btn" aria-hidden style={{ borderRadius: 0, pointerEvents: 'none' }}><Icon name="search" size={14} /></span>
      <button type="button" className="btn" style={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }} onClick={() => onChange('')} aria-label="Clear search">
        ↺
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Court scope: State | District row + Court Complex
// ---------------------------------------------------------------------------

/** The app's State / District pair under the tabs - shared by every search
 *  on Case Status and Causelist, remembered between visits. */
export function StateDistrictBar() {
  const { t } = useEcourtsT();
  const scope = useEcourtsCourtStore((s) => s.scope);
  const setScope = useEcourtsCourtStore((s) => s.setScope);
  const states = useEcourtsStates(scope.court);
  const districts = useEcourtsDistricts(scope.stateCode === '' ? null : scope.stateCode, scope.court);
  const hc = scope.court === 'HC';
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
      <select
        className="input"
        aria-label={t(L.state, 'State')}
        value={scope.stateCode}
        disabled={states.isLoading}
        onChange={(e) => setScope({ ...EMPTY_SCOPE, court: scope.court, stateCode: e.target.value ? Number(e.target.value) : '' })}
      >
        <option value="">{states.isLoading ? 'Loading…' : scope.court === 'HC' ? 'Select High Court' : t(L.selectState, 'Select state')}</option>
        {(states.data ?? []).map((s) => <option key={s.state_code} value={s.state_code}>{s.state_name}</option>)}
      </select>
      {/* High Courts have benches where District Courts have districts
          (the app shows "Bench" here in High Court mode). */}
      <select
        className="input"
        aria-label={hc ? t(L.bench, 'Bench') : t(L.district, 'District')}
        value={scope.distCode}
        disabled={scope.stateCode === '' || districts.isLoading}
        onChange={(e) => setScope({ ...EMPTY_SCOPE, court: scope.court, stateCode: scope.stateCode, distCode: e.target.value ? Number(e.target.value) : '' })}
      >
        <option value="">
          {districts.isFetching ? 'Loading…' : hc ? `Select ${t(L.bench, 'Bench').toLowerCase()}` : t(L.selectDistrict, 'Select district')}
        </option>
        {(districts.data ?? []).map((d) => <option key={d.dist_code} value={d.dist_code}>{d.dist_name}</option>)}
      </select>
      {states.isError || districts.isError ? (
        <p className="body-sm muted" style={{ gridColumn: '1 / -1' }}>
          eCourts did not answer.{' '}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { void states.refetch(); void districts.refetch(); }}>Retry</button>
        </p>
      ) : null}
    </div>
  );
}

export interface ComplexScope {
  court: Court;
  stateCode: number;
  distCode: number;
  complexCode: string;
  /** First court of the complex - for calls that take one court. */
  courtCode: number;
  /** Every court in the complex, "1,2,3" - what the app searches. */
  courtCodes: string;
  estCode: string;
  complexName: string;
}

/**
 * The picked Court Complex, resolved to the court codes eCourts searches.
 * Districts whose complexes DifAi hasn't captured fall back to a typed
 * court code (kept in the same store).
 */
export function useComplexScope(): {
  scope: ComplexScope | null;
  complexes: EcourtsCourtComplex[] | undefined;
  loading: boolean;
} {
  const s = useEcourtsCourtStore((st) => st.scope);
  const complexes = useEcourtsCourtComplexes(
    s.stateCode === '' || s.court === 'HC' ? null : s.stateCode,
    s.distCode === '' ? null : s.distCode,
    s.court,
  );
  const scope = useMemo<ComplexScope | null>(() => {
    if (s.stateCode === '' || s.distCode === '') return null;
    // A High Court bench is searched as court 1 of that bench - the app has
    // no Court Complex step for High Courts (verified live: Madras HC
    // Principal Bench answers case types and searches with court 1).
    if (s.court === 'HC') {
      return {
        court: 'HC', stateCode: s.stateCode, distCode: s.distCode, complexCode: '',
        courtCode: 1, courtCodes: '1', estCode: '1', complexName: '',
      };
    }
    const picked = complexes.data?.find((c) => c.complexCode === s.complexCode);
    if (picked && picked.courtCodes.length > 0) {
      return {
        court: s.court, stateCode: s.stateCode, distCode: s.distCode, complexCode: picked.complexCode,
        courtCode: Number(picked.courtCodes[0]), courtCodes: picked.courtCodes.join(','),
        estCode: picked.courtCodes[0]!, complexName: picked.complexName,
      };
    }
    // Typed court code(s) for a district we have no complex list for.
    if (!s.complexCode && /^\d+(,\d+)*$/.test(s.courtCode) && Number(s.courtCode.split(',')[0]) > 0) {
      const first = s.courtCode.split(',')[0]!;
      return {
        court: s.court, stateCode: s.stateCode, distCode: s.distCode, complexCode: '',
        courtCode: Number(first), courtCodes: s.courtCode, estCode: first, complexName: '',
      };
    }
    return null;
  }, [s, complexes.data]);
  return { scope, complexes: complexes.data, loading: complexes.isFetching };
}

/** "Court Complex*" - the app's first field on every search screen. */
export function ComplexSelect() {
  const { t } = useEcourtsT();
  const s = useEcourtsCourtStore((st) => st.scope);
  const setScope = useEcourtsCourtStore((st) => st.setScope);
  const { complexes, loading } = useComplexScope();
  const noDistrict = s.stateCode === '' || s.distCode === '';
  const hasList = Boolean(complexes && complexes.length > 0);
  // Drop a remembered complex that isn't in this district's list.
  useEffect(() => {
    if (hasList && s.complexCode && !complexes!.some((c) => c.complexCode === s.complexCode)) {
      setScope({ ...s, complexCode: '', courtCode: '', estCode: '' });
    }
  }, [hasList, complexes, s, setScope]);
  // High Courts: the bench above is the whole scope, as in the app.
  if (s.court === 'HC') return null;
  return (
    <AppField label={t(L.courtComplex, 'Court Complex')} required>
      {noDistrict || hasList || loading ? (
        <select
          className="input"
          value={s.complexCode}
          disabled={noDistrict || loading}
          onChange={(e) => {
            const c = complexes?.find((x) => x.complexCode === e.target.value);
            setScope({ ...s, complexCode: e.target.value, courtCode: c?.courtCodes[0] ?? '', estCode: c?.courtCodes[0] ?? '' });
          }}
        >
          <option value="">
            {noDistrict ? 'Select state and district above' : loading ? 'Loading…' : t(L.selectCourtComplex, 'Select court complex')}
          </option>
          {(complexes ?? []).map((c) => <option key={c.complexCode} value={c.complexCode}>{c.complexName}</option>)}
        </select>
      ) : (
        <>
          <input
            className="input"
            inputMode="numeric"
            value={s.courtCode}
            placeholder="Court code, e.g. 6 (this district's complexes aren't listed yet)"
            onChange={(e) => {
              const v = e.target.value.replace(/[^\d,]/g, '');
              setScope({ ...s, complexCode: '', courtCode: v, estCode: v.split(',')[0] ?? '' });
            }}
          />
        </>
      )}
    </AppField>
  );
}

// ---------------------------------------------------------------------------
// Results - the app's establishment-grouped case list
// ---------------------------------------------------------------------------

export interface ResultCaseRow {
  cino?: string;
  case_no?: string;
  case_no2?: string | number;
  reg_no?: string | number;
  reg_year?: string | number;
  case_year?: string | number;
  type_name?: string;
  fil_no?: string | number;
  fil_year?: string | number;
  pet_name?: string;
  res_name?: string;
  extra_party?: string;
  date_of_decision?: string | null;
  [k: string]: unknown;
}

export interface ResultEstablishment {
  name: string;
  rows: ResultCaseRow[];
}

/** Parse the app's `{ "0": {establishment_name, caseNos}, no_of_establishments }`. */
export function parseEstablishments(data: unknown): { establishments: ResultEstablishment[]; searched: number | null } {
  const obj = data as Record<string, unknown> | null;
  const out: ResultEstablishment[] = [];
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (!/^\d+$/.test(k) || !v || typeof v !== 'object') continue;
      const e = v as { establishment_name?: string; caseNos?: unknown };
      const rows = Array.isArray(e.caseNos) ? (e.caseNos as unknown[]).flatMap((r) => (Array.isArray(r) ? r : [r])) as ResultCaseRow[] : [];
      out.push({ name: e.establishment_name ?? `Establishment ${Number(k) + 1}`, rows });
    }
  }
  const n = obj && typeof obj.no_of_establishments === 'number' ? obj.no_of_establishments : null;
  return { establishments: out, searched: n ?? (out.length || null) };
}

/** "OS/57/2018" as the app prints it (reg_no is the app's case_no2). */
export function caseNumberText(r: ResultCaseRow): string {
  const type = String(r.type_name ?? '').trim();
  const no = r.reg_no ?? r.case_no2;
  const year = r.reg_year ?? r.case_year;
  if (no !== undefined && no !== null && String(no) !== '' && String(no) !== '0') {
    return [type, String(no), year ? String(year) : ''].filter(Boolean).join('/');
  }
  if (r.fil_no) return [type, String(r.fil_no), r.fil_year ? String(r.fil_year) : ''].filter(Boolean).join('/');
  return String(r.case_no ?? r.cino ?? '—');
}

export function partyText(r: ResultCaseRow): { pet: string; res: string } {
  const clean = (s: unknown) => String(s ?? '').replace(/<br\s*\/?>/gi, ' ').replace(/\s+/g, ' ').trim();
  return { pet: clean(r.pet_name) || clean(r.extra_party), res: clean(r.res_name) };
}

/** Totals + one collapsible bar per establishment + the app's table. */
export function EstablishmentResults({ data, onOpenCase, extraHeader, stage = 'B' }: {
  data: unknown;
  onOpenCase: (cnr: string) => void;
  /** Lines the app shows above the totals (e.g. "Advocate: …"). */
  extraHeader?: ReactNode;
  /** Pending / Disposed / Both - a decided case carries date_of_decision. */
  stage?: 'P' | 'D' | 'B';
}) {
  const { t } = useEcourtsT();
  const parsed = parseEstablishments(data);
  const searched = parsed.searched;
  const establishments = stage === 'B'
    ? parsed.establishments
    : parsed.establishments.map((e) => ({ ...e, rows: e.rows.filter((r) => (stage === 'D') === Boolean(r.date_of_decision)) }));
  const total = establishments.reduce((n, e) => n + e.rows.length, 0);
  // The app opens the first establishment with cases.
  const firstWithCases = establishments.findIndex((e) => e.rows.length > 0);
  const [open, setOpen] = useState<Set<number>>(() => new Set(firstWithCases >= 0 ? [firstWithCases] : []));
  const [filter, setFilter] = useState('');
  const toggle = (i: number) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(i)) next.delete(i); else next.add(i);
    return next;
  });
  const q = filter.trim().toLowerCase();
  const match = (r: ResultCaseRow) => !q || [caseNumberText(r), r.pet_name, r.res_name, r.cino].some((v) => String(v ?? '').toLowerCase().includes(q));

  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="col" style={{ gap: 2 }}>
        {extraHeader}
        <span className="body-md">{t(L.totalEstablishments, 'Total Number of Establishments in Court Complex')}: {searched ?? establishments.length}</span>
        <span className="body-md" style={{ fontWeight: 700 }}>{t(L.totalCases, 'Total Number of Cases')}: {total}</span>
      </div>
      {total > 10 ? <TextSearchBox value={filter} onChange={setFilter} /> : null}
      {establishments.map((e, i) => (
        e.rows.length === 0 ? null : (
          <div key={i} className="col" style={{ gap: 0 }}>
            <SectionBar title={`${e.name} : ${e.rows.length}`} open={open.has(i)} onToggle={() => toggle(i)} />
            {open.has(i) ? (
              <div style={{ overflowX: 'auto' }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th style={{ width: 56 }}>{t(L.srNo, 'Sr No')}</th>
                      <th>{t(L.caseNumber, 'Case Number')}</th>
                      <th>{t(L.partyName, 'Party Name')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {e.rows.filter(match).map((r, j) => {
                      const { pet, res } = partyText(r);
                      const cnr = String(r.cino ?? '').toUpperCase();
                      const canOpen = /^[A-Z]{4}[A-Z0-9]{12}$/.test(cnr);
                      return (
                        <tr key={`${cnr}-${j}`}>
                          <td className="tabular">{j + 1}</td>
                          <td>
                            {canOpen ? (
                              <button type="button" className="link-btn" onClick={() => onOpenCase(cnr)} style={{ textDecoration: 'underline', background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'inherit', font: 'inherit', fontWeight: 600 }}>
                                {caseNumberText(r)}
                              </button>
                            ) : caseNumberText(r)}
                          </td>
                          <td>
                            {pet}
                            {res ? <><br /><span className="muted">vs</span><br />{res}</> : null}
                            {r.date_of_decision ? <div className="body-sm muted">Decided {String(r.date_of_decision).replace(/^(\d{4})-(\d{2})-(\d{2}).*$/, '$3-$2-$1')}</div> : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        )
      ))}
      {total === 0 ? <p className="body-md muted">No cases found.</p> : null}
    </div>
  );
}

/**
 * A dropdown menu rendered on <body>, anchored under its button. Inside the
 * page, the `.stagger` entrance animation gives every section its own
 * stacking context, so an in-place dropdown painted BEHIND the sections
 * below it whatever its z-index. Closes on outside click and Escape; follows
 * its button on scroll and resize.
 */
export function AnchoredMenu({ anchor, open, onClose, children, minWidth = 220 }: {
  anchor: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  minWidth?: number;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchor) return;
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const left = Math.max(8, Math.min(r.left, window.innerWidth - minWidth - 8));
      setPos({ top: r.bottom + 6, left });
    };
    place();
    // Re-position (not close) on resize: phones resize the window whenever
    // the address bar hides while scrolling.
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, anchor, minWidth]);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || anchor?.contains(t)) return;
      onClose();
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', esc); };
  }, [open, anchor, onClose]);

  if (!open || !pos) return null;
  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      className="card col"
      style={{
        position: 'fixed', top: pos.top, left: pos.left, zIndex: 1000, minWidth, padding: 6, gap: 2,
        maxHeight: `calc(100vh - ${pos.top + 12}px)`, overflowY: 'auto',
        background: 'var(--bg-elevated)', boxShadow: '0 12px 32px rgba(0,0,0,0.18)',
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

/** The app's round back arrow at the top of an inner screen. */
export function BackArrow({ onClick, label }: { onClick: () => void; label?: string }) {
  const { t } = useEcourtsT();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label ?? t(L.back, 'Back')}
      title={label ?? t(L.back, 'Back')}
      style={{
        width: 40, height: 40, borderRadius: 999, display: 'inline-grid', placeItems: 'center',
        background: 'var(--bg-inverse)', color: 'var(--text-inverse)', border: 0, cursor: 'pointer', fontSize: 18,
      }}
    >
      ←
    </button>
  );
}
