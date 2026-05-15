/**
 * Tenant-isolation regression tests.
 *
 * These tests lock in the spec §10 contract: every domain service must scope
 * reads/writes by firm_id. A caller in firm A must never observe firm B's
 * rows - and an attacker who guesses a row id from firm A must not be able
 * to read it as a user attached to firm B.
 *
 * Test mode: in-memory fallback (DATABASE_URL=''). The setup.ts file leaves
 * DATABASE_URL blank, so `db()` returns null in every service. We exercise
 * the two halves of the contract that ARE testable in this mode:
 *
 *   1. The firmId-null guard. Every list returns [] when firmId is null, and
 *      every create throws 422. This is the safety net that prevents callers
 *      with no firm attachment from ever bypassing the WHERE clause.
 *
 *   2. Per-firm bucketing where the service implements it (clausesService is
 *      the only service that keeps a per-firm in-memory map; the rest either
 *      return [] in memory mode or share a single demo seed array). For the
 *      bucketed service we prove full cross-firm isolation end-to-end.
 *
 * For services whose in-memory fallback shares a single demo array
 * (casesService, hearingsService, documentsService, tasksService), the SQL
 * path IS firm-scoped (see the `where firm_id = ${filter.firmId}::uuid`
 * clauses) and is what runs in production. We can't exercise the SQL CTE
 * without a live Postgres, but we DO exercise the null-firm guard on those
 * services - that guard is what catches a user with no firm attachment
 * from accidentally hitting the table.
 */

import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

import { archiveService } from '../archive.service';
import { casesService } from '../cases.service';
import { clausesService } from '../clauses.service';
import { clientsService } from '../clients.service';
import { diaryService } from '../diary.service';
import { documentsService } from '../documents.service';
import { expensesService } from '../expenses.service';
import { hearingsService } from '../hearings.service';
import { invoicesService } from '../invoices.service';
import { leadsService } from '../leads.service';
import { limitationsService } from '../limitations.service';
import { tasksService } from '../tasks.service';

function uuid(): string {
  return randomUUID();
}

// =============================================================================
// casesService
// =============================================================================

