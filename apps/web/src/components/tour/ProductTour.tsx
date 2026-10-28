import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { Wordmark } from '@/components/brand/Logo';
import { useAuthStore } from '@/store/auth';

// =============================================================================
// ProductTour - the first-visit guide. The first time a member reaches their
// dashboard, a short tour spotlights the real parts of the app one by one
// (dimmed page, a ring around the element, a card beside it) so they know
// where everything lives and what to do first. On phones it points at the
// bottom tab bar instead of the sidebar; a step whose element isn't on
// screen shows as a centred card. Seen once per user per device; restart it
// any time with startProductTour() (dashboard: More > Take the tour).
// =============================================================================

interface Step {
  /** CSS selectors, first visible match wins. None = centred card. */
  targets?: string[];
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    title: 'Welcome to DifAi',
    body: 'A one-minute tour of where everything lives, so you can find your way from day one. You can skip it any time.',
  },
  {
    targets: ['[data-tour="nav"]', '[data-tour="mobile-nav"]'],
    title: 'Everything, by area',
    body: 'Court, Matters, Work, Draft & AI, Research and Billing. Each area keeps its pages together as tabs, so nothing is more than two taps away.',
  },
  {
    targets: ['[data-tour="search"]:not([hidden])'],
    title: 'Find anything',
    body: 'Search any matter, CNR or client from here. On a computer, press Ctrl K from any page.',
  },
  {
    targets: ['[data-tour="kpis"]'],
    title: 'What needs you today',
    body: 'Hearings, limitation deadlines and objections at a glance. A red button means it must be acted on. Use Customise to choose your own cards.',
  },
  {
    targets: ['[data-tour="new-matter"]'],
    title: 'Start with your first matter',
    body: 'Add a matter and its CNR. DifAi connects it to eCourts and brings in the hearings, orders and next dates automatically.',
  },
  {
    targets: ['.sidebar a.nav-item[href="/app/causelist"]', '.mobile-nav-item[aria-label="Hearings"]'],
    title: 'Your cause list',
    body: 'Every hearing across your matters, synced from eCourts at 9 AM and 7 PM, with reminders before each date.',
  },
  {
    targets: ['.sidebar a.nav-item[href="/app/draft"]'],
    title: 'Draft with AI',
    body: 'Notices, complaints, bail applications, vakalatnamas and more, in Indian court format. Describe what you need; DifAi writes the whole document.',
  },
  {
    title: 'You are all set',
    body: 'Add your first matter to begin. You can take this tour again from the dashboard: More, then Take the tour.',
  },
];

const RESTART_EVENT = 'difai:tour';
const seenKey = (userId: string) => `difai-tour-done:${userId}`;

/** Restart the tour (e.g. from a menu). */
export function startProductTour(): void {
  window.dispatchEvent(new Event(RESTART_EVENT));
}

function findTarget(step: Step): HTMLElement | null {
  for (const sel of step.targets ?? []) {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      const r = el.getBoundingClientRect();
      // Must be laid out AND horizontally on screen: the phone sidebar is
      // rendered but slid off the left edge.
      const onScreen = r.right > 4 && r.left < window.innerWidth - 4;
      if (r.width > 0 && r.height > 0 && onScreen && getComputedStyle(el).visibility !== 'hidden') return el;
    }
  }
  return null;
}

type Rect = { top: number; left: number; width: number; height: number };
const PAD = 6;
const CARD_W = 340;

