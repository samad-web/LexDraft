import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@lexdraft/ui';

export interface PageHeaderProps {
  /** The page name. Matches the sidebar label (or the active tab's label). */
  title: ReactNode;
  /** One plain sentence on what this page is for. */
  description?: ReactNode;
  /** Small counts/status line under the title, e.g. "42 matters". */
  meta?: ReactNode;
  /**
   * Buttons on the right. Convention: at most one `btn-primary` (the main
   * thing people come here to do), placed last; everything else plain `btn`.
   */
  actions?: ReactNode;
  /** Detail pages: link back to the parent list. */
  back?: { label: string; to: string };
  /** Content under the title row - search/filter bars, summary chips. */
  children?: ReactNode;
}

/**
 * The one page header for every firm-app page. The Topbar already shows
 * where you are (section › page), so pages don't add their own eyebrow.
 */
export function PageHeader({ title, description, meta, actions, back, children }: PageHeaderProps) {
  const navigate = useNavigate();
  return (
    <header className="page-header">
      {back && (
        <button type="button" className="page-header-back" onClick={() => navigate(back.to)}>
          <Icon name="chevron" size={14} style={{ transform: 'rotate(180deg)' }} />          {back.label}
        </button>
      )}
      <div className="page-header-row">
        <div className="page-header-text">
          <h1 className="heading-xl">{title}</h1>
          {description && <p className="body-sm muted page-header-desc">{description}</p>}
          {meta && <div className="mono page-header-meta">{meta}</div>}
        </div>
        {actions && <div className="page-header-actions">{actions}</div>}
      </div>
      {children && <div className="page-header-extra">{children}</div>}
    </header>
  );
}

/** Search box sized for PageHeader / filter bars; fills the row on phones. */
export function PageSearch({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  label: string;
}) {
  return (
    <div className="page-search">
      <Icon name="search" size={14} className="page-search-icon" />
      <input
        type="search"
        className="input"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
      />
    </div>
  );
}
