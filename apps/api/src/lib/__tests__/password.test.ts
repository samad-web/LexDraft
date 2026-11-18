import { describe, expect, it } from 'vitest';
import { passwordProblem, PASSWORD_RULE, randomStrongPassword, strongPassword } from '../password';

describe('strong password rule', () => {
  it('AC1: accepts 8+ chars with upper, lower, number and symbol', () => {
    expect(passwordProblem('Court#2026')).toBeNull();
    expect(strongPassword.safeParse('Court#2026').success).toBe(true);
  });
  it.each([
    ['too short', 'Ab1!xyz'],
    ['no uppercase', 'court#2026'],
    ['no lowercase', 'COURT#2026'],
    ['no number', 'Court#Diary'],
    ['no symbol', 'Court2026x'],
  ])('AC2: rejects a password with %s', (_why, pw) => {
    expect(passwordProblem(pw)).toBe(PASSWORD_RULE);
    expect(strongPassword.safeParse(pw).success).toBe(false);
  });
  it('AC3: rejects over 128 characters (bcrypt truncation / memory abuse)', () => {
    expect(passwordProblem(`Aa1!${'x'.repeat(125)}`)).toBe(PASSWORD_RULE);
  });
  it('AC4: generated temp passwords always meet the rule and differ each time', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const pw = randomStrongPassword();
      expect(passwordProblem(pw)).toBeNull();
      seen.add(pw);
    }
    expect(seen.size).toBe(500);
  });
});
