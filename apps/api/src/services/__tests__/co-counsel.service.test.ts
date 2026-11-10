import { describe, expect, it } from 'vitest';
import { assertClaimant, coCounselService } from '../co-counsel.service';

// These tests run against the in-memory (no DATABASE_URL) environment, same
// as invoices.test.ts. They cover the guard clauses every DB-backed service
// in this codebase is expected to have: a missing firm/tenant context must
// fail safe (empty list or a clear error), never silently skip the WHERE
// clause. Full transactional behaviour (setCaseLead delegation, guest grant
// creation, tenant-isolation of guest reads) needs a real Postgres instance
// and belongs in apps/api/src/services/__tests__ integration suite once
// DATABASE_URL is available in CI.

describe('coCounselService', () => {
  it('returns an empty list when firmId is null (cross-tenant safety)', async () => {
    const items = await coCounselService.listForFirm(null);
    expect(items).toEqual([]);
  });

  it('rejects a handover request without a firm attachment', async () => {
    await expect(
      coCounselService.requestHandover({
        caseId: '00000000-0000-0000-0000-000000000001',
        firmId: null,
        actor: { id: '00000000-0000-0000-0000-000000000002', role: 'Managing Partner', isSuperadmin: false },
        input: { target: { existingUserId: '00000000-0000-0000-0000-000000000004' } },
      }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('reports a cancel on an unknown firm as not found rather than throwing a DB error', async () => {
    await expect(
      coCounselService.cancelHandover(
        '00000000-0000-0000-0000-000000000003',
        null,
        '00000000-0000-0000-0000-000000000002',
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('returns no guest cases for a user with no grants (no DB configured)', async () => {
    const items = await coCounselService.listGuestCases('00000000-0000-0000-0000-000000000002');
    expect(items).toEqual([]);
  });

  it('returns no guest hearings/documents/notes when there is no DB (fail safe, not an error)', async () => {
    const userId = '00000000-0000-0000-0000-000000000002';
    const caseId = '00000000-0000-0000-0000-000000000001';
    await expect(coCounselService.listGuestHearings(userId, caseId)).resolves.toEqual([]);
    await expect(coCounselService.listGuestDocuments(userId, caseId)).resolves.toEqual([]);
    await expect(coCounselService.listGuestNotes(userId, caseId)).resolves.toEqual([]);
  });

  it('reports no case found for a guest detail bundle without a DB, rather than a partial result', async () => {
    await expect(
      coCounselService.guestCaseDetail(
        '00000000-0000-0000-0000-000000000002',
        '00000000-0000-0000-0000-000000000001',
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('rejects a share-link handover request without a firm attachment', async () => {
    await expect(
      coCounselService.requestHandover({
        caseId: '00000000-0000-0000-0000-000000000001',
        firmId: null,
        actor: { id: '00000000-0000-0000-0000-000000000002', role: 'Managing Partner', isSuperadmin: false },
        input: { target: { open: true, phone: '9876543210' } },
      }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('rejects accepting an open-link invite without a DB configured', async () => {
    await expect(
      coCounselService.acceptByToken('a'.repeat(32), { name: 'Jane Doe', signupToken: 'x'.repeat(40) }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('rejects an existing user accepting a link, or revoke/leave, without a DB configured', async () => {
    const id = '00000000-0000-0000-0000-000000000002';
    await expect(coCounselService.acceptByTokenAsUser('a'.repeat(32), id)).rejects.toMatchObject({ status: 422 });
    await expect(coCounselService.revokeHandover(id, null, { id, role: 'Managing Partner', isSuperadmin: false }))
      .rejects.toMatchObject({ status: 404 });
    await expect(coCounselService.leaveGuestCase(id, id)).rejects.toMatchObject({ status: 404 });
  });
});

describe('assertClaimant (AC2: only the intended advocate can claim a link)', () => {
  it('accepts the bound WhatsApp number and refuses any other', () => {
    expect(() => assertClaimant({ phone: '+919876543210', email: null }, { phone: '+919876543210', email: 'a@x.in' })).not.toThrow();
    expect(() => assertClaimant({ phone: '+919876543210', email: null }, { phone: '+919876500000', email: 'a@x.in' }))
      .toThrow(/ending 3210/);
    expect(() => assertClaimant({ phone: '+919876543210', email: null }, { phone: null, email: 'a@x.in' })).toThrow();
  });

  it('legacy email-first rows match on email, case-insensitively', () => {
    expect(() => assertClaimant({ phone: null, email: 'Jane@X.in' }, { phone: null, email: 'jane@x.in' })).not.toThrow();
    expect(() => assertClaimant({ phone: null, email: 'jane@x.in' }, { phone: null, email: 'other@x.in' })).toThrow();
  });

  it('refuses a legacy open link with neither phone nor email (it was claimable by anyone)', () => {
    expect(() => assertClaimant({ phone: null, email: null }, { phone: '+919876543210', email: 'a@x.in' }))
      .toThrow(/no longer valid/);
  });
});
