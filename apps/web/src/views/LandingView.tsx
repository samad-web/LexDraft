import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import Lenis from 'lenis';
import { PillNav } from '../components/PillNav';
import { LandingHeader } from '../components/LandingHeader';

// Header offset for scrollTo targeting — matches scrollMarginTop on each section.
const SCROLL_OFFSET = -90;

type TabId = 'home' | 'features' | 'pricing' | 'faq' | 'trial';

interface NavTab {
  id: TabId;
  label: string;
}

interface FeatureItem {
  t: string;
  b: string;
  icon: FeatureIconName;
}

interface FooterLink {
  label: string;
  href: string;
}

interface FooterGroup {
  h: string;
  l: FooterLink[];
}

interface PricingPlan {
  name: string;
  schedule: string;
  for: string;
  monthlyPrice: number | null;
  annualMonthlyPrice: number | null;
  customLabel?: string;
  perSeatNote?: string;
  features: string[];
  cta: string;
  featured?: boolean;
}

interface FaqItem {
  q: string;
  a: string;
}

const NAV_TABS: NavTab[] = [
  { id: 'home', label: 'Home' },
  { id: 'features', label: 'Features' },
  { id: 'pricing', label: 'Pricing' },
  { id: 'faq', label: 'FAQ' },
  { id: 'trial', label: 'Trial' },
];

const BILLING_OPTIONS = [
  { id: 'annual' as const, label: 'Annual · −20%' },
  { id: 'monthly' as const, label: 'Monthly' },
];

type FeatureIconName = 'draft' | 'cases' | 'contracts' | 'billing' | 'research' | 'limitation';

const FEATURES: FeatureItem[] = [
  { t: 'Drafting', b: 'Notices, plaints, written statements, vakalatnamas - every Indian-format document with statutory citations baked in.', icon: 'draft' },
  { t: 'Cases', b: 'CNR-linked matters with a hearing diary, party tracking, and document tagging in a single timeline.', icon: 'cases' },
  { t: 'Contracts', b: 'Clause-level risk scoring with red-line suggestions. Compare against your firm’s preferred-positions library.', icon: 'contracts' },
  { t: 'Billing', b: 'Tabular-aligned invoices, retainer reconciliation, and NEFT/UPI payment receipts that match your IT-return format.', icon: 'billing' },
  { t: 'Research', b: 'Hybrid search across central and state statutes. Every answer auditable to the source section.', icon: 'research' },
  { t: 'Limitation', b: 'Statutory-period tracker that warns at 90, 30, 7, and 1 day. Never miss a filing window.', icon: 'limitation' },
];

const TRUST_POINTS: string[] = [
  '200+ Indian-format templates',
  'Central + state statutes indexed',
  'CNR-linked matter records',
  'NEFT / UPI reconciliation',
];

const FAQ_ITEMS: FaqItem[] = [
  {
    q: 'Where is my data stored?',
    a: 'On Indian servers, in compliance with the DPDP Act 2023. Backups are encrypted at rest and in transit. Firm-tier customers can opt for on-premise deployment.',
  },
  {
    q: 'Which courts and tribunals are supported?',
    a: 'CNR-linked matter records work for any District Court, High Court, or the Supreme Court. Tribunal records cover NCLT, NCLAT, ITAT, CESTAT, DRT, and consumer commissions.',
  },
  {
    q: 'How does e-filing actually work?',
    a: 'LexDraft generates the court-ready PDF with the right margins, fonts, and pagination, then hands off to the relevant portal’s submission flow. Where APIs exist, we file directly; where they don’t, the file is opened with a one-click upload helper.',
  },
  {
    q: 'Do you support regional languages?',
    a: 'English drafting is fully supported today. Hindi templates ship with the Practice plan. Marathi, Tamil, Kannada, and Bengali drafting are on the 2026 roadmap.',
  },
  {
    q: 'Can I export my data if I leave?',
    a: 'Yes - at any time. One-click export of every matter, draft, contract, invoice, and document as a portable archive. No lock-in, no waiting period.',
  },
  {
    q: 'How is LexDraft priced for partnerships?',
    a: 'Per-seat pricing with volume discounts on Practice, and bespoke contracts on Firm. We do not charge per matter, per filing, or per AI generation.',
  },
];

