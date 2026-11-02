// =============================================================================
// eFiling self-test (local development only).
//
// When EFILING_SELF_TEST=1 and the advocate logs in to eFiling on a local
// DifAi, this walks every eFiling feature over that live portal session with
// the same functions the screens use, READ-ONLY: it opens screens, lists,
// "View ..." windows and documents, and never saves, submits, pays, deletes,
// assigns, eFiles or sends an OTP. Each step's result (what DifAi read, or the
// error), its time and a screenshot of the real portal page go to the OS temp
// folder (difai-efiling-selftest/<time>/) so the output can be checked against
// the portal without the advocate checking each screen by hand.
// =============================================================================
import { logger } from '../logger';
import * as live from './efiling-live.service';
import * as caseFiling from './efiling-portal-casefiling.service';
import * as pleadings from './efiling-portal-pleadings.service';
import * as epay from './efiling-portal-epay.service';
import * as applications from './efiling-portal-applications.service';
import * as vakalat from './efiling-portal-vakalat.service';
import * as portfolio from './efiling-portal-portfolio.service';

interface StepResult { step: string; ok: boolean; ms: number; summary?: unknown; error?: string; shot?: string }

const running = new Set<string>();

export function selfTestEnabled(): boolean {
  return process.env['EFILING_SELF_TEST'] === '1' && process.env['NODE_ENV'] !== 'production';
}

/** Long values cut down so the report stays readable (structure, not bulk). */
function trim(v: unknown, depth = 0): unknown {
  if (typeof v === 'string') return v.length > 400 ? `${v.slice(0, 400)}… (${v.length} chars)` : v;
  if (Buffer.isBuffer(v)) return `<${v.length} bytes, starts ${JSON.stringify(v.subarray(0, 8).toString('latin1'))}>`;
  if (Array.isArray(v)) {
    const head = v.slice(0, depth > 2 ? 3 : 15).map((x) => trim(x, depth + 1));
    return v.length > head.length ? [...head, `… ${v.length - head.length} more`] : head;
  }
  if (v && typeof v === 'object') {
    if (depth > 6) return '{…}';
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, trim(x, depth + 1)]));
  }
  return v;
}

