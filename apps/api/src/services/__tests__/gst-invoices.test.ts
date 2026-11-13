import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// GST tax invoices - tests map to the acceptance criteria (AC#) in
// build-docs/features/gst-invoices.md.

const h = vi.hoisted(() => ({
  useFakeDb: false,
  calls: [] as Array<{ text: string; values: unknown[] }>,
  rows: (_text: string): unknown[] => [],
}));

vi.mock('../../db/client', () => ({
  db: () => {
    if (!h.useFakeDb) return null;
    const q = (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('?');
      h.calls.push({ text, values });
      return Promise.resolve(h.rows(text));
    };
    return Object.assign(q, {
      json: (v: unknown) => v,
      begin: async (fn: (tx: typeof q & { json: (v: unknown) => unknown }) => unknown) => fn(Object.assign(q, { json: (v: unknown) => v })),
    });
  },
}));

const SIRAH = '33CVVPM9805M1ZO';
let inv: typeof import('../subscription-invoice.service');

beforeAll(async () => {
  Object.assign(process.env, {
    INVOICE_SELLER_LEGAL_NAME: 'M MOHAMED RIYAZ', INVOICE_SELLER_TRADE_NAME: 'SIRAH DIGITAL', INVOICE_SELLER_GSTIN: SIRAH,
    INVOICE_SELLER_ADDRESS: 'SY NO 203/10B, Featherlite, 200 Feet Road, Zamin Pallavaram, Chennai, Tamil Nadu 600044',
    INVOICE_SELLER_EMAIL: 'support@sirahdigital.in', INVOICE_SAC: '998315', INVOICE_PREFIX: 'DIF',
  });
  inv = await import('../subscription-invoice.service');
});

afterEach(() => {
  h.useFakeDb = false;
  h.calls = [];
  h.rows = () => [];
});

describe('AC3 tax maths, GSTIN and place of supply', () => {
  it("Sirah Digital's GSTIN is valid (letter O check character); a wrong check character or state is not", () => {
    expect(inv.isValidGstin(SIRAH)).toBe(true);
    expect(inv.isValidGstin('33CVVPM9805M1Z0')).toBe(false);
    expect(inv.isValidGstin('99CVVPM9805M1ZO')).toBe(false);
    expect(inv.isValidGstin('not-a-gstin')).toBe(false);
    expect(inv.isValidGstin(null)).toBe(false);
  });

  it('place of supply: buyer GSTIN state wins, then the profile state, then the seller state', () => {
    expect(inv.placeOfSupply('29AAAPA1234A1ZP', 'Tamil Nadu', SIRAH)).toBe('29');
    expect(inv.placeOfSupply(null, 'Karnataka', SIRAH)).toBe('29');
    expect(inv.placeOfSupply(null, 'Orissa', SIRAH)).toBe('21');
    expect(inv.placeOfSupply('garbage', null, SIRAH)).toBe('33');
  });

  it('same state: CGST + SGST; other state: IGST; parts add up to the total to the paisa', () => {
    for (const total of [149900, 459964, 1, 99, 1439400]) {
      const intra = inv.splitTax(total, true);
      const inter = inv.splitTax(total, false);
      expect(intra.taxable + intra.cgst + intra.sgst + intra.igst).toBe(total);
      expect(inter.taxable + inter.igst).toBe(total);
      expect(intra.igst).toBe(0);
      expect(inter.cgst + inter.sgst).toBe(0);
      expect(Math.abs(intra.cgst - intra.sgst)).toBeLessThanOrEqual(1);
    }
    // Chamber 3 advocates: ₹3,898 + 18% = ₹4,599.64 -> taxable exactly ₹3,898.
    expect(inv.splitTax(459964, true)).toEqual({ taxable: 389800, cgst: 35082, sgst: 35082, igst: 0 });
  });

  it('financial year switches at 1 April midnight IST', () => {
    expect(inv.financialYear(new Date('2027-03-31T18:29:00Z'))).toBe('26-27'); // 31 Mar 23:59 IST
    expect(inv.financialYear(new Date('2027-03-31T18:31:00Z'))).toBe('27-28'); // 1 Apr 00:01 IST
    expect(inv.financialYear(new Date('2026-11-13T10:00:00Z'))).toBe('26-27');
  });

  it('amount in words, Indian style', () => {
    expect(inv.amountInWords(459964)).toBe('Rupees Four Thousand Five Hundred Ninety-Nine and Sixty-Four Paise only');
    expect(inv.amountInWords(149900)).toBe('Rupees One Thousand Four Hundred Ninety-Nine only');
    expect(inv.amountInWords(1234567800)).toBe('Rupees One Crore Twenty-Three Lakh Forty-Five Thousand Six Hundred Seventy-Eight only');
  });
});

