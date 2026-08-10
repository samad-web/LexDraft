// =============================================================================
// verify-bnss-migration — confirms the bail/quashing skeletons were migrated
// from the repealed CrPC to BNSS, and that old keys still resolve (back-compat).
//
//   run:  npx tsx apps/api/src/scripts/verify-bnss-migration.ts
// exits non-zero on any failure.
// =============================================================================

import { getDocFormat } from '../lib/doc-formats';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  if (!cond) failures += 1;
  // eslint-disable-next-line no-console
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
}

// 1) Migrated keys resolve and carry BNSS citations, not CrPC.
const regular = getDocFormat('Application for Regular Bail (Section 480/483 BNSS)');
check('regular bail key resolves', !!regular);
check('regular bail cites BNSS 480', !!regular && /SECTION 480 OF THE BHARATIYA NAGARIK/i.test(regular.skeleton));
check('regular bail no longer cites CrPC 437', !!regular && !/SECTION 437 OF THE CODE OF CRIMINAL/i.test(regular.skeleton));

const antic = getDocFormat('Application for Anticipatory Bail (Section 482 BNSS)');
check('anticipatory bail key resolves', !!antic);
check('anticipatory bail cites BNSS 482', !!antic && /SECTION 482 OF THE BHARATIYA NAGARIK/i.test(antic.skeleton));
check('anticipatory bail no longer cites CrPC 438', !!antic && !/SECTION 438 OF THE CODE OF CRIMINAL/i.test(antic.skeleton));

// 2) Back-compat: the OLD CrPC-named keys still resolve to the migrated skeletons.
const oldRegular = getDocFormat('Application for Regular Bail (Section 437/439 CrPC)');
check('old CrPC regular-bail key still resolves (back-compat)', !!oldRegular);
check('old key maps to the BNSS skeleton', !!oldRegular && /SECTION 480 OF THE BHARATIYA NAGARIK/i.test(oldRegular.skeleton));

const oldAntic = getDocFormat('Application for Anticipatory Bail (Section 438 CrPC)');
check('old CrPC anticipatory-bail key still resolves (back-compat)', !!oldAntic);

// 3) Picker-label aliases resolve.
check('picker "Bail Application" resolves', !!getDocFormat('Bail Application'));
check('picker "Application for Anticipatory Bail" resolves', !!getDocFormat('Application for Anticipatory Bail'));

// 4) Quashing/writ body migrated to BNSS 528.
const writ = getDocFormat('Writ Petition (Criminal)');
check('criminal writ cites BNSS 528 (not CrPC 482)', !!writ && /SECTION 528 OF THE BHARATIYA NAGARIK/i.test(writ.skeleton) && !/SECTION 482 OF THE CODE OF CRIMINAL/i.test(writ.skeleton));

// 5) Maintenance 125 is explicitly flagged (not silently left, not blind-guessed).
const maint = getDocFormat('Application for Maintenance (Section 125 CrPC)');
check('maintenance 125 flagged UNVERIFIED (not blind-migrated)', !!maint && /UNVERIFIED/i.test(maint.note));

// eslint-disable-next-line no-console
console.log(`\n${failures === 0 ? 'MIGRATION VERIFIED' : `${failures} CHECK(S) FAILED`}\n`);
if (failures > 0) process.exit(1);
