import { useEffect, useState } from 'react';

interface Shortcut {
  keys: string[];
  description: string;
  /** Optional grouping header — e.g. "Navigation", "Editing". */
  group?: string;
}

const SHORTCUTS: Shortcut[] = [
  { group: 'Global', keys: ['?'], description: 'Show this keyboard reference' },
  { group: 'Global', keys: ['Cmd', 'K'], description: 'Open the command palette' },
  { group: 'Global', keys: ['Esc'], description: 'Close any open dialog or panel' },
  { group: 'Tables', keys: ['Tab'], description: 'Move between sortable column headers' },
  { group: 'Tables', keys: ['Enter'], description: 'Toggle sort on the focused column' },
  { group: 'Forms', keys: ['Tab'], description: 'Move to the next field' },
  { group: 'Forms', keys: ['Shift', 'Tab'], description: 'Move to the previous field' },
  { group: 'Forms', keys: ['Enter'], description: 'Submit the current form' },
];

/**
 * Press `?` anywhere (outside an input) to surface a quick reference of
 * keyboard shortcuts. Mounted at the app root by AppShell so the keymap
 * is always live.
 */
export function KeyboardShortcuts() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // `?` requires Shift+/ on most layouts; ignore while typing in inputs.
      if (e.key !== '?' && e.key !== 'Escape') return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      if (e.key === 'Escape') { setOpen(false); return; }
      e.preventDefault();
      setOpen((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!open) return null;

  const groups = new Map<string, Shortcut[]>();
  for (const s of SHORTCUTS) {
    const g = s.group ?? 'Other';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(s);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="kbd-title"
      onClick={() => setOpen(false)}
      className="modal-overlay is-visible"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="modal-shell is-visible"
        style={{ ['--modal-width' as string]: '520px' }}
      >
        <span aria-hidden className="modal-grabber" />
        <div>
          <div className="eyebrow" style={{ marginBottom: 4 }}>Reference</div>
          <h3 id="kbd-title" className="display" style={{ fontSize: 22, fontWeight: 600 }}>
            Keyboard shortcuts
          </h3>
        </div>
        {Array.from(groups.entries()).map(([group, items]) => (
          <div key={group}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>{group}</div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {items.map((s, i) => (
                <li key={i} className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="body-sm" style={{ color: 'var(--text-secondary)' }}>
                    {s.description}
                  </span>
                  <span className="row" style={{ gap: 4 }}>
                    {s.keys.map((k, ki) => (
                      <kbd key={ki} className="kbd">{k}</kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div className="modal-footer">
          <button type="button" className="btn" onClick={() => setOpen(false)}>Close</button>
        </div>
      </div>
    </div>
  );
}
