// =============================================================================
// validate-offence-kb — the honesty gate for the offence knowledge base.
//
// Runs three checks and exits non-zero on any failure (CI-friendly):
//   1. SHAPE      — offence-kb.json matches the zod schema (types, enums).
//   2. INTEGRITY  — ids unique; commonlyConfusedWith / cross-refs resolve.
//   3. CONSISTENCY— every oldRef (act+section) actually exists in
//                   sanhita-map.json, so the KB can never silently drift from
//                   the authoritative renumbering map.
//
// It also prints a coverage report: how many entries are still `needs-review`
// (i.e. NOT yet safe to auto-cite). That number is the ship-readiness metric.
//
//   run:  npx tsx apps/api/src/scripts/validate-offence-kb.ts
//   CI :  add to a "verify:data" script; fails the build on drift.
// =============================================================================

import { z } from 'zod';
import kbRaw from '../data/offence-kb.json';
import mappings from '../data/sanhita-map.json';

const OffenceLaw = z.enum(['BNS', 'BNSS', 'BSA']);
const OldAct = z.enum(['IPC', 'CrPC', 'IEA']);
const Verification = z.enum(['verified', 'needs-review', 'disputed']);
const TriState = z.union([z.boolean(), z.literal('conditional')]);

const EntrySchema = z.object({
  id: z.string().regex(/^[a-z]+-[0-9]+[a-z0-9()-]*$/, 'id must be a slug like "bns-318-cheating"'),
  offenceName: z.string().min(1),
  law: OffenceLaw,
  section: z.string().min(1),
  sectionTitle: z.string().min(1),
  oldRef: z.object({ act: OldAct, section: z.string().min(1) }).nullable(),
  aliases: z.array(z.string().min(1)).min(1, 'at least one alias so retrieval can hit it'),
  bailable: z.enum(['bailable', 'non-bailable', 'conditional']),
  cognizable: z.enum(['cognizable', 'non-cognizable', 'conditional']),
  compoundable: TriState,
  triableBy: z.string().min(1),
  punishment: z.string().min(1),
  essentialIngredients: z.array(z.string().min(1)).min(1, 'ingredients are what lets the AI reason like counsel'),
  commonlyConfusedWith: z.array(z.string()),
  verification: Verification,
  verifiedBy: z.string().optional(),
  verifiedAt: z.string().optional(),
  notes: z.string(),
});

const KbSchema = z.object({
  updatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  laws: z.array(OffenceLaw).min(1),
  entries: z.array(EntrySchema).min(1),
});

type Fail = { level: 'ERROR' | 'WARN'; msg: string };
const fails: Fail[] = [];
const err = (msg: string) => fails.push({ level: 'ERROR', msg });
const warn = (msg: string) => fails.push({ level: 'WARN', msg });

// ---- 1. SHAPE ---------------------------------------------------------------
const parsed = KbSchema.safeParse(kbRaw);
if (!parsed.success) {
  for (const issue of parsed.error.issues) {
    err(`SHAPE  ${issue.path.join('.') || '(root)'}: ${issue.message}`);
  }
  // Can't run deeper checks on a malformed file.
  report();
} else {
  const kb = parsed.data;

  // ---- 2. INTEGRITY ---------------------------------------------------------
  const ids = new Set<string>();
  for (const e of kb.entries) {
    if (ids.has(e.id)) err(`INTEGRITY  duplicate id "${e.id}"`);
    ids.add(e.id);
  }
  for (const e of kb.entries) {
    for (const ref of e.commonlyConfusedWith) {
      if (!ids.has(ref)) {
        // Not fatal: a confusion-pair may point at an offence not yet added.
        warn(`INTEGRITY  ${e.id}: commonlyConfusedWith "${ref}" is not (yet) in the KB`);
      }
    }
  }

  // ---- 3. CONSISTENCY vs sanhita-map.json -----------------------------------
  // Build an index of (fromAct|fromSection) present in the authoritative map.
  const mapIndex = new Set(
    (mappings as Array<{ fromAct: string; fromSection: string }>).map(
      (m) => `${m.fromAct}|${m.fromSection}`,
    ),
  );
  for (const e of kb.entries) {
    if (!e.oldRef) continue;
    const key = `${e.oldRef.act}|${e.oldRef.section}`;
    if (!mapIndex.has(key)) {
      err(
        `CONSISTENCY  ${e.id}: oldRef ${e.oldRef.act} ${e.oldRef.section} ` +
          `is NOT in sanhita-map.json — fix the section or add the mapping row.`,
      );
    }
  }

  // ---- COVERAGE report (not a failure, but the ship-readiness metric) --------
  const total = kb.entries.length;
  const byStatus = kb.entries.reduce<Record<string, number>>((acc, e) => {
    acc[e.verification] = (acc[e.verification] ?? 0) + 1;
    return acc;
  }, {});
  // eslint-disable-next-line no-console
  console.log('\n── Offence KB coverage ─────────────────────────────');
  // eslint-disable-next-line no-console
  console.log(`   entries        : ${total}`);
  // eslint-disable-next-line no-console
  console.log(`   verified       : ${byStatus.verified ?? 0}  (safe to auto-cite)`);
  // eslint-disable-next-line no-console
  console.log(`   needs-review   : ${byStatus['needs-review'] ?? 0}  (suggest-only until counsel checks)`);
  // eslint-disable-next-line no-console
  console.log(`   disputed       : ${byStatus.disputed ?? 0}  (never auto-cite)`);
  if ((byStatus.verified ?? 0) === 0) {
    warn(
      'COVERAGE  0 entries are "verified" — the drafting engine must run in ' +
        'suggest-only mode until counsel verifies at least the common offences.',
    );
  }

  report();
}

function report(): void {
  const errors = fails.filter((f) => f.level === 'ERROR');
  const warnings = fails.filter((f) => f.level === 'WARN');
  // eslint-disable-next-line no-console
  console.log('\n── Validation ──────────────────────────────────────');
  for (const f of fails) {
    // eslint-disable-next-line no-console
    console.log(`   [${f.level}] ${f.msg}`);
  }
  // eslint-disable-next-line no-console
  console.log(
    `\n   ${errors.length} error(s), ${warnings.length} warning(s).\n`,
  );
  if (errors.length > 0) process.exit(1);
}
