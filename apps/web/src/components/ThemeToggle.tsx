import { Icon } from '@lexdraft/ui';
import { useUIStore } from '@/store/ui';

interface ThemeToggleProps {
  variant?: 'icon' | 'segmented';
}

export function ThemeToggle({ variant = 'icon' }: ThemeToggleProps) {
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);
  const toggleTheme = useUIStore((s) => s.toggleTheme);

  if (variant === 'segmented') {
    return (
      <div
        role="group"
        aria-label="Theme"
        style={{
          display: 'inline-flex',
          gap: 4,
          border: '1px solid var(--border-default)',
          padding: 2,
          background: 'var(--bg-surface)',
          borderRadius: 'var(--radius-full)',
        }}
      >
        {(['light', 'dark'] as const).map((t) => {
          const active = theme === t;
          return (
            <button
              key={t}
              type="button"
              onClick={() => setTheme(t)}
              aria-pressed={active}
              aria-label={`${t === 'light' ? 'Light' : 'Dark'} theme`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 28,
                height: 28,
                borderRadius: 'var(--radius-full)',
                background: active ? 'var(--text-primary)' : 'transparent',
                color: active ? 'var(--bg-base)' : 'var(--text-secondary)',
                border: 0,
                transition: 'background 180ms ease, color 180ms ease',
              }}
            >
              <Icon name={t === 'light' ? 'sun' : 'moon'} size={14} />
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <button
      type="button"
      className="btn btn-ghost"
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
      title={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
      style={{ padding: '0 8px' }}
    >
      <Icon name={theme === 'light' ? 'moon' : 'sun'} />
    </button>
  );
}
