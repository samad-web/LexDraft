/**
 * dpdpService — DPDP Act 2023 endpoints against real Postgres.
 *
 * Coverage:
 *   - exportUser dumps the headline tables and stamps `data_export_log`
 *     + audit_log entries.
 *   - requestDeletion flips `users.deleted_at` AND every draft the user
 *     authored (firm-shared tables are intentionally untouched).
 *   - cancelDeletion reverses both flags.
 *   - purgeDueDeletions only hard-deletes rows whose `scheduled_purge_at`
 *     has elapsed — future deadlines are spared.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { dpdpService } from '../dpdp.service';
import { getIntegrationSql } from '../../__tests__/integration-db';
import {
  seedFirm,
  seedUser,
  type SeededFirm,
  type SeededUser,
} from '../../__tests__/integration-fixtures';

let firm: SeededFirm;
let user: SeededUser;
let otherUser: SeededUser;

async function seedDraftForUser(firmId: string, userId: string, title: string): Promise<string> {
  const sql = getIntegrationSql();
  const rows = await sql<Array<{ id: string }>>`
    insert into drafts (firm_id, user_id, title, doc_type)
    values (${firmId}::uuid, ${userId}::uuid, ${title}, 'plaint')
    returning id
  `;
  return rows[0]!.id;
}

beforeAll(async () => {
  firm = await seedFirm('DPDP Firm');
  user = await seedUser(firm.id, { email: 'dpdp-target@integration.test' });
  otherUser = await seedUser(firm.id, { email: 'dpdp-other@integration.test' });

  // Two drafts for the target, one for the other user (must NOT be touched).
  await seedDraftForUser(firm.id, user.id, 'Target Draft 1');
  await seedDraftForUser(firm.id, user.id, 'Target Draft 2');
  await seedDraftForUser(firm.id, otherUser.id, 'Other User Draft');
});

describe('dpdpService.exportUser', () => {
  it('returns the user, drafts, and a fresh data_export_log row', async () => {
    const sql = getIntegrationSql();
    const beforeCount = await sql<Array<{ c: number }>>`
      select count(*)::int as c from data_export_log where user_id = ${user.id}::uuid
    `;

    const out = await dpdpService.exportUser(user.id, { ip: '127.0.0.1', userAgent: 'integration-test' });
    expect(out.user.id).toBe(user.id);
    expect(out.user.email).toBe(user.email);
    expect(out.drafts.length).toBeGreaterThanOrEqual(2);

    const afterCount = await sql<Array<{ c: number }>>`
      select count(*)::int as c from data_export_log where user_id = ${user.id}::uuid
    `;
    expect(afterCount[0]!.c).toBe(beforeCount[0]!.c + 1);
  });

  it('throws NotFoundError when the user does not exist', async () => {
    await expect(
      dpdpService.exportUser('00000000-0000-0000-0000-000000000999'),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('dpdpService.requestDeletion → cancelDeletion', () => {
  it('soft-deletes the user and their drafts, then cancellation reverses it', async () => {
    const sql = getIntegrationSql();

    // Fresh fixture so other tests don't see this deletion.
    const target = await seedUser(firm.id, { email: 'dpdp-delete-cycle@integration.test' });
    await seedDraftForUser(firm.id, target.id, 'Cycle Draft 1');
    await seedDraftForUser(firm.id, target.id, 'Cycle Draft 2');
    const ownDrafts = await sql<Array<{ deleted_at: Date | null }>>`
      select deleted_at from drafts where user_id = ${target.id}::uuid
    `;
    expect(ownDrafts.every((d) => d.deleted_at === null)).toBe(true);

    const req = await dpdpService.requestDeletion(
      target.id,
      { retentionDays: 7 },
      { id: target.id, email: target.email },
    );
    expect(req.retentionDays).toBe(7);
    expect(req.scheduledPurgeAt).toBeTruthy();

    const userRow = await sql<Array<{ deleted_at: Date | null; status: string }>>`
      select deleted_at, status from users where id = ${target.id}::uuid
    `;
    expect(userRow[0]!.deleted_at).not.toBeNull();
    expect(userRow[0]!.status).toBe('deactivated');

    const draftsAfter = await sql<Array<{ deleted_at: Date | null }>>`
      select deleted_at from drafts where user_id = ${target.id}::uuid
    `;
    expect(draftsAfter.length).toBe(2);
    expect(draftsAfter.every((d) => d.deleted_at !== null)).toBe(true);

    // Firm-shared rows must NOT be flagged just because a user requested deletion.
    // We assert this by checking the OTHER user's draft is still alive.
    const otherDrafts = await sql<Array<{ deleted_at: Date | null }>>`
      select deleted_at from drafts where user_id = ${otherUser.id}::uuid
    `;
    expect(otherDrafts.every((d) => d.deleted_at === null)).toBe(true);

    await dpdpService.cancelDeletion(target.id, { id: target.id, email: target.email });

    const userRowAfter = await sql<Array<{ deleted_at: Date | null; status: string }>>`
      select deleted_at, status from users where id = ${target.id}::uuid
    `;
    expect(userRowAfter[0]!.deleted_at).toBeNull();
    expect(userRowAfter[0]!.status).toBe('active');

    const draftsRestored = await sql<Array<{ deleted_at: Date | null }>>`
      select deleted_at from drafts where user_id = ${target.id}::uuid
    `;
    expect(draftsRestored.every((d) => d.deleted_at === null)).toBe(true);
  });

  it('cancelDeletion 404s when no deletion is pending', async () => {
    const target = await seedUser(firm.id, { email: 'dpdp-no-pending@integration.test' });
    await expect(
      dpdpService.cancelDeletion(target.id, { id: target.id, email: target.email }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('dpdpService.purgeDueDeletions', () => {
  it('only purges rows whose scheduled_purge_at is in the past', async () => {
    const sql = getIntegrationSql();

    // User whose purge is overdue.
    const due = await seedUser(firm.id, { email: 'dpdp-overdue@integration.test' });
    const dueDraftId = await seedDraftForUser(firm.id, due.id, 'Overdue Draft');
    await sql`
      update users
      set deleted_at = now() - interval '10 days',
          scheduled_purge_at = now() - interval '1 day',
          status = 'deactivated'
      where id = ${due.id}::uuid
    `;
    await sql`
      update drafts
      set deleted_at = now() - interval '10 days',
          scheduled_purge_at = now() - interval '1 day'
      where id = ${dueDraftId}::uuid
    `;

    // User whose purge is still in the future.
    const future = await seedUser(firm.id, { email: 'dpdp-future@integration.test' });
    const futureDraftId = await seedDraftForUser(firm.id, future.id, 'Future Draft');
    await sql`
      update users
      set deleted_at = now() - interval '1 day',
          scheduled_purge_at = now() + interval '20 days',
          status = 'deactivated'
      where id = ${future.id}::uuid
    `;
    await sql`
      update drafts
      set deleted_at = now() - interval '1 day',
          scheduled_purge_at = now() + interval '20 days'
      where id = ${futureDraftId}::uuid
    `;

    const result = await dpdpService.purgeDueDeletions();
    expect(result.purged).toBeGreaterThanOrEqual(2); // overdue user + overdue draft

    // Overdue rows are gone.
    const overdueUser = await sql<Array<{ id: string }>>`
      select id from users where id = ${due.id}::uuid
    `;
    expect(overdueUser.length).toBe(0);
    const overdueDraft = await sql<Array<{ id: string }>>`
      select id from drafts where id = ${dueDraftId}::uuid
    `;
    expect(overdueDraft.length).toBe(0);

    // Future rows still here.
    const futureUserRow = await sql<Array<{ id: string }>>`
      select id from users where id = ${future.id}::uuid
    `;
    expect(futureUserRow.length).toBe(1);
    const futureDraftRow = await sql<Array<{ id: string }>>`
      select id from drafts where id = ${futureDraftId}::uuid
    `;
    expect(futureDraftRow.length).toBe(1);
  });
});
