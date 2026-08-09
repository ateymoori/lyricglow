/**
 * Translation Manager
 *
 * Handles lyrics translation using Lingva Translate API.
 * Features: Batch translation, caching, fallback instances, RTL detection.
 */

import https from 'node:https';
import {
  type Language,
  SUPPORTED_LANGUAGES,
} from '../../shared/constants/languages';
import Logger from '../../shared/utils/Logger';
import type UnifiedCacheManager from './UnifiedCacheManager';

// Lingva public instances (fallback support)
const LINGVA_INSTANCES = [
  'lingva.ml',
  'translate.plausibility.cloud',
  'lingva.lunar.icu',
  'translate.projectsegfau.lt',
];

// Give up on the per-line fallback once the service keeps failing
const MAX_LINE_FAILURES = 5;

// Lines translated concurrently in the per-line fallback
const LINE_CHUNK_SIZE = 4;

// Language list lives in shared/ so the renderer can use the same data
export { SUPPORTED_LANGUAGES };

interface TranslationResult {
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
    cacheKey: string,
  ): Promise<TranslationResult | null> {
    if (!lines.length || !targetLang) return null;

    // Check cache first
    const cached = await this.cache.get(
      'translations',
      `${cacheKey}:${targetLang}`,
    );
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

    const startTime = Date.now();
    const translatedParts = await this.translateLines(
      nonEmptyLines.map((l) => l.text),
      targetLang,
    );
    const duration = Date.now() - startTime;

    if (!translatedParts) {
      Logger.lyrics.warn(`Translation failed (${duration}ms): ${cacheKey}`);
      return null;
    }

    Logger.lyrics.info(
      `Translation done (${duration}ms): ${cacheKey} → ${targetLang}`,
    );

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
      isTargetRTL,
    };

    // Cache the result
    this.cache.set('translations', `${cacheKey}:${targetLang}`, result);

    return result;
  }

  /**
   * Translate a list of lines, returning exactly one result per input line.
   *
   * Fast path is a single batched request. The batch is only trusted when the
   * response splits back into the same number of parts - a translator that
   * drops, merges or adds a separator would otherwise shift every following
   * line by one. Anything else falls back to one request per line.
   */
  private async translateLines(
    lines: string[],
    targetLang: string,
  ): Promise<string[] | null> {
    const separator = '\n\n';
    const batch = await this.translateWithFallback(
      lines.join(separator),
      targetLang,
    );

    if (batch) {
      const parts = batch.split(separator);
      if (parts.length === lines.length) {
        return parts;
      }
      Logger.lyrics.warn(
        `Batch translation returned ${parts.length} of ${lines.length} lines, retrying per line`,
      );
    }

    return this.translateEachLine(lines, targetLang);
  }

  /**
   * Translate one line per request - always index-accurate.
   *
   * Runs in small parallel chunks: a whole song one-at-a-time would take far
   * too long, and firing every line at once would hammer a public instance.
   */
  private async translateEachLine(
    lines: string[],
    targetLang: string,
  ): Promise<string[] | null> {
    const translated: string[] = new Array(lines.length).fill('');
    let failures = 0;
    let successes = 0;

    for (let start = 0; start < lines.length; start += LINE_CHUNK_SIZE) {
      const chunk = lines.slice(start, start + LINE_CHUNK_SIZE);

      const results = await Promise.all(
        chunk.map((line) => this.translateWithFallback(line, targetLang)),
      );

      results.forEach((result, offset) => {
        if (result === null) {
          failures++; // Slot stays empty so later lines keep their index
        } else {
          successes++;
          translated[start + offset] = result;
        }
      });

      if (failures > MAX_LINE_FAILURES) {
        Logger.lyrics.warn('Per-line translation aborted: too many failures');
        return null;
      }
    }

    // Nothing came back: report failure instead of caching blank translations
    if (successes === 0) return null;

    return translated;
  }

  /**
   * Translate text using Lingva API with fallback instances
   */
  private async translateWithFallback(
    text: string,
    targetLang: string,
  ): Promise<string | null> {
    const maxRetries = LINGVA_INSTANCES.length;

    for (let i = 0; i < maxRetries; i++) {
      const instanceIndex =
        (this.currentInstance + i) % LINGVA_INSTANCES.length;
      const instance = LINGVA_INSTANCES[instanceIndex];

      if (!instance) continue;

      const result = await this.lingvaRequest(instance, text, targetLang);

      if (result) {
        // Update current instance to the working one
        this.currentInstance = instanceIndex;
        return result;
      }

      Logger.lyrics.debug(
        `Lingva instance failed: ${instance}, trying next...`,
      );
    }

    return null;
  }

  /**
   * Make request to Lingva API
   */
  private lingvaRequest(
    instance: string,
    text: string,
    targetLang: string,
  ): Promise<string | null> {
    return new Promise((resolve) => {
      const encodedText = encodeURIComponent(text);
      const path = `/api/v1/auto/${targetLang}/${encodedText}`;

      const options: https.RequestOptions = {
        hostname: instance,
        path,
        method: 'GET',
        timeout: 15000,
        headers: {
          'User-Agent': 'LyricGlow/1.0',
        },
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
  getSupportedLanguages(): Language[] {
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
