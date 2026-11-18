// Mirror of apps/api/src/lib/password.ts — keep the two in step.
export const PASSWORD_RULE = 'Use 8+ characters with an uppercase letter, a lowercase letter, a number and a symbol';

export function passwordProblem(pw: string): string | null {
  if (pw.length < 8 || pw.length > 128) return PASSWORD_RULE;
  if (!/[A-Z]/.test(pw) || !/[a-z]/.test(pw) || !/\d/.test(pw) || !/[^A-Za-z0-9]/.test(pw)) return PASSWORD_RULE;
  return null;
}

/** Which parts of the rule are met — drives the checklist under the field. */
export function passwordChecks(pw: string) {
  return [
    { label: '8+ characters', ok: pw.length >= 8 },
    { label: 'Uppercase', ok: /[A-Z]/.test(pw) },
    { label: 'Lowercase', ok: /[a-z]/.test(pw) },
    { label: 'Number', ok: /\d/.test(pw) },
    { label: 'Symbol', ok: /[^A-Za-z0-9]/.test(pw) },
  ];
}
