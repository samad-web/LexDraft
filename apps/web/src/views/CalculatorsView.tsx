import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Icon, Select, EmptyState, ErrorState, Skeleton } from '@lexdraft/ui';
import { PillNav } from '@/components/PillNav';
import { PageHeader } from '@/components/PageHeader';
import { useUIStore } from '@/store/ui';
import { INDIA_STATES_BY_CODE } from '@/lib/india-states';
import { exportPdf, escapeReportHtml } from '@/lib/export-doc';
import { resolveLetterhead } from '@/lib/letterhead-resolve';
import { LetterheadPicker } from '@/components/letterhead/LetterheadPicker';
import {
  useCalculatorStates,
  useCourtFee,
  useStampDuty,
  type VakalatnamaCourtType,
  type VerificationStatus,
} from '@/hooks/useCalculators';

type TabId = 'court-fee' | 'stamp-duty';

const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: 'court-fee',   label: 'Court fee' },
  { id: 'stamp-duty',  label: 'Stamp duty' },
];

// Human labels for the camelCase instrument keys in state-fees.json. Anything
// not listed here falls back to a title-cased version of the key so a new
// instrument added to the data file shows up without a UI change.
const INSTRUMENT_LABELS: Record<string, string> = {
  saleDeed:        'Sale Deed',
  lease:           'Lease',
  powerOfAttorney: 'Power of Attorney',
  affidavit:       'Affidavit',
  mortgage:        'Mortgage',
  gift:            'Gift',
};

