import type { FeatureKey } from '@lexdraft/types';
import type { IconName } from '@lexdraft/ui';

export interface NavTab {
  label: string;
  to: string;
  requiresFeature?: FeatureKey;
}

export interface NavItem {
  id: string;
  label: string;
  icon: IconName;
  badge?: string;
  /** Route path under the app shell. */
  to: string;
  /** When set, the item is hidden unless the resolver grants this feature. */
  requiresFeature?: FeatureKey;
  /** Related pages shown as tabs under this one entry; see NAV_GROUPS. */
  tabs?: NavTab[];
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

// =============================================================================
// Sidebar gates - canonical tier matrix
// =============================================================================
// Plan determines surface area (which sidebar items render); role determines
// actions within that surface. See OVERVIEW.md §2.5, WORKFLOW_DASHBOARDS.md §3.
//
// Required feature → who gets it (plan ∩ role from migrations 0009/0012/0013):
//
//   shared.documents     baseline - every authenticated user
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

// Groups follow how often an advocate reaches for them: the court day first,
// then matters, daily work, drafting, research, billing, and firm admin last.
//
// Items with `tabs` are one sidebar entry over several related pages (e.g.
// Hearings = Cause List / Calendar / Diary). The entry links to the first tab
// the user can open, stays highlighted on every tab, and the shell renders a
// tab strip above those pages (SectionTabs). Each tab keeps its own URL so
// bookmarks and deep links keep working.
export const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Home',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', to: '/app/dashboard' },
      // Internal messaging. Baseline feature (every plan, every user); the
      // Sidebar renders a live unread count next to this item.
      { id: 'team-chat', label: 'Team Chat', icon: 'chat',      to: '/app/team-chat', requiresFeature: 'team.messaging' },
    ],
  },
  {
    title: 'Court',
    items: [
      {
        id: 'hearings', label: 'Hearings', icon: 'causelist', to: '/app/causelist',
        tabs: [
          { label: 'Cause List',  to: '/app/causelist', requiresFeature: 'matter.view' },
          { label: 'Calendar',    to: '/app/calendar',  requiresFeature: 'matter.view' },
          { label: 'Court Diary', to: '/app/diary',     requiresFeature: 'matter.view' },
        ],
      },
      { id: 'ecourts', label: 'eCourts', icon: 'ecourts', to: '/app/ecourts', requiresFeature: 'matter.view' },
      { id: 'efiling', label: 'eFiling', icon: 'efiling', to: '/app/efiling', requiresFeature: 'matter.view' },
    ],
  },
  {
    title: 'Matters',
    items: [
      { id: 'cases',   label: 'Cases',   icon: 'cases',   to: '/app/cases',   requiresFeature: 'matter.view' },
      { id: 'clients', label: 'Clients', icon: 'clients', to: '/app/clients', requiresFeature: 'client.view' },
      { id: 'leads',   label: 'Leads',   icon: 'leads',   to: '/app/leads',   requiresFeature: 'leads.view' },
      // Cases handed to this user by ANOTHER firm (co-counsel handover). Not
      // gated on matter.view - a brand-new guest's bare Solo trial account
      // may not carry that feature yet, and this list is independent of the
      // viewer's own plan tier. Gated on the universal baseline instead.
      { id: 'co-counsel', label: 'Co-Counsel', icon: 'handshake', to: '/app/co-counsel', requiresFeature: 'shared.documents' },
    ],
  },
  {
    title: 'Work',
    items: [
      { id: 'tasks',      label: 'Tasks',      icon: 'tasks',      to: '/app/tasks',      requiresFeature: 'matter.view' },
      { id: 'limitation', label: 'Limitation', icon: 'limitation', to: '/app/limitation', requiresFeature: 'matter.view' },
      {
        // Physical Docs (paper-originals register) and Archive (closed
        // matters) are separate routes; they sit under Documents as tabs.
        id: 'documents', label: 'Documents', icon: 'documents', to: '/app/documents',
        tabs: [
          { label: 'Document Vault',  to: '/app/documents',     requiresFeature: 'shared.documents' },
          { label: 'Physical Docs',   to: '/app/physical-docs', requiresFeature: 'matter.view' },
          { label: 'Closed Matters',  to: '/app/archive',       requiresFeature: 'matter.view' },
        ],
      },
    ],
  },
  {
    title: 'Draft & AI',
    items: [
      { id: 'draft',   label: 'Draft',       icon: 'draft',   badge: 'AI', to: '/app/draft',   requiresFeature: 'drafting.ai' },
      { id: 'clauses', label: 'Clause Bank', icon: 'clauses', to: '/app/clauses', requiresFeature: 'drafting.clauses' },
      {
        id: 'review', label: 'Contract Review', icon: 'review', badge: 'AI', to: '/app/review',
        tabs: [
          { label: 'Contract Review', to: '/app/review',       requiresFeature: 'review.comment' },
          { label: 'My Review Queue', to: '/app/review-queue', requiresFeature: 'review.comment' },
        ],
      },
      // Matter Intelligence is matter-scoped. The sidebar entry lands on a
      // picker that lets the advocate pick a matter; the picker then deep-
      // links to /app/matter-intel/:caseId. The picker is also where the
      // user is bounced after sign-out / direct URL hits.
      { id: 'matter-intel',   label: 'Matter Intelligence', icon: 'sparkle', badge: 'AI', to: '/app/matter-intel',   requiresFeature: 'matter.intelligence' },
      { id: 'title-reports',  label: 'Title Reports',       icon: 'map',     badge: 'AI', to: '/app/title-reports',  requiresFeature: 'title_report.use' },
      { id: 'mock-arguments', label: 'Mock Arguments',      icon: 'gavel',   badge: 'AI', to: '/app/mock-arguments', requiresFeature: 'mock_arguments.use' },
    ],
  },
  {
    title: 'Research & Tools',
    items: [
      {
        id: 'research', label: 'Legal Research', icon: 'research', to: '/app/research',
        tabs: [
          { label: 'Legal Research',      to: '/app/research', requiresFeature: 'research.basic' },
          { label: 'Sanhita (IPC → BNS)', to: '/app/sanhita',  requiresFeature: 'drafting.basic' },
        ],
      },
      {
        // Court fee / stamp duty / vakalatnama - daily-use filing-cost tools.
        id: 'calculators', label: 'Court Fee & Stamp', icon: 'calculator', to: '/app/calculators',
        tabs: [
          { label: 'Court Fee & Stamp Duty',  to: '/app/calculators', requiresFeature: 'tools.calculators' },
          { label: 'Stamp Duty Report (PDF)', to: '/app/stamp' },
        ],
      },
    ],
  },
  {
    title: 'Billing',
    items: [
      { id: 'invoices', label: 'Invoices', icon: 'invoices', to: '/app/invoices', requiresFeature: 'billing.view' },
      { id: 'expenses', label: 'Expenses', icon: 'expenses', to: '/app/expenses', requiresFeature: 'billing.view' },
    ],
  },
  {
    title: 'Firm',
    items: [
      { id: 'firm',     label: 'Firm Overview',   icon: 'building', to: '/app/firm',     requiresFeature: 'firm.dashboard.view' },
      { id: 'messages', label: 'Client Messages', icon: 'inbox',    to: '/app/messages', requiresFeature: 'client.view' },
      { id: 'coverage', label: 'Coverage Board',  icon: 'swap',     to: '/app/coverage', requiresFeature: 'coverage.requests' },
      {
        id: 'people', label: 'People & Roles', icon: 'members', to: '/app/members',
        tabs: [
          { label: 'Members',        to: '/app/members', requiresFeature: 'firm.members.view' },
          { label: 'Roles & Access', to: '/app/manage',  requiresFeature: 'admin.users' },
        ],
      },
      {
        id: 'insights', label: 'Insights', icon: 'analytics', to: '/app/analytics',
        tabs: [
          { label: 'Firm Analytics',            to: '/app/analytics',          requiresFeature: 'analytics.firm' },
          { label: 'Workload & Profitability',  to: '/app/practice-analytics', requiresFeature: 'practice.analytics' },
        ],
      },
      { id: 'engagement', label: 'Engagement Letters', icon: 'mail',     to: '/app/engagement', requiresFeature: 'engagement.letters' },
      { id: 'settings',   label: 'Settings',           icon: 'settings', to: '/app/settings' },
    ],
  },
];

