import { chromium } from 'playwright';
import type { SubscriptionInvoice } from '@lexdraft/types';
import { db } from '../db/client';
import { env } from '../env';
import { logger } from '../logger';
import { planLabel } from '../lib/plans';

// =============================================================================
// GST tax invoices for DifAi subscriptions (features/gst-invoices.md, 0106).
// Sirah Digital is the seller: one invoice per successful Razorpay charge,
// numbered without gaps per financial year, rendered as a PDF on demand.
// =============================================================================

/** GST state codes (place of supply). */
const STATES: Record<string, string> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand',
  '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim',
  '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya',
  '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh',
  '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa',
  '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh',
};

const norm = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z]/g, '');
const CODE_BY_NAME = new Map(Object.entries(STATES).map(([code, name]) => [norm(name), code]));
CODE_BY_NAME.set(norm('Orissa'), '21');
CODE_BY_NAME.set(norm('Pondicherry'), '34');

const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Format + state code + check character (GSTN's mod-36 checksum). */
export function isValidGstin(raw: string | null | undefined): boolean {
  const g = (raw ?? '').trim().toUpperCase();
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g) || !STATES[g.slice(0, 2)]) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = GSTIN_CHARS.indexOf(g[i]!) * (i % 2 ? 2 : 1);
    sum += Math.floor(v / 36) + (v % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36] === g[14];
}

/** Place of supply: the buyer's GSTIN state, else their profile state, else the seller's. */
export function placeOfSupply(buyerGstin: string | null, buyerState: string | null, sellerGstin: string): string {
  if (isValidGstin(buyerGstin)) return buyerGstin!.trim().slice(0, 2);
  const byName = buyerState ? CODE_BY_NAME.get(norm(buyerState)) : undefined;
  return byName ?? sellerGstin.slice(0, 2);
}

/** 18% GST inside a GST-inclusive total, in paise; same state = CGST + SGST, else IGST. */
export function splitTax(totalPaise: number, intraState: boolean) {
  const taxable = Math.round(totalPaise / 1.18);
  const gst = totalPaise - taxable;
  const cgst = intraState ? Math.floor(gst / 2) : 0;
  return { taxable, cgst, sgst: intraState ? gst - cgst : 0, igst: intraState ? 0 : gst };
}

