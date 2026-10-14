// =============================================================================
// encrypt-existing-fields — one-time: encrypt plaintext rows written before
// field-level encryption was wired into clients.service.ts / esign.service.ts.
//
// Columns: clients.email (+ email_lookup_hash for the login blind index),
// esign_signers.name / email / signed_ip. See src/lib/field-crypto.ts for the
// storage format and src/env.ts for FIELD_ENCRYPTION_KEY.
//
// Safe to run multiple times and safe to run AFTER the new app code is
// deployed: every value already encrypted (prefixed "v1:") is skipped, so a
// half-finished or re-run pass never double-encrypts a row. This is also why
// there's no hard cutover window - deploy the app code first (it encrypts
// every new write and transparently passes through old plaintext reads via
// decryptField's legacy branch), then run this to converge existing rows.
//
//   run:  npx tsx apps/api/src/scripts/encrypt-existing-fields.ts
// =============================================================================
import 'dotenv/config';
import { db } from '../db/client';
import { encryptField, hmacEmailLookup } from '../lib/field-crypto';

const ENC_PREFIX = 'v1:';

async function backfillClientsEmail(sql: ReturnType<typeof db>): Promise<void> {
  if (!sql) return;
  const rows = await sql<{ id: string; email: string }[]>`
    select id, email from clients
    where email is not null and email not like ${ENC_PREFIX + '%'}
  `;
  if (rows.length === 0) {
    console.log('clients.email: nothing to backfill.');
    return;
  }
  console.log(`clients.email: encrypting ${rows.length} row(s)...`);
  for (const r of rows) {
    const normalised = r.email.toLowerCase().trim();
    await sql`
      update clients
      set email = ${encryptField(normalised)}, email_lookup_hash = ${hmacEmailLookup(normalised)}
      where id = ${r.id}::uuid
    `;
  }
  console.log('clients.email: done.');
}

async function backfillEsignSigners(sql: ReturnType<typeof db>): Promise<void> {
  if (!sql) return;
  const rows = await sql<{ id: string; name: string; email: string; signed_ip: string | null }[]>`
    select id, name, email, signed_ip from esign_signers
    where name not like ${ENC_PREFIX + '%'}
       or email not like ${ENC_PREFIX + '%'}
       or (signed_ip is not null and signed_ip not like ${ENC_PREFIX + '%'})
  `;
  if (rows.length === 0) {
    console.log('esign_signers: nothing to backfill.');
    return;
  }
  console.log(`esign_signers: encrypting ${rows.length} row(s)...`);
  for (const r of rows) {
    const name = r.name.startsWith(ENC_PREFIX) ? r.name : encryptField(r.name);
    const email = r.email.startsWith(ENC_PREFIX) ? r.email : encryptField(r.email);
    const signedIp = r.signed_ip === null
      ? null
      : r.signed_ip.startsWith(ENC_PREFIX) ? r.signed_ip : encryptField(r.signed_ip);
    await sql`
      update esign_signers set name = ${name}, email = ${email}, signed_ip = ${signedIp}
      where id = ${r.id}::uuid
    `;
  }
  console.log('esign_signers: done.');
}

async function main() {
  const sql = db();
  if (!sql) {
    console.log('No DB configured.');
    return;
  }
  await backfillClientsEmail(sql);
  await backfillEsignSigners(sql);
  await sql.end();
}

main().catch((e) => {
  console.error('encrypt-existing-fields failed:', e);
  process.exit(1);
});
