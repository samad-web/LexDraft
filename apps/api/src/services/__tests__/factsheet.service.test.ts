import { beforeEach, describe, expect, it } from 'vitest';
import { factSheetService } from '../factsheet.service';

// These run against the in-memory fallback (no DATABASE_URL), which enforces the
// SAME immutability + monotonicity contract as the table. The properties tested
// here are exactly what the engine's sign-off staleness check depends on.

const CTX = { firmId: 'firm-1', userId: 'user-1' };

describe('factsheet.service — versioned, immutable', () => {
  beforeEach(() => factSheetService._resetMemory());

  it('create() starts a new matter at version 1', async () => {
    const s = await factSheetService.create({ client: 'Lakshmi' }, CTX);
    expect(s.version).toBe(1);
    expect(s.matterId).toMatch(/[0-9a-f-]{36}/);
  });

  it('revise() increments the version by exactly 1 (monotonic)', async () => {
    const v1 = await factSheetService.create({ n: 1 }, CTX);
    const v2 = await factSheetService.revise(v1.matterId, { n: 2 }, CTX);
    const v3 = await factSheetService.revise(v1.matterId, { n: 3 }, CTX);
    expect([v1.version, v2.version, v3.version]).toEqual([1, 2, 3]);
    // same matter identity throughout
    expect(v2.matterId).toBe(v1.matterId);
    expect(v3.matterId).toBe(v1.matterId);
  });

  it('revise() NEVER mutates a prior version (immutable revisions)', async () => {
    const v1 = await factSheetService.create({ amount: 100 }, CTX);
    await factSheetService.revise(v1.matterId, { amount: 200 }, CTX);
    // The stored v1 still reads the original facts.
    const readV1 = await factSheetService.getVersion(v1.matterId, 1);
    expect(readV1?.facts).toEqual({ amount: 100 });
    // And the object returned by create() is unchanged (no in-place mutation).
    expect(v1.facts).toEqual({ amount: 100 });
  });

  it('getCurrent() returns the highest version = "the facts now"', async () => {
    const v1 = await factSheetService.create({ n: 1 }, CTX);
    await factSheetService.revise(v1.matterId, { n: 2 }, CTX);
    await factSheetService.revise(v1.matterId, { n: 3 }, CTX);
    const current = await factSheetService.getCurrent(v1.matterId);
    expect(current?.version).toBe(3);
    expect(current?.facts).toEqual({ n: 3 });
  });

  it('history() returns every version oldest-first', async () => {
    const v1 = await factSheetService.create({ n: 1 }, CTX);
    await factSheetService.revise(v1.matterId, { n: 2 }, CTX);
    const hist = await factSheetService.history(v1.matterId);
    expect(hist.map((h) => h.version)).toEqual([1, 2]);
    expect(hist.map((h) => h.facts)).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it('the current version is what a draft/sign-off call must send (staleness setup)', async () => {
    // Sign-off would record (matterId, version=1). After a revise, the current
    // version is 2, so the engine sees version 2 != signed version 1 and restores
    // the banner. This test pins the Node half: getCurrent moves to 2.
    const v1 = await factSheetService.create({ facts: 'as filed' }, CTX);
    const signedVersion = (await factSheetService.getCurrent(v1.matterId))!.version;
    expect(signedVersion).toBe(1);

    await factSheetService.revise(v1.matterId, { facts: 'amended' }, CTX);
    const nowVersion = (await factSheetService.getCurrent(v1.matterId))!.version;
    expect(nowVersion).toBe(2);
    expect(nowVersion).not.toBe(signedVersion); // engine will treat sign-off as stale
  });

  it('revise() on an unknown matter throws (no silent version 1)', async () => {
    await expect(
      factSheetService.revise('00000000-0000-0000-0000-000000000000', {}, CTX),
    ).rejects.toThrow();
  });
});