function titleCase(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

function formatINR(value: number): string {
  return value.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

/** Advocate sign-off badge. Unverified is the default/expected state for
 *  almost every row today - this is deliberately not styled as an error,
 *  just a clear "confirm before filing" signal. */
function VerificationBadge({ verification }: { verification: { verified: boolean; reviewedBy: string; reviewedOn: string; source: string } }) {
  if (verification.verified) {
    return (
      <div className="row" style={{ gap: 6, alignItems: 'center' }}>
        <Icon name="check" size={13} />
        <span className="body-xs" style={{ fontWeight: 600 }}>
          Verified by {verification.reviewedBy} · {verification.reviewedOn}
        </span>
      </div>
    );
  }
  return (
    <div className="row" style={{ gap: 6, alignItems: 'flex-start', flex: '1 1 260px', minWidth: 0 }}>
      <Icon name="flag" size={13} className="muted" style={{ marginTop: 2, flexShrink: 0 }} />
      <span className="body-xs muted" style={{ lineHeight: 1.5 }}>
        Indicative estimate - schedules change by gazette notification. Confirm with {verification.source || 'the court schedule'} before filing.
      </span>
    </div>
  );
}

/* ------------------------------------------------- editable calculation */

/** One line of a manually adjusted calculation. A percent line applies `rate`
 *  to `basis` (blank basis = the matter value, so it follows the input); a
 *  fixed line is a flat amount (fixed duty, process fee, surcharge…). */
interface CalcLine {
  id: string;
  label: string;
  mode: 'percent' | 'fixed';
  rate: string;
  basis: string;
  amount: string;
  /** True when "Other" was picked and the label is typed by hand. */
  custom: boolean;
}

// Line descriptions are picked from a fixed list; "Other" unlocks free text.
const OTHER_LABEL = '__other__';
const COURT_FEE_LINE_LABELS = [
  'Ad-valorem fee',
  'Fixed court fee',
  'Process fee',
  'Copying / folio charges',
  'Additional court fee',
] as const;
const STAMP_DUTY_LINE_LABELS = [
  'Ad-valorem duty',
  'Fixed duty',
  'Registration fee',
  'Surcharge',
  'Metro / local body cess',
] as const;

let lineSeq = 0;
function newLine(partial: Partial<CalcLine> = {}): CalcLine {
  lineSeq += 1;
  return { id: `l${lineSeq}`, label: '', mode: 'percent', rate: '', basis: '', amount: '', custom: false, ...partial };
}

function lineAmount(line: CalcLine, value: number): number {
  if (line.mode === 'fixed') return Number(line.amount) || 0;
  const basis = line.basis.trim() === '' ? value : Number(line.basis) || 0;
  return (basis * (Number(line.rate) || 0)) / 100;
}

/** An extra percent line seeded alongside the schedule figure (e.g. the
 *  state registration fee next to stamp duty). */
interface SeedExtra { label: string; rate: number }

/** Seed the editor from the server estimate: a single line at the effective
 *  rate when the schedule is ad-valorem, else a flat amount - plus extras. */
function seedLines(label: string, estimate: number, value: number, breakdown: string[], extras: SeedExtra[] = []): CalcLine[] {
  const adValorem = value > 0 && estimate > 0 && breakdown.some((l) => l.includes('%'));
  const main = adValorem
    ? newLine({ label, mode: 'percent', rate: String(Number(((estimate / value) * 100).toFixed(4))) })
    : newLine({ label, mode: 'fixed', amount: String(estimate) });
  return [main, ...extras.map((x) => newLine({ label: x.label, mode: 'percent', rate: String(x.rate) }))];
}

/** Each line as name / working / amount - shared by the copied text and the PDF. */
function lineRows(lines: CalcLine[], value: number): Array<{ name: string; working: string; amount: number }> {
  return lines.map((l) => {
    const name = l.label.trim() || (l.mode === 'fixed' ? 'Fixed amount' : 'Ad-valorem');
    const amount = Math.round(lineAmount(l, value));
    if (l.mode === 'fixed') return { name, working: 'Fixed', amount };
    const basis = l.basis.trim() === '' ? value : Number(l.basis) || 0;
    return { name, working: `${Number(l.rate) || 0}% of INR ${formatINR(basis)}`, amount };
  });
}

function linesBreakdown(lines: CalcLine[], value: number, total: number, totalLabel: string, edited: boolean): string[] {
  const out = lineRows(lines, value).map((r) =>
    r.working === 'Fixed' ? `${r.name}: INR ${formatINR(r.amount)}` : `${r.name}: ${r.working} = INR ${formatINR(r.amount)}`,
  );
  out.push(`${totalLabel}: INR ${formatINR(total)}${edited ? ' (manually adjusted)' : ''}`);
  return out;
}

/** Everything the PDF needs beyond the lines: a title and the particulars table. */
interface PdfInfo { title: string; particulars: Array<[string, string]> }

const NO_EXTRAS: SeedExtra[] = [];

const REGISTRABLE_INSTRUMENTS = new Set(['saleDeed', 'lease', 'mortgage', 'gift']);

const calcBoxStyle: CSSProperties = {
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--bg-surface)',
  overflow: 'hidden',
};

const segmentStyle: CSSProperties = {
  gap: 2,
  padding: 2,
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
};

function segmentButtonStyle(active: boolean): CSSProperties {
  return {
    width: 32,
    height: 28,
    border: 0,
    borderRadius: 'calc(var(--radius-md) - 2px)',
    background: active ? 'var(--text-primary)' : 'transparent',
    color: active ? 'var(--bg-surface)' : 'var(--text-secondary)',
    fontWeight: 600,
    cursor: 'pointer',
  };
}

/** The calculation sheet shared by the court-fee and stamp-duty cards. It is
 *  always editable: lines are seeded from the bundled schedule and re-seeded
 *  whenever the schedule figure changes, until the advocate edits a line -
 *  from then on their figures stand until "Reset to schedule". */
function CalcSheet({
  kindLabel,
  labelOptions,
  totalLabel,
  estimate,
  value,
  breakdown,
  notes,
  verification,
  extras = NO_EXTRAS,
  pdf,
}: {
  kindLabel: string;
  labelOptions: readonly string[];
  totalLabel: string;
  estimate: number;
  value: number;
  breakdown: string[];
  notes: string;
  verification: VerificationStatus;
  extras?: SeedExtra[];
  pdf: PdfInfo;
}) {
  const showToast = useUIStore((s) => s.showToast);
  const seed = (): CalcLine[] => seedLines(kindLabel, estimate, value, breakdown, extras);
  const [lines, setLines] = useState<CalcLine[]>(seed);
  const [edited, setEdited] = useState(false);
  const [exporting, setExporting] = useState(false);
  // undefined = the user's default letterhead, null = none, string = a specific one.
  const [letterheadChoice, setLetterheadChoice] = useState<string | null | undefined>(undefined);

  // Follow the schedule while untouched. Percent lines with a blank basis
  // already track the matter value, so an edited sheet needs no re-seed.
  const scheduleKey = `${kindLabel}|${estimate}|${value}|${breakdown.join('\n')}|${JSON.stringify(extras)}`;
  useEffect(() => {
    if (!edited) setLines(seed());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleKey, edited]);

  const total = Math.round(lines.reduce((sum, l) => sum + lineAmount(l, value), 0));
  // Untouched and nothing added: the schedule's own slab working is the
  // most useful text. Otherwise describe the lines actually on screen.
  const shownBreakdown = edited || extras.length > 0
    ? linesBreakdown(lines, value, total, totalLabel, edited)
    : breakdown;

  const handleExportPdf = async (): Promise<void> => {
    if (exporting) return;
    setExporting(true);
    try {
      const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
      const particulars = pdf.particulars
        .map(([k, v]) => `<tr><th>${escapeReportHtml(k)}</th><td>${escapeReportHtml(v)}</td></tr>`)
        .join('');
      const rows = lineRows(lines, value)
        .map((r) => `<tr><td>${escapeReportHtml(r.name)}</td><td>${escapeReportHtml(r.working.replace(/INR /g, '₹'))}</td><td class="num">${formatINR(r.amount)}</td></tr>`)
        .join('');
      const bodyHtml = `
        <table><tbody>${particulars}</tbody></table>
        <h2>Computation</h2>
        <table>
          <thead><tr><th>Component</th><th>Rate</th><th class="num">Amount (₹)</th></tr></thead>
          <tbody>
            ${rows}
            <tr><th>${escapeReportHtml(totalLabel)}</th><th></th><th class="num">${formatINR(total)}</th></tr>
          </tbody>
        </table>
        <p style="margin-top:24px;font-size:11pt;color:#444;">
          Generated by DifAi on ${escapeReportHtml(today)}.
          ${edited ? 'Figures adjusted by the advocate from the bundled schedule.' : `Computed against the bundled schedule (${escapeReportHtml(verification.source || 'state schedule')}).`}
          Rates are amended by gazette notification - verify the latest schedule before tendering payment.
        </p>
      `;
      const letterhead =
        letterheadChoice === undefined ? undefined
        : letterheadChoice === null   ? null
        : await resolveLetterhead(letterheadChoice);
      await exportPdf({ title: pdf.title, bodyHtml, dated: today, disclaimerHtml: null, letterhead });
      showToast({ type: 'sage', text: 'PDF downloaded' });
    } catch (err) {
      showToast({ type: 'vermillion', text: err instanceof Error ? err.message : 'Could not export PDF' });
    } finally {
      setExporting(false);
    }
  };

  const labelSelectOptions = useMemo(
    () => [
      ...Array.from(new Set([kindLabel, ...labelOptions])).map((o) => ({ value: o, label: o })),
      { value: OTHER_LABEL, label: 'Other' },
    ],
    [kindLabel, labelOptions],
  );

  const editLines = (fn: (ls: CalcLine[]) => CalcLine[]): void => {
    setEdited(true);
    setLines(fn);
  };
  const update = (id: string, patch: Partial<CalcLine>): void =>
    editLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(shownBreakdown.join('\n'));
      showToast({ type: 'sage', text: 'Breakdown copied' });
    } catch {
      showToast({ type: 'vermillion', text: 'Could not copy' });
    }
  };

  return (
    <div className="col" style={{ gap: 12 }}>
      <div style={calcBoxStyle}>
        <div className="row" style={{ alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border-subtle)', minHeight: 48 }}>
          <span className="eyebrow">Calculation</span>
          {edited && <span className="badge">Edited</span>}
          <span className="spacer" />
          {edited && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => { setEdited(false); setLines(seed()); }}
            >
              <Icon name="close" size={12} /> Reset to schedule
            </button>
          )}
        </div>

        {lines.map((l) => (
          <div key={l.id} className="col" style={{ gap: 10, padding: 14, borderBottom: '1px solid var(--border-subtle)' }}>
            <div className="row" style={{ gap: 8, alignItems: 'center' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Select
                  value={l.custom ? OTHER_LABEL : l.label}
                  onChange={(v) =>
                    update(l.id, v === OTHER_LABEL ? { custom: true, label: '' } : { custom: false, label: v })
                  }
                  options={labelSelectOptions}
                />
              </div>
              <div className="row" role="group" aria-label="Line type" style={segmentStyle}>
                {(['percent', 'fixed'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={l.mode === m}
                    title={m === 'percent' ? 'Percentage of an amount' : 'Fixed amount'}
                    onClick={() => update(l.id, { mode: m })}
                    style={segmentButtonStyle(l.mode === m)}
                  >
                    {m === 'percent' ? '%' : '₹'}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                aria-label="Remove line"
                title="Remove line"
                onClick={() => editLines((ls) => ls.filter((x) => x.id !== l.id))}
              >
                <Icon name="trash" size={13} />
              </button>
            </div>
            {l.custom && (
              <input
                className="input"
                placeholder="Describe this line"
                aria-label="Line description"
                value={l.label}
                onChange={(e) => update(l.id, { label: e.target.value })}
                autoFocus
              />
            )}
            <div className="row" style={{ gap: 8, alignItems: 'center' }}>
              {l.mode === 'percent' ? (
                <>
                  <input
                    className="input tabular"
                    type="number"
                    inputMode="decimal"
                    step="any"
                    min="0"
                    aria-label="Rate (%)"
                    placeholder="Rate"
                    value={l.rate}
                    onChange={(e) => update(l.id, { rate: e.target.value })}
                    style={{ width: 90, fontFamily: 'var(--font-mono)' }}
                  />
                  <span className="body-xs muted" style={{ whiteSpace: 'nowrap' }}>% of ₹</span>
                  <input
                    className="input tabular"
                    type="number"
                    inputMode="numeric"
                    min="0"
                    aria-label="Basis amount (INR)"
                    placeholder={formatINR(value)}
                    value={l.basis}
                    onChange={(e) => update(l.id, { basis: e.target.value })}
                    style={{ flex: 1, minWidth: 0, fontFamily: 'var(--font-mono)' }}
                  />
                </>
              ) : (
                <>
                  <span className="body-xs muted">₹</span>
                  <input
                    className="input tabular"
                    type="number"
                    inputMode="numeric"
                    step="any"
                    min="0"
                    aria-label="Amount (INR)"
                    placeholder="Amount"
                    value={l.amount}
                    onChange={(e) => update(l.id, { amount: e.target.value })}
                    style={{ flex: 1, minWidth: 0, fontFamily: 'var(--font-mono)' }}
                  />
                </>
              )}
              <span className="mono body-sm tabular" style={{ minWidth: 96, textAlign: 'right', fontWeight: 600 }}>
                ₹{formatINR(Math.round(lineAmount(l, value)))}
              </span>
            </div>
          </div>
        ))}

        <div className="row" style={{ alignItems: 'center', gap: 12, padding: '6px 8px', borderBottom: '1px solid var(--border-subtle)' }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => editLines((ls) => [...ls, newLine({ label: labelOptions[0] ?? kindLabel })])}
          >
            <Icon name="plus" size={13} /> Add line
          </button>
          <span className="spacer" />
          <span className="body-xs muted" style={{ paddingRight: 6, textAlign: 'right' }}>
            Blank ₹ = matter value
          </span>
        </div>

        <div className="row" style={{ alignItems: 'center', gap: 12, padding: '16px 14px', background: 'var(--bg-surface-2)' }}>
          <div className="col" style={{ gap: 2 }}>
            <span className="body-sm" style={{ fontWeight: 600 }}>{totalLabel}</span>
            {edited && total !== estimate && (
              <span className="body-xs muted">
                Schedule figure <span className="mono tabular">₹{formatINR(estimate)}</span>
              </span>
            )}
          </div>
          <span className="spacer" />
          <span className="display-md tabular">₹{formatINR(total)}</span>
        </div>
      </div>

      <div className="row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <VerificationBadge verification={verification} />
      </div>

      <div className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          <LetterheadPicker value={letterheadChoice} onChange={setLetterheadChoice} />
        </div>
        <button type="button" className="btn btn-sm" onClick={() => { void handleCopy(); }}>
          <Icon name="documents" size={14} /> Copy
        </button>
        <button type="button" className="btn btn-sm btn-primary" onClick={() => { void handleExportPdf(); }} disabled={exporting}>
          <Icon name="download" size={14} /> {exporting ? 'Generating…' : 'Download PDF'}
        </button>
      </div>

      <details>
        <summary className="body-xs" style={{ cursor: 'pointer', fontWeight: 600 }}>Schedule working</summary>
        <div className="col" style={{ gap: 6, marginTop: 10 }}>
          {breakdown.map((line, i) => (
            <div key={i} className="mono body-xs">{line}</div>
          ))}
          {notes && (
            <div className="body-xs muted" style={{ marginTop: 6, fontStyle: 'italic' }}>{notes}</div>
          )}
        </div>
      </details>
    </div>
  );
}

export function CalculatorsView() {
  // ?tab=stamp-duty / ?tab=court-fee lets other screens (eFiling) link here.
  const [tab, setTab] = useState<TabId>(() => {
    const q = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('tab') : null;
    return TABS.some((t) => t.id === q) ? (q as TabId) : 'court-fee';
  });
  const { data: states = [], isLoading: statesLoading, isError: statesError } = useCalculatorStates();

  return (
    <div className="col stagger" style={{ gap: 24 }}>
      <PageHeader
        title="Court Fee & Stamp Duty"
        description={`Estimate court fees and stamp duty across ${states.length || 36} states, then adjust the calculation to match the actual schedule.`}
      />

      {statesError && (
        <ErrorState
          title="Couldn't load state catalogue"
          description="The court-fee and stamp-duty data couldn't be fetched. Reload to retry."
        />
      )}

      {statesLoading && !statesError && (
        <div className="card" style={{ padding: 24 }}>
          <div className="col" style={{ gap: 10 }}>
            <Skeleton width={180} height={14} />
            <Skeleton width="100%" height={48} />
            <Skeleton width="100%" height={48} />
          </div>
        </div>
      )}

      {!statesLoading && !statesError && states.length === 0 && (
        <EmptyState
          icon="flag"
          title="No state catalogue available"
          description="The calculators ship with a bundled state catalogue. If you're seeing this, the asset failed to load, so try reloading."
        />
      )}

      {!statesLoading && !statesError && states.length > 0 && (
        <div className="card">
          <div className="row" style={{ alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
            <PillNav items={TABS} value={tab} onChange={setTab} ariaLabel="Calculator type" />
          </div>
          {tab === 'court-fee'  && <CourtFeePanel  states={states} />}
          {tab === 'stamp-duty' && <StampDutyPanel states={states} />}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- court fee */

interface StateRef {
  stateCode: string;
  stateName: string;
  courtTypes: VakalatnamaCourtType[];
  instruments: string[];
}

function CourtFeePanel({ states }: { states: StateRef[] }) {
  const [stateCode, setStateCode] = useState<string>(states[0]?.stateCode ?? 'MH');
  const [valueStr, setValueStr] = useState<string>('500000');
  const value = Number(valueStr) || 0;

  const stateOptions = useMemo(
    () => states.map((s) => ({ value: s.stateCode, label: s.stateName })),
    [states],
  );

  const stateName = states.find((s) => s.stateCode === stateCode)?.stateName ?? stateCode;

  const { data, isFetching, isError, error } = useCourtFee({
    state: stateCode,
    value,
  });

  const errMsg = isError
    ? (error as { response?: { data?: { error?: string } } } | undefined)?.response?.data?.error ?? 'Could not calculate'
    : null;

  return (
    <div className="calc-layout">
      <div className="col" style={{ gap: 16 }}>
        <div>
          <label className="label" htmlFor="cf-state">State</label>
          <Select
            id="cf-state"
            value={stateCode}
            onChange={(v) => setStateCode(v)}
            options={stateOptions}
          />
        </div>
        <div>
          <label className="label" htmlFor="cf-value">Matter value (INR)</label>
          <input
            id="cf-value"
            className="input tabular"
            type="number"
            inputMode="numeric"
            min="0"
            value={valueStr}
            onChange={(e) => setValueStr(e.target.value)}
            style={{ fontFamily: 'var(--font-mono)' }}
          />
          <div className="body-xs" style={{ marginTop: 6 }}>
            Plaint valuation per Order VII, CPC.
          </div>
          {valueStr.trim() === '' && (
            <div className="body-xs" style={{ marginTop: 2, color: 'var(--warning)' }}>
              Empty: calculating against ₹0.
            </div>
          )}
        </div>
      </div>

      <div style={{ minWidth: 0 }}>
      {isFetching && !data && (
        <div className="body-sm muted">Calculating…</div>
      )}
      {errMsg && (
        <div className="body-sm" style={{ color: 'var(--danger)' }}>{errMsg}</div>
      )}
      {data && !errMsg && (
        <CalcSheet
          key={stateCode}
          kindLabel="Court fee"
          labelOptions={COURT_FEE_LINE_LABELS}
          totalLabel="Court fee payable"
          estimate={data.fee}
          value={value}
          breakdown={data.breakdown}
          notes={data.notes}
          verification={data.verification}
          pdf={{
            title: `Court fee estimate - ${stateName}`,
            particulars: [
              ['State / UT', stateName],
              ['Matter value (plaint valuation)', `₹${formatINR(value)}`],
            ],
          }}
        />
      )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ stamp duty */

function StampDutyPanel({ states }: { states: StateRef[] }) {
  const [stateCode, setStateCode] = useState<string>(states[0]?.stateCode ?? 'MH');
  const currentState = states.find((s) => s.stateCode === stateCode);
  const [instrument, setInstrument] = useState<string>(currentState?.instruments[0] ?? 'saleDeed');
  const [valueStr, setValueStr] = useState<string>('2500000');
  const [marketStr, setMarketStr] = useState<string>('');
  const consideration = Number(valueStr) || 0;
  const market = Number(marketStr) || 0;
  // Duty is charged on the higher of consideration and market value.
  const value = Math.max(consideration, market);

  // When the user switches state, snap the instrument to a value that exists
  // in that state's catalogue. Without this, the dropdown will display a
  // stale instrument and the API will 400.
  const safeInstrument = useMemo(() => {
    if (currentState?.instruments.includes(instrument)) return instrument;
    return currentState?.instruments[0] ?? instrument;
  }, [currentState, instrument]);

  const stateOptions = useMemo(
    () => states.map((s) => ({ value: s.stateCode, label: s.stateName })),
    [states],
  );
  const instrumentOptions = useMemo(
    () =>
      (currentState?.instruments ?? []).map((k) => ({
        value: k,
        label: INSTRUMENT_LABELS[k] ?? titleCase(k),
      })),
    [currentState],
  );

  const stateName = currentState?.stateName ?? stateCode;
  const instrumentLabel = INSTRUMENT_LABELS[safeInstrument] ?? titleCase(safeInstrument);

  // Conveyances are registered, so seed the state's registration fee as a
  // second line - the full cost at the Sub-Registrar in one figure.
  const registrationPct = REGISTRABLE_INSTRUMENTS.has(safeInstrument)
    ? INDIA_STATES_BY_CODE[stateCode]?.registrationPct ?? 0
    : 0;
  const registrationExtras = useMemo<SeedExtra[]>(
    () => (registrationPct > 0 ? [{ label: 'Registration fee', rate: registrationPct }] : []),
    [registrationPct],
  );

  const { data, isFetching, isError, error } = useStampDuty({
    state: stateCode,
    instrument: safeInstrument,
    value,
  });

  const errMsg = isError
    ? (error as { response?: { data?: { error?: string } } } | undefined)?.response?.data?.error ?? 'Could not calculate'
    : null;

  return (
    <div className="calc-layout">
      <div className="col" style={{ gap: 16 }}>
        <div>
          <label className="label" htmlFor="sd-state">State</label>
          <Select
            id="sd-state"
            value={stateCode}
            onChange={(v) => setStateCode(v)}
            options={stateOptions}
          />
        </div>
        <div>
          <label className="label" htmlFor="sd-inst">Instrument</label>
          <Select
            id="sd-inst"
            value={safeInstrument}
            onChange={(v) => setInstrument(v)}
            options={instrumentOptions}
          />
        </div>
        <div>
          <label className="label" htmlFor="sd-value">Consideration / value (INR)</label>
          <input
            id="sd-value"
            className="input tabular"
            type="number"
            inputMode="numeric"
            min="0"
            value={valueStr}
            onChange={(e) => setValueStr(e.target.value)}
            style={{ fontFamily: 'var(--font-mono)' }}
          />
          <div className="body-xs" style={{ marginTop: 6 }}>
            Ignored for fixed-duty instruments (e.g. affidavit).
          </div>
          {valueStr.trim() === '' && (
            <div className="body-xs" style={{ marginTop: 2, color: 'var(--warning)' }}>
              Empty: calculating against ₹0.
            </div>
          )}
        </div>
        <div>
          <label className="label" htmlFor="sd-market">Market value (INR, optional)</label>
          <input
            id="sd-market"
            className="input tabular"
            type="number"
            inputMode="numeric"
            min="0"
            placeholder="Ready reckoner / circle rate value"
            value={marketStr}
            onChange={(e) => setMarketStr(e.target.value)}
            style={{ fontFamily: 'var(--font-mono)' }}
          />
          <div className="body-xs" style={{ marginTop: 6 }}>
            {market > consideration
              ? <>Duty on market value <span className="mono tabular">₹{formatINR(value)}</span> (higher of the two).</>
              : 'Duty is charged on the higher of consideration and market value.'}
          </div>
        </div>
      </div>

      <div style={{ minWidth: 0 }}>
      {isFetching && !data && (
        <div className="body-sm muted">Calculating…</div>
      )}
      {errMsg && (
        <div className="body-sm" style={{ color: 'var(--danger)' }}>{errMsg}</div>
      )}
      {data && !errMsg && (
        <CalcSheet
          key={`${stateCode}:${safeInstrument}`}
          kindLabel="Stamp duty"
          labelOptions={STAMP_DUTY_LINE_LABELS}
          totalLabel={registrationExtras.length > 0 ? 'Total payable' : 'Stamp duty payable'}
          estimate={data.duty}
          value={value}
          breakdown={data.breakdown}
          notes={data.notes}
          verification={data.verification}
          extras={registrationExtras}
          pdf={{
            title: `Stamp duty estimate - ${stateName} ${instrumentLabel}`,
            particulars: [
              ['State / UT', stateName],
              ['Instrument', instrumentLabel],
              ['Consideration value', `₹${formatINR(consideration)}`],
              ...(market > 0 ? [['Market value', `₹${formatINR(market)}`] as [string, string]] : []),
              ['Dutiable value', `₹${formatINR(value)}${market > 0 ? ' (higher of the two)' : ''}`],
            ],
          }}
        />
      )}
      </div>
    </div>
  );
}
