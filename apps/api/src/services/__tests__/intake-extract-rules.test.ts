import { describe, expect, it } from 'vitest';
import { extractDeterministic } from '../intake-extract-rules.service';
import type { IntakeFieldSpec } from '../intake-llm.service';

// The deterministic (no-LLM) extractor. It must pull STRUCTURED facts out of a
// realistic brief with zero API calls, holding the same no-hallucination rule as
// the LLM path: emit a field only on a clear match, leave the rest for the engine
// to keep asking. These tests pin what it reliably catches.

const FIELDS: IntakeFieldSpec[] = [
  { key: 'sender_name', label: 'Payee name', type: 'text', required: true },
  { key: 'sender_address', label: 'Payee address', type: 'textarea', required: true },
  { key: 'client', label: 'Payee (engine)', type: 'text', required: true },
  { key: 'recipient_name', label: 'Drawer name', type: 'text', required: true },
  { key: 'recipient_address', label: 'Drawer address', type: 'textarea', required: true },
  { key: 'cheque_no', label: 'Cheque number', type: 'text', required: true },
  { key: 'cheque_date', label: 'Cheque date', type: 'date', required: true },
  { key: 'cheque_amount', label: 'Cheque amount', type: 'currency', required: true },
  { key: 'drawee_bank', label: 'Drawee bank & branch', type: 'text', required: true },
  { key: 'presentation_date', label: 'Presentation date', type: 'date', required: true },
  { key: 'dishonour_date', label: 'Memo date', type: 'date', required: true },
  { key: 'memo_received_date', label: 'Memo received', type: 'date', required: true },
  {
    key: 'dishonour_reason', label: 'Reason', type: 'select', required: true,
    options: ['Funds Insufficient', 'Account Closed', 'Payment Stopped', 'Signature Differs', 'Refer to Drawer', 'Other'],
  },
  { key: 'notice_date', label: 'Notice date', type: 'date', required: true },
  { key: 'advocate_name', label: 'Advocate', type: 'text', required: true },
  { key: 'advocate_enrolment', label: 'Enrolment', type: 'text', required: true },
  {
    key: 'dispatch_mode', label: 'Dispatch', type: 'select', required: true,
    options: ['Registered Post Acknowledgement Due', 'Speed Post', 'Courier', 'Email', 'Hand Delivery'],
  },
  { key: 'place', label: 'Place', type: 'text', required: true },
];

function values(brief: string, answering: string[] = []) {
  const patch = extractDeterministic({ fields: FIELDS, latest: brief, answering });
  const map: Record<string, string> = {};
  for (const f of patch.fields) map[f.key] = f.value;
  return { map, patch };
}

