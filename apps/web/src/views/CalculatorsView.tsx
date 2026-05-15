import { useMemo, useState } from 'react';
import { Icon, Select } from '@lexdraft/ui';
import { PillNav } from '@/components/PillNav';
import { useUIStore } from '@/store/ui';
import {
  useCalculatorStates,
  useCourtFee,
  useStampDuty,
  useGenerateVakalatnama,
  type VakalatnamaCourtType,
} from '@/hooks/useCalculators';

type TabId = 'court-fee' | 'stamp-duty' | 'vakalatnama';

const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: 'court-fee',   label: 'Court fee' },
  { id: 'stamp-duty',  label: 'Stamp duty' },
  { id: 'vakalatnama', label: 'Vakalatnama' },
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

export function CalculatorsView() {
  const [tab, setTab] = useState<TabId>('court-fee');
  const { data: states = [], isLoading: statesLoading, isError: statesError } = useCalculatorStates();

  return (
    <div className="col stagger" style={{ gap: 24 }}>
      <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Tools · daily-use Indian-legal calculators</div>
          <h1 className="heading-xl">Calculators</h1>
          <div className="mono" style={{ fontSize: 11, letterSpacing: '0.16em', color: 'var(--text-tertiary)', marginTop: 4 }}>
            {states.length} {states.length === 1 ? 'STATE' : 'STATES'} · 3 TOOLS
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 14, background: 'var(--bg-surface-2)' }}>
        <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
          <Icon name="flag" size={14} className="muted" />
          <div className="body-xs muted" style={{ flex: 1, lineHeight: 1.5 }}>
            Estimates are indicative only. Court fees, stamp duty schedules and
            vakalatnama formats are amended periodically by state gazette and court
            notifications - confirm the final figure with the relevant Sub-Registrar,
            court schedule or Bar Council before filing.
          </div>
        </div>
      </div>

      <PillNav items={TABS} value={tab} onChange={setTab} ariaLabel="Calculator type" />

      {statesError && (
        <div className="card" style={{ padding: 16, color: 'var(--danger)' }}>
          Could not load state catalogue. Check your connection or try again.
        </div>
      )}

      {statesLoading && !statesError && (
        <div className="card muted" style={{ padding: 24, textAlign: 'center' }}>
          Loading state catalogue…
        </div>
      )}

      {!statesLoading && !statesError && tab === 'court-fee'   && <CourtFeePanel  states={states} />}
      {!statesLoading && !statesError && tab === 'stamp-duty'  && <StampDutyPanel states={states} />}
      {!statesLoading && !statesError && tab === 'vakalatnama' && <VakalatnamaPanel states={states} />}
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
  const showToast = useUIStore((s) => s.showToast);

  const stateOptions = useMemo(
    () => states.map((s) => ({ value: s.stateCode, label: s.stateName })),
    [states],
  );

  const { data, isFetching, isError, error } = useCourtFee({
    state: stateCode,
    value,
  });

  const errMsg = isError
    ? (error as { response?: { data?: { error?: string } } } | undefined)?.response?.data?.error ?? 'Could not calculate'
    : null;

  const handleCopy = async (): Promise<void> => {
    if (!data) return;
    const text = data.breakdown.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      showToast({ type: 'sage', text: 'Breakdown copied' });
    } catch {
      showToast({ type: 'vermillion', text: 'Could not copy' });
    }
  };

  return (
    <div className="grid-2" style={{ gap: 24, alignItems: 'flex-start' }}>
      <div className="card">
        <h2 className="heading-md" style={{ marginBottom: 18 }}>Suit particulars</h2>
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
          </div>
        </div>
      </div>

      <div className="card-cream">
        <div className="row" style={{ marginBottom: 6 }}>
          <span className="eyebrow">Court fee</span>
          <span className="spacer" />
          <span className="badge badge-cobalt">{stateCode}</span>
        </div>
        {isFetching && !data && (
          <div className="body-sm muted">Calculating…</div>
        )}
        {errMsg && (
          <div className="body-sm" style={{ color: 'var(--danger)' }}>{errMsg}</div>
        )}
        {data && !errMsg && (
          <>
            <div className="display-md tabular" style={{ marginBottom: 8 }}>
              ₹{formatINR(data.fee)}
            </div>
            <div className="body-sm muted" style={{ marginBottom: 20 }}>
              Estimated court fee on matter valued at <span className="mono tabular">₹{formatINR(value)}</span>.
            </div>
            <hr className="hairline" style={{ marginBottom: 16 }} />
            <div className="col" style={{ gap: 6 }}>
              {data.breakdown.map((line, i) => (
                <div key={i} className="mono body-xs">{line}</div>
              ))}
            </div>
            {data.notes && (
              <div className="body-xs muted" style={{ marginTop: 12, fontStyle: 'italic' }}>
                {data.notes}
              </div>
            )}
            <div className="row" style={{ gap: 8, marginTop: 24 }}>
              <button type="button" className="btn btn-sm" onClick={() => { void handleCopy(); }}>
                <Icon name="documents" size={14} /> Copy breakdown
              </button>
            </div>
          </>
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
  const value = Number(valueStr) || 0;
  const showToast = useUIStore((s) => s.showToast);

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

  const { data, isFetching, isError, error } = useStampDuty({
    state: stateCode,
    instrument: safeInstrument,
    value,
  });

  const errMsg = isError
    ? (error as { response?: { data?: { error?: string } } } | undefined)?.response?.data?.error ?? 'Could not calculate'
    : null;

  const handleCopy = async (): Promise<void> => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.breakdown.join('\n'));
      showToast({ type: 'sage', text: 'Breakdown copied' });
    } catch {
      showToast({ type: 'vermillion', text: 'Could not copy' });
    }
  };

  return (
    <div className="grid-2" style={{ gap: 24, alignItems: 'flex-start' }}>
      <div className="card">
        <h2 className="heading-md" style={{ marginBottom: 18 }}>Instrument particulars</h2>
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
              For fixed-duty instruments (e.g. affidavit), value is ignored.
            </div>
          </div>
        </div>
      </div>

      <div className="card-cream">
        <div className="row" style={{ marginBottom: 6 }}>
          <span className="eyebrow">Stamp duty</span>
          <span className="spacer" />
          <span className="badge badge-cobalt">{stateCode}</span>
        </div>
        {isFetching && !data && (
          <div className="body-sm muted">Calculating…</div>
        )}
        {errMsg && (
          <div className="body-sm" style={{ color: 'var(--danger)' }}>{errMsg}</div>
        )}
        {data && !errMsg && (
          <>
            <div className="display-md tabular" style={{ marginBottom: 8 }}>
              ₹{formatINR(data.duty)}
            </div>
            <div className="body-sm muted" style={{ marginBottom: 20 }}>
              Estimated duty for {INSTRUMENT_LABELS[safeInstrument] ?? titleCase(safeInstrument)} on{' '}
              <span className="mono tabular">₹{formatINR(value)}</span>.
            </div>
            <hr className="hairline" style={{ marginBottom: 16 }} />
            <div className="col" style={{ gap: 6 }}>
              {data.breakdown.map((line, i) => (
                <div key={i} className="mono body-xs">{line}</div>
              ))}
            </div>
            {data.notes && (
              <div className="body-xs muted" style={{ marginTop: 12, fontStyle: 'italic' }}>
                {data.notes}
              </div>
            )}
            <div className="row" style={{ gap: 8, marginTop: 24 }}>
              <button type="button" className="btn btn-sm" onClick={() => { void handleCopy(); }}>
                <Icon name="documents" size={14} /> Copy breakdown
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ vakalatnama */

function VakalatnamaPanel({ states }: { states: StateRef[] }) {
  const showToast = useUIStore((s) => s.showToast);
  const generate = useGenerateVakalatnama();

  const [stateCode, setStateCode] = useState<string>(states[0]?.stateCode ?? 'MH');
  const currentState = states.find((s) => s.stateCode === stateCode);
  const [courtType, setCourtType] = useState<VakalatnamaCourtType>(
    currentState?.courtTypes[0] ?? 'District Court',
  );
  const [party, setParty]         = useState<string>('');
  const [parent, setParent]       = useState<string>('');
  const [age, setAge]             = useState<string>('35');
  const [address, setAddress]     = useState<string>('');
  const [advocate, setAdvocate]   = useState<string>('');
  const [barNo, setBarNo]         = useState<string>('');
  const [court, setCourt]         = useState<string>('');
  const [city, setCity]           = useState<string>('');
  const [respondent, setRespondent] = useState<string>('');
  const [output, setOutput]       = useState<string>('');

  const stateOptions = useMemo(
    () => states.map((s) => ({ value: s.stateCode, label: s.stateName })),
    [states],
  );

  // Court-type options come from the templates JSON, falling back to the
  // canonical three so a state with no template still presents the choice
  // (the service will fall back to a generic template).
  const courtTypeOptions = useMemo<{ value: VakalatnamaCourtType; label: string }[]>(() => {
    const fromState = currentState?.courtTypes ?? [];
    const all: VakalatnamaCourtType[] = ['District Court', 'High Court', 'Supreme Court'];
    const set = new Set<VakalatnamaCourtType>([...fromState, ...all]);
    return Array.from(set).map((c) => ({ value: c, label: c }));
  }, [currentState]);

  const canSubmit =
    party.trim() && parent.trim() && address.trim() &&
    advocate.trim() && barNo.trim() && court.trim() && city.trim() &&
    Number(age) > 0;

  const handleGenerate = async (): Promise<void> => {
    if (!canSubmit) {
      showToast({ type: 'vermillion', text: 'Fill all required fields' });
      return;
    }
    try {
      const result = await generate.mutateAsync({
        stateCode,
        courtType,
        party: party.trim(),
        parent: parent.trim(),
        age: Number(age),
        address: address.trim(),
        advocate: advocate.trim(),
        barNo: barNo.trim(),
        court: court.trim(),
        city: city.trim(),
        respondent: respondent.trim() || undefined,
      });
      setOutput(result.text);
      showToast({ type: 'sage', text: 'Vakalatnama generated' });
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } } | undefined)
        ?.response?.data?.error ?? 'Could not generate';
      showToast({ type: 'vermillion', text: msg });
    }
  };

  const handleCopy = async (): Promise<void> => {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output);
      showToast({ type: 'sage', text: 'Vakalatnama copied' });
    } catch {
      showToast({ type: 'vermillion', text: 'Could not copy' });
    }
  };

  return (
    <div className="grid-2" style={{ gap: 24, alignItems: 'flex-start' }}>
      <div className="card">
        <h2 className="heading-md" style={{ marginBottom: 18 }}>Party & court</h2>
        <div className="col" style={{ gap: 14 }}>
          <div className="grid-2" style={{ gap: 12 }}>
            <div>
              <label className="label" htmlFor="vk-state">State</label>
              <Select
                id="vk-state"
                value={stateCode}
                onChange={(v) => setStateCode(v)}
                options={stateOptions}
              />
            </div>
            <div>
              <label className="label" htmlFor="vk-court-type">Court type</label>
              <Select
                id="vk-court-type"
                value={courtType}
                onChange={(v) => setCourtType(v as VakalatnamaCourtType)}
                options={courtTypeOptions}
              />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="vk-court">Court name</label>
            <input
              id="vk-court"
              className="input"
              placeholder="e.g. Civil Judge Senior Division"
              value={court}
              onChange={(e) => setCourt(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="vk-city">City / station</label>
            <input
              id="vk-city"
              className="input"
              placeholder="e.g. Pune"
              value={city}
              onChange={(e) => setCity(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="vk-party">Party (your client)</label>
            <input
              id="vk-party"
              className="input"
              value={party}
              onChange={(e) => setParty(e.target.value)}
            />
          </div>
          <div className="grid-2" style={{ gap: 12 }}>
            <div>
              <label className="label" htmlFor="vk-parent">Parent / spouse name</label>
              <input
                id="vk-parent"
                className="input"
                value={parent}
                onChange={(e) => setParent(e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="vk-age">Age</label>
              <input
                id="vk-age"
                className="input tabular"
                type="number"
                min="1"
                max="130"
                value={age}
                onChange={(e) => setAge(e.target.value)}
                style={{ fontFamily: 'var(--font-mono)' }}
              />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="vk-address">Address</label>
            <textarea
              id="vk-address"
              className="input"
              rows={2}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="vk-respondent">Opposing party (optional)</label>
            <input
              id="vk-respondent"
              className="input"
              placeholder="Leave blank to insert a fillable underline"
              value={respondent}
              onChange={(e) => setRespondent(e.target.value)}
            />
          </div>
          <hr className="hairline" />
          <div>
            <label className="label" htmlFor="vk-adv">Advocate name</label>
            <input
              id="vk-adv"
              className="input"
              value={advocate}
              onChange={(e) => setAdvocate(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="vk-bar">Bar Council registration no.</label>
            <input
              id="vk-bar"
              className="input"
              value={barNo}
              onChange={(e) => setBarNo(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => { void handleGenerate(); }}
            disabled={!canSubmit || generate.isPending}
          >
            <Icon name="documents" size={14} />
            {generate.isPending ? 'Generating…' : 'Generate vakalatnama'}
          </button>
        </div>
      </div>

      <div className="card-cream">
        <div className="row" style={{ marginBottom: 6 }}>
          <span className="eyebrow">Vakalatnama draft</span>
          <span className="spacer" />
          <span className="badge badge-cobalt">{stateCode} · {courtType}</span>
        </div>
        {!output ? (
          <div className="body-sm muted" style={{ paddingTop: 12 }}>
            Fill the party and advocate details on the left and press
            <em> Generate </em> to draft the vakalatnama. Templates fall back to
            a generic Form-X-style draft if no state-specific variant is shipped.
          </div>
        ) : (
          <>
            <pre
              className="mono body-xs"
              style={{
                whiteSpace: 'pre-wrap',
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                padding: 14,
                maxHeight: 520,
                overflow: 'auto',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {output}
            </pre>
            <div className="row" style={{ gap: 8, marginTop: 16 }}>
              <button type="button" className="btn btn-sm" onClick={() => { void handleCopy(); }}>
                <Icon name="documents" size={14} /> Copy
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setOutput('')}
              >
                <Icon name="close" size={12} /> Clear
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
