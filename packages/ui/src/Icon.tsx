import type { ReactNode, SVGProps } from 'react';

export type IconName =
  | 'dashboard' | 'calendar' | 'cases' | 'clients' | 'leads' | 'draft'
  | 'review' | 'documents' | 'clauses' | 'invoices' | 'tasks' | 'expenses'
  | 'limitation' | 'research' | 'diary' | 'causelist' | 'ecourts' | 'stamp'
  | 'archive' | 'members' | 'analytics' | 'settings' | 'search' | 'bell'
  | 'plus' | 'moon' | 'sun' | 'home' | 'chat' | 'more' | 'arrow' | 'chevron'
  | 'chevronD' | 'upload' | 'download' | 'close' | 'check' | 'flag' | 'file'
  | 'shield' | 'globe' | 'menu' | 'eye' | 'eyeOff';

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
  className?: string;
}

const PATHS: Record<IconName, ReactNode> = {
  dashboard: (<><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></>),
  calendar: (<><rect x="3" y="4" width="18" height="18"/><path d="M3 10h18M8 2v4M16 2v4"/></>),
  cases: (<><path d="M4 7h16v13H4z"/><path d="M9 7V4h6v3"/><path d="M4 12h16"/></>),
  clients: (<><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/></>),
  leads: (<><path d="M3 12h18M12 3l9 9-9 9"/></>),
  draft: (<><path d="M14 2H6v20h12V6z"/><path d="M14 2v4h4M8 12h8M8 16h6"/></>),
  review: (<><path d="M21 11V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6"/><path d="m16 19 2 2 4-4"/></>),
  documents: (<><path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/></>),
  clauses: (<><path d="M4 6h16M4 12h16M4 18h10"/></>),
  invoices: (<><path d="M4 3h16v18l-4-2-4 2-4-2-4 2z"/><path d="M8 8h8M8 12h8M8 16h5"/></>),
  tasks: (<><rect x="3" y="3" width="18" height="18"/><path d="m8 12 3 3 5-6"/></>),
  expenses: (<><circle cx="12" cy="12" r="9"/><path d="M12 7v10M9 10h5a2 2 0 0 1 0 4h-4a2 2 0 0 0 0 4h6"/></>),
  limitation: (<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>),
  research: (<><circle cx="11" cy="11" r="7"/><path d="m21 21-5-5"/></>),
  diary: (<><path d="M4 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H4z"/><path d="M4 4v18M8 8h8M8 12h8"/></>),
  causelist: (<><path d="M3 6h18M3 12h18M3 18h18"/><circle cx="6" cy="6" r="1" fill="currentColor"/><circle cx="6" cy="12" r="1" fill="currentColor"/><circle cx="6" cy="18" r="1" fill="currentColor"/></>),
  ecourts: (<><path d="M3 21h18M5 21V10M19 21V10M3 10l9-7 9 7"/><path d="M9 21v-7h6v7"/></>),
  stamp: (<><path d="M5 21h14M9 17V13a3 3 0 0 1 6 0v4M7 17h10v4H7z"/></>),
  archive: (<><rect x="3" y="3" width="18" height="5"/><path d="M5 8v13h14V8M10 12h4"/></>),
  members: (<><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2"/><path d="M3 19c0-3 3-5 6-5s6 2 6 5M15 19c0-2 2-3 4-3s4 1 4 3"/></>),
  analytics: (<><path d="M3 3v18h18"/><path d="M7 14l4-4 4 3 5-7"/></>),
  settings: (<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>),
  search: (<><circle cx="11" cy="11" r="7"/><path d="m21 21-5-5"/></>),
  bell: (<><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 0 0 4 0"/></>),
  plus: (<><path d="M12 5v14M5 12h14"/></>),
  moon: (<><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></>),
  sun: (<><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></>),
  home: (<><path d="M3 10v11h6v-7h6v7h6V10L12 3z"/></>),
  chat: (<><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></>),
  more: (<><circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/></>),
  arrow: (<><path d="M5 12h14M13 5l7 7-7 7"/></>),
  chevron: (<><path d="m9 18 6-6-6-6"/></>),
  chevronD: (<><path d="m6 9 6 6 6-6"/></>),
  upload: (<><path d="M12 15V3M7 8l5-5 5 5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/></>),
  download: (<><path d="M12 3v12M7 10l5 5 5-5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/></>),
  close: (<><path d="M18 6 6 18M6 6l12 12"/></>),
  check: (<><path d="m5 12 5 5L20 7"/></>),
  flag: (<><path d="M4 22V4h13l-2 5 2 5H4"/></>),
  file: (<><path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/></>),
  shield: (<><path d="M12 2 4 5v7c0 5 3.5 9 8 10 4.5-1 8-5 8-10V5z"/></>),
  globe: (<><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></>),
  menu: (<><path d="M3 6h18M3 12h18M3 18h18"/></>),
  eye: (<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></>),
  eyeOff: (<><path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-6.5 0-10-7-10-7a18.45 18.45 0 0 1 4.06-5.06M9.9 4.24A10.94 10.94 0 0 1 12 4c6.5 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19M10.59 10.59a2 2 0 1 0 2.83 2.83"/><path d="M2 2l20 20"/></>),
};

export function Icon({ name, size = 16, className = '', ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={rest['aria-label'] ? undefined : true}
      {...rest}
    >
      {PATHS[name] ?? null}
    </svg>
  );
}
