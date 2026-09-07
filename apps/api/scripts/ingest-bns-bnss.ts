// =============================================================================
// BNS / BNSS corpus ingestion
//
// Loads the Bharatiya Nyaya Sanhita (BNS, 2023) and Bharatiya Nagarik Suraksha
// Sanhita (BNSS, 2023) section text into the indiacode-rag laws corpus so the
// drafting engine can ground and cite against the WHOLE code, not the ~5% the
// hand-curated KB covers today.
//
// This is the pipeline the user chose ("ingest full BNS+BNSS from official
// source"). It is intentionally runnable-later: it does nothing destructive,
// upserts idempotently, and refuses to run unless the corpus DB + embedder are
// configured. Connect LAWS_DATABASE_URL + EMBED_SERVICE_URL and run:
//
//   pnpm --filter @lexdraft/api ingest:bns-bnss                 # full file
//   pnpm --filter @lexdraft/api ingest:bns-bnss --sample        # 6-row seed
//   pnpm --filter @lexdraft/api ingest:bns-bnss --dry-run       # parse+embed, no writes
//   pnpm --filter @lexdraft/api ingest:bns-bnss --act BNSS      # one sanhita only
//
// SOURCE OF TRUTH: the section text comes from bns-bnss-sections.json, produced
// by fetch-bns-bnss.ts from the official IndiaCode source. Nothing here is
// AI-generated. Rows whose `verified` is not true are ingested but tagged so
// the drafting layer treats them as needs-review (never a hard citation) —
// mirroring the offence-kb rule that prevents hallucinated authorities.
//
// SAFETY: this writes to the shared laws corpus. It only touches the two acts
// it owns (BNS, BNSS), keyed by canonical title, and re-runs are idempotent
// (delete-then-insert per act inside a transaction). It never touches other
// acts in the corpus.
// =============================================================================

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { env } from '../src/env';
import { embeddingsService } from '../src/services/embeddings.service';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---- Source-row shape (see bns-bnss-sections.sample.json) ------------------

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

interface SourceFile {
  sections: SourceSection[];
}

// ---- CLI -------------------------------------------------------------------

interface Args {
  sample: boolean;
  dryRun: boolean;
  act: 'BNS' | 'BNSS' | null;
  file: string | null;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { sample: false, dryRun: false, act: null, file: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--sample') out.sample = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--act') {
      const v = argv[++i];
      if (v !== 'BNS' && v !== 'BNSS') { fail(`--act must be BNS or BNSS (got '${v ?? ''}')`); }
      out.act = v;
    } else if (a === '--file') out.file = argv[++i] ?? null;
    else fail(`unknown arg: ${a}`);
  }
  return out;
}

function fail(msg: string): never {
  process.stderr.write(`ingest-bns-bnss: ${msg}\n`);
  process.exit(2);
}

function printHelp(): void {
  process.stdout.write(
    `BNS/BNSS corpus ingestion\n\n`
    + `  pnpm --filter @lexdraft/api ingest:bns-bnss [options]\n\n`
    + `  --sample        Use the 6-row seed (bns-bnss-sections.sample.json)\n`
    + `  --file <path>    Explicit source JSON (default: bns-bnss-sections.json)\n`
    + `  --act <BNS|BNSS> Ingest only one sanhita\n`
    + `  --dry-run        Parse + embed + report, but write nothing\n`
    + `  -h, --help       This message\n\n`
    + `Requires LAWS_DATABASE_URL and EMBED_SERVICE_URL (unless --dry-run, which\n`
    + `still needs the embedder). Idempotent: re-running replaces each act's rows.\n`,
  );
}

// ---- Chunking --------------------------------------------------------------
//
// Sections are short enough that one chunk each is almost always right, but a
// few long BNSS procedure sections exceed the embed model's sweet spot. Split
// on sentence boundaries at ~1500 chars with 150-char overlap, matching the
// upstream corpus's chunking so retrieval behaves consistently.

const CHUNK_TARGET = 1500;
const CHUNK_OVERLAP = 150;

function chunkText(text: string): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= CHUNK_TARGET) return [clean];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + CHUNK_TARGET, clean.length);
    if (end < clean.length) {
      // Prefer to cut at the last sentence end within the window.
      const slice = clean.slice(start, end);
      const lastStop = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('; '));
      if (lastStop > CHUNK_TARGET * 0.5) end = start + lastStop + 1;
    }
    chunks.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = end - CHUNK_OVERLAP;
  }
  return chunks;
}

