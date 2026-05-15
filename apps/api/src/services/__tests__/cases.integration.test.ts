/**
 * cases.service - real-Postgres integration coverage.
 *
 * Exercises the SQL paths (skipped in the unit suite because DATABASE_URL is
 * blank there). Two firms are seeded to prove `firmId` scoping actually
 * isolates reads: a list/get/update/delete from firm A must never see firm
 * B's data.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { casesService } from '../cases.service';
import { seedFirm, type SeededFirm } from '../../__tests__/integration-fixtures';

let firmA: SeededFirm;
let firmB: SeededFirm;

beforeAll(async () => {
  firmA = await seedFirm('Cases Firm A');
  firmB = await seedFirm('Cases Firm B');
});

describe('casesService - real Postgres', () => {
  it('list returns [] for null firmId (cross-tenant safety)', async () => {
    const items = await casesService.list({ firmId: null });
    expect(items).toEqual([]);
  });

  it('create + get round-trips a case for firmA', async () => {
    const created = await casesService.create({
      cnr: 'CNR/A/0001',
      title: 'Acme v. Beta',
      court: 'Delhi HC',
      stage: 'Pleadings',
      client: 'Acme Pvt Ltd',
      status: 'Active',
      next: '2026-07-01',
      type: 'civil',
      visibleToClient: false,
    }, firmA.id);

    expect(created.id).toBeTruthy();
    expect(created.cnr).toBe('CNR/A/0001');

    const fetched = await casesService.get(created.id, firmA.id);
    expect(fetched?.title).toBe('Acme v. Beta');
    expect(fetched?.next).toBe('2026-07-01');
  });

  it('get returns undefined when firmId belongs to another tenant', async () => {
    const created = await casesService.create({
      cnr: 'CNR/A/0002',
      title: 'Cross-Tenant Probe',
      court: 'BHC',
      stage: 'Trial',
      client: 'Probe',
      status: 'Active',
      next: '2026-08-01',
      type: 'civil',
      visibleToClient: false,
    }, firmA.id);

    // firmB asking for firmA's row → should be invisible.
    const leak = await casesService.get(created.id, firmB.id);
    expect(leak).toBeUndefined();
  });

  it('list with filter.type=civil only returns matching rows for that firm', async () => {
    await casesService.create({
      cnr: 'CNR/A/CIV-1', title: 'Civil 1', court: 'BHC', stage: 'P', client: 'X',
      status: 'Active', next: '2026-09-01', type: 'civil', visibleToClient: false,
    }, firmA.id);
    await casesService.create({
      cnr: 'CNR/A/CRIM-1', title: 'Crim 1', court: 'Sessions', stage: 'P', client: 'Y',
      status: 'Active', next: '2026-09-15', type: 'criminal', visibleToClient: false,
    }, firmA.id);
    await casesService.create({
      cnr: 'CNR/B/CIV-1', title: 'Firm B Civil', court: 'MAS HC', stage: 'P', client: 'Z',
      status: 'Active', next: '2026-09-20', type: 'civil', visibleToClient: false,
    }, firmB.id);

    const civilForA = await casesService.list({ firmId: firmA.id, type: 'civil' });
    const cnrs = civilForA.map((c) => c.cnr);
    // Must include A's civil case but never B's civil case.
    expect(cnrs).toContain('CNR/A/CIV-1');
    expect(cnrs).not.toContain('CNR/A/CRIM-1');
    expect(cnrs).not.toContain('CNR/B/CIV-1');
  });

  it('list q filter matches title or cnr substrings', async () => {
    const results = await casesService.list({ firmId: firmA.id, q: 'Acme' });
    // Created above with title 'Acme v. Beta'
    expect(results.some((c) => c.title === 'Acme v. Beta')).toBe(true);
  });

  it('update only mutates the row when the firmId matches', async () => {
    const created = await casesService.create({
      cnr: 'CNR/A/UPD-1', title: 'Pre-update', court: 'BHC', stage: 'P', client: 'C',
      status: 'Active', next: '2026-10-01', type: 'civil', visibleToClient: false,
    }, firmA.id);

    // Wrong firm - silently returns undefined, row untouched.
    const wrongFirm = await casesService.update(created.id, { title: 'Hijacked' }, firmB.id);
    expect(wrongFirm).toBeUndefined();
    const stillPristine = await casesService.get(created.id, firmA.id);
    expect(stillPristine?.title).toBe('Pre-update');

    // Right firm - patch applies.
    const ok = await casesService.update(created.id, { title: 'Post-update', stage: 'Hearing' }, firmA.id);
    expect(ok?.title).toBe('Post-update');
    expect(ok?.stage).toBe('Hearing');
  });

  it('remove deletes the row only for the owning firm', async () => {
    const created = await casesService.create({
      cnr: 'CNR/A/DEL-1', title: 'To Delete', court: 'BHC', stage: 'P', client: 'D',
      status: 'Active', next: '2026-11-01', type: 'civil', visibleToClient: false,
    }, firmA.id);

    const wrongFirmDelete = await casesService.remove(created.id, firmB.id);
    expect(wrongFirmDelete).toBe(false);

    const ok = await casesService.remove(created.id, firmA.id);
    expect(ok).toBe(true);

    const gone = await casesService.get(created.id, firmA.id);
    expect(gone).toBeUndefined();
  });

  it('create without a firmId throws 422', async () => {
    await expect(
      casesService.create({
        cnr: 'CNR/NF', title: 'No Firm', court: 'BHC', stage: 'P', client: 'NF',
        status: 'Active', next: '2026-12-01', type: 'civil', visibleToClient: false,
      }, null),
    ).rejects.toMatchObject({ status: 422 });
  });
});

afterAll(async () => {
  // Schema is dropped by teardownIntegrationDb - nothing local to clean.
});
