import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { create } from 'zustand';
import { BRAND_PATHS as P } from '@/components/brand/Logo';
import { useAuthStore } from '@/store/auth';

/**
 * Launch animation for the Android app: "Di" grows into DifAi over an ink
 * line drawing of a working courtroom. Plays on the app's cold start, and on
 * the website and the app for 4 s right after every sign-in so the dashboard
 * doesn't just appear. Tap skips.
 * `?splash` shows it in the browser (for screenshots).
 */
const DURATION_MS = 2400;
const SIGN_IN_MS = 4000;
const REDUCED_MS = 900;
const FADE_MS = 300;

export const useSplashStore = create<{ showing: boolean; leaving: boolean; durationMs: number }>(() => ({
  showing: Capacitor.isNativePlatform() || new URLSearchParams(window.location.search).has('splash'),
  leaving: false,
  durationMs: DURATION_MS,
}));

/** Play the animation again from the start (re-mounts, so every line redraws). */
export function playSplash(durationMs: number): void {
  useSplashStore.setState({ showing: false, leaving: false });
  requestAnimationFrame(() => useSplashStore.setState({ showing: true, leaving: false, durationMs }));
}

// Website and app: play it right before the dashboard first appears - on
// sign-in (any route: Google, password, new account, MFA code), or, when the
// new Terms must be accepted first, on "I agree" (never over the Terms screen).
// A session restored at launch is not a sign-in.
useAuthStore.subscribe((state, prev) => {
  const ready = !!state.user && !state.user.needsTermsAcceptance;
  const wasReady = !!prev.user && !prev.user.needsTermsAcceptance;
  // No storage layer (persist off) means no restored session to mistake for a sign-in.
  if (ready && !wasReady && (useAuthStore.persist?.hasHydrated() ?? true)) playSplash(SIGN_IN_MS);
});

function close() {
  if (useSplashStore.getState().leaving) return;
  useSplashStore.setState({ leaving: true });
  setTimeout(() => useSplashStore.setState({ showing: false }), FADE_MS);
}

// Every line draws itself in (stroke-dasharray over a normalised length).
const L = { pathLength: 1 } as const;

function Fan({ x }: { x: number }) {
  return (
    <g>
      <line {...L} x1={x} y1={-84} x2={x} y2={34} />
      {/* Seen from below at an angle: flatten the spinning blades. */}
      <g transform={`translate(${x} 38) scale(1 0.26)`}>
        <g className="splash-fan">
          <circle {...L} r={6} />
          <path {...L} d="M0 -6 C 10 -30, 18 -46, 4 -58 M0 -6 C -4 -30, -2 -46, 4 -58" />
          <path {...L} d="M5 3 C 30 10, 48 16, 52 32 M5 3 C 26 22, 40 30, 52 32" />
          <path {...L} d="M-5 3 C -26 22, -40 30, -56 26 M-5 3 C -30 8, -46 14, -56 26" />
        </g>
      </g>
    </g>
  );
}

function Courtroom() {
  return (
    <svg className="splash-court" viewBox="0 -96 400 416" preserveAspectRatio="xMidYMax meet" aria-hidden focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round">
        {/* Room: ceiling, cornice, floor, columns, arched windows */}
        <line {...L} x1={0} y1={-90} x2={400} y2={-90} />
        <line {...L} x1={0} y1={-84} x2={400} y2={-84} />
        <line {...L} x1={0} y1={62} x2={400} y2={62} />
        <line {...L} x1={0} y1={68} x2={400} y2={68} />
        <line {...L} x1={0} y1={312} x2={400} y2={312} />
        <path {...L} d="M24 312V80H52V312M20 80H56M20 74H56" />
        <path {...L} d="M348 312V80H376V312M344 80H380M344 74H380" />
        <path {...L} d="M72 180V110A16 16 0 0 1 104 110V180Z M88 94V180 M72 140H104" />
        <path {...L} d="M296 180V110A16 16 0 0 1 328 110V180Z M312 94V180 M296 140H328" />

        <Fan x={130} />
        <Fan x={270} />

        {/* Scales on the wall above the chair (generic, not the State Emblem) */}
        <circle {...L} cx={200} cy={92} r={20} />
        <line {...L} x1={200} y1={78} x2={200} y2={106} />
        <g className="splash-scales">
          <line {...L} x1={186} y1={82} x2={214} y2={82} />
          <path {...L} d="M186 82L181 94H191Z M214 82L209 94H219Z" />
        </g>

        {/* Judge's high-backed chair and the judge */}
        <path {...L} d="M178 168V124Q200 112 222 124V168" />
        <circle {...L} cx={200} cy={142} r={8} />
        <path {...L} d="M184 168Q186 152 200 151Q214 152 216 168" />

        {/* Bench (dais) with panels, gavel */}
        <path {...L} d="M112 168H288V226H112Z M112 176H288" />
        <path {...L} d="M124 186H166V218H124Z M179 186H221V218H179Z M234 186H276V218H234Z" />
        <path {...L} d="M100 236H300 M112 226L100 236 M288 226L300 236" />
        <g className="splash-gavel">
          <line {...L} x1={248} y1={164} x2={264} y2={158} />
          <rect {...L} x={262} y={150} width={8} height={14} rx={1.5} transform="rotate(-20 266 157)" />
        </g>
        <line {...L} x1={256} y1={167} x2={272} y2={167} />

        {/* Clerk's table with files */}
        <path {...L} d="M150 262H250V270H150Z M158 270V306M242 270V306" />
        <path {...L} d="M160 262V254H184V262 M162 254V248H182V254 M214 262V256H238V262" />

        {/* Advocate at the lectern, seen from behind: head, bands, gown */}
        <path {...L} d="M54 312L62 270H96L104 312Z M60 262H100" />
        <circle {...L} cx={128} cy={246} r={9} />
        <path {...L} d="M110 312Q112 262 128 258Q144 262 146 312 M128 258V312" />
      </g>
    </svg>
  );
}

export function Splash() {
  const showing = useSplashStore((s) => s.showing);
  const leaving = useSplashStore((s) => s.leaving);
  const durationMs = useSplashStore((s) => s.durationMs);

  useEffect(() => {
    if (!showing) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const t = setTimeout(close, reduced ? REDUCED_MS : durationMs);
    return () => clearTimeout(t);
  }, [showing, durationMs]);

  if (!showing) return null;
  return (
    <div
      className={`splash${durationMs > DURATION_MS ? ' is-slow' : ''}${leaving ? ' is-leaving' : ''}`}
      role="img"
      aria-label="DifAi, powered by Sirah Digital"
      onClick={close}
    >
      <Courtroom />
      <div className="splash-brand">
        <svg className="splash-word" viewBox="0 0 758 266" aria-hidden focusable="false">
          {/* Starts with "Di" centred, then slides to make room for "fAi". */}
          <g className="splash-slide" fill="currentColor">
            <path className="splash-d" d={P.d} fillRule="evenodd" />
            <path className="splash-i" d={P.i1} />
            <circle className="splash-dot" {...P.i1Dot} />
            <g className="splash-rest">
              <path d={P.f} />
              <path d={P.fBar} />
              <path d={P.a} fillRule="evenodd" />
              <path d={P.i2} />
              <circle {...P.i2Dot} />
            </g>
          </g>
        </svg>
        <p className="splash-by">
          Powered by <strong>Sirah Digital</strong>
        </p>
      </div>
    </div>
  );
}
