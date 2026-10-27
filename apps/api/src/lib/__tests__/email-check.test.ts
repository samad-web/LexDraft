import { describe, expect, it } from 'vitest';
import { assertDeliverableEmail, emailTypoSuggestion } from '../email-check';

describe('sign-up email check', () => {
  it('suggests the right domain for common gmail typos', () => {
    expect(emailTypoSuggestion('salman@gmial.com')).toBe('salman@gmail.com');
    expect(emailTypoSuggestion('salman@gmail.con')).toBe('salman@gmail.com');
    expect(emailTypoSuggestion('salman@gmail.com')).toBeNull();
  });

  it('rejects malformed addresses, typos and throwaway inboxes before any DNS lookup', async () => {
    await expect(assertDeliverableEmail('not-an-email')).rejects.toThrow(/valid email/);
    await expect(assertDeliverableEmail('a@gmial.com')).rejects.toThrow(/did you mean a@gmail\.com/);
    await expect(assertDeliverableEmail('a@mailinator.com')).rejects.toThrow(/temporary inbox/);
  });
});
