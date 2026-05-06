import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { PillNav } from '../components/PillNav';
import { BrandMark, LandingHeader } from '../components/LandingHeader';

// =============================================================================
// LandingView — Monochrome Legal · pill nav · numbered timeline · stats grid
// Ported from _design/lexdraft/project/landing-v2.jsx, with the v1 fees +
// thesis sections re-cut for the monochrome system (no gold ornaments,
// no Bleu Nuit, no italic decoration — italics only on case names).
// =============================================================================

type TabId = 'home' | 'workflow' | 'pricing' | 'trial' | 'support';

interface NavTab {
  id: TabId;
  label: string;
}

interface Step {
  n: string;
  t: string;
  b: string;
}

interface Feature {
  t: string;
  b: string;
}

interface FooterGroup {
  h: string;
  l: string[];
}

interface PricingPlan {
  name: string;
  schedule: string;
  price: string;
  period: string;
  for: string;
  features: string[];
  cta: string;
  featured?: boolean;
}

const NAV_TABS: NavTab[] = [
  { id: 'home', label: 'Home' },
  { id: 'workflow', label: 'Workflow' },
  { id: 'pricing', label: 'Pricing' },
  { id: 'trial', label: 'Trial' },
  { id: 'support', label: 'Support' },
];

interface SupportChannel {
  eyebrow: string;
  title: string;
  detail: string;
  hours: string;
  cta: { label: string; href: string };
}

const SUPPORT_CHANNELS: SupportChannel[] = [
  {
    eyebrow: 'Email',
    title: 'support@lexdraft.in',
    detail: 'Detailed queries, screenshots, and audit-trail requests. Replies within four working hours on business days.',
    hours: 'Mon–Fri · 9:00–19:00 IST',
    cta: { label: 'Compose email', href: 'mailto:support@lexdraft.in' },
  },
  {
    eyebrow: 'WhatsApp',
    title: 'Chambers liaison',
    detail: 'Quick questions, file attachments, escalations from the bench. A real chambers-trained liaison, not a bot.',
    hours: 'Mon–Sat · 9:00–21:00 IST',
    cta: { label: 'Open WhatsApp', href: 'https://wa.me/918045678900' },
  },
  {
    eyebrow: 'Phone',
    title: '+91 80 4567 8900',
    detail: 'Calls only — no IVR, no hold music. Routed to a senior support engineer when our liaison is unavailable.',
    hours: 'Mon–Fri · 10:00–19:00 IST',
    cta: { label: 'Call support', href: 'tel:+918045678900' },
  },
];

const BILLING_OPTIONS = [
  { id: 'annual' as const, label: 'Annual · −20%' },
  { id: 'monthly' as const, label: 'Monthly' },
];

const STEPS: Step[] = [
  { n: '01', t: 'Capture the matter', b: 'Voice-record the client conversation. LexDraft extracts parties, facts, dates, and the cause of action — then opens the case file pre-populated.' },
  { n: '02', t: 'Draft with AI', b: 'Choose from 200+ Indian-format templates. Drafts stream in seconds with citations, statutory references, and a precedent trail you can audit.' },
  { n: '03', t: 'File and follow up', b: 'Print court-ready, e-file via integrated portals, and track limitation. Every deadline auto-syncs to your calendar and the client’s.' },
  { n: '04', t: 'Review contracts', b: 'Drop a contract in. Risk-flagged clause-by-clause output, with redlines aligned to your firm’s preferred positions.' },
  { n: '05', t: 'Bill and collect', b: 'Time entries from the case file, invoices in two clicks, payment tracking with NEFT/UPI reconciliation.' },
  { n: '06', t: 'Research instantly', b: 'Lex.AI answers questions with verified citations to SCC, Manupatra, and reportable judgments only.' },
];

const FEATURES: Feature[] = [
  { t: 'Drafting', b: 'Notices, plaints, written statements, vakalatnamas — every Indian-format document with statutory citations baked in.' },
  { t: 'Cases', b: 'CNR-linked, e-courts integrated. Hearing diary, cause-list pull, party tracking, and document tagging in a single timeline.' },
  { t: 'Contracts', b: 'Clause-level risk scoring with red-line suggestions. Compare against your firm’s preferred-positions library.' },
  { t: 'Billing', b: 'Tabular-aligned invoices, retainer reconciliation, and NEFT/UPI payment receipts that match your IT-return format.' },
  { t: 'Research', b: 'Verified citations only. SCC, Manupatra, reportable judgments. Every answer auditable to the source paragraph.' },
  { t: 'Limitation', b: 'Statutory-period tracker that warns at 90, 30, 7, and 1 day. Never miss a filing window.' },
];

