/**
 * Translation Manager
 *
 * Handles lyrics translation using Lingva Translate API.
 * Features: Batch translation, caching, fallback instances, RTL detection.
 */

import https from 'https';
import Logger from '../../shared/utils/Logger';
import type UnifiedCacheManager from './UnifiedCacheManager';

// Lingva public instances (fallback support)
const LINGVA_INSTANCES = [
  'lingva.ml',
  'translate.plausibility.cloud',
  'lingva.lunar.icu',
  'translate.projectsegfau.lt'
];

// Supported languages with display names (40 most popular, sorted alphabetically)
export const SUPPORTED_LANGUAGES: { code: string; name: string; rtl: boolean }[] = [
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
  { code: 'vi', name: 'Vietnamese', rtl: false }
];

export interface TranslationResult {
  original: string[];
  translated: string[];
  targetLang: string;
  isTargetRTL: boolean;
}

class TranslationManager {
  private cache: UnifiedCacheManager;
  private currentInstance: number;

  constructor(cache: UnifiedCacheManager) {
    this.cache = cache;
    this.currentInstance = 0;
  }

  /**
   * Translate an array of lyrics lines (batch translation)
   * Uses double newline separator to preserve line structure
   */
  async translateBatch(
    lines: string[],
    targetLang: string,
    cacheKey: string
  ): Promise<TranslationResult | null> {
    if (!lines.length || !targetLang) return null;

    // Check cache first
    const cached = await this.cache.get('translations', `${cacheKey}:${targetLang}`);
    if (cached) {
      Logger.lyrics.debug(`Translation cache hit: ${cacheKey}`);
      return cached as TranslationResult;
    }

    // Filter out empty lines for translation but keep track of indices
    const nonEmptyLines: { index: number; text: string }[] = [];
    lines.forEach((text, index) => {
      if (text.trim()) {
        nonEmptyLines.push({ index, text });
      }
    });

    if (!nonEmptyLines.length) return null;

    // Join non-empty lines with separator
    const separator = '\n\n';
    const batchText = nonEmptyLines.map((l) => l.text).join(separator);

    // Translate batch
    const startTime = Date.now();
    const translatedBatch = await this.translateWithFallback(batchText, targetLang);
    const duration = Date.now() - startTime;

    if (!translatedBatch) {
      Logger.lyrics.warn(`Translation failed (${duration}ms): ${cacheKey}`);
      return null;
    }

    Logger.lyrics.info(`Translation done (${duration}ms): ${cacheKey} → ${targetLang}`);

    // Split translated text back into lines
    const translatedParts = translatedBatch.split(separator);

    // Rebuild full array with empty lines preserved
    const translated: string[] = new Array(lines.length).fill('');
    nonEmptyLines.forEach((item, i) => {
      translated[item.index] = translatedParts[i]?.trim() || '';
    });

    // Get target language RTL status
    const langInfo = SUPPORTED_LANGUAGES.find((l) => l.code === targetLang);
    const isTargetRTL = langInfo?.rtl || false;

    const result: TranslationResult = {
      original: lines,
      translated,
      targetLang,
      isTargetRTL
    };

    // Cache the result
    this.cache.set('translations', `${cacheKey}:${targetLang}`, result);

    return result;
  }

  /**
   * Translate text using Lingva API with fallback instances
   */
  private async translateWithFallback(text: string, targetLang: string): Promise<string | null> {
    const maxRetries = LINGVA_INSTANCES.length;

    for (let i = 0; i < maxRetries; i++) {
      const instanceIndex = (this.currentInstance + i) % LINGVA_INSTANCES.length;
      const instance = LINGVA_INSTANCES[instanceIndex];

      if (!instance) continue;

      const result = await this.lingvaRequest(instance, text, targetLang);

      if (result) {
        // Update current instance to the working one
        this.currentInstance = instanceIndex;
        return result;
      }

      Logger.lyrics.debug(`Lingva instance failed: ${instance}, trying next...`);
    }

    return null;
  }

  /**
   * Make request to Lingva API
   */
  private lingvaRequest(instance: string, text: string, targetLang: string): Promise<string | null> {
    return new Promise((resolve) => {
      const encodedText = encodeURIComponent(text);
      const path = `/api/v1/auto/${targetLang}/${encodedText}`;

      const options: https.RequestOptions = {
        hostname: instance,
        path,
        method: 'GET',
        timeout: 15000,
        headers: {
          'User-Agent': 'LyricGlow/1.0'
        }
      };

      const req = https.request(options, (res) => {
        // Set encoding to UTF-8 to properly handle unicode characters
        res.setEncoding('utf8');
        let data = '';

        res.on('data', (chunk: string) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const json = JSON.parse(data) as { translation?: string };
            if (json.translation) {
              resolve(json.translation);
            } else {
              resolve(null);
            }
          } catch {
            resolve(null);
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });

      req.on('error', () => {
        resolve(null);
      });

      req.end();
    });
  }

  /**
   * Get list of supported languages
   */
  getSupportedLanguages(): { code: string; name: string; rtl: boolean }[] {
    return SUPPORTED_LANGUAGES;
  }

  /**
   * Check if a language code is RTL
   */
  isRTL(langCode: string): boolean {
    const lang = SUPPORTED_LANGUAGES.find((l) => l.code === langCode);
    return lang?.rtl || false;
  }
}

export default TranslationManager;