describe('AC1/AC2 one invoice per charge, gapless numbering', () => {
  const owner = { practice: 'Riyaz & Associates', name: 'Haja', email: 'h@x.in', phone: '+919999999999',
    gstin: null, address_line: '12 Anna Salai', pincode: '600002', state: 'Tamil Nadu' };
  const pay = { firmId: '00000000-0000-0000-0000-0000000000f1', paymentId: 'pay_1', amountPaise: 459964, subscriptionId: 'sub_1',
    plan: 'practice', cycle: 'monthly', seats: 3, periodStart: null, periodEnd: null, at: new Date('2026-11-13T10:00:00Z') };

  it('issues DIF/26-27/<next number> with the counter bumped in the same transaction', async () => {
    h.useFakeDb = true;
    h.rows = (t) => t.includes('from firms f join users u') ? [owner]
      : t.includes('insert into invoice_counters') ? [{ last: 7 }]
      : t.includes('insert into subscription_invoices') ? [{ id: 'inv-1' }] : [];
    expect(await inv.subscriptionInvoiceService.issueForPayment(pay)).toBe('inv-1');
    const ins = h.calls.find((c) => c.text.includes('insert into subscription_invoices'))!;
    expect(ins.values[0]).toBe('DIF/26-27/000007');
    expect((ins.values[0] as string).length).toBeLessThanOrEqual(16);
    // Tamil Nadu buyer, Tamil Nadu seller: CGST + SGST.
    expect(ins.values.slice(-5)).toEqual([389800, 35082, 35082, 0, 459964]);
  });

  it('a redelivered webhook for the same payment issues nothing', async () => {
    h.useFakeDb = true;
    h.rows = (t) => (t.includes('where razorpay_payment_id') ? [{ id: 'inv-1' }] : []);
    expect(await inv.subscriptionInvoiceService.issueForPayment(pay)).toBeNull();
    expect(h.calls.some((c) => c.text.includes('insert into'))).toBe(false);
  });

  it('a parallel delivery that loses the race rolls back (no number burnt)', async () => {
    h.useFakeDb = true;
    h.rows = (t) => t.includes('from firms f join users u') ? [owner]
      : t.includes('insert into invoice_counters') ? [{ last: 8 }] : []; // invoice insert -> conflict, no row
    expect(await inv.subscriptionInvoiceService.issueForPayment(pay)).toBeNull();
  });

  it('an out-of-state buyer GSTIN gets IGST and is printed on the invoice', async () => {
    h.useFakeDb = true;
    const gstin = '29AAACR5055K1Z3';
    h.rows = (t) => t.includes('from firms f join users u') ? [{ ...owner, gstin, state: 'Tamil Nadu' }]
      : t.includes('insert into invoice_counters') ? [{ last: 1 }]
      : t.includes('insert into subscription_invoices') ? [{ id: 'inv-2' }] : [];
    await inv.subscriptionInvoiceService.issueForPayment({ ...pay, paymentId: 'pay_2' });
    const ins = h.calls.find((c) => c.text.includes('insert into subscription_invoices'))!;
    expect(ins.values.slice(-5)).toEqual([389800, 0, 0, 70164, 459964]);
    expect(JSON.stringify(ins.values)).toContain(gstin);
  });
});

describe('Webhook: a successful Razorpay charge issues the invoice for the amount charged', () => {
  it('subscription.charged with a payment -> one invoice insert with total = payment.amount', async () => {
    const billing = await import('../billing.service');
    h.useFakeDb = true;
    h.rows = (t) => t.includes('from razorpay_plans where razorpay_plan_id') ? [{ plan: 'solo', cycle: 'monthly', seats: 1 }]
      : t.includes('from firms f join users u') ? [{ practice: 'P', name: 'N', email: null, phone: null, gstin: null, address_line: null, pincode: null, state: null }]
      : t.includes('insert into invoice_counters') ? [{ last: 3 }]
      : t.includes('insert into subscription_invoices') ? [{ id: 'inv-w' }] : [];
    await billing.billingService.handleWebhook('evt_inv', {
      event: 'subscription.charged',
      payload: {
        subscription: { entity: { id: 'sub_w', plan_id: 'plan_s', paid_count: 1, current_start: 1_794_000_000, current_end: 1_796_600_000, notes: { firm_id: '00000000-0000-0000-0000-0000000000f1' } } },
        payment: { entity: { id: 'pay_w', amount: 149900 } },
      },
    });
    const ins = h.calls.find((c) => c.text.includes('insert into subscription_invoices'))!;
    expect(ins.values).toContain('pay_w');
    expect(ins.values.at(-1)).toBe(149900);
  });
});

