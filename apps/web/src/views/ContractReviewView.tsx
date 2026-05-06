import { useState, type ChangeEvent, type DragEvent } from 'react';
import { Icon } from '@lexdraft/ui';

type Severity = 'Critical' | 'High' | 'Moderate' | 'Missing' | 'Negotiable' | 'Standard';
type ResultTab = 'critical' | 'moderate' | 'missing' | 'negotiable' | 'standard';
type Perspective = 'Client' | 'Vendor' | 'Employer' | 'Employee' | 'Landlord' | 'Tenant' | 'Company';

interface Finding {
  sev: Severity;
  title: string;
  text: string;
  law: string;
  sug: string;
}

type FindingsByTab = Record<ResultTab, Finding[]>;

const PERSPECTIVES: ReadonlyArray<Perspective> = [
  'Client',
  'Vendor',
  'Employer',
  'Employee',
  'Landlord',
  'Tenant',
  'Company',
];

const FINDINGS: FindingsByTab = {
  critical: [
    {
      sev: 'Critical',
      title: 'Unilateral termination clause favouring counterparty',
      text: '"The Company may terminate this Agreement at any time, with or without cause, upon thirty (30) days written notice."',
      law: 'Sec 23 ICA, 1872',
      sug: 'Mutual termination right with cure period (15 days) for material breach. Add carve-out for non-payment.',
    },
    {
      sev: 'High',
      title: 'Indemnity scope unbounded',
      text: '"Vendor shall indemnify and hold harmless the Company against any and all claims, losses, damages..."',
      law: 'Sec 124 ICA + Trimex Intl. v. Vedanta',
      sug: 'Cap indemnity at 12 months fees. Exclude consequential and indirect damages.',
    },
  ],
  moderate: [
    {
      sev: 'Moderate',
      title: 'Ambiguous force majeure list',
      text: '"Acts of God, war, government action, or other similar events..."',
      law: 'Energy Watchdog v. CERC',
      sug: 'Add pandemic, cyber-attack, supply-chain disruption with notice obligations.',
    },
  ],
  missing: [
    {
      sev: 'Missing',
      title: 'No data protection clause',
      text: 'Contract is silent on personal data handling.',
      law: 'DPDPA 2023',
      sug: 'Add DPDPA-compliant clause: lawful basis, deletion on termination, breach notification within 72h.',
    },
    {
      sev: 'Missing',
      title: 'No dispute resolution mechanism',
      text: '—',
      law: 'A&C Act 1996',
      sug: 'Insert tiered DR: negotiation → mediation → arbitration (1 arbitrator, Mumbai seat, English).',
    },
  ],
  negotiable: [
    {
      sev: 'Negotiable',
      title: 'Payment terms 60 days',
      text: '"Invoices payable within sixty (60) days of receipt."',
      law: 'MSMED Act 2006',
      sug: 'Reduce to 30/45 days. If MSME registered, statute caps at 45 days.',
    },
  ],
  standard: [
    {
      sev: 'Standard',
      title: 'Governing law',
      text: '"This Agreement shall be governed by the laws of India."',
      law: '—',
      sug: 'Standard. Acceptable.',
    },
  ],
};

const SCORE = 64;

type StatusToken = 'success' | 'warning' | 'danger' | 'info';

const SEVERITY_TOKEN: Record<Severity, StatusToken> = {
  Critical: 'danger',
  High: 'danger',
  Moderate: 'warning',
  Missing: 'info',
  Negotiable: 'info',
  Standard: 'success',
};

const TOKEN_TO_BADGE: Record<StatusToken, string> = {
  danger: 'badge-vermillion',
  warning: 'badge-amber',
  info: 'badge-cobalt',
  success: 'badge-sage',
};

interface TabDef {
  id: ResultTab;
  label: string;
  count: number;
  token: StatusToken;
}

