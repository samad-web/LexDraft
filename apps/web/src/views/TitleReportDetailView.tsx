/**
 * TitleReportDetailView — the seven-step wizard for authoring a TIR.
 *
 * Steps:
 *   1. Property & Applicant
 *   2. Chain of title
 *   3. Documents examined
 *   4. Searches
 *   5. Encumbrances & Litigation
 *   6. Defects & Opinion (AI-assisted)
 *   7. Preview & Export
 *
 * All step components are inlined in this file. The wizard autosaves on
 * every form change (via the React Query mutation hooks) and lets the user
 * jump between steps freely — completeness gates run only on transition
 * (in_review / finalised / issued), enforced by the API.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Icon, Select, Skeleton, ErrorState, type SelectOption } from '@lexdraft/ui';
import type {
  TitleReportChainLinkType,
  TitleReportDefect,
  TitleReportDocumentType,
  TitleReportExtentUnit,
  TitleReportFull,
  TitleReportJurisdiction,
  TitleReportSearchType,
  TitleReportStatus,
  TitleReportLitigationRelevance,
  TitleReportApprovalType,
  TitleReportApprovalStatus,
  TitleReportEncumbranceStatus,
  TitleReportPersonalLaw,
  TitleReportConsentStatus,
  TitleReportDefectCategory,
  TitleReportDefectSeverity,
} from '@lexdraft/types';
import {
  useTitleReport,
  useUpdateTitleReport,
  useTransitionTitleReport,
  useUpsertProperty,
  useAddChainLink,
  useUpdateChainLink,
  useDeleteChainLink,
  useAddDocument,
  usePatchDocument,
  useExtractDocument,
  useApplyTitleReportDocument,
  useAddEncumbrance,
  usePatchEncumbrance,
  useDeleteEncumbrance,
  useAddSearch,
  useAddLitigation,
  useDeleteLitigation,
  useAddApproval,
  useDeleteApproval,
  useAddHeir,
  useAddDefect,
  useApplyDefectAck,
  useRunAiAnalysis,
  useSynthesiseOpinion,
  useTitleReportAiRun,
  useRecordTitleReportExport,
  JURISDICTION_LABEL,
  STATUS_LABEL,
} from '@/hooks/useTitleReports';
import { useUIStore } from '@/store/ui';
import { exportTitleReportPdf } from '@/lib/title-report-pdf';
import { apiClient } from '@/lib/api';

// =============================================================================
// Shared helper — wraps a mutation call with success/error toasts so the
// "Add X" buttons surface what went wrong instead of failing silently. Every
// step component uses this; without it a backend 400 / 403 / 500 looks like
// "the button doesn't work".
// =============================================================================

function useToastedAction() {
  const showToast = useUIStore((s) => s.showToast);
  return useCallback(
    async <T,>(fn: () => Promise<T>, opts?: { ok?: string; fail?: string }): Promise<T | null> => {
      try {
        const result = await fn();
        if (opts?.ok) showToast({ type: 'sage', text: opts.ok });
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : (opts?.fail ?? 'Action failed');
        showToast({ type: 'vermillion', text: msg });
        return null;
      }
    },
    [showToast],
  );
}

// =============================================================================
// Wizard shell
// =============================================================================

interface StepDef { id: string; title: string; eyebrow: string }

const STEPS: ReadonlyArray<StepDef> = [
  // Documents is first so uploading a sale deed, EC, patta, etc. pre-fills
  // the rest of the wizard. The "Apply to report" button on each extracted
  // document drops a chain link, encumbrance rows, or property fields into
  // the subsequent steps automatically.
  { id: 'documents',    title: 'Documents Examined',       eyebrow: 'Upload to auto-fill the rest of the wizard' },
  { id: 'property',     title: 'Property & Applicant',     eyebrow: 'Schedule of property + jurisdiction-aware fields' },
  { id: 'chain',        title: 'Chain of Title',           eyebrow: '30-year chain with gap detection' },
  { id: 'searches',     title: 'Searches',                 eyebrow: 'SRO, revenue, municipal, litigation' },
  { id: 'encumbrances', title: 'Encumbrances & Litigation', eyebrow: 'Subsisting mortgages, pending suits' },
  { id: 'defects',      title: 'Defects & Opinion',        eyebrow: 'AI defect analysis + opinion synthesis' },
  { id: 'preview',      title: 'Preview & Export',         eyebrow: 'Render on letterhead, generate PDF' },
];

export function TitleReportDetailView() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const showToast = useUIStore((s) => s.showToast);

  const detail = useTitleReport(id);
  const [stepIdx, setStepIdx] = useState(0);

  const transition = useTransitionTitleReport(id);

  // ⌘S = no-op-by-design (autosave runs on every change). ⌘→ advances.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        showToast({ type: 'sage', text: 'Saved' });
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'ArrowRight') {
        e.preventDefault();
        setStepIdx((i) => Math.min(STEPS.length - 1, i + 1));
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'ArrowLeft') {
        e.preventDefault();
        setStepIdx((i) => Math.max(0, i - 1));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showToast]);

  if (detail.isLoading) {
    return (
      <div className="tr-detail">
        <Skeleton height={80} />
        <Skeleton height={400} />
      </div>
    );
  }
  if (detail.isError || !detail.data) {
    return (
      <ErrorState
        title="Couldn't load title report"
        description={detail.error instanceof Error ? detail.error.message : 'Unknown error'}
        onRetry={() => { void detail.refetch(); }}
      />
    );
  }

  const report = detail.data;
  const completion = computeCompletion(report);
  const step = STEPS[stepIdx] ?? STEPS[0]!;

  const handleTransition = async (to: TitleReportStatus) => {
    try {
      await transition.mutateAsync({ to });
      showToast({ type: 'sage', text: `Moved to ${STATUS_LABEL[to]}` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Transition failed';
      showToast({ type: 'vermillion', text: msg });
    }
  };

  return (
    <div className="tr-detail">
      <header className="tr-detail__head">
        <div className="tr-detail__back" onClick={() => navigate('/app/title-reports')}>
          <Icon name="chevron" /> Title Reports
        </div>
        <div className="tr-detail__title">
          <div className="tr-detail__num">{report.reportNumber}</div>
          <h1 className="tr-h1">{report.applicantName}</h1>
          <div className="tr-detail__meta">
            {JURISDICTION_LABEL[report.jurisdictionState] ?? report.jurisdictionState}
            {report.bankName ? ` · ${report.bankName}` : ''}
          </div>
        </div>
        <div className="tr-detail__actions">
          <span className={`badge badge--${report.status}`}>{STATUS_LABEL[report.status]}</span>
          {report.status === 'draft' && (
            <button type="button" className="btn btn-secondary" onClick={() => handleTransition('in_review')}>
              Send to review
            </button>
          )}
          {report.status === 'in_review' && (
            <button type="button" className="btn btn-primary" onClick={() => handleTransition('finalised')}>
              Finalise
            </button>
          )}
          {report.status === 'finalised' && (
            <button type="button" className="btn btn-primary" onClick={() => handleTransition('issued')}>
              Mark as issued
            </button>
          )}
        </div>
      </header>

      <div className="tr-wizard">
        <aside className="tr-rail">
          <ol className="tr-rail__list">
            {STEPS.map((s, i) => (
              <li key={s.id}>
                <button
                  type="button"
                  className={`tr-rail__step ${i === stepIdx ? 'is-active' : ''} ${completion[i] ? 'is-done' : ''}`}
                  onClick={() => setStepIdx(i)}
                >
                  <span className="tr-rail__num">{completion[i] ? <Icon name="check" /> : i + 1}</span>
                  <span>
                    <strong>{s.title}</strong>
                    <em>{s.eyebrow}</em>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </aside>

        <section className="tr-step">
          <div className="tr-step__head">
            <div className="tr-step__eyebrow">Step {stepIdx + 1} of {STEPS.length}</div>
            <h2 className="tr-step__title">{step.title}</h2>
            <p className="tr-step__sub">{step.eyebrow}</p>
          </div>

          {step.id === 'property' && <PropertyAndApplicantStep report={report} />}
          {step.id === 'chain' && <ChainStep report={report} />}
          {step.id === 'documents' && <DocumentsStep report={report} />}
          {step.id === 'searches' && <SearchesStep report={report} />}
          {step.id === 'encumbrances' && <EncumbrancesAndLitigationStep report={report} />}
          {step.id === 'defects' && <DefectsAndOpinionStep report={report} />}
          {step.id === 'preview' && <PreviewStep report={report} onTransition={handleTransition} />}

          <footer className="tr-step__foot">
            <button
              type="button"
              className="btn btn-ghost"
              disabled={stepIdx === 0}
              onClick={() => setStepIdx((i) => Math.max(0, i - 1))}
            >
              <Icon name="chevron" /> Back
            </button>
            <div className="tr-step__hint">⌘→ next · ⌘← back · changes save automatically</div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={stepIdx === STEPS.length - 1}
              onClick={() => setStepIdx((i) => Math.min(STEPS.length - 1, i + 1))}
            >
              Save &amp; next <Icon name="arrow" />
            </button>
          </footer>
        </section>
      </div>
    </div>
  );
}

function computeCompletion(r: TitleReportFull): boolean[] {
  // Index aligned with STEPS above (documents → property → chain → searches
  // → encumbrances → defects → preview).
  return [
    r.documents.length >= 1,
    !!r.property && !!r.applicantName,
    r.chainLinks.length >= 1,
    r.searches.length >= 1,
    r.encumbrances.length >= 1,
    r.opinionVerdict !== 'pending' && !!r.opinionSummary,
    r.exports.some((e) => e.format === 'pdf'),
  ];
}

// =============================================================================
// Step 1 — Property & Applicant (includes OwnerStep + JurisdictionFields)
// =============================================================================

const EXTENT_OPTIONS: SelectOption[] = [
  { value: 'sqft',     label: 'Square feet' },
  { value: 'sqm',      label: 'Square metres' },
  { value: 'acres',    label: 'Acres' },
  { value: 'cents',    label: 'Cents' },
  { value: 'guntas',   label: 'Guntas' },
  { value: 'hectares', label: 'Hectares' },
];

const JURISDICTION_FIELD_KEYS: Record<TitleReportJurisdiction, ReadonlyArray<{ key: string; label: string }>> = {
  TN: [
    { key: 'patta_no',     label: 'Patta No.' },
    { key: 'chitta_no',    label: 'Chitta No.' },
    { key: 'adangal',      label: 'Adangal entry' },
    { key: 'a_register',   label: 'A-Register reference' },
    { key: 'fmb_sketch',   label: 'FMB sketch reference' },
    { key: 'tslr',         label: 'TSLR reference' },
  ],
  KA: [
    { key: 'khata_no',     label: 'Khata No. (A/B)' },
    { key: 'rtc_no',       label: 'RTC (Pahani)' },
    { key: 'mutation_no',  label: 'Mutation Register (MR)' },
    { key: 'tippani',      label: 'Tippani' },
    { key: 'akarbandh',    label: 'Akarbandh' },
  ],
  MH: [
    { key: 'seven_twelve', label: '7/12 extract' },
    { key: 'eight_a',      label: '8A extract' },
    { key: 'mutation',     label: 'Mutation entries' },
  ],
  TG: [
    { key: 'dharani',      label: 'Dharani reference' },
    { key: 'one_b',        label: '1-B record' },
    { key: 'pahani',       label: 'Pahani' },
    { key: 'ror_1b',       label: 'ROR-1B' },
  ],
  AP: [
    { key: 'dharani',      label: 'Dharani reference' },
    { key: 'one_b',        label: '1-B record' },
    { key: 'pahani',       label: 'Pahani' },
  ],
  DL: [{ key: 'khasra',    label: 'Khasra / Khatauni' }],
  UP: [{ key: 'khasra',    label: 'Khasra / Khatauni' }],
  GJ: [{ key: 'satbara',   label: '7/12 extract' }],
  RJ: [{ key: 'khasra',    label: 'Khasra / Khatauni' }],
  WB: [{ key: 'ror',       label: 'Record of Rights (RoR)' }],
  KL: [{ key: 'thandaper', label: 'Thandaper / BTR' }],
  PB: [{ key: 'fard',      label: 'Fard / Jamabandi' }],
  HR: [{ key: 'fard',      label: 'Fard / Jamabandi' }],
  MP: [{ key: 'khasra',    label: 'Khasra / Khatauni' }],
  CG: [{ key: 'khasra',    label: 'Khasra / Khatauni' }],
  OR: [{ key: 'ror',       label: 'Record of Rights (RoR)' }],
  JH: [{ key: 'khasra',    label: 'Khasra / Khatauni' }],
  BR: [{ key: 'khasra',    label: 'Khasra / Khatauni' }],
  AS: [{ key: 'jamabandi', label: 'Jamabandi' }],
  OTHER: [{ key: 'ror',    label: 'Record of Rights (generic)' }],
};

function PropertyAndApplicantStep({ report }: { report: TitleReportFull }) {
  const update = useUpdateTitleReport(report.id);
  const upsertProperty = useUpsertProperty(report.id);
  const addHeir = useAddHeir(report.id);

  const [applicantName, setApplicantName] = useState(report.applicantName);
  const [applicantType, setApplicantType] = useState(report.applicantType);
  const [bankName, setBankName] = useState(report.bankName ?? '');
  const [bankBranch, setBankBranch] = useState(report.bankBranch ?? '');
  const [loanRef, setLoanRef] = useState(report.loanReference ?? '');
  const [jurisdiction, setJurisdiction] = useState<TitleReportJurisdiction>(report.jurisdictionState);
  const [searchFrom, setSearchFrom] = useState(report.searchPeriodFrom ?? '');
  const [searchTo, setSearchTo] = useState(report.searchPeriodTo ?? '');

  const [address, setAddress] = useState(report.property?.address ?? '');
  const [surveyNo, setSurveyNo] = useState(report.property?.surveyNo ?? '');
  const [subDiv, setSubDiv] = useState(report.property?.subDivision ?? '');
  const [extentValue, setExtentValue] = useState(report.property?.extentValue?.toString() ?? '');
  const [extentUnit, setExtentUnit] = useState<TitleReportExtentUnit>(report.property?.extentUnit ?? 'sqft');
  const [n, setN] = useState(report.property?.boundaryNorth ?? '');
  const [s, setS] = useState(report.property?.boundarySouth ?? '');
  const [east, setEast] = useState(report.property?.boundaryEast ?? '');
  const [west, setWest] = useState(report.property?.boundaryWest ?? '');
  const [scheduleA, setScheduleA] = useState(report.property?.scheduleA ?? '');
  const [jurFields, setJurFields] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    const js = report.property?.jurisdictionSpecific ?? {};
    for (const [k, v] of Object.entries(js)) out[k] = v == null ? '' : String(v);
    return out;
  });

  const saveHeader = useDebouncedCallback(async () => {
    try {
      await update.mutateAsync({
        applicantName, applicantType,
        bankName: bankName || null,
        bankBranch: bankBranch || null,
        loanReference: loanRef || null,
        jurisdictionState: jurisdiction,
        searchPeriodFrom: searchFrom || null,
        searchPeriodTo: searchTo || null,
      });
    } catch { /* toast handled by interceptor for cap, else swallow */ }
  }, 600);

  const saveProperty = useDebouncedCallback(async () => {
    if (!address.trim()) return;
    try {
      await upsertProperty.mutateAsync({
        address,
        surveyNo: surveyNo || undefined,
        subDivision: subDiv || undefined,
        extentValue: extentValue ? Number(extentValue) : undefined,
        extentUnit,
        boundaryNorth: n || undefined,
        boundarySouth: s || undefined,
        boundaryEast: east || undefined,
        boundaryWest: west || undefined,
        scheduleA: scheduleA || undefined,
        jurisdictionSpecific: jurFields,
      });
    } catch { /* swallow */ }
  }, 600);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- debounced callback is stable
  useEffect(() => { saveHeader(); }, [applicantName, applicantType, bankName, bankBranch, loanRef, jurisdiction, searchFrom, searchTo]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- debounced callback is stable
  useEffect(() => { saveProperty(); }, [address, surveyNo, subDiv, extentValue, extentUnit, n, s, east, west, scheduleA, jurFields]);

  const jurKeys = JURISDICTION_FIELD_KEYS[jurisdiction] ?? JURISDICTION_FIELD_KEYS.OTHER;

  return (
    <div className="tr-form">
      <Section title="Applicant">
        <Row>
          <Field label="Applicant name">
            <input className="input" value={applicantName} onChange={(e) => setApplicantName(e.target.value)} />
          </Field>
          <Field label="Applicant type">
            <Select
              value={applicantType}
              onChange={(v) => setApplicantType((v as typeof applicantType) || 'buyer')}
              options={[
                { value: 'buyer',    label: 'Buyer' },
                { value: 'owner',    label: 'Current owner' },
                { value: 'borrower', label: 'Borrower' },
              ]}
            />
          </Field>
        </Row>
        <Row>
          <Field label="Bank / NBFC">
            <input className="input" value={bankName} onChange={(e) => setBankName(e.target.value)} />
          </Field>
          <Field label="Branch">
            <input className="input" value={bankBranch} onChange={(e) => setBankBranch(e.target.value)} />
          </Field>
          <Field label="Loan reference">
            <input className="input" value={loanRef} onChange={(e) => setLoanRef(e.target.value)} />
          </Field>
        </Row>
      </Section>

      <Section title="Search window">
        <Row>
          <Field label="Jurisdiction">
            <Select
              value={jurisdiction}
              onChange={(v) => setJurisdiction((v as TitleReportJurisdiction) || 'TN')}
              options={Object.entries(JURISDICTION_LABEL).map(([value, label]) => ({ value, label }))}
            />
          </Field>
          <Field label="From">
            <input className="input" type="date" value={searchFrom} onChange={(e) => setSearchFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <input className="input" type="date" value={searchTo} onChange={(e) => setSearchTo(e.target.value)} />
          </Field>
        </Row>
      </Section>

      <Section title="Schedule of property">
        <Field label="Address">
          <textarea className="input" rows={2} value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>
        <Row>
          <Field label="Survey no.">
            <input className="input" value={surveyNo} onChange={(e) => setSurveyNo(e.target.value)} />
          </Field>
          <Field label="Sub-division">
            <input className="input" value={subDiv} onChange={(e) => setSubDiv(e.target.value)} />
          </Field>
        </Row>
        <Row>
          <Field label="Extent">
            <input className="input" type="number" step="0.01" value={extentValue} onChange={(e) => setExtentValue(e.target.value)} />
          </Field>
          <Field label="Unit">
            <Select
              value={extentUnit}
              onChange={(v) => setExtentUnit((v as TitleReportExtentUnit) || 'sqft')}
              options={EXTENT_OPTIONS}
            />
          </Field>
        </Row>
        <Row>
          <Field label="North"><input className="input" value={n} onChange={(e) => setN(e.target.value)} /></Field>
          <Field label="South"><input className="input" value={s} onChange={(e) => setS(e.target.value)} /></Field>
          <Field label="East"><input className="input" value={east} onChange={(e) => setEast(e.target.value)} /></Field>
          <Field label="West"><input className="input" value={west} onChange={(e) => setWest(e.target.value)} /></Field>
        </Row>
        <Field label="Schedule A (full legal description)">
          <textarea className="input" rows={4} value={scheduleA} onChange={(e) => setScheduleA(e.target.value)} />
        </Field>
      </Section>

      <Section title={`Jurisdiction-specific records (${JURISDICTION_LABEL[jurisdiction] ?? jurisdiction})`}>
        <div className="tr-jur-grid">
          {jurKeys.map((f) => (
            <Field key={f.key} label={f.label}>
              <input
                className="input"
                value={jurFields[f.key] ?? ''}
                onChange={(e) => setJurFields((cur) => ({ ...cur, [f.key]: e.target.value }))}
              />
            </Field>
          ))}
        </div>
      </Section>

      <HeirsSubSection report={report} addHeir={addHeir} />
    </div>
  );
}

function HeirsSubSection({
  report, addHeir,
}: { report: TitleReportFull; addHeir: ReturnType<typeof useAddHeir> }) {
  const [predecessor, setPredecessor] = useState('');
  const [heirName, setHeirName] = useState('');
  const [relationship, setRelationship] = useState('');
  const [share, setShare] = useState('');
  const [personalLaw, setPersonalLaw] = useState<TitleReportPersonalLaw>('hindu');
  const [consent, setConsent] = useState<TitleReportConsentStatus>('pending');

  const showToast = useUIStore((s) => s.showToast);
  const run = useToastedAction();
  const submit = async () => {
    if (!predecessor.trim() || !heirName.trim()) {
      showToast({ type: 'amber', text: 'Predecessor and heir name are required' });
      return;
    }
    const ok = await run(
      () => addHeir.mutateAsync({
        predecessorName: predecessor, heirName, relationship: relationship || undefined,
        share: share || undefined, personalLaw, consentStatus: consent,
      }),
      { ok: 'Heir added' },
    );
    if (ok) { setHeirName(''); setRelationship(''); setShare(''); }
  };

  return (
    <Section title="Heirs (where any chain link is by inheritance)">
      {report.heirs.length > 0 && (
        <ul className="tr-list">
          {report.heirs.map((h) => (
            <li key={h.id} className="tr-list__item">
              <strong>{h.heirName}</strong>
              <span> · {h.relationship ?? 'heir'} of {h.predecessorName}</span>
              {h.share ? <span> · {h.share}</span> : null}
              <span className={`badge badge--${h.consentStatus}`}>{h.consentStatus}</span>
            </li>
          ))}
        </ul>
      )}
      <Row>
        <Field label="Predecessor"><input className="input" value={predecessor} onChange={(e) => setPredecessor(e.target.value)} /></Field>
        <Field label="Personal law">
          <Select
            value={personalLaw}
            onChange={(v) => setPersonalLaw((v as TitleReportPersonalLaw) || 'hindu')}
            options={[
              { value: 'hindu',            label: 'Hindu Succession Act' },
              { value: 'muslim',           label: 'Muslim personal law' },
              { value: 'christian',        label: 'Indian Succession Act (Christian)' },
              { value: 'parsi',            label: 'Indian Succession Act (Parsi)' },
              { value: 'special_marriage', label: 'Special Marriage Act' },
              { value: 'other',            label: 'Other' },
            ]}
          />
        </Field>
      </Row>
      <Row>
        <Field label="Heir"><input className="input" value={heirName} onChange={(e) => setHeirName(e.target.value)} /></Field>
        <Field label="Relationship"><input className="input" value={relationship} onChange={(e) => setRelationship(e.target.value)} /></Field>
        <Field label="Share"><input className="input" value={share} onChange={(e) => setShare(e.target.value)} placeholder="e.g. 1/3" /></Field>
        <Field label="Consent">
          <Select
            value={consent}
            onChange={(v) => setConsent((v as TitleReportConsentStatus) || 'pending')}
            options={[
              { value: 'obtained',     label: 'Obtained' },
              { value: 'pending',      label: 'Pending' },
              { value: 'not_required', label: 'Not required' },
            ]}
          />
        </Field>
      </Row>
      <button type="button" className="btn btn-secondary" onClick={submit} disabled={!predecessor || !heirName}>
        <Icon name="plus" /> Add heir
      </button>
    </Section>
  );
}

// =============================================================================
// Step 2 — Chain of title (ChainLinkEditor + gap timeline)
// =============================================================================

const LINK_TYPES: SelectOption[] = [
  { value: 'sale',             label: 'Sale Deed' },
  { value: 'gift',             label: 'Gift Deed' },
  { value: 'partition',        label: 'Partition Deed' },
  { value: 'settlement',       label: 'Settlement Deed' },
  { value: 'will',             label: 'Will / Testament' },
  { value: 'inheritance',      label: 'Inheritance (intestate)' },
  { value: 'decree',           label: 'Court Decree' },
  { value: 'lease',            label: 'Lease' },
  { value: 'mortgage_release', label: 'Mortgage Release' },
  { value: 'other',            label: 'Other' },
];

function ChainStep({ report }: { report: TitleReportFull }) {
  const add = useAddChainLink(report.id);
  const upd = useUpdateChainLink(report.id);
  const del = useDeleteChainLink(report.id);
  const run = useToastedAction();

  const links = [...report.chainLinks].sort((a, b) => a.sequenceNo - b.sequenceNo);

  const gaps = useMemo(() => {
    const out: { from: number; to: number; years: number; flag: 'ok' | 'warn' | 'bad' }[] = [];
    for (let i = 1; i < links.length; i += 1) {
      const prev = links[i - 1];
      const cur = links[i];
      if (!prev || !cur) continue;
      const a = prev.documentDate;
      const b = cur.documentDate;
      if (!a || !b) continue;
      const yrs = (new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24 * 365.25);
      out.push({
        from: prev.sequenceNo,
        to: cur.sequenceNo,
        years: Math.max(0, yrs),
        flag: yrs >= 7 ? 'bad' : yrs >= 5 ? 'warn' : 'ok',
      });
    }
    return out;
  }, [links]);

  const addLink = async () => {
    const next = (links[links.length - 1]?.sequenceNo ?? 0) + 1;
    await run(
      () => add.mutateAsync({
        sequenceNo: next,
        linkType: 'sale',
        transferor: '',
        transferee: '',
      }),
      { ok: `Link #${next} added` },
    );
  };

  return (
    <div className="tr-form">
      {gaps.length > 0 && (
        <div className="tr-gaps">
          <div className="tr-gaps__head">Gap timeline</div>
          <div className="tr-gaps__row">
            {gaps.map((g) => (
              <span key={`${g.from}-${g.to}`} className={`tr-gap tr-gap--${g.flag}`} title={`${g.years.toFixed(1)} years between #${g.from} → #${g.to}`}>
                #{g.from} <Icon name="arrow" /> #{g.to}: {g.years.toFixed(1)}y
              </span>
            ))}
          </div>
        </div>
      )}

      {links.length === 0 ? (
        <div className="tr-empty tr-empty--inline">
          <p>No chain links recorded. Add the earliest known transfer to start.</p>
          <button type="button" className="btn btn-primary" onClick={addLink}>
            <Icon name="plus" /> Add chain link
          </button>
        </div>
      ) : (
        <div className="tr-chain">
          {links.map((l) => (
            <ChainLinkRow
              key={l.id}
              link={l}
              onSave={(patch) => upd.mutateAsync({ linkId: l.id, patch })}
              onDelete={() => del.mutateAsync(l.id)}
            />
          ))}
          <button type="button" className="btn btn-secondary" onClick={addLink}>
            <Icon name="plus" /> Add chain link
          </button>
        </div>
      )}
    </div>
  );
}

interface ChainLinkRowProps {
  link: TitleReportFull['chainLinks'][number];
  onSave: (patch: Record<string, unknown>) => Promise<unknown>;
  onDelete: () => Promise<unknown>;
}

function ChainLinkRow({ link, onSave, onDelete }: ChainLinkRowProps) {
  const [transferor, setTransferor] = useState(link.transferor);
  const [transferee, setTransferee] = useState(link.transferee);
  const [linkType, setLinkType] = useState<TitleReportChainLinkType>(link.linkType);
  const [date, setDate] = useState(link.documentDate ?? '');
  const [docNo, setDocNo] = useState(link.documentNo ?? '');
  const [sro, setSro] = useState(link.sroOffice ?? '');
  const [bookNo, setBookNo] = useState(link.bookNo ?? '');
  const [volume, setVolume] = useState(link.volumeNo ?? '');
  const [pages, setPages] = useState(link.pages ?? '');
  const [consideration, setConsideration] = useState(link.consideration?.toString() ?? '');
  const [stampDuty, setStampDuty] = useState(link.stampDutyPaid?.toString() ?? '');

  const save = useDebouncedCallback(async () => {
    await onSave({
      transferor, transferee, linkType,
      documentDate: date || undefined,
      documentNo: docNo || undefined,
      sroOffice: sro || undefined,
      bookNo: bookNo || undefined,
      volumeNo: volume || undefined,
      pages: pages || undefined,
      consideration: consideration ? Number(consideration) : undefined,
      stampDutyPaid: stampDuty ? Number(stampDuty) : undefined,
    });
  }, 500);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- debounced callback is stable
  useEffect(() => { save(); }, [transferor, transferee, linkType, date, docNo, sro, bookNo, volume, pages, consideration, stampDuty]);

  return (
    <div className="tr-link">
      <div className="tr-link__head">
        <span className="tr-link__num">#{link.sequenceNo}</span>
        <Select
          value={linkType}
          onChange={(v) => setLinkType((v as TitleReportChainLinkType) || 'sale')}
          options={LINK_TYPES}
        />
        <button type="button" className="icon-btn" onClick={() => onDelete()} aria-label="Delete link">
          <Icon name="trash" />
        </button>
      </div>
      <Row>
        <Field label="Transferor"><input className="input" value={transferor} onChange={(e) => setTransferor(e.target.value)} /></Field>
        <Field label="Transferee"><input className="input" value={transferee} onChange={(e) => setTransferee(e.target.value)} /></Field>
        <Field label="Date"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </Row>
      <Row>
        <Field label="Document no."><input className="input" value={docNo} onChange={(e) => setDocNo(e.target.value)} /></Field>
        <Field label="SRO"><input className="input" value={sro} onChange={(e) => setSro(e.target.value)} /></Field>
        <Field label="Book"><input className="input" value={bookNo} onChange={(e) => setBookNo(e.target.value)} /></Field>
        <Field label="Volume"><input className="input" value={volume} onChange={(e) => setVolume(e.target.value)} /></Field>
        <Field label="Pages"><input className="input" value={pages} onChange={(e) => setPages(e.target.value)} /></Field>
      </Row>
      <Row>
        <Field label="Consideration ₹"><input className="input" type="number" value={consideration} onChange={(e) => setConsideration(e.target.value)} /></Field>
        <Field label="Stamp duty paid ₹"><input className="input" type="number" value={stampDuty} onChange={(e) => setStampDuty(e.target.value)} /></Field>
      </Row>
    </div>
  );
}

// =============================================================================
// Step 3 — Documents examined (DocumentDropzone + suggestions)
// =============================================================================

const DOC_TYPES: SelectOption[] = [
  { value: 'sale_deed',              label: 'Sale Deed' },
  { value: 'gift_deed',              label: 'Gift Deed' },
  { value: 'partition_deed',         label: 'Partition Deed' },
  { value: 'will',                   label: 'Will' },
  { value: 'patta',                  label: 'Patta (TN)' },
  { value: 'chitta',                 label: 'Chitta (TN)' },
  { value: 'adangal',                label: 'Adangal (TN)' },
  { value: 'khata',                  label: 'Khata (KA)' },
  { value: 'rtc',                    label: 'RTC / Pahani' },
  { value: 'seven_twelve',           label: '7/12 (MH)' },
  { value: 'ec',                     label: 'Encumbrance Certificate' },
  { value: 'mutation',               label: 'Mutation' },
  { value: 'dc_conversion',          label: 'DC / Land Conversion' },
  { value: 'building_plan',          label: 'Building Plan Sanction' },
  { value: 'oc',                     label: 'Occupancy Certificate' },
  { value: 'cc',                     label: 'Completion Certificate' },
  { value: 'noc',                    label: 'NOC' },
  { value: 'rera',                   label: 'RERA Registration' },
  { value: 'property_tax_receipt',   label: 'Property Tax Receipt' },
  { value: 'death_certificate',      label: 'Death Certificate' },
  { value: 'legal_heir_certificate', label: 'Legal Heir Certificate' },
  { value: 'family_tree_affidavit',  label: 'Family Tree Affidavit' },
  { value: 'other',                  label: 'Other' },
];

function DocumentsStep({ report }: { report: TitleReportFull }) {
  const add = useAddDocument(report.id);
  const patch = usePatchDocument(report.id);
  const extract = useExtractDocument(report.id);
  const apply = useApplyTitleReportDocument(report.id);
  const showToast = useUIStore((s) => s.showToast);
  const run = useToastedAction();

  const [docType, setDocType] = useState<TitleReportDocumentType>('sale_deed');
  const [label, setLabel] = useState('');
  const [parties, setParties] = useState('');
  const [date, setDate] = useState('');
  const [regNo, setRegNo] = useState('');
  const [sro, setSro] = useState('');
  const [copyType, setCopyType] = useState<'original' | 'certified' | 'photocopy' | 'notarised_copy'>('photocopy');

  const submit = async () => {
    if (!label.trim()) {
      showToast({ type: 'amber', text: 'Document label is required' });
      return;
    }
    const ok = await run(
      () => add.mutateAsync({
        documentType: docType, documentLabel: label.trim(),
        parties: parties || undefined, documentDate: date || undefined,
        registrationNo: regNo || undefined, sroOffice: sro || undefined,
        copyType,
      }),
      { ok: 'Document added' },
    );
    if (ok) { setLabel(''); setParties(''); setDate(''); setRegNo(''); setSro(''); }
  };

  return (
    <div className="tr-form">
      <Section title="Upload documents for auto-extraction">
        <p className="tr-hint">
          Drop a sale deed, EC, patta/khata, RTC/7-12, building plan, or NOC — the wizard
          uploads it, extracts the key fields (document number, SRO, date, consideration,
          EC transactions, revenue-record references, etc.), summarises what it found, and lets
          you push the extracted data into the right section of the report with one click.
          The AI never overwrites a field you've already typed.
        </p>
        <DocumentDropzone reportId={report.id} />
      </Section>

      <Section title="Or record a document manually">
        <Row>
          <Field label="Document type">
            <Select
              value={docType}
              onChange={(v) => setDocType((v as TitleReportDocumentType) || 'sale_deed')}
              options={DOC_TYPES}
            />
          </Field>
          <Field label="Label"><input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Sale deed dated 12 Apr 1994" /></Field>
          <Field label="Copy type">
            <Select
              value={copyType}
              onChange={(v) => setCopyType((v as typeof copyType) || 'photocopy')}
              options={[
                { value: 'original',       label: 'Original' },
                { value: 'certified',      label: 'Certified copy' },
                { value: 'photocopy',      label: 'Photocopy' },
                { value: 'notarised_copy', label: 'Notarised copy' },
              ]}
            />
          </Field>
        </Row>
        <Row>
          <Field label="Parties"><input className="input" value={parties} onChange={(e) => setParties(e.target.value)} /></Field>
          <Field label="Date"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Registration no."><input className="input" value={regNo} onChange={(e) => setRegNo(e.target.value)} /></Field>
          <Field label="SRO"><input className="input" value={sro} onChange={(e) => setSro(e.target.value)} /></Field>
        </Row>
        <button type="button" className="btn btn-primary" onClick={submit} disabled={!label.trim() || add.isPending}>
          <Icon name="plus" /> Add document
        </button>
      </Section>

      {report.documents.length > 0 && (
        <Section title={`Documents examined (${report.documents.length})`}>
          <ul className="tr-doclist">
            {report.documents.map((d) => (
              <li key={d.id} className="tr-doc">
                <div className="tr-doc__head">
                  <span className="tr-doc__type">{DOC_TYPES.find((o) => o.value === d.documentType)?.label ?? d.documentType}</span>
                  <strong>{d.documentLabel}</strong>
                  {d.copyType ? <span className="tr-doc__copy">{d.copyType.replace('_', ' ')}</span> : null}
                </div>
                <div className="tr-doc__meta">
                  {d.parties ?? '—'} · {d.documentDate ?? '—'} · {d.sroOffice ?? '—'}
                </div>
                {d.extractionStatus === 'done' && Object.keys(d.extractedPayload).length > 0 && (
                  <>
                    {typeof d.extractedPayload._summary === 'string' && d.extractedPayload._summary.trim() && (
                      <div className="tr-doc__exec">
                        {d.extractedPayload._summary as string}
                      </div>
                    )}
                    <div className="tr-doc__summary">
                      <Icon name="check" /> {summariseExtraction(d.documentType, d.extractedPayload)}
                      <ExtractionBadge payload={d.extractedPayload} />
                    </div>
                    <div className="tr-doc__actions">
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={apply.isPending}
                        onClick={async () => {
                          const result = await run(
                            () => apply.mutateAsync(d.id),
                            { fail: 'Could not apply extraction' },
                          );
                          if (result) {
                            const targetLabel =
                              result.applied === 'chain_link' ? 'chain of title'
                              : result.applied === 'encumbrance' ? 'encumbrances'
                              : result.applied === 'property' ? 'property block'
                              : 'report';
                            showToast({
                              type: result.applied === 'none' ? 'amber' : 'sage',
                              text: result.applied === 'none'
                                ? result.message
                                : `${result.message} Open the ${targetLabel} step to review.`,
                            });
                          }
                        }}
                      >
                        <Icon name="arrow" /> {apply.isPending ? 'Applying…' : 'Apply to report'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={extract.isPending}
                        onClick={() => run(() => extract.mutateAsync({ docId: d.id }), { ok: 'Extraction re-run' })}
                      >
                        Re-run extraction
                      </button>
                    </div>
                    <ExtractionSuggestions
                      payload={d.extractedPayload}
                      onAccept={(field, value) => patch.mutateAsync({ docId: d.id, patch: { [field]: value } as Record<string, unknown> })}
                    />
                  </>
                )}
                {d.extractionStatus === 'pending' && (
                  <div className="tr-doc__pending">
                    <span className="tr-spinner" aria-hidden /> Extraction in progress…
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => run(() => extract.mutateAsync({ docId: d.id }), { ok: 'Extraction triggered' })}
                    >
                      Re-run
                    </button>
                  </div>
                )}
                {d.extractionStatus === 'none' && d.storageRef && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => run(() => extract.mutateAsync({ docId: d.id }), { ok: 'Extraction triggered' })}
                  >
                    <Icon name="search" /> Extract this document
                  </button>
                )}
                {d.extractionStatus === 'failed' && (
                  <>
                    <div className="tr-doc__err">Extraction failed{d.extractionError ? `: ${d.extractionError}` : ''}.</div>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => run(() => extract.mutateAsync({ docId: d.id }), { ok: 'Extraction re-run' })}
                    >
                      Try again
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

// =============================================================================
// DocumentDropzone — drag-drop or click to upload PDFs / DOCXs, run the
// existing /api/documents/upload-url presign flow, then POST the document
// row to the title-report. Backend kicks off extraction automatically; the
// document list above re-renders via React Query invalidation.
// =============================================================================

interface UploadState {
  id: string;        // local id for keyed render
  fileName: string;
  fileSize: number;
  fileMime: string;
  /** pending → uploading → creating → done | error */
  phase: 'pending' | 'uploading' | 'creating' | 'done' | 'error';
  progress: number;  // 0..1
  error?: string;
}

const ACCEPTED_MIMES = new Set<string>([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
]);

function inferDocumentTypeFromName(name: string): TitleReportDocumentType {
  const n = name.toLowerCase();
  if (/\b(ec|encumbrance)\b/.test(n)) return 'ec';
  if (/\bpatta\b/.test(n)) return 'patta';
  if (/\bchitta\b/.test(n)) return 'chitta';
  if (/\badangal\b/.test(n)) return 'adangal';
  if (/\bkhata\b/.test(n)) return 'khata';
  if (/\brtc\b|\bpahani\b/.test(n)) return 'rtc';
  if (/\b7[ _-]?12\b|seven[ _-]?twelve/.test(n)) return 'seven_twelve';
  if (/\bmutation\b/.test(n)) return 'mutation';
  if (/sale[ _-]?deed/.test(n)) return 'sale_deed';
  if (/gift[ _-]?deed/.test(n)) return 'gift_deed';
  if (/partition[ _-]?deed/.test(n)) return 'partition_deed';
  if (/\bwill\b|testament/.test(n)) return 'will';
  if (/\brera\b/.test(n)) return 'rera';
  if (/\boc\b|occupancy/.test(n)) return 'oc';
  if (/\bcc\b|completion/.test(n)) return 'cc';
  if (/\bnoc\b|no[- _]?objection/.test(n)) return 'noc';
  if (/building[ _-]?plan/.test(n)) return 'building_plan';
  if (/property[ _-]?tax/.test(n)) return 'property_tax_receipt';
  if (/death[ _-]?certificate/.test(n)) return 'death_certificate';
  if (/legal[ _-]?heir/.test(n)) return 'legal_heir_certificate';
  return 'other';
}

function DocumentDropzone({ reportId }: { reportId: string }) {
  const add = useAddDocument(reportId);
  const showToast = useUIStore((s) => s.showToast);
  const [dragOver, setDragOver] = useState(false);
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [defaultType, setDefaultType] = useState<TitleReportDocumentType | 'auto'>('auto');

  const handleFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    const next: UploadState[] = list.map((f) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${f.name}`,
      fileName: f.name,
      fileSize: f.size,
      fileMime: f.type || 'application/octet-stream',
      phase: 'pending',
      progress: 0,
    }));
    setUploads((cur) => [...cur, ...next]);
    // Run uploads sequentially — keeps the presign + PUT pipeline simple and
    // avoids hammering the storage signer.
    for (let i = 0; i < list.length; i += 1) {
      const file = list[i];
      const state = next[i];
      if (!file || !state) continue;
      if (!ACCEPTED_MIMES.has(state.fileMime) && !state.fileName.match(/\.(pdf|docx|txt|md)$/i)) {
        setUploads((cur) => cur.map((u) => u.id === state.id ? { ...u, phase: 'error', error: 'Unsupported file type' } : u));
        showToast({ type: 'amber', text: `Skipping "${state.fileName}" — only PDF / DOCX / TXT / MD are supported.` });
        continue;
      }
      try {
        // 1. Presign.
        setUploads((cur) => cur.map((u) => u.id === state.id ? { ...u, phase: 'uploading', progress: 0.05 } : u));
        const presign = await apiClient.post<{
          uploadUrl: string; storageKey: string; expiresAt: string; requiredContentType: string;
        }>('/api/documents/upload-url', {
          fileName: state.fileName,
          fileMime: state.fileMime,
          fileSize: state.fileSize,
        }).then((r) => r.data);

        // 2. PUT the bytes. Using fetch so we get a clean binary upload — axios
        //    sometimes munges binary bodies depending on transport.
        const putRes = await fetch(presign.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': presign.requiredContentType },
          body: file,
        });
        if (!putRes.ok) {
          throw new Error(`Upload failed (${putRes.status})`);
        }
        setUploads((cur) => cur.map((u) => u.id === state.id ? { ...u, phase: 'creating', progress: 0.8 } : u));

        // 3. Create the title-report document row pointing at the storage key.
        const docType: TitleReportDocumentType =
          defaultType === 'auto' ? inferDocumentTypeFromName(state.fileName) : defaultType;
        const labelBase = state.fileName.replace(/\.[a-zA-Z0-9]{2,4}$/, '').slice(0, 120);
        await add.mutateAsync({
          documentType: docType,
          documentLabel: labelBase || state.fileName,
          storageRef: presign.storageKey,
          fileName: state.fileName,
          fileMime: state.fileMime,
          fileSize: state.fileSize,
        });
        setUploads((cur) => cur.map((u) => u.id === state.id ? { ...u, phase: 'done', progress: 1 } : u));
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Upload failed';
        setUploads((cur) => cur.map((u) => u.id === state.id ? { ...u, phase: 'error', error: msg } : u));
        showToast({ type: 'vermillion', text: `${state.fileName}: ${msg}` });
      }
    }
    // Final summary toast — `next.length` is the request count; per-file
    // outcomes have already been surfaced via per-row toasts above.
    showToast({ type: 'sage', text: `Uploaded ${next.length} document(s). Extraction is running in the background.` });
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      void handleFiles(e.dataTransfer.files);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-3)', alignItems: 'flex-end' }}>
        <Field label="Document type (applied to dropped files)">
          <Select
            value={defaultType}
            onChange={(v) => setDefaultType(((v as TitleReportDocumentType | 'auto') || 'auto'))}
            options={[{ value: 'auto', label: 'Auto-detect from filename' }, ...DOC_TYPES]}
          />
        </Field>
      </div>
      <div
        className={`tr-dropzone ${dragOver ? 'is-over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files) void handleFiles(e.target.files);
            // Reset so the same file can be re-dropped after edits.
            if (inputRef.current) inputRef.current.value = '';
          }}
        />
        <Icon name="upload" />
        <div className="tr-dropzone__title">Drop documents here, or click to browse</div>
        <div className="tr-dropzone__sub">PDF, DOCX, TXT, MD · multiple files supported</div>
      </div>

      {uploads.length > 0 && (
        <ul className="tr-uploads">
          {uploads.map((u) => (
            <li key={u.id} className={`tr-upload tr-upload--${u.phase}`}>
              <span className="tr-upload__name">{u.fileName}</span>
              <span className="tr-upload__size">{formatBytes(u.fileSize)}</span>
              <span className="tr-upload__phase">
                {u.phase === 'pending'   && 'Waiting…'}
                {u.phase === 'uploading' && 'Uploading…'}
                {u.phase === 'creating'  && 'Recording…'}
                {u.phase === 'done'      && (<><Icon name="check" /> Uploaded</>)}
                {u.phase === 'error'     && (<>Failed: {u.error}</>)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

// Build a one-line summary from the extracted payload, document-type-aware.
// Keeps the wizard readable when the structured object is long.
function summariseExtraction(
  docType: TitleReportDocumentType,
  payload: Record<string, unknown>,
): string {
  const parts: string[] = [];
  const get = (k: string) => {
    const v = payload[k];
    return v == null || v === '' ? null : String(v);
  };
  if (docType === 'ec') {
    if (payload.ecForm) parts.push(`EC ${String(payload.ecForm).toUpperCase().replace('_', ' ')}`);
    if (payload.ecOffice) parts.push(String(payload.ecOffice));
    if (payload.ecPeriodFrom || payload.ecPeriodTo) {
      parts.push(`${payload.ecPeriodFrom ?? '?'} → ${payload.ecPeriodTo ?? '?'}`);
    }
    if (Array.isArray(payload.transactions)) {
      parts.push(`${(payload.transactions as unknown[]).length} transaction(s) detected`);
    }
  } else if (docType === 'sale_deed' || docType === 'gift_deed' || docType === 'partition_deed' || docType === 'will') {
    const ref: string[] = [];
    if (get('documentNo')) ref.push(`Doc. ${get('documentNo')}`);
    if (get('sroOffice')) ref.push(get('sroOffice')!);
    if (get('bookNo')) ref.push(`Book ${get('bookNo')}`);
    if (get('volumeNo')) ref.push(`Vol. ${get('volumeNo')}`);
    if (get('pages')) ref.push(`Pp. ${get('pages')}`);
    if (ref.length > 0) parts.push(ref.join(', '));
    if (get('documentDate')) parts.push(`dated ${get('documentDate')}`);
    if (typeof payload.consideration === 'number') parts.push(`₹ ${payload.consideration.toLocaleString('en-IN')} consideration`);
    if (typeof payload.stampDutyPaid === 'number') parts.push(`stamp ₹ ${payload.stampDutyPaid.toLocaleString('en-IN')}`);
  } else {
    for (const [k, v] of Object.entries(payload)) {
      if (k.startsWith('_')) continue;
      if (v == null || v === '') continue;
      if (Array.isArray(v)) continue;
      parts.push(`${k.replace(/_/g, ' ')}: ${String(v)}`);
      if (parts.length >= 4) break;
    }
  }
  return parts.length > 0 ? parts.join(' · ') : 'Fields extracted — review below.';
}

/** Show a small badge indicating whether the extraction came from the LLM
 *  ("AI"), the regex heuristic ("Heuristic"), or both ("AI + heuristic").
 *  The `_extractedBy` and `_modelUsed` keys are stamped onto the payload by
 *  title-reports.extract.service.ts. */
function ExtractionBadge({ payload }: { payload: Record<string, unknown> }) {
  const source = typeof payload._extractedBy === 'string' ? (payload._extractedBy as string) : 'heuristic';
  const model = typeof payload._modelUsed === 'string' ? (payload._modelUsed as string) : '';
  if (source === 'ai') {
    return <span className="tr-extract-badge tr-extract-badge--ai" title={`Extracted by ${model}`}>AI</span>;
  }
  if (source === 'merged') {
    return <span className="tr-extract-badge tr-extract-badge--ai" title={`Extracted by ${model} + heuristic`}>AI + heuristic</span>;
  }
  return <span className="tr-extract-badge tr-extract-badge--heur" title="Regex heuristic (no AI provider configured)">Heuristic</span>;
}

function ExtractionSuggestions({
  payload, onAccept,
}: { payload: Record<string, unknown>; onAccept: (field: string, value: unknown) => Promise<unknown> }) {
  const fields = Object.entries(payload).filter(([k]) => !k.startsWith('_'));
  if (fields.length === 0) return null;
  const conf = typeof payload._confidence === 'number' ? Math.round((payload._confidence as number) * 100) : null;
  return (
    <div className="tr-suggestions">
      <div className="tr-suggestions__head">
        Extracted suggestions {conf !== null ? `· ${conf}% confidence` : ''}
      </div>
      <ul>
        {fields.map(([k, v]) => (
          <li key={k}>
            <span className="tr-sug__key">{k}</span>
            <span className="tr-sug__val">{String(v)}</span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => onAccept(k, v)}
            >
              Accept
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// =============================================================================
// Step 4 — Searches
// =============================================================================

const SEARCH_TYPES: SelectOption[] = [
  { value: 'sro',             label: 'Sub-Registrar Office (SRO)' },
  { value: 'revenue',         label: 'Revenue records' },
  { value: 'municipal',       label: 'Municipal records' },
  { value: 'litigation_hc',   label: 'High Court litigation' },
  { value: 'litigation_dc',   label: 'District Court litigation' },
  { value: 'litigation_drt',  label: 'DRT' },
  { value: 'litigation_nclt', label: 'NCLT' },
  { value: 'gst',             label: 'GST' },
  { value: 'ibbi',            label: 'IBBI' },
  { value: 'mca',             label: 'MCA' },
  { value: 'attachment',      label: 'Attachment orders' },
  { value: 'other',           label: 'Other' },
];

function SearchesStep({ report }: { report: TitleReportFull }) {
  const add = useAddSearch(report.id);
  const showToast = useUIStore((s) => s.showToast);
  const run = useToastedAction();
  const [type, setType] = useState<TitleReportSearchType>('sro');
  const [office, setOffice] = useState('');
  const [query, setQuery] = useState('');
  const [date, setDate] = useState('');
  const [summary, setSummary] = useState('');
  const [negative, setNegative] = useState(false);

  const submit = async () => {
    if (!query.trim() && !summary.trim() && !office.trim()) {
      showToast({ type: 'amber', text: 'Fill at least the office, query, or result summary' });
      return;
    }
    const ok = await run(
      () => add.mutateAsync({
        searchType: type, searchOffice: office || undefined,
        searchQuery: query || undefined, searchDate: date || undefined,
        resultSummary: summary || undefined, resultNegative: negative,
      }),
      { ok: 'Search logged' },
    );
    if (ok) { setQuery(''); setSummary(''); setNegative(false); setOffice(''); }
  };

  return (
    <div className="tr-form">
      <Section title="Log a search">
        <Row>
          <Field label="Search type">
            <Select
              value={type}
              onChange={(v) => setType((v as TitleReportSearchType) || 'sro')}
              options={SEARCH_TYPES}
            />
          </Field>
          <Field label="Office"><input className="input" value={office} onChange={(e) => setOffice(e.target.value)} /></Field>
          <Field label="Date"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </Row>
        <Row>
          <Field label="Search query"><input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="By name / by property / period…" /></Field>
        </Row>
        <Field label="Result summary">
          <textarea className="input" rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} />
        </Field>
        <label className="tr-checkbox">
          <input type="checkbox" checked={negative} onChange={(e) => setNegative(e.target.checked)} />
          <span>Search returned no adverse hits</span>
        </label>
        <button type="button" className="btn btn-primary" onClick={submit}>
          <Icon name="plus" /> Add search log
        </button>
      </Section>

      {report.searches.length > 0 && (
        <Section title={`Searches logged (${report.searches.length})`}>
          <ul className="tr-list">
            {report.searches.map((s) => (
              <li key={s.id} className="tr-list__item">
                <strong>{SEARCH_TYPES.find((o) => o.value === s.searchType)?.label ?? s.searchType}</strong>
                {s.searchOffice ? <span> · {s.searchOffice}</span> : null}
                {s.searchDate ? <span> · {s.searchDate}</span> : null}
                {s.resultNegative && <span className="badge badge--sage">No adverse hits</span>}
                {s.resultSummary ? <div className="tr-list__sub">{s.resultSummary}</div> : null}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

// =============================================================================
// Step 5 — Encumbrances + Litigation + Statutory approvals
// =============================================================================

function EncumbrancesAndLitigationStep({ report }: { report: TitleReportFull }) {
  const addEnc = useAddEncumbrance(report.id);
  const patchEnc = usePatchEncumbrance(report.id);
  const delEnc = useDeleteEncumbrance(report.id);
  const addLit = useAddLitigation(report.id);
  const delLit = useDeleteLitigation(report.id);
  const run = useToastedAction();

  return (
    <div className="tr-form">
      <Section title="Encumbrance Certificate transactions">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => run(() => addEnc.mutateAsync({}), { ok: 'EC row added' })}
        >
          <Icon name="plus" /> Add EC row
        </button>
        {report.encumbrances.length > 0 && (
          <ul className="tr-encs">
            {report.encumbrances.map((e) => (
              <EncumbranceRow
                key={e.id}
                row={e}
                onSave={(patch) => patchEnc.mutateAsync({ encId: e.id, patch })}
                onDelete={() => delEnc.mutateAsync(e.id)}
              />
            ))}
          </ul>
        )}
      </Section>

      <LitigationSubSection report={report} addLit={addLit} delLit={delLit} />
      <ApprovalsSubSection report={report} />
    </div>
  );
}

interface EncRowProps {
  row: TitleReportFull['encumbrances'][number];
  onSave: (patch: Record<string, unknown>) => Promise<unknown>;
  onDelete: () => Promise<unknown>;
}

function EncumbranceRow({ row, onSave, onDelete }: EncRowProps) {
  const [tn, setTn] = useState(row.transactionNo ?? '');
  const [td, setTd] = useState(row.transactionDate ?? '');
  const [tt, setTt] = useState(row.transactionType ?? '');
  const [parties, setParties] = useState(row.parties ?? '');
  const [status, setStatus] = useState<TitleReportEncumbranceStatus>(row.status);
  const [ecForm, setEcForm] = useState(row.ecForm ?? '');
  const [office, setOffice] = useState(row.ecOffice ?? '');
  const [discharge, setDischarge] = useState(row.dischargeDocRef ?? '');

  const save = useDebouncedCallback(async () => {
    await onSave({
      transactionNo: tn || undefined,
      transactionDate: td || undefined,
      transactionType: tt || undefined,
      parties: parties || undefined,
      status,
      ecForm: ecForm || undefined,
      ecOffice: office || undefined,
      dischargeDocRef: discharge || undefined,
    });
  }, 500);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- debounced callback is stable
  useEffect(() => { save(); }, [tn, td, tt, parties, status, ecForm, office, discharge]);

  return (
    <li className={`tr-enc tr-enc--${status}`}>
      <Row>
        <Field label="Transaction #"><input className="input" value={tn} onChange={(e) => setTn(e.target.value)} /></Field>
        <Field label="Date"><input className="input" type="date" value={td} onChange={(e) => setTd(e.target.value)} /></Field>
        <Field label="Type"><input className="input" value={tt} onChange={(e) => setTt(e.target.value)} placeholder="Sale / Mortgage / Release" /></Field>
        <Field label="Status">
          <Select
            value={status}
            onChange={(v) => setStatus((v as TitleReportEncumbranceStatus) || 'subsisting')}
            options={[
              { value: 'subsisting', label: 'Subsisting' },
              { value: 'discharged', label: 'Discharged' },
            ]}
          />
        </Field>
        <button type="button" className="icon-btn" onClick={() => onDelete()} aria-label="Delete">
          <Icon name="trash" />
        </button>
      </Row>
      <Row>
        <Field label="Parties"><input className="input" value={parties} onChange={(e) => setParties(e.target.value)} /></Field>
        <Field label="EC form">
          <Select
            value={ecForm}
            onChange={(v) => setEcForm((v as string) || '')}
            options={[
              { value: '',        label: '(not specified)' },
              { value: 'form_15', label: 'Form 15' },
              { value: 'form_16', label: 'Form 16' },
            ]}
          />
        </Field>
        <Field label="EC office"><input className="input" value={office} onChange={(e) => setOffice(e.target.value)} /></Field>
        <Field label="Discharge doc ref"><input className="input" value={discharge} onChange={(e) => setDischarge(e.target.value)} /></Field>
      </Row>
    </li>
  );
}

function LitigationSubSection({
  report, addLit, delLit,
}: {
  report: TitleReportFull;
  addLit: ReturnType<typeof useAddLitigation>;
  delLit: ReturnType<typeof useDeleteLitigation>;
}) {
  const showToast = useUIStore((s) => s.showToast);
  const run = useToastedAction();
  const [court, setCourt] = useState('');
  const [caseNumber, setCaseNumber] = useState('');
  const [parties, setParties] = useState('');
  const [stage, setStage] = useState('');
  const [relevance, setRelevance] = useState<TitleReportLitigationRelevance>('none');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const remove = async (litId: string) => {
    setPendingDeleteId(litId);
    try {
      await run(() => delLit.mutateAsync(litId), { ok: 'Litigation removed' });
    } finally {
      setPendingDeleteId(null);
    }
  };

  const submit = async () => {
    if (!court && !caseNumber && !parties) {
      showToast({ type: 'amber', text: 'Fill at least the court, case number, or parties' });
      return;
    }
    const ok = await run(
      () => addLit.mutateAsync({
        court: court || undefined, caseNumber: caseNumber || undefined,
        parties: parties || undefined, stage: stage || undefined, relevance,
      }),
      { ok: 'Litigation added' },
    );
    if (ok) { setCourt(''); setCaseNumber(''); setParties(''); setStage(''); setRelevance('none'); }
  };

  return (
    <Section title="Litigation">
      <Row>
        <Field label="Court"><input className="input" value={court} onChange={(e) => setCourt(e.target.value)} placeholder="e.g. Madras High Court" /></Field>
        <Field label="Case number"><input className="input" value={caseNumber} onChange={(e) => setCaseNumber(e.target.value)} /></Field>
        <Field label="Stage"><input className="input" value={stage} onChange={(e) => setStage(e.target.value)} /></Field>
        <Field label="Relevance">
          <Select
            value={relevance}
            onChange={(v) => setRelevance((v as TitleReportLitigationRelevance) || 'none')}
            options={[
              { value: 'direct',   label: 'Direct (lis pendens)' },
              { value: 'indirect', label: 'Indirect' },
              { value: 'none',     label: 'None' },
            ]}
          />
        </Field>
      </Row>
      <Field label="Parties / cause of action">
        <textarea className="input" rows={2} value={parties} onChange={(e) => setParties(e.target.value)} />
      </Field>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={submit}
        disabled={addLit.isPending}
      >
        <Icon name="plus" /> {addLit.isPending ? 'Adding…' : 'Add litigation'}
      </button>

      {report.litigation.length > 0 && (
        <ul className="tr-list" style={{ marginTop: 'var(--space-3)' }}>
          {report.litigation.map((l) => (
            <li key={l.id} className="tr-list__item">
              <div style={{ flex: 1 }}>
                <strong>{l.court ?? '(unspecified court)'}</strong>
                {l.caseNumber ? <span> · {l.caseNumber}</span> : null}
                {l.relevance === 'direct' && <span className="badge badge--vermillion">Direct</span>}
                <div className="tr-list__sub">{l.parties}</div>
              </div>
              <button
                type="button"
                className="icon-btn"
                onClick={() => remove(l.id)}
                disabled={pendingDeleteId === l.id}
                aria-label="Remove litigation"
              >
                <Icon name={pendingDeleteId === l.id ? 'flag' : 'trash'} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function ApprovalsSubSection({ report }: { report: TitleReportFull }) {
  const addAp = useAddApproval(report.id);
  const delAp = useDeleteApproval(report.id);
  const run = useToastedAction();
  const [type, setType] = useState<TitleReportApprovalType>('rera');
  const [authority, setAuthority] = useState('');
  const [refNo, setRefNo] = useState('');
  const [status, setStatus] = useState<TitleReportApprovalStatus>('valid');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const submit = async () => {
    const ok = await run(
      () => addAp.mutateAsync({
        approvalType: type, authority: authority || undefined, referenceNo: refNo || undefined, status,
      }),
      { ok: 'Approval added' },
    );
    if (ok) { setAuthority(''); setRefNo(''); }
  };

  const remove = async (apId: string) => {
    setPendingDeleteId(apId);
    try {
      await run(() => delAp.mutateAsync(apId), { ok: 'Approval removed' });
    } finally {
      setPendingDeleteId(null);
    }
  };

  return (
    <Section title="Statutory approvals">
      <Row>
        <Field label="Approval type">
          <Select
            value={type}
            onChange={(v) => setType((v as TitleReportApprovalType) || 'rera')}
            options={[
              { value: 'rera',           label: 'RERA' },
              { value: 'building_plan',  label: 'Building plan' },
              { value: 'layout',         label: 'Layout approval' },
              { value: 'oc',             label: 'Occupancy Certificate' },
              { value: 'cc',             label: 'Completion Certificate' },
              { value: 'fire_noc',       label: 'Fire NOC' },
              { value: 'pollution_noc',  label: 'Pollution NOC' },
              { value: 'aai_noc',        label: 'AAI Height NOC' },
              { value: 'environment',    label: 'Environment NOC' },
              { value: 'dc_conversion',  label: 'DC / Land Conversion' },
              { value: 'khata_transfer', label: 'Khata transfer' },
              { value: 'other',          label: 'Other' },
            ]}
          />
        </Field>
        <Field label="Authority"><input className="input" value={authority} onChange={(e) => setAuthority(e.target.value)} /></Field>
        <Field label="Reference no."><input className="input" value={refNo} onChange={(e) => setRefNo(e.target.value)} /></Field>
        <Field label="Status">
          <Select
            value={status}
            onChange={(v) => setStatus((v as TitleReportApprovalStatus) || 'valid')}
            options={[
              { value: 'valid',          label: 'Valid' },
              { value: 'expired',        label: 'Expired' },
              { value: 'not_obtained',   label: 'Not obtained' },
              { value: 'not_applicable', label: 'Not applicable' },
            ]}
          />
        </Field>
      </Row>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={submit}
        disabled={addAp.isPending}
      >
        <Icon name="plus" /> {addAp.isPending ? 'Adding…' : 'Add approval'}
      </button>

      {report.approvals.length > 0 && (
        <ul className="tr-list" style={{ marginTop: 'var(--space-3)' }}>
          {report.approvals.map((a) => {
            const removing = pendingDeleteId === a.id;
            return (
              <li key={a.id} className="tr-list__item" style={{ opacity: removing ? 0.5 : 1 }}>
                <strong>{a.approvalType.toUpperCase().replace(/_/g, ' ')}</strong>
                {a.authority ? <span> · {a.authority}</span> : null}
                {a.referenceNo ? <span> · {a.referenceNo}</span> : null}
                <span className={`badge badge--${a.status}`}>{a.status.replace('_', ' ')}</span>
                <button
                  type="button"
                  className="icon-btn"
                  style={{ marginLeft: 'auto' }}
                  onClick={() => {
                    if (window.confirm(`Remove the ${a.approvalType.replace(/_/g, ' ')} approval?`)) {
                      void remove(a.id);
                    }
                  }}
                  disabled={removing}
                  aria-label="Remove approval"
                  title="Remove approval"
                >
                  <Icon name="trash" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

// =============================================================================
// Step 6 — Defects + Opinion (AI-driven)
// =============================================================================

function DefectsAndOpinionStep({ report }: { report: TitleReportFull }) {
  const runAi = useRunAiAnalysis(report.id);
  const synth = useSynthesiseOpinion(report.id);
  const ack = useApplyDefectAck(report.id);
  const addDefect = useAddDefect(report.id);

  const [runId, setRunId] = useState<string | null>(null);
  const aiRun = useTitleReportAiRun(report.id, runId);

  const startAnalysis = async () => {
    const out = await runAi.mutateAsync({ force: true });
    setRunId(out.runId);
  };

  return (
    <div className="tr-defop">
      <section className="tr-defects">
        <div className="tr-defects__head">
          <h3>Defects {report.defects.length > 0 ? `(${report.defects.length})` : ''}</h3>
          <button type="button" className="btn btn-primary" onClick={startAnalysis} disabled={runAi.isPending}>
            <Icon name="search" /> {runAi.isPending ? 'Analysing…' : 'Run AI analysis'}
          </button>
        </div>
        {runId && aiRun.data && aiRun.data.status !== 'done' && (
          <div className="tr-defects__progress">AI is reviewing the tree… (status: {aiRun.data.status})</div>
        )}
        <DefectsPanel
          defects={report.defects}
          onAck={(defectId) => ack.mutateAsync({ defectId, body: { action: 'ack' } })}
          onDismiss={(defectId, reason) => ack.mutateAsync({ defectId, body: { action: 'dismiss', reason } })}
        />
        <ManualDefectForm onAdd={(body) => addDefect.mutateAsync(body)} />
      </section>

      <section className="tr-opinion">
        <div className="tr-opinion__head">
          <h3>Opinion</h3>
          <button type="button" className="btn btn-secondary" onClick={() => synth.mutateAsync()} disabled={synth.isPending}>
            <Icon name="edit" /> {synth.isPending ? 'Synthesising…' : 'Synthesise opinion'}
          </button>
        </div>
        <OpinionEditor report={report} />
      </section>
    </div>
  );
}

interface DefectsPanelProps {
  defects: TitleReportDefect[];
  onAck: (defectId: string) => Promise<unknown>;
  onDismiss: (defectId: string, reason: string) => Promise<unknown>;
}

function DefectsPanel({ defects, onAck, onDismiss }: DefectsPanelProps) {
  if (defects.length === 0) {
    return <div className="tr-empty tr-empty--inline">No defects flagged yet. Run AI analysis or add one manually.</div>;
  }
  const grouped: Record<TitleReportDefectSeverity, TitleReportDefect[]> = {
    blocker: defects.filter((d) => d.severity === 'blocker'),
    warning: defects.filter((d) => d.severity === 'warning'),
    info:    defects.filter((d) => d.severity === 'info'),
  };
  return (
    <div className="tr-deflist">
      {(['blocker', 'warning', 'info'] as const).map((sev) => grouped[sev].length > 0 && (
        <div key={sev} className={`tr-defgroup tr-defgroup--${sev}`}>
          <div className="tr-defgroup__head">{sev}</div>
          <ul>
            {grouped[sev].map((d) => (
              <li key={d.id} className={`tr-defect ${d.dismissed ? 'is-dismissed' : ''} ${d.acknowledgedAt ? 'is-ack' : ''}`}>
                <div className="tr-defect__cat">{d.category.replace(/_/g, ' ')}</div>
                <div className="tr-defect__desc">{d.description}</div>
                {d.recommendation && <div className="tr-defect__rec"><strong>Recommend:</strong> {d.recommendation}</div>}
                <div className="tr-defect__actions">
                  {!d.dismissed && !d.acknowledgedAt && (
                    <>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => onAck(d.id)}>
                        Acknowledge
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          const r = window.prompt('Dismissal reason (will be audit-logged):');
                          if (r) onDismiss(d.id, r);
                        }}
                      >
                        Dismiss
                      </button>
                    </>
                  )}
                  {d.acknowledgedAt && <span className="tr-defect__tag">Acknowledged</span>}
                  {d.dismissed && <span className="tr-defect__tag">Dismissed</span>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function ManualDefectForm({ onAdd }: { onAdd: (body: { category: TitleReportDefectCategory; severity: TitleReportDefectSeverity; description: string; recommendation?: string }) => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<TitleReportDefectCategory>('other');
  const [severity, setSeverity] = useState<TitleReportDefectSeverity>('warning');
  const [description, setDescription] = useState('');
  const [recommendation, setRecommendation] = useState('');

  if (!open) {
    return (
      <button type="button" className="btn btn-ghost" onClick={() => setOpen(true)}>
        <Icon name="plus" /> Add manual defect
      </button>
    );
  }
  return (
    <div className="tr-mandef">
      <Row>
        <Field label="Category">
          <Select
            value={category}
            onChange={(v) => setCategory((v as TitleReportDefectCategory) || 'other')}
            options={[
              { value: 'chain_gap',              label: 'Chain gap' },
              { value: 'unregistered_link',      label: 'Unregistered link' },
              { value: 'stamp_duty',             label: 'Stamp duty' },
              { value: 'extent_mismatch',        label: 'Extent mismatch' },
              { value: 'subsisting_encumbrance', label: 'Subsisting encumbrance' },
              { value: 'pending_litigation',     label: 'Pending litigation' },
              { value: 'missing_noc',            label: 'Missing NOC' },
              { value: 'approval_lapsed',        label: 'Approval lapsed' },
              { value: 'inheritance_gap',        label: 'Inheritance gap' },
              { value: 'other',                  label: 'Other' },
            ]}
          />
        </Field>
        <Field label="Severity">
          <Select
            value={severity}
            onChange={(v) => setSeverity((v as TitleReportDefectSeverity) || 'warning')}
            options={[
              { value: 'info',    label: 'Info' },
              { value: 'warning', label: 'Warning' },
              { value: 'blocker', label: 'Blocker' },
            ]}
          />
        </Field>
      </Row>
      <Field label="Description"><textarea className="input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <Field label="Recommendation"><textarea className="input" rows={2} value={recommendation} onChange={(e) => setRecommendation(e.target.value)} /></Field>
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!description.trim()}
          onClick={async () => {
            await onAdd({ category, severity, description, recommendation: recommendation || undefined });
            setDescription(''); setRecommendation(''); setOpen(false);
          }}
        >
          Add defect
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}

function OpinionEditor({ report }: { report: TitleReportFull }) {
  const update = useUpdateTitleReport(report.id);
  const [verdict, setVerdict] = useState(report.opinionVerdict);
  const [summary, setSummary] = useState(report.opinionSummary ?? '');

  useEffect(() => { setVerdict(report.opinionVerdict); }, [report.opinionVerdict]);
  useEffect(() => { setSummary(report.opinionSummary ?? ''); }, [report.opinionSummary]);

  const save = useDebouncedCallback(async () => {
    await update.mutateAsync({ opinionVerdict: verdict, opinionSummary: summary || null });
  }, 600);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- debounced callback is stable
  useEffect(() => { save(); }, [verdict, summary]);

  return (
    <>
      <Field label="Verdict">
        <Select
          value={verdict}
          onChange={(v) => setVerdict((v as typeof verdict) || 'pending')}
          options={[
            { value: 'pending',               label: 'Pending' },
            { value: 'clear',                 label: 'Clear and marketable' },
            { value: 'clear_with_conditions', label: 'Clear with conditions' },
            { value: 'not_clear',             label: 'Not clear' },
          ]}
        />
      </Field>
      <Field label="Opinion summary (renders on the cover page)">
        <textarea className="input" rows={10} value={summary} onChange={(e) => setSummary(e.target.value)} />
      </Field>
    </>
  );
}

// =============================================================================
// Step 7 — Preview + Export
// =============================================================================

function PreviewStep({
  report, onTransition,
}: { report: TitleReportFull; onTransition: (to: TitleReportStatus) => void }) {
  const recordExport = useRecordTitleReportExport(report.id);
  const showToast = useUIStore((s) => s.showToast);
  const previewRef = useRef<HTMLDivElement | null>(null);

  const onExport = async () => {
    try {
      // PDF is laid out directly with jsPDF text primitives (formal Indian
      // TIR template). The on-screen preview is still useful for the
      // advocate to eyeball before exporting, but it's no longer captured
      // as a raster — see lib/title-report-pdf.ts.
      const blob = await exportTitleReportPdf(report, `title-report-${report.reportNumber.replace(/[/]/g, '-')}.pdf`);
      await recordExport.mutateAsync({
        format: 'pdf',
        fileName: `title-report-${report.reportNumber.replace(/[/]/g, '-')}.pdf`,
        fileMime: 'application/pdf',
        fileSize: blob.size,
      });
      showToast({ type: 'sage', text: 'PDF exported' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Export failed';
      showToast({ type: 'vermillion', text: msg });
    }
  };

  return (
    <div className="tr-preview-wrap">
      <div className="tr-preview-actions">
        <button type="button" className="btn btn-primary" onClick={onExport} disabled={recordExport.isPending}>
          <Icon name="download" /> Generate PDF
        </button>
        {report.status === 'in_review' && (
          <button type="button" className="btn btn-secondary" onClick={() => onTransition('finalised')}>
            Mark as finalised
          </button>
        )}
        {report.status === 'finalised' && (
          <button type="button" className="btn btn-secondary" onClick={() => onTransition('issued')}>
            Mark as issued
          </button>
        )}
      </div>
      <article ref={previewRef} className="tr-preview" role="document">
        <PreviewBody report={report} />
      </article>
    </div>
  );
}

function PreviewBody({ report }: { report: TitleReportFull }) {
  const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  return (
    <>
      <header className="tr-preview__head">
        <h1>Title Investigation Report</h1>
        <div className="tr-preview__sub">
          Report No. {report.reportNumber} · Dated {today}
        </div>
        <div className="tr-preview__bank">
          Addressed to {report.bankName ?? '(applicant)'}{report.bankBranch ? `, ${report.bankBranch}` : ''}
        </div>
      </header>

      <section className="tr-preview__sec">
        <h2>1. Schedule of Property (Schedule A)</h2>
        <p>{report.property?.scheduleA ?? report.property?.address ?? '(not provided)'}</p>
        {report.property && (
          <p>
            <strong>Survey:</strong> {report.property.surveyNo ?? '—'} ·{' '}
            <strong>Sub-division:</strong> {report.property.subDivision ?? '—'} ·{' '}
            <strong>Extent:</strong> {report.property.extentValue ?? '—'} {report.property.extentUnit ?? ''} ·{' '}
            <strong>Boundaries:</strong> N: {report.property.boundaryNorth ?? '—'}, S: {report.property.boundarySouth ?? '—'},
            E: {report.property.boundaryEast ?? '—'}, W: {report.property.boundaryWest ?? '—'}
          </p>
        )}
      </section>

      <section className="tr-preview__sec">
        <h2>2. Documents examined</h2>
        <table className="tr-preview__table">
          <thead><tr><th>Sl.</th><th>Type</th><th>Parties</th><th>Date</th><th>Reg. no.</th><th>Copy</th></tr></thead>
          <tbody>
            {report.documents.map((d, i) => (
              <tr key={d.id}>
                <td>{i + 1}</td>
                <td>{DOC_TYPES.find((o) => o.value === d.documentType)?.label ?? d.documentType}</td>
                <td>{d.parties ?? '—'}</td>
                <td>{d.documentDate ?? '—'}</td>
                <td>{d.registrationNo ?? '—'}</td>
                <td>{d.copyType ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="tr-preview__sec">
        <h2>3. Chain of title</h2>
        <table className="tr-preview__table">
          <thead><tr><th>#</th><th>Type</th><th>From → To</th><th>Date</th><th>Doc no.</th><th>SRO</th></tr></thead>
          <tbody>
            {[...report.chainLinks].sort((a, b) => a.sequenceNo - b.sequenceNo).map((l) => (
              <tr key={l.id}>
                <td>{l.sequenceNo}</td>
                <td>{LINK_TYPES.find((o) => o.value === l.linkType)?.label ?? l.linkType}</td>
                <td>{l.transferor} → {l.transferee}</td>
                <td>{l.documentDate ?? '—'}</td>
                <td>{l.documentNo ?? '—'}</td>
                <td>{l.sroOffice ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="tr-preview__sec">
        <h2>4. Encumbrance Certificate</h2>
        <table className="tr-preview__table">
          <thead><tr><th>Tx no.</th><th>Date</th><th>Type</th><th>Parties</th><th>Status</th></tr></thead>
          <tbody>
            {report.encumbrances.map((e) => (
              <tr key={e.id}>
                <td>{e.transactionNo ?? '—'}</td>
                <td>{e.transactionDate ?? '—'}</td>
                <td>{e.transactionType ?? '—'}</td>
                <td>{e.parties ?? '—'}</td>
                <td>{e.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="tr-preview__sec">
        <h2>5. Searches conducted</h2>
        <ul>
          {report.searches.map((s) => (
            <li key={s.id}>
              <strong>{SEARCH_TYPES.find((o) => o.value === s.searchType)?.label ?? s.searchType}</strong>
              {s.searchOffice ? `, ${s.searchOffice}` : ''}
              {s.searchDate ? ` on ${s.searchDate}` : ''}
              {s.resultNegative ? ' — no adverse hits' : ''}
              {s.resultSummary ? <div>{s.resultSummary}</div> : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="tr-preview__sec">
        <h2>6. Statutory approvals</h2>
        <ul>
          {report.approvals.map((a) => (
            <li key={a.id}>
              <strong>{a.approvalType.toUpperCase()}</strong>: {a.referenceNo ?? '—'} ({a.status.replace('_', ' ')})
            </li>
          ))}
        </ul>
      </section>

      <section className="tr-preview__sec">
        <h2>7. Defects and observations</h2>
        {report.defects.filter((d) => !d.dismissed && d.severity !== 'info').length === 0
          ? <p>No subsisting defects.</p>
          : (
            <ol>
              {report.defects.filter((d) => !d.dismissed && d.severity !== 'info').map((d) => (
                <li key={d.id}>
                  <strong>{d.category.replace(/_/g, ' ')} ({d.severity})</strong>: {d.description}
                  {d.recommendation ? <div><em>Recommendation:</em> {d.recommendation}</div> : null}
                </li>
              ))}
            </ol>
          )}
      </section>

      <section className="tr-preview__sec">
        <h2>8. Opinion on marketability</h2>
        <p><strong>Verdict:</strong> {VERDICT[report.opinionVerdict] ?? report.opinionVerdict}</p>
        <p style={{ whiteSpace: 'pre-wrap' }}>{report.opinionSummary ?? '(opinion not yet recorded)'}</p>
      </section>

      <footer className="tr-preview__foot">
        <div>For LexDraft drafted by the undersigned advocate.</div>
        <div style={{ marginTop: 'var(--space-4)' }}>
          ____________________<br/>
          <em>Advocate</em><br/>
          Bar Council Enrolment No.: ______________<br/>
          Place: __________ &nbsp; Date: {today}
        </div>
      </footer>
    </>
  );
}

const VERDICT: Record<string, string> = {
  pending:                 'Pending',
  clear:                   'Clear and marketable',
  clear_with_conditions:   'Clear, subject to conditions',
  not_clear:               'Not clear',
};

// =============================================================================
// Layout primitives
// =============================================================================

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="tr-section">
      <h3 className="tr-section__title">{title}</h3>
      <div className="tr-section__body">{children}</div>
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="tr-row">{children}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
    </label>
  );
}

// =============================================================================
// Hooks
// =============================================================================

function useDebouncedCallback<T extends (...args: unknown[]) => unknown>(fn: T, delay: number): T {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  return useCallback(((...args: unknown[]) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void fnRef.current(...args); }, delay);
  }) as T, [delay]);
}
