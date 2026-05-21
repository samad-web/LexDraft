import { useEffect, useLayoutEffect, useRef } from 'react';

interface PillNavItem<T extends string> {
  id: T;
  label: string;
  title?: string;
}

interface PillNavProps<T extends string> {
  items: ReadonlyArray<PillNavItem<T>>;
  value: T;
  onChange: (id: T) => void;
  ariaLabel?: string;
  /** Allow items to wrap to multiple rows. Indicator animates in 2D. */
  wrap?: boolean;
  /** Extra class on the container — for caller-specific styling. */
  className?: string;
}

export function PillNav<T extends string>({
  items,
  value,
  onChange,
  ariaLabel,
  wrap,
  className,
}: PillNavProps<T>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const indicatorRef = useRef<HTMLSpanElement | null>(null);
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const primedRef = useRef(false);

  const place = (animate: boolean) => {
    const container = containerRef.current;
    const indicator = indicatorRef.current;
    const btn = buttonRefs.current[value];
    if (!container || !indicator || !btn) return;

    const cRect = container.getBoundingClientRect();
    const bRect = btn.getBoundingClientRect();
    const x = bRect.left - cRect.left - container.clientLeft;
    const y = bRect.top - cRect.top - container.clientTop;
    const w = bRect.width;
    const h = bRect.height;

    if (!animate) {
      indicator.style.transition = 'none';
      indicator.style.transform = `translate(${x}px, ${y}px)`;
      indicator.style.width = `${w}px`;
      indicator.style.height = `${h}px`;
      indicator.style.opacity = '1';
      // Force reflow so subsequent mutations trigger a transition.
      void indicator.offsetWidth;
      indicator.style.transition = '';
      return;
    }

    // Read the indicator's current screen position so the keyframe animation
    // starts exactly where the pill currently is.
    const iRect = indicator.getBoundingClientRect();
    const fromX = iRect.left - cRect.left - container.clientLeft;
    const fromY = iRect.top - cRect.top - container.clientTop;
    const fromW = iRect.width;
    const fromH = iRect.height;

    // First placement after the indicator was hidden (e.g. when the active
    // item wasn't in the previous render's item set): snap to position
    // instead of animating a "grow from nothing" blob.
    if (fromW === 0 || fromH === 0) {
      indicator.style.transition = 'none';
      indicator.style.transform = `translate(${x}px, ${y}px)`;
      indicator.style.width = `${w}px`;
      indicator.style.height = `${h}px`;
      indicator.style.opacity = '1';
      void indicator.offsetWidth;
      indicator.style.transition = '';
      return;
    }

    // Same-row moves get the horizontal stretch keyframe; cross-row moves
    // ease diagonally without stretching (a stretched diagonal blob looks off).
    const sameRow = Math.abs(y - fromY) < 2;
    const distance = Math.abs(x - fromX);
    const midX = (fromX + x) / 2;
    const stretchExtra = sameRow ? Math.min(distance * 0.3, 80) : 0;
    const midW = Math.max(fromW, w) + stretchExtra;

    // Cancel any in-flight animation so rapid clicks don't queue.
    indicator.getAnimations().forEach((a) => a.cancel());

    const DURATION = sameRow ? 1400 : 720;
    const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';

    const keyframes: Keyframe[] = sameRow
      ? [
          {
            transform: `translate(${fromX}px, ${fromY}px)`,
            width: `${fromW}px`,
            height: `${fromH}px`,
            easing: EASE,
          },
          // Midpoint: pill stretches in the direction of motion.
          {
            transform: `translate(${midX - stretchExtra / 2}px, ${fromY}px)`,
            width: `${midW}px`,
            height: `${fromH}px`,
            offset: 0.5,
            easing: EASE,
          },
          {
            transform: `translate(${x}px, ${y}px)`,
            width: `${w}px`,
            height: `${h}px`,
          },
        ]
      : [
          {
            transform: `translate(${fromX}px, ${fromY}px)`,
            width: `${fromW}px`,
            height: `${fromH}px`,
            easing: EASE,
          },
          {
            transform: `translate(${x}px, ${y}px)`,
            width: `${w}px`,
            height: `${h}px`,
          },
        ];

    const anim = indicator.animate(keyframes, { duration: DURATION, easing: EASE, fill: 'forwards' });

    // Lock the resting state so future repositions read a stable transform.
    anim.addEventListener('finish', () => {
      indicator.style.transform = `translate(${x}px, ${y}px)`;
      indicator.style.width = `${w}px`;
      indicator.style.height = `${h}px`;
    });
  };

  useLayoutEffect(() => {
    const animate = primedRef.current;
    place(animate);
    primedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, items.length]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onChangeSize = () => place(false);
    const ro = new ResizeObserver(onChangeSize);
    ro.observe(container);
    container.querySelectorAll('button').forEach((b) => ro.observe(b));
    window.addEventListener('resize', onChangeSize);

    if (document.fonts && typeof document.fonts.ready?.then === 'function') {
      document.fonts.ready.then(() => place(false)).catch(() => undefined);
    }

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', onChangeSize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const classes = ['pill-nav'];
  if (wrap) classes.push('pill-nav--wrap');
  if (className) classes.push(className);

  return (
    <div ref={containerRef} className={classes.join(' ')} role="tablist" aria-label={ariaLabel}>
      <span ref={indicatorRef} className="pill-nav-indicator" aria-hidden="true" />
      {items.map((item) => {
        const active = value === item.id;
        return (
          <button
            key={item.id}
            ref={(el) => {
              buttonRefs.current[item.id] = el;
            }}
            type="button"
            role="tab"
            aria-selected={active}
            className={active ? 'active' : ''}
            onClick={() => onChange(item.id)}
            title={item.title}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
