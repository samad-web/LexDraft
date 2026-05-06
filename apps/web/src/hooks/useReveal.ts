import { useEffect, useRef } from 'react';

/**
 * Adds the `in` class to the element when it scrolls into view, triggering
 * `.reveal` / `.reveal-stagger` CSS transitions. Reveals once and stops.
 */
export function useReveal<T extends HTMLElement = HTMLElement>(rootMargin = '0px 0px -10% 0px') {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (typeof IntersectionObserver === 'undefined') {
      el.classList.add('in');
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            (entry.target as HTMLElement).classList.add('in');
            io.unobserve(entry.target);
          }
        }
      },
      { rootMargin, threshold: 0.08 },
    );

    io.observe(el);
    return () => io.disconnect();
  }, [rootMargin]);

  return ref;
}