const READING_POINTS: string[] = [
  '15px body minimum, 1.6 line-height',
  'Status colors only on status, never decoration',
  'Italic reserved for case names alone',
  'Tabular numerics in every column',
  'WCAG AA across both themes',
];

const PRICING: PricingPlan[] = [
  {
    name: 'Solo',
    schedule: 'I',
    price: '₹1,499',
    period: 'per month',
    for: 'Independent practitioners',
    features: [
      'One advocate seat',
      'Fifty AI drafts each month',
      'eCourts sync · five matters',
      'Client portal',
      'Email correspondence support',
    ],
    cta: 'Start free trial',
  },
  {
    name: 'Practice',
    schedule: 'II',
    price: '₹4,999',
    period: 'per month',
    for: 'Practice groups · two to eight advocates',
    features: [
      'Up to eight seats',
      'Five hundred AI drafts each month',
      'eCourts sync · unlimited matters',
      'Custom templates and styles',
      'Priority support',
      'Analytics dashboard',
      'Document review API',
    ],
    cta: 'Start free trial',
    featured: true,
  },
  {
    name: 'Firm',
    schedule: 'III',
    price: 'Custom',
    period: 'enquire within',
    for: 'Established firms · nine seats and above',
    features: [
      'Unlimited seats',
      'Unlimited AI drafts',
      'SSO and audit logs',
      'Dedicated success manager',
      'On-premise deployment available',
      'Bespoke integrations',
      'SLA · 99.95%',
    ],
    cta: 'Speak with us',
  },
];

const FOOTER_GROUPS: FooterGroup[] = [
  { h: 'Product', l: ['Drafting', 'Cases', 'Contracts', 'Billing', 'Research'] },
  { h: 'Solutions', l: ['Solo advocates', 'Mid-size firms', 'In-house teams', 'Litigation', 'Corporate'] },
  { h: 'Company', l: ['About', 'Customers', 'Careers', 'Press', 'Contact'] },
  { h: 'Legal', l: ['Terms', 'Privacy', 'DPA', 'Security', 'Status'] },
];

// ----- Local helpers (kept inline; only fragments repeated 3+ times) ----------

interface SectionLabelProps {
  eyebrow: string;
  title: string;
  maxWidth?: number;
  align?: 'left' | 'center';
}

function SectionLabel({ eyebrow, title, maxWidth, align = 'left' }: SectionLabelProps) {
  return (
    <div style={{ marginBottom: 56, maxWidth, textAlign: align, marginLeft: align === 'center' ? 'auto' : undefined, marginRight: align === 'center' ? 'auto' : undefined }}>
      <div className="eyebrow" style={{ marginBottom: 12 }}>{eyebrow}</div>
      <h2
        className="display"
        style={{
          fontSize: 'clamp(32px, 4vw, 48px)',
          fontWeight: 600,
          letterSpacing: '-0.02em',
        }}
      >
        {title}
      </h2>
    </div>
  );
}

// =============================================================================

