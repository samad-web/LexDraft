import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@lexdraft/ui';
import type { BillingCycle, BillingPlan, BillingPlanId, OnboardingCompleteRequest } from '@lexdraft/types';
import { LogoMark } from '@/components/brand/Logo';
import { SIGNUP_PLANS } from '@/components/PlanCards';
import { useCompleteOnboarding } from '@/hooks/useBilling';
import { useAuthStore } from '@/store/auth';
import { api } from '@/lib/api';
import { indiaStateOptions } from '@/lib/india-states';
import { readIntro } from '@/lib/intro';

// =============================================================================
// /onboarding - shown once, right after a new account is created. Three steps
// on one full page (left: steps, right: content, bottom: Back / Continue):
//   1. Choose a plan   2. Your practice (name, logo, practice areas)
//   3. Verification (ID document, GSTIN, business address)
// api: POST /onboarding/upload, POST /onboarding/complete.
// =============================================================================

type Step = 0 | 1 | 2;
type Kind = 'advocate' | 'student';
type DocType = NonNullable<OnboardingCompleteRequest['idDocumentType']>;

const STEPS: Array<{ title: string; sub: string }> = [
  { title: 'Choose a plan', sub: 'Free for advocates & students' },
  { title: 'Your practice', sub: 'Name, logo and practice areas' },
  { title: 'Verification', sub: 'ID document, GST and address' },
];

const PLAN_ICON: Record<BillingPlanId, Parameters<typeof Icon>[0]['name']> = {
  free: 'draft', solo: 'clients', practice: 'members', firm: 'building',
};

const AREA_GROUPS: Array<{ title: string; areas: string[] }> = [
  { title: 'Civil & property', areas: ['Civil', 'Property', 'Land & Revenue', 'Rent Control', 'Consumer', 'Motor Accident Claims'] },
  { title: 'Criminal', areas: ['Criminal', 'Bail & Anticipatory Bail', 'Cheque Bounce (NI Act)', 'Cyber Crime', 'NDPS'] },
  { title: 'Family', areas: ['Family & Matrimonial', 'Divorce', 'Maintenance', 'Child Custody', 'Succession & Wills'] },
  { title: 'Corporate & commercial', areas: ['Corporate', 'Commercial', 'Arbitration', 'Banking & Finance', 'Insolvency (IBC)', 'Tax & GST', 'Intellectual Property'] },
  { title: 'Public & service', areas: ['Constitutional & Writs', 'Service Matters', 'Labour & Employment', 'Environmental', 'RTI'] },
];

const DOC_TYPES: Record<Kind, Array<{ value: DocType; label: string; numberLabel: string; placeholder: string }>> = {
  advocate: [
    { value: 'bar_council_id', label: 'Bar Council ID card', numberLabel: 'Enrolment number', placeholder: 'MS/1234/2018' },
    { value: 'enrolment_certificate', label: 'Enrolment certificate', numberLabel: 'Enrolment number', placeholder: 'MS/1234/2018' },
    { value: 'pan', label: 'PAN card', numberLabel: 'PAN number', placeholder: 'ABCDE1234F' },
    { value: 'aadhaar', label: 'Aadhaar card', numberLabel: 'Aadhaar number', placeholder: '1234 5678 9012' },
  ],
  student: [
    { value: 'student_id', label: 'College ID card', numberLabel: 'Roll / register number', placeholder: '21LLB045' },
    { value: 'aadhaar', label: 'Aadhaar card', numberLabel: 'Aadhaar number', placeholder: '1234 5678 9012' },
  ],
};

const STUDY_YEARS = ['1st year', '2nd year', '3rd year', '4th year', '5th year', 'LL.M.', 'Graduated'];
const TEAM_SIZES = ['2-3', '4-8'];

function docNumberProblem(type: DocType, raw: string): string | null {
  const v = raw.replace(/\s/g, '').toUpperCase();
  if (!v) return 'Enter your document number';
  if (type === 'pan' && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v)) return 'Enter a valid PAN number';
  if (type === 'aadhaar' && !/^\d{12}$/.test(v)) return 'Enter a valid 12-digit Aadhaar number';
  if (v.length < 4) return 'Enter a valid document number';
  return null;
}

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

