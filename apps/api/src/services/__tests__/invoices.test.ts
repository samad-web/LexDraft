import { describe, expect, it } from 'vitest';
import { invoicesService } from '../invoices.service';

describe('invoicesService', () => {
  it('returns empty list when firmId is null (cross-tenant safety)', async () => {
    const items = await invoicesService.list(null);
    expect(items).toEqual([]);
  });

  it('rejects creation without a firm attachment', async () => {
    await expect(
      invoicesService.create(
        {
          invoiceNo: 'INV-1',
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
