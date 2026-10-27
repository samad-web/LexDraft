/**
 * Animated light <-> dark switch, used by every theme control (store/ui.ts).
 *
 * "Paper laid over the page": with View Transitions (Chrome, Edge, Safari
 * 18+) the new theme arrives as a sheet that sweeps across from the side the
 * user clicked - a torn, deckled leading edge, a soft shadow cast on the old
 * page, and a slight 3D lift that flattens as the sheet settles. The old page
 * dims and sinks a touch beneath it.
 *
 *  - Keyboard / Ctrl K (no recent click): the sheet comes from the centre-left.
 *  - No View Transitions: every colour cross-fades (html.theme-fading).
 *  - prefers-reduced-motion: instant swap.
 */

type Apply = () => void;

interface ViewTransitionLike {
  ready: Promise<void>;
  finished: Promise<void>;
}

// Where the last pointer press happened - so any toggle (top bar, landing,
// sign-in, Ctrl K) starts the sheet from the right side without plumbing.
let lastPress: { x: number; y: number; at: number } | null = null;
if (typeof window !== 'undefined') {
  window.addEventListener(
    'pointerdown',
    (e) => { lastPress = { x: e.clientX, y: e.clientY, at: Date.now() }; },
    { capture: true, passive: true },
  );
}

const reducedMotion = (): boolean =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const DURATION = 950;
const EASE = 'cubic-bezier(0.45, 0, 0.2, 1)';
const EDGE_POINTS = 36;

// Fixed "torn paper" profile: a few long waves plus fibre-sized jitter, so the
// edge looks hand-torn but is the same shape in every frame (required for the
// clip-path to interpolate).
const DECKLE: number[] = Array.from({ length: EDGE_POINTS }, (_, i) => {
  const t = i / (EDGE_POINTS - 1);
  const jitter = Math.sin(i * 12.9898) * 43758.5453;
  return 9 * Math.sin(t * Math.PI * 3.2) + 5 * Math.sin(t * Math.PI * 9.7 + 1.3) + 6 * (jitter - Math.floor(jitter) - 0.5);
});

let running = false;

export function switchThemeAnimated(apply: Apply): void {
  if (typeof document === 'undefined' || reducedMotion() || running) { apply(); return; }

  const doc = document as Document & { startViewTransition?: (cb: () => void) => ViewTransitionLike };
  const root = document.documentElement;

  if (!doc.startViewTransition) {
    root.classList.add('theme-fading');
    apply();
    window.setTimeout(() => root.classList.remove('theme-fading'), 450);
    return;
  }

  const w = window.innerWidth;
  const h = window.innerHeight;
  const recent = lastPress && Date.now() - lastPress.at < 1500 ? lastPress : null;
  const ox = recent?.x ?? w * 0.15;
  const oy = recent?.y ?? h * 0.5;

  // Sweep direction: from the click towards the farthest corner.
  const corners = [[0, 0], [w, 0], [0, h], [w, h]] as const;
  const far = corners.reduce((a, c) => (Math.hypot(c[0] - ox, c[1] - oy) > Math.hypot(a[0] - ox, a[1] - oy) ? c : a));
  const len = Math.hypot(far[0] - ox, far[1] - oy) || 1;
  const dx = (far[0] - ox) / len;
  const dy = (far[1] - oy) / len;
  const px = -dy;
  const py = dx;
  const along = corners.map((c) => (c[0] - ox) * dx + (c[1] - oy) * dy);
  const s0 = Math.min(...along) - 40;
  const s1 = Math.max(...along) + 40;
  const span = Math.hypot(w, h) * 1.2;

  // The sheet's area: everything behind a torn line at distance `s` along the sweep.
  const sheet = (s: number): string => {
    const lx = ox + dx * s;
    const ly = oy + dy * s;
    const pts: string[] = [];
    for (let i = 0; i < EDGE_POINTS; i++) {
      const u = -span + (2 * span * i) / (EDGE_POINTS - 1);
      const k = DECKLE[i]!;
      pts.push(`${(lx + px * u + dx * k).toFixed(1)}px ${(ly + py * u + dy * k).toFixed(1)}px`);
    }
    pts.push(`${(lx + px * span - dx * span * 2).toFixed(1)}px ${(ly + py * span - dy * span * 2).toFixed(1)}px`);
    pts.push(`${(lx - px * span - dx * span * 2).toFixed(1)}px ${(ly - py * span - dy * span * 2).toFixed(1)}px`);
    return `polygon(${pts.join(', ')})`;
  };

  // Lift: the sheet starts tilted off the page (hinged at the near edge) and flattens.
  const hx = ox + dx * s0;
  const hy = oy + dy * s0;

  running = true;
  root.classList.add('theme-vt');

  const vt = doc.startViewTransition(apply);
  vt.ready
    .then(() => {
      root.animate(
        {
          clipPath: [sheet(s0), sheet(s1)],
          transform: [
            `perspective(1800px) rotate3d(${px.toFixed(3)}, ${py.toFixed(3)}, 0, -9deg) scale(1.015)`,
            'perspective(1800px) rotate3d(0, 0, 1, 0deg) scale(1)',
          ],
          transformOrigin: [`${hx}px ${hy}px`, `${hx}px ${hy}px`],
        },
        { duration: DURATION, easing: EASE, pseudoElement: '::view-transition-new(root)' },
      );
      root.animate(
        { transform: ['scale(1)', 'scale(0.985)'], filter: ['brightness(1)', 'brightness(0.82)'] },
        { duration: DURATION, easing: EASE, pseudoElement: '::view-transition-old(root)' },
      );
    })
    .catch(() => { /* transition skipped - the theme is already applied */ });
  vt.finished.finally(() => {
    running = false;
    root.classList.remove('theme-vt');
  });
}