export function ContractReviewView() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [perspective, setPerspective] = useState<Perspective | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [resultTab, setResultTab] = useState<ResultTab>('critical');
  const [fileName, setFileName] = useState<string | null>(null);

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    if (step < 2) setStep(2);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    handleFile(e.dataTransfer?.files?.[0]);
  };

  const onBrowse = (e: ChangeEvent<HTMLInputElement>) => {
    handleFile(e.target.files?.[0] ?? undefined);
  };

  const analyze = () => {
    setAnalyzing(true);
    setStep(3);
    window.setTimeout(() => setAnalyzing(false), 2200);
  };

  const tabs: ReadonlyArray<TabDef> = [
    { id: 'critical', label: 'Critical & High', count: FINDINGS.critical.length, token: 'danger' },
    { id: 'moderate', label: 'Moderate', count: FINDINGS.moderate.length, token: 'warning' },
    { id: 'missing', label: 'Missing', count: FINDINGS.missing.length, token: 'info' },
    { id: 'negotiable', label: 'Negotiable', count: FINDINGS.negotiable.length, token: 'info' },
    { id: 'standard', label: 'Standard', count: FINDINGS.standard.length, token: 'success' },
  ];

  return (
    <div className="col stagger" style={{ gap: 24 }}>
      <div>
        <h1 className="heading-xl" style={{ marginBottom: 4 }}>
          Contract Review
        </h1>
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
          UPLOAD · CHOOSE PERSPECTIVE · GET RISK SCORE
        </div>
      </div>

      {/* Step 1 — drop zone */}
      <div className="col" style={{ gap: 16 }}>
        <div className="row" style={{ gap: 12 }}>
          <span
            className="mono"
            style={{
              fontSize: 11,
              color: step >= 1 ? 'var(--text-primary)' : 'var(--text-tertiary)',
            }}
          >
            STEP 01
          </span>
          <div className="heading-lg">Upload contract</div>
          {fileName && <span className="badge badge-sage">✓ {fileName}</span>}
        </div>
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          style={{
            border: '2px dashed var(--border-strong)',
            borderRadius: 'var(--radius-lg)',
            padding: 48,
            textAlign: 'center',
            background: fileName ? 'var(--bg-surface-2)' : 'var(--bg-surface)',
            cursor: 'pointer',
            transition: 'all 150ms',
          }}
        >
          <Icon name="upload" size={32} className="muted" />
          <div className="heading-lg" style={{ marginTop: 12, marginBottom: 4 }}>
            {fileName ?? 'Drop a contract here'}
          </div>
          <p className="body-md muted" style={{ marginBottom: 16 }}>
            {fileName ? 'Drop another to replace' : 'PDF, DOCX, or paste text'}
          </p>
          <label className="btn">
            Browse files
            <input type="file" hidden onChange={onBrowse} />
          </label>
        </div>
      </div>

      {/* Step 2 — perspective */}
      {step >= 2 && (
        <div className="col" style={{ gap: 16 }}>
          <div className="row" style={{ gap: 12 }}>
            <span className="mono" style={{ fontSize: 11, color: 'var(--text-primary)' }}>
              STEP 02
            </span>
            <div className="heading-lg">Whose side are you on?</div>
          </div>
          <div className="grid-4">
            {PERSPECTIVES.map((p) => {
              const active = perspective === p;
              return (
                <button
                  key={p}
                  className="card card-hover"
                  onClick={() => setPerspective(p)}
                  style={{
                    padding: 22,
                    textAlign: 'center',
                    background: active ? 'var(--text-primary)' : 'var(--bg-surface)',
                    color: active ? 'var(--bg-base)' : 'var(--text-primary)',
                    borderColor: active ? 'var(--text-primary)' : 'var(--border-default)',
                    cursor: 'pointer',
                  }}
                >
                  <div className="heading-md" style={{ color: 'inherit', marginBottom: 4 }}>
                    {p}
                  </div>
                  <div className="mono" style={{ fontSize: 10, opacity: 0.6 }}>
                    REPRESENT
                  </div>
                </button>
              );
            })}
          </div>
          {perspective && step === 2 && (
            <button
              className="btn btn-primary btn-lg"
              onClick={analyze}
              style={{ alignSelf: 'flex-start' }}
            >
              Analyze contract <Icon name="arrow" size={14} />
            </button>
          )}
        </div>
      )}

      {/* Step 3 — results */}
      {step === 3 && (
        <div className="col" style={{ gap: 20 }}>
          <div className="row" style={{ gap: 12 }}>
            <span className="mono" style={{ fontSize: 11, color: 'var(--text-primary)' }}>
              STEP 03
            </span>
            <div className="heading-lg">Results · {perspective} perspective</div>
          </div>

          {analyzing ? (
            <div className="card" style={{ padding: 80, textAlign: 'center' }}>
              <div className="heading-lg" style={{ marginBottom: 8 }}>
                Analyzing
                <span className="blink" />
              </div>
              <p className="body-md muted">
                Reading 14 sections · checking against Indian law · cross-referencing case law
              </p>
            </div>
          ) : (
            <>
              <div
                className="card results-head"
                style={{
                  padding: 32,
                  display: 'grid',
                  gridTemplateColumns: '200px 1fr',
                  gap: 32,
                  alignItems: 'center',
                }}
              >
                <RiskGauge score={SCORE} />
                <div>
                  <div
                    className="mono"
                    style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 6 }}
                  >
                    RISK SCORE
                  </div>
                  <div
                    className="row"
                    style={{ alignItems: 'baseline', gap: 8, marginBottom: 14 }}
                  >
                    <span className="mono tabular" style={{ fontSize: 64, fontWeight: 400 }}>
                      {SCORE}
                    </span>
                    <span
                      className="mono"
                      style={{ fontSize: 16, color: 'var(--text-tertiary)' }}
                    >
                      /100
                    </span>
                    <span className="badge badge-amber" style={{ marginLeft: 8 }}>
                      MODERATE RISK
                    </span>
                  </div>
                  <p className="body-md" style={{ lineHeight: 1.6 }}>
                    From the <strong>{perspective}</strong> perspective, this contract has{' '}
                    <strong style={{ color: 'var(--danger)' }}>2 critical/high issues</strong>,{' '}
                    <strong>2 missing protections</strong>, and several negotiable items. Key
                    concerns: unbounded indemnity and unilateral termination clause weighted
                    against you.
                  </p>
                </div>
              </div>

              <div
                style={{ borderBottom: '1px solid var(--border-default)', overflowX: 'auto' }}
              >
                <div className="row" style={{ gap: 0, minWidth: 'min-content' }}>
                  {tabs.map((t) => {
                    const active = resultTab === t.id;
                    return (
                      <button
                        key={t.id}
                        onClick={() => setResultTab(t.id)}
                        style={{
                          padding: '14px 16px',
                          fontSize: 13,
                          fontWeight: 500,
                          color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                          background: 'transparent',
                          border: 0,
                          borderBottom: `2px solid ${
                            active ? 'var(--text-primary)' : 'transparent'
                          }`,
                          whiteSpace: 'nowrap',
                          cursor: 'pointer',
                        }}
                      >
                        {t.label}{' '}
                        <span
                          className="mono"
                          style={{
                            marginLeft: 6,
                            color: `var(--${t.token})`,
                            fontSize: 11,
                          }}
                        >
                          {t.count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="col" style={{ gap: 12 }}>
                {FINDINGS[resultTab].map((f, i) => (
                  <ClauseCard key={`${f.title}-${i}`} {...f} />
                ))}
              </div>
            </>
          )}
          <style>{`@media (max-width: 767px) { .results-head { grid-template-columns: 1fr !important; text-align: center; } }`}</style>
        </div>
      )}
    </div>
  );
}

function RiskGauge({ score }: { score: number }) {
  const r = 70;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - score / 100);
  const stroke =
    score > 75 ? 'var(--success)' : score > 50 ? 'var(--warning)' : 'var(--danger)';
  return (
    <svg
      width="160"
      height="160"
      viewBox="0 0 160 160"
      style={{ transform: 'rotate(-90deg)' }}
      aria-label={`Risk score ${score} of 100`}
    >
      <circle cx="80" cy="80" r={r} fill="none" stroke="var(--border-strong)" strokeWidth="6" />
      <circle
        cx="80"
        cy="80"
        r={r}
        fill="none"
        stroke={stroke}
        strokeWidth="6"
        strokeDasharray={c}
        strokeDashoffset={offset}
        style={{ transition: 'stroke-dashoffset 1.2s ease-out' }}
      />
    </svg>
  );
}

function ClauseCard({ sev, title, text, law, sug }: Finding) {
  const [open, setOpen] = useState(false);
  const token = SEVERITY_TOKEN[sev];
  const badgeClass = TOKEN_TO_BADGE[token];
  return (
    <div className="card" style={{ borderLeft: `3px solid var(--${token})`, padding: 20 }}>
      <div className="row" style={{ marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
        <span className={`badge ${badgeClass}`}>{sev.toUpperCase()}</span>
        <span className="badge">{law}</span>
        <span className="spacer" />
      </div>
      <div className="heading-md" style={{ marginBottom: 10 }}>
        {title}
      </div>
      {text !== '—' && (
        <blockquote
          className="mono"
          style={{
            background: 'var(--bg-surface-2)',
            padding: 12,
            fontSize: 12,
            lineHeight: 1.6,
            borderLeft: '2px solid var(--border-strong)',
            borderRadius: 'var(--radius-sm)',
            marginBottom: 12,
          }}
        >
          {text}
        </blockquote>
      )}
      <button
        className="btn btn-ghost btn-sm"
        onClick={() => setOpen(!open)}
        style={{ padding: 0 }}
      >
        <Icon name={open ? 'chevronD' : 'chevron'} size={14} /> Suggested redline
      </button>
      {open && (
        <div
          className="body-sm"
          style={{
            background: 'var(--success-bg)',
            color: 'var(--text-primary)',
            padding: 14,
            lineHeight: 1.6,
            marginTop: 10,
            borderLeft: '2px solid var(--success)',
            borderRadius: 'var(--radius-sm)',
          }}
        >
          {sug}
        </div>
      )}
    </div>
  );
}
