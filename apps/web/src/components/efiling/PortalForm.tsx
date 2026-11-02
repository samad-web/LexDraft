import type { ReactNode } from 'react';

// =============================================================================
// The building blocks every filing.ecourts.gov.in form page is made of, in
// DifAi's black and white - so each eFiling screen is laid out exactly as the
// portal lays it out:
//
//   PortalPage        centred page heading + "Fields marked with * are required."
//   PortalSearchCase  the bordered "Search Case | ○ … ○ … | Search Keyword * | [Select]" row
//   PortalSection     a full-width band: title left, "Note: …" right
//   PortalFormGrid    rows of  label * | field | label * | field  (labels right-aligned)
//   PortalFormRow     one label + field pair inside a PortalFormGrid
//   PortalPanel       a grey bordered box (the portal's form/panel cards)
//   PortalButton      the portal's rounded button with an optional icon
//   PortalTabs        the portal's tab strip (icon + label, active tab filled)
//   PortalInput / PortalSelect   compact controls sized as the portal's
// =============================================================================

export function PortalPage({ title, required = 'Fields marked with * are required.', tools, children }: {
  title?: string;
  /** The portal's note under the heading; pass null where the page has none. */
  required?: string | null;
  /** Page tools (the portal's round + / edit / PDF / delete icons at the right). */
  tools?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="col" style={{ gap: 12 }}>
      {tools ? <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>{tools}</div> : null}
      {title ? <h2 style={{ margin: 0, textAlign: 'center', fontSize: 22, fontWeight: 700 }}>{title}</h2> : null}
      {required ? <p style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{required}</p> : null}
      {children}
    </div>
  );
}

const labelCell: React.CSSProperties = { background: 'var(--bg-surface-2)', fontWeight: 700, fontSize: 14, padding: '10px 12px', display: 'flex', alignItems: 'center' };

/** The portal's "Search Case" box: label cell, choices, label cell, the case picker. */
export function PortalSearchCase({ label = 'Search Case', choices, pickerLabel, required = true, picker }: {
  label?: string;
  choices: ReactNode;
  pickerLabel: string;
  required?: boolean;
  picker: ReactNode;
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 1fr) 3fr minmax(140px, 1.1fr) 2.2fr', border: '1px solid var(--border-default)', borderRadius: 4, boxShadow: '0 1px 0 var(--border-default)' }}>
      <div style={labelCell}>{label}</div>
      <div className="row" style={{ gap: 16, alignItems: 'center', padding: '8px 12px', flexWrap: 'wrap' }}>{choices}</div>
      <div style={labelCell}>{pickerLabel}{required ? <Star /> : null}</div>
      <div style={{ padding: 8, display: 'flex', alignItems: 'center' }}>{picker}</div>
    </div>
  );
}

export function Star() {
  return <span aria-hidden style={{ marginLeft: 4, fontWeight: 700 }}>*</span>;
}

/** A full-width section band: title on the left, the portal's note on the right. */
export function PortalSection({ title, note, children }: { title: string; note?: string; children?: ReactNode }) {
  return (
    <section className="col" style={{ gap: 0 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '6px 20px', background: 'var(--bg-inverse)', color: 'var(--text-inverse)' }}>
        <strong style={{ fontSize: 16 }}>{title}</strong>
        {note ? <em style={{ fontSize: 12, fontWeight: 700 }}>{note}</em> : null}
      </div>
      {children ? <div style={{ border: '1px solid var(--border-default)', borderTop: 'none', padding: '10px 0' }}>{children}</div> : null}
    </section>
  );
}

/** Rows of label | field pairs, two pairs per row as on the portal (one on narrow screens). */
export function PortalFormGrid({ children, columns = 2 }: { children: ReactNode; columns?: 1 | 2 }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: columns === 2 ? 'repeat(auto-fit, minmax(420px, 1fr))' : '1fr', columnGap: 24, rowGap: 10, padding: '6px 12px' }}>
      {children}
    </div>
  );
}

/** One label + field pair: the label right-aligned with its * after it, the field beside it. */
export function PortalFormRow({ label, required, children, wide }: { label: ReactNode; required?: boolean; children: ReactNode; wide?: boolean }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 0.9fr) 1.3fr', alignItems: 'center', columnGap: 18, gridColumn: wide ? '1 / -1' : undefined }}>
      <span style={{ textAlign: 'right', fontWeight: 700, fontSize: 14 }}>{label}{required ? <Star /> : null}</span>
      <span style={{ minWidth: 0 }}>{children}</span>
    </div>
  );
}

/** The portal's grey bordered box. */
export function PortalPanel({ children, padding = 14 }: { children: ReactNode; padding?: number }) {
  return <div style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border-default)', borderRadius: 4, padding }}>{children}</div>;
}

/** The portal's rounded button (filled: Submit / Search / View Transaction; outline: Reset / Clear). */
export function PortalButton({ children, onClick, disabled, outline, icon, type = 'button', title }: {
  children: ReactNode; onClick?: () => void; disabled?: boolean; outline?: boolean; icon?: ReactNode; type?: 'button' | 'submit'; title?: string;
}) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 18, fontWeight: 700, fontSize: 14, cursor: disabled ? 'default' : 'pointer',
        background: outline ? 'var(--bg-surface)' : 'var(--bg-inverse)', color: outline ? 'var(--text-primary)' : 'var(--text-inverse)',
        border: '1px solid var(--bg-inverse)', opacity: disabled ? 0.5 : 1,
      }}>
      {icon ? <span aria-hidden style={{ display: 'inline-flex' }}>{icon}</span> : null}{children}
    </button>
  );
}

/** The portal's tab strip: each tab an icon and label, the open one filled. */
export function PortalTabs<T extends string>({ tabs, active, onPick }: {
  tabs: ReadonlyArray<{ key: T; label: string; icon?: ReactNode; disabled?: boolean }>;
  active: T;
  onPick: (k: T) => void;
}) {
  return (
    <div role="tablist" className="row" style={{ gap: 4, flexWrap: 'wrap', borderBottom: '1px solid var(--border-default)' }}>
      {tabs.map((t) => (
        <button key={t.key} type="button" role="tab" aria-selected={active === t.key} disabled={t.disabled} onClick={() => onPick(t.key)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: 15, cursor: t.disabled ? 'default' : 'pointer',
            border: '1px solid var(--border-default)', borderBottom: 'none', borderRadius: '4px 4px 0 0', marginBottom: -1,
            background: active === t.key ? 'var(--bg-inverse)' : 'var(--bg-surface)', color: active === t.key ? 'var(--text-inverse)' : 'var(--text-primary)',
            opacity: t.disabled ? 0.5 : 1,
          }}>
          {t.icon ? <span aria-hidden style={{ display: 'inline-flex' }}>{t.icon}</span> : null}{t.label}
        </button>
      ))}
    </div>
  );
}

const control: React.CSSProperties = { width: '100%', height: 32, padding: '0 8px', fontSize: 14, border: '1px solid var(--text-primary)', borderRadius: 3, background: 'var(--bg-surface)', color: 'var(--text-primary)' };

export function PortalInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} style={{ ...control, ...props.style }} />;
}

export function PortalSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} style={{ ...control, ...props.style }} />;
}

/** A scrolling notice box (the portal's Terms and Conditions block). */
export function PortalNotice({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div style={{ border: '1px solid var(--text-primary)', borderRadius: 4, padding: 8, maxHeight: 340, overflowY: 'auto', fontSize: 14 }}>
      {title ? <strong>{title}</strong> : null}
      <div>{children}</div>
    </div>
  );
}
