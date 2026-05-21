import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '@lexdraft/ui';
import { useSignUp, useDemoRequest } from '@/hooks/useAuth';
import { useUIStore } from '@/store/ui';

/**
 * SignupView — the new landing-funnel destination at `/signup?intent=…`.
 *
 *   intent=demo  → DemoChoiceScreen   (Talk to sales / Try interactive / Book a call)
 *   intent=trial → TrialSignupForm    (14-day clock, no card)
 *   intent=paid  → AccountSignupForm  (same fields; lands on plan_status='active'
 *                                      so billing/checkout can flow later)
 *
 * Each path is a single-card form on a centred page so it feels like a
 * focused destination — not a sub-route hidden inside an auth toggle.
 */

type Intent = 'demo' | 'trial' | 'paid';
type DemoChoice = 'contact' | 'interactive' | 'schedule';

const SCHEDULE_URL = 'https://cal.com/lexdraft/demo'; // configurable; defaults to a generic slug

function parseIntent(raw: string | null): Intent {
  if (raw === 'demo' || raw === 'trial' || raw === 'paid') return raw;
  return 'trial';
}

export function SignupView(): JSX.Element {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const intent = parseIntent(params.get('intent'));

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--bg-base)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <header
        style={{
          padding: '24px 32px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <button
          type="button"
          onClick={() => navigate('/')}
          style={{
            all: 'unset', cursor: 'pointer',
            fontWeight: 700, fontSize: 18, letterSpacing: '-0.01em',
          }}
        >
          LexDraft
        </button>
        <button
          type="button"
          onClick={() => navigate('/auth')}
          className="btn btn-ghost"
        >
          Sign in
        </button>
      </header>

      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '48px 24px 96px',
        }}
      >
        <div style={{ width: '100%', maxWidth: 560 }}>
          {intent === 'demo'  && <DemoChoiceScreen />}
          {intent === 'trial' && <SignupFormCard intent="trial" />}
          {intent === 'paid'  && <SignupFormCard intent="paid" />}
        </div>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Demo choice (intent=demo)
// ---------------------------------------------------------------------------

function DemoChoiceScreen(): JSX.Element {
  const [choice, setChoice] = useState<DemoChoice | null>(null);
  if (choice === 'contact')     return <DemoContactForm onBack={() => setChoice(null)} demoType="contact" />;
  if (choice === 'schedule')    return <DemoContactForm onBack={() => setChoice(null)} demoType="schedule" />;
  if (choice === 'interactive') return <InteractiveDemoSignup onBack={() => setChoice(null)} />;
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 8 }}>See LexDraft</div>
      <h1 className="heading-xl" style={{ marginBottom: 8 }}>How would you like the demo?</h1>
      <p className="lede" style={{ color: 'var(--text-secondary)', marginBottom: 28 }}>
        Three ways — pick the one that suits your week.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <DemoChoiceCard
          title="Talk to our team"
          desc="Share a few details. A partner reaches out within one business day to walk you through what matters for your firm."
          chevronLabel="Send a message"
          onClick={() => setChoice('contact')}
        />
        <DemoChoiceCard
          title="Try the interactive demo"
          desc="Spin up a sandbox account in seconds — no card, no commitment. Argue against opposing counsel, draft a notice, browse the matter shell."
          chevronLabel="Open sandbox"
          onClick={() => setChoice('interactive')}
        />
        <DemoChoiceCard
          title="Book a guided demo"
          desc="Pick a slot that works for you. We'll walk you through the parts of the product most relevant to your practice."
          chevronLabel="Open calendar"
          onClick={() => setChoice('schedule')}
        />
      </div>
    </div>
  );
}

function DemoChoiceCard(props: {
  title: string;
  desc: string;
  chevronLabel: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="card"
      style={{
        textAlign: 'left',
        padding: 20,
        cursor: 'pointer',
        background: 'var(--bg-surface)',
        borderColor: 'var(--border-default)',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="heading-sm" style={{ marginBottom: 6 }}>{props.title}</div>
        <div className="body-sm muted" style={{ lineHeight: 1.55 }}>{props.desc}</div>
      </div>
      <div className="mono" style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: 6 }}>
        {props.chevronLabel.toUpperCase()} <Icon name="arrow" size={12} />
      </div>
    </button>
  );
}

