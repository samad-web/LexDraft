// =============================================================================
// BNS local corpus seed
//
// Loads apps/api/scripts/data/bns-bnss-sections.json (358 real BNS sections,
// full gazette text, scraped from the official IndiaCode PDF — not AI-
// generated) into the local `bns_sections` table (0078_bns_sections_corpus.sql)
// so bns-search.service.ts has something to search. No external API, no
// embedding service — this is the whole corpus for the self-contained
// "Search statutes" feature until BNSS/other acts get the same treatment.
//
// Every row keeps the source file's `verified: false` tag as-is — this
// script does NOT mark anything verified; that's a human decision made
// separately (see bns-search.service.ts's own comment on the distinction).
//
//   pnpm --filter @lexdraft/api ingest:bns-local            # full file
//   pnpm --filter @lexdraft/api ingest:bns-local --dry-run  # parse + report only
//
// Idempotent: upserts on (act, section_number), so re-running after a fixed
// parse just updates existing rows.
// =============================================================================

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../src/db/client';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface SourceSection {
  act: string;
  actTitle: string;
  actYear: number;
  section: string;
  heading: string;
  text: string;
  oldSection: string | null;
  oldAct: string | null;
  verified: boolean;
}

interface SourceFile {
  sections: SourceSection[];
}

function parseArgs(argv: string[]): { dryRun: boolean; help: boolean } {
  return {
    dryRun: argv.includes('--dry-run'),
    help: argv.includes('--help') || argv.includes('-h'),
  };
}

function printHelp(): void {
  process.stdout.write(
    'BNS local corpus seed\n\n'
    + '  pnpm --filter @lexdraft/api ingest:bns-local [options]\n\n'
    + '  --dry-run   Parse + report, write nothing\n'
    + '  -h, --help  This message\n\n'
    + 'Requires DATABASE_URL (the main app DB — see 0078_bns_sections_corpus.sql).\n',
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const sourcePath = resolve(__dirname, 'data', 'bns-bnss-sections.json');
  const raw = readFileSync(sourcePath, 'utf8');
  const parsed = JSON.parse(raw) as SourceFile;
  const rows = parsed.sections.filter((s) => s.act === 'BNS');

  process.stdout.write(`Parsed ${rows.length} BNS sections from ${sourcePath}\n`);
  const verifiedCount = rows.filter((r) => r.verified).length;
  process.stdout.write(`  verified: ${verifiedCount} / ${rows.length}\n`);

  if (args.dryRun) {
    process.stdout.write('Dry run — nothing written.\n');
    return;
  }

  const sql = db();
  if (!sql) {
    process.stderr.write('DATABASE_URL is not configured. Add it to apps/api/.env and re-run.\n');
    process.exitCode = 1;
    return;
  }

  let written = 0;
  for (const row of rows) {
    await sql`
      insert into bns_sections (act, act_title, act_year, section_number, heading, body_text, old_act, old_section, verified, updated_at)
      values (${row.act}, ${row.actTitle}, ${row.actYear}, ${row.section}, ${row.heading}, ${row.text}, ${row.oldAct}, ${row.oldSection}, ${row.verified}, now())
      on conflict (act, section_number) do update set
        act_title = excluded.act_title,
        act_year = excluded.act_year,
        heading = excluded.heading,
        body_text = excluded.body_text,
        old_act = excluded.old_act,
        old_section = excluded.old_section,
        verified = excluded.verified,
        updated_at = now()
    `;
    written += 1;
  }

  process.stdout.write(`Upserted ${written} rows into bns_sections.\n`);
  await sql.end({ timeout: 5 });
}

void main();
