/** Languages a draft can be written in (features/regional-languages.md). Mirrors
 *  DRAFT_LANGUAGES in apps/api/src/services/draft-translate.service.ts. */
export const DRAFT_LANGUAGES = [
  { code: 'EN', name: 'English', native: 'English' },
  { code: 'HI', name: 'Hindi', native: 'हिन्दी' },
  { code: 'TA', name: 'Tamil', native: 'தமிழ்' },
  { code: 'TE', name: 'Telugu', native: 'తెలుగు' },
  { code: 'KN', name: 'Kannada', native: 'ಕನ್ನಡ' },
  { code: 'ML', name: 'Malayalam', native: 'മലയാളം' },
  { code: 'MR', name: 'Marathi', native: 'मराठी' },
  { code: 'GU', name: 'Gujarati', native: 'ગુજરાતી' },
  { code: 'BN', name: 'Bengali', native: 'বাংলা' },
  { code: 'PA', name: 'Punjabi', native: 'ਪੰਜਾਬੀ' },
  { code: 'OR', name: 'Odia', native: 'ଓଡ଼ିଆ' },
  { code: 'AS', name: 'Assamese', native: 'অসমীয়া' },
] as const;

export type DraftLang = (typeof DRAFT_LANGUAGES)[number]['code'];

/** "தமிழ் (Tamil)"; English as is. */
export const draftLanguageLabel = (l: (typeof DRAFT_LANGUAGES)[number]): string =>
  l.code === 'EN' ? l.name : `${l.native} (${l.name})`;