export function ProductTour() {
  const user = useAuthStore((s) => s.user);
  const actAs = useAuthStore((s) => s.actAs);
  const location = useLocation();
  const [index, setIndex] = useState<number | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardH, setCardH] = useState(220);

  const eligible = !!user && !user.isSuperadmin && !actAs;

  const finish = useCallback(() => {
    if (user) {
      try { localStorage.setItem(seenKey(user.id), new Date().toISOString()); } catch { /* storage blocked */ }
    }
    setIndex(null);
  }, [user]);

  // First visit: start once the dashboard has had a moment to render.
  useEffect(() => {
    if (!eligible || !user || location.pathname !== '/app/dashboard' || index !== null) return;
    let seen = false;
    try { seen = !!localStorage.getItem(seenKey(user.id)); } catch { seen = true; }
    if (seen) return;
    const t = window.setTimeout(() => setIndex(0), 900);
    return () => window.clearTimeout(t);
  }, [eligible, user, location.pathname, index]);

  // Restart on demand.
  useEffect(() => {
    const onRestart = () => { if (eligible) setIndex(0); };
    window.addEventListener(RESTART_EVENT, onRestart);
    return () => window.removeEventListener(RESTART_EVENT, onRestart);
  }, [eligible]);

  const step = index === null ? null : STEPS[index] ?? null;

  // Follow the target through scrolling, resizing and late layout.
  useEffect(() => {
    if (!step) return;
    let raf = 0;
    let scrolled = false;
    const tick = () => {
      const el = findTarget(step);
      if (el) {
        if (!scrolled) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); scrolled = true; }
        const r = el.getBoundingClientRect();
        setRect((prev) => (prev && prev.top === r.top && prev.left === r.left && prev.width === r.width && prev.height === r.height
          ? prev : { top: r.top, left: r.left, width: r.width, height: r.height }));
      } else {
        setRect(null);
      }
      raf = window.requestAnimationFrame(tick);
    };
    tick();
    return () => window.cancelAnimationFrame(raf);
  }, [step]);

  useLayoutEffect(() => {
    if (cardRef.current) setCardH(cardRef.current.offsetHeight);
  }, [index, rect?.width]);

  // Keyboard: Esc skips, arrows move.
  useEffect(() => {
    if (index === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
      else if (e.key === 'ArrowRight') {
        if (index + 1 >= STEPS.length) finish();
        else setIndex(index + 1);
      } else if (e.key === 'ArrowLeft' && index > 0) setIndex(index - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, finish]);

  if (index === null || !step) return null;

  const last = index === STEPS.length - 1;
  const next = () => (last ? finish() : setIndex(index + 1));
  const back = () => setIndex(Math.max(0, index - 1));

  // Card placement: below the spotlight if it fits, else above, else centred.
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(CARD_W, vw - 24);
  let cardStyle: React.CSSProperties;
  if (rect) {
    const spaceBelow = vh - (rect.top + rect.height + PAD);
    const spaceAbove = rect.top - PAD;
    const left = Math.min(Math.max(12, rect.left + rect.width / 2 - w / 2), vw - w - 12);
    if (spaceBelow >= cardH + 16) cardStyle = { top: rect.top + rect.height + PAD + 12, left, width: w };
    else if (spaceAbove >= cardH + 16) cardStyle = { top: rect.top - PAD - 12 - cardH, left, width: w };
    else if (rect.left + rect.width + PAD + 16 + w < vw) cardStyle = { top: Math.min(Math.max(12, rect.top), vh - cardH - 12), left: rect.left + rect.width + PAD + 16, width: w };
    else cardStyle = { top: Math.max(12, vh / 2 - cardH / 2), left: vw / 2 - w / 2, width: w };
  } else {
    cardStyle = { top: Math.max(12, vh / 2 - cardH / 2), left: vw / 2 - w / 2, width: w };
  }

  return createPortal(
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {rect ? (
        <div
          className="tour-spot"
          style={{ top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }}
        />
      ) : (
        <div className="tour-dim" />
      )}
      {/* Clicks outside the card do nothing (the tour is short and skippable). */}
      <div className="tour-block" />
      <div ref={cardRef} className="tour-card" style={cardStyle} key={index}>
        {!step.targets && (
          <span className="tour-mark"><Wordmark height={26} /></span>
        )}
        <div className="tour-count">Step {index + 1} of {STEPS.length}</div>
        <h2 id="tour-title" className="tour-title">{step.title}</h2>
        <p className="tour-body">{step.body}</p>
        <div className="tour-dots" aria-hidden>
          {STEPS.map((_, i) => <span key={i} className={i === index ? 'on' : undefined} />)}
        </div>
        <div className="tour-actions">
          {!last && <button type="button" className="btn btn-ghost btn-sm" onClick={finish}>Skip tour</button>}
          <span style={{ flex: 1 }} />
          {index > 0 && <button type="button" className="btn btn-sm" onClick={back}>Back</button>}
          <button type="button" className="btn btn-primary btn-sm" onClick={next} autoFocus>
            {index === 0 ? 'Show me around' : last ? 'Get started' : 'Next'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