export async function runSelfTest(sessionId: string, userId: string): Promise<void> {
  if (!selfTestEnabled() || running.has(sessionId)) return;
  running.add(sessionId);
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = join(tmpdir(), 'difai-efiling-selftest', new Date().toISOString().replace(/[:.]/g, '-'));
  await mkdir(dir, { recursive: true });
  const results: StepResult[] = [];
  // The full result of each step (what the screens get), so DifAi's version of
  // every screen can be drawn from real data and compared with the portal's.
  const full: Array<{ step: string; data: unknown }> = [];
  const save = () => Promise.all([
    writeFile(join(dir, 'report.json'), JSON.stringify({ sessionId: sessionId.slice(0, 8), results }, null, 2)),
    writeFile(join(dir, 'full.json'), JSON.stringify(full, (_k, v) => (v && v.type === 'Buffer' && Array.isArray(v.data) ? `<${v.data.length} bytes>` : v))),
  ]);
  let n = 0;

  const step = async <T>(name: string, fn: () => Promise<T>, summarise: (x: T) => unknown = (x) => x): Promise<T | null> => {
    const started = Date.now();
    const r: StepResult = { step: name, ok: false, ms: 0 };
    let out: T | null = null;
    try {
      out = await fn();
      r.ok = true;
      r.summary = trim(summarise(out));
      full.push({ step: name, data: out });
    } catch (e) {
      r.error = `${(e as { status?: number }).status ?? ''} ${(e as Error).message}`.trim();
    }
    r.ms = Date.now() - started;
    // What the real portal page looks like after the step.
    const shot = `${String(++n).padStart(2, '0')}-${name.replace(/[^\w]+/g, '_').slice(0, 60)}.png`;
    await live.withPortalPage(sessionId, userId, (page) => page.screenshot({ path: join(dir, shot), fullPage: true }))
      .then(() => { r.shot = shot; }).catch(() => {});
    results.push(r);
    await save();
    logger.info({ step: name, ok: r.ok, ms: r.ms, error: r.error }, 'efiling self-test');
    return out;
  };

  try {
    // Dashboard: tiles, calendar, today; every tile's list.
    await step('dashboard counts + calendar + today', () => live.readPortalCounts(sessionId, userId));
    const keys = ['draft_pleadings', 'completed_pleadings', 'draft_ias', 'completed_ias', 'objections', 'draft_cases', 'filed_cases'] as const;
    const lists: Partial<Record<(typeof keys)[number], live.PortalList>> = {};
    for (const k of keys) {
      const l = await step(`list ${k}`, () => live.readPortalList(sessionId, userId, k));
      if (l) lists[k] = l;
    }
    // Each list's first row: its View buttons, then a document link inside.
    for (const k of keys) {
      const row = lists[k]?.rows.find((r) => 'cells' in r) as { cells: string[]; actions?: string[] } | undefined;
      if (!row) continue;
      for (const action of (row.actions ?? []).filter((a) => /^view\b/i.test(a))) {
        const v = await step(`${k}: ${action}`, () => live.openPortalRowAction(sessionId, userId, k, row.cells.slice(0, 2), action));
        if (v?.file) {
          await step(`${k}: ${action}: the document it opens`, () => live.openPortalFile(sessionId, userId, k, { match: row.cells.slice(0, 2), link: action }),
            (f) => ({ name: f.name, contentType: f.contentType, bytes: f.body.length, pdf: f.body.subarray(0, 5).toString('latin1') === '%PDF-' }));
          continue;
        }
        const sec = v?.sections.find((s) => s.table?.rows.some((r) => 'cells' in r && r.actions?.length));
        const doc = sec?.table?.rows.find((r) => 'cells' in r && r.actions?.length) as { cells: string[]; actions?: string[] } | undefined;
        if (doc) {
          await step(`${k}: ${action}: open document "${doc.actions![0]}"`, () => live.openPortalFile(sessionId, userId, k, {
            match: row.cells.slice(0, 2), action, tab: v!.sections.length > 1 ? sec!.name : undefined, docRow: doc.cells.slice(0, 2), link: doc.actions![0]!,
          }), (f) => ({ name: f.name, contentType: f.contentType, bytes: f.body.length, pdf: f.body.subarray(0, 5).toString('latin1') === '%PDF-' }));
        }
      }
      const link = (row.actions ?? []).find((a) => !/^view\b/i.test(a));
      if (link) {
        await step(`${k}: open "${link}"`, () => live.openPortalFile(sessionId, userId, k, { match: row.cells.slice(0, 2), link }),
          (f) => ({ name: f.name, contentType: f.contentType, bytes: f.body.length, pdf: f.body.subarray(0, 5).toString('latin1') === '%PDF-' }));
      }
    }
    // My Cases and the first case's details.
    const mc = await step('My Cases', () => live.readMyCases(sessionId, userId));
    const first = (mc as { cases?: Array<{ cino: string; court: 'd' | 'h' }> } | null)?.cases?.[0];
    if (first) await step(`My Cases: case details ${first.cino}`, () => live.openMyCaseHistory(sessionId, userId, first.cino, first.court));

    // Case Filing.
    await step('Case Filing: New Case Filing (open only)', () => caseFiling.openCaseFilingWizard(sessionId, userId, { screen: 'new_case', fresh: true }));
    for (const k of ['draft', 'filed', 'clients'] as const) await step(`Case Filing list: ${k}`, () => caseFiling.readCaseFilingList(sessionId, userId, k));
    await step('Case Filing: Manage Favourite Clients', () => caseFiling.openCaseFilingWizard(sessionId, userId, { screen: 'clients', fresh: true }));

    // Pleadings.
    await step('Pleadings: Use Template', () => pleadings.readTemplateScreen(sessionId, userId));
    await step('Pleadings: Pleadings', () => pleadings.readPleadingScreen(sessionId, userId));
    await step('Pleadings: Video Recording', () => pleadings.readOathScreen(sessionId, userId));
    await step('Pleadings: Draft Pleadings (GRN)', () => pleadings.readDraftPleadings(sessionId, userId, 'draft'));

    // ePayments.
    await step('ePayments: Payment form', () => epay.openEpayForm(sessionId, userId, true));
    await step('ePayments: transactions', () => epay.readEpayTransactions(sessionId, userId));
    await step('ePayments: Court Fee Wallet', () => epay.readEpayWallet(sessionId, userId));

    // Applications.
    await step('Applications: IA Filing', () => applications.readApplicationsScreen(sessionId, userId, 'applications', true));
    await step('Applications: Submitted Applications', () => applications.readApplicationsScreen(sessionId, userId, 'submitted', true));

    // My Partners and Vakalat.
    for (const v of ['add_partner', 'accept_partnership', 'revoke_partnership', 'accept_revocation', 'partners_report', 'vakalat', 'accept_offer', 'print_vakalat'] as const) {
      await step(`Vakalat/Partners: ${v}`, () => vakalat.openVakalatScreen(sessionId, userId, v));
    }

    // Portfolio.
    for (const v of ['search_cases', 'planner'] as const) await step(`Portfolio: ${v}`, () => portfolio.openPortfolioScreen(sessionId, userId, v));
    await step('Portfolio: Export Cases (district, file only)', () => portfolio.exportMyCases(sessionId, userId, 'D'));

    // Back to the dashboard, as the advocate left it.
    await step('back to dashboard', () => live.readPortalCounts(sessionId, userId));
  } finally {
    const failed = results.filter((r) => !r.ok);
    await writeFile(join(dir, 'summary.txt'), [
      `eFiling self-test ${new Date().toISOString()}: ${results.length - failed.length}/${results.length} steps ok`,
      ...results.map((r) => `${r.ok ? 'OK  ' : 'FAIL'} ${String(r.ms).padStart(6)}ms  ${r.step}${r.error ? `  -> ${r.error}` : ''}`),
    ].join('\n'));
    await save();
    running.delete(sessionId);
    logger.info({ dir, ok: results.length - failed.length, total: results.length }, 'efiling self-test finished');
  }
}
