// =============================================================================
// backfill-clients — one-time: create a clients-register row for every distinct
// client name that exists on a real matter but has no clients row yet.
//
// Cases store `client` as free text; the Clients directory only lists rows in
// the `clients` table. Historically nothing populated the register from case
// creation, so matters whose client was typed at case-create time never showed
// up in Clients. This backfills them; going forward cases.create/update call
// clientsService.ensureByName so new cases self-register.
//
//   run:  npx tsx apps/api/src/scripts/backfill-clients.ts
// =============================================================================
import 'dotenv/config';
import { db } from '../db/client';

async function main() {
  const sql = db();
  if (!sql) {
    console.log('No DB configured.');
    return;
  }

  // Distinct (firm_id, client) pairs from real matters, excluding blanks and the
  // em-dash placeholder, that have no case-insensitive match in `clients`.
  const missing = await sql<{ firm_id: string; client: string }[]>`
    select distinct c.firm_id, c.client
    from cases c
    where c.kind = 'matter'
      and c.firm_id is not null
      and coalesce(trim(c.client), '') not in ('', '—', '-')
      and not exists (
        select 1 from clients cl
        where cl.firm_id = c.firm_id
          and lower(cl.name) = lower(trim(c.client))
      )
  `;

  if (missing.length === 0) {
    console.log('Nothing to backfill — every matter client is already in the register.');
    await sql.end();
    return;
  }

  console.log(`Backfilling ${missing.length} client(s):`);
  for (const m of missing) {
    const name = m.client.trim();
    await sql`
      insert into clients (firm_id, name, type, status)
      values (${m.firm_id}::uuid, ${name}, 'Individual', 'active')
    `;
    console.log(`  + ${name}  (firm ${m.firm_id})`);
  }
  console.log('Done.');
  await sql.end();
}

main().catch((e) => {
  console.error('backfill-clients failed:', e);
  process.exit(1);
});
