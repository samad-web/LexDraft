import { describe, it, expect } from 'vitest';
import {
  scanConcordance,
  rewriteValueToBns,
  enrichFormWithBns,
  concordanceToBriefBlock,
} from '../bns-enrichment';

describe('bns-enrichment', () => {
  it('maps a common IPC reference to its BNS section', () => {
    const c = scanConcordance('The accused is charged u/s 420 IPC for cheating.');
    const cheating = c.find((e) => e.old.includes('420'));
    expect(cheating).toBeDefined();
    expect(cheating!.new).toMatch(/BNS/);
    expect(cheating!.toAct).toBe('BNS');
  });

  it('maps a CrPC reference to its BNSS section', () => {
    const c = scanConcordance('Bail is sought under Section 439 CrPC.');
    const bail = c.find((e) => e.old.includes('439'));
    expect(bail).toBeDefined();
    expect(bail!.new).toMatch(/BNSS/);
    expect(bail!.toAct).toBe('BNSS');
  });

  it('rewrites a field value keeping the old reference parenthetically', () => {
    const out = rewriteValueToBns('Offence u/s 420 IPC');
    expect(out).toMatch(/BNS/);
    expect(out).toMatch(/formerly/i);
    expect(out).toMatch(/420 IPC/);
  });

  it('leaves an unmapped / plain value untouched', () => {
    expect(rewriteValueToBns('Cheque bounced for insufficient funds')).toBe(
      'Cheque bounced for insufficient funds',
    );
    // NI Act s.138 is NOT part of the IPC/CrPC/IEA recast — must be left alone.
    expect(rewriteValueToBns('Complaint u/s 138 NI Act')).toBe('Complaint u/s 138 NI Act');
  });

  it('enriches a form and returns the concordance across fields', () => {
    const { form, concordance } = enrichFormWithBns({
      offence_sections: 'Sections 420 IPC and 406 IPC',
      applicant_name: 'Ramesh',
    });
    expect(form.offence_sections).toMatch(/BNS/);
    expect(form.applicant_name).toBe('Ramesh'); // untouched
    expect(concordance.length).toBeGreaterThanOrEqual(2);
  });

  it('renders a brief block only when there are entries', () => {
    expect(concordanceToBriefBlock([])).toBe('');
    const block = concordanceToBriefBlock([
      { old: 'Section 420 IPC', new: 'Section 318 BNS', toAct: 'BNS', change: 'Renumbered only' },
    ]);
    expect(block).toMatch(/318 BNS/);
    expect(block).toMatch(/in-force/i);
  });
});