const PRICING: PricingPlan[] = [
  {
    name: 'Solo',
    schedule: 'I',
    for: 'Independent practitioners',
    monthlyPrice: 1499,
    annualMonthlyPrice: 1199,
    features: [
      'One advocate seat',
      'Twenty AI drafts each month',
      'Up to five active matters',
      'Client portal',
      'Email correspondence support',
    ],
    cta: 'Start 14-day Solo trial',
  },
  {
    name: 'Practice',
    schedule: 'II',
    for: 'Practice groups · two to eight advocates',
    monthlyPrice: 4999,
    annualMonthlyPrice: 3999,
    perSeatNote: '≈ ₹625 per advocate at a full team of eight',
    features: [
      'Up to eight seats',
      'Two hundred AI drafts each month',
      'Unlimited active matters',
      'Custom templates and styles',
      'Priority support',
      'Analytics dashboard',
      'Document review API',
    ],
    cta: 'Start 14-day Practice trial',
    featured: true,
  },
  {
    name: 'Firm',
    schedule: 'III',
    for: 'Established firms · nine seats and above',
    monthlyPrice: null,
    annualMonthlyPrice: null,
    customLabel: 'Custom',
    features: [
      'Unlimited seats',
      'One thousand AI drafts each month',
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
  {
    h: 'Product',
    l: [
      { label: 'Features', href: '#features' },
      { label: 'Pricing', href: '#pricing' },
      { label: 'FAQ', href: '#faq' },
      { label: 'Sign in', href: '/auth' },
    ],
  },
  {
    h: 'Company',
    l: [
      { label: 'About', href: '#trial' },
      { label: 'Careers', href: 'mailto:careers@lexdraft.in' },
      { label: 'Press', href: 'mailto:press@lexdraft.in' },
      { label: 'Contact', href: 'mailto:partners@lexdraft.in?subject=LexDraft' },
    ],
  },
  {
    h: 'Support',
    l: [
      { label: 'Email support', href: 'mailto:support@lexdraft.in' },
      { label: 'WhatsApp', href: 'https://wa.me/918045678900' },
      { label: 'Status', href: 'https://status.lexdraft.in' },
      { label: 'Help centre', href: 'mailto:support@lexdraft.in?subject=Help' },
    ],
  },
  {
    h: 'Legal',
    l: [
      { label: 'Terms', href: 'mailto:legal@lexdraft.in?subject=Terms%20of%20Service' },
      { label: 'Privacy', href: 'mailto:legal@lexdraft.in?subject=Privacy%20Policy' },
      { label: 'DPA', href: 'mailto:legal@lexdraft.in?subject=Data%20Processing%20Addendum' },
      { label: 'Security', href: 'mailto:security@lexdraft.in' },
    ],
  },
];

// ---- Helpers ---------------------------------------------------------------

interface SectionLabelProps {
  eyebrow: string;
  title: string;
  description?: string;
  maxWidth?: number;
  align?: 'left' | 'center';
}

function SectionLabel({ eyebrow, title, description, maxWidth, align = 'left' }: SectionLabelProps) {
  return (
    <div
      style={{
        marginBottom: 56,
        maxWidth,
        textAlign: align,
        marginLeft: align === 'center' ? 'auto' : undefined,
        marginRight: align === 'center' ? 'auto' : undefined,
      }}
    >
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
      {description && (
        <p
          style={{
            marginTop: 16,
            fontSize: 17,
            color: 'var(--text-secondary)',
            lineHeight: 1.6,
          }}
        >
          {description}
        </p>
      )}
    </div>
  );
}

function FeatureIcon({ name }: { name: FeatureIconName }) {
  const common = {
    width: 22,
    height: 22,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  switch (name) {
    case 'draft':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M14 3l7 7-11 11H3v-7L14 3z" />
          <path d="M13 4l7 7" />
        </svg>
      );
    case 'cases':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M3 7h6l2 2h10v11H3z" />
          <path d="M3 11h18" />
        </svg>
      );
    case 'contracts':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      );
    case 'billing':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M5 3h12l2 3v15l-3-2-3 2-3-2-3 2-3-2V6z" />
          <path d="M9 9h6M9 13h6M9 17h4" />
        </svg>
      );
    case 'research':
      return (
        <svg {...common} aria-hidden="true">
          <circle cx="11" cy="11" r="6" />
          <path d="M20 20l-4-4" />
        </svg>
      );
    case 'limitation':
      return (
        <svg {...common} aria-hidden="true">
          <circle cx="12" cy="13" r="8" />
          <path d="M12 9v4l3 2M9 3h6" />
        </svg>
      );
    default:
      return null;
  }
}

