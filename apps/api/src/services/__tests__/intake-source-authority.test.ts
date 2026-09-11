import { describe, expect, it } from 'vitest';
import {
  sourceAuthorityRank,
  orderByAuthorityAscending,
} from '../intake.service';

// P0: when attached documents disagree on a fact, the statutory notice / cheque
// must win over a party-drafted deferment agreement. The merge is last-write-wins,
// so we read in ASCENDING authority — agreement first, notice/cheque last.

describe('source-authority ranking', () => {
  it('ranks the instrument (cheque / return memo) highest', () => {
    expect(sourceAuthorityRank('VENKI cheque 000106.pdf')).toBe(5);
    expect(sourceAuthorityRank('Return Memo 15-07.pdf')).toBe(5);
  });

  it('ranks the statutory notice above supporting docs', () => {
    expect(sourceAuthorityRank('VENKI PUBLICATION 138 notice.pdf')).toBe(4);
    expect(sourceAuthorityRank('notice.pdf')).toBeGreaterThan(
      sourceAuthorityRank('GST certificate.pdf'),
    );
  });

  it('ranks a deferment agreement LOWEST (party recital)', () => {
    expect(sourceAuthorityRank('CHEQUE PRESENTATION DEFERMENT AGREEMENT (1).pdf')).toBe(1);
    expect(sourceAuthorityRank('undertaking.pdf')).toBe(1);
  });

  it('gives an unknown file a neutral middle rank', () => {
    const r = sourceAuthorityRank('scan_001.pdf');
    expect(r).toBeGreaterThan(1); // above an agreement
    expect(r).toBeLessThan(4); // below a notice
  });

  it('orders the notice AFTER the agreement (so notice wins the merge)', () => {
    const files = [
      { fileName: 'CHEQUE PRESENTATION DEFERMENT AGREEMENT (1).pdf' },
      { fileName: 'VENKI PUBLICATION 138 notice.pdf' },
    ];
    const ordered = orderByAuthorityAscending(files);
    // agreement first (low authority), notice last (high authority -> wins)
    expect(ordered[0]!.fileName).toMatch(/DEFERMENT/);
    expect(ordered[ordered.length - 1]!.fileName).toMatch(/notice/);
  });

  it('is stable within a rank (preserves user order)', () => {
    const files = [
      { fileName: 'cheque_000102.pdf' },
      { fileName: 'cheque_000103.pdf' },
    ];
    const ordered = orderByAuthorityAscending(files);
    expect(ordered.map((f) => f.fileName)).toEqual([
      'cheque_000102.pdf',
      'cheque_000103.pdf',
    ]);
  });
});
