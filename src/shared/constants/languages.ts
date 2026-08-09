/**
 * Supported translation languages
 *
 * Shared by the main process (Lingva target list, RTL detection) and the
 * renderer (settings dropdown, cache labels) so there is one list to update.
 * Kept free of Electron and Node imports so the renderer bundle can use it.
 */

export interface Language {
  code: string;
  name: string;
  rtl: boolean;
}

// 43 languages, sorted alphabetically by display name
export const SUPPORTED_LANGUAGES: Language[] = [
  { code: 'af', name: 'Afrikaans', rtl: false },
  { code: 'ar', name: 'Arabic', rtl: true },
  { code: 'bn', name: 'Bengali', rtl: false },
  { code: 'bg', name: 'Bulgarian', rtl: false },
  { code: 'ca', name: 'Catalan', rtl: false },
  { code: 'zh', name: 'Chinese', rtl: false },
  { code: 'hr', name: 'Croatian', rtl: false },
  { code: 'cs', name: 'Czech', rtl: false },
  { code: 'da', name: 'Danish', rtl: false },
  { code: 'nl', name: 'Dutch', rtl: false },
  { code: 'en', name: 'English', rtl: false },
  { code: 'fi', name: 'Finnish', rtl: false },
  { code: 'fr', name: 'French', rtl: false },
  { code: 'de', name: 'German', rtl: false },
  { code: 'el', name: 'Greek', rtl: false },
  { code: 'he', name: 'Hebrew', rtl: true },
  { code: 'hi', name: 'Hindi', rtl: false },
  { code: 'hu', name: 'Hungarian', rtl: false },
  { code: 'id', name: 'Indonesian', rtl: false },
  { code: 'it', name: 'Italian', rtl: false },
  { code: 'ja', name: 'Japanese', rtl: false },
  { code: 'ko', name: 'Korean', rtl: false },
  { code: 'lv', name: 'Latvian', rtl: false },
  { code: 'lt', name: 'Lithuanian', rtl: false },
  { code: 'ms', name: 'Malay', rtl: false },
  { code: 'no', name: 'Norwegian', rtl: false },
  { code: 'fa', name: 'Persian', rtl: true },
  { code: 'pl', name: 'Polish', rtl: false },
  { code: 'pt', name: 'Portuguese', rtl: false },
  { code: 'ro', name: 'Romanian', rtl: false },
  { code: 'ru', name: 'Russian', rtl: false },
  { code: 'sr', name: 'Serbian', rtl: false },
  { code: 'sk', name: 'Slovak', rtl: false },
  { code: 'sl', name: 'Slovenian', rtl: false },
  { code: 'es', name: 'Spanish', rtl: false },
  { code: 'sw', name: 'Swahili', rtl: false },
  { code: 'sv', name: 'Swedish', rtl: false },
  { code: 'ta', name: 'Tamil', rtl: false },
  { code: 'th', name: 'Thai', rtl: false },
  { code: 'tr', name: 'Turkish', rtl: false },
  { code: 'uk', name: 'Ukrainian', rtl: false },
  { code: 'ur', name: 'Urdu', rtl: true },
  { code: 'vi', name: 'Vietnamese', rtl: false },
];

/**
 * Display name for a language code, falling back to the raw code
 */
export function getLanguageName(code: string): string {
  return (
    SUPPORTED_LANGUAGES.find((language) => language.code === code)?.name ||
    code.toUpperCase()
  );
}
