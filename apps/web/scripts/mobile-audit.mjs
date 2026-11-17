// Mobile-responsive audit (build-docs/features/mobile-responsive.md).
// Screenshots every main screen at phone/tablet/desktop widths and checks the
// layout in a real browser: horizontal page overflow, elements past the screen
// edge, text overflowing its box, tap targets under 44px, form fields under
// 16px (iOS zoom), dialogs bigger than the screen.
//
// LOCAL ONLY: run against the local dev stack (web :5173, api :4000, local DB)
// signed in with the local account in apps/web/.env.e2e (E2E_EMAIL /
// E2E_PASSWORD, gitignored). Never point it at the live site.
//
//   node apps/web/scripts/mobile-audit.mjs <label> [routeFilter|-] [widths e.g. 360,390]
//   -> mobile-audit/<label>/<width>/<screen>.png + results-*.json, summary printed.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(resolve(WEB_DIR, 'package.json'))('@playwright/test');
const WEB = process.env.AUDIT_WEB || 'http://localhost:5173';
const API = process.env.AUDIT_API || 'http://localhost:4000';
if (!/^http:\/\/localhost[:/]/.test(WEB) || !/^http:\/\/localhost[:/]/.test(API)) throw new Error('local dev stack only');
const env = Object.fromEntries(readFileSync(resolve(WEB_DIR, '.env.e2e'), 'utf8').split(/\r?\n/).filter((l) => /^\w+=/.test(l))
  .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '')]));

async function signIn(page) {
  await page.addInitScript(() => { try { localStorage.setItem('difai-intro', JSON.stringify({ dismissed: true })); } catch {} });
  await page.goto(WEB + '/auth');
  await page.getByLabel('Email').fill(env.E2E_EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(env.E2E_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(/\/app\/|\/onboarding/, { timeout: 30000 });
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem('lexdraft-auth') ?? '{}')?.state?.token);
  const me = await (await page.request.get(API + '/api/me', { headers: { Authorization: `Bearer ${token}` } })).json();
  await page.evaluate((id) => { localStorage.setItem(`difai-tour-done:${id}`, new Date().toISOString()); }, me.id);
  return { token, me };
}
async function firstId(page, token, path) {
  const j = await (await page.request.get(API + path, { headers: { Authorization: `Bearer ${token}` } })).json().catch(() => null);
  const list = Array.isArray(j) ? j : (j?.items ?? j?.data ?? j?.cases ?? j?.clients ?? []);
  return list[0]?.id ?? 'none';
}

const label = process.argv[2] || 'run';
const only = process.argv[3] && process.argv[3] !== '-' ? process.argv[3] : null;
const VPS = [[360, 800], [390, 844], [768, 1024], [1024, 768], [1366, 768]]
  .filter(([w]) => !process.argv[4] || process.argv[4].split(',').includes(String(w)));
const OUT = `mobile-audit/${label}`;
let CASE = 'none', CLIENT = 'none';