/** The searchable text for a chunk: prefix with a citation-shaped header so a
 *  query like "BNSS 355 exemption from appearance" retrieves it even when the
 *  body doesn't repeat the number. Mirrors how the upstream corpus builds
 *  chunk content (act + section + heading + body). */
function chunkContent(s: SourceSection, body: string, chunkIdx: number, chunkTotal: number): string {
  const part = chunkTotal > 1 ? ` (part ${chunkIdx + 1}/${chunkTotal})` : '';
  return `${s.actTitle} — Section ${s.section}. ${s.heading}${part}\n\n${body}`;
}

function citation(s: SourceSection): string {
  return `Section ${s.section}, ${s.actTitle}`;
}

// ---- Schema discovery ------------------------------------------------------
//
// We don't hard-code the corpus column set (it lives in the separate
// indiacode-rag repo and could drift). Instead we read information_schema and
// build the INSERT from the columns that actually exist. This keeps the script
// correct against the live schema and makes a schema mismatch a clear, early
// error rather than a silent bad write.

interface TableCols { table: string; cols: Set<string> }

async function discover(sql: postgres.Sql, table: string): Promise<TableCols> {
  const rows = await sql<{ column_name: string }[]>`
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = ${table}
  `;
  return { table, cols: new Set(rows.map((r) => r.column_name)) };
}