describe('AC4 the PDF carries every GST tax-invoice field', () => {
  const row = {
    id: 'i', invoice_no: 'DIF/26-27/000001', firm_id: 'f', razorpay_payment_id: 'pay_9', plan: 'practice', cycle: 'monthly', seats: 3,
    period_start: new Date('2026-11-13T00:00:00Z'), period_end: new Date('2026-12-13T00:00:00Z'),
    buyer: { name: 'Haja', practice: '<script>alert(1)</script> & Co', gstin: null, address: '12 Anna Salai - 600002', state: '33-Tamil Nadu', email: 'h@x.in', phone: null },
    seller: { legalName: 'M MOHAMED RIYAZ', tradeName: 'SIRAH DIGITAL', gstin: SIRAH, address: 'Chennai 600044', state: '33-Tamil Nadu', email: 'support@sirahdigital.in', phone: '' },
    place_of_supply: '33-Tamil Nadu', sac: '998315', taxable_paise: 389800, cgst_paise: 35082, sgst_paise: 35082, igst_paise: 0, total_paise: 459964,
    issued_at: new Date('2026-11-13T10:00:00Z'),
  };

  it('has seller and buyer, GSTINs, number, date, SAC, place of supply, tax lines, total and words', () => {
    const html = inv.subscriptionInvoiceService.html(row as never);
    for (const s of ['TAX INVOICE', 'DIF/26-27/000001', 'SIRAH DIGITAL', 'M MOHAMED RIYAZ', SIRAH, 'Unregistered', '998315',
      'Place of supply: <b>33-Tamil Nadu</b>', 'CGST @ 9%', 'SGST @ 9%', '₹3,898.00', '₹4,599.64', 'Sixty-Four Paise only', 'pay_9']) {
      expect(html).toContain(s);
    }
    expect(html).not.toContain('IGST');
  });

  it('buyer text is escaped (no script injection into the PDF)', () => {
    const html = inv.subscriptionInvoiceService.html(row as never);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; Co');
  });
});

describe('AC5 only the owning firm (or superadmin) can open an invoice', () => {
  it("another firm's invoice id is not found; superadmin (null) sees it", async () => {
    h.useFakeDb = true;
    h.rows = (t) => (t.includes('from subscription_invoices where id') ? [{ id: 'x', firm_id: 'firm-a' }] : []);
    const id = '11111111-1111-1111-1111-111111111111';
    expect(await inv.subscriptionInvoiceService.find(id, 'firm-b')).toBeNull();
    expect(await inv.subscriptionInvoiceService.find(id, 'firm-a')).not.toBeNull();
    expect(await inv.subscriptionInvoiceService.find(id, null)).not.toBeNull();
    expect(await inv.subscriptionInvoiceService.find('not-a-uuid', null)).toBeNull();
  });
});

describe('AC6 no seller config: no invoice, payments unaffected', () => {
  it('returns null and writes nothing when the seller GSTIN is missing', async () => {
    vi.resetModules();
    const saved = process.env['INVOICE_SELLER_GSTIN'];
    process.env['INVOICE_SELLER_GSTIN'] = '';
    try {
      const fresh = await import('../subscription-invoice.service');
      h.useFakeDb = true;
      expect(await fresh.subscriptionInvoiceService.issueForPayment({
        firmId: 'f', paymentId: 'pay_x', amountPaise: 100, subscriptionId: null, plan: 'solo', cycle: 'monthly', seats: 1, periodStart: null, periodEnd: null,
      })).toBeNull();
      expect(h.calls).toHaveLength(0);
    } finally {
      process.env['INVOICE_SELLER_GSTIN'] = saved;
      vi.resetModules();
    }
  });
});
