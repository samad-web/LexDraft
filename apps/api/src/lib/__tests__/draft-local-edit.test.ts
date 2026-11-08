import { describe, expect, it } from 'vitest';
import { localEdit } from '../draft-local-edit';
import { applyReviseEdits } from '../../services/draft-revise.service';

const DRAFT = [
  'IN THE COURT OF THE DISTRICT MUNSIF, POLLACHI',
  '1. The plaintiff Mr. R. Natarajan is the owner of the suit property.',
  '2. The defendant issued a cheque for Rs. 3,50,000/- dated 10.11.2026 to the plaintiff.',
  '3. On 10-11-2026 the cheque was presented; Rs. 13,50,000/- remains unrelated.',
  'Mr. R. Natarajan                Plaintiff',
];
const run = (instruction: string) => {
  const r = localEdit(instruction, DRAFT);
  return r && { ...r, out: applyReviseEdits(DRAFT, r.edits).paragraphs };
};

describe('local redraft — exact edits need no AI', () => {
  it('replaces a date in every printed form', () => {
    const r = run('change 10.11.2026 to 15.11.2026')!;
    expect(r.out[2]).toContain('dated 15.11.2026');
    expect(r.out[3]).toContain('On 15.11.2026');
    expect(r.summary).toContain('2 places');
    expect(r.warnings[0]).toMatch(/limitation/);
  });

  it('replaces an amount, keeps "Rs.", never touches a longer number, and warns', () => {
    const r = run('change the amount from Rs. 3,50,000 to Rs. 4,00,000')!;
    expect(r.out[2]).toContain('Rs. 4,00,000/-');
    expect(r.out[3]).toContain('Rs. 13,50,000/-');
    expect(r.warnings[0]).toMatch(/amount in words/);
  });

  it('matches an amount typed without commas', () => {
    expect(run('replace 350000 with 400000')!.out[2]).toContain('Rs. 400000/-');
  });

  it('replaces a proper name everywhere', () => {
    const r = run('Please replace Mr. R. Natarajan with Mr. R. Natesan.')!;
    expect(r.out[1]).toContain('Mr. R. Natesan');
    expect(r.out[4]).toContain('Mr. R. Natesan');
  });

  it('accepts a quoted plain word', () => {
    expect(run('change "suit property" to "schedule property"')!.out[1]).toContain('schedule property');
  });

  it.each([
    'instead of 10.11.2026 put 15.11.2026',
    'in place of 10.11.2026, it should be 15.11.2026',
    'the date should be 15.11.2026 instead of 10.11.2026',
    'the date should be 15.11.2026 and not 10.11.2026',
    '10.11.2026 is wrong, it should be 15.11.2026',
    '10.11.2026 should be 15.11.2026',
    'kindly correct 10.11.2026 as 15.11.2026',
  ])('understands how an advocate says it: "%s"', (instruction) => {
    expect(run(instruction)!.out[2]).toContain('dated 15.11.2026');
  });

  it.each(['para 2 delete', 'remove 2nd para', 'delete paragraph no. 2', 'Delete para 2 fully.', 'para 2 not needed'])(
    'deletes for "%s"', (instruction) => {
      expect(run(instruction)!.edits).toEqual([{ op: 'delete', index: 2 }]);
    });

  it('deletes a paragraph by its printed number', () => {
    const r = run('delete para 2')!;
    expect(r.edits).toEqual([{ op: 'delete', index: 2 }]);
    expect(r.warnings[0]).toMatch(/renumber/);
  });

  it('adds a paragraph after a printed number', () => {
    const r = run('add para after 1: The plaintiff is in possession.')!;
    expect(r.out[2]).toBe('The plaintiff is in possession.');
  });

  it.each([
    'make the grounds stronger',
    'change the date to 15.11.2026', // which date? the old value is not given
    'change grounds to be stronger',
    'replace Mr. Unknown with Mr. Ravi', // not in the draft
    'delete para 99',
    'add a clause on interest at 18%',
  ])('leaves "%s" to the AI', (instruction) => {
    expect(localEdit(instruction, DRAFT)).toBeNull();
  });

  it('will not delete when a printed number is ambiguous', () => {
    expect(localEdit('delete para 1', ['1. One', '1. Again'])).toBeNull();
  });
});