export function LandingView() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabId>('home');
  const [billing, setBilling] = useState<'annual' | 'monthly'>('annual');
  const scrollLockRef = useRef(false);
  const scrollLockTimer = useRef<number | null>(null);

  const goAuth = () => navigate('/auth');

  const goSection = (id: TabId) => {
    setTab(id);
    scrollLockRef.current = true;
    if (scrollLockTimer.current) window.clearTimeout(scrollLockTimer.current);

    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });

    const supportsScrollend = 'onscrollend' in window;
    const release = () => {
      scrollLockRef.current = false;
      if (supportsScrollend) {
        window.removeEventListener('scrollend', release);
      }
    };
    if (supportsScrollend) {
      window.addEventListener('scrollend', release, { once: true });
    }
    scrollLockTimer.current = window.setTimeout(release, supportsScrollend ? 2000 : 1500);
  };

  useEffect(() => {
    const ids: TabId[] = ['home', 'workflow', 'pricing', 'trial', 'support'];
    const elements = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (scrollLockRef.current) return;
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setTab(visible.target.id as TabId);
      },
      {
        rootMargin: '-30% 0px -55% 0px',
        threshold: [0, 0.25, 0.5, 0.75, 1],
      },
    );

    elements.forEach((el) => observer.observe(el));
    return () => {
      observer.disconnect();
      if (scrollLockTimer.current) window.clearTimeout(scrollLockTimer.current);
    };
  }, []);

  useLayoutEffect(() => {
    const targets = Array.from(
      document.querySelectorAll<HTMLElement>('.reveal, .reveal-stagger'),
    );
    if (targets.length === 0) return;

    const viewportH = window.innerHeight;
    targets.forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.top < viewportH * 0.9 && rect.bottom > 0) {
        el.classList.add('in');
      }
    });

    if (typeof IntersectionObserver === 'undefined') {
      targets.forEach((el) => el.classList.add('in'));
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('in');
            io.unobserve(entry.target);
          }
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.08 },
    );

    targets
      .filter((el) => !el.classList.contains('in'))
      .forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const pageStyle: CSSProperties = {
    background: 'var(--bg-base)',
    color: 'var(--text-primary)',
    minHeight: '100vh',
    fontFamily: 'var(--font-sans)',
  };

  return (
    <div style={pageStyle}>
      <LandingHeader
        tabs={NAV_TABS}
        activeTab={tab}
        onTabChange={goSection}
        onSignIn={goAuth}
        onTrial={goAuth}
      />

      {/* HERO */}
      <section id="home" style={{ padding: '96px 48px 96px', maxWidth: 1320, margin: '0 auto', scrollMarginTop: 90 }}>
        <div className="reveal-stagger" style={{ maxWidth: 880 }}>
          <div className="eyebrow" style={{ marginBottom: 20 }}>
            For Indian advocates
          </div>
          <h1
            className="display"
            style={{
              fontSize: 'clamp(40px, 6vw, 72px)',
              lineHeight: 1.05,
              letterSpacing: '-0.025em',
              fontWeight: 600,
              marginBottom: 24,
            }}
          >
            The practice management system designed for legal precision.
          </h1>
          <p className="lede" style={{ fontSize: 19, color: 'var(--text-secondary)', maxWidth: 640, marginBottom: 36 }}>
            Cases, drafting, billing, and research — unified under one calm, document-first interface. No accent colors, no novelty. Built to be read for ten hours straight.
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn btn-primary btn-lg" type="button" onClick={goAuth}>Begin trial</button>
            <button className="btn btn-lg" type="button" onClick={goAuth}>Book a demo</button>
          </div>
          <div style={{ marginTop: 16, color: 'var(--text-tertiary)', fontSize: 14  }}>
            Already have an account?{' '}
            <button
              type="button"
              onClick={goAuth}
              style={{
                background: 'none',
                border: 0,
                padding: 0,
                color: 'var(--text-primary)',
                fontSize: 14,
                fontWeight: 500,
                textDecoration: 'underline',
                textUnderlineOffset: 3,
                cursor: 'pointer',
              }}
            >
              Sign in
            </button>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS — numbered cards */}
      <section
        id="workflow"
        style={{
          padding: '96px 48px',
          background: 'var(--bg-surface)',
          borderTop: '1px solid var(--border-subtle)',
          borderBottom: '1px solid var(--border-subtle)',
          scrollMarginTop: 90,
        }}
      >
        <div style={{ maxWidth: 1320, margin: '0 auto' }}>
          <div className="reveal">
            <SectionLabel
              eyebrow="How it works"
              title="From client intake to court-ready filing in one workspace."
              maxWidth={720}
            />
          </div>
          <div className="lex-grid-3 reveal-stagger" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24 }}>
            {STEPS.map((s) => (
              <article
                key={s.n}
                style={{
                  background: 'var(--bg-base)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-lg)',
                  padding: 32,
                  position: 'relative',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: 24,
                    right: 24,
                    width: 32,
                    height: 32,
                    borderRadius: 'var(--radius-full)',
                    border: '1px solid var(--border-default)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 12,
                    fontWeight: 500,
                    color: 'var(--text-secondary)',
                  }}
                >
                  {s.n}
                </div>
                <div className="eyebrow" style={{ marginBottom: 12 }}>Step {s.n}</div>
                <h3
                  className="display"
                  style={{ fontSize: 22, fontWeight: 600, marginBottom: 12, letterSpacing: '-0.01em' }}
                >
                  {s.t}
                </h3>
                <p style={{ fontSize: 15, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{s.b}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* FEATURE GRID — 3 col */}
      <section style={{ padding: '96px 48px', maxWidth: 1320, margin: '0 auto' }}>
        <div className="reveal">
          <SectionLabel
            eyebrow="The product"
            title="Everything a chamber runs on. Nothing that gets in the way."
            maxWidth={720}
          />
        </div>
        <div className="lex-grid-3 reveal-stagger" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24 }}>
          {FEATURES.map((f) => (
            <article key={f.t} style={{ borderTop: '1px solid var(--border-default)', paddingTop: 28 }}>
              <h3
                className="display"
                style={{ fontSize: 22, fontWeight: 600, marginBottom: 12, letterSpacing: '-0.01em' }}
              >
                {f.t}
              </h3>
              <p style={{ fontSize: 15, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 16 }}>
                {f.b}
              </p>
              <a
                href="#"
                className="no-underline"
                style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}
              >
                Learn more →
              </a>
            </article>
          ))}
        </div>
      </section>

      {/* LEGIBILITY — single column, no mockup */}
      <section
        style={{
          padding: '96px 48px',
          background: 'var(--bg-surface)',
          borderTop: '1px solid var(--border-subtle)',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div
          className="reveal-stagger"
          style={{ maxWidth: 760, margin: '0 auto', textAlign: 'left' }}
        >
          <div className="eyebrow" style={{ marginBottom: 12 }}>Built for legibility</div>
          <h2
            className="display"
            style={{
              fontSize: 'clamp(28px, 3.6vw, 42px)',
              fontWeight: 600,
              letterSpacing: '-0.02em',
              marginBottom: 20,
            }}
          >
            Document-first, decoration-last.
          </h2>
          <p style={{ fontSize: 17, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 24 }}>
            No brand accent for personality’s sake. No floating cards. The interface reads like a well-formatted brief: strong borders, generous line-height, tabular-aligned numbers, and a type system designed by Inter’s engineers for sustained reading.
          </p>
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
            }}
          >
            {READING_POINTS.map((item) => (
              <li
                key={item}
                style={{ display: 'flex', gap: 12, fontSize: 15, color: 'var(--text-primary)' }}
              >
                <span
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 'var(--radius-full)',
                    border: '1px solid var(--border-default)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 11,
                    color: 'var(--text-secondary)',
                    flexShrink: 0,
                    marginTop: 2,
                  }}
                >
                  ✓
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" style={{ padding: '96px 48px', maxWidth: 1320, margin: '0 auto', scrollMarginTop: 90 }}>
        <div
          className="reveal"
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            marginBottom: 56,
            paddingBottom: 32,
            borderBottom: '1px solid var(--border-subtle)',
            flexWrap: 'wrap',
            gap: 24,
          }}
        >
          <div>
            <div className="eyebrow" style={{ marginBottom: 12 }}>Pricing</div>
            <h2
              className="display"
              style={{
                fontSize: 'clamp(32px, 4vw, 48px)',
                fontWeight: 600,
                letterSpacing: '-0.02em',
              }}
            >
              Three plans. No surprises.
            </h2>
          </div>
          <PillNav
            items={BILLING_OPTIONS}
            value={billing}
            onChange={setBilling}
            ariaLabel="Billing cadence"
          />
        </div>

        <div
          className="lex-grid-3 reveal-stagger"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24 }}
        >
          {PRICING.map((plan) => {
            const featured = plan.featured === true;
            const cardStyle: CSSProperties = {
              background: featured ? 'var(--text-primary)' : 'var(--bg-surface)',
              color: featured ? 'var(--bg-base)' : 'var(--text-primary)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-xl)',
              padding: 32,
              minHeight: 580,
              display: 'flex',
              flexDirection: 'column',
              position: 'relative',
              overflow: 'hidden',
            };

            return (
              <div key={plan.name} style={cardStyle}>
                {featured && (
                  <div
                    className="mono"
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      padding: '8px 12px',
                      background: 'var(--bg-base)',
                      color: 'var(--text-primary)',
                      fontSize: 11,
                      letterSpacing: '0.18em',
                      textTransform: 'uppercase',
                      textAlign: 'center',
                      fontWeight: 600,
                    }}
                  >
                    Recommended for most chambers
                  </div>
                )}
                <div style={{ marginTop: featured ? 28 : 0, flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <div className="eyebrow" style={{ opacity: 0.7, marginBottom: 16 }}>
                    Schedule {plan.schedule}
                  </div>
                  <div
                    className="display"
                    style={{ fontSize: 32, fontWeight: 600, letterSpacing: '-0.015em', color: 'inherit' }}
                  >
                    {plan.name}
                  </div>
                  <div style={{ fontSize: 14, opacity: 0.75, marginTop: 4, marginBottom: 24 }}>
                    {plan.for}
                  </div>
                  <div style={{ marginBottom: 24 }}>
                    <div
                      className="display"
                      style={{
                        fontSize: 56,
                        lineHeight: 1,
                        letterSpacing: '-0.025em',
                        fontVariantNumeric: 'tabular-nums',
                        color: 'inherit',
                      }}
                    >
                      {plan.price}
                    </div>
                    <div
                      className="mono"
                      style={{
                        fontSize: 11,
                        marginTop: 8,
                        opacity: 0.7,
                        letterSpacing: '0.16em',
                        textTransform: 'uppercase',
                      }}
                    >
                      {plan.period}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={goAuth}
                    className="btn btn-block btn-lg"
                    style={
                      featured
                        ? {
                            background: 'var(--bg-base)',
                            color: 'var(--text-primary)',
                            borderColor: 'var(--bg-base)',
                            marginBottom: 24,
                          }
                        : {
                            background: 'var(--text-primary)',
                            color: 'var(--bg-base)',
                            borderColor: 'var(--text-primary)',
                            marginBottom: 24,
                          }
                    }
                  >
                    {plan.cta}
                  </button>
                  <div
                    style={{
                      borderTop: `1px solid ${featured ? 'rgba(255,255,255,0.18)' : 'var(--border-subtle)'}`,
                      paddingTop: 18,
                    }}
                  >
                    <div
                      className="eyebrow"
                      style={{ opacity: 0.7, marginBottom: 14, color: 'inherit' }}
                    >
                      Included
                    </div>
                    <ul
                      style={{
                        listStyle: 'none',
                        padding: 0,
                        margin: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 10,
                      }}
                    >
                      {plan.features.map((f) => (
                        <li
                          key={f}
                          style={{
                            display: 'flex',
                            gap: 10,
                            fontSize: 14,
                            alignItems: 'flex-start',
                            lineHeight: 1.5,
                          }}
                        >
                          <span
                            aria-hidden
                            style={{
                              width: 16,
                              height: 16,
                              flexShrink: 0,
                              marginTop: 3,
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: 11,
                            }}
                          >
                            ✓
                          </span>
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* TRIAL CTA */}
      <section
        id="trial"
        className="reveal-stagger"
        style={{ padding: '120px 48px', textAlign: 'center', maxWidth: 1320, margin: '0 auto', scrollMarginTop: 90 }}
      >
        <div className="eyebrow" style={{ marginBottom: 16 }}>Ready when you are</div>
        <h2
          className="display"
          style={{
            fontSize: 'clamp(36px, 5vw, 60px)',
            fontWeight: 600,
            letterSpacing: '-0.025em',
            maxWidth: 880,
            margin: '0 auto 24px',
          }}
        >
          Fourteen-day trial. No card. Real cases.
        </h2>
        <p
          className="lede"
          style={{ maxWidth: 580, margin: '0 auto 36px', color: 'var(--text-secondary)' }}
        >
          Start with one matter. Move your whole practice when you’re ready.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-primary btn-lg" type="button" onClick={goAuth}>Begin trial</button>
          <button className="btn btn-lg" type="button" onClick={goAuth}>Talk to a partner</button>
        </div>
      </section>

      {/* SUPPORT */}
      <section
        id="support"
        style={{
          padding: '96px 48px',
          background: 'var(--bg-surface)',
          borderTop: '1px solid var(--border-subtle)',
          borderBottom: '1px solid var(--border-subtle)',
          scrollMarginTop: 90,
        }}
      >
        <div style={{ maxWidth: 1320, margin: '0 auto' }}>
          <div className="reveal">
            <SectionLabel
              eyebrow="Support"
              title="Always a partner away."
              maxWidth={720}
            />
          </div>

          <div
            className="lex-grid-3 reveal-stagger"
            style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24, marginBottom: 56 }}
          >
            {SUPPORT_CHANNELS.map((c) => (
              <article
                key={c.eyebrow}
                style={{
                  background: 'var(--bg-base)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-lg)',
                  padding: 32,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 14,
                }}
              >
                <div className="eyebrow">{c.eyebrow}</div>
                <h3
                  className="display"
                  style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em' }}
                >
                  {c.title}
                </h3>
                <p style={{ fontSize: 15, color: 'var(--text-secondary)', lineHeight: 1.6, flex: 1 }}>
                  {c.detail}
                </p>
                <div
                  className="mono"
                  style={{
                    fontSize: 11,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: 'var(--text-tertiary)',
                  }}
                >
                  {c.hours}
                </div>
                <a
                  href={c.cta.href}
                  className="no-underline"
                  style={{
                    fontSize: 14,
                    fontWeight: 500,
                    color: 'var(--text-primary)',
                    marginTop: 4,
                  }}
                >
                  {c.cta.label} →
                </a>
              </article>
            ))}
          </div>

          <div
            className="reveal"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 24,
              padding: '32px 0 0',
              borderTop: '1px solid var(--border-default)',
            }}
          >
            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Help centre</div>
              <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Searchable knowledge base, video walkthroughs, and Indian-format drafting guides.
              </p>
            </div>
            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Status</div>
              <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Real-time uptime, eCourts sync health, and incident timelines at status.lexdraft.in.
              </p>
            </div>
            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>SLA</div>
              <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                99.95% on Firm-tier plans. P0 incidents responded to within 30 minutes, around the clock.
              </p>
            </div>
            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Onboarding</div>
              <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Free 60-minute live walkthrough for every new chambers. Book directly from your dashboard.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer style={{ borderTop: '1px solid var(--border-subtle)', padding: '64px 48px 40px' }}>
        <div
          className="lex-foot-grid"
          style={{
            maxWidth: 1320,
            margin: '0 auto',
            display: 'grid',
            gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr',
            gap: 48,
          }}
        >
          <div>
            <div style={{ marginBottom: 16 }}>
              <BrandMark size={22} fontSize={18} />
            </div>
            <p
              style={{
                fontSize: 13,
                color: 'var(--text-secondary)',
                lineHeight: 1.6,
                maxWidth: 280,
              }}
            >
              Practice management for advocates. Built in Chennai, used across India.
            </p>
          </div>
          {FOOTER_GROUPS.map((g) => (
            <div key={g.h}>
              <div className="eyebrow" style={{ marginBottom: 14 }}>{g.h}</div>
              <ul
                style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                {g.l.map((it) => (
                  <li key={it}>
                    <a
                      href="#"
                      className="no-underline"
                      style={{ fontSize: 14, color: 'var(--text-secondary)' }}
                    >
                      {it}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div
          style={{
            maxWidth: 1320,
            margin: '48px auto 0',
            paddingTop: 24,
            borderTop: '1px solid var(--border-subtle)',
            display: 'flex',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 16,
          }}
        >
          <span className="mono" style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
            © 2026 LexDraft Technologies Pvt Ltd · CIN U72900KA2024PTC987654
          </span>
          <span className="mono" style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
            SOC 2 Type II · ISO 27001
          </span>
        </div>
      </footer>

      {/* Scoped responsive overrides for grids that can't be expressed via tokens */}
      <style>{`
        @media (max-width: 1023px) {
          .lex-grid-3 { grid-template-columns: repeat(2, 1fr) !important; }
          .lex-two-col { grid-template-columns: 1fr !important; gap: 40px !important; }
          .lex-foot-grid { grid-template-columns: 1fr 1fr 1fr !important; gap: 32px !important; }
        }
        @media (max-width: 640px) {
          .lex-grid-3 { grid-template-columns: 1fr !important; }
          .lex-foot-grid { grid-template-columns: 1fr 1fr !important; gap: 24px !important; }
        }
      `}</style>
    </div>
  );
}
