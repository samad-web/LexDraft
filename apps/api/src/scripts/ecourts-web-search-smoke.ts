// Smoke test for ecourts-web-search.service against the live eCourts website.
//
//   pnpm --filter api exec tsx src/scripts/ecourts-web-search-smoke.ts [kind ...]
//
// Opens each website-only search up to the CAPTCHA, saves the image next to
// this run (./ecourts-captcha-<kind>.png), prints any court/judge options the
// search needs, then submits a deliberately wrong answer to check the "wrong
// captcha -> new image" path. It never tries to solve the CAPTCHA - to check
// real results, run the search from the UI.
//
// Default court: Kerala / Ernakulam / District Court Annex, Kaloor (complex
// 1040011, court 33). Pass kinds to run a subset. Keep runs small and
// occasional - the site throttles an IP after ~5 browser sessions in a few
// minutes.
import { writeFileSync } from 'node:fs';
import {
  endWebSearchSession,
  startWebSearch,
  submitWebSearch,
  type WebSearchFields,
} from '../services/ecourts-web-search.service';

const scope = { stateCode: 4, distCode: 2, complexCode: '1040011', courtCode: 33 };
const year = new Date().getFullYear();
const dmy = (d: Date) => `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;

const ALL: WebSearchFields[] = [
  { kind: 'act', actCode: '2', actName: 'Abkari act', status: 'Pending' },
  { kind: 'cause-list', date: dmy(new Date()), listType: 'civ' },
  { kind: 'case-type', caseTypeCode: '59', caseTypeName: 'AS - CIVIL APPEAL', year: year - 1, status: 'Pending' },
  { kind: 'party-status', partyName: 'Kumar', year: year - 1, status: 'Pending' },
  { kind: 'orders-date', fromDate: dmy(new Date(Date.now() - 14 * 864e5)), toDate: dmy(new Date()), orderType: 'both' },
  { kind: 'orders-court', orderType: 'both' },
];

const wanted = new Set(process.argv.slice(2));
const CASES = wanted.size ? ALL.filter((f) => wanted.has(f.kind)) : ALL.slice(0, 2);

void (async () => {
  for (const fields of CASES) {
    try {
      const t0 = Date.now();
      const { sessionId, captchaImageBase64, choice } = await startWebSearch('smoke', scope, fields);
      writeFileSync(`ecourts-captcha-${fields.kind}.png`, Buffer.from(captchaImageBase64, 'base64'));
      console.log(`${fields.kind}: captcha ready in ${Date.now() - t0}ms`);
      if (choice) console.log(`  ${choice.label}: ${choice.options.length} options, e.g. ${choice.options.slice(0, 3).map((o) => o.label).join(' | ')}`);
      const r = await submitWebSearch(sessionId, 'smoke', 'zzzzzz', choice?.options[0]?.value);
      console.log(`  wrong captcha -> ${r.status}${r.status === 'retry' ? ` (${r.reason})` : ''}`);
      await endWebSearchSession(sessionId, 'smoke');
    } catch (err) {
      console.log(`${fields.kind}: ERROR ${(err as Error).message}`);
    }
  }
  process.exit(0);
})();
