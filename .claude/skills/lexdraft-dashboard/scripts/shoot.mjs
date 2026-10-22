// Screenshot a LexDraft page against a MOCKED API - no real data, no login,
// nothing written anywhere. Needs the web dev server on http://localhost:5173.
//
//   node shoot.mjs [--out DIR] [--path /app/dashboard] [--theme light|dark]
//                  [--sizes desktop,phone] [--scenario busy|quiet] [--menu]
//
// Prints the saved PNG paths. Open them with the Read tool to check the UI.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../../..');
const require = createRequire(resolve(repo, 'apps/web/package.json'));
const { chromium } = require('@playwright/test');

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const out = arg('out', tmpdir());
const path = arg('path', '/app/dashboard');
const theme = arg('theme', 'light');
const sizes = arg('sizes', 'desktop,phone').split(',');
const scenario = arg('scenario', 'busy');
const openMenu = process.argv.includes('--menu');

// ---- Mock data (Indian courts, made-up matters) -----------------------------
const now = new Date();
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const plus = (n) => iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n));
const T = iso(now);

const user = {
  id: 'u1', name: 'Riyaz Ahmed', email: 'riyaz@example.in', role: 'Managing Partner', plan: 'Firm',
  firm: 'Ahmed & Associates', firmId: 'f1', planStatus: 'trial', trialEndsAt: new Date(Date.now() + 4 * 864e5).toISOString(),
};
const features = ['matter.view', 'matter.create', 'client.view', 'leads.view', 'leads.create', 'billing.view', 'drafting.ai', 'drafting.basic',
  'drafting.clauses', 'review.comment', 'research.basic', 'firm.dashboard.view', 'firm.members.view', 'analytics.firm', 'admin.users',
  'shared.documents', 'team.messaging', 'tools.calculators', 'coverage.requests', 'practice.analytics', 'engagement.letters',
  'matter.intelligence', 'title_report.use', 'mock_arguments.use'];
// advocate: '' = unassigned (no advocate, no matter lead).
const h = (id, caseId, c, date, time, court, purpose, judge, mine = true, advocate = mine ? 'Riyaz Ahmed' : 'Salman Khan') =>
  ({ id, caseId, case: c, date, time, court, purpose, judge, mine, unassigned: advocate === '', advocate: advocate || null });

const dashboardToday = {
  date: T,
  user: { name: user.name, role: user.role },
  canSeeFirm: true,
  hearingsToday: [
    h('h1', 'c1', 'Thoorigai Printers v. K. Ramesh', T, '10:30', 'XVIII Metropolitan Magistrate, Egmore', 'Evidence (PW-1 chief)', 'Hon. S. Priya'),
    h('h2', 'c2', 'State v. Arun Kumar', T, '11:15', 'XVIII Metropolitan Magistrate, Egmore', 'Bail application', null, false, ''),
    h('h3', 'c3', 'Lakshmi Textiles v. Union of India', T, '14:15', 'High Court of Madras · Court 12', 'Admission', 'Hon. Justice R. Mahadevan', false),
  ],
  hearingsWeek: [
    h('h4', 'c4', 'Sundaram Finance v. Velu', plus(1), '10:30', 'City Civil Court, Chennai', 'Arguments', null),
    h('h5', 'c5', 'Meena v. Rajesh', plus(1), '12:00', 'Family Court II, Chennai', 'Counselling report', null, false, 'Divya R.'),
    h('h6', 'c6', 'Global Exports v. HDFC Bank', plus(3), '10:30', 'High Court of Madras · Court 4', 'Interim stay', null),
    h('h7', 'c7', 'Rao v. Rao', plus(5), '11:00', 'Principal District Court, Chengalpattu', 'Framing of issues', null),
  ],
  attention: [
    { key: 'limitations', count: 2, tone: 'danger', to: '/app/limitation', items: [
      { id: 'l1', label: 'Sundaram Finance v. Velu', detail: 'First appeal · due ' + plus(3), to: '/app/limitation' },
      { id: 'l2', label: 'Global Exports v. HDFC Bank', detail: 'Written statement · due ' + plus(6), to: '/app/limitation' }] },
    { key: 'objections', count: 1, tone: 'danger', to: '/app/efiling', items: [
      { id: 'o1', label: 'Lakshmi Textiles - WP filing', detail: 'Objection raised ' + plus(-1), to: '/app/efiling' }] },
    { key: 'overdueTasks', count: 3, tone: 'warning', to: '/app/tasks', items: [
      { id: 't1', label: 'Draft rejoinder', detail: 'Meena v. Rajesh · was due ' + plus(-2), to: '/app/tasks' }] },
    { key: 'noNextDate', count: 4, tone: 'warning', to: '/app/cases', items: [
      { id: 'n1', label: 'Parking issue', detail: 'High Court of Madras', to: '/app/cases/c9' }] },
    { key: 'reviews', count: 1, tone: 'info', to: '/app/review-queue', items: [] },
  ],
  practice: { activeMatters: 42, totalMatters: 61, revenueFY: '₹8.4L', overdueInvoices: { count: 3, amount: '₹1.2L' }, openLeads: 5 },
};

