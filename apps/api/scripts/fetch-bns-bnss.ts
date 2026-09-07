// =============================================================================
// Fetch BNS / BNSS section text from the official source → source JSON
//
// Produces apps/api/scripts/data/bns-bnss-sections.json (the full file the
// ingest pipeline consumes). The section text MUST come from the official
// gazette / IndiaCode, never from a language model — a hallucinated statute is
// exactly the failure mode this whole product exists to prevent, and one that
// has drawn court sanctions against advocates.
//
// SOURCE OPTIONS (pick per your infra; this script is deliberately explicit
// about where the bytes come from so no one can mistake AI text for law):
//
//   1. IndiaCode bare-act PDFs (recommended, authoritative):
//        BNS  2023 (No. 45 of 2023):  https://www.indiacode.nic.in/  (search "Bharatiya Nyaya Sanhita")
//        BNSS 2023 (No. 46 of 2023):  https://www.indiacode.nic.in/  (search "Bharatiya Nagarik Suraksha")
//      Download the official section-wise PDF/XML, extract per-section text.
//
//   2. eGazette notified text (also authoritative).
//
// This script does NOT invent text. If it cannot reach a configured source, it
// stops with a clear error rather than fabricating sections. Wiring a specific
// source parser is an explicit, reviewed step — see `TODO: SOURCE PARSER`.
//
//   pnpm --filter @lexdraft/api fetch:bns-bnss --source <url-or-path>
//   pnpm --filter @lexdraft/api fetch:bns-bnss --check     # validate existing file
// =============================================================================

// writeFileSync is used by the source parser once wired (see TODO: SOURCE
// PARSER); imported now so the parser tail compiles without a churny diff.
import { readFileSync, writeFileSync as _writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, 'data/bns-bnss-sections.json');

interface SourceSection {
  act: 'BNS' | 'BNSS';
  actTitle: string;
  actYear: number;
  section: string;
  heading: string;
  text: string;
  oldSection: string | null;
  oldAct: 'IPC' | 'CrPC' | null;
  verified: boolean;
}

// Expected section counts — used as a completeness check so a partial scrape
// can't silently pass as "the whole code".
const EXPECTED = { BNS: 358, BNSS: 531 } as const;

function parseArgs(argv: string[]): { source: string | null; check: boolean } {
  let source: string | null = null;
  let check = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--source') source = argv[++i] ?? null;
    else if (argv[i] === '--check') check = true;
  }
  return { source, check };
}

/** Validate a completed source file: shape, per-act counts, no empty text,
 *  no obviously-AI placeholder text. Loud on any gap. */
function checkFile(): void {
  if (!existsSync(OUT_PATH)) {
    console.error(`No source file at ${OUT_PATH}. Run with --source first.`);
    process.exit(2);
  }
  const data = JSON.parse(readFileSync(OUT_PATH, 'utf8')) as { sections: SourceSection[] };
  const rows = data.sections ?? [];
  const counts = { BNS: 0, BNSS: 0 };
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    counts[r.act] = (counts[r.act] ?? 0) + 1;
    const key = `${r.act}:${r.section}`;
    if (seen.has(key)) problems.push(`duplicate ${key}`);
    seen.add(key);
    if (!r.text || r.text.trim().length < 20) problems.push(`${key}: empty/short text`);
    if (/lorem ipsum|as an ai|placeholder|TODO/i.test(r.text)) problems.push(`${key}: placeholder text — NOT real law`);
    if (!r.heading?.trim()) problems.push(`${key}: missing heading`);
  }
  console.log(`BNS:  ${counts.BNS}/${EXPECTED.BNS}`);
  console.log(`BNSS: ${counts.BNSS}/${EXPECTED.BNSS}`);
  const verified = rows.filter((r) => r.verified === true).length;
  console.log(`Verified against gazette: ${verified}/${rows.length}`);
  if (counts.BNS < EXPECTED.BNS) problems.push(`BNS incomplete (${counts.BNS}/${EXPECTED.BNS})`);
  if (counts.BNSS < EXPECTED.BNSS) problems.push(`BNSS incomplete (${counts.BNSS}/${EXPECTED.BNSS})`);
  if (problems.length) {
    console.error(`\n${problems.length} problem(s):`);
    for (const p of problems.slice(0, 40)) console.error('  - ' + p);
    process.exit(1);
  }
  console.log('\nOK — file is complete and free of placeholder text.');
}

async function main(): Promise<void> {
  const { source, check } = parseArgs(process.argv.slice(2));
  if (check) { checkFile(); return; }

  if (!source) {
    console.error(
      'No --source given.\n\n'
      + 'This script will not fabricate statute text. Provide the official source:\n'
      + '  --source <path-to-official-BNS/BNSS-PDF-or-XML>\n'
      + '  --source <IndiaCode URL>\n\n'
      + 'Then wire the parser at "TODO: SOURCE PARSER" for that format. Until a\n'
      + 'source parser is wired, use the reviewed seed:\n'
      + '  pnpm --filter @lexdraft/api ingest:bns-bnss --sample\n',
    );
    process.exit(2);
  }

  // TODO: SOURCE PARSER
  // Implement the extractor for the chosen official format (PDF via
  // pdf-parse / pdfjs-dist, or the IndiaCode XML). It must emit one
  // SourceSection per section with the VERBATIM gazette text and set
  // `verified: false` until a human has checked it against the PDF. Writing a
  // parser is deliberately left as an explicit step so no one wires an
  // unofficial or model-generated source by accident.
  console.error(
    `Source parser not yet wired for: ${source}\n`
    + `Implement the extractor at "TODO: SOURCE PARSER" in this file for the\n`
    + `official format, then re-run. See README-bns-bnss.md for the two vetted\n`
    + `sources (IndiaCode bare act, eGazette).`,
  );
  process.exit(3);

  // When the parser is implemented, the tail looks like:
  //   const sections = await parseOfficialSource(source);
  //   writeFileSync(OUT_PATH, JSON.stringify({ sections }, null, 2));
  //   console.log(`Wrote ${sections.length} sections → ${OUT_PATH}`);
}

main().catch((err: unknown) => {
  console.error('fetch-bns-bnss crashed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
