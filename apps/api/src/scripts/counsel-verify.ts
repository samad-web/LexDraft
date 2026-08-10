// =============================================================================
// counsel-verify — the tool a lawyer uses to move KB entries through the
// verification gate (needs-review -> verified | disputed).
//
// Only `verified` entries are cited as hard law by the drafting engine; the CLI
// stamps who verified and when, so there is an audit trail on every decision.
// After any write it re-runs the matching validator, so a bad edit can never be
// left behind silently.
//
// COMMANDS
//   list                       Show every entry with the legal values to check.
//   list --status needs-review Filter by current status.
//   set <id...> --status verified --by "Adv. R. Sharma"
//   set --all --status verified --by "Adv. R. Sharma"   (flip the whole file)
//
// FLAGS
//   --kb offence|procedure     Which knowledge base (default: offence)
//   --status verified|needs-review|disputed
//   --by "<name>"              Required for `set`; recorded as verifiedBy
//   --all                      Apply to every entry (set only)
//   --date YYYY-MM-DD          Override the stamp date (no runtime clock here)
//
// EXAMPLES
//   npx tsx apps/api/src/scripts/counsel-verify.ts list --kb offence
//   npx tsx apps/api/src/scripts/counsel-verify.ts set bns-318-cheating \
//     --status verified --by "Adv. R. Sharma" --date 2026-08-11
// =============================================================================

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

type Status = 'verified' | 'needs-review' | 'disputed';
const STATUSES: Status[] = ['verified', 'needs-review', 'disputed'];

interface Entry {
  id: string;
  offenceName?: string;
  purpose?: string;
  law: string;
  section: string;
  sectionTitle: string;
  bailable?: string;
  cognizable?: string;
  punishment?: string;
  forum?: string;
  verification: Status;
  verifiedBy?: string;
  verifiedAt?: string;
  [k: string]: unknown;
}
interface Kb {
  entries: Entry[];
  [k: string]: unknown;
}

const KB_FILES: Record<string, { path: string; validator: string }> = {
  offence: { path: 'data/offence-kb.json', validator: 'validate-offence-kb.ts' },
  procedure: { path: 'data/procedure-kb.json', validator: 'validate-procedure-kb.ts' },
};

// ---- arg parsing (tiny, dependency-free) -----------------------------------

const argv = process.argv.slice(2);
const command = argv[0];

function flag(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < argv.length ? argv[i + 1] : undefined;
}
function has(name: string): boolean {
  return argv.includes(`--${name}`);
}
/** Positional ids: args after the command that are not flags/flag-values. */
function positionalIds(): string[] {
  const ids: string[] = [];
  for (let i = 1; i < argv.length; i += 1) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      // skip this flag and its value (all our flags take a value except --all)
      if (a !== '--all') i += 1;
      continue;
    }
    ids.push(a);
  }
  return ids;
}

function die(msg: string): never {
  // eslint-disable-next-line no-console
  console.error(`error: ${msg}`);
  process.exit(1);
}

function resolveKb(): { key: string; path: string; validator: string } {
  const key = flag('kb') ?? 'offence';
  const entry = KB_FILES[key];
  if (!entry) die(`unknown --kb "${key}" (use: ${Object.keys(KB_FILES).join(' | ')})`);
  return { key, path: join(__dirname, '..', entry.path), validator: entry.validator };
}

function load(path: string): Kb {
  return JSON.parse(readFileSync(path, 'utf8')) as Kb;
}
function save(path: string, kb: Kb): void {
  writeFileSync(path, `${JSON.stringify(kb, null, 2)}\n`, 'utf8');
}

const ICON: Record<Status, string> = { verified: '✓', 'needs-review': '•', disputed: '✗' };

function runValidator(validator: string): void {
  // eslint-disable-next-line no-console
  console.log(`\n── re-running ${validator} ──`);
  try {
    // execSync (single command string) so the platform shell resolves `npx`
    // (npx.cmd on Windows). The path is quoted; no user input is interpolated.
    const out = execSync(`npx tsx "${join(__dirname, validator)}"`, { encoding: 'utf8' });
    // eslint-disable-next-line no-console
    console.log(out.trim());
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    // eslint-disable-next-line no-console
    console.log((e.stdout ?? '').trim());
    // eslint-disable-next-line no-console
    console.error((e.stderr ?? '').trim());
    die('validator FAILED after write — review the file.');
  }
}