function formatINR(value: number) {
  return `₹${value.toLocaleString('en-IN')}`;
}

interface FaqRowProps {
  q: string;
  a: string;
  index: number;
}

function FaqRow({ q, a, index }: FaqRowProps) {
  return (
    <details
      className="lex-faq"
      style={{
        borderTop: index === 0 ? '1px solid var(--border-default)' : undefined,
        borderBottom: '1px solid var(--border-default)',
        padding: '20px 0',
      }}
    >
      <summary
        style={{
          listStyle: 'none',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 24,
          fontSize: 17,
          fontWeight: 500,
          color: 'var(--text-primary)',
        }}
      >
        <span>{q}</span>
        <span
          aria-hidden
          className="lex-faq-marker"
          style={{
            flexShrink: 0,
            width: 28,
            height: 28,
            borderRadius: 'var(--radius-full)',
            border: '1px solid var(--border-default)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 15,
            color: 'var(--text-secondary)',
            transition: 'transform 200ms ease, color 150ms ease, border-color 150ms ease',
          }}
        >
          +
        </span>
      </summary>
      <p
        style={{
          marginTop: 14,
          fontSize: 15,
          lineHeight: 1.65,
          color: 'var(--text-secondary)',
          maxWidth: 760,
        }}
      >
        {a}
      </p>
    </details>
  );
}

// =============================================================================

