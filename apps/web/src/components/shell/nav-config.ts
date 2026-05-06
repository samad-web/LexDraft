import type { IconName } from '@lexdraft/ui';

export interface NavItem {
  id: string;
  label: string;
  icon: IconName;
  badge?: string;
  /** Route path under the app shell. */
  to: string;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Overview',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', to: '/app/dashboard' },
      { id: 'calendar', label: 'Calendar', icon: 'calendar', to: '/app/calendar' },
    ],
  },
  {
    title: 'Matters',
    items: [
      { id: 'cases', label: 'Cases', icon: 'cases', to: '/app/cases' },
      { id: 'clients', label: 'Clients', icon: 'clients', to: '/app/clients' },
      { id: 'leads', label: 'Leads', icon: 'leads', to: '/app/leads' },
    ],
  },
  {
    title: 'Workspace',
    items: [
      { id: 'draft', label: 'Draft', icon: 'draft', badge: 'AI', to: '/app/draft' },
      { id: 'review', label: 'Review', icon: 'review', badge: 'AI', to: '/app/review' },
      { id: 'documents', label: 'Documents', icon: 'documents', to: '/app/documents' },
      { id: 'clauses', label: 'Clauses', icon: 'clauses', to: '/app/clauses' },
    ],
  },
  {
    title: 'Practice',
    items: [
      { id: 'invoices', label: 'Invoices', icon: 'invoices', to: '/app/invoices' },
      { id: 'tasks', label: 'Tasks', icon: 'tasks', to: '/app/tasks' },
      { id: 'expenses', label: 'Expenses', icon: 'expenses', to: '/app/expenses' },
      { id: 'limitation', label: 'Limitation', icon: 'limitation', to: '/app/limitation' },
    ],
  },
  {
    title: 'Research',
    items: [
      { id: 'research', label: 'Legal Research', icon: 'research', to: '/app/research' },
      { id: 'diary', label: 'Judgment Diary', icon: 'diary', to: '/app/diary' },
      { id: 'causelist', label: 'Cause List', icon: 'causelist', to: '/app/causelist' },
    ],
  },
  {
    title: 'Tools',
    items: [
      { id: 'ecourts', label: 'eCourts', icon: 'ecourts', to: '/app/ecourts' },
      { id: 'stamp', label: 'Stamp Duty', icon: 'stamp', to: '/app/stamp' },
      { id: 'archive', label: 'Physical Docs', icon: 'archive', to: '/app/archive' },
    ],
  },
  {
    title: 'Firm',
    items: [
      { id: 'firm', label: 'Firm overview', icon: 'shield', to: '/app/firm' },
      { id: 'members', label: 'Members', icon: 'members', to: '/app/members' },
      { id: 'analytics', label: 'Analytics', icon: 'analytics', to: '/app/analytics' },
      { id: 'settings', label: 'Settings', icon: 'settings', to: '/app/settings' },
    ],
  },
];

export const ROUTE_TITLES: Record<string, { title: string; eyebrow: string }> = {
  dashboard:  { title: 'Dashboard',       eyebrow: 'Your practice at a glance' },
  cases:      { title: 'Cases',           eyebrow: 'All active matters' },
  draft:      { title: 'Draft',           eyebrow: 'AI-assisted legal drafting' },
  review:     { title: 'Contract Review', eyebrow: 'Clause-by-clause risk analysis' },
  tasks:      { title: 'Tasks',           eyebrow: 'Kanban' },
  analytics:  { title: 'Analytics',       eyebrow: 'Practice metrics' },
  documents:  { title: 'Documents',       eyebrow: 'Document vault' },
  clients:    { title: 'Clients',         eyebrow: 'Client directory' },
  invoices:   { title: 'Invoices',        eyebrow: 'Billing' },
  calendar:   { title: 'Calendar',        eyebrow: 'Hearings & deadlines' },
  leads:      { title: 'Leads',           eyebrow: 'Pipeline & intake' },
  clauses:    { title: 'Clauses',         eyebrow: 'Clause bank' },
  expenses:   { title: 'Expenses',        eyebrow: 'Disbursements' },
  limitation: { title: 'Limitation',      eyebrow: 'Statute tracker' },
  research:   { title: 'Research',        eyebrow: 'Lex.AI answers with citations' },
  diary:      { title: 'Diary',           eyebrow: 'Court diary' },
  causelist:  { title: 'Cause list',      eyebrow: 'Daily roster' },
  ecourts:    { title: 'eCourts',         eyebrow: 'Case-status gateway' },
  stamp:      { title: 'Stamp',           eyebrow: 'Duty calculator' },
  archive:    { title: 'Archive',         eyebrow: 'Closed matters' },
  firm:       { title: 'Firm overview',   eyebrow: 'Chambers performance' },
  members:    { title: 'Members',         eyebrow: 'Chambers roll' },
  settings:   { title: 'Settings',        eyebrow: 'Preferences' },
};
