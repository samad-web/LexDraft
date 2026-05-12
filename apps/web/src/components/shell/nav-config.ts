import type { FeatureKey } from '@lexdraft/types';
import type { IconName } from '@lexdraft/ui';

export interface NavItem {
  id: string;
  label: string;
  icon: IconName;
  badge?: string;
  /** Route path under the app shell. */
  to: string;
  /** When set, the item is hidden unless the resolver grants this feature. */
  requiresFeature?: FeatureKey;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

// =============================================================================
// Sidebar gates — canonical tier matrix
// =============================================================================
// Plan determines surface area (which sidebar items render); role determines
// actions within that surface. See OVERVIEW.md §2.5, WORKFLOW_DASHBOARDS.md §3.
//
// Required feature → who gets it (plan ∩ role from migrations 0009/0012/0013):
//
//   shared.documents     baseline — every authenticated user
//   matter.view          Solo+ × (every tenant role except Intern-on-Solo)
//   client.view          Solo+ × (same)
//   leads.view           Solo+ × (Solo Advocate / Practice / Firm tenants)
//   billing.view         Solo+ × (Solo Advocate + Firm Admin + Partner)
//   drafting.basic       Solo+ × every drafting-capable role
//   drafting.ai          Practice+ × (Lead / Partner / Senior / Associate)
//   drafting.clauses     Solo+ × drafting-capable roles
//   review.comment       Solo+ baseline review
//   research.basic       Solo+ (all drafting-capable roles)
//   reports.activity     Practice+ × (Lead / Partner / Firm Admin)
//   firm.members.view    Practice+ × (Lead / Partner / Senior / Firm Admin)
//   firm.dashboard.view  Firm × (Partner / Lead / Firm Admin)
//                        OR Practice × Practice Group Lead (sees chambers dash)
//   analytics.firm       Firm × (Partner / Lead / Firm Admin)
//   admin.users          Practice+ × Firm Admin
//
// Solo (Solo Advocate role, Solo plan):
//   ✓ Dashboard, Calendar, Cases, Clients, Leads, Documents, Clauses,
//     Invoices, Tasks, Expenses, Limitation, Research, Diary, Cause list,
//     eCourts, Stamp, Archive, Settings
//   ✗ Draft (AI), Review, Firm overview, Members, Analytics, Manage firm
//
// Practice (Practice Group Lead / Partner / etc., Practice plan):
//   ✓ All Solo items + Draft (AI), Review, Members, Firm overview (Lead)
//   ✗ Analytics (Firm-only), Manage firm (Firm Admin only)
//
// Firm (Partner / Firm Admin etc., Firm plan):
//   ✓ Everything that any role can see in their plan
// =============================================================================

export const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Overview',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', to: '/app/dashboard' },
      { id: 'calendar',  label: 'Calendar',  icon: 'calendar',  to: '/app/calendar',  requiresFeature: 'matter.view' },
    ],
  },
  {
    title: 'Matters',
    items: [
      { id: 'cases',   label: 'Cases',   icon: 'cases',   to: '/app/cases',   requiresFeature: 'matter.view' },
      { id: 'clients', label: 'Clients', icon: 'clients', to: '/app/clients', requiresFeature: 'client.view' },
      { id: 'leads',   label: 'Leads',   icon: 'leads',   to: '/app/leads',   requiresFeature: 'leads.view' },
    ],
  },
  {
    title: 'Workspace',
    items: [
      { id: 'draft',     label: 'Draft',     icon: 'draft',     badge: 'AI', to: '/app/draft',     requiresFeature: 'drafting.ai' },
      { id: 'review',    label: 'Review',    icon: 'review',    badge: 'AI', to: '/app/review',    requiresFeature: 'review.comment' },
      { id: 'review-queue', label: 'My Queue', icon: 'tasks',  to: '/app/review-queue', requiresFeature: 'review.comment' },
      { id: 'documents', label: 'Documents', icon: 'documents', to: '/app/documents', requiresFeature: 'shared.documents' },
      { id: 'clauses',   label: 'Clauses',   icon: 'clauses',   to: '/app/clauses',   requiresFeature: 'drafting.clauses' },
    ],
  },
  {
    title: 'Practice',
    items: [
      { id: 'invoices',           label: 'Invoices',          icon: 'invoices',   to: '/app/invoices',           requiresFeature: 'billing.view' },
      { id: 'tasks',              label: 'Tasks',             icon: 'tasks',      to: '/app/tasks',              requiresFeature: 'matter.view' },
      { id: 'expenses',           label: 'Expenses',          icon: 'expenses',   to: '/app/expenses',           requiresFeature: 'billing.view' },
      { id: 'limitation',         label: 'Limitation',        icon: 'limitation', to: '/app/limitation',         requiresFeature: 'matter.view' },
      { id: 'coverage',           label: 'Coverage Board',    icon: 'members',    to: '/app/coverage',           requiresFeature: 'coverage.requests' },
      { id: 'practice-analytics', label: 'Practice Insights', icon: 'analytics',  to: '/app/practice-analytics', requiresFeature: 'practice.analytics' },
    ],
  },
  {
    title: 'Research',
    items: [
      { id: 'research',  label: 'Legal Research', icon: 'research',  to: '/app/research',  requiresFeature: 'research.basic' },
      { id: 'sanhita',   label: 'Sanhita',        icon: 'research',  to: '/app/sanhita',   requiresFeature: 'drafting.basic' },
      { id: 'diary',     label: 'Judgment Diary', icon: 'diary',     to: '/app/diary',     requiresFeature: 'matter.view' },
      { id: 'causelist', label: 'Cause List',     icon: 'causelist', to: '/app/causelist', requiresFeature: 'matter.view' },
    ],
  },
  {
    title: 'Tools',
    items: [
      { id: 'ecourts',     label: 'eCourts',       icon: 'ecourts', to: '/app/ecourts',     requiresFeature: 'matter.view' },
      { id: 'stamp',       label: 'Stamp Duty',    icon: 'stamp',   to: '/app/stamp' },
      { id: 'calculators', label: 'Calculators',   icon: 'flag',    to: '/app/calculators', requiresFeature: 'tools.calculators' },
      { id: 'archive',     label: 'Physical Docs', icon: 'archive', to: '/app/archive',     requiresFeature: 'matter.view' },
    ],
  },
  {
    title: 'Firm',
    items: [
      { id: 'firm',       label: 'Firm overview',      icon: 'shield',    to: '/app/firm',       requiresFeature: 'firm.dashboard.view' },
      { id: 'manage',     label: 'Manage firm',        icon: 'shield',    to: '/app/manage',     requiresFeature: 'admin.users' },
      { id: 'members',    label: 'Members',            icon: 'members',   to: '/app/members',    requiresFeature: 'firm.members.view' },
      { id: 'analytics',  label: 'Analytics',          icon: 'analytics', to: '/app/analytics',  requiresFeature: 'analytics.firm' },
      { id: 'engagement', label: 'Engagement Letters', icon: 'file',      to: '/app/engagement', requiresFeature: 'engagement.letters' },
      { id: 'settings',   label: 'Settings',           icon: 'settings',  to: '/app/settings' },
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
  manage:     { title: 'Manage firm',     eyebrow: 'User management & roles' },
  settings:   { title: 'Settings',        eyebrow: 'Preferences' },
  sanhita:           { title: 'Sanhita',          eyebrow: 'IPC → BNS, CrPC → BNSS, Evidence → BSA' },
  calculators:       { title: 'Calculators',      eyebrow: 'Court fee · stamp duty · vakalatnama' },
  coverage:          { title: 'Coverage Board',   eyebrow: 'Hearing coverage requests' },
  'practice-analytics': { title: 'Practice Insights', eyebrow: 'Workload fairness & matter profitability' },
  engagement:        { title: 'Engagement Letters', eyebrow: 'Templates & generation' },
};
