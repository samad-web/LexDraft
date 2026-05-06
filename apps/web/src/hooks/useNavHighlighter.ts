import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';
import { useLocation } from 'react-router-dom';

interface HighlighterRect {
  top: number;
  height: number;
  visible: boolean;
}

/**
 * Tracks the position+height of the currently-active `.nav-item` inside a
 * scrollable container so a single absolutely-positioned highlighter element
 * can be transitioned smoothly between items on route change.
 *
 * Returns `{ top, height, visible }`. `top` is relative to the container's
 * scrollable origin (so it works regardless of scroll position).
 */
export function useNavHighlighter(containerRef: RefObject<HTMLElement | null>): HighlighterRect {
  const location = useLocation();
  const [rect, setRect] = useState<HighlighterRect>({ top: 0, height: 0, visible: false });

  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const measure = () => {
      const active = node.querySelector<HTMLElement>('.nav-item.active');
      if (!active) {
        setRect((r) => ({ ...r, visible: false }));
        return;
      }
      // offsetTop is relative to the nearest positioned ancestor — when the
      // container is `position: relative` this is exactly what we want, and
      // it's stable across scroll position (unlike getBoundingClientRect).
      let top = 0;
      let el: HTMLElement | null = active;
      while (el && el !== node) {
        top += el.offsetTop;
        el = el.offsetParent as HTMLElement | null;
      }
      setRect({ top, height: active.offsetHeight, visible: true });
    };

    measure();

    // Re-measure when fonts/icons load (heights can shift slightly).
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => ro.disconnect();
  }, [containerRef, location.pathname]);

  // Window resize re-measure too (covers sidebar collapse/responsive shifts).
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const onResize = () => {
      const active = node.querySelector<HTMLElement>('.nav-item.active');
      if (!active) return;
      let top = 0;
      let el: HTMLElement | null = active;
      while (el && el !== node) {
        top += el.offsetTop;
        el = el.offsetParent as HTMLElement | null;
      }
      setRect({ top, height: active.offsetHeight, visible: true });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [containerRef]);

  return rect;
}