// [name, path, opts]; opts.pub = signed-out page; opts.me = /api/me overrides; opts.act = async(page) after load
const ROUTES = [
  ['landing', '/', { pub: true }], ['auth', '/auth', { pub: true }], ['signup', '/signup', { pub: true }], ['terms', '/terms', { pub: true }],
  ['onboarding', '/onboarding', { me: { needsOnboarding: true } }],
  ['terms-consent', '/app/dashboard', { me: { needsTermsAcceptance: true } }],
  ['dashboard', '/app/dashboard'], ['cases', '/app/cases'], ['case-detail', '/app/cases/{CASE}', { tabs: true }],
  ['clients', '/app/clients'], ['client-detail', '/app/clients/{CLIENT}'], ['leads', '/app/leads'],
  ['calendar', '/app/calendar'], ['causelist', '/app/causelist'], ['diary', '/app/diary'], ['ecourts', '/app/ecourts'],
  ['efiling', '/app/efiling'], ['land-records', '/app/land-records'], ['tasks', '/app/tasks'], ['documents', '/app/documents'],
  ['draft', '/app/draft'], ['clauses', '/app/clauses'], ['review', '/app/review'], ['review-queue', '/app/review-queue'],
  ['matter-intel', '/app/matter-intel'], ['research', '/app/research'], ['mock-arguments', '/app/mock-arguments'],
  ['title-reports', '/app/title-reports'], ['calculators', '/app/calculators'], ['limitation', '/app/limitation'],
  ['sanhita', '/app/sanhita'], ['invoices', '/app/invoices'], ['expenses', '/app/expenses'], ['team-chat', '/app/team-chat'],
  ['members', '/app/members'], ['manage', '/app/manage'], ['firm', '/app/firm'], ['analytics', '/app/analytics'],
  ['practice-analytics', '/app/practice-analytics'], ['archive', '/app/archive'], ['physical-docs', '/app/physical-docs'],
  ['engagement', '/app/engagement'], ['coverage', '/app/coverage'], ['settings', '/app/settings'], ['billing', '/app/billing'],
  // overlays
  ['nav-drawer', '/app/dashboard', { act: async (p) => { await p.locator('.topbar-menu').first().click({ timeout: 3000 }); } }],
  ['modal-new-case', '/app/cases', { act: async (p) => { await p.getByRole('button', { name: /new (case|matter)/i }).first().click({ timeout: 3000 }); } }],
  ['modal-new-client', '/app/clients', { act: async (p) => { await p.getByRole('button', { name: /new client|add client/i }).first().click({ timeout: 3000 }); } }],
  ['modal-new-task', '/app/tasks', { act: async (p) => { await p.getByRole('button', { name: /new task|add task/i }).first().click({ timeout: 3000 }); } }],
  ['modal-new-invoice', '/app/invoices', { act: async (p) => { await p.getByRole('button', { name: /new invoice/i }).first().click({ timeout: 3000 }); } }],
  ['modal-new-expense', '/app/expenses', { act: async (p) => { await p.getByRole('button', { name: /log expense|new expense/i }).first().click({ timeout: 3000 }); } }],
  ['modal-new-lead', '/app/leads', { act: async (p) => { await p.getByRole('button', { name: /capture lead|new lead/i }).first().click({ timeout: 3000 }); } }],
  ['modal-new-hearing', '/app/calendar', { act: async (p) => { await p.getByRole('button', { name: /new hearing|add hearing/i }).first().click({ timeout: 3000 }); } }],
  ['cmdk', '/app/dashboard', { act: async (p) => { await p.keyboard.press('Control+k'); } }],
  ['draft-check', '/app/draft', { act: async (p) => { await p.locator('textarea').first().fill('Complaint under Section 138 NI Act. Complainant Gupta Traders, accused Rohit Malhotra, cheque Rs. 3,50,000 dishonoured.'); } }],
  ['admin-overview', '/admin', { me: { isSuperadmin: true } }], ['admin-firms', '/admin/firms', { me: { isSuperadmin: true } }],
  ['admin-users', '/admin/users', { me: { isSuperadmin: true } }], ['admin-ai-usage', '/admin/ai-usage', { me: { isSuperadmin: true } }],
  ['admin-nav', '/admin', { me: { isSuperadmin: true }, act: async (p) => { await p.locator('.topbar-menu').first().click({ timeout: 3000 }); } }],
  ['native-dashboard', '/app/dashboard', { native: true }], ['native-cases', '/app/cases', { native: true }],
  ['native-settings', '/app/settings', { native: true }], ['native-auth', '/auth', { pub: true, native: true }],
];

