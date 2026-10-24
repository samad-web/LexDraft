import type { ReactNode } from 'react';
import { Icon } from '@lexdraft/ui';
import type { LandService } from '@/hooks/useLandRecords';

// =============================================================================
// Tamil Nadu Land Records eServices (eservices.tn.gov.in) building blocks, in
// LexDraft's monochrome design system. Advocates know the site's screens, so
// every service follows its shape:
//
//   ▌Land Records - View A-Register Extract                  Home ▐   title bar
//   District [▾]      Taluk [▾]      Village [▾]                     one row
//   Land Type: ( ) Rural ( ) Natham                    (taluks with Natham)
//   1. If Survey Number is 24/2A, please enter 24 ...                 hints
//   Survey Number [  ]     Sub Division Number* [▾]
//   [Mobile No(10 digit)] [Get OTP]   [OTP(6 digit)] [Confirm OTP]
//                         [ Submit ]
//
// The site's blue gradient bars become inverse bars (black in light mode,
// white in dark mode) - structure from the site, colour from LexDraft.
// =============================================================================

export interface LandServiceMeta {
  id: LandService;
  /** The site's menu label, verbatim. */
  label: string;
  /** The site's page title ("Land Records - ..."). */
  screenTitle: string;
  gate: 'otp' | 'captcha';
  blurb: string;
}

/** The site's home menu, in its order. */
export const LAND_MENU: ReadonlyArray<LandServiceMeta> = [
  { id: 'patta', label: 'View Patta / Chitta / FMB - (Rural / Natham)', screenTitle: 'View Patta / Chitta', gate: 'otp', blurb: 'Owner, extent and tax of a survey field, by Patta Number or Survey Number.' },
  { id: 'a-register', label: 'View A-Register Extract - (Rural / Natham)', screenTitle: 'View A-Register Extract', gate: 'otp', blurb: 'The village A-Register entry for a survey field: classification, extent, assessment.' },
  { id: 'verify-patta', label: 'Verify Patta / Chitta - (Rural / Natham)', screenTitle: 'Verify Chitta Extract', gate: 'otp', blurb: 'Check a Patta / Chitta extract someone gave you, by its Reference Number.' },
  { id: 'poramboke', label: 'Verify Government / Private (Poramboke) Land', screenTitle: 'Verify whether Land is Government or Private', gate: 'captcha', blurb: 'Whether a survey field is Government (poramboke) or private land.' },
  { id: 'fmb', label: 'FMB Sketch - (Rural / Natham)', screenTitle: 'View FMB', gate: 'otp', blurb: 'Field Measurement Book sketch of a survey field.' },
  { id: 'order-copy', label: 'View Patta Order Copy', screenTitle: 'Patta OrderCopy', gate: 'otp', blurb: 'The order passed on a patta transfer application.' },
  { id: 'tslr-extract', label: 'TSLR Extract', screenTitle: 'View TSLR Extract', gate: 'otp', blurb: 'Town Survey Land Register extract for urban land (Town > Ward > Block).' },
  { id: 'tslr-sketch', label: 'TSLR Sketch - Urban', screenTitle: 'View TSLR Sketch', gate: 'otp', blurb: 'Town survey sketch for urban land.' },
  { id: 'app-status', label: 'Application Status', screenTitle: 'Application Status Page', gate: 'captcha', blurb: 'Status of a patta transfer / F-Line application by Application Id.' },
  { id: 'fline', label: 'F-Line Sketch / Statement', screenTitle: 'F Line Sketch/Statement', gate: 'captcha', blurb: 'F-Line (land measurement) sketch and statement by Application Id.' },
];

export const landMeta = (id: LandService): LandServiceMeta => LAND_MENU.find((m) => m.id === id)!;

/** Service screen heading: back to all services, the site's page title, source. */
export function LandTitleBar({ title, onHome }: { title: string; onHome: () => void }) {
  return (
    <div className="lr-titlebar">
      <button type="button" className="btn btn-sm" onClick={onHome}>
        <Icon name="chevron" size={14} style={{ transform: 'rotate(180deg)' }} /> All services
      </button>
      <span className="lr-titlebar-name">{title}</span>
      <span className="lr-titlebar-src">Land Records · eservices.tn.gov.in</span>
    </div>
  );
}

/** Bold label + control, the site's red "*" after required labels. */
export function LField({ label, required, children, wide }: { label: string; required?: boolean; children: ReactNode; wide?: boolean }) {
  return (
    <label className="col" style={{ gap: 5, minWidth: 0, gridColumn: wide ? '1 / -1' : undefined }}>
      <span className="body-sm" style={{ fontWeight: 600 }}>
        {label}
        {required ? <span aria-hidden style={{ color: 'var(--danger)', marginLeft: 2 }}>*</span> : null}
      </span>
      {children}
    </label>
  );
}

/** Three across on wide screens (District | Taluk | Village), one on phones. */
export function LRow({ children, min = 220 }: { children: ReactNode; min?: number }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${min}px), 1fr))`, gap: '12px 20px' }}>
      {children}
    </div>
  );
}

/** The site's numbered hints above Survey Number. */
export function SurveyHints() {
  return (
    <ol className="body-sm" style={{ margin: 0, paddingLeft: 18, color: 'var(--text-secondary)' }}>
      <li>If Survey Number is <b>24/2A</b>, please enter <b>24</b> in Survey Number, <b>2A</b> in Sub Division Number and click Submit</li>
      <li>If Survey Number is <b>24</b>, please enter <b>24</b> in Survey Number, and Sub Division Number as <b>-</b> and click Submit</li>
    </ol>
  );
}

export function errorText(err: unknown, fallback: string): string {
  return (err as { response?: { data?: { error?: string } } })?.response?.data?.error
    ?? (err instanceof Error ? err.message : fallback);
}