const PAGE_CSS = `
.onb { min-height: 100vh; display: grid; grid-template-columns: minmax(300px, 420px) 1fr; background: var(--bg-base); }
.onb-side { background: var(--text-primary); color: var(--bg-base); padding: 40px 44px; display: flex; flex-direction: column; gap: 32px; position: sticky; top: 0; height: 100vh; }
.onb-main { display: flex; flex-direction: column; min-height: 100vh; }
.onb-body { flex: 1; padding: 56px clamp(16px, 5vw, 72px) 40px; max-width: 1120px; width: 100%; }
.onb-foot { position: sticky; bottom: 0; background: var(--bg-base); border-top: 1px solid var(--border-subtle); padding: 16px clamp(16px, 5vw, 72px); display: flex; align-items: center; gap: 16px; }
.onb-step { display: flex; gap: 14px; align-items: flex-start; position: relative; }
.onb-step + .onb-step { margin-top: 30px; }
.onb-step:not(:last-child)::after { content: ''; position: absolute; left: 17px; top: 40px; height: 26px; width: 1px; background: currentColor; opacity: 0.3; }
.onb-dot { width: 36px; height: 36px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-weight: 600; font-size: 14px; flex-shrink: 0; border: 1px solid currentColor; }
.onb-plans { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 14px; margin-top: 28px; }
.onb-plan { position: relative; text-align: left; cursor: pointer; padding: 22px 20px; border-radius: var(--radius-lg); border: 1px solid var(--border-default); background: var(--bg-surface); color: var(--text-primary); display: flex; flex-direction: column; gap: 6px; transition: border-color 150ms, box-shadow 150ms; }
.onb-plan[aria-pressed="true"] { border: 2px solid var(--text-primary); padding: 21px 19px; box-shadow: 0 6px 24px rgba(0,0,0,0.08); }
.onb-chip { padding: 8px 14px; border-radius: var(--radius-full); border: 1px solid var(--border-default); background: var(--bg-surface); color: var(--text-primary); font-size: 13px; font-weight: 500; cursor: pointer; }
.onb-chip[aria-pressed="true"] { background: var(--text-primary); color: var(--bg-base); border-color: var(--text-primary); }
.onb-drop { border: 1px dashed var(--border-strong); border-radius: var(--radius-lg); padding: 28px 16px; display: flex; flex-direction: column; align-items: center; gap: 6px; cursor: pointer; background: var(--bg-surface); text-align: center; width: 100%; color: var(--text-primary); }
.onb-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.onb-grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
@media (max-width: 900px) {
  .onb { grid-template-columns: 1fr; }
  .onb-side { position: static; height: auto; padding: 20px 16px; gap: 16px; }
  .onb-side-extra { display: none !important; }
  .onb-body { padding-top: 28px; }
  .onb-grid-2, .onb-grid-3 { grid-template-columns: 1fr; }
}
`;

function Field({ label, required, hint, children, htmlFor }: { label: string; required?: boolean; hint?: string; htmlFor: string; children: ReactNode }) {
  return (
    <div>
      <label className={`label${required ? ' required' : ''}`} htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <div className="body-xs" style={{ color: 'var(--text-tertiary)', marginTop: 6 }}>{hint}</div>}
    </div>
  );
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(new Error('Could not read the file.'));
    r.readAsDataURL(file);
  });
}

/** Uploads one file to /onboarding/upload and keeps its key. */
function useUpload(kind: 'logo' | 'id') {
  const [state, setState] = useState<{ key?: string; name?: string; preview?: string; busy?: boolean; error?: string }>({});
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setState({ name: file.name, busy: true });
    try {
      const dataBase64 = await toBase64(file);
      const { key } = await api.post<{ key: string }>('/onboarding/upload', { kind, contentType: file.type, dataBase64 });
      setState({ key, name: file.name, preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined });
    } catch (err) {
      setState({ error: (err as Error).message || 'Upload failed. Try again.' });
    }
  };
  return { ...state, pick };
}

