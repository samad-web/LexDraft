// Mirror of apps/api/src/lib/password.ts — keep the two in step.
export const PASSWORD_RULE = 'Use 8+ characters with an uppercase letter, a lowercase letter, a number and a symbol';

export function passwordProblem(pw: string): string | null {
  if (pw.length < 8 || pw.length > 128) return PASSWORD_RULE;
  if (!/[A-Z]/.test(pw) || !/[a-z]/.test(pw) || !/\d/.test(pw) || !/[^A-Za-z0-9]/.test(pw)) return PASSWORD_RULE;
  return null;
}
