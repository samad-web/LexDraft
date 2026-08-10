// =============================================================================
// validate-procedure-kb — honesty gate for the BNSS procedural KB, PLUS a drift
// scan that flags any bail/quashing skeleton still citing the repealed CrPC.
//
//   1. SHAPE       — procedure-kb.json matches the zod schema.
//   2. CONSISTENCY — every oldRef exists in sanhita-map.json (no drift).
//   3. DRIFT-SCAN  — reports CrPC references found in doc-formats.ts so the
//                    bail/complaint skeletons can be migrated to BNSS.
//
//   run:  npx tsx apps/api/src/scripts/validate-procedure-kb.ts
// =============================================================================

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import kbRaw from '../data/procedure-kb.json';
import mappings from '../data/sanhita-map.json';

const EntrySchema = z.object({
  id: z.string().regex(/^[a-z]+-[0-9]+[a-z0-9()-]*$/),
  purpose: z.string().min(1),
  law: z.literal('BNSS'),
  section: z.string().min(1),
  sectionTitle: z.string().min(1),
  oldRef: z.object({ act: z.enum(['IPC', 'CrPC', 'IEA']), section: z.string().min(1) }).nullable(),
  aliases: z.array(z.string().min(1)).min(1),
  forum: z.string().min(1),
  whenUsed: z.string().min(1),
  verification: z.enum(['verified', 'needs-review', 'disputed']),
  verifiedBy: z.string().optional(),
  verifiedAt: z.string().optional(),
  notes: z.string(),
});
const KbSchema = z.object({
  updatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  law: z.literal('BNSS'),
  note: z.string(),
  entries: z.array(EntrySchema).min(1),
});

const errors: string[] = [];
const warnings: string[] = [];

// ---- 1. SHAPE ---------------------------------------------------------------
const parsed = KbSchema.safeParse(kbRaw);
if (!parsed.success) {
  for (const i of parsed.error.issues) errors.push(`SHAPE  ${i.path.join('.') || '(root)'}: ${i.message}`);
} else {
  const kb = parsed.data;
  const ids = new Set<string>();
  for (const e of kb.entries) {
    if (ids.has(e.id)) errors.push(`INTEGRITY  duplicate id "${e.id}"`);
    ids.add(e.id);
  }

  // ---- 2. CONSISTENCY vs sanhita-map.json -----------------------------------
  const mapIndex = new Set(
    (mappings as Array<{ fromAct: string; fromSection: string; toAct: string; toSection: string }>).map(
      (m) => `${m.fromAct}|${m.fromSection}`,
    ),
  );
  const mapLookup = new Map(
    (mappings as Array<{ fromAct: string; fromSection: string; toSection: string }>).map(
      (m) => [`${m.fromAct}|${m.fromSection}`, m.toSection],
    ),
  );
  for (const e of kb.entries) {
    if (!e.oldRef) continue;
    const key = `${e.oldRef.act}|${e.oldRef.section}`;
    if (!mapIndex.has(key)) {
      errors.push(`CONSISTENCY  ${e.id}: oldRef ${e.oldRef.act} ${e.oldRef.section} not in sanhita-map.json`);
      continue;
    }
    // Bonus: the KB section should agree with the map's target section (base part).
    const mapped = mapLookup.get(key) ?? '';
    const base = (s: string) => s.replace(/\(.*/, ''); // "187(3)" -> "187"
    if (mapped && base(mapped) !== base(e.section)) {
      warnings.push(
        `CONSISTENCY  ${e.id}: KB says BNSS ${e.section} but map says ${e.oldRef.act} ${e.oldRef.section} -> BNSS ${mapped}. Reconcile.`,
      );
    }
  }
}

// ---- 3. DRIFT-SCAN of doc-formats.ts ---------------------------------------
// Not fatal (the skeletons are a separate migration task) but surfaced loudly.
try {
  const formatsPath = join(__dirname, '..', 'lib', 'doc-formats.ts');
  const src = readFileSync(formatsPath, 'utf8');
  // Count STALE citations (a CrPC section actually being cited as the operative
  // law), not intentional mentions. We treat a line as stale when it names the
  // Code of Criminal Procedure / CrPC AND is NOT one of:
  //   - a back-compat alias key (maps an old CrPC-named key -> a BNSS key),
  //   - an explanatory note that says "replaces/was CrPC ..." ,
  //   - a line already flagged UNVERIFIED.
  const stale: string[] = [];
  src.split('\n').forEach((line, i) => {
    if (!/Cr\.?\s?P\.?\s?C\.?|Code of Criminal Procedure/i.test(line)) return;
    const intentional =
      /:\s*'[^']*BNSS[^']*'/.test(line) || // alias whose VALUE is a BNSS key (back-compat row)
      /:\s*\{$/.test(line.trim()) || // a DOC_FORMATS/format KEY line (title only)
      /replaces CrPC|was CrPC|not CrPC|old CrPC|before the|inherent powers\)/i.test(line) ||
      /UNVERIFIED/i.test(line);
    if (!intentional) stale.push(`line ${i + 1}: ${line.trim().slice(0, 90)}`);
  });
  if (stale.length > 0) {
    warnings.push(
      `DRIFT  doc-formats.ts still has ${stale.length} STALE CrPC citation(s) to migrate to BNSS:\n` +
        stale.map((s) => `           ${s}`).join('\n'),
    );
  }
} catch {
  warnings.push('DRIFT  could not read doc-formats.ts to scan for CrPC references.');
}

// ---- report -----------------------------------------------------------------
// eslint-disable-next-line no-console
console.log('\n── Procedure KB validation ─────────────────────────');
for (const e of errors) console.log(`   [ERROR] ${e}`); // eslint-disable-line no-console
for (const w of warnings) console.log(`   [WARN]  ${w}`); // eslint-disable-line no-console
// eslint-disable-next-line no-console
console.log(`\n   ${errors.length} error(s), ${warnings.length} warning(s).\n`);
if (errors.length > 0) process.exit(1);
