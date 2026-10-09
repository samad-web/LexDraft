// One-time capture: court complexes for every district, via a single
// long-lived browser session reused across districts (not one session per
// district - far fewer page loads, much less likely to trip anti-bot
// detection). Checkpointed to JSONL; resumable by re-running (skips
// districts already present in the output file).
//
// Throwaway operator script, not shipped app code - the callbacks passed to
// page.evaluate()/page.$$eval() run inside the browser, where DOM globals
// exist; the API's tsconfig has no "dom" lib, so declare the handful used
// here (same pattern as ecourts-browser.service.ts used earlier).
declare const document: any;
declare const window: any;
type HTMLSelectElement = any;
type HTMLOptionElement = any;

import { chromium, type Page } from 'playwright';
import { existsSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs';

const SP = 'C:/Users/salma/AppData/Local/Temp/claude/c--Users-salma-OneDrive-Documents-LEXDRAFT/3ab6b218-d731-4ca0-bab0-996f25b46936/scratchpad';
const DISTRICTS_IN = `${SP}/districts.jsonl`;
const OUT = `${SP}/complexes.jsonl`;

interface DistrictRow { stateCode: number; stateName: string; districts?: Array<{ code: number; name: string }>; error?: string }
interface Task { stateCode: number; distCode: number; stateName: string; distName: string }

function loadTasks(): Task[] {
  const lines = readFileSync(DISTRICTS_IN, 'utf8').split('\n').filter(Boolean);
  const tasks: Task[] = [];
  for (const line of lines) {
    const row: DistrictRow = JSON.parse(line);
    if (row.error || !row.districts) continue;
    for (const d of row.districts) {
      tasks.push({ stateCode: row.stateCode, distCode: d.code, stateName: row.stateName, distName: d.name });
    }
  }
  return tasks;
}

function loadDone(): Set<string> {
  if (!existsSync(OUT)) { writeFileSync(OUT, ''); return new Set(); }
  const lines = readFileSync(OUT, 'utf8').split('\n').filter(Boolean);
  // Only a genuinely successful capture (has `complexes`, no `error`) counts
  // as done - error rows (crashes, timeouts) must be retried on resume, not
  // silently treated as complete.
  const done = new Set<string>();
  for (const l of lines) {
    const d = JSON.parse(l);
    if (d.error) continue;
    done.add(`${d.stateCode}:${d.distCode}`);
  }
  return done;
}

async function ensurePage(page: Page): Promise<boolean> {
  try {
    await page.waitForSelector('#sess_state_code', { timeout: 20000 });
    await page.waitForFunction(() => (document.getElementById('sess_state_code') as HTMLSelectElement).options.length > 5, { timeout: 15000 });
    return true;
  } catch {
    return false;
  }
}

async function captureOne(page: Page, task: Task): Promise<Array<{ complexCode: string; complexName: string; courtCodes: string[] }>> {
  await page.evaluate((sc) => {
    (document.getElementById('sess_state_code') as HTMLSelectElement).value = String(sc);
    if (typeof (window as any).fillDistrict === 'function') (window as any).fillDistrict(String(sc));
  }, task.stateCode);
  await page.waitForFunction(() => (document.getElementById('sess_dist_code') as HTMLSelectElement).options.length > 1, { timeout: 20000 }).catch(() => {});
  await page.evaluate((dc) => {
    (document.getElementById('sess_dist_code') as HTMLSelectElement).value = String(dc);
    if (typeof (window as any).fillCourtComplex === 'function') (window as any).fillCourtComplex(String(dc));
  }, task.distCode);
  await page.waitForFunction(() => (document.getElementById('court_complex_code') as HTMLSelectElement).options.length > 1, { timeout: 20000 }).catch(() => {});
  const opts = await page.$$eval('#court_complex_code option', (os) =>
    os.map((o) => ({ value: (o as HTMLOptionElement).value, name: (o.textContent || '').trim() })).filter((o) => o.value && o.value !== '0'),
  );
  return opts.map((o) => {
    const [complexCode, courtsStr] = o.value.split('@');
    return { complexCode: complexCode ?? o.value, complexName: o.name, courtCodes: (courtsStr ?? '').split(',').filter(Boolean) };
  });
}

async function main() {
  const tasks = loadTasks();
  const done = loadDone();
  let remaining = tasks.filter((t) => !done.has(`${t.stateCode}:${t.distCode}`));
  // PRIORITY state(s) run first, ahead of the default alphabetical order -
  // set via env var so this throwaway script doesn't need editing per run.
  const priorityState = process.env.PRIORITY_STATE;
  if (priorityState) {
    const pri = remaining.filter((t) => t.stateName === priorityState);
    const rest = remaining.filter((t) => t.stateName !== priorityState);
    if (pri.length === 0) console.log(`WARNING: no remaining districts matched PRIORITY_STATE="${priorityState}"`);
    remaining = [...pri, ...rest];
  }
  console.log(`total districts: ${tasks.length}, already done: ${done.size}, remaining: ${remaining.length}`);

  const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] });
  const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);

  let consecutiveFailures = 0;
  let consecutiveEmpty = 0;
  let processed = 0;
  let sinceReload = 0;
  const MAX_PER_RUN = 100; // stop after this many to keep each invocation bounded
  const RELOAD_EVERY = 25; // fresh page load periodically - a long-lived tab
                            // degrades (silently returns empty dropdowns, then
                            // crashes) well before 100 districts in practice.

  try {
    await page.goto('https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index', { waitUntil: 'domcontentloaded' });
    let ready = await ensurePage(page);

    for (const task of remaining) {
      if (processed >= MAX_PER_RUN) { console.log('hit per-run cap, stopping cleanly'); break; }
      if (!ready || sinceReload >= RELOAD_EVERY) {
        await page.goto('https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index', { waitUntil: 'domcontentloaded' }).catch(() => {});
        ready = await ensurePage(page);
        sinceReload = 0;
        if (!ready) { console.log('page not ready, aborting run (blocked or slow) - resume later'); break; }
      }
      try {
        const complexes = await captureOne(page, task);
        // A real district either has complexes or the site's own dropdown
        // shows a "no complex" placeholder - either is fine. What's NOT fine
        // is silently getting an empty array because the page/session
        // degraded mid-run (observed: ~17 districts in a row returned zero
        // after a long-lived tab started failing, before finally crashing).
        // Treat empty results the same as errors: don't write them as done,
        // and abort after too many in a row so the next resume retries them.
        if (complexes.length === 0) {
          consecutiveEmpty++;
          console.log(`EMPTY (not saved, will retry) ${task.stateName} / ${task.distName} - consecutive empty: ${consecutiveEmpty}`);
          if (consecutiveEmpty >= 3) { console.log('3 consecutive empty results - session likely degraded, stopping cleanly for later resume'); break; }
          processed++;
          await page.waitForTimeout(800);
          continue;
        }
        consecutiveEmpty = 0;
        appendFileSync(OUT, JSON.stringify({ stateCode: task.stateCode, distCode: task.distCode, stateName: task.stateName, distName: task.distName, complexes }) + '\n');
        console.log(`OK ${task.stateName} / ${task.distName} - ${complexes.length} complexes`);
        consecutiveFailures = 0;
      } catch (e: any) {
        consecutiveFailures++;
        appendFileSync(OUT, JSON.stringify({ stateCode: task.stateCode, distCode: task.distCode, stateName: task.stateName, distName: task.distName, error: e.message }) + '\n');
        console.log(`FAILED ${task.stateName} / ${task.distName} - ${e.message}`);
        if (consecutiveFailures >= 5) { console.log('5 consecutive failures - likely blocked, stopping cleanly for later resume'); break; }
        if (/crash/i.test(e.message)) { console.log('page crashed - stopping cleanly for later resume'); break; }
      }
      processed++;
      sinceReload++;
      await page.waitForTimeout(800); // brief pacing between districts
    }
  } finally {
    await browser.close();
  }
  console.log(`RUN COMPLETE: processed ${processed} this invocation`);
}
main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
