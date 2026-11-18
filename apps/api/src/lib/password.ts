import crypto from 'node:crypto';
import { z } from 'zod';

// Strong-password rule for every password a person sets (sign-up, firm/admin
// "add user"). Sign-in keeps accepting older passwords. Mirrored in
// apps/web/src/lib/password.ts — keep the two in step.
export const PASSWORD_RULE = 'Use 8+ characters with an uppercase letter, a lowercase letter, a number and a symbol';

export function passwordProblem(pw: string): string | null {
  if (pw.length < 8 || pw.length > 128) return PASSWORD_RULE;
  if (!/[A-Z]/.test(pw) || !/[a-z]/.test(pw) || !/\d/.test(pw) || !/[^A-Za-z0-9]/.test(pw)) return PASSWORD_RULE;
  return null;
}

export const strongPassword = z.string().max(128).refine((pw) => !passwordProblem(pw), PASSWORD_RULE);

/** Random temporary password that always meets the rule (shown to the admin once). */
export function randomStrongPassword(): string {
  const sets = ['ABCDEFGHJKMNPQRSTUVWXYZ', 'abcdefghjkmnpqrstuvwxyz', '23456789', '@#$%&*!?'];
  const all = sets.join('');
  const chars = [...sets, all, all, all, all, all, all, all, all].map((s) => s[crypto.randomInt(s.length)]!);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}
