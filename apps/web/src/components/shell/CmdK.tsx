import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@lexdraft/ui';
import { useUIStore } from '@/store/ui';
import { NAV_GROUPS } from './nav-config';

export function CmdK() {
  const navigate = useNavigate();
  const toggleCmdK = useUIStore((s) => s.toggleCmdK);
  const [q, setQ] = useState('');

  const all = useMemo(() => NAV_GROUPS.flatMap((g) => g.items.map((i) => ({ ...i, group: g.title }))), []);
  const filtered = useMemo(() => {
    if (!q.trim()) return all;
    const needle = q.toLowerCase();
    return all.filter((i) => i.label.toLowerCase().includes(needle) || i.group.toLowerCase().includes(needle));
  }, [q, all]);

  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === 'Escape') toggleCmdK(false); };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [toggleCmdK]);

  return (
    <>
      <div onClick={() => toggleCmdK(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', zIndex: 100 }} />
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: 'fixed',
          top: '15vh',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(640px, 92vw)',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--shadow-modal)',
          zIndex: 101,
          overflow: 'hidden',
        }}
      >
        <div className="row" style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-subtle)', gap: 12 }}>
          <Icon name="search" size={16} />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search the application…"
            style={{ flex: 1, background: 'transparent', border: 0, outline: 0, fontSize: 15, color: 'var(--text-primary)' }}
          />
          <span className="mono" style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>ESC</span>
        </div>
        <div style={{ maxHeight: 360, overflowY: 'auto', padding: 8 }}>
          {filtered.length === 0 && (
            <div style={{ padding: 28, textAlign: 'center' }} className="muted body-sm">
              No matches
            </div>
          )}
          {filtered.map((i) => (
            <button
              key={i.id}
              onClick={() => {
                navigate(i.to);
                toggleCmdK(false);
              }}
              className="row"
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 'var(--radius-md)',
                background: 'transparent',
                color: 'var(--text-primary)',
                gap: 12,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-surface)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <Icon name={i.icon} size={16} />
              <span style={{ flex: 1, textAlign: 'left' }}>{i.label}</span>
              <span className="eyebrow">{i.group}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
