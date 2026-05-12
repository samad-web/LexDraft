/**
 * clausesService — real-Postgres integration coverage.
 *
 * Mirrors cases.integration.test.ts: two firms, full CRUD coverage, and a
 * focused test for the `importMany` path (which has dedupe logic the unit
 * suite never exercises against the real `where ... lower(title) = lower(...)`).
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { clausesService } from '../clauses.service';
import { seedFirm, type SeededFirm } from '../../__tests__/integration-fixtures';

let firmA: SeededFirm;
let firmB: SeededFirm;

beforeAll(async () => {
  firmA = await seedFirm('Clauses Firm A');
  firmB = await seedFirm('Clauses Firm B');
});

describe('clausesService — CRUD', () => {
  it('list returns [] for null firmId', async () => {
    expect(await clausesService.list({ firmId: null })).toEqual([]);
  });

  it('create + list round-trips a clause for the right firm', async () => {
    const created = await clausesService.create({
      category: 'Indemnity',
      title: 'Mutual Indemnity (Integration)',
      description: 'Reciprocal indemnification',
      body: 'Each Party shall indemnify...',
    }, firmA.id);

    expect(created.id).toBeTruthy();
    expect(created.uses).toBe(0);

    const listA = await clausesService.list({ firmId: firmA.id });
    expect(listA.some((c) => c.id === created.id)).toBe(true);
    // firm B never sees firm A's clause
    const listB = await clausesService.list({ firmId: firmB.id });
    expect(listB.some((c) => c.id === created.id)).toBe(false);
  });

  it('list filters by category and free-text q', async () => {
    await clausesService.create({
      category: 'Termination', title: 'Insolvency clause',
      description: 'Termination on insolvency', body: 'Upon CIRP...',
    }, firmA.id);
    await clausesService.create({
      category: 'Limitation of Liability', title: 'Cap at fees',
      description: 'cap', body: '...',
    }, firmA.id);

    const onlyTermination = await clausesService.list({ firmId: firmA.id, category: 'Termination' });
    expect(onlyTermination.every((c) => c.category === 'Termination')).toBe(true);

    const matchInsol = await clausesService.list({ firmId: firmA.id, q: 'insolvency' });
    expect(matchInsol.some((c) => c.title === 'Insolvency clause')).toBe(true);
  });

  it('update applies patch + bumps updated_at', async () => {
    const created = await clausesService.create({
      category: 'Force Majeure', title: 'Original Title',
      description: 'original', body: 'body',
    }, firmA.id);

    const patched = await clausesService.update(created.id, { title: 'New Title' }, firmA.id);
    expect(patched?.title).toBe('New Title');
    expect(patched?.category).toBe('Force Majeure'); // unchanged
    // Cross-tenant update returns null and leaves the row alone.
    const wrongFirm = await clausesService.update(created.id, { title: 'Hijacked' }, firmB.id);
    expect(wrongFirm).toBeNull();
  });

  it('incrementUses increments the counter', async () => {
    const created = await clausesService.create({
      category: 'Misc', title: 'Use Counter', description: '', body: '',
    }, firmA.id);
    await clausesService.incrementUses(created.id, firmA.id);
    await clausesService.incrementUses(created.id, firmA.id);

    const list = await clausesService.list({ firmId: firmA.id });
    const refreshed = list.find((c) => c.id === created.id);
    expect(refreshed?.uses).toBe(2);
  });

  it('remove only deletes the firm-owned row', async () => {
    const created = await clausesService.create({
      category: 'Misc', title: 'Doomed', description: '', body: '',
    }, firmA.id);

    expect(await clausesService.remove(created.id, firmB.id)).toBe(false);
    expect(await clausesService.remove(created.id, firmA.id)).toBe(true);
  });
});

describe('clausesService — importMany dedupe', () => {
  it('skips duplicates by (category, lower(title)) within the same firm', async () => {
    const firstBatch = await clausesService.importMany([
      { category: 'Bulk', title: 'Confidentiality', description: '', body: 'orig' },
      { category: 'Bulk', title: 'IP Assignment',  description: '', body: 'orig' },
    ], firmA.id);
    expect(firstBatch.inserted).toBe(2);
    expect(firstBatch.skipped).toBe(0);

    // Re-import with mixed-case title — should ALL be skipped (case-insensitive).
    const secondBatch = await clausesService.importMany([
      { category: 'Bulk', title: 'confidentiality', description: '', body: 'dup' },
      { category: 'Bulk', title: 'IP Assignment',   description: '', body: 'dup' },
      { category: 'Bulk', title: 'New Entry',       description: '', body: 'new' },
    ], firmA.id);
    expect(secondBatch.inserted).toBe(1);
    expect(secondBatch.skipped).toBe(2);
  });

  it('drops malformed entries (missing category or title)', async () => {
    const out = await clausesService.importMany([
      { category: 'Valid', title: 'Valid Title', description: '', body: '' },
      { category: '',      title: 'Missing Cat', description: '', body: '' },
      { category: 'OK',    title: '',            description: '', body: '' },
    ], firmA.id);
    expect(out.inserted).toBe(1);
    expect(out.skipped).toBe(2);
  });

  it('a different firm can import the same titles without collision', async () => {
    const out = await clausesService.importMany([
      { category: 'Bulk', title: 'Confidentiality', description: '', body: 'firm B' },
    ], firmB.id);
    expect(out.inserted).toBe(1);
    expect(out.skipped).toBe(0);
  });

  it('throws 422 without a firmId', async () => {
    await expect(
      clausesService.importMany([
        { category: 'X', title: 'Y', description: '', body: '' },
      ], null),
    ).rejects.toMatchObject({ status: 422 });
  });
});