function PlanCard({ plan, cycle, selected, popular, onSelect }: { plan: BillingPlan; cycle: BillingCycle; selected: boolean; popular?: boolean; onSelect: () => void }) {
  const monthly = plan.monthlyInr;
  const perMonth = monthly && cycle === 'annual' ? plan.annualMonthlyInr ?? monthly : monthly;
  return (
    <button type="button" className="onb-plan" aria-pressed={selected} onClick={onSelect}>
      {popular && (
        <span className="mono" style={{ position: 'absolute', top: -11, left: '50%', transform: 'translateX(-50%)', background: 'var(--text-primary)', color: 'var(--bg-base)', fontSize: 10, letterSpacing: '0.12em', padding: '3px 10px', borderRadius: 'var(--radius-full)', whiteSpace: 'nowrap' }}>
          ★ POPULAR
        </span>
      )}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <span style={{ width: 40, height: 40, borderRadius: 'var(--radius-md)', background: 'var(--bg-surface-2)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon name={PLAN_ICON[plan.id]} size={18} />
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600 }}>{plan.name}</span>
          <span style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.35 }}>{plan.for}</span>
        </span>
        <span
          aria-hidden
          style={{
            width: 22, height: 22, borderRadius: '50%', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            border: selected ? 0 : '1.5px solid var(--border-strong)',
            background: selected ? 'var(--text-primary)' : 'transparent', color: 'var(--bg-base)',
          }}
        >
          {selected && <Icon name="check" size={12} />}
        </span>
      </div>
      <div style={{ marginTop: 14, display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700 }}>
          {monthly === null ? 'Custom' : monthly === 0 ? 'Free' : inr(perMonth!)}
        </span>
        {!!monthly && <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>/mo</span>}
      </div>
      <span style={{ fontSize: 12, color: 'var(--text-secondary)', minHeight: 18 }}>
        {monthly && plan.annualMonthlyInr
          ? <>{cycle === 'annual' ? '' : 'or '}{inr(plan.annualMonthlyInr * 12)}/yr · <strong style={{ color: 'var(--text-primary)' }}>save {inr((monthly - plan.annualMonthlyInr) * 12)}</strong></>
          : plan.note}
      </span>
      <div style={{ borderTop: '1px solid var(--border-subtle)', margin: '12px 0 4px' }} />
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {plan.features.map((f) => (
          <li key={f} style={{ display: 'flex', gap: 8, fontSize: 13, alignItems: 'flex-start' }}>
            <span style={{ marginTop: 2 }}><Icon name="check" size={12} /></span> <span>{f}</span>
          </li>
        ))}
      </ul>
      {plan.id === 'practice' && (
        <span className="mono" style={{ marginTop: 10, fontSize: 10, color: 'var(--text-secondary)' }}>14-DAY FREE TRIAL · NO CARD</span>
      )}
    </button>
  );
}

