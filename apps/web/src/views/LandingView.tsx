import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { PillNav } from '../components/PillNav';
import { LandingHeader } from '../components/LandingHeader';

type TabId = 'home' | 'workflow' | 'pricing' | 'trial' | 'support';

interface NavTab {
  id: TabId;
  label: string;
}

interface Step {
  n: string;
  t: string;
  b: string;
  out: string;
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

interface Testimonial {
  quote: string;
  attribution: string;
  role: string;
}

interface FaqItem {
  q: string;
  a: string;
}

interface SupportChannel {
  eyebrow: string;
  title: string;
  detail: string;
  hours: string;
  cta: { label: string; href: string };
}

const NAV_TABS: NavTab[] = [
  { id: 'home', label: 'Home' },
  { id: 'workflow', label: 'Workflow' },
  { id: 'pricing', label: 'Pricing' },
  { id: 'trial', label: 'Trial' },
  { id: 'support', label: 'Support' },
];

const BILLING_OPTIONS = [
  { id: 'annual' as const, label: 'Annual · −20%' },
  { id: 'monthly' as const, label: 'Monthly' },
];

const STEPS: Step[] = [
  { n: '01', t: 'Capture the matter', b: 'Voice-record the client conversation. LexDraft extracts parties, facts, dates, and the cause of action - then opens the case file pre-populated.', out: 'Case file ready' },
  { n: '02', t: 'Draft with AI', b: 'Choose from 200+ Indian-format templates. Drafts stream in seconds with citations, statutory references, and a precedent trail you can audit.', out: 'Draft ready to print' },
  { n: '03', t: 'File and follow up', b: 'Print court-ready, e-file via integrated portals, and track limitation. Every deadline auto-syncs to your calendar and the client’s.', out: 'Calendar synced' },
  { n: '04', t: 'Review contracts', b: 'Drop a contract in. Risk-flagged clause-by-clause output, with redlines aligned to your firm’s preferred positions.', out: 'Risk report ready' },
  { n: '05', t: 'Bill and collect', b: 'Time entries from the case file, invoices in two clicks, payment tracking with NEFT/UPI reconciliation.', out: 'Invoice + receipt issued' },
  { n: '06', t: 'Research instantly', b: 'Lex.AI answers questions with verified citations to SCC, Manupatra, and reportable judgments only.', out: 'Citation-grade answer' },
];

type FeatureIconName = 'draft' | 'cases' | 'contracts' | 'billing' | 'research' | 'limitation';

const FEATURES: FeatureItem[] = [
  { t: 'Drafting', b: 'Notices, plaints, written statements, vakalatnamas - every Indian-format document with statutory citations baked in.', icon: 'draft' },
  { t: 'Cases', b: 'CNR-linked, eCourts integrated. Hearing diary, cause-list pull, party tracking, and document tagging in a single timeline.', icon: 'cases' },
  { t: 'Contracts', b: 'Clause-level risk scoring with red-line suggestions. Compare against your firm’s preferred-positions library.', icon: 'contracts' },
  { t: 'Billing', b: 'Tabular-aligned invoices, retainer reconciliation, and NEFT/UPI payment receipts that match your IT-return format.', icon: 'billing' },
  { t: 'Research', b: 'Verified citations only. SCC, Manupatra, reportable judgments. Every answer auditable to the source paragraph.', icon: 'research' },
  { t: 'Limitation', b: 'Statutory-period tracker that warns at 90, 30, 7, and 1 day. Never miss a filing window.', icon: 'limitation' },
];

const BENEFITS: string[] = [
  'Read briefs for ten hours without eye strain',
  'Tabular numbers for fees, dates, and case numbers',
  'Italic reserved for case names - never decoration',
  'Status colour only on status, never on chrome',
  'WCAG AA across both light and dark themes',
];

const TRUST_POINTS: string[] = [
  '200+ Indian-format templates',
  'eCourts + CNR integrated',
  'SCC · Manupatra citations',
  'NEFT / UPI reconciliation',
];

const TESTIMONIALS: Testimonial[] = [
  {
    quote: 'The interface stays out of the way - exactly what a brief deserves. I can read drafts for an entire afternoon without my eyes burning.',
    attribution: 'Senior Advocate',
    role: 'Civil practice · Madras High Court',
  },
  {
    quote: 'Limitation tracking alone has saved us from two near-misses this year. The 90-30-7-1 warnings are how every diary should work.',
    attribution: 'Managing Partner',
    role: 'Mid-size firm · Bengaluru',
  },
  {
    quote: 'Voice intake into a pre-populated case file changed how we run the first client meeting. Notes write themselves.',
    attribution: 'Litigation Counsel',
    role: 'Solo practice · Delhi NCR',
  },
];

const FAQ_ITEMS: FaqItem[] = [
  {
    q: 'Where is my data stored?',
    a: 'On Indian servers, in compliance with the DPDP Act 2023. Backups are encrypted at rest and in transit. Firm-tier customers can opt for on-premise deployment.',
  },
  {
    q: 'Which courts and tribunals are supported?',
    a: 'All District Courts, High Courts, and the Supreme Court via eCourts and CNR. Tribunal coverage includes NCLT, NCLAT, ITAT, CESTAT, DRT, and consumer commissions. New tribunals are added monthly.',
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
      'Fifty AI drafts each month',
      'eCourts sync · five matters',
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
      'Five hundred AI drafts each month',
      'eCourts sync · unlimited matters',
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

const SUPPORT_CHANNELS: SupportChannel[] = [
  {
    eyebrow: 'Email',
    title: 'support@lexdraft.in',
    detail: 'Detailed queries, screenshots, and audit-trail requests. Replies within four working hours on business days.',
    hours: 'Mon-Fri · 9:00-19:00 IST',
    cta: { label: 'Compose email', href: 'mailto:support@lexdraft.in' },
  },
  {
    eyebrow: 'WhatsApp',
    title: 'Chambers liaison',
    detail: 'Quick questions, file attachments, escalations from the bench. A real chambers-trained liaison, not a bot.',
    hours: 'Mon-Sat · 9:00-21:00 IST',
    cta: { label: 'Open WhatsApp', href: 'https://wa.me/918045678900' },
  },
  {
    eyebrow: 'Phone',
    title: '+91 80 4567 8900',
    detail: 'Calls only - no IVR, no hold music. Routed to a senior support engineer when our liaison is unavailable.',
    hours: 'Mon-Fri · 10:00-19:00 IST',
    cta: { label: 'Call support', href: 'tel:+918045678900' },
  },
];

const FOOTER_GROUPS: FooterGroup[] = [
  {
    h: 'Try LexDraft',
    l: [
      { label: 'Begin trial', href: '/auth' },
      { label: 'Book a demo', href: 'mailto:partners@lexdraft.in?subject=LexDraft%20demo%20request' },
      { label: 'Pricing', href: '#pricing' },
      { label: 'Sign in', href: '/auth' },
    ],
  },
  {
    h: 'Product',
    l: [
      { label: 'Drafting', href: '#workflow' },
      { label: 'Cases', href: '#workflow' },
      { label: 'Contracts', href: '#workflow' },
      { label: 'Billing', href: '#workflow' },
      { label: 'Research', href: '#workflow' },
      { label: 'Limitation', href: '#workflow' },
    ],
  },
  {
    h: 'Solutions',
    l: [
      { label: 'Solo advocates', href: '#pricing' },
      { label: 'Mid-size firms', href: '#pricing' },
      { label: 'In-house teams', href: '#trial' },
      { label: 'Litigation', href: '#workflow' },
      { label: 'Corporate', href: '#workflow' },
    ],
  },
  {
    h: 'Company',
    l: [
      { label: 'About', href: '#trial' },
      { label: 'Customers', href: '#testimonials' },
      { label: 'Careers', href: 'mailto:careers@lexdraft.in' },
      { label: 'Press', href: 'mailto:press@lexdraft.in' },
      { label: 'Contact', href: '#support' },
    ],
  },
  {
    h: 'Legal',
    l: [
      { label: 'Terms', href: 'mailto:legal@lexdraft.in?subject=Terms%20of%20Service' },
      { label: 'Privacy', href: 'mailto:legal@lexdraft.in?subject=Privacy%20Policy' },
      { label: 'DPA', href: 'mailto:legal@lexdraft.in?subject=Data%20Processing%20Addendum' },
      { label: 'Security', href: '#support' },
      { label: 'Status', href: '#support' },
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

interface CardProps {
  children: ReactNode;
  variant?: 'default' | 'surface';
  hover?: boolean;
  style?: CSSProperties;
}

function Card({ children, variant = 'default', hover = false, style }: CardProps) {
  return (
    <article
      className={hover ? 'lex-card lex-card-hover' : 'lex-card'}
      style={{
        background: variant === 'surface' ? 'var(--bg-surface)' : 'var(--bg-base)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-lg)',
        padding: 32,
        position: 'relative',
        ...style,
      }}
    >
      {children}
    </article>
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

  const goAnchor = (hash: string) => {
    if (!hash.startsWith('#')) return;
    const id = hash.slice(1);
    const known: TabId[] = ['home', 'workflow', 'pricing', 'trial', 'support'];
    if ((known as string[]).includes(id)) {
      goSection(id as TabId);
      return;
    }
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
        style={{ padding: '96px 48px 96px', maxWidth: 1320, margin: '0 auto', scrollMarginTop: 90 }}
      >
        <div className="reveal-stagger" style={{ maxWidth: 880 }}>
          <div
            className="eyebrow"
            style={{
              marginBottom: 20,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-full)',
              padding: '6px 14px',
              background: 'var(--bg-surface)',
              color: 'var(--text-secondary)',
            }}
          >
            <span
              aria-hidden
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'var(--success)',
              }}
            />
            Built for Indian advocates
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
            Practice management built for Indian advocates, not adapted for them.
          </h1>
          <p className="lede" style={{ fontSize: 19, color: 'var(--text-secondary)', maxWidth: 640, marginBottom: 36 }}>
            Cases, drafting, billing, and research - unified under one calm, document-first interface. Indian-format templates, eCourts integrated, citations to SCC and Manupatra. Built to be read for ten hours straight.
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn btn-primary btn-lg" type="button" onClick={goAuth}>
              Begin 14-day trial
            </button>
            <a
              href="#support"
              onClick={(e) => {
                e.preventDefault();
                goAnchor('#support');
              }}
              className="no-underline"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 15,
                fontWeight: 500,
                color: 'var(--text-primary)',
                padding: '12px 4px',
              }}
            >
              Book a demo →
            </a>
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
          className="reveal lex-trust-strip"
          style={{
            marginTop: 64,
            paddingTop: 32,
            borderTop: '1px solid var(--border-subtle)',
            display: 'grid',
            gridTemplateColumns: `repeat(${TRUST_POINTS.length}, 1fr)`,
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

      {/* WORKFLOW - compact connected timeline */}
      <section
        id="workflow"
        style={{
          padding: '80px 48px',
          background: 'var(--bg-surface)',
          borderTop: '1px solid var(--border-subtle)',
          borderBottom: '1px solid var(--border-subtle)',
          scrollMarginTop: 90,
        }}
      >
        <div style={{ maxWidth: 920, margin: '0 auto' }}>
          <div className="reveal" style={{ marginBottom: 40 }}>
            <SectionLabel
              eyebrow="How it works"
              title="From client intake to court-ready filing in one workspace."
              description="Six steps that mirror how chambers already work - only faster and with the paper trail kept for you."
              maxWidth={760}
            />
          </div>
          <ol className="reveal-stagger lex-workflow">
            {STEPS.map((s) => (
              <li key={s.n} className="lex-workflow-step">
                <span className="lex-workflow-marker" aria-hidden>{s.n}</span>
                <div className="lex-workflow-body">
                  <div className="lex-workflow-row">
                    <h3 className="lex-workflow-title">{s.t}</h3>
                    <span className="lex-workflow-outcome">
                      <span className="lex-workflow-outcome-arrow" aria-hidden>→</span>
                      {s.out}
                    </span>
                  </div>
                  <p className="lex-workflow-desc">{s.b}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* FEATURE GRID - with icons */}
      <section style={{ padding: '96px 48px', maxWidth: 1320, margin: '0 auto' }}>
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

      {/* LEGIBILITY - reframed as user benefits */}
      <section
        style={{
          padding: '96px 48px',
          background: 'var(--bg-surface)',
          borderTop: '1px solid var(--border-subtle)',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div
          className="reveal-stagger lex-two-col"
          style={{
            maxWidth: 1180,
            margin: '0 auto',
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 64,
            alignItems: 'center',
          }}
        >
          <div>
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
            <p style={{ fontSize: 17, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 28 }}>
              The interface reads like a well-formatted brief: strong borders, generous line-height, tabular-aligned numbers, and a type system designed for sustained reading. No accents for personality’s sake. No floating cards.
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
              {BENEFITS.map((item) => (
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

          {/* Inline brief preview */}
          <div
            aria-hidden
            style={{
              background: 'var(--bg-base)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-lg)',
              padding: 28,
              boxShadow: 'var(--shadow-popover)',
              fontFamily: 'var(--font-serif)',
              color: 'var(--text-primary)',
              lineHeight: 1.65,
            }}
          >
            <div
              className="mono"
              style={{
                fontSize: 11,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: 'var(--text-tertiary)',
                marginBottom: 16,
              }}
            >
              CS (OS) 412 / 2025 · Madras High Court
            </div>
            <div
              className="display"
              style={{
                fontSize: 20,
                fontWeight: 600,
                marginBottom: 6,
                letterSpacing: '-0.01em',
              }}
            >
              Plaint · Recovery of Possession
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
              Drafted 2026-04-30 · Auto-cited from <span className="case-name">Olga Tellis v BMC</span>
            </div>
            <p style={{ fontSize: 15, marginBottom: 12 }}>
              The plaintiff, a registered occupant under tenancy deed dated 14 March 2019, has been deprived of peaceable possession by the defendant on 22 February 2026 in violation of Section 6 of the Specific Relief Act, 1963.
            </p>
            <p style={{ fontSize: 15, marginBottom: 0 }}>
              The principle in <span className="case-name">Krishna Ram Mahale v Shobha Venkat Rao</span> is squarely attracted, the defendant having entered without due process of law.
            </p>
            <div
              style={{
                marginTop: 22,
                paddingTop: 18,
                borderTop: '1px solid var(--border-subtle)',
                display: 'flex',
                justifyContent: 'space-between',
                fontFamily: 'var(--font-sans)',
                fontSize: 12,
                fontVariantNumeric: 'tabular-nums',
                color: 'var(--text-tertiary)',
              }}
            >
              <span>Citations · 4</span>
              <span>Limitation · 87 days remaining</span>
              <span>Page 1 of 6</span>
            </div>
          </div>
        </div>
      </section>

      {/* TESTIMONIALS */}
      <section
        id="testimonials"
        style={{ padding: '96px 48px', maxWidth: 1320, margin: '0 auto', scrollMarginTop: 90 }}
      >
        <div className="reveal">
          <SectionLabel
            eyebrow="In chambers"
            title="The advocates already practising on it."
            maxWidth={720}
          />
        </div>
        <div
          className="lex-grid-3 reveal-stagger"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24 }}
        >
          {TESTIMONIALS.map((t) => (
            <Card key={t.attribution + t.role} variant="surface" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <span
                aria-hidden
                className="display"
                style={{
                  fontSize: 36,
                  lineHeight: 0.6,
                  color: 'var(--text-tertiary)',
                  fontFamily: 'var(--font-serif)',
                }}
              >
                “
              </span>
              <p
                style={{
                  fontSize: 16,
                  lineHeight: 1.65,
                  color: 'var(--text-primary)',
                  flex: 1,
                }}
              >
                {t.quote}
              </p>
              <div style={{ paddingTop: 16, borderTop: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                  {t.attribution}
                </div>
                <div
                  className="mono"
                  style={{
                    marginTop: 4,
                    fontSize: 11,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: 'var(--text-tertiary)',
                  }}
                >
                  {t.role}
                </div>
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* PRICING */}
      <section
        id="pricing"
        style={{ padding: '96px 48px', maxWidth: 1320, margin: '0 auto', scrollMarginTop: 90 }}
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
              padding: 32,
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
                        fontSize: 56,
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
          padding: '96px 48px',
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

      {/* TRIAL CTA - what's in the trial */}
      <section
        id="trial"
        className="reveal-stagger"
        style={{ padding: '120px 48px', maxWidth: 1100, margin: '0 auto', scrollMarginTop: 90 }}
      >
        <div style={{ textAlign: 'center', marginBottom: 56 }}>
          <div className="eyebrow" style={{ marginBottom: 16 }}>Ready when you are</div>
          <h2
            className="display"
            style={{
              fontSize: 'clamp(36px, 5vw, 60px)',
              fontWeight: 600,
              letterSpacing: '-0.025em',
              maxWidth: 880,
              margin: '0 auto 20px',
            }}
          >
            Fourteen-day trial. No card. Real cases.
          </h2>
          <p
            className="lede"
            style={{ maxWidth: 620, margin: '0 auto 32px', color: 'var(--text-secondary)' }}
          >
            Start with one matter. Move your whole practice when you’re ready.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-primary btn-lg" type="button" onClick={goAuth}>
              Begin 14-day trial
            </button>
            <a
              href="mailto:partners@lexdraft.in?subject=LexDraft%20demo%20request"
              className="btn btn-lg"
              style={{ textDecoration: 'none' }}
            >
              Talk to a partner
            </a>
          </div>
        </div>

        <div
          className="lex-grid-3"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 24,
            paddingTop: 40,
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
          {[
            {
              t: 'Full Practice tier',
              b: 'Every Practice-tier feature is unlocked for 14 days - eight seats, unlimited matters, all integrations.',
            },
            {
              t: 'Free 60-min onboarding',
              b: 'A live walkthrough with our chambers liaison. Bring three matters; we’ll set them up with you.',
            },
            {
              t: 'One-click data export',
              b: 'Leave at any point and take a portable archive of every matter, draft, and document with you.',
            },
          ].map((item) => (
            <div key={item.t} style={{ borderTop: '1px solid var(--border-default)', paddingTop: 20 }}>
              <h3
                className="display"
                style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, letterSpacing: '-0.005em' }}
              >
                {item.t}
              </h3>
              <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                {item.b}
              </p>
            </div>
          ))}
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
              <Card key={c.eyebrow} hover style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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
              </Card>
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
              <div className="eyebrow" style={{ marginBottom: 6 }}>Compliance</div>
              <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                SOC 2 Type II · ISO 27001 · DPDP Act 2023. Indian-server residency by default.
              </p>
            </div>
          </div>
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
        .lex-card-hover { transition: border-color 200ms ease, transform 200ms ease; }
        .lex-card-hover:hover { border-color: var(--border-strong); transform: translateY(-2px); }

        /* ---------- WORKFLOW (compact connected timeline) ----------
           A single vertical rail runs through all markers. Steps are tight
           rows: numbered marker, then title + outcome on one line, body
           below. Hover lights the marker so the eye can follow the flow. */
        .lex-workflow {
          list-style: none;
          padding: 0;
          margin: 0;
          position: relative;
          padding-left: 56px;
        }
        .lex-workflow::before {
          content: '';
          position: absolute;
          top: 22px;
          bottom: 22px;
          left: 16px;
          width: 1px;
          background: linear-gradient(
            to bottom,
            var(--border-default) 0%,
            var(--border-default) 80%,
            transparent 100%
          );
          z-index: 0;
        }

        .lex-workflow-step {
          position: relative;
          padding: 14px 0;
        }
        .lex-workflow-step + .lex-workflow-step {
          border-top: 1px solid var(--border-subtle);
        }

        .lex-workflow-marker {
          position: absolute;
          left: -56px;
          top: 14px;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: var(--bg-base);
          border: 1px solid var(--border-default);
          font-family: var(--font-mono);
          font-size: 11px;
          font-weight: 500;
          color: var(--text-secondary);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          z-index: 1;
          transition:
            background 200ms ease,
            border-color 200ms ease,
            color 200ms ease,
            transform 200ms ease;
        }
        .lex-workflow-step:hover .lex-workflow-marker {
          background: var(--text-primary);
          border-color: var(--text-primary);
          color: var(--bg-base);
          transform: scale(1.06);
        }

        .lex-workflow-body {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .lex-workflow-row {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
        }
        .lex-workflow-title {
          font-family: var(--font-display);
          font-size: 17px;
          font-weight: 600;
          letter-spacing: -0.01em;
          color: var(--text-primary);
          margin: 0;
        }
        .lex-workflow-outcome {
          font-family: var(--font-mono);
          font-size: 11px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: var(--text-tertiary);
          display: inline-flex;
          align-items: center;
          gap: 8px;
          white-space: nowrap;
          transition: color 200ms ease;
        }
        .lex-workflow-step:hover .lex-workflow-outcome { color: var(--text-primary); }
        .lex-workflow-outcome-arrow {
          color: var(--border-strong);
          font-size: 13px;
          line-height: 1;
        }
        .lex-workflow-desc {
          font-size: 14px;
          color: var(--text-secondary);
          line-height: 1.6;
          margin: 0;
          max-width: 720px;
        }

        @media (max-width: 760px) {
          .lex-workflow { padding-left: 44px; }
          .lex-workflow::before { left: 11px; }
          .lex-workflow-marker { left: -44px; width: 24px; height: 24px; font-size: 10px; }
          .lex-workflow-row { gap: 8px; }
          .lex-workflow-outcome { font-size: 10px; letter-spacing: 0.14em; }
          .lex-workflow-desc { font-size: 13px; }
        }
        @media (prefers-reduced-motion: reduce) {
          .lex-workflow-marker,
          .lex-workflow-outcome { transition: none !important; }
          .lex-workflow-step:hover .lex-workflow-marker { transform: none; }
        }


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
          .lex-two-col { grid-template-columns: 1fr !important; gap: 40px !important; }
          .lex-trust-strip { grid-template-columns: repeat(2, 1fr) !important; }
        }
        @media (max-width: 640px) {
          .lex-grid-3 { grid-template-columns: 1fr !important; }
          .lex-trust-strip { grid-template-columns: 1fr 1fr !important; gap: 20px !important; }
          .lex-pricing-head { align-items: flex-start !important; }
        }

        @media (prefers-reduced-motion: reduce) {
          .lex-card-hover, .lex-card-hover:hover { transition: none !important; transform: none !important; }
          .lex-faq-marker { transition: none !important; }
        }
      `}</style>
    </div>
  );
}
