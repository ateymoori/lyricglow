/**
 * Translation Manager
 *
 * Owns the translation strategy - caching, batching, index alignment and the
 * per-line retry - and leaves the actual network calls to the provider chain.
 * Which service does the translating is decided in main/translation/index.ts.
 */

import {
  type Language,
  SUPPORTED_LANGUAGES,
} from '../../shared/constants/languages';
import Logger from '../../shared/utils/Logger';
import { createProviderChain, type ProviderChain } from '../translation';
import type UnifiedCacheManager from './UnifiedCacheManager';

// Give up on the per-line fallback once the service keeps failing
const MAX_LINE_FAILURES = 5;

// Lines translated concurrently in the per-line fallback
const LINE_CHUNK_SIZE = 4;

// Budget for a single translation request
const REQUEST_TIMEOUT_MS = 15000;

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
  private providers: ProviderChain;

  constructor(cache: UnifiedCacheManager, providers?: ProviderChain) {
    this.cache = cache;
    this.providers = providers ?? createProviderChain();
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
    const [batch] = await this.request([lines.join(separator)], targetLang);

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

      const results = await this.request(chunk, targetLang);

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
   * Hand a set of lines to the provider chain.
   *
   * A chain-level throw means no provider is usable right now; that is not an
   * error the caller can act on, so it becomes an all-null result and the usual
   * "nothing translated" path takes over.
   */
  private async request(
    lines: string[],
    targetLang: string,
  ): Promise<(string | null)[]> {
    try {
      return await this.providers.translateBatch(
        lines,
        targetLang,
        REQUEST_TIMEOUT_MS,
      );
    } catch (error) {
      Logger.lyrics.debug(
        `Translation request failed: ${(error as Error).message}`,
      );
      return lines.map(() => null);
    }
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
