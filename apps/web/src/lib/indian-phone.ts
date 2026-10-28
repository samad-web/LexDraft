// =============================================================================
// indian-phone — DifAi only accepts Indian (+91) mobile numbers.
//
// Phone fields show a fixed "+91" prefix and hold just the 10 national digits.
// Browser autofill often pastes a saved number in international form (e.g.
// "+44 7875 425858"); a foreign country code is REJECTED outright rather than
// trimmed to 10 digits, because trimming would turn a UK/US number into a
// plausible-looking but wrong Indian one. The API enforces the same rule
// (phone-otp.service normalizePhone).
// =============================================================================

export const FOREIGN_NUMBER_MESSAGE = 'Only Indian (+91) mobile numbers are supported.';

/** Read whatever was typed, pasted or autofilled into a "+91" field.
 *  Returns the 10-digit national number (possibly partial while typing), or
 *  `foreign: true` when the value carries a non-Indian country code. */
export function readIndianMobile(raw: string): { digits: string; foreign: boolean } {
  const compact = raw.replace(/[\s\-().]/g, '');
  if (/^\+(?!91)/.test(compact) || /^00(?!91)/.test(compact)) return { digits: '', foreign: true };

  let digits = compact.replace(/\D/g, '');
  if (/^\+91/.test(compact)) digits = digits.slice(2);
  else if (/^0091/.test(compact)) digits = digits.slice(4);
  else if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return { digits: digits.slice(0, 10), foreign: false };
}

/** A complete Indian mobile number: 10 digits starting 6-9. */
export function isIndianMobile(digits: string): boolean {
  return /^[6-9]\d{9}$/.test(digits);
}

/** The number in the form the API expects. */
export function toE164India(digits: string): string {
  return `+91${digits}`;
}
