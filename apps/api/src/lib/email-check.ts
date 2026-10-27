import { promises as dns } from 'node:dns';
import { BadRequestError } from './errors';

// Sign-up email check: the address must be well formed, not a throwaway
// inbox, and its domain must accept mail (MX record, or an A record as the
// SMTP fallback). This proves the domain is real; it cannot prove the inbox
// exists - only a code sent to it can do that.

const DISPOSABLE = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.info', 'sharklasers.com', '10minutemail.com',
  'tempmail.com', 'temp-mail.org', 'yopmail.com', 'trashmail.com', 'getnada.com', 'dispostable.com',
  'maildrop.cc', 'throwawaymail.com', 'fakeinbox.com', 'mintemail.com', 'emailondeck.com', 'mohmal.com',
]);

/** Common misspellings of the big free-mail domains. */
const TYPOS: Record<string, string> = {
  'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gamil.com': 'gmail.com',
  'gnail.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.con': 'gmail.com', 'gmail.cm': 'gmail.com',
  'gmail.in': 'gmail.com', 'gmaill.com': 'gmail.com', 'yaho.com': 'yahoo.com', 'yahoo.co': 'yahoo.com',
  'yahooo.com': 'yahoo.com', 'hotmal.com': 'hotmail.com', 'hotmial.com': 'hotmail.com', 'outlok.com': 'outlook.com',
  'outloo.com': 'outlook.com', 'rediffmal.com': 'rediffmail.com',
};

export function emailTypoSuggestion(email: string): string | null {
  const [local, domain] = email.trim().toLowerCase().split('@');
  const fixed = domain ? TYPOS[domain] : undefined;
  return local && fixed ? `${local}@${fixed}` : null;
}

async function domainReceivesMail(domain: string): Promise<boolean> {
  const withTimeout = <T>(p: Promise<T>) =>
    Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('dns timeout')), 4000))]);
  try {
    const mx = await withTimeout(dns.resolveMx(domain));
    if (mx.some((r) => r.exchange && r.exchange !== '.')) return true;
  } catch (err) {
    // A slow or unreachable resolver must not block sign-up.
    if ((err as Error).message === 'dns timeout') return true;
  }
  try {
    const a = await withTimeout(dns.resolve4(domain));
    return a.length > 0;
  } catch (err) {
    return (err as Error).message === 'dns timeout';
  }
}

/** Throws a user-facing 400 when the address can't be a real mailbox. */
export async function assertDeliverableEmail(email: string): Promise<void> {
  const value = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(value)) {
    throw new BadRequestError('Enter a valid email address.');
  }
  const suggestion = emailTypoSuggestion(value);
  if (suggestion) throw new BadRequestError(`Check your email - did you mean ${suggestion}?`, { code: 'email_typo' });
  const domain = value.split('@')[1]!;
  if (DISPOSABLE.has(domain)) {
    throw new BadRequestError('Use your own email address, not a temporary inbox.', { code: 'email_disposable' });
  }
  if (!(await domainReceivesMail(domain))) {
    throw new BadRequestError(`"${domain}" does not receive email. Check the spelling of your email address.`, { code: 'email_undeliverable' });
  }
}
