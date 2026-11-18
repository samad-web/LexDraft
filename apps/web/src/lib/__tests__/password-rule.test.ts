import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { passwordProblem, PASSWORD_RULE } from '../password';

describe('sign-up password rule (web mirror)', () => {
  it('same rule text and checks as the API', () => {
    const api = readFileSync(resolve(__dirname, '../../../../api/src/lib/password.ts'), 'utf8');
    const web = readFileSync(resolve(__dirname, '../password.ts'), 'utf8');
    expect(api).toContain(`export const PASSWORD_RULE = '${PASSWORD_RULE}';`);
    const body = (s: string) => s.slice(s.indexOf('export function passwordProblem'), s.indexOf('\n}\n', s.indexOf('export function passwordProblem')));
    expect(body(web)).toBe(body(api));
  });
  it('strong passes, weak fails', () => {
    expect(passwordProblem('Court#2026')).toBeNull();
    for (const pw of ['', 'court#2026', 'COURT#2026', 'Court#Diary', 'Court2026x', 'Ab1!xyz']) expect(passwordProblem(pw)).toBe(PASSWORD_RULE);
  });
});
