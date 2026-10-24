// Read-only probe of eservices.tn.gov.in (TN Land Records). Opens the home
// page in a real browser, clicks each service link as a user would, and dumps
// the visible form structure (labels, controls, options, captcha/OTP). No
// form is submitted. Run: npx tsx src/scripts/tn-eservices-probe.ts <outDir>
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- DOM global
declare const document: any;

const HOME = 'https://eservices.tn.gov.in/eservicesnew/index.html';
const LINKS = [
  'land/chittaCheckNewRural_en.html', 'land/areg.html', 'land/verify_chitta.html', 'land/poramboke.html',
  'land/chittaCheckNewRuralFMB_en.html', 'land/orderCopy.html', 'land/chittaCheckNewUrban_en.html',
  'land/chittaCheckNewUrbanFMB_en.html', 'login/Appstatus.html', 'land/fline_en.html', 'land/cittaaregadanextracten.html',
];

async function main(): Promise<void> {
  const out = process.argv[2] ?? '.';
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addInitScript('window.__name = window.__name || function (f) { return f; };');
  const page = await context.newPage();
  page.on('dialog', (d) => void d.dismiss().catch(() => {}));
  const report: Record<string, unknown> = {};
  for (const href of LINKS) {
    try {
      await page.goto(HOME, { waitUntil: 'load', timeout: 45_000 });
      const link = page.locator(`a[href^="${href}"]`).first();
      await link.evaluate((a: { removeAttribute: (n: string) => void }) => a.removeAttribute('target'));
      await Promise.all([page.waitForLoadState('load'), link.evaluate((a: { click: () => void }) => a.click())]);
      await page.waitForTimeout(3500); // let district lists / captcha load
      const info = await page.evaluate(() => {
        const txt = (el: { textContent: string | null } | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
        const controls = [...document.querySelectorAll('input, select, textarea, button, img[id*="captcha" i]')]
          .filter((el: { type: string }) => el.type !== 'hidden')
          .map((el: any) => ({
            tag: el.tagName.toLowerCase(), type: el.type ?? null, id: el.id || null, name: el.name || null,
            value: el.tagName === 'SELECT' ? null : (el.value ?? '').slice(0, 60), placeholder: el.placeholder || null,
            visible: el.offsetParent !== null, onchange: el.getAttribute('onchange'), onclick: el.getAttribute('onclick'),
            label: txt(el.closest('.col-sm-3, .col-lg-4, .col-md-3, div')?.previousElementSibling ?? null).slice(0, 80),
            options: el.tagName === 'SELECT' ? [...el.options].slice(0, 15).map((o: any) => `${o.value}=${txt(o)}`) : undefined,
            optionCount: el.tagName === 'SELECT' ? el.options.length : undefined,
          }));
        const form = document.querySelector('form');
        return {
          url: document.location.href.replace(/rno=[^&]+/, 'rno=…'), title: document.title,
          heading: txt(document.querySelector('.container-fluid span')),
          formAction: form?.getAttribute('action') ?? null, formOnsubmit: form?.getAttribute('onsubmit') ?? null,
          bodyText: txt(document.querySelector('section') ?? document.body).slice(0, 2500),
          controls,
        };
      });
      report[href] = info;
      writeFileSync(join(out, href.replace(/\//g, '_') + '.html'), await page.content());
      console.log('ok', href, info.title);
    } catch (err) {
      report[href] = { error: String(err) };
      console.log('fail', href, String(err).slice(0, 200));
    }
    await page.waitForTimeout(2000);
  }
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
}

void main();
