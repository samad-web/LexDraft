// Read-only smoke test of tn-land-records.service against the live site:
// opens a service, walks the site's own District > Taluk > Village lists and
// a survey number's sub divisions, and fetches a captcha image. Never sends
// an OTP or submits a form.  Run: npx tsx src/scripts/tn-land-records-smoke.ts
import {
  endLandSession, loadSubdivisions, selectLandField, startLandSession,
} from '../services/tn-land-records.service';

const USER = 'smoke-user';

async function main(): Promise<void> {
  const s = await startLandSession(USER, 'patta');
  console.log('patta:', s.title, 'gate', s.gate, 'districts', s.districts.length, s.districts.slice(0, 3));
  const district = s.districts.find((d) => /chengalpattu/i.test(d.label)) ?? s.districts[0]!;
  const t = await selectLandField(s.sessionId, USER, 'district', district.value);
  console.log('taluks of', district.label, t.options.length, t.options.slice(0, 3));
  const taluk = t.options[0]!;
  const v = await selectLandField(s.sessionId, USER, 'taluk', taluk.value);
  console.log('villages of', taluk.label, v.options.length, v.options.slice(0, 3), 'askLandType', v.askLandType);
  await selectLandField(s.sessionId, USER, 'village', v.options[0]!.value);
  const sd = await loadSubdivisions(s.sessionId, USER, '1', v.askLandType ? 'R' : undefined);
  console.log('subdivisions of survey 1:', sd.options.length, sd.options.slice(0, 5), sd.message ?? '');
  await endLandSession(s.sessionId, USER);

  const p = await startLandSession(USER, 'poramboke');
  console.log('poramboke:', p.gate, 'districts', p.districts.length, 'captcha', p.captchaImage?.slice(0, 40), p.captchaImage?.length);
  await endLandSession(p.sessionId, USER);

  const u = await startLandSession(USER, 'tslr-extract');
  const ud = u.districts.find((d) => /chennai/i.test(d.label)) ?? u.districts[0]!;
  const ut = await selectLandField(u.sessionId, USER, 'district', ud.value);
  console.log('tslr taluks of', ud.label, ut.options.length, ut.options.slice(0, 2));
  const town = await selectLandField(u.sessionId, USER, 'taluk', ut.options[0]!.value);
  console.log('towns', town.options.length, town.options.slice(0, 2));
  const ward = await selectLandField(u.sessionId, USER, 'village', town.options[0]!.value);
  console.log('wards', ward.next, ward.options.length, ward.options.slice(0, 3));
  await endLandSession(u.sessionId, USER);
}

main().catch((err) => {
  console.error('smoke failed:', err);
  process.exitCode = 1;
}).finally(() => setTimeout(() => process.exit(), 500));