export function OnboardingView() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const complete = useCompleteOnboarding();
  const stateOptions = useMemo(() => indiaStateOptions(), []);
  const intro = useMemo(() => readIntro(), []);

  const [step, setStep] = useState<Step>(0);
  const [plan, setPlan] = useState<BillingPlanId>(intro.size === 'team' || intro.size === 'firm' ? 'practice' : 'free');
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const [kind, setKind] = useState<Kind>('advocate');
  // Step 2
  const [firm, setFirm] = useState('');
  const [primaryCourt, setPrimaryCourt] = useState('');
  const [teamSize, setTeamSize] = useState('');
  const [areas, setAreas] = useState<string[]>([]);
  const [areaSearch, setAreaSearch] = useState('');
  const [college, setCollege] = useState('');
  const [studyYear, setStudyYear] = useState('');
  const logo = useUpload('logo');
  const logoInput = useRef<HTMLInputElement>(null);
  // Step 3
  const [docType, setDocType] = useState<DocType>('bar_council_id');
  const [docNumber, setDocNumber] = useState('');
  const idDoc = useUpload('id');
  const idInput = useRef<HTMLInputElement>(null);
  const [gstin, setGstin] = useState('');
  const [addressLine, setAddressLine] = useState('');
  const [city, setCity] = useState('');
  const [stateName, setStateName] = useState('');
  const [pincode, setPincode] = useState('');

  const student = plan === 'free' && kind === 'student';
  const practice = plan === 'practice';
  const docOptions = DOC_TYPES[student ? 'student' : 'advocate'];
  const doc = docOptions.find((d) => d.value === docType) ?? docOptions[0]!;

  const problem =
    step === 1 ? (practice && !firm.trim() ? 'Enter your firm name'
      : student && !college.trim() ? 'Enter your college or university' : null)
    : step === 2 ? (docNumberProblem(doc.value, docNumber)
      ?? (gstin.trim() && !/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/.test(gstin.trim().toUpperCase()) ? 'Enter a valid GSTIN or leave it empty' : null)
      ?? (pincode.trim() && !/^\d{6}$/.test(pincode.trim()) ? 'Enter a valid 6-digit pincode' : null)
      ?? (idDoc.busy || logo.busy ? 'Uploading…' : null))
    : null;

  const toggleArea = (a: string) => setAreas((cur) => (cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a]));
  const q = areaSearch.trim().toLowerCase();

  const finish = () => {
    if (plan === 'firm') return;
    complete.mutate(
      {
        plan,
        cycle: plan === 'free' ? undefined : cycle,
        kind: plan === 'free' ? kind : undefined,
        firm: student ? undefined : firm.trim() || undefined,
        primaryCourt: student ? undefined : primaryCourt.trim() || undefined,
        practiceAreas: areas.length ? areas.join(', ') : undefined,
        teamSize: practice ? teamSize || undefined : undefined,
        college: student ? college.trim() || undefined : undefined,
        studyYear: student ? studyYear || undefined : undefined,
        logoKey: logo.key,
        idDocumentType: doc.value,
        idDocumentNumber: docNumber.replace(/\s/g, '').toUpperCase() || undefined,
        idDocumentKey: idDoc.key,
        gstin: student ? undefined : gstin.trim().toUpperCase() || undefined,
        addressLine: addressLine.trim() || undefined,
        city: city.trim() || undefined,
        state: stateName || undefined,
        pincode: pincode.trim() || undefined,
      },
      {
        onSuccess: (r) => {
          if (r.checkoutUrl) { window.location.assign(r.checkoutUrl); return; }
          navigate(r.checkoutError ? '/app/billing' : '/app/dashboard', { replace: true });
        },
      },
    );
  };

  const next = () => {
    if (problem) return;
    if (step === 0 && plan === 'firm') { navigate('/signup?intent=demo'); return; }
    if (step === 0) setDocType(student ? 'student_id' : 'bar_council_id');
    if (step < 2) { setStep((step + 1) as Step); window.scrollTo({ top: 0 }); }
    else finish();
  };

  const finishLabel = plan === 'solo' ? 'Continue to payment' : student ? 'Create my account' : 'Create my practice';

  return (
    <div className="onb">
      <style>{PAGE_CSS}</style>
      <aside className="onb-side">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <LogoMark size={40} ink="var(--bg-base)" paper="var(--text-primary)" />
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600 }}>DifAI</span>
        </div>
        <div className="onb-side-extra" style={{ marginTop: 28 }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 700, margin: 0, lineHeight: 1.15 }}>Set up your practice</h2>
          <p style={{ fontSize: 15, opacity: 0.75, marginTop: 12, lineHeight: 1.55 }}>
            Three quick steps, about 3 minutes. You can change everything later in Settings.
          </p>
        </div>
        <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {STEPS.map((s, i) => {
            const done = i < step;
            const active = i === step;
            return (
              <li key={s.title} className="onb-step" style={{ opacity: active || done ? 1 : 0.6 }}>
                <span
                  className="onb-dot"
                  style={done || active ? { background: 'var(--bg-base)', color: 'var(--text-primary)', borderColor: 'var(--bg-base)', boxShadow: active ? '0 0 0 4px rgba(255,255,255,0.18)' : undefined } : undefined}
                >
                  {done ? <Icon name="check" size={16} /> : i + 1}
                </span>
                <span>
                  <span style={{ display: 'block', fontWeight: 600, fontSize: 16 }}>{s.title}</span>
                  <span style={{ display: 'block', fontSize: 13, opacity: 0.7, marginTop: 3 }}>{s.sub}</span>
                </span>
              </li>
            );
          })}
        </ol>
        <ul className="onb-side-extra" style={{ listStyle: 'none', margin: 'auto 0 0', padding: '22px 0 0', borderTop: '1px solid rgba(127,127,127,0.35)', display: 'flex', flexDirection: 'column', gap: 16, fontSize: 14 }}>
          {([['sparkle', 'Free for advocates & law students till 1 June 2027.'], ['shield', 'Your cases and client data are encrypted.'], ['invoices', 'GST-ready invoices from day one.']] as const).map(([icon, text]) => (
            <li key={text} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <span style={{ width: 32, height: 32, borderRadius: 'var(--radius-md)', background: 'rgba(127,127,127,0.25)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon name={icon} size={15} />
              </span>
              {text}
            </li>
          ))}
        </ul>
      </aside>

      <main className="onb-main">
        <div className="onb-body">
          <div className="eyebrow" style={{ marginBottom: 10 }}>
            Step {step + 1} of 3 · {STEPS[step]!.title}
          </div>

          {step === 0 && (
            <>
              <h1 className="display-md" style={{ margin: 0 }}>Choose your plan</h1>
              <p className="body" style={{ color: 'var(--text-secondary)', marginTop: 10, maxWidth: 680, lineHeight: 1.55 }}>
                {user?.name ? `Welcome, ${user.name.split(' ')[0]}. ` : ''}
                Solo advocates and law students are free till 1 June 2027; law firms get a 14-day free trial. You can switch any time.
              </p>
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: 24 }}>
                <div role="group" aria-label="Billing cycle" style={{ display: 'inline-flex', gap: 2, padding: 4, border: '1px solid var(--border-default)', borderRadius: 'var(--radius-full)' }}>
                  {(['monthly', 'annual'] as const).map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-pressed={cycle === c}
                      onClick={() => setCycle(c)}
                      style={{ padding: '8px 18px', border: 0, cursor: 'pointer', fontSize: 14, fontWeight: 600, borderRadius: 'var(--radius-full)', background: cycle === c ? 'var(--text-primary)' : 'transparent', color: cycle === c ? 'var(--bg-base)' : 'var(--text-secondary)' }}
                    >
                      {c === 'monthly' ? 'Monthly' : <>Annual <span style={{ fontSize: 11, fontWeight: 500 }}>save 20%</span></>}
                    </button>
                  ))}
                </div>
              </div>
              <div className="onb-plans">
                {SIGNUP_PLANS.filter((p) => p.id !== 'firm').map((p) => (
                  <PlanCard key={p.id} plan={p} cycle={cycle} selected={plan === p.id} popular={p.id === 'solo'} onSelect={() => setPlan(p.id)} />
                ))}
              </div>
              <p className="body-sm" style={{ marginTop: 18, color: 'var(--text-secondary)' }}>
                A firm with 9 or more advocates?{' '}
                <button type="button" className="auth-link" onClick={() => navigate('/signup?intent=demo')}>Book a demo</button>
                {' '}for custom pricing.
              </p>
              {plan === 'free' && (
                <div role="group" aria-label="I am" style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
                  <span className="body-sm" style={{ color: 'var(--text-secondary)' }}>I am</span>
                  {(['advocate', 'student'] as const).map((k) => (
                    <button key={k} type="button" className="onb-chip" aria-pressed={kind === k} onClick={() => setKind(k)}>
                      {k === 'advocate' ? 'an advocate' : 'a law student'}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {step === 1 && (
            <>
              <h1 className="display-md" style={{ margin: 0 }}>{student ? 'Tell us about your studies' : 'Tell us about your practice'}</h1>
              <p className="body" style={{ color: 'var(--text-secondary)', marginTop: 10, maxWidth: 680 }}>
                {student ? 'We use this to suggest the right material for you.' : 'This is how clients and courts see you: on your drafts, letterhead and invoices.'}
              </p>
              <div className="card" style={{ padding: 28, marginTop: 28, display: 'flex', gap: 28, flexWrap: 'wrap' }}>
                {!student && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                    <input ref={logoInput} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" hidden onChange={(e) => void logo.pick(e.target.files?.[0])} />
                    <button
                      type="button"
                      onClick={() => logoInput.current?.click()}
                      style={{ width: 120, height: 120, borderRadius: 'var(--radius-lg)', border: '1px dashed var(--border-strong)', background: 'var(--bg-surface-2)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, overflow: 'hidden', padding: 0, color: 'var(--text-primary)' }}
                      aria-label="Upload logo"
                    >
                      {logo.preview
                        ? <img src={logo.preview} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                        : <><Icon name="upload" size={18} /><span className="mono" style={{ fontSize: 11, letterSpacing: '0.12em' }}>{logo.busy ? '…' : 'LOGO'}</span></>}
                    </button>
                    <span className="body-xs" style={{ color: 'var(--text-tertiary)' }}>PNG, JPG or SVG · optional</span>
                    {logo.error && <span className="body-xs" style={{ color: 'var(--danger)' }}>{logo.error}</span>}
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 260, display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {student ? (
                    <div className="onb-grid-2">
                      <Field label="College / university" required htmlFor="onb-college">
                        <input id="onb-college" className="input" value={college} onChange={(e) => setCollege(e.target.value)} placeholder="Government Law College, Chennai" />
                      </Field>
                      <Field label="Year of study" htmlFor="onb-year">
                        <select id="onb-year" className="input" value={studyYear} onChange={(e) => setStudyYear(e.target.value)}>
                          <option value="">Select…</option>
                          {STUDY_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                        </select>
                      </Field>
                    </div>
                  ) : (
                    <>
                      <Field label={practice ? 'Firm name' : 'Practice name'} required={practice} htmlFor="onb-firm" hint="Shown on your drafts, letterhead and client portal. You can change this later.">
                        <input id="onb-firm" className="input" value={firm} onChange={(e) => setFirm(e.target.value)} placeholder={practice ? 'Sharma & Associates' : `${user?.name ?? 'Your name'}, Advocate`} autoComplete="organization" />
                      </Field>
                      <div className={practice ? 'onb-grid-2' : undefined}>
                        <Field label="Primary court" htmlFor="onb-court">
                          <input id="onb-court" className="input" value={primaryCourt} onChange={(e) => setPrimaryCourt(e.target.value)} placeholder="Madras High Court" />
                        </Field>
                        {practice && (
                          <Field label="Team size" htmlFor="onb-team">
                            <select id="onb-team" className="input" value={teamSize} onChange={(e) => setTeamSize(e.target.value)}>
                              <option value="">Select…</option>
                              {TEAM_SIZES.map((t) => <option key={t} value={t}>{t} people</option>)}
                            </select>
                          </Field>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div style={{ marginTop: 32, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600 }}>{student ? 'Areas of interest' : 'Practice areas'}</div>
                  <div className="body-sm" style={{ color: 'var(--text-secondary)', marginTop: 2 }}>
                    Pick what your {student ? 'studies focus' : 'practice focuses'} on. <strong style={{ color: 'var(--text-primary)' }}>{areas.length} selected</strong>
                  </div>
                </div>
                <input className="input" style={{ width: 240 }} placeholder="Search…" value={areaSearch} onChange={(e) => setAreaSearch(e.target.value)} aria-label="Search practice areas" />
              </div>
              {AREA_GROUPS.map((g) => {
                const shown = g.areas.filter((a) => !q || a.toLowerCase().includes(q));
                if (!shown.length) return null;
                return (
                  <div key={g.title} style={{ marginTop: 20 }}>
                    <div className="eyebrow" style={{ marginBottom: 10 }}>{g.title}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {shown.map((a) => (
                        <button key={a} type="button" className="onb-chip" aria-pressed={areas.includes(a)} onClick={() => toggleArea(a)}>{a}</button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {step === 2 && (
            <>
              <h1 className="display-md" style={{ margin: 0 }}>Verification{student ? '' : ' & tax details'}</h1>
              <p className="body" style={{ color: 'var(--text-secondary)', marginTop: 10, maxWidth: 680, lineHeight: 1.55 }}>
                We verify every {student ? 'student' : 'advocate'} to keep DifAI trusted{student ? '.' : ', and use your address and GSTIN for GST-compliant invoices.'}
              </p>
              <div className="card" style={{ padding: 28, marginTop: 28, display: 'flex', flexDirection: 'column', gap: 20 }}>
                <div className="onb-grid-2">
                  <Field label="Document type" htmlFor="onb-doctype">
                    <select id="onb-doctype" className="input" value={doc.value} onChange={(e) => { setDocType(e.target.value as DocType); setDocNumber(''); }}>
                      {docOptions.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                    </select>
                  </Field>
                  <Field label={doc.numberLabel} required htmlFor="onb-docno">
                    <input id="onb-docno" className="input mono" value={docNumber} onChange={(e) => setDocNumber(e.target.value)} placeholder={doc.placeholder} />
                  </Field>
                </div>
                <div>
                  <span className="label">Upload your {doc.label}</span>
                  <input ref={idInput} type="file" accept="image/png,image/jpeg,application/pdf" hidden onChange={(e) => void idDoc.pick(e.target.files?.[0])} />
                  <button type="button" className="onb-drop" onClick={() => idInput.current?.click()}>
                    <Icon name={idDoc.key ? 'check' : 'upload'} size={20} />
                    <strong style={{ fontSize: 15 }}>
                      {idDoc.busy ? 'Uploading…' : idDoc.key ? idDoc.name : `Click to upload your ${doc.label}`}
                    </strong>
                    <span className="body-xs" style={{ color: 'var(--text-tertiary)' }}>
                      {idDoc.key ? 'Uploaded · click to replace' : 'JPG, PNG or PDF · up to 5 MB'}
                    </span>
                  </button>
                  {idDoc.error && <div className="body-xs" style={{ color: 'var(--danger)', marginTop: 6 }}>{idDoc.error}</div>}
                </div>
                {!student && (
                  <Field label="GSTIN (optional)" htmlFor="onb-gstin" hint="Not required to continue. Add it before your first invoice.">
                    <input id="onb-gstin" className="input mono" value={gstin} onChange={(e) => setGstin(e.target.value)} placeholder="33ABCDE1234F1Z5" maxLength={15} />
                  </Field>
                )}
                <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 20 }}>
                  <div className="eyebrow" style={{ marginBottom: 14 }}>{student ? 'Address' : 'Business address'}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <Field label="Address" htmlFor="onb-address">
                      <input id="onb-address" className="input" value={addressLine} onChange={(e) => setAddressLine(e.target.value)} placeholder="Chamber No. 12, High Court Buildings" autoComplete="street-address" />
                    </Field>
                    <div className="onb-grid-3">
                      <Field label="City" htmlFor="onb-city">
                        <input id="onb-city" className="input" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Chennai" autoComplete="address-level2" />
                      </Field>
                      <Field label="State" htmlFor="onb-state">
                        <select id="onb-state" className="input" value={stateName} onChange={(e) => setStateName(e.target.value)}>
                          <option value="">Select…</option>
                          {stateOptions.map((o) => <option key={o.value} value={o.label}>{o.label}</option>)}
                        </select>
                      </Field>
                      <Field label="Pincode" htmlFor="onb-pin">
                        <input id="onb-pin" className="input mono" value={pincode} onChange={(e) => setPincode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="600104" inputMode="numeric" autoComplete="postal-code" />
                      </Field>
                    </div>
                  </div>
                </div>
              </div>
              {complete.isError && (
                <div role="alert" className="body-sm" style={{ marginTop: 16, color: 'var(--danger)' }}>{complete.error.message}</div>
              )}
            </>
          )}
        </div>

        <div className="onb-foot">
          {step > 0 ? (
            <button type="button" className="btn btn-lg btn-pill" onClick={() => setStep((step - 1) as Step)} disabled={complete.isPending}>
              <span style={{ display: 'inline-flex', transform: 'rotate(180deg)' }}><Icon name="arrow" size={14} /></span> Back
            </button>
          ) : <span />}
          <span className="body-sm" style={{ marginLeft: 'auto', color: 'var(--text-secondary)', fontWeight: 500 }}>{problem}</span>
          <button
            type="button"
            className="btn btn-primary btn-lg btn-pill"
            disabled={!!problem || complete.isPending}
            style={{ opacity: problem ? 0.4 : 1, minWidth: 180 }}
            onClick={next}
          >
            {complete.isPending ? 'Setting up…' : step === 2 ? finishLabel : step === 0 && plan === 'firm' ? 'Book a demo' : 'Continue'}
            <Icon name="arrow" size={14} />
          </button>
        </div>
      </main>
    </div>
  );
}