export function LandingView() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabId>('home');
  const [billing, setBilling] = useState<'annual' | 'monthly'>('annual');
  const scrollLockRef = useRef(false);
  const scrollLockTimer = useRef<number | null>(null);
  // Lenis instance driving momentum-based wheel/trackpad smoothing across the
  // landing page only. Disabled under prefers-reduced-motion. Programmatic
  // scrolls (nav clicks, anchor jumps) route through lenis.scrollTo so the
  // animation curve is consistent with mouse-wheel input.
  const lenisRef = useRef<Lenis | null>(null);

  const goAuth = () => navigate('/auth');
  // New funnel-aware CTAs: each lands on /signup with the right intent so
  // the SignupView can render the matching screen (demo chooser, trial
  // form, paid form). Keep `goAuth` for "already have an account" links.
  const goSignup = (intent: 'demo' | 'trial' | 'paid') => navigate(`/signup?intent=${intent}`);

  const goSection = (id: TabId) => {
    setTab(id);
    scrollLockRef.current = true;
    if (scrollLockTimer.current) window.clearTimeout(scrollLockTimer.current);

    const el = document.getElementById(id);
    if (el) {
      if (lenisRef.current) {
        lenisRef.current.scrollTo(el, { offset: SCROLL_OFFSET });
      } else {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }

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

  const goAnchor = (hash: string) => {
    if (!hash.startsWith('#')) return;
    const id = hash.slice(1);
    const known: TabId[] = ['home', 'features', 'pricing', 'faq', 'trial'];
    if ((known as string[]).includes(id)) {
      goSection(id as TabId);
      return;
    }
    const el = document.getElementById(id);
    if (!el) return;
    if (lenisRef.current) {
      lenisRef.current.scrollTo(el, { offset: SCROLL_OFFSET });
    } else {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleFooterLink = (href: string) => (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (href.startsWith('#')) {
      e.preventDefault();
      goAnchor(href);
    } else if (href.startsWith('/')) {
      e.preventDefault();
      navigate(href);
    }
  };

  // Lenis lifecycle — momentum-based wheel/trackpad smoothing, scoped to the
  // landing route. Disabled when the user prefers reduced motion; in that
  // case scrollTo paths fall back to native scrollIntoView.
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;

    const lenis = new Lenis({
      duration: 1.15,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
    });
    lenisRef.current = lenis;

    let rafId = 0;
    const raf = (time: number) => {
      lenis.raf(time);
      rafId = requestAnimationFrame(raf);
    };
    rafId = requestAnimationFrame(raf);

    return () => {
      cancelAnimationFrame(rafId);
      lenis.destroy();
      lenisRef.current = null;
    };
  }, []);

  useEffect(() => {
    const ids: TabId[] = ['home', 'features', 'pricing', 'faq', 'trial'];
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

  const pricingRows = useMemo(
    () =>
      PRICING.map((plan) => {
        const isCustom = plan.monthlyPrice === null;
        const priceDisplay = isCustom
          ? plan.customLabel ?? 'Custom'
          : billing === 'annual'
          ? formatINR(plan.annualMonthlyPrice ?? plan.monthlyPrice ?? 0)
          : formatINR(plan.monthlyPrice ?? 0);
        const periodDisplay = isCustom
          ? 'Talk to sales'
          : billing === 'annual'
          ? 'per month, billed annually'
          : 'per month';
        const savingsLine =
          !isCustom && billing === 'annual' && plan.monthlyPrice
            ? `Save ${formatINR((plan.monthlyPrice - (plan.annualMonthlyPrice ?? 0)) * 12)} / year vs monthly`
            : null;
        return { plan, priceDisplay, periodDisplay, savingsLine, isCustom };
      }),
    [billing],
  );

  const pageStyle: CSSProperties = {
    background: 'var(--bg-base)',
    color: 'var(--text-primary)',
    minHeight: '100vh',
    fontFamily: 'var(--font-sans)',
  };

  return (
    <div style={pageStyle} className="lex-landing">
      <LandingHeader
        tabs={NAV_TABS}
        activeTab={tab}
        onTabChange={goSection}
        onSignIn={goAuth}
        onTrial={goAuth}
      />

      {/* HERO */}
      <section
        id="home"
        style={{ padding: 'clamp(56px, 8vw, 96px) clamp(16px, 4vw, 48px)', maxWidth: 1320, margin: '0 auto', scrollMarginTop: 90 }}
      >
        <div className="reveal-stagger" style={{ maxWidth: 880 }}>
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
            Practice management built for Indian advocates, not adapted for them.
          </h1>
          <p className="lede" style={{ fontSize: 19, color: 'var(--text-secondary)', maxWidth: 640, marginBottom: 36 }}>
            Cases, drafting, billing, and research - unified under one calm, document-first interface. Indian-format templates with verified citations from central and state statutes.
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn btn-primary btn-lg" type="button" onClick={() => goSignup('trial')}>
              Start free trial
            </button>
            <button
              type="button"
              className="btn btn-lg"
              onClick={() => goSignup('demo')}
            >
              Get a demo
            </button>
            <button
              type="button"
              className="btn btn-lg btn-ghost"
              onClick={() => goSignup('paid')}
            >
              Create account
            </button>
          </div>
          <div style={{ marginTop: 16, color: 'var(--text-tertiary)', fontSize: 14 }}>
            No card required ·{' '}
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
              Already have an account? Sign in
            </button>
          </div>
        </div>

        {/* Trust strip */}
        <div
          className="reveal lex-trust-strip grid-auto-sm"
          style={{
            marginTop: 64,
            paddingTop: 32,
            borderTop: '1px solid var(--border-subtle)',
            gap: 32,
          }}
        >
          {TRUST_POINTS.map((point) => (
            <div key={point} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span
                className="mono"
                style={{
                  fontSize: 11,
                  letterSpacing: '0.16em',
                  textTransform: 'uppercase',
                  color: 'var(--text-tertiary)',
                }}
              >
                Verified
              </span>
              <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-primary)' }}>
                {point}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* FEATURE GRID */}
      <section
        id="features"
        style={{ padding: 'clamp(56px, 8vw, 96px) clamp(16px, 4vw, 48px)', maxWidth: 1320, margin: '0 auto', scrollMarginTop: 90 }}
      >
        <div className="reveal">
          <SectionLabel
            eyebrow="The product"
            title="Everything a chamber runs on. Nothing that gets in the way."
            description="Six modules that share one case file - so a deadline added in Limitation shows up in Calendar, and an invoice issued in Billing closes against the same matter."
            maxWidth={760}
          />
        </div>
        <div
          className="lex-grid-3 reveal-stagger"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24 }}
        >
          {FEATURES.map((f) => (
            <article
              key={f.t}
              style={{
                borderTop: '1px solid var(--border-default)',
                paddingTop: 28,
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-default)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-primary)',
                  background: 'var(--bg-surface)',
                }}
              >
                <FeatureIcon name={f.icon} />
              </span>
              <h3
                className="display"
                style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em' }}
              >
                {f.t}
              </h3>
              <p style={{ fontSize: 15, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                {f.b}
              </p>
            </article>
          ))}
        </div>
      </section>

      {/* PRICING */}
      <section
        id="pricing"
        style={{ padding: 'clamp(56px, 8vw, 96px) clamp(16px, 4vw, 48px)', maxWidth: 1320, margin: '0 auto', scrollMarginTop: 90 }}
      >
        <div
          className="reveal lex-pricing-head"
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
          <div style={{ maxWidth: 640 }}>
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
            <p style={{ marginTop: 16, color: 'var(--text-secondary)', fontSize: 16, lineHeight: 1.6 }}>
              Per-seat pricing with volume discounts. We never charge per matter, per filing, or per AI generation.
            </p>
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
          style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24, alignItems: 'stretch' }}
        >
          {pricingRows.map(({ plan, priceDisplay, periodDisplay, savingsLine, isCustom }) => {
            const featured = plan.featured === true;
            const cardStyle: CSSProperties = {
              background: featured ? 'var(--text-primary)' : 'var(--bg-surface)',
              color: featured ? 'var(--bg-base)' : 'var(--text-primary)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-xl)',
              padding: 'clamp(20px, 4vw, 32px)',
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
                    Most popular · Recommended for chambers
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
                  <div style={{ marginBottom: 24, minHeight: 132 }}>
                    <div
                      className="display"
                      style={{
                        fontSize: 'clamp(40px, 7vw, 56px)',
                        lineHeight: 1,
                        letterSpacing: '-0.025em',
                        fontVariantNumeric: 'tabular-nums',
                        color: 'inherit',
                      }}
                    >
                      {priceDisplay}
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
                      {periodDisplay}
                    </div>
                    {plan.perSeatNote && !isCustom && (
                      <div
                        style={{
                          marginTop: 10,
                          fontSize: 13,
                          opacity: 0.75,
                          color: 'inherit',
                        }}
                      >
                        {plan.perSeatNote}
                      </div>
                    )}
                    {savingsLine && (
                      <div
                        className="mono"
                        style={{
                          marginTop: 10,
                          fontSize: 11,
                          letterSpacing: '0.12em',
                          textTransform: 'uppercase',
                          opacity: 0.7,
                          color: 'inherit',
                        }}
                      >
                        {savingsLine}
                      </div>
                    )}
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

      {/* FAQ */}
      <section
        id="faq"
        style={{
          padding: 'clamp(56px, 8vw, 96px) clamp(16px, 4vw, 48px)',
          background: 'var(--bg-surface)',
          borderTop: '1px solid var(--border-subtle)',
          borderBottom: '1px solid var(--border-subtle)',
          scrollMarginTop: 90,
        }}
      >
        <div style={{ maxWidth: 920, margin: '0 auto' }}>
          <div className="reveal">
            <SectionLabel
              eyebrow="Common questions"
              title="What advocates ask before they sign up."
              maxWidth={720}
            />
          </div>
          <div className="reveal" style={{ display: 'flex', flexDirection: 'column' }}>
            {FAQ_ITEMS.map((item, idx) => (
              <FaqRow key={item.q} q={item.q} a={item.a} index={idx} />
            ))}
          </div>
        </div>
      </section>

      {/* TRIAL CTA */}
      <section
        id="trial"
        className="reveal"
        style={{ padding: 'clamp(64px, 9vw, 96px) clamp(16px, 4vw, 48px) clamp(80px, 10vw, 112px)', maxWidth: 900, margin: '0 auto', scrollMarginTop: 90, textAlign: 'center' }}
      >
        <div className="eyebrow" style={{ marginBottom: 16 }}>Ready when you are</div>
        <h2
          className="display"
          style={{
            fontSize: 'clamp(36px, 5vw, 60px)',
            fontWeight: 600,
            letterSpacing: '-0.025em',
            margin: '0 auto 20px',
          }}
        >
          Fourteen-day trial. No card. Real cases.
        </h2>
        <p
          className="lede"
          style={{ maxWidth: 560, margin: '0 auto 32px', color: 'var(--text-secondary)' }}
        >
          Start with one matter. Move your whole practice when you’re ready.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-primary btn-lg" type="button" onClick={() => goSignup('trial')}>
            Start free trial
          </button>
          <button
            type="button"
            className="btn btn-lg"
            onClick={() => goSignup('demo')}
          >
            Get a demo
          </button>
        </div>
      </section>

      {/* FOOTER */}
      <footer
        className="lex-footer"
        style={{
          borderTop: '1px solid var(--border-subtle)',
          padding: '48px 48px 40px',
        }}
      >
        {/* 5-column link grid */}
        <div className="lex-footer-grid">
          {FOOTER_GROUPS.map((g) => (
            <div key={g.h} className="lex-footer-col">
              <div className="lex-footer-eyebrow">{g.h}</div>
              <ul className="lex-footer-list">
                {g.l.map((it) => (
                  <li key={it.label}>
                    <a
                      href={it.href}
                      onClick={handleFooterLink(it.href)}
                      className="lex-footer-link"
                    >
                      {it.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom strip - CIN + compliance */}
        <div className="lex-footer-base">
          <span className="mono" style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
            © 2026 LexDraft Technologies Pvt Ltd · CIN U72900KA2024PTC987654
          </span>
          <span className="mono" style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
            SOC 2 Type II · ISO 27001 · DPDP Act 2023
          </span>
        </div>
      </footer>

      {/* Scoped responsive overrides + animations */}
      <style>{`
        .lex-faq[open] .lex-faq-marker { transform: rotate(45deg); border-color: var(--text-primary); color: var(--text-primary); }
        .lex-faq summary::-webkit-details-marker { display: none; }
        .lex-faq summary:hover { color: var(--text-secondary); }

        /* ---------- FOOTER ---------- */
        .lex-footer {
          position: relative;
          overflow: hidden;
          isolation: isolate;
        }
        .lex-footer > * { position: relative; z-index: 1; }

        .lex-footer-grid {
          max-width: 1320px;
          margin: 0 auto;
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          gap: 48px;
          padding: 16px 0 56px;
        }
        .lex-footer-col { min-width: 0; }
        .lex-footer-eyebrow {
          font-family: var(--font-mono);
          font-size: 11px;
          font-weight: 500;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          color: var(--text-tertiary);
          margin-bottom: 20px;
        }
        .lex-footer-list {
          list-style: none;
          padding: 0;
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .lex-footer-link {
          font-size: 16px;
          color: var(--text-primary);
          text-decoration: none;
          transition: color 150ms ease;
          display: inline-block;
        }
        .lex-footer-link:hover { color: var(--text-secondary); }

        .lex-footer-base {
          max-width: 1320px;
          margin: 0 auto;
          padding: 24px 0 0;
          border-top: 1px solid var(--border-subtle);
          display: flex;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 16px;
        }

        @media (max-width: 1023px) {
          .lex-footer { padding: 32px 32px 32px !important; }
          .lex-footer-grid { grid-template-columns: repeat(3, 1fr); gap: 36px; padding: 8px 0 40px; }
          .lex-footer-link { font-size: 15px; }
        }
        @media (max-width: 640px) {
          .lex-footer { padding: 24px 20px 24px !important; }
          .lex-footer-grid { grid-template-columns: repeat(2, 1fr); gap: 28px; padding: 4px 0 32px; }
          .lex-footer-base { flex-direction: column; align-items: flex-start; }
        }

        @media (max-width: 1023px) {
          .lex-grid-3 { grid-template-columns: repeat(2, 1fr) !important; }
          .lex-trust-strip { grid-template-columns: repeat(2, 1fr) !important; }
        }
        @media (max-width: 640px) {
          .lex-grid-3 { grid-template-columns: 1fr !important; }
          .lex-trust-strip { grid-template-columns: 1fr 1fr !important; gap: 20px !important; }
          .lex-pricing-head { align-items: flex-start !important; }
        }

        @media (prefers-reduced-motion: reduce) {
          .lex-faq-marker { transition: none !important; }
        }
      `}</style>
    </div>
  );
}