/** Indian financial year label for a date in IST: April 2026 - March 2027 = '26-27'. */
export function financialYear(d: Date): string {
  const ist = new Date(d.getTime() + 330 * 60 * 1000);
  const y = ist.getUTCFullYear() - (ist.getUTCMonth() < 3 ? 1 : 0);
  return `${String(y % 100).padStart(2, '0')}-${String((y + 1) % 100).padStart(2, '0')}`;
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function under100(n: number): string {
  return n < 20 ? ONES[n]! : `${TENS[Math.floor(n / 10)]}${n % 10 ? `-${ONES[n % 10]}` : ''}`;
}
function under1000(n: number): string {
  const h = Math.floor(n / 100);
  return [h ? `${ONES[h]} Hundred` : '', n % 100 ? under100(n % 100) : ''].filter(Boolean).join(' ');
}
function rupeesInWords(n: number): string {
  if (n === 0) return 'Zero';
  const parts: string[] = [];
  const crore = Math.floor(n / 1e7); n %= 1e7;
  const lakh = Math.floor(n / 1e5); n %= 1e5;
  const thousand = Math.floor(n / 1e3); n %= 1e3;
  if (crore) parts.push(`${rupeesInWords(crore)} Crore`);
  if (lakh) parts.push(`${under100(lakh)} Lakh`);
  if (thousand) parts.push(`${under100(thousand)} Thousand`);
  if (n) parts.push(under1000(n));
  return parts.join(' ');
}
/** "Rupees Four Thousand Five Hundred Ninety-Nine and Sixty-Four Paise only". */
export function amountInWords(paise: number): string {
  const r = Math.floor(paise / 100);
  const p = paise % 100;
  return `Rupees ${rupeesInWords(r)}${p ? ` and ${under100(p)} Paise` : ''} only`;
}

export interface Seller { legalName: string; tradeName: string; gstin: string; address: string; state: string; email: string; phone: string }
function seller(): Seller | null {
  const gstin = env.INVOICE_SELLER_GSTIN.trim().toUpperCase();
  if (!isValidGstin(gstin) || !env.INVOICE_SELLER_LEGAL_NAME || !env.INVOICE_SELLER_ADDRESS) return null;
  return {
    legalName: env.INVOICE_SELLER_LEGAL_NAME, tradeName: env.INVOICE_SELLER_TRADE_NAME, gstin,
    address: env.INVOICE_SELLER_ADDRESS, state: `${gstin.slice(0, 2)}-${STATES[gstin.slice(0, 2)]}`,
    email: env.INVOICE_SELLER_EMAIL, phone: env.INVOICE_SELLER_PHONE,
  };
}

interface Buyer { name: string; practice: string | null; gstin: string | null; address: string | null; state: string | null; email: string | null; phone: string | null }

interface InvoiceRow {
  id: string; invoice_no: string; firm_id: string; razorpay_payment_id: string; plan: string; cycle: string; seats: number; munshi_seats: number | null;
  period_start: Date | null; period_end: Date | null; buyer: Buyer; seller: Seller; place_of_supply: string; sac: string;
  taxable_paise: number; cgst_paise: number; sgst_paise: number; igst_paise: number; total_paise: number; issued_at: Date;
}

function toDto(r: InvoiceRow): SubscriptionInvoice {
  return {
    id: r.id, invoiceNo: r.invoice_no, issuedAt: r.issued_at.toISOString(), plan: r.plan, cycle: r.cycle, seats: r.seats, munshiSeats: r.munshi_seats ?? 0,
    totalInr: r.total_paise / 100, taxInr: (r.cgst_paise + r.sgst_paise + r.igst_paise) / 100,
  };
}

class Duplicate extends Error {}

export const subscriptionInvoiceService = {
  /** One invoice for one successful charge. Idempotent on the payment id;
   *  null when the seller isn't configured or it already exists. */
  async issueForPayment(p: {
    firmId: string; paymentId: string; amountPaise: number; subscriptionId: string | null;
    plan: string; cycle: string; seats: number; munshi?: number; periodStart: Date | null; periodEnd: Date | null; at?: Date;
  }): Promise<string | null> {
    const sql = db();
    if (!sql) return null;
    const s = seller();
    if (!s) {
      logger.error({ firmId: p.firmId, paymentId: p.paymentId }, 'GST invoice NOT issued: INVOICE_SELLER_* not configured');
      return null;
    }
    if (!Number.isInteger(p.amountPaise) || p.amountPaise <= 0) return null;
    const [seen] = await sql<{ id: string }[]>`select id from subscription_invoices where razorpay_payment_id = ${p.paymentId}`;
    if (seen) return null;

    const [b] = await sql<Array<{ practice: string | null; name: string; email: string | null; phone: string | null;
      gstin: string | null; address_line: string | null; pincode: string | null; state: string | null }>>`
      select f.name as practice, u.name, u.email, u.phone, u.gstin, u.address_line, u.pincode, u.state
      from firms f join users u on u.firm_id = f.id
      where f.id = ${p.firmId}::uuid and u.role in ('Solo Advocate', 'Managing Partner')
      order by u.created_at limit 1`;
    const gstin = b?.gstin && isValidGstin(b.gstin) ? b.gstin.trim().toUpperCase() : null;
    if (b?.gstin && !gstin) logger.warn({ firmId: p.firmId }, 'buyer GSTIN invalid: invoiced as unregistered');
    const pos = placeOfSupply(gstin, b?.state ?? null, s.gstin);
    const tax = splitTax(p.amountPaise, pos === s.gstin.slice(0, 2));
    const buyer: Buyer = {
      name: b?.name ?? 'Customer', practice: b?.practice ?? null, gstin,
      address: [b?.address_line, b?.pincode].filter(Boolean).join(' - ') || null,
      state: `${pos}-${STATES[pos]}`, email: b?.email ?? null, phone: b?.phone ?? null,
    };
    const fy = financialYear(p.at ?? new Date());
    try {
      return await sql.begin(async (tx) => {
        const [c] = await tx<{ last: number }[]>`
          insert into invoice_counters (fy, last) values (${fy}, 1)
          on conflict (fy) do update set last = invoice_counters.last + 1
          returning last`;
        const seq = c!.last;
        const no = `${env.INVOICE_PREFIX}/${fy}/${String(seq).padStart(6, '0')}`;
        const [row] = await tx<{ id: string }[]>`
          insert into subscription_invoices (invoice_no, fy, seq, firm_id, razorpay_payment_id, razorpay_subscription_id,
            plan, cycle, seats, munshi_seats, period_start, period_end, buyer, seller, place_of_supply, sac,
            taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise)
          values (${no}, ${fy}, ${seq}, ${p.firmId}::uuid, ${p.paymentId}, ${p.subscriptionId},
            ${p.plan}, ${p.cycle}, ${p.seats}, ${p.munshi ?? 0}, ${p.periodStart}, ${p.periodEnd}, ${tx.json(buyer as never)}, ${tx.json(s as never)},
            ${`${pos}-${STATES[pos]}`}, ${env.INVOICE_SAC},
            ${tax.taxable}, ${tax.cgst}, ${tax.sgst}, ${tax.igst}, ${p.amountPaise})
          on conflict (razorpay_payment_id) do nothing
          returning id`;
        // A parallel delivery won the race: roll back so the number isn't burnt.
        if (!row) throw new Duplicate();
        return row.id;
      });
    } catch (err) {
      if (err instanceof Duplicate) return null;
      throw err;
    }
  },

  async listForFirm(firmId: string): Promise<SubscriptionInvoice[]> {
    const sql = db();
    if (!sql) return [];
    const rows = await sql<InvoiceRow[]>`select * from subscription_invoices where firm_id = ${firmId}::uuid order by issued_at desc limit 200`;
    return rows.map(toDto);
  },

  async listAll(limit = 300): Promise<Array<SubscriptionInvoice & { firmId: string; practice: string | null }>> {
    const sql = db();
    if (!sql) return [];
    const rows = await sql<InvoiceRow[]>`select * from subscription_invoices order by issued_at desc limit ${limit}`;
    return rows.map((r) => ({ ...toDto(r), firmId: r.firm_id, practice: r.buyer?.practice ?? r.buyer?.name ?? null }));
  },

  /** The invoice row, only if it belongs to `firmId` (null firmId = superadmin). */
  async find(id: string, firmId: string | null): Promise<InvoiceRow | null> {
    const sql = db();
    if (!sql || !/^[0-9a-f-]{36}$/i.test(id)) return null;
    const [r] = await sql<InvoiceRow[]>`select * from subscription_invoices where id = ${id}::uuid`;
    return r && (firmId === null || r.firm_id === firmId) ? r : null;
  },

  html: invoiceHtml,

  async pdf(r: InvoiceRow): Promise<Buffer> {
    const browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || undefined, headless: true, args: ['--disable-dev-shm-usage'],
    });
    try {
      const page = await browser.newPage();
      // No network: the invoice is self-contained HTML.
      await page.route('**/*', (route) => route.abort());
      await page.setContent(invoiceHtml(r), { waitUntil: 'domcontentloaded' });
      return await page.pdf({ format: 'A4', printBackground: true, margin: { top: '14mm', bottom: '14mm', left: '14mm', right: '14mm' } });
    } finally {
      await browser.close();
    }
  },
};

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const inr = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (d: Date | null) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '');

