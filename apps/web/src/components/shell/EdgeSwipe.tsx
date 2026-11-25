import { useEffect, useRef } from 'react';
import { Icon } from '@lexdraft/ui';
import { useUIStore } from '@/store/ui';
import { isDrawerWidth, swipeDone, swipeStart, type SwipeStart } from '@/lib/edge-swipe';

/** ios-sidebar-swipe: swipe in from the left edge to open the menu, swipe it
 *  back to close, and (on phones) a small handle on the edge to tap. */
export function EdgeSwipe() {
  const open = useUIStore((s) => s.sidebarOpen);
  const toggle = useUIStore((s) => s.toggleSidebar);
  const start = useRef<SwipeStart>(null);
  const state = useRef({ open });
  state.current.open = open;

  useEffect(() => {
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t || e.touches.length > 1) { start.current = null; return; }
      const el = e.target instanceof Element ? e.target : null;
      start.current = swipeStart(
        {
          x: t.clientX, y: t.clientY,
          onHandle: !!el?.closest('.edge-handle, .sidebar'),
          inOverlay: !!el?.closest('.rv, [role="dialog"], .modal-shell, .modal'),
        },
        { open: state.current.open, drawerMode: isDrawerWidth(window.innerWidth) },
      );
    };
    const onMove = (e: TouchEvent) => {
      const s = start.current;
      const t = e.touches[0];
      if (!s || !t || !swipeDone(s, t.clientX, t.clientY)) return;
      start.current = null;
      toggle(s.mode === 'open');
    };
    const onEnd = () => { start.current = null; };
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: true });
    document.addEventListener('touchend', onEnd, { passive: true });
    document.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
    };
  }, [toggle]);

  if (open) return null;
  return (
    <button type="button" className="edge-handle" aria-label="Open menu" title="Open menu (or swipe in from the left edge)" onClick={() => toggle(true)}>
      <Icon name="menu" size={14} />
    </button>
  );
}