describe('deterministic extractor — no LLM, structured facts', () => {
  it('never uses the model (modelUsed is the rules tag)', () => {
    const { patch } = values('anything');
    expect(patch.modelUsed).toBe('deterministic:rules');
  });

  it('parses the cheque number and amount', () => {
    const { map } = values('Cheque number 000456789 for ₹4,75,000.');
    expect(map.cheque_no).toBe('000456789');
    expect(map.cheque_amount).toBe('475000');
  });

  it('parses lakh-worded amounts', () => {
    expect(values('the cheque was 4.75 lakh').map.cheque_amount).toBe('475000');
    expect(values('a loan of 1.2 crore').map.cheque_amount).toBe('12000000');
  });

  it('maps the dishonour reason to the exact enum option', () => {
    expect(values('returned for insufficient funds').map.dishonour_reason).toBe('Funds Insufficient');
    expect(values('the account was closed').map.dishonour_reason).toBe('Account Closed');
    expect(values('he stopped payment').map.dishonour_reason).toBe('Payment Stopped');
  });

  it('maps the dispatch mode to the exact enum option', () => {
    expect(values('send by Registered Post AD').map.dispatch_mode)
      .toBe('Registered Post Acknowledgement Due');
    expect(values('by speed post').map.dispatch_mode).toBe('Speed Post');
  });

  it('assigns dates to the right field by keyword cue', () => {
    const { map } = values(
      'Cheque dated 10 August 2026. We presented it on 12 August 2026. ' +
      'Memo dated 20 August 2026, received on 22 August 2026. Notice dated 10 September 2026.',
    );
    expect(map.cheque_date).toBe('2026-08-10');
    expect(map.presentation_date).toBe('2026-08-12');
    expect(map.dishonour_date).toBe('2026-08-20');
    expect(map.memo_received_date).toBe('2026-08-22');
    expect(map.notice_date).toBe('2026-09-10');
  });

  it('parses numeric day-first dates', () => {
    expect(values('cheque dated 10/08/2026').map.cheque_date).toBe('2026-08-10');
    expect(values('cheque dated 2026-08-10').map.cheque_date).toBe('2026-08-10');
  });

  it('extracts the drawer name and address when explicitly cued', () => {
    const { map } = values('The drawer is Sandeep Verma of B-204, Sector 47, Gurugram.');
    expect(map.recipient_name).toBe('Sandeep Verma');
    expect(map.recipient_address).toContain('B-204');
  });

  it('extracts the advocate name + enrolment and the place', () => {
    const { map } = values("I'm R. Sundaravadivel, enrolment MS/2287/2011, from Coimbatore.");
    expect(map.advocate_name).toContain('Sundaravadivel');
    expect(map.advocate_enrolment).toBe('MS/2287/2011');
    expect(map.place).toBe('Coimbatore');
  });

  it('every emitted field carries a supporting span (no hallucination)', () => {
    const { patch } = values('Cheque number 000456789 for ₹4,75,000, returned for insufficient funds.');
    expect(patch.fields.length).toBeGreaterThan(0);
    for (const f of patch.fields) {
      expect(f.source, `field ${f.key} must cite a span`).toBeTruthy();
      expect(f.confidence).toBe('stated'); // rules never derive/guess
    }
  });

  it('emits nothing for a placeholder with no facts', () => {
    expect(values('test 1').patch.fields).toHaveLength(0);
    expect(values('hello there').patch.fields).toHaveLength(0);
  });

  it('extracts most of a full brief in one pass', () => {
    const brief =
      'My client Mehta Enterprises Pvt. Ltd., Plot 14, Naraina, New Delhi is the payee. ' +
      'The drawer is Sandeep Verma of B-204, Sector 47, Gurugram. ' +
      'Cheque number 000456789 dated 10 August 2026 for ₹4,75,000, drawn on HDFC Bank, Connaught Place branch. ' +
      'We presented it on 12 August 2026. It bounced for insufficient funds — memo dated 20 August 2026, received on 22 August 2026. ' +
      'Notice to be dated 10 September 2026, sent by Registered Post Acknowledgement Due, from Coimbatore. ' +
      "I'm R. Sundaravadivel, enrolment MS/2287/2011.";
    const { map } = values(brief);
    // The structured spine should all be present with zero API calls.
    expect(map.cheque_no).toBe('000456789');
    expect(map.cheque_amount).toBe('475000');
    expect(map.cheque_date).toBe('2026-08-10');
    expect(map.presentation_date).toBe('2026-08-12');
    expect(map.dishonour_date).toBe('2026-08-20');
    expect(map.memo_received_date).toBe('2026-08-22');
    expect(map.notice_date).toBe('2026-09-10');
    expect(map.dishonour_reason).toBe('Funds Insufficient');
    expect(map.dispatch_mode).toBe('Registered Post Acknowledgement Due');
    expect(map.recipient_name).toBe('Sandeep Verma');
    expect(map.advocate_enrolment).toBe('MS/2287/2011');
    expect(map.place).toBe('Coimbatore');
    expect(map.drawee_bank).toContain('HDFC');
  });
});

describe('extractDeterministic — GENERAL field-driven capture (any doc type, no LLM)', () => {
  const S = (key: string, label: string, type: any = 'text', options?: string[]) =>
    ({ key, label, type, required: true, ...(options ? { options } : {}) });

  it('captures bail fields from document prose', () => {
    const fields = [S('accused_name','Accused name'), S('age','Age','number'), S('occupation','Occupation'),
      S('fir_no','FIR number'), S('police_station','Police station'), S('sections','Sections'), S('custody_since','Custody since','date')];
    const p = extractDeterministic({ fields, latest:
      'The accused Rajesh Kumar, aged 34, occupation driver. FIR No. 45/2026 at E4 Police Station under section 420 IPC. In custody since 11/01/2026.', answering: [] });
    const by = Object.fromEntries(p.fields.map(f => [f.key, f.value]));
    expect(by.accused_name).toBe('Rajesh Kumar');
    expect(by.age).toBe('34');
    expect(by.fir_no).toBe('45/2026');
    expect(by.police_station).toBe('E4');
    expect(by.sections).toBe('420 IPC');
    expect(by.custody_since).toBe('2026-01-11');
  });

  it('captures deed party names + consideration across roles', () => {
    const fields = [S('vendor_name','Vendor name'), S('vendee_name','Vendee name'), S('total_consideration','Total consideration','currency')];
    const p = extractDeterministic({ fields, latest:
      'Vendor: Mr. Suresh Kumar son of Ramaswamy. Vendee: M/s Anand Traders. Total consideration Rs. 25,00,000.', answering: [] });
    const by = Object.fromEntries(p.fields.map(f => [f.key, f.value]));
    expect(by.vendor_name).toBe('Mr. Suresh Kumar');
    expect(by.vendee_name).toBe('M/s Anand Traders');
    expect(by.total_consideration).toBe('2500000');
  });
});