describe('tenant isolation - casesService', () => {
  it('list returns [] when firmId is null', async () => {
    const items = await casesService.list({ firmId: null });
    expect(items).toEqual([]);
  });

  it('get returns undefined when firmId is null even for a known row id', async () => {
    const got = await casesService.get('c1', null);
    expect(got).toBeUndefined();
  });

  it('create throws 422 when firmId is null', async () => {
    await expect(
      casesService.create(
        {
          cnr: 'CNR-X',
          title: 'X v Y',
          court: 'HC',
          stage: 'pleadings',
          client: 'C',
          status: 'Active',
          next: '',
          type: 'Civil',
          visibleToClient: false,
        },
        null,
      ),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('update/remove no-op when firmId is null', async () => {
    expect(await casesService.update('c1', { title: 'X' }, null)).toBeUndefined();
    expect(await casesService.remove('c1', null)).toBe(false);
  });
});

// =============================================================================
// hearingsService (joins via cases.firm_id)
// =============================================================================

describe('tenant isolation - hearingsService', () => {
  it('listToday returns [] when firmId is null', async () => {
    expect(await hearingsService.listToday(null)).toEqual([]);
  });

  it('listUpcoming returns [] when firmId is null', async () => {
    expect(await hearingsService.listUpcoming(null)).toEqual([]);
  });

  it('week returns an empty hearings array when firmId is null', async () => {
    const w = await hearingsService.week(null, '2026-05-04');
    expect(w.hearings).toEqual([]);
    // Day buckets are still rendered (UI shell) but no hearings leak through.
    expect(w.days.every((d) => d.count === 0)).toBe(true);
  });

  it('listForDay returns [] when firmId is null', async () => {
    expect(await hearingsService.listForDay(null, '2026-05-08')).toEqual([]);
  });

  it('create throws 422 when firmId is null', async () => {
    await expect(
      hearingsService.create(
        { case: 'X v Y', time: '10:00', court: 'HC', purpose: 'arguments', status: 'today' },
        null,
      ),
    ).rejects.toMatchObject({ status: 422 });
  });
});

// =============================================================================
// documentsService
// =============================================================================

describe('tenant isolation - documentsService', () => {
  it('list returns [] when firmId is null', async () => {
    expect(await documentsService.list(null)).toEqual([]);
  });

  it('get returns undefined when firmId is null even for a known row id', async () => {
    expect(await documentsService.get('d1', null)).toBeUndefined();
  });

  it('create throws 422 when firmId is null', async () => {
    await expect(
      documentsService.create(
        { case: 'X v Y', name: 'plaint.pdf', type: 'pleading', updated: 'just now', kind: 'document' },
        null,
      ),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('attachStorage returns undefined when firmId is null', async () => {
    const r = await documentsService.attachStorage('d1', null, {
      storageKey: 'k', fileName: 'f', fileMime: 'application/pdf', fileSize: 1,
    });
    expect(r).toBeUndefined();
  });

  it('getStorageKey returns null when firmId is null', async () => {
    expect(await documentsService.getStorageKey('d1', null)).toBeNull();
  });
});

// =============================================================================
// clausesService - fully bucketed per-firm in memory, so we can exercise the
// full cross-firm isolation contract end-to-end here.
// =============================================================================

describe('tenant isolation - clausesService', () => {
  it('list returns [] when firmId is null', async () => {
    const items = await clausesService.list({ firmId: null });
    expect(items).toEqual([]);
  });

  it('create throws 422 when firmId is null', async () => {
    await expect(
      clausesService.create(
        { category: 'Indemnity', title: 'X', description: 'd', body: 'b' },
        null,
      ),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('user-A-in-firm-A cannot list user-B-in-firm-B clauses', async () => {
    const firmA = uuid();
    const firmB = uuid();

    await clausesService.create(
      { category: 'Cat-A', title: 'Firm-A clause', description: 'a', body: 'a' },
      firmA,
    );
    await clausesService.create(
      { category: 'Cat-B', title: 'Firm-B clause', description: 'b', body: 'b' },
      firmB,
    );

    const visibleToA = await clausesService.list({ firmId: firmA });
    const visibleToB = await clausesService.list({ firmId: firmB });

    expect(visibleToA).toHaveLength(1);
    expect(visibleToA[0]?.title).toBe('Firm-A clause');
    expect(visibleToB).toHaveLength(1);
    expect(visibleToB[0]?.title).toBe('Firm-B clause');

    // No firm-A title appears in firm-B's view and vice versa.
    expect(visibleToA.every((c) => c.title !== 'Firm-B clause')).toBe(true);
    expect(visibleToB.every((c) => c.title !== 'Firm-A clause')).toBe(true);
  });

  it('update with the wrong firmId returns null even with a real id from another firm', async () => {
    const firmA = uuid();
    const firmB = uuid();
    const c = await clausesService.create(
      { category: 'Cat', title: 'Owned by A', description: 'd', body: 'b' },
      firmA,
    );
    // Attacker knows the id and tries from firmB context.
    const r = await clausesService.update(c.id, { title: 'pwned' }, firmB);
    expect(r).toBeNull();
    // And the original is untouched.
    const stillA = await clausesService.list({ firmId: firmA });
    expect(stillA.find((x) => x.id === c.id)?.title).toBe('Owned by A');
  });

  it('remove with the wrong firmId is a no-op', async () => {
    const firmA = uuid();
    const firmB = uuid();
    const c = await clausesService.create(
      { category: 'Cat', title: 'A-owned', description: 'd', body: 'b' },
      firmA,
    );
    const removed = await clausesService.remove(c.id, firmB);
    expect(removed).toBe(false);
    // Row still exists in firmA's bucket.
    const stillA = await clausesService.list({ firmId: firmA });
    expect(stillA.some((x) => x.id === c.id)).toBe(true);
  });

  it('incrementUses on a row id from another firm does not bump the real row', async () => {
    const firmA = uuid();
    const firmB = uuid();
    const c = await clausesService.create(
      { category: 'Cat', title: 'A-owned', description: 'd', body: 'b' },
      firmA,
    );
    await clausesService.incrementUses(c.id, firmB);
    const stillA = await clausesService.list({ firmId: firmA });
    expect(stillA.find((x) => x.id === c.id)?.uses).toBe(0);
  });

  it('importMany throws 422 when firmId is null', async () => {
    await expect(
      clausesService.importMany([{ category: 'X', title: 'Y', description: 'd', body: 'b' }], null),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('importMany rows land in the caller firm only', async () => {
    const firmA = uuid();
    const firmB = uuid();
    const res = await clausesService.importMany(
      [
        { category: 'Imp', title: 'Item 1', description: 'd', body: 'b' },
        { category: 'Imp', title: 'Item 2', description: 'd', body: 'b' },
      ],
      firmA,
    );
    expect(res.inserted).toBe(2);
    expect((await clausesService.list({ firmId: firmA })).filter((c) => c.category === 'Imp')).toHaveLength(2);
    expect((await clausesService.list({ firmId: firmB })).filter((c) => c.category === 'Imp')).toHaveLength(0);
  });
});

// =============================================================================
// clientsService
// =============================================================================

describe('tenant isolation - clientsService', () => {
  it('list returns [] when firmId is null', async () => {
    expect(await clientsService.list(null)).toEqual([]);
  });

  it('list returns [] for any firmId when no DB is configured (no leak via shared store)', async () => {
    expect(await clientsService.list(uuid())).toEqual([]);
  });

  it('create throws 422 when firmId is null', async () => {
    await expect(
      clientsService.create(
        { name: 'Acme', type: 'Corporate', status: 'active', lastContact: '2026-05-01' },
        null,
      ),
    ).rejects.toMatchObject({ status: 422 });
  });
});

// =============================================================================
// leadsService
// =============================================================================

describe('tenant isolation - leadsService', () => {
  it('list returns [] when firmId is null', async () => {
    expect(await leadsService.list(null)).toEqual([]);
  });

  it('list returns [] for any firmId in memory mode (no leak)', async () => {
    expect(await leadsService.list(uuid())).toEqual([]);
  });

  it('create throws 422 when firmId is null', async () => {
    await expect(
      leadsService.create(
        { name: 'Acme inquiry', valueInr: 100_000, referrer: 'web', stage: 'new' },
        null,
      ),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('updateStage returns undefined when firmId is null', async () => {
    expect(await leadsService.updateStage('l1', 'qualified', null)).toBeUndefined();
  });

  it('remove returns false when firmId is null', async () => {
    expect(await leadsService.remove('l1', null)).toBe(false);
  });
});

// =============================================================================
// invoicesService
// =============================================================================

describe('tenant isolation - invoicesService', () => {
  it('list returns [] when firmId is null', async () => {
    expect(await invoicesService.list(null)).toEqual([]);
  });

  it('list returns [] for any firmId in memory mode (no leak)', async () => {
    expect(await invoicesService.list(uuid())).toEqual([]);
  });

  it('create throws 422 when firmId is null', async () => {
    await expect(
      invoicesService.create(
        {
          invoiceNo: 'INV-X',
          client: 'Acme',
          amountInr: 10_000,
          issuedDate: '2026-05-01',
          dueDate: '2026-06-01',
          status: 'pending',
        },
        null,
      ),
    ).rejects.toMatchObject({ status: 422 });
  });
});

// =============================================================================
// expensesService
// =============================================================================

describe('tenant isolation - expensesService', () => {
  it('list returns [] when firmId is null', async () => {
    expect(await expensesService.list(null)).toEqual([]);
  });

  it('list returns [] for any firmId in memory mode (no leak)', async () => {
    expect(await expensesService.list(uuid())).toEqual([]);
  });

  it('create throws 422 when firmId is null', async () => {
    await expect(
      expensesService.create(
        {
          expenseNo: 'EXP-X',
          date: '2026-05-01',
          description: 'court fee',
          category: 'court',
          caseLabel: 'X v Y',
          amountInr: 500,
          status: 'pending',
          reimbursable: true,
          billable: false,
        },
        null,
      ),
    ).rejects.toMatchObject({ status: 422 });
  });
});

// =============================================================================
// limitationsService
// =============================================================================

describe('tenant isolation - limitationsService', () => {
  it('list returns [] when firmId is null', async () => {
    expect(await limitationsService.list(null)).toEqual([]);
  });

  it('list returns [] for any firmId in memory mode (no leak)', async () => {
    expect(await limitationsService.list(uuid())).toEqual([]);
  });

  it('create throws 422 when firmId is null', async () => {
    await expect(
      limitationsService.create(
        {
          caseLabel: 'X v Y',
          cnr: 'CNR-1',
          filingType: 'Appeal',
          forum: 'HC',
          deadline: '2026-12-31',
          filedBy: 'AB',
        },
        null,
      ),
    ).rejects.toMatchObject({ status: 422 });
  });
});

// =============================================================================
// diaryService
// =============================================================================

describe('tenant isolation - diaryService', () => {
  it('list returns [] when firmId is null', async () => {
    expect(await diaryService.list(null)).toEqual([]);
  });

  it('list returns [] for any firmId in memory mode (no leak)', async () => {
    expect(await diaryService.list(uuid())).toEqual([]);
  });

  it('create throws 422 when firmId is null', async () => {
    await expect(
      diaryService.create(
        {
          date: '2026-05-08',
          time: '10:00',
          kind: 'hearing',
          caseLabel: 'X v Y',
          cnr: 'CNR-1',
          detail: 'arguments',
          forum: 'HC',
        },
        null,
      ),
    ).rejects.toMatchObject({ status: 422 });
  });
});

// =============================================================================
// tasksService
// =============================================================================

describe('tenant isolation - tasksService', () => {
  it('board is empty when firmId is null', async () => {
    const b = await tasksService.board(null);
    expect(b).toEqual({ pending: [], progress: [], review: [], done: [] });
  });

  it('move returns an empty board when firmId is null', async () => {
    const b = await tasksService.move('t1', 'done', null);
    expect(b).toEqual({ pending: [], progress: [], review: [], done: [] });
  });

  it('create throws 422 when firmId is null', async () => {
    await expect(
      tasksService.create(
        {
          case: 'X v Y',
          title: 'Draft plaint',
          due: '',
          priority: 'high',
          assignee: 'AB',
          comments: 0,
          column: 'pending',
        },
        null,
      ),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('update returns undefined when firmId is null', async () => {
    expect(await tasksService.update('t1', { title: 'pwn' }, null)).toBeUndefined();
  });

  it('remove returns false when firmId is null', async () => {
    expect(await tasksService.remove('t1', null)).toBe(false);
  });
});

// =============================================================================
// archiveService
// =============================================================================

describe('tenant isolation - archiveService', () => {
  it('list returns [] when firmId is null', async () => {
    expect(await archiveService.list(null)).toEqual([]);
  });

  it('list returns [] for any firmId in memory mode (no leak)', async () => {
    expect(await archiveService.list(uuid())).toEqual([]);
  });
});