const CHECK = () => {
  const W = innerWidth, H = innerHeight;
  const vis = (el) => { const s = getComputedStyle(el); if (s.visibility === 'hidden' || s.display === 'none' || +s.opacity === 0) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const path = (el) => { const parts = []; for (let e = el, i = 0; e && e !== document.body && i < 4; e = e.parentElement, i++) { const c = typeof e.className === 'string' ? e.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.') : ''; parts.unshift(e.tagName.toLowerCase() + (c ? '.' + c : '')); } return parts.join('>'); };
  const contained = (el) => { if (el.closest('.sidebar:not(.is-open)')) return true; for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) { const s = getComputedStyle(p); if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) return p.getBoundingClientRect().right <= W + 1; } return false; };
  const all = [...document.body.querySelectorAll('*')].filter((e) => !['SCRIPT', 'STYLE', 'svg', 'path', 'BR'].includes(e.tagName));
  const offenders = all.filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > W + 1 || r.left < -1) && vis(e) && !contained(e) && getComputedStyle(e).position !== 'fixed'; });
  const offSet = new Set(offenders);
  const deepest = offenders.filter((e) => ![...e.children].some((c) => offSet.has(c)));
  const textOv = all.filter((e) => { if (!vis(e)) return false; const s = getComputedStyle(e); if (s.overflowX !== 'visible' || s.textOverflow === 'ellipsis') return false; if (![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) return false; return e.scrollWidth > e.clientWidth + 2 && e.clientWidth > 0 && !['INPUT', 'TEXTAREA', 'SELECT'].includes(e.tagName); });
  const inter = [...document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=link], summary, label[for]')].filter((e) => vis(e) && !e.disabled);
  const small = inter.filter((e) => { const r = e.getBoundingClientRect(); if (e.closest('.sidebar:not(.is-open)')) return false; if (r.width < 2 || r.height < 2 || r.bottom <= 0) return false; /* sr-only / off-screen skip link */ if (getComputedStyle(e).display === 'inline' || (e.parentElement && e.parentElement.tagName === 'P' && /[a-z]/i.test([...e.parentElement.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('')))) return false; /* WCAG 2.5.8 inline exception: a link inside a sentence */ if (e.tagName === 'INPUT' && e.closest('label') && e.closest('label').getBoundingClientRect().height >= 44) return false; /* the label is the target */ return r.width < 44 || r.height < 44; });
  const tiny = small.filter((e) => { const r = e.getBoundingClientRect(); return r.width < 24 || r.height < 24; });
  const smallFont = [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=hidden]):not([type=file]), select, textarea')].filter((e) => vis(e) && parseFloat(getComputedStyle(e).fontSize) < 16);
  const dialogs = [...document.querySelectorAll('[role=dialog], [aria-modal=true], .modal')].filter(vis).map((e) => { const r = e.getBoundingClientRect(); return { path: path(e), w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), over: r.right > W + 1 || r.left < -1 || r.bottom > H + 1 && getComputedStyle(e).overflowY === 'visible' }; });
  const fixedTop = [...document.querySelectorAll('body *')].filter((e) => { const s = getComputedStyle(e); return (s.position === 'fixed' || s.position === 'sticky') && vis(e); }).map((e) => { const r = e.getBoundingClientRect(); return { path: path(e), h: Math.round(r.height), top: Math.round(r.top), w: Math.round(r.width) }; }).filter((x) => x.h > H * 0.3 && x.w > W * 0.8 && !/dialog|modal|drawer|sidebar|scrim|overlay|backdrop/i.test(x.path));
  const lbl = (e) => (e.getAttribute('aria-label') || e.textContent || e.getAttribute('title') || e.name || '').trim().slice(0, 30);
  return {
    pageOverflow: document.scrollingElement.scrollWidth - W,
    wide: deepest.slice(0, 8).map((e) => { const r = e.getBoundingClientRect(); return `${path(e)} [L${Math.round(r.left)} R${Math.round(r.right)} w${Math.round(r.width)}]`; }),
    wideCount: deepest.length,
    textOverflow: textOv.slice(0, 6).map((e) => `${path(e)} (${e.scrollWidth}>${e.clientWidth}) "${e.textContent.trim().slice(0, 30)}"`), textOverflowCount: textOv.length,
    tapSmall: small.length, tapTiny: tiny.length, tapTotal: inter.length,
    tapSmallSamples: small.slice(0, 12).map((e) => { const r = e.getBoundingClientRect(); return `${path(e)} ${Math.round(r.width)}x${Math.round(r.height)}`; }),
    tapSamples: tiny.slice(0, 6).map((e) => { const r = e.getBoundingClientRect(); return `${path(e)} ${Math.round(r.width)}x${Math.round(r.height)} "${lbl(e)}"`; }),
    smallFont: smallFont.length, smallFontSamples: smallFont.slice(0, 4).map((e) => `${path(e)} ${getComputedStyle(e).fontSize}`),
    dialogs, fixedTop,
  };
};

