import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// build-docs/features/limitation-ladder-fix.md AC9 (web).
const src = readFileSync(resolve(__dirname, '../LimitationCalculator.tsx'), 'utf8');

describe('limitation ladder (web)', () => {
  it('AC9: s.138 shows an optional notice-received date and sends it only for the ladder', () => {
    expect(src).toContain("filingTypeId === 'ni138-dishonor' && (");
    expect(src).toContain('Date the drawer received the notice (optional)');
    expect(src).toContain("...(filingTypeId === 'ni138-dishonor' && noticeReceived ? { noticeReceivedDate: noticeReceived } : {})");
  });
});