/** True when `path` is `to` itself or a page beneath it (`/app/cases/123`). */
export function pathMatches(path: string, to: string): boolean {
  return path === to || path.startsWith(to + '/');
}

/**
 * NAV_GROUPS filtered to what this user can open: items/tabs gated on
 * features they lack are dropped, a tabbed item points at its first visible
 * tab, and groups left empty disappear. Sidebar, CmdK and SectionTabs all
 * read through this so they can never disagree.
 */
export function visibleNavGroups(granted: readonly string[]): NavGroup[] {
  const can = (f?: FeatureKey) => !f || granted.includes(f);
  return NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.flatMap((item): NavItem[] => {
      if (!can(item.requiresFeature)) return [];
      if (!item.tabs) return [item];
      const tabs = item.tabs.filter((t) => can(t.requiresFeature));
      const first = tabs[0];
      return first ? [{ ...item, to: first.to, tabs }] : [];
    }),
  })).filter((g) => g.items.length > 0);
}

/** The visible group + item that own `path` (tabs included), if any. */
export function locateInNav(groups: NavGroup[], path: string): { group: NavGroup; item: NavItem } | undefined {
  for (const group of groups) {
    for (const item of group.items) {
      const owns = item.tabs
        ? item.tabs.some((t) => pathMatches(path, t.to))
        : pathMatches(path, item.to);
      if (owns) return { group, item };
    }
  }
  return undefined;
}

