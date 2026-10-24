/**
 * Land Records OTP / captcha / submit flow, against fixture pages that behave
 * like eservices.tn.gov.in's own (reverse-engineered from its land/*.html and
 * js/common.js, 2026-10-24):
 *   - "Confirm OTP" (#otpval) runs verify_otp: on success it fills the hidden
 *     otpno_ver / mobileno_ver, alerts, then shows #sub_id; else alerts
 *     "Invalid OTP..Please enter valid OTP"
 *   - Patta-type pages: #sub_id holds a real submit -> result page, or the
 *     form posted back with "Invalid otp" in its .fadeout slot
 *   - Order Copy: #sub_id holds a captcha (#captEntr) + submit
 *   - FMB sketch: #sub_id holds a button (validate_fmb) -> alert, or a new
 *     window with the sketch
 * The real service code drives them (no live site, no OTP sent, no DB).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import {
  __testing, landSessionPdf, submitLandCaptcha, verifyLandOtp, LandRecordsError,
} from '../src/services/tn-land-records.service';

const FX = 'https://eservices.tn.gov.in/fx';
const CAPTCHA = `data:image/gif;base64,${'R0lGODlh'.repeat(40)}`;
const USER = 'flow-user';

const otpForm = (opts: { action: string; sub: string; extraTop?: string; message?: string }) => `<!doctype html><html><body><section>
<span class="head">Land Records - Fixture</span>
<strong class="fadeout">${opts.message ?? ''}</strong>
<form name="landForm" method="post" action="${opts.action}">
  ${opts.extraTop ?? ''}
  <input id="mobileno" name="mobileno" value="9876543210">
  <input type="button" id="sendtpid" value="Get OTP">
  <div id="otpcodeview"><input id="otpno" name="otpno" maxlength="6">
  <input type="button" id="otpval" value="Confirm OTP" onclick="verify()"></div>
  <input type="hidden" id="otpno_ver" name="otpno_ver"><input type="hidden" id="mobileno_ver" name="mobileno_ver">
  <div id="sub_id" style="display:none">${opts.sub}</div>
</form></section>
<script>
  window.verifyCalls = 0;
  function verify() {
    window.verifyCalls++;
    setTimeout(function () {
      var o = document.getElementById('otpno').value;
      if (o === '123456') {
        document.getElementById('otpno_ver').value = o;
        document.getElementById('mobileno_ver').value = document.getElementById('mobileno').value;
        alert('Your OTP has been verified.Please click Submit button after clicking OK');
        document.getElementById('sub_id').style.display = 'block';
      } else {
        alert('Invalid OTP..Please enter valid OTP');
      }
    }, 300);
  }
  function validate_fmb(mode) {
    setTimeout(function () {
      if (mode === 'alert') alert('Invalid OTP');
      else window.open('${FX}/sketch', '_blank');
    }, 300);
    return false;
  }
</script></body></html>`;

const resultPage = `<!doctype html><html><body><section>
<h3>Chitta - Taluk Office</h3>
<table><tr><td>District :</td><td>Chengalpattu</td></tr><tr><td>Patta Number :</td><td>1234</td></tr></table>
<p>Owner Details</p>
<table><tr><th>S.No</th><th>Owner Name</th><th>Relation</th></tr><tr><td>1</td><td>K. Ramesh</td><td>Son of Kuppusamy</td></tr><tr><td>2</td><td>R. Lakshmi</td><td>Wife of K. Ramesh</td></tr></table>
</section></body></html>`;

let browser: Browser;

async function open(path: string, routes: Record<string, (body: string) => string>): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext();
  await ctx.addInitScript('window.__name = window.__name || function (f) { return f; };');
  await ctx.route(`${FX}/**`, async (route) => {
    const url = new URL(route.request().url());
    const handler = routes[url.pathname.replace('/fx', '')];
    const html = handler ? handler(route.request().postData() ?? '') : '<html><body>not found</body></html>';
    await route.fulfill({ status: 200, contentType: 'text/html', body: html });
  });
  const page = await ctx.newPage();
  await page.goto(`${FX}${path}`);
  return { ctx, page };
}

async function code(p: Promise<unknown>): Promise<string> {
  try { await p; return 'resolved'; } catch (e) { return e instanceof LandRecordsError ? e.code : String(e); }
}

beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
afterAll(async () => { await browser?.close(); });

describe('OTP services follow the site', () => {
  const pattaRoutes = (resultMode: 'ok' | 'invalid') => ({
    '/patta': () => otpForm({ action: `${FX}/result`, sub: '<input type="submit" value="Submit">' }),
    '/result': (body: string) => {
      // The server reads otpno_ver / mobileno_ver - never the (disabled) visible boxes.
      if (!/otpno_ver=123456/.test(body) || !/mobileno_ver=9876543210/.test(body)) return otpForm({ action: `${FX}/result`, sub: '<input type="submit" value="Submit">', message: 'Invalid otp' });
      return resultMode === 'ok' ? resultPage : otpForm({ action: `${FX}/result`, sub: '<input type="submit" value="Submit">', message: 'Invalid otp' });
    },
  });

  it('patta: confirms with the site button, posts the _ver fields, reads the result', async () => {
    const { ctx, page } = await open('/patta', pattaRoutes('ok'));
    const id = __testing.adoptPage(page, ctx, 'patta', USER);
    const out = await verifyLandOtp(id, USER, '123456');
    expect(out.status).toBe('ok');
    if (out.status !== 'ok') return;
    expect(out.result.fields).toEqual(expect.arrayContaining([{ label: 'Patta Number', value: '1234' }]));
    expect(out.result.sections[0]?.rows).toHaveLength(2);
    expect(landSessionPdf(id, USER).pdf.subarray(0, 5).toString()).toBe('%PDF-');
    await ctx.close();
  });

  it('patta: "Invalid otp" posted back is an error (OTP_REJECTED), never a result', async () => {
    const { ctx, page } = await open('/patta', pattaRoutes('invalid'));
    const id = __testing.adoptPage(page, ctx, 'patta', USER);
    const p = verifyLandOtp(id, USER, '123456');
    expect(await code(p)).toBe('OTP_REJECTED');
    await expect(verifyLandOtp(id, USER, '123456')).rejects.toThrow(/Send the OTP first/);
    await ctx.close();
  });

  it('a wrong OTP surfaces the site message and is OTP_REJECTED', async () => {
    const { ctx, page } = await open('/patta', pattaRoutes('ok'));
    const id = __testing.adoptPage(page, ctx, 'patta', USER);
    await expect(verifyLandOtp(id, USER, '111111')).rejects.toThrow(/Invalid OTP\.\.Please enter valid OTP/);
    await ctx.close();
  });

  it('two confirms at once: the second is refused (BUSY), the site verifies once', async () => {
    const { ctx, page } = await open('/patta', pattaRoutes('ok'));
    const id = __testing.adoptPage(page, ctx, 'patta', USER);
    const [a, b] = await Promise.all([code(verifyLandOtp(id, USER, '123456')), code(verifyLandOtp(id, USER, '123456'))]);
    expect([a, b].sort()).toEqual(['BUSY', 'resolved']);
    expect(await page.evaluate(() => (window as unknown as { verifyCalls?: number }).verifyCalls ?? null).catch(() => 'navigated')).not.toBe(2);
    await ctx.close();
  });

  it('order copy: OTP then the site captcha; right answer -> result, wrong -> new OTP needed', async () => {
    const sub = `<input id="captEntr" name="captEntr"><img id="captcha_name" src="${CAPTCHA}"><input type="submit" value="Submit">`;
    const routes = {
      '/order': () => otpForm({ action: `${FX}/order-result`, sub, extraTop: '<input id="applicationid" name="applicationid" value="2026/0412/05/001234">' }),
      '/order-result': (body: string) => (/captEntr=7(&|$)/.test(body) && /otpno_ver=123456/.test(body)
        ? resultPage
        : otpForm({ action: `${FX}/order-result`, sub, message: 'Incorrect Value(enter the same as shown)' })),
    };
    let { ctx, page } = await open('/order', routes);
    let id = __testing.adoptPage(page, ctx, 'order-copy', USER);
    const v = await verifyLandOtp(id, USER, '123456');
    expect(v).toMatchObject({ status: 'captcha' });
    const ok = await submitLandCaptcha(id, USER, '7', {});
    expect(ok.status).toBe('ok');
    await ctx.close();

    ({ ctx, page } = await open('/order', routes));
    id = __testing.adoptPage(page, ctx, 'order-copy', USER);
    await verifyLandOtp(id, USER, '123456');
    expect(await code(submitLandCaptcha(id, USER, '9', {}))).toBe('OTP_REJECTED');
    await ctx.close();
  });

  it('captcha before the OTP is confirmed is refused', async () => {
    const { ctx, page } = await open('/order', { '/order': () => otpForm({ action: `${FX}/x`, sub: `<input id="captEntr"><img id="captcha_name" src="${CAPTCHA}"><input type="submit">` }) });
    const id = __testing.adoptPage(page, ctx, 'order-copy', USER);
    expect(await code(submitLandCaptcha(id, USER, '7', {}))).toBe('OTP_REJECTED');
    await ctx.close();
  });

  it('FMB: the site button opens the sketch window -> PDF', async () => {
    const { ctx, page } = await open('/fmb', {
      '/fmb': () => otpForm({ action: `${FX}/never`, sub: '<input type="button" onclick="return validate_fmb(\'ok\');" value="Submit">' }),
      '/sketch': () => '<!doctype html><html><body><h1>FMB Sketch</h1><svg width="200" height="100"><rect width="200" height="100"/></svg></body></html>',
      '/never': () => otpForm({ action: `${FX}/never`, sub: '', message: 'Invalid otp' }),
    });
    const id = __testing.adoptPage(page, ctx, 'fmb', USER);
    const out = await verifyLandOtp(id, USER, '123456');
    expect(out.status).toBe('ok');
    expect(landSessionPdf(id, USER).pdf.subarray(0, 5).toString()).toBe('%PDF-');
    await ctx.close();
  });

  it('FMB: a site alert comes back at once, not after a 40 s wait', async () => {
    const { ctx, page } = await open('/fmb', {
      '/fmb': () => otpForm({ action: `${FX}/never`, sub: '<input type="button" onclick="return validate_fmb(\'alert\');" value="Submit">' }),
    });
    const id = __testing.adoptPage(page, ctx, 'fmb', USER);
    const t0 = Date.now();
    expect(await code(verifyLandOtp(id, USER, '123456'))).toBe('OTP_REJECTED');
    expect(Date.now() - t0).toBeLessThan(5000);
    await ctx.close();
  });
});