function DemoContactForm(props: { demoType: 'contact' | 'schedule'; onBack: () => void }): JSX.Element {
  const demo = useDemoRequest();
  const showToast = useUIStore((s) => s.showToast);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [firmName, setFirmName] = useState('');
  const [phone, setPhone] = useState('');
  const [preferredTime, setPreferredTime] = useState('');
  const [message, setMessage] = useState('');
  const [submitted, setSubmitted] = useState(false);

  // Schedule path: open the external calendar in a new tab so the user can
  // pick a slot, then still post the request so sales has the context. If
  // they close the tab without picking, the lead row is still on file.
  useEffect(() => {
    if (props.demoType === 'schedule' && typeof window !== 'undefined') {
      window.open(SCHEDULE_URL, '_blank', 'noopener,noreferrer');
    }
  }, [props.demoType]);

  if (submitted) {
    return (
      <DonePanel
        title={props.demoType === 'schedule' ? 'You\'re scheduled' : 'Got it — we\'ll be in touch'}
        body={
          props.demoType === 'schedule'
            ? 'A confirmation email is on its way. Reply if you need to move the slot.'
            : 'A partner will email you within one business day. Tell anyone else who should be on the call.'
        }
      />
    );
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await demo.mutateAsync({
        name: name.trim(),
        email: email.trim(),
        firmName: firmName.trim() || undefined,
        phone: phone.trim() || undefined,
        preferredTime: preferredTime.trim() || undefined,
        message: message.trim() || undefined,
        demoType: props.demoType,
      });
      setSubmitted(true);
    } catch (err) {
      showToast({ type: 'vermillion', text: (err as Error)?.message ?? 'Could not submit the form.' });
    }
  };

  return (
    <div>
      <BackLink onClick={props.onBack} />
      <h1 className="heading-xl" style={{ marginBottom: 8 }}>
        {props.demoType === 'schedule' ? 'Confirm your slot' : 'Talk to our team'}
      </h1>
      <p className="lede" style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>
        {props.demoType === 'schedule'
          ? 'A calendar opened in a new tab. Drop your details so we have context when we connect.'
          : 'A few details and a partner will be in touch within a business day.'}
      </p>
      <form onSubmit={onSubmit} className="card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Labelled label="Your name *">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </Labelled>
        <Labelled label="Work email *">
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Labelled>
        <Labelled label="Firm or practice name">
          <input className="input" value={firmName} onChange={(e) => setFirmName(e.target.value)} />
        </Labelled>
        <Labelled label="Phone (optional)">
          <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Labelled>
        {props.demoType === 'schedule' && (
          <Labelled label="Preferred time window">
            <input className="input" placeholder="e.g. Weekdays 4–6pm IST" value={preferredTime} onChange={(e) => setPreferredTime(e.target.value)} />
          </Labelled>
        )}
        <Labelled label="Anything we should prepare?">
          <textarea
            className="input"
            rows={3}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            style={{ resize: 'vertical', fontFamily: 'inherit' }}
          />
        </Labelled>
        <div style={{ marginTop: 8 }}>
          <button type="submit" className="btn btn-primary btn-lg" disabled={demo.isPending}>
            {demo.isPending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </form>
    </div>
  );
}

