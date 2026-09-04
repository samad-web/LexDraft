// =============================================================================
// backfill-s138-cheques — saved-draft safety for the s.138 form migration
// (flat single/indexed-cheque form -> engine `cheques[]` array).
//
// s.138 is the ONE doc type with real drafts in production, so this is the highest-risk
// migration in the whole form-generation effort. It is deliberately:
//   * ADDITIVE — it writes a `cheques` array INTO fields_json alongside the existing
//     flat keys (cheque_no, drawee_bank, sender_name, …). Nothing is deleted, so an
//     advocate opening an old draft loses no data whichever form renders it, and a
//     rollback is a no-op.
//   * EXACT — it builds the array with buildChequesFromFlatForm, the SAME function the
//     bespoke mapper uses, so the migrated array is byte-for-byte what the engine
//     already received from these drafts. The migration cannot diverge from the mapper.
//   * IDEMPOTENT — a draft that already has a `cheques` array is skipped, so re-running
//     is safe.
//
// The old flat form keeps working via the mapper's shape-detection either way; this
// backfill is what lets the NEW generated form (which reads `cheques[]`) show the
// advocate their existing cheque data instead of a blank repeatable group.
//
//   run:  npx tsx apps/api/src/scripts/backfill-s138-cheques.ts        # apply
//         npx tsx apps/api/src/scripts/backfill-s138-cheques.ts --dry  # preview only
// =============================================================================
import 'dotenv/config';
import { db } from '../db/client';
import { buildChequesFromFlatForm } from '../lib/engine-field-map';

const DRY = process.argv.includes('--dry');
// The web label the s.138 picker used (drafts.doc_type stores the label).
const S138_LABEL = 'Notice u/s 138 NI Act';

async function main() {
  const sql = db();
  if (!sql) {
    console.log('No DB configured.');
    return;
  }

  const rows = await sql<{ id: string; fields_json: Record<string, unknown> }[]>`
    select id, fields_json
    from drafts
    where doc_type = ${S138_LABEL}
  `;

  let migrated = 0;
  let skipped = 0;
  let empty = 0;

  for (const r of rows) {
    const fields = (r.fields_json ?? {}) as Record<string, unknown>;

    // Idempotent: already has a cheques array -> leave it.
    if (Array.isArray(fields.cheques)) {
      skipped += 1;
      continue;
    }

    const cheques = buildChequesFromFlatForm(fields);
    // Only write when the flat form actually carried cheque data — a wholly-empty draft
    // gets no synthetic cheque (buildChequesFromFlatForm returns a single empty object
    // in that case; detect and skip it so we don't add a blank row).
    const hasData = cheques.some(
      (c) => c.number || c.date || c.amount !== undefined || c.bank,
    );
    if (!hasData) {
      empty += 1;
      continue;
    }

    if (DRY) {
      console.log(`[dry] ${r.id}: would add ${cheques.length} cheque(s)`);
    } else {
      const updated = { ...fields, cheques };
      await sql`update drafts set fields_json = ${sql.json(updated as unknown as Record<string, never>)} where id = ${r.id}`;
    }
    migrated += 1;
  }

  console.log(
    `${DRY ? '[dry] ' : ''}s.138 cheque backfill: ${migrated} migrated, ` +
      `${skipped} already had cheques[], ${empty} empty (skipped). ` +
      `Total s.138 drafts: ${rows.length}.`,
  );
  await sql.end();
}

main().catch((err) => {
  console.error('backfill-s138-cheques failed:', err);
  process.exit(1);
});