const browser = await chromium.launch();
let state = null;
{
  const ctx = await browser.newContext(); const p = await ctx.newPage(); const { token } = await signIn(p);
  CASE = await firstId(p, token, '/api/cases'); CLIENT = await firstId(p, token, '/api/clients');
  state = await ctx.storageState(); await ctx.close();
}
for (const r of ROUTES) r[1] = r[1].replace('{CASE}', CASE).replace('{CLIENT}', CLIENT);
const results = existsSync(`${OUT}/results-${process.argv[4] || "all"}.json`) ? JSON.parse(readFileSync(`${OUT}/results-${process.argv[4] || "all"}.json`, 'utf8')) : {};
for (const [w, h] of VPS) {
  const touch = w <= 1024;
  for (const [name, path, opts = {}] of ROUTES) {
    if (only && !name.includes(only)) continue;
    if (opts.native && w !== 390) continue;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: touch && w < 1024, hasTouch: touch, storageState: opts.pub ? undefined : state });
    if (opts.pub) await ctx.addInitScript(() => { try { localStorage.setItem('difai-intro', JSON.stringify({ dismissed: true })); } catch {} });
    if (opts.native) await ctx.addInitScript(() => { window.androidBridge = { postMessage() {} }; try { localStorage.setItem('difai-app-lock', 'off'); } catch {} });
    if (!opts.pub) await ctx.route('**/api/me', async (route) => { try { const r = await route.fetch(); const j = await r.json().catch(() => null); if (!j) return route.fulfill({ response: r }); await route.fulfill({ response: r, json: { ...j, needsTermsAcceptance: false, ...(opts.me || {}) } }); } catch { await route.continue().catch(() => {}); } });
    const page = await ctx.newPage();
    // A full-page screenshot drops Chromium's touch emulation ((pointer: coarse) turns false);
    // switch it back on after each one so later checks on this page still see a touch screen.
    const cdp = touch ? await ctx.newCDPSession(page) : null;
    const shoot = async (o) => { await page.screenshot(o); if (cdp && o.fullPage) await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); };
    const dir = `${OUT}/${w}`; mkdirSync(dir, { recursive: true });
    const key = `${w}/${name}`;
    const run = async () => {
      await page.goto(WEB + path, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(2500);
      if (opts.act) { try { await opts.act(page); await page.waitForTimeout(1200); } catch (e) { results[key] = { error: 'act: ' + e.message.split('\n')[0] }; } }
      const r = await page.evaluate(CHECK);
      results[key] = { ...(results[key] || {}), ...r };
      await shoot({ path: `${dir}/${name}.png`, fullPage: !opts.act });
      if (opts.tabs) {
        const tabs = await page.getByRole('tab').all();
        for (let i = 0; i < tabs.length; i++) {
          const t = (await tabs[i].innerText().catch(() => 'tab' + i)).trim().replace(/\W+/g, '-').toLowerCase().slice(0, 20) || 'tab' + i;
          await tabs[i].click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(1200);
          results[`${key}#${t}`] = await page.evaluate(CHECK);
          await shoot({ path: `${dir}/${name}--${t}.png`, fullPage: true });
        }
      }
    };
    try { await Promise.race([run(), new Promise((_, rej) => setTimeout(() => rej(new Error('route timeout 90s')), 90000))]); }
    catch (e) { results[key] = { ...(results[key] || {}), error: e.message.split('\n')[0] }; }
    await Promise.race([ctx.close(), new Promise((r) => setTimeout(r, 5000))]);
    writeFileSync(`${OUT}/results-${process.argv[4] || "all"}.json`, JSON.stringify(results, null, 1));
    process.stdout.write('.');
  }
}
await browser.close();
writeFileSync(`${OUT}/results-${process.argv[4] || "all"}.json`, JSON.stringify(results, null, 1));
// summary
const rows = Object.entries(results).filter(([k]) => !only || k.includes(only));
const ov = rows.filter(([, r]) => r.pageOverflow > 0 || r.wideCount > 0);
console.log(`\n${rows.length} captures; overflow/wide: ${ov.length}; errors: ${rows.filter(([, r]) => r.error).length}`);
for (const [k, r] of rows) if (r.error) console.log('ERR', k, r.error);