function InteractiveDemoSignup(props: { onBack: () => void }): JSX.Element {
  // Interactive demo === instant trial provisioning with the is_demo flag set.
  // The user gets a tenant they can poke at; the in-app banner surfaces a
  // "Convert to a real account" CTA once they decide.
  const signUp = useSignUp();
  const showToast = useUIStore((s) => s.showToast);
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await signUp.mutateAsync({
        email: email.trim(),
        name: name.trim() || 'Demo User',
        password,
        role: 'solo',
        intent: 'demo',
      });
      // Sign-up sets the auth store; navigate into the app.
      navigate('/app/dashboard', { replace: true });
    } catch (err) {
      showToast({ type: 'vermillion', text: (err as Error)?.message ?? 'Could not start the demo.' });
    }
  };

  return (
    <div>
      <BackLink onClick={props.onBack} />
      <h1 className="heading-xl" style={{ marginBottom: 8 }}>Spin up an interactive demo</h1>
      <p className="lede" style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>
        Fresh sandbox account, ready in seconds. No card. We'll flag the
        session as a demo so it doesn't mix with real practice data.
      </p>
      <form onSubmit={onSubmit} className="card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Labelled label="Your name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Demo User" />
        </Labelled>
        <Labelled label="Email *">
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Labelled>
        <Labelled label="Password *">
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
          <div className="body-xs muted" style={{ marginTop: 4 }}>At least 8 characters.</div>
        </Labelled>
        <div style={{ marginTop: 8 }}>
          <button type="submit" className="btn btn-primary btn-lg" disabled={signUp.isPending}>
            {signUp.isPending ? 'Starting demo…' : 'Start interactive demo'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trial / Paid signup (intent=trial | paid)
// ---------------------------------------------------------------------------

function SignupFormCard(props: { intent: 'trial' | 'paid' }): JSX.Element {
  const signUp = useSignUp();
  const showToast = useUIStore((s) => s.showToast);
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'solo' | 'group' | 'firm'>('solo');
  const [firm, setFirm] = useState('');

  const isTrial = props.intent === 'trial';
  const eyebrow = isTrial ? 'Trial · 14 days, no card' : 'Create account';
  const headline = isTrial
    ? 'Start your 14-day trial'
    : 'Create your LexDraft account';
  const subline = isTrial
    ? 'Full access to the plan you pick. We do not ask for a card until day 14.'
    : 'Set up your account; billing kicks in on the next page.';
  const ctaLabel = isTrial ? 'Begin trial' : 'Create account';

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await signUp.mutateAsync({
        email: email.trim(),
        name: name.trim(),
        password,
        role,
        firm: firm.trim() || undefined,
        intent: props.intent,
      });
      navigate('/app/dashboard', { replace: true });
    } catch (err) {
      showToast({ type: 'vermillion', text: (err as Error)?.message ?? 'Could not create your account.' });
    }
  };

  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 8 }}>{eyebrow}</div>
      <h1 className="heading-xl" style={{ marginBottom: 8 }}>{headline}</h1>
      <p className="lede" style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>
        {subline}
      </p>
      <form onSubmit={onSubmit} className="card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Labelled label="Your name *">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </Labelled>
        <Labelled label="Work email *">
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Labelled>
        <Labelled label="Password *">
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
          <div className="body-xs muted" style={{ marginTop: 4 }}>At least 8 characters.</div>
        </Labelled>
        <Labelled label="Practice setup">
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
            {(['solo', 'group', 'firm'] as const).map((r) => (
              <button
                key={r}
                type="button"
                className={`chip ${role === r ? 'active' : ''}`}
                onClick={() => setRole(r)}
              >
                {r === 'solo' ? 'Solo' : r === 'group' ? 'Practice group' : 'Firm'}
              </button>
            ))}
          </div>
        </Labelled>
        {role !== 'solo' && (
          <Labelled label="Practice or firm name">
            <input className="input" value={firm} onChange={(e) => setFirm(e.target.value)} placeholder="e.g. Mehta & Co." />
          </Labelled>
        )}
        <div style={{ marginTop: 8 }}>
          <button type="submit" className="btn btn-primary btn-lg" disabled={signUp.isPending}>
            {signUp.isPending ? 'Creating…' : ctaLabel}
          </button>
        </div>
        <div className="body-xs muted" style={{ marginTop: 4 }}>
          {isTrial
            ? 'Your trial gives full access to the plan you select. After 14 days, pick a plan to keep going.'
            : 'You can switch plans any time from Settings → Billing.'}
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function Labelled(props: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="label">{props.label}</span>
      {props.children}
    </label>
  );
}

function BackLink(props: { onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={props.onClick}
      style={{
        all: 'unset',
        cursor: 'pointer',
        color: 'var(--text-secondary)',
        fontSize: 13,
        marginBottom: 16,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      ← Back
    </button>
  );
}

function DonePanel(props: { title: string; body: string }): JSX.Element {
  const navigate = useNavigate();
  return (
    <div className="card" style={{ padding: 28, textAlign: 'center' }}>
      <div
        style={{
          width: 44, height: 44, borderRadius: '50%',
          background: 'var(--success, #2f7a3b)', color: 'var(--bg-base)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 20, fontWeight: 700, marginBottom: 16,
        }}
        aria-hidden
      >
        ✓
      </div>
      <h2 className="heading-md" style={{ marginBottom: 8 }}>{props.title}</h2>
      <p className="body-sm muted" style={{ marginBottom: 24, maxWidth: 380, marginLeft: 'auto', marginRight: 'auto' }}>{props.body}</p>
      <button type="button" className="btn" onClick={() => navigate('/')}>
        Back to home
      </button>
    </div>
  );
}

