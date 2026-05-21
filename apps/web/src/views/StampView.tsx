import { useMemo, useState } from 'react';
import { Icon, Select } from '@lexdraft/ui';
import { useUIStore } from '@/store/ui';
import { SearchableSelect } from '@/components/SearchableSelect';
import { INDIA_STATES, INDIA_STATES_BY_CODE } from '@/lib/india-states';
import { exportPdf, escapeReportHtml } from '@/lib/export-doc';
import { resolveLetterhead } from '@/lib/letterhead-resolve';
import { LetterheadPicker } from '@/components/letterhead/LetterheadPicker';

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

/**
 * Reads what the user typed into a comma-separated currency field and returns
 * (a) the digits-only value for state + math, and (b) the Indian-grouped
 * string to render back in the input. Empty input is preserved so the field
 * can be cleared without snapping back to "0".
 */
function parseIndianCurrency(raw: string): { digits: string; formatted: string } {
  const digits = raw.replace(/[^0-9]/g, '');
  if (!digits) return { digits: '', formatted: '' };
  const n = Number(digits);
  if (!Number.isFinite(n)) return { digits, formatted: digits };
  return { digits, formatted: n.toLocaleString('en-IN', { maximumFractionDigits: 0 }) };
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

  const [exporting, setExporting] = useState(false);
  // undefined = use the user's effective default (firm or personal). Set
  // by the LetterheadPicker - null means "no letterhead", a string is a
  // specific letterhead id.
  const [letterheadChoice, setLetterheadChoice] = useState<string | null | undefined>(undefined);

  // Renders the estimate panel as a print-quality A4 PDF via the shared
  // exportPdf helper. We hand-build the HTML so the layout matches a
  // formal estimate (firm-letterhead style) rather than DOM-snapshotting
  // the screen card - the on-screen card uses tokens like --bg-surface
  // that don't translate well into a print stylesheet.
  const handleExportPdf = async (): Promise<void> => {
    if (exporting) return;
    setExporting(true);
    try {
      const today = new Date().toLocaleDateString('en-IN', {
        day: '2-digit', month: 'long', year: 'numeric',
      });
      const bodyHtml = `
        <p>The estimate below is computed against the latest published schedule
           for ${escapeReportHtml(stateName)}. Final liability is determined by
           the Sub-Registrar at the time of registration.</p>

        <table>
          <tbody>
            <tr><th>State / UT</th><td>${escapeReportHtml(stateName)}</td></tr>
            <tr><th>Instrument</th><td>${escapeReportHtml(instrumentName)}</td></tr>
            <tr><th>Consideration value</th>
              <td class="num">₹${formatINR(Number(consideration) || 0)}</td></tr>
            <tr><th>Market / property value</th>
              <td class="num">₹${formatINR(Number(propertyValue) || 0)}</td></tr>
            <tr><th>Dutiable value <em>(higher of the two)</em></th>
              <td class="num">₹${formatINR(calc.dutiableValue)}</td></tr>
          </tbody>
        </table>

        <h2>Computation</h2>
        <table>
          <thead>
            <tr><th>Component</th><th>Rate</th><th class="num">Amount (₹)</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>Stamp duty</td>
              <td>${calc.stampPct.toFixed(1)}% of ₹${formatINR(calc.dutiableValue)}</td>
              <td class="num">${formatINR(calc.stampDuty)}</td>
            </tr>
            <tr>
              <td>Registration fee</td>
              <td>${calc.regPct.toFixed(1)}% of ₹${formatINR(calc.dutiableValue)}</td>
              <td class="num">${formatINR(calc.registrationFee)}</td>
            </tr>
            <tr>
              <th>Total payable</th>
              <th></th>
              <th class="num">${formatINR(calc.total)}</th>
            </tr>
          </tbody>
        </table>

        <p style="margin-top:24px;font-size:11pt;color:#444;">
          Generated by LexDraft on ${escapeReportHtml(today)}. Rates reflect
          the schedule current at the time of generation; verify the latest
          notification before tendering payment.
        </p>
      `;
      // Resolve the picked letterhead (or null/auto-default).
      const letterhead =
        letterheadChoice === undefined ? undefined
        : letterheadChoice === null   ? null
        : await resolveLetterhead(letterheadChoice);
      await exportPdf({
        title: `Stamp duty estimate - ${stateName} ${instrumentName}`,
        bodyHtml,
        dated: today,
        // This is a calculation report, not an AI draft - suppress the
        // AI disclaimer footer that exportPdf injects by default.
        disclaimerHtml: null,
        letterhead,
      });
      showToast({ type: 'sage', text: 'Stamp duty PDF downloaded' });
    } catch (err) {
      showToast({
        type: 'vermillion',
        text: err instanceof Error ? err.message : 'Could not export PDF',
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="col stagger" style={{ gap: 24 }}>
      <div>
        <div className="eyebrow" style={{ marginBottom: 8 }}>§ - STAMP & REGISTRATION</div>
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
                type="text"
                inputMode="numeric"
                value={parseIndianCurrency(consideration).formatted}
                onChange={(e) => setConsideration(parseIndianCurrency(e.target.value).digits)}
                placeholder="e.g. 50,00,000"
                style={{ fontFamily: 'var(--font-mono)' }}
              />
            </div>
            <div>
              <label className="label" htmlFor="pval-input">Market / property value (₹)</label>
              <input
                id="pval-input"
                className="input tabular"
                type="text"
                inputMode="numeric"
                value={parseIndianCurrency(propertyValue).formatted}
                onChange={(e) => setPropertyValue(parseIndianCurrency(e.target.value).digits)}
                placeholder="e.g. 55,00,000"
                style={{ fontFamily: 'var(--font-mono)' }}
              />
              <div className="body-xs" style={{ marginTop: 6 }}>Higher of consideration &amp; market value is dutiable.</div>
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

          <div className="col" style={{ gap: 10, marginTop: 24 }}>
            <LetterheadPicker
              value={letterheadChoice}
              onChange={setLetterheadChoice}
            />
            <div className="row" style={{ gap: 8 }}>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => void handleExportPdf()}
                disabled={exporting}
              >
                <Icon name="download" size={14} /> {exporting ? 'Generating…' : 'Export PDF'}
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