// ---- commands ---------------------------------------------------------------

function cmdList(): void {
  const { path } = resolveKb();
  const kb = load(path);
  const statusFilter = flag('status') as Status | undefined;
  if (statusFilter && !STATUSES.includes(statusFilter)) die(`--status must be one of: ${STATUSES.join(' | ')}`);

  const rows = kb.entries.filter((e) => !statusFilter || e.verification === statusFilter);
  const counts = kb.entries.reduce<Record<string, number>>((a, e) => {
    a[e.verification] = (a[e.verification] ?? 0) + 1;
    return a;
  }, {});

  // eslint-disable-next-line no-console
  console.log(`\n${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}${statusFilter ? ` (status=${statusFilter})` : ''}:\n`);
  for (const e of rows) {
    const name = e.offenceName ?? e.purpose ?? '';
    // eslint-disable-next-line no-console
    console.log(`  ${ICON[e.verification]} ${e.id}`);
    // eslint-disable-next-line no-console
    console.log(`      ${e.law} ${e.section} — ${name}`);
    const legal = [
      e.bailable && `bailable: ${e.bailable}`,
      e.cognizable && `cognizable: ${e.cognizable}`,
      e.forum && `forum: ${e.forum}`,
    ].filter(Boolean).join('   ');
    if (legal) console.log(`      ${legal}`); // eslint-disable-line no-console
    if (e.punishment) console.log(`      punishment: ${e.punishment}`); // eslint-disable-line no-console
    if (e.verifiedBy) console.log(`      verified by ${e.verifiedBy} on ${e.verifiedAt ?? '?'}`); // eslint-disable-line no-console
    // eslint-disable-next-line no-console
    console.log('');
  }
  // eslint-disable-next-line no-console
  console.log(`summary: ${STATUSES.map((s) => `${ICON[s]} ${s}=${counts[s] ?? 0}`).join('   ')}\n`);
}

function cmdSet(): void {
  const { path, validator } = resolveKb();
  const status = flag('status') as Status | undefined;
  if (!status || !STATUSES.includes(status)) die(`set requires --status ${STATUSES.join(' | ')}`);
  const by = flag('by');
  if (!by) die('set requires --by "<name>" for the audit trail');
  const date = flag('date');
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) die('--date must be YYYY-MM-DD');
  // No runtime clock in this environment for reproducibility; require --date
  // unless setting back to needs-review (which clears the stamp).
  if (status !== 'needs-review' && !date) die('--date YYYY-MM-DD is required when setting verified/disputed');

  const kb = load(path);
  const all = has('all');
  const ids = positionalIds();
  if (!all && ids.length === 0) die('pass one or more ids, or --all');

  const byId = new Map(kb.entries.map((e) => [e.id, e]));
  const targets = all ? kb.entries : ids.map((id) => byId.get(id) ?? die(`unknown id "${id}"`));

  let changed = 0;
  for (const e of targets) {
    if (e.verification === status && e.verifiedBy === by) continue;
    e.verification = status;
    if (status === 'needs-review') {
      delete e.verifiedBy;
      delete e.verifiedAt;
    } else {
      e.verifiedBy = by;
      e.verifiedAt = date;
    }
    changed += 1;
  }

  save(path, kb);
  // eslint-disable-next-line no-console
  console.log(`set ${changed} entr${changed === 1 ? 'y' : 'ies'} -> ${status} (by ${by})`);
  runValidator(validator);
}

function usage(): void {
  // eslint-disable-next-line no-console
  console.log(`counsel-verify — move KB entries through the verification gate

  list  [--kb offence|procedure] [--status verified|needs-review|disputed]
  set   <id...>|--all  --status <s>  --by "<name>"  [--date YYYY-MM-DD]  [--kb ...]

examples:
  npx tsx apps/api/src/scripts/counsel-verify.ts list --status needs-review
  npx tsx apps/api/src/scripts/counsel-verify.ts set bns-318-cheating --status verified --by "Adv. R. Sharma" --date 2026-08-11
`);
}

switch (command) {
  case 'list':
    cmdList();
    break;
  case 'set':
    cmdSet();
    break;
  default:
    usage();
    if (command) die(`unknown command "${command}"`);
}
