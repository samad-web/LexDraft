import { useMemo, useState } from 'react';
import { Icon, Select } from '@lexdraft/ui';
import { useUIStore } from '@/store/ui';
import { SearchableSelect } from '@/components/SearchableSelect';
import { INDIA_STATES, INDIA_STATES_BY_CODE } from '@/lib/india-states';

type InstrumentKey = 'sale' | 'lease' | 'mortgage' | 'gift';

interface InstrumentInfo { code: InstrumentKey; name: string }

const INSTRUMENTS: InstrumentInfo[] = [
  { code: 'sale',     name: 'Sale Deed' },
  { code: 'lease',    name: 'Lease' },
  { code: 'mortgage', name: 'Mortgage' },
  { code: 'gift',     name: 'Gift' },
];

const STATE_OPTIONS = INDIA_STATES.map((s) => ({
  value: s.code,
  label: s.name,
  hint: s.type === 'ut' ? 'UT' : undefined,
}));

function formatINR(value: number): string {
  return value.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

export function StampView() {
  const [stateCode, setStateCode]           = useState<string>('MH');
  const [instrument, setInstrument]         = useState<InstrumentKey>('sale');
  const [consideration, setConsideration]   = useState<string>('5000000');
  const [propertyValue, setPropertyValue]   = useState<string>('5500000');
  const showToast = useUIStore((s) => s.showToast);

  const calc = useMemo(() => {
    const c = Number(consideration) || 0;
    const p = Number(propertyValue) || 0;
    const dutiableValue = Math.max(c, p);
    const info = INDIA_STATES_BY_CODE[stateCode];
    const stampPct = info?.stampPct[instrument] ?? 0;
    const regPct = info?.registrationPct ?? 0;
    const stampDuty       = Math.round(dutiableValue * (stampPct / 100));
    const registrationFee = Math.round(dutiableValue * (regPct / 100));
    return {
      dutiableValue,
      stampDuty,
      registrationFee,
      total: stampDuty + registrationFee,
      stampPct,
      regPct,
    };
  }, [stateCode, instrument, consideration, propertyValue]);

  const stateName      = INDIA_STATES_BY_CODE[stateCode]?.name           ?? '';
  const instrumentName = INSTRUMENTS.find((i) => i.code === instrument)?.name ?? '';

  const handleSaveCalculation = (): void => {
    const breakdown =
      `LexDraft stamp duty estimate\n` +
      `State: ${stateName}\n` +
      `Instrument: ${instrumentName}\n` +
      `Dutiable value: INR ${formatINR(calc.dutiableValue)}\n` +
      `Stamp duty (${calc.stampPct.toFixed(1)}%): INR ${formatINR(calc.stampDuty)}\n` +
      `Registration fee (${calc.regPct.toFixed(1)}%): INR ${formatINR(calc.registrationFee)}\n` +
      `Total payable: INR ${formatINR(calc.total)}`;
    void navigator.clipboard.writeText(breakdown);
    showToast({ type: 'sage', text: 'Calculation saved to clipboard' });
  };

  return (
    <div className="col stagger" style={{ gap: 24 }}>
      <div>
        <div className="eyebrow" style={{ marginBottom: 8 }}>§ — STAMP & REGISTRATION</div>
        <h1 className="heading-xl">Stamp duty calculator</h1>
        <p className="body-md muted" style={{ marginTop: 8, maxWidth: 640 }}>
          Indicative rates per the latest state schedules. Final liability is determined by the Sub-Registrar at the time of registration.
        </p>
      </div>

      <div className="grid-2" style={{ gap: 24, alignItems: 'flex-start' }}>
        <div className="card">
          <h2 className="heading-md" style={{ marginBottom: 18 }}>Instrument particulars</h2>
          <div className="col" style={{ gap: 16 }}>
            <div>
              <label className="label" htmlFor="state-select">State / UT</label>
              <SearchableSelect
                id="state-select"
                value={stateCode}
                onChange={(v) => setStateCode(v)}
                options={STATE_OPTIONS}
                placeholder="Search state or UT…"
              />
            </div>
            <div>
              <label className="label" htmlFor="inst-select">Instrument type</label>
              <Select
                id="inst-select"
                value={instrument}
                onChange={(v) => setInstrument(v as InstrumentKey)}
                options={INSTRUMENTS.map((i) => ({ value: i.code, label: i.name }))}
              />
            </div>
            <div>
              <label className="label" htmlFor="cons-input">Consideration value (₹)</label>
              <input
                id="cons-input"
                className="input tabular"
                type="number"
                inputMode="numeric"
                min="0"
                value={consideration}
                onChange={(e) => setConsideration(e.target.value)}
                style={{ fontFamily: 'var(--font-mono)' }}
              />
            </div>
            <div>
              <label className="label" htmlFor="pval-input">Market / property value (₹)</label>
              <input
                id="pval-input"
                className="input tabular"
                type="number"
                inputMode="numeric"
                min="0"
                value={propertyValue}
                onChange={(e) => setPropertyValue(e.target.value)}
                style={{ fontFamily: 'var(--font-mono)' }}
              />
              <div className="body-xs" style={{ marginTop: 6 }}>Higher of consideration & market value is dutiable.</div>
            </div>
          </div>
        </div>

        <div className="card-cream">
          <div className="row" style={{ marginBottom: 6 }}>
            <span className="eyebrow">Estimate</span>
            <span className="spacer" />
            <span className="badge badge-cobalt">{stateName.toUpperCase()}</span>
          </div>
          <div className="display-md tabular" style={{ marginBottom: 8 }}>
            ₹{formatINR(calc.total)}
          </div>
          <div className="body-sm muted" style={{ marginBottom: 20 }}>
            Total payable for {instrumentName.toLowerCase()} on dutiable value of <span className="mono tabular">₹{formatINR(calc.dutiableValue)}</span>.
          </div>

          <hr className="hairline" style={{ marginBottom: 16 }} />

          <div className="col" style={{ gap: 12 }}>
            <Breakdown
              label="Stamp duty"
              meta={`${calc.stampPct.toFixed(1)}% of ₹${formatINR(calc.dutiableValue)}`}
              amount={calc.stampDuty}
            />
            <Breakdown
              label="Registration fee"
              meta={`${calc.regPct.toFixed(1)}% of ₹${formatINR(calc.dutiableValue)}`}
              amount={calc.registrationFee}
            />
            <hr className="hairline" />
            <div className="row">
              <div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>Total payable</div>
                <div className="body-xs" style={{ marginTop: 2 }}>To Sub-Registrar at registration</div>
              </div>
              <span className="spacer" />
              <div className="mono tabular" style={{ fontSize: 22, fontWeight: 600 }}>
                ₹{formatINR(calc.total)}
              </div>
            </div>
          </div>

          <div className="row" style={{ gap: 8, marginTop: 24 }}>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => showToast({ type: 'cobalt', text: 'Stamp duty PDF export queued' })}
            >
              <Icon name="download" size={14} /> Export PDF
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={handleSaveCalculation}
            >
              <Icon name="file" size={14} /> Save to matter
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Breakdown({ label, meta, amount }: { label: string; meta: string; amount: number }) {
  return (
    <div className="row">
      <div>
        <div style={{ fontSize: 14, fontWeight: 500 }}>{label}</div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{meta}</div>
      </div>
      <span className="spacer" />
      <span className="mono tabular" style={{ fontSize: 15, fontWeight: 500 }}>₹{formatINR(amount)}</span>
    </div>
  );
}
