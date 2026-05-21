/**
 * Catalogue lookup the Mock-Arguments prompt builder uses to tell the LLM
 * what language to respond in.
 *
 * Mirror of apps/web/src/lib/languages.ts. Both must list the same codes —
 * the web picker is the source of truth for what the user can choose, and
 * this map decides how to name that choice in the system prompt. Keep them
 * in sync when adding/removing languages.
 */

interface LanguageMeta {
  code: string;
  englishName: string;
  nativeName: string;
}

const LANGUAGES_META: Record<string, LanguageMeta> = {
  'en-IN':  { code: 'en-IN',  englishName: 'English',   nativeName: 'English' },
  'hi-IN':  { code: 'hi-IN',  englishName: 'Hindi',     nativeName: 'हिन्दी' },
  'ta-IN':  { code: 'ta-IN',  englishName: 'Tamil',     nativeName: 'தமிழ்' },
  'te-IN':  { code: 'te-IN',  englishName: 'Telugu',    nativeName: 'తెలుగు' },
  'kn-IN':  { code: 'kn-IN',  englishName: 'Kannada',   nativeName: 'ಕನ್ನಡ' },
  'ml-IN':  { code: 'ml-IN',  englishName: 'Malayalam', nativeName: 'മലയാളം' },
  'bn-IN':  { code: 'bn-IN',  englishName: 'Bengali',   nativeName: 'বাংলা' },
  'mr-IN':  { code: 'mr-IN',  englishName: 'Marathi',   nativeName: 'मराठी' },
  'gu-IN':  { code: 'gu-IN',  englishName: 'Gujarati',  nativeName: 'ગુજરાતી' },
  'pa-IN':  { code: 'pa-IN',  englishName: 'Punjabi',   nativeName: 'ਪੰਜਾਬੀ' },
  'ur-IN':  { code: 'ur-IN',  englishName: 'Urdu',      nativeName: 'اردو' },
  'or-IN':  { code: 'or-IN',  englishName: 'Odia',      nativeName: 'ଓଡ଼ିଆ' },
  'as-IN':  { code: 'as-IN',  englishName: 'Assamese',  nativeName: 'অসমীয়া' },
  'ne-NP':  { code: 'ne-NP',  englishName: 'Nepali',    nativeName: 'नेपाली' },
  'sa-IN':  { code: 'sa-IN',  englishName: 'Sanskrit',  nativeName: 'संस्कृतम्' },
  'mai-IN': { code: 'mai-IN', englishName: 'Maithili',  nativeName: 'मैथिली' },
  'kok-IN': { code: 'kok-IN', englishName: 'Konkani',   nativeName: 'कोंकणी' },
  'ks-IN':  { code: 'ks-IN',  englishName: 'Kashmiri',  nativeName: 'कॉशुर' },
  'sd-IN':  { code: 'sd-IN',  englishName: 'Sindhi',    nativeName: 'سنڌي' },
  'doi-IN': { code: 'doi-IN', englishName: 'Dogri',     nativeName: 'डोगरी' },
  'mni-IN': { code: 'mni-IN', englishName: 'Manipuri',  nativeName: 'মৈতৈলোন্' },
  'brx-IN': { code: 'brx-IN', englishName: 'Bodo',      nativeName: 'बड़ो' },
  'sat-IN': { code: 'sat-IN', englishName: 'Santali',   nativeName: 'ᱥᱟᱱᱛᱟᱲᱤ' },
};

const ENGLISH_FALLBACK: LanguageMeta = LANGUAGES_META['en-IN']!;

export function languageMetaFor(code: string | null | undefined): LanguageMeta {
  if (!code) return ENGLISH_FALLBACK;
  return LANGUAGES_META[code] ?? ENGLISH_FALLBACK;
}

export function isKnownLanguageCode(code: string): boolean {
  return code in LANGUAGES_META;
}

/**
 * A directive line the prompt builder pastes into its system message. Returns
 * empty for English (the LLM defaults to it — no need to spend tokens
 * restating the obvious). For any other language we tell the model to
 * respond in that language while preserving statute/judgment names in their
 * original form, so cite-checks still work post-translation.
 */
export function languageDirective(code: string | null | undefined): string {
  const meta = languageMetaFor(code);
  if (meta.code === 'en-IN') return '';
  return `\n\nIMPORTANT: Respond ENTIRELY in ${meta.englishName} (${meta.nativeName}). Use the appropriate script naturally. Keep statute and judgment names in their original form (for example "BNS s.103" or "Maneka Gandhi v. Union of India") — do not transliterate the citation itself.`;
}
