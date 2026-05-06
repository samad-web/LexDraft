import { useEffect, useLayoutEffect, useRef } from 'react';

interface PillNavItem<T extends string> {
  id: T;
  label: string;
}

interface PillNavProps<T extends string> {
  items: ReadonlyArray<PillNavItem<T>>;
  value: T;
  onChange: (id: T) => void;
  ariaLabel?: string;
}

export function PillNav<T extends string>({ items, value, onChange, ariaLabel }: PillNavProps<T>) {
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
    const w = bRect.width;

    if (!animate) {
      indicator.style.transition = 'none';
      indicator.style.transform = `translateX(${x}px)`;
      indicator.style.width = `${w}px`;
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
    const fromW = iRect.width;
    const distance = Math.abs(x - fromX);
    const midX = (fromX + x) / 2;
    // Stretch the pill toward the target during transit — capped so long jumps
    // don't look cartoony.
    const stretchExtra = Math.min(distance * 0.3, 80);
    const midW = Math.max(fromW, w) + stretchExtra;

    // Cancel any in-flight animation so rapid clicks don't queue.
    indicator.getAnimations().forEach((a) => a.cancel());

    const DURATION = 1400;
    const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';

    const anim = indicator.animate(
      [
        { transform: `translateX(${fromX}px)`, width: `${fromW}px`, easing: EASE },
        // Midpoint: pill stretches in the direction of motion.
        { transform: `translateX(${midX - stretchExtra / 2}px)`, width: `${midW}px`, offset: 0.5, easing: EASE },
        { transform: `translateX(${x}px)`, width: `${w}px` },
      ],
      { duration: DURATION, easing: EASE, fill: 'forwards' },
    );

    // Lock the resting state so future repositions read a stable transform.
    anim.addEventListener('finish', () => {
      indicator.style.transform = `translateX(${x}px)`;
      indicator.style.width = `${w}px`;
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

  return (
    <div ref={containerRef} className="pill-nav" role="tablist" aria-label={ariaLabel}>
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
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