if (scenario === 'quiet') {
  Object.assign(user, { role: 'Associate', name: 'Divya Raman', plan: 'Practice', planStatus: 'active', trialEndsAt: null });
  for (const f of ['billing.view', 'leads.view', 'leads.create', 'firm.dashboard.view', 'analytics.firm', 'admin.users']) {
    features.splice(features.indexOf(f), 1);
  }
  Object.assign(dashboardToday, {
    user: { name: user.name, role: user.role }, canSeeFirm: false, hearingsToday: [], attention: [],
    hearingsWeek: dashboardToday.hearingsWeek.slice(0, 1),
    practice: { activeMatters: 9, totalMatters: 12, revenueFY: null, overdueInvoices: null, openLeads: null },
  });
}

// --draft: open /app/draft with a saved sample draft loaded (the workspace view).
const withDraft = process.argv.includes('--draft');
const sampleDraft = {
  id: 'd1', title: 'Vakalatnama - Thoorigai Printers', docType: 'Vakalatnama', language: 'EN', tone: 'Professional',
  fields: {}, editedHtml: '', draftDate: T, matter: 'Thoorigai Printers v. K. Ramesh', createdAt: T, updatedAt: T,
  bodyText: [
    'IN THE COURT OF THE XVIII METROPOLITAN MAGISTRATE, EGMORE, CHENNAI',
    'C.C. No. ______ of 2026',
    'Thoorigai Printers, rep. by its Proprietor ... Complainant',
    'Versus',
    'K. Ramesh ... Accused',
    'VAKALATNAMA',
    'I/We, Thoorigai Printers, the Complainant above named, do hereby appoint and retain Riyaz Ahmed, Advocate, to appear, act and plead for me/us in the above matter and to conduct and prosecute all proceedings that may be taken in respect thereof.',
    'I/We agree to ratify all acts done by the said Advocate in pursuance of this authority.',
    'Signed this [date to be provided] at Chennai.',
    '[Signature of the Complainant]',
    'Accepted: Riyaz Ahmed, Advocate (Enrolment No. [to be provided])',
  ].join('\n\n'),
};

const firmDashboard = {
  firm: { name: 'Ahmed & Associates', seats: 10, seatsUsed: 4, period: 'FY 26-27 · Q3' },
  stats: { totalMatters: 61, activeMatters: 42, revenueFY: '₹8.4L', revenueDeltaPct: 18, billableHoursMonth: 0, realizationPct: 0, advocatesActive: 4, clientsActive: 37 },
  members: [
    { id: 'm1', name: 'Salman Khan', role: 'Senior Associate', initials: 'SK', activeMatters: 18, billableHours: 0, winRate: 0, status: 'Active' },
    { id: 'm2', name: 'Riyaz Ahmed', role: 'Managing Partner', initials: 'RA', activeMatters: 11, billableHours: 0, winRate: 0, status: 'Active' },
    { id: 'm3', name: 'Divya R.', role: 'Associate', initials: 'DR', activeMatters: 9, billableHours: 0, winRate: 0, status: 'Active' },
    { id: 'm4', name: 'Karthik S.', role: 'Junior Associate', initials: 'KS', activeMatters: 4, billableHours: 0, winRate: 0, status: 'Active' },
  ],
  practiceAreas: [], topClients: [], caseStages: [], monthlyRevenue: [], alerts: [], hearingsToday: [],
};

