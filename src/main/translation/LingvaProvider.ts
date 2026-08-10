/**
 * Lingva Translate provider (fallback)
 *
 * Lifted out of TranslationManager unchanged: the same public instance list,
 * the same rotation that sticks to whichever instance answered last, and the
 * same request handling. Public Lingva instances come and go, which is exactly
 * why it now sits behind GoogleWebProvider instead of being the only option.
 */

import https from 'node:https';
import Logger from '../../shared/utils/Logger';
import type { TranslationProvider } from './TranslationProvider';

// Lingva public instances (rotation order)
const LINGVA_INSTANCES = [
  'lingva.ml',
  'translate.plausibility.cloud',
  'lingva.lunar.icu',
  'translate.projectsegfau.lt',
];

class LingvaProvider implements TranslationProvider {
  readonly name = 'lingva';

  private currentInstance = 0;

  async translateBatch(
    lines: string[],
    targetLang: string,
    timeoutMs: number,
  ): Promise<(string | null)[]> {
    if (!lines.length) return [];

    const results = await Promise.all(
      lines.map((line) =>
        this.translateWithFallback(line, targetLang, timeoutMs),
      ),
    );

    // No instance produced anything: report the provider as unusable
    if (results.every((result) => result === null)) {
      throw new Error('every Lingva instance failed');
    }

    return results;
  }

  /**
   * Try each instance in turn, starting from the last one that worked
   */
  private async translateWithFallback(
    text: string,
    targetLang: string,
    timeoutMs: number,
  ): Promise<string | null> {
    const maxRetries = LINGVA_INSTANCES.length;

    for (let i = 0; i < maxRetries; i++) {
      const instanceIndex =
        (this.currentInstance + i) % LINGVA_INSTANCES.length;
      const instance = LINGVA_INSTANCES[instanceIndex];

      if (!instance) continue;

      const result = await this.lingvaRequest(
        instance,
        text,
        targetLang,
        timeoutMs,
      );

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
    timeoutMs: number,
  ): Promise<string | null> {
    return new Promise((resolve) => {
      const encodedText = encodeURIComponent(text);
      const path = `/api/v1/auto/${targetLang}/${encodedText}`;

      const options: https.RequestOptions = {
        hostname: instance,
        path,
        method: 'GET',
        timeout: timeoutMs,
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
}

export default LingvaProvider;
