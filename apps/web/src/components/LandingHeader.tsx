import type { CSSProperties } from 'react';
import { PillNav } from './PillNav';
import { ThemeToggle } from './ThemeToggle';

export type LandingTabId = 'home' | 'workflow' | 'pricing' | 'trial' | 'support';

interface LandingTab {
  id: LandingTabId;
  label: string;
}

interface LandingHeaderProps {
  tabs: ReadonlyArray<LandingTab>;
  activeTab: LandingTabId;
  onTabChange: (id: LandingTabId) => void;
  onSignIn: () => void;
  onTrial: () => void;
}

export function LandingHeader({ tabs, activeTab, onTabChange, onSignIn, onTrial }: LandingHeaderProps) {
  const headerStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: '1fr auto 1fr',
    alignItems: 'center',
    padding: '20px 48px',
    position: 'sticky',
    top: 0,
    background: 'color-mix(in srgb, var(--bg-base) 88%, transparent)',
    backdropFilter: 'saturate(160%) blur(12px)',
    WebkitBackdropFilter: 'saturate(160%) blur(12px)',
    zIndex: 30,
    borderBottom: '1px solid var(--border-subtle)',
  };

  return (
    <header className="lex-landing-header" style={headerStyle}>
      <div style={{ justifySelf: 'start' }}>
        <BrandMark />
      </div>
      <div className="lex-landing-nav" style={{ justifySelf: 'center' }}>
        <PillNav items={tabs} value={activeTab} onChange={onTabChange} ariaLabel="Primary" />
      </div>
      <div
        className="lex-landing-actions"
        style={{ justifySelf: 'end', display: 'flex', gap: 10, alignItems: 'center' }}
      >
        <ThemeToggle />
        <button
          className="btn lex-landing-signin"
          type="button"
          onClick={onSignIn}
        >
          Sign in
        </button>
        <button className="btn btn-primary" type="button" onClick={onTrial}>
          Begin trial
        </button>
      </div>
      <style>{`
        @media (max-width: 1023px) {
          .lex-landing-header { padding: 16px 24px !important; }
          .lex-landing-nav { display: none; }
          .lex-landing-header { grid-template-columns: 1fr auto !important; }
        }
        @media (max-width: 480px) {
          .lex-landing-signin { display: none; }
        }
      `}</style>
    </header>
  );
}

interface BrandMarkProps {
  size?: number;
  fontSize?: number;
}

export function BrandMark({ size = 24, fontSize = 19 }: BrandMarkProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span
        style={{
          width: size,
          height: size,
          background: 'var(--text-primary)',
          borderRadius: 'var(--radius-sm)',
          display: 'inline-block',
        }}
      />
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontSize,
          fontWeight: 600,
          letterSpacing: '-0.015em',
        }}
      >
        LexDraft
      </span>
    </div>
  );
}
