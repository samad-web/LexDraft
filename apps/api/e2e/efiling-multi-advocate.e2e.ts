/**
 * Several advocates on eFiling at once: each logs in with their own portal
 * account and works in their own private portal session. Fixture portal
 * (no live site): the login sets a session cookie for that advocate, and the
 * dashboard lists show whose session asked.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BrowserContext, Route } from 'playwright';
import * as live from '../src/services/efiling-live.service';

const ORIGIN = 'https://filing.ecourts.gov.in';
const fx = { lastCode: '', n: 0, logouts: [] as string[] };

const loginPage = `<!doctype html><html><body><form id="frm_login">
<select id="selState"><option value="4">Kerala</option><option value="10">Tamil Nadu</option></select>
<input type="radio" id="user_advocate" name="rdoUser"><input id="user_name"><input type="password" id="user_password">
<img id="captcha_image" src="/pdedev/securimage/securimage_show.php?a" width="150" height="50">
<input id="fcaptcha_code_mobile"><button type="button" id="verify_button1" onclick="go()">Login</button>
<div class="alert-danger4" style="display:none"><span id="msg-danger4"></span></div></form>
<script>function go(){var x=new XMLHttpRequest();x.open('POST','/pdedev/?p=login/verify_login/');x.onload=function(){var o=JSON.parse(x.responseText);if(o.redirect_path)location.href=o.redirect_path;};
x.send('user_name='+encodeURIComponent(document.getElementById('user_name').value)+'&fcaptcha_code='+document.getElementById('fcaptcha_code_mobile').value);}</script></body></html>`;

const dashboard = `<!doctype html><html><body><h3>Dashboard</h3>
<input type="hidden" id="base_url" value="${ORIGIN}/pdedev"><input type="hidden" id="__csrf_magic" value="t">
<a href="#" id="draft_cases">Draft Cases</a><a href="${ORIGIN}/pdedev/?p=login/logOut">Logout</a>
<div id="db_screen"><div id="history_body"></div></div>
<script>document.getElementById('draft_cases').addEventListener('click',function(e){e.preventDefault();var x=new XMLHttpRequest();x.open('POST','/pdedev/?p=advocate_case_registration/getUnRegisteredPDE');x.onload=function(){document.getElementById('history_body').innerHTML=JSON.parse(x.responseText).pde_list;};x.send('');});</script>
</body></html>`;

const advOf = (route: Route) => /(?:^|;\s*)adv=([^;]+)/.exec(route.request().headers()['cookie'] ?? '')?.[1] ?? '';

async function serve(route: Route): Promise<void> {
  const req = route.request();
  const url = new URL(req.url());
  const p = url.searchParams.get('p') ?? '';
  if (url.pathname.endsWith('securimage_show.php')) {
    // Codes are per session on the real portal; one shared "last" is enough
    // here because each test logs in one advocate at a time.
    fx.lastCode = `M${++fx.n}`;
    return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="50"><rect width="150" height="50" fill="#fff"/><text x="10" y="32" font-size="24">${fx.lastCode}</text></svg>` });
  }
  if (req.method() === 'GET' && p === 'login/logOut') {
    fx.logouts.push(decodeURIComponent(advOf(route)));
    return route.fulfill({ contentType: 'text/html', body: '<html><body>Logged out</body></html>', headers: { 'set-cookie': 'adv=; Path=/' } });
  }
  if (req.method() === 'GET' && p === 'dashboard') return route.fulfill({ contentType: 'text/html', body: dashboard });
  if (req.method() === 'GET') return route.fulfill({ contentType: 'text/html', body: loginPage });
  if (p === 'login/verify_login/') {
    const user = new URLSearchParams(req.postData() ?? '').get('user_name') ?? '';
    return route.fulfill({
      contentType: 'application/json',
      headers: { 'set-cookie': `adv=${encodeURIComponent(user)}; Path=/` },
      body: JSON.stringify({ status: true, redirect_path: `${ORIGIN}/pdedev/?p=dashboard` }),
    });
  }
  if (p === 'advocate_case_registration/getUnRegisteredPDE') {
    const who = decodeURIComponent(advOf(route));
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ pde_list: `<table><tbody><tr><td>1</td><td>Draft of ${who}</td></tr></tbody></table>`, total_record: 1 }) });
  }
  return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ table: '<table><tbody></tbody></table>', submitted_pde_list: '<table><tbody></tbody></table>', total_record: 0 }) });
}

async function login(userId: string, username: string, state = '4'): Promise<string> {
  const { sessionId } = await live.startEfilingSession(userId, state, 'advocate');
  await live.submitEfilingCredentials(sessionId, userId, username, 'Secret@123');
  const r = await live.submitEfilingLoginCaptcha(sessionId, userId, fx.lastCode);
  expect(r).toEqual({ status: 'authenticated' });
  return sessionId;
}

const ADV_A = 'advocate-a-user-id';
const ADV_B = 'advocate-b-user-id';
let a = '';
let b = '';

beforeAll(() => {
  live.__testing.setContextHook(async (context: BrowserContext) => { await context.route(`${ORIGIN}/**`, serve); });
});

afterAll(async () => {
  live.__testing.setContextHook(null);
  for (const [s, u] of [[a, ADV_A], [b, ADV_B]] as const) if (s) await live.endEfilingSession(s, u).catch(() => {});
});

describe('several advocates on eFiling at the same time', () => {
  it('each advocate logs in with their own portal account and gets their own session', async () => {
    a = await login(ADV_A, 'advocate.a@example.com', '4');
    b = await login(ADV_B, 'advocate.b@example.com', '10');
    expect(a).not.toBe(b);
    expect(live.efilingSessionStatus(a, ADV_A).authenticated).toBe(true);
    expect(live.efilingSessionStatus(b, ADV_B).authenticated).toBe(true);
  });

  it('each sees only their own portal dashboard, even when both read at once', async () => {
    const [la, lb] = await Promise.all([live.readPortalLists(a, ADV_A), live.readPortalLists(b, ADV_B)]);
    expect(la.find((l) => l.key === 'draft_cases')!.rows).toEqual([{ cells: ['1', 'Draft of advocate.a@example.com'] }]);
    expect(lb.find((l) => l.key === 'draft_cases')!.rows).toEqual([{ cells: ['1', 'Draft of advocate.b@example.com'] }]);
  });

  it('an advocate cannot use another advocate\'s portal session', async () => {
    expect(() => live.efilingSessionStatus(b, ADV_A)).toThrow(/expired/);
    await expect(live.readPortalLists(a, ADV_B)).rejects.toThrow(/expired/);
  });

  it('one advocate logging out leaves the other connected', async () => {
    await live.endEfilingSession(a, ADV_A);
    a = '';
    expect(fx.logouts).toEqual(['advocate.a@example.com']);
    expect(live.efilingSessionStatus(b, ADV_B).authenticated).toBe(true);
    const lb = await live.readPortalLists(b, ADV_B);
    expect(lb.find((l) => l.key === 'draft_cases')!.rows).toEqual([{ cells: ['1', 'Draft of advocate.b@example.com'] }]);
  });

  it('logging in again replaces only that advocate\'s own old session', async () => {
    const old = b;
    b = await login(ADV_B, 'advocate.b@example.com', '10');
    expect(() => live.efilingSessionStatus(old, ADV_B)).toThrow(/expired/);
    expect(live.efilingSessionStatus(b, ADV_B).authenticated).toBe(true);
  });
});