// ---- Main ------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { printHelp(); process.exit(0); }

  // Resolve source file.
  const fileName = args.file
    ?? (args.sample ? 'data/bns-bnss-sections.sample.json' : 'data/bns-bnss-sections.json');
  const filePath = resolve(__dirname, fileName);
  if (!existsSync(filePath)) {
    if (!args.sample && !args.file) {
      fail(
        `source file not found: ${filePath}\n`
        + `  Run fetch-bns-bnss.ts first to produce the full file from IndiaCode,\n`
        + `  or pass --sample to ingest the 6-row seed.`,
      );
    }
    fail(`source file not found: ${filePath}`);
  }

  const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as SourceFile;
  let rows = parsed.sections;
  if (!Array.isArray(rows) || rows.length === 0) fail('source file has no `sections` array');
  if (args.act) rows = rows.filter((r) => r.act === args.act);
  if (rows.length === 0) fail(`no rows for act ${args.act ?? ''}`);

  const unverified = rows.filter((r) => r.verified !== true).length;
  process.stdout.write(
    `Source: ${filePath}\n`
    + `Rows: ${rows.length}  (BNS: ${rows.filter((r) => r.act === 'BNS').length}, `
    + `BNSS: ${rows.filter((r) => r.act === 'BNSS').length})  `
    + `unverified→needs-review: ${unverified}\n`,
  );

  // Embedder is required even for --dry-run (we want to prove embedding works).
  if (!env.EMBED_SERVICE_URL) {
    fail('EMBED_SERVICE_URL not configured — cannot embed section text.');
  }

  // Build chunks for every row.
  interface PreparedChunk {
    row: SourceSection;
    content: string;
    idx: number;
    total: number;
  }
  const prepared: PreparedChunk[] = [];
  for (const row of rows) {
    const bodies = chunkText(row.text);
    bodies.forEach((body, i) => {
      prepared.push({ row, content: chunkContent(row, body, i, bodies.length), idx: i, total: bodies.length });
    });
  }
  process.stdout.write(`Chunks: ${prepared.length}\n`);

  // Embed in batches of 256 (the service cap).
  process.stdout.write('Embedding…\n');
  const vectors: number[][] = [];
  for (let i = 0; i < prepared.length; i += 256) {
    const batch = prepared.slice(i, i + 256);
    const { embeddings } = await embeddingsService.embed(batch.map((p) => p.content));
    vectors.push(...embeddings);
    process.stdout.write(`  embedded ${Math.min(i + 256, prepared.length)}/${prepared.length}\n`);
  }

  if (args.dryRun) {
    process.stdout.write(
      `\nDRY RUN — no writes. Would upsert ${prepared.length} chunks across `
      + `${new Set(rows.map((r) => r.actTitle)).size} act(s). First chunk preview:\n`,
    );
    process.stdout.write('  ' + prepared[0]!.content.slice(0, 200).replace(/\s+/g, ' ') + '…\n');
    return;
  }

  if (!env.LAWS_DATABASE_URL) {
    fail('LAWS_DATABASE_URL not configured — cannot write to the corpus. (Use --dry-run to test parsing/embedding.)');
  }

  const sql = postgres(env.LAWS_DATABASE_URL, {
    ssl: env.lawsDatabaseSsl ? 'require' : false,
    max: 4,
    prepare: false,
  });

  try {
    const acts = await discover(sql, 'acts');
    const chunks = await discover(sql, 'chunks');
    if (acts.cols.size === 0 || chunks.cols.size === 0) {
      fail('corpus schema not found (tables `acts` / `chunks` missing) — is LAWS_DATABASE_URL the indiacode-rag DB?');
    }
    // Minimal columns we depend on. If the live schema lacks these, stop loud.
    for (const need of ['id', 'short_title'] as const) {
      if (!acts.cols.has(need)) fail(`acts table missing required column '${need}'`);
    }
    for (const need of ['id', 'act_id', 'content'] as const) {
      if (!chunks.cols.has(need)) fail(`chunks table missing required column '${need}'`);
    }
    const hasEmbedding = chunks.cols.has('embedding');
    if (!hasEmbedding) {
      process.stderr.write('WARN: chunks has no `embedding` column — inserting content only; search will fall back to FTS.\n');
    }

    const byAct = new Map<string, PreparedChunk[]>();
    prepared.forEach((p) => {
      const list = byAct.get(p.row.actTitle) ?? [];
      list.push(p);
      byAct.set(p.row.actTitle, list);
    });

    let totalWritten = 0;
    for (const [actTitle, actChunks] of byAct) {
      await sql.begin(async (tx) => {
        // Upsert the act row, get its id.
        const actRows = await tx<{ id: string }[]>`
          insert into acts (short_title) values (${actTitle})
          on conflict (short_title) do update set short_title = excluded.short_title
          returning id
        `;
        const actId = actRows[0]!.id;

        // Idempotency: clear this act's existing chunks before re-inserting, so
        // a re-run replaces rather than duplicates. Scoped strictly to this act.
        await tx`delete from chunks where act_id = ${actId}`;

        for (const p of actChunks) {
          const globalIdx = prepared.indexOf(p);
          const vec = vectors[globalIdx]!;
          const vecLiteral = `[${vec.join(',')}]`;
          const cite = citation(p.row);
          const needsReview = p.row.verified !== true;

          // Build the insert from columns that actually exist. content + act_id
          // are guaranteed; the rest are set when the corpus has them.
          const record: Record<string, unknown> = {
            act_id: actId,
            content: p.content,
          };
          if (chunks.cols.has('citation')) record.citation = cite;
          if (chunks.cols.has('section_number')) record.section_number = p.row.section;
          if (chunks.cols.has('section_heading')) record.section_heading = p.row.heading;
          if (chunks.cols.has('source_url')) record.source_url = 'https://www.indiacode.nic.in/';
          if (chunks.cols.has('needs_review')) record.needs_review = needsReview;

          if (hasEmbedding) {
            await tx`
              insert into chunks ${tx(record)}, embedding
              values (default)
            `.catch(async () => {
              // Fallback for schemas where embedding must be set inline with a
              // cast: do a two-step insert instead.
              const inserted = await tx<{ id: string }[]>`insert into chunks ${tx(record)} returning id`;
              await tx`update chunks set embedding = ${vecLiteral}::vector(1024) where id = ${inserted[0]!.id}`;
            });
          } else {
            await tx`insert into chunks ${tx(record)}`;
          }
          totalWritten += 1;
        }
        process.stdout.write(`  ${actTitle}: wrote ${actChunks.length} chunks (act_id ${actId})\n`);
      });
    }

    process.stdout.write(`\nDone. Upserted ${totalWritten} chunks across ${byAct.size} act(s).\n`);
    process.stdout.write(
      `Reminder: rows flagged needs-review are NOT citable until counsel verifies them\n`
      + `against the official gazette. Run the citation eval (eval:cite) to confirm the\n`
      + `drafting engine now grounds BNS/BNSS sections.\n`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`ingest-bns-bnss crashed:\n${msg}\n`);
  process.exit(1);
});