const routes = {
  '/api/drafts/d1': sampleDraft,
  '/api/firm/dashboard': firmDashboard,
  '/api/me': user,
  '/api/me/features': { features, role: user.role, plan: user.plan },
  '/api/me/usage': { aiDocuments: { used: 121, limit: 500 } },
  '/api/dashboard/today': dashboardToday,
  '/api/ecourts/sync/status': {
    lastRun: { slot: 'morning', status: 'completed', runDate: T, attempt: 1,
      startedAt: new Date(new Date().setHours(9, 2)).toISOString(), finishedAt: new Date(new Date().setHours(9, 4)).toISOString() },
    counts: { linked: 31, pending: 0, notFound: 1, error: 0, unlinked: 3 },
    retryPending: false, schedule: { timezone: 'Asia/Kolkata', times: ['09:00', '19:00'], retryEveryMinutes: 30 },
  },
  '/api/notifications': { items: [], unread: 0 },
  // Drafting engine "up", so /app/draft shows the engine composer.
  '/api/drafting/engine/status': { enabled: true, docLabels: ['Notice u/s 138 NI Act', 'Complaint u/s 138 NI Act', 'Regular Bail Application', 'Vakalatnama', 'Affidavit'] },
  '/api/cases': { items: [
    { id: 'c1', title: 'Thoorigai Printers v. K. Ramesh', cnr: 'TNCH0A0012342026', court: 'XVIII Metropolitan Magistrate, Egmore', client: 'Thoorigai Printers', status: 'Active', type: 'Criminal', stage: 'Evidence', next: plus(0) },
    { id: 'c2', title: 'State v. Arun Kumar', cnr: 'TNCH0A0056782026', court: 'XVIII Metropolitan Magistrate, Egmore', client: 'Arun Kumar', status: 'Active', type: 'Criminal', stage: 'Bail', next: plus(0) },
    { id: 'c4', title: 'Sundaram Finance v. Velu', cnr: 'TNCH010098762025', court: 'City Civil Court, Chennai', client: 'Sundaram Finance', status: 'Active', type: 'Civil', stage: 'Arguments', next: plus(1) },
    { id: 'c6', title: 'Global Exports v. HDFC Bank', cnr: 'TNHC010045672026', court: 'High Court of Madras', client: 'Global Exports', status: 'Active', type: 'Writ', stage: 'Admission', next: plus(3) },
  ] },
};

const VIEW = { desktop: { width: 1440, height: 1000 }, laptop: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } };
const browser = await chromium.launch();
for (const s of sizes) {
  const ctx = await browser.newContext({ viewport: VIEW[s], deviceScaleFactor: s === 'phone' ? 2 : 1 });
  await ctx.addInitScript(([u, th]) => {
    localStorage.setItem('lexdraft-auth', JSON.stringify({ state: { user: u, token: 'x.eyJ9.x', actAs: null, previousSession: null }, version: 0 }));
    localStorage.setItem('lexdraft-ui', JSON.stringify({ state: { lang: 'en', theme: th }, version: 0 }));
  }, [user, theme]);
  if (withDraft) {
    // react-router reads navigation state from history.state.usr.
    await ctx.addInitScript(() => history.replaceState({ usr: { draftId: 'd1' }, key: 'shot', idx: 0 }, '', location.href));
  }
  await ctx.route('**/api/**', (route) => {
    // Default reply covers the common list shapes ({items}, {suggestions}).
    const body = routes[new URL(route.request().url()).pathname] ?? { items: [], suggestions: [] };
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  await page.goto(`http://localhost:5173${path}`, { waitUntil: 'networkidle' });
  await page.evaluate((th) => document.documentElement.setAttribute('data-theme', th), theme);
  await page.waitForTimeout(1000);
  if (openMenu) { await page.locator('.more-menu > button').first().click(); await page.waitForTimeout(300); }
  // --type "text": fill the first textarea (e.g. the Draft composer) before the shot.
  const typed = arg('type', null);
  if (typed) { await page.locator('textarea').first().fill(typed); await page.waitForTimeout(200); }
  const file = resolve(out, `${scenario}-${s}-${theme}.png`);
  await page.screenshot({ path: file, fullPage: !openMenu });
  console.log(file);
  await ctx.close();
}
await browser.close();