/** DifAi's invoice: black and white, every field a GST tax invoice needs. */
function invoiceHtml(r: InvoiceRow): string {
  const s = r.seller;
  const b = r.buyer;
  const plan = `DifAi ${planLabel(r.plan, r.seats, r.munshi_seats ?? 0)}, ${r.cycle === 'one-time' ? 'one-time purchase' : `billed ${r.cycle === 'annual' ? 'yearly' : 'monthly'}`}`;
  const period = r.period_start || r.period_end ? `Service period: ${day(r.period_start)} – ${day(r.period_end)}` : '';
  const taxRows = r.igst_paise
    ? `<tr><td>IGST @ 18%</td><td class="n">${inr(r.igst_paise)}</td></tr>`
    : `<tr><td>CGST @ 9%</td><td class="n">${inr(r.cgst_paise)}</td></tr><tr><td>SGST @ 9%</td><td class="n">${inr(r.sgst_paise)}</td></tr>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}body{font-family:'Noto Sans','Liberation Sans',Arial,sans-serif;color:#111;font-size:11px;margin:0}
.top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111;padding-bottom:12px}
.brand{font-size:26px;font-weight:800;letter-spacing:-.5px}.title{text-align:right}.title h1{margin:0;font-size:16px;letter-spacing:2px}
.muted{color:#555}.grid{display:flex;gap:24px;margin:16px 0}.grid>div{flex:1}.label{font-size:9px;letter-spacing:1.5px;color:#555;text-transform:uppercase;margin-bottom:4px}
table{width:100%;border-collapse:collapse;margin-top:8px}th,td{padding:8px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}
th{font-size:9px;letter-spacing:1px;text-transform:uppercase;color:#555;border-bottom:1px solid #111}.n{text-align:right;white-space:nowrap}
.totals{width:46%;margin-left:auto}.totals td{border:none;padding:4px 8px}.grand td{border-top:2px solid #111;font-weight:700;font-size:13px;padding-top:8px}
.words{margin-top:10px;padding:8px;border:1px solid #111}.foot{margin-top:28px;border-top:1px solid #ddd;padding-top:10px;color:#555;font-size:9.5px}
</style></head><body>
<div class="top"><div><div class="brand">DifAi</div><div class="muted">by ${esc(s.tradeName || s.legalName)}</div></div>
<div class="title"><h1>TAX INVOICE</h1><div>Invoice No: <b>${esc(r.invoice_no)}</b></div><div>Date: ${esc(day(r.issued_at))}</div></div></div>
<div class="grid">
<div><div class="label">Supplier</div><b>${esc(s.tradeName || s.legalName)}</b>${s.tradeName ? `<br>(Proprietor: ${esc(s.legalName)})` : ''}<br>${esc(s.address)}<br>GSTIN: <b>${esc(s.gstin)}</b><br>State: ${esc(s.state)}${s.email ? `<br>${esc(s.email)}` : ''}${s.phone ? ` · ${esc(s.phone)}` : ''}</div>
<div><div class="label">Bill to</div><b>${esc(b.practice || b.name)}</b>${b.practice && b.practice !== b.name ? `<br>${esc(b.name)}` : ''}${b.address ? `<br>${esc(b.address)}` : ''}<br>GSTIN: ${b.gstin ? `<b>${esc(b.gstin)}</b>` : 'Unregistered'}<br>State: ${esc(b.state)}${b.email ? `<br>${esc(b.email)}` : ''}</div>
</div>
<div>Place of supply: <b>${esc(r.place_of_supply)}</b> · Reverse charge: No</div>
<table><thead><tr><th>#</th><th>Description</th><th>SAC</th><th class="n">Qty</th><th class="n">Taxable value</th></tr></thead>
<tbody><tr><td>1</td><td>${esc(plan)}${period ? `<br><span class="muted">${esc(period)}</span>` : ''}</td><td>${esc(r.sac)}</td><td class="n">1</td><td class="n">${inr(r.taxable_paise)}</td></tr></tbody></table>
<table class="totals"><tr><td>Taxable value</td><td class="n">${inr(r.taxable_paise)}</td></tr>${taxRows}
<tr class="grand"><td>Total</td><td class="n">${inr(r.total_paise)}</td></tr></table>
<div class="words">${esc(amountInWords(r.total_paise))}</div>
<div class="foot">Paid online via Razorpay · Payment ID ${esc(r.razorpay_payment_id)}<br>This is a computer-generated invoice and does not require a signature.</div>
</body></html>`;
}
