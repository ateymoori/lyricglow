/**
 * Google web translation provider (primary)
 *
 * Uses the unofficial endpoint the Google Translate website calls. No API key,
 * no account, but it is not a documented API: it answers with a nested array
 * rather than an object, and it expects to be talked to like a browser.
 *
 * Response shape for ?dt=t:
 *   [[["translated","source",null,null,10], ["more","more source",...]], ...]
 * Segment 0 holds the chunks Google split the input into; joining chunk[0]
 * in order rebuilds the translated text including its line breaks.
 */

import Logger from '../../shared/utils/Logger';
import SecureFetch from '../../shared/utils/SecureFetch';
import type { TranslationProvider } from './TranslationProvider';

const ENDPOINT = 'https://translate.googleapis.com/translate_a/single';

// The endpoint rejects clients that do not look like a browser
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

// Everything travels in the query string, so a very long request comes back as
// 413/414. Skip those locally rather than spending a doomed round trip.
const MAX_URL_LENGTH = 5000;

/**
 * Pull the translated text out of Google's nested array response
 */
function parseTranslation(body: string): string | null {
  const payload = JSON.parse(body) as unknown;

  if (!Array.isArray(payload)) return null;

  const segments = payload[0];
  if (!Array.isArray(segments)) return null;

  const text = segments
    .map((chunk) =>
      Array.isArray(chunk) && typeof chunk[0] === 'string' ? chunk[0] : '',
    )
    .join('');

  return text.length > 0 ? text : null;
}

class GoogleWebProvider implements TranslationProvider {
  readonly name = 'google-web';

  async translateBatch(
    lines: string[],
    targetLang: string,
    timeoutMs: number,
  ): Promise<(string | null)[]> {
    if (!lines.length) return [];

    let attempts = 0;
    let firstError: string | null = null;

    const results = await Promise.all(
      lines.map(async (line) => {
        const url = this.buildUrl(line, targetLang);

        if (url.length > MAX_URL_LENGTH) {
          // Not a provider failure - the caller will split this up and retry
          Logger.lyrics.debug(
            'Google: line too long for the GET endpoint, skipping',
          );
          return null;
        }

        attempts++;

        try {
          return await this.requestLine(url, timeoutMs);
        } catch (error) {
          if (!firstError) firstError = (error as Error).message;
          return null;
        }
      }),
    );

    // Every request that went out came back empty: treat the endpoint as down
    // so the chain can fall through to the next provider
    if (attempts > 0 && results.every((result) => result === null)) {
      throw new Error(firstError ?? 'no translation returned');
    }

    return results;
  }

  private buildUrl(line: string, targetLang: string): string {
    const params = new URLSearchParams({
      client: 'gtx',
      sl: 'auto',
      tl: targetLang,
      dt: 't',
      q: line,
    });

    return `${ENDPOINT}?${params.toString()}`;
  }

  private async requestLine(
    url: string,
    timeoutMs: number,
  ): Promise<string | null> {
    const response = await SecureFetch.fetch(url, {
      method: 'GET',
      timeout: timeoutMs,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: '*/*',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return parseTranslation(await response.text());
  }
}

export default GoogleWebProvider;
