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

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pdfParse from 'pdf-parse';

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

function parseArgs(argv: string[]): { source: string | null; check: boolean; act: 'BNS' | 'BNSS' | null } {
  let source: string | null = null;
  let check = false;
  let act: 'BNS' | 'BNSS' | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--source') source = argv[++i] ?? null;
    else if (argv[i] === '--check') check = true;
    else if (argv[i] === '--act') {
      const v = (argv[++i] ?? '').toUpperCase();
      if (v === 'BNS' || v === 'BNSS') act = v;
    }
  }
  return { source, check, act };
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

async function loadSourceBytes(source: string): Promise<Buffer> {
  if (/^https?:\/\//i.test(source)) {
    const res = await fetch(source, { headers: { 'user-agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error(`fetch failed: ${res.status} ${res.statusText} for ${source}`);
    return Buffer.from(await res.arrayBuffer());
  }
  if (!existsSync(source)) throw new Error(`source file not found: ${source}`);
  return readFileSync(source);
}

/**
 * Parses the official IndiaCode bare-act PDF for the Bharatiya Nyaya Sanhita,
 * 2023 (Act No. 45 of 2023, 358 sections).
 *
 * Validated against the real gazette text (indiacode.nic.in bitstream
 * 123456789/20062), not assumed — the layout quirks handled below (doubled
 * dash glyphs, section numbers lacking a leading newline, missing space after
 * the section-number period, headings with no closing period before the
 * dash) were each found by running this regex against the actual PDF and
 * checking section coverage landed at exactly 358/358 with no duplicates.
 */
function parseBns(pdfText: string): SourceSection[] {
  // pdf-parse emits `\f` between pages — strip each page's leading running
  // header (a bare page number) before rejoining, or stray digits bleed into
  // section bodies mid-sentence.
  const pages = pdfText.split('\f').map((page) => {
    const lines = page.split('\n');
    if (lines.length && /^\s*\d{1,4}\s*$/.test(lines[0] ?? '')) lines.shift();
    return lines.join('\n');
  });
  const full = pages.join('\n');

  // Trim to the operative text: starts after "BE it enacted", ends after the
  // last section's body, before trailing matter ("STATEMENT OF OBJECTS...").
  const enactIdx = full.indexOf('BE it enacted');
  const objectsIdx = full.indexOf('STATEMENT OF OBJECTS AND REASONS');
  const body = full.slice(
    enactIdx >= 0 ? enactIdx : 0,
    objectsIdx >= 0 ? objectsIdx : full.length,
  );

  // Section heading pattern: "<num>.<optional space><heading, 1-220 chars,
  // across lines><optional period><one or more dash glyphs>". The dash is
  // sometimes doubled in the source PDF (a rendering artifact) and sometimes
  // has no preceding period (also observed) — `[–—]+` and the optional `\.?`
  // absorb both without over-matching into running prose, because dash
  // glyphs otherwise never appear mid-sentence in this document.
  const sectionPat = /^[ \t]*(\d{1,3})\.[ \t]*(.{1,220}?)\.?[ \t]*[–—]+[ \t]*/gms;
  const matches = [...body.matchAll(sectionPat)];

  const sections: SourceSection[] = [];
  for (let i = 0; i < matches.length; i += 1) {
    const m = matches[i];
    const start = (m.index ?? 0) + m[0].length;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? body.length) : body.length;
    const sectionNo = m[1] ?? '';
    const heading = (m[2] ?? '').replace(/\s+/g, ' ').trim();
    const text = body.slice(start, end).replace(/[ \t]+\n/g, '\n').trim();
    sections.push({
      act: 'BNS',
      actTitle: 'The Bharatiya Nyaya Sanhita, 2023',
      actYear: 2023,
      section: sectionNo,
      heading,
      text,
      oldSection: null,
      oldAct: null,
      // Verbatim-extracted from the official PDF, but a human has not yet
      // diffed every section against the gazette line-by-line — per the
      // README, that human check is what flips this to true, not the parser.
      verified: false,
    });
  }
  return sections;
}

async function main(): Promise<void> {
  const { source, check, act } = parseArgs(process.argv.slice(2));
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
  if (!act) {
    console.error('No --act given. Pass --act BNS or --act BNSS.');
    process.exit(2);
  }

  if (act === 'BNSS') {
    // BNSS needs a DIFFERENT extraction strategy than BNS, not just a tweaked
    // regex — confirmed against two real sources:
    //
    //   1. NCRB mirror (ncrb.gov.in/.../BNSS2023.pdf): a side-by-side
    //      old-CrPC/new-BNSS comparison table precedes the operative text,
    //      and section headings appear as standalone paragraphs rather than
    //      inline "N. Heading.—body" — structurally unlike BNS.
    //
    //   2. The actual Gazette of India text (prsindia.org/.../acts_parliament
    //      /2023/The Bharatiya Nagarik Suraksha Sanhita, 2023.pdf — the
    //      enacted Act, not the 9-page bill draft at bills_parliament/2023/
    //      which is NOT this Act's final text): the gazette is typeset in
    //      TWO COLUMNS, main text left, short italic marginal headings
    //      ("Definitions.", "Power to alter functions allocated to Executive
    //      Magistrate in certain cases.", etc.) in the right margin next to
    //      each section. pypdf's extract_text() is column-blind — it emits
    //      the left column's full text for a page, THEN that page's margin
    //      notes as a trailing block, so a section's heading ends up
    //      decoupled from its number and only recoverable by matching
    //      margin-note order to section order across page boundaries. BNSS
    //      sections also have NO inline heading at all ("2. (1) In this
    //      Sanhita..." — straight into the body), unlike BNS.
    //
    // Reusing the BNS regex against either source would silently mis-parse
    // section boundaries rather than fail loudly — worse than refusing.
    // A correct BNSS parser needs position-aware extraction (pdfjs-dist
    // glyph coordinates, reconstructing true left-column/right-column
    // reading order) to pair each margin note with its section, which is a
    // meaningfully bigger, unvalidated piece of work than the BNS parser
    // above. Not wired yet — a real follow-up, not a stub left out of
    // laziness.
    console.error(
      'BNSS parser not yet wired. Its gazette source is two-column (marginal\n'
      + 'headings, not inline) and needs position-aware PDF extraction, not a\n'
      + 'regex tweak — see the comment above this error for the full diagnosis.\n'
      + 'Run --act BNS first; BNSS needs its own extraction strategy as a\n'
      + 'separate piece of work.',
    );
    process.exit(3);
  }

  const bytes = await loadSourceBytes(source);
  const parsed = await pdfParse(bytes);
  const sections = parseBns(parsed.text);

  if (sections.length !== 358) {
    console.error(`Expected 358 BNS sections, parsed ${sections.length}. Refusing to write a partial/over-matched file.`);
    process.exit(1);
  }

  // Merge with whatever's already in the output file (e.g. a prior BNSS run)
  // rather than clobbering it — each --act run owns only its own act's rows.
  let existing: SourceSection[] = [];
  if (existsSync(OUT_PATH)) {
    try {
      const prior = JSON.parse(readFileSync(OUT_PATH, 'utf8')) as { sections: SourceSection[] };
      existing = (prior.sections ?? []).filter((s) => s.act !== 'BNS');
    } catch { /* corrupt or absent prior file — start fresh */ }
  }
  const merged = [...existing, ...sections];
  writeFileSync(OUT_PATH, JSON.stringify({ sections: merged }, null, 2));
  console.log(`Wrote ${sections.length} BNS sections (${merged.length} total in file) -> ${OUT_PATH}`);
}

main().catch((err: unknown) => {
  console.error('fetch-bns-bnss crashed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