/** The visible tabbed item that owns `path`, if any. */
export function sectionForPath(groups: NavGroup[], path: string): NavItem | undefined {
  for (const g of groups) {
    for (const item of g.items) {
      if (item.tabs?.some((t) => pathMatches(path, t.to))) return item;
    }
  }
  return undefined;
}

export const ROUTE_TITLES: Record<string, { title: string; eyebrow: string }> = {
  dashboard:  { title: 'Dashboard',       eyebrow: 'Your practice at a glance' },
  cases:      { title: 'Cases',           eyebrow: 'All matters' },
  draft:      { title: 'Draft',           eyebrow: 'AI-assisted legal drafting' },
  review:     { title: 'Contract Review', eyebrow: 'Clause-by-clause risk analysis' },
  tasks:      { title: 'Tasks',           eyebrow: 'Kanban' },
  analytics:  { title: 'Insights',        eyebrow: 'Firm analytics' },
  documents:  { title: 'Documents',       eyebrow: 'Document vault' },
  clients:    { title: 'Clients',         eyebrow: 'Client directory' },
  invoices:   { title: 'Invoices',        eyebrow: 'Billing' },
  calendar:   { title: 'Hearings',        eyebrow: 'Calendar' },
  leads:      { title: 'Leads',           eyebrow: 'Pipeline & intake' },
  clauses:    { title: 'Clause Bank',     eyebrow: 'Reusable clauses' },
  expenses:   { title: 'Expenses',        eyebrow: 'Disbursements' },
  limitation: { title: 'Limitation',      eyebrow: 'Limitation tracker' },
  research:   { title: 'Legal Research',  eyebrow: 'Lex.AI answers with citations' },
  diary:      { title: 'Hearings',        eyebrow: 'Court diary' },
  causelist:  { title: 'Hearings',        eyebrow: 'Cause list' },
  ecourts:    { title: 'eCourts',         eyebrow: 'Case search & court records' },
  efiling:    { title: 'eFiling',         eyebrow: 'National e-Filing portal' },
  stamp:      { title: 'Court Fee & Stamp', eyebrow: 'Stamp duty report (PDF)' },
  archive:    { title: 'Documents',       eyebrow: 'Closed matters' },
  firm:       { title: 'Firm Overview',   eyebrow: 'Chambers performance' },
  members:    { title: 'People & Roles',  eyebrow: 'Members' },
  manage:     { title: 'People & Roles',  eyebrow: 'Roles & access' },
  settings:   { title: 'Settings',        eyebrow: 'Preferences' },
  sanhita:           { title: 'Legal Research',  eyebrow: 'Sanhita · IPC → BNS, CrPC → BNSS, Evidence → BSA' },
  calculators:       { title: 'Court Fee & Stamp', eyebrow: 'Court fee · stamp duty · vakalatnama' },
  coverage:          { title: 'Coverage Board',   eyebrow: 'Hearing coverage requests' },
  'co-counsel':      { title: 'Co-Counsel',       eyebrow: 'Matters handed to you by other firms' },
  'practice-analytics': { title: 'Insights',      eyebrow: 'Workload & profitability' },
  engagement:        { title: 'Engagement Letters', eyebrow: 'Templates & generation' },
  'mock-arguments':  { title: 'Mock Arguments',  eyebrow: 'Practice oral advocacy against an AI opponent' },
  'title-reports':   { title: 'Title Reports',   eyebrow: 'Title investigation reports with AI-assisted defects and opinion' },
  'matter-intel':    { title: 'Matter Intelligence', eyebrow: 'Ingest · summarise · synthesise · chat, grounded in this matter' },
  // Topbar previously fell back to the raw URL segment for these — adding
  // them so the breadcrumb reads as a human label, not a slug.
  'physical-docs':   { title: 'Documents',       eyebrow: 'Physical docs · paper originals register' },
  'review-queue':    { title: 'Contract Review', eyebrow: 'My review queue' },
  messages:          { title: 'Client Messages', eyebrow: 'Threads with clients via the portal' },
  'team-chat':       { title: 'Team Chat',       eyebrow: 'Direct messages, groups & matter discussions' },
};
