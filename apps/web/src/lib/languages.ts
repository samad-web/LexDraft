/**
 * Catalogue of session languages for Mock Arguments.
 *
 * The list is the 22 scheduled languages of the Indian Constitution
 * (8th Schedule) plus English. Each entry carries a BCP-47 code (the value
 * actually stored on the session row and on users.default_language_code),
 * an English display name, the native script name shown in the picker, and
 * a `voiceSupport` flag that tells the UI whether to expose voice mode for
 * the language.
 *
 *   - `full`    Web Speech API recognises this locale on Chromium today
 *               (verified against Chrome 120+'s recogniser).
 *   - `partial` Some platforms recognise it but coverage is inconsistent;
 *               we still allow voice and let the engine error if not.
 *   - `none`    No reliable Web Speech support. Picker greys out voice and
 *               forces text-only input, so the user can still practise in
 *               the language even without dictation.
 *
 * Mirror file: apps/api/src/lib/languages.ts (English-name lookup the
 * prompt builder uses when telling the LLM what to respond in). Both lists
 * must stay in sync — codes here are the canonical source for the picker
 * and any code we add must also exist in the API mirror.
 */

export type LanguageVoiceSupport = 'full' | 'partial' | 'none';

export interface LanguageOption {
  /** BCP-47 code persisted on the session and the user preference. */
  code: string;
  englishName: string;
  /** Display name in the language's own script. Shown beside the English name. */
  nativeName: string;
  voiceSupport: LanguageVoiceSupport;
  /** True for the four South Indian languages — surfaced in the picker
   *  because the user specifically asked for South-Indian-first coverage. */
  isSouthIndian?: boolean;
}

export const LANGUAGES: ReadonlyArray<LanguageOption> = [
  // English first — most users default here and the LLM is sharpest in it.
  { code: 'en-IN', englishName: 'English (India)', nativeName: 'English',     voiceSupport: 'full' },
  { code: 'hi-IN', englishName: 'Hindi',           nativeName: 'हिन्दी',       voiceSupport: 'full' },

  // South Indian block — surfaced as a group in the picker (user emphasis).
  { code: 'ta-IN', englishName: 'Tamil',           nativeName: 'தமிழ்',        voiceSupport: 'full', isSouthIndian: true },
  { code: 'te-IN', englishName: 'Telugu',          nativeName: 'తెలుగు',       voiceSupport: 'full', isSouthIndian: true },
  { code: 'kn-IN', englishName: 'Kannada',         nativeName: 'ಕನ್ನಡ',        voiceSupport: 'full', isSouthIndian: true },
  { code: 'ml-IN', englishName: 'Malayalam',       nativeName: 'മലയാളം',       voiceSupport: 'full', isSouthIndian: true },

  // Other widely-spoken 8th-Schedule languages with full Web Speech support.
  { code: 'bn-IN', englishName: 'Bengali',         nativeName: 'বাংলা',        voiceSupport: 'full' },
  { code: 'mr-IN', englishName: 'Marathi',         nativeName: 'मराठी',        voiceSupport: 'full' },
  { code: 'gu-IN', englishName: 'Gujarati',        nativeName: 'ગુજરાતી',      voiceSupport: 'full' },
  { code: 'pa-IN', englishName: 'Punjabi',         nativeName: 'ਪੰਜਾਬੀ',       voiceSupport: 'full' },
  { code: 'ur-IN', englishName: 'Urdu',            nativeName: 'اردو',         voiceSupport: 'full' },

  // Partial voice support — text-only also fine.
  { code: 'or-IN',  englishName: 'Odia',           nativeName: 'ଓଡ଼ିଆ',        voiceSupport: 'partial' },
  { code: 'as-IN',  englishName: 'Assamese',       nativeName: 'অসমীয়া',      voiceSupport: 'partial' },
  { code: 'ne-NP',  englishName: 'Nepali',         nativeName: 'नेपाली',       voiceSupport: 'partial' },

  // No reliable Web Speech support — practice still works in text mode.
  { code: 'sa-IN',  englishName: 'Sanskrit',       nativeName: 'संस्कृतम्',    voiceSupport: 'none' },
  { code: 'mai-IN', englishName: 'Maithili',       nativeName: 'मैथिली',       voiceSupport: 'none' },
  { code: 'kok-IN', englishName: 'Konkani',        nativeName: 'कोंकणी',       voiceSupport: 'none' },
  { code: 'ks-IN',  englishName: 'Kashmiri',       nativeName: 'कॉशुर',        voiceSupport: 'none' },
  { code: 'sd-IN',  englishName: 'Sindhi',         nativeName: 'سنڌي',         voiceSupport: 'none' },
  { code: 'doi-IN', englishName: 'Dogri',          nativeName: 'डोगरी',        voiceSupport: 'none' },
  { code: 'mni-IN', englishName: 'Manipuri',       nativeName: 'মৈতৈলোন্',     voiceSupport: 'none' },
  { code: 'brx-IN', englishName: 'Bodo',           nativeName: 'बड़ो',         voiceSupport: 'none' },
  { code: 'sat-IN', englishName: 'Santali',        nativeName: 'ᱥᱟᱱᱛᱟᱲᱤ',     voiceSupport: 'none' },
];

export const DEFAULT_LANGUAGE_CODE = 'en-IN';

export function findLanguage(code: string | null | undefined): LanguageOption {
  if (!code) return LANGUAGES[0]!;
  return LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0]!;
}

/** True when the locale string starts with the same primary subtag as the
 *  language code. Used to pick a matching SpeechSynthesisVoice without
 *  requiring an exact "ta-IN" match (Tamil-Sri-Lanka voices are also fine). */
export function localeMatches(voiceLang: string, code: string): boolean {
  const base = (s: string): string => s.split(/[-_]/)[0]!.toLowerCase();
  return base(voiceLang) === base(code);
}
