// Request/response shapes for the eFiling (filing.ecourts.gov.in) live
// browser-automation flow. There is no encrypted mobile-API equivalent here
// (unlike lib/ecourts) - filing.ecourts.gov.in is login-gated, CAPTCHA-
// protected web portal only, so this package has no client.ts/crypto.ts.

export type EfilingUserType = 'advocate' | 'litigant' | 'pleader' | 'clerk' | 'gov_auth' | 'insurance';

// Maps our user-facing user-type values to the login form's radio input ids
// (confirmed live against https://filing.ecourts.gov.in/ on 2026-10-14):
// user_advocate, user_person, user_pleader, user_clerk, user_gov_auth, user_insurance.
export const EFILING_USER_TYPE_RADIO_ID: Record<EfilingUserType, string> = {
  advocate: 'user_advocate',
  litigant: 'user_person',
  pleader: 'user_pleader',
  clerk: 'user_clerk',
  gov_auth: 'user_gov_auth',
  insurance: 'user_insurance',
};

export interface EfilingStateOption {
  value: string;
  label: string;
}

export interface EfilingCaseDetails {
  caseType: string;
  caseNumber?: string;
  caseYear?: string;
  description?: string;
}
