import type { CSSProperties } from 'react';
import { PillNav } from './PillNav';
import { ThemeToggle } from './ThemeToggle';
import { FullLogo } from './brand/Logo';

export type LandingTabId = 'home' | 'features' | 'pricing' | 'faq' | 'trial';

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
        {/* Phones and tablets hide the tab bar, so Pricing gets its own
            button: it scrolls to the pricing cards on this page. */}
        <button className="btn lex-landing-pricing" type="button" onClick={() => onTabChange('pricing')}>
          Pricing
        </button>
        <button
          className="btn lex-landing-signin"
          type="button"
          onClick={onSignIn}
        >
          Sign in
        </button>
        <button className="btn btn-primary" type="button" onClick={onTrial}>
          Get started
        </button>
      </div>
      <style>{`
        .lex-landing-pricing { display: none; }
        @media (max-width: 1023px) {
          .lex-landing-pricing { display: inline-flex; }
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

export function BrandMark({ height = 36 }: { height?: number }) {
  return <FullLogo height={height} />;
}
