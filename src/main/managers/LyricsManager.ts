/**
 * Lyrics Manager
 *
 * Handles fetching and caching synchronized lyrics from LRCLIB API.
 * Implements smart caching with offline fallback support.
 */

import Logger from '../../shared/utils/Logger';
import SecureFetch from '../../shared/utils/SecureFetch';

// Lyrics data structure
interface LyricsData {
  synced: string | null;
  plain: string | null;
  instrumental: boolean;
}

// LRCLIB API response structure
interface LRCLibResult {
  trackName?: string;
  name?: string;
  artistName?: string;
  syncedLyrics?: string;
  plainLyrics?: string;
  instrumental?: boolean;
}

// Cache interface matching UnifiedCacheManager
interface CacheManager {
  get(type: string, key: string): Promise<unknown>;
  set(type: string, key: string, value: unknown): Promise<boolean>;
}

class LyricsManager {
  private cache: CacheManager;

  constructor(cache: CacheManager) {
    this.cache = cache;
  }

  async fetchLyrics(title: string, artist: string): Promise<LyricsData | null> {
    const cacheKey = `${title}-${artist}`.toLowerCase();
    const startTime = Date.now();

    // Check cache first
    const cached = await this.cache.get('lyrics', cacheKey);
    if (cached) {
      Logger.lyrics.debug(`Cache hit: ${title} - ${artist}`);
      return cached;
    }

    Logger.lyrics.debug(`Fetching: ${title} - ${artist}`);

    // Fetch from API
    const fetched = await this.fetchFromAPI(title, artist);
    const duration = Date.now() - startTime;

    if (fetched) {
      const hasSync = fetched.synced ? 'yes' : 'no';
      Logger.lyrics.info(
        `Found (${duration}ms, synced: ${hasSync}): ${title} - ${artist}`,
      );
      this.cache.set('lyrics', cacheKey, fetched);
      return fetched;
    }

    Logger.lyrics.warn(`Not found (${duration}ms): ${title} - ${artist}`);

    // Offline fallback
    const offlineCache = await this.cache.get('lyrics', cacheKey);
    return offlineCache;
  }

  private async fetchFromAPI(
    title: string,
    artist: string,
  ): Promise<LyricsData | null> {
    try {
      const query = encodeURIComponent(`${title} ${artist}`);
      const url = `https://lrclib.net/api/search?q=${query}`;

      const response = await SecureFetch.fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'LyricGlow/1.0',
        },
      });

      if (!response.ok) {
        Logger.lyrics.error(`API error: HTTP ${response.status}`);
        return null;
      }

      const results = (await response.json()) as LRCLibResult[];

      if (!results || results.length === 0) {
        return null;
      }

      const exactMatch = this.findBestMatch(results, title, artist);

      if (exactMatch?.syncedLyrics) {
        return {
          synced: exactMatch.syncedLyrics,
          plain: exactMatch.plainLyrics || null,
          instrumental: exactMatch.instrumental || false,
        };
      }

      return null;
    } catch (error) {
      Logger.lyrics.error('Fetch failed', error as Error);
      return null;
    }
  }

  private findBestMatch(
    results: LRCLibResult[],
    title: string,
    artist: string,
  ): LRCLibResult | null {
    const normalize = (str: string): string =>
      str.toLowerCase().replace(/[^a-z0-9]/g, '');
    const targetTitle = normalize(title);
    const targetArtist = normalize(artist);

    // Try exact match
    const exactMatch = results.find((item) => {
      const itemTitle = normalize(item.trackName || item.name || '');
      const itemArtist = normalize(item.artistName || '');
      return itemTitle === targetTitle && itemArtist === targetArtist;
    });

    if (exactMatch) return exactMatch;

    // Try title-only match
    const titleMatch = results.find((item) => {
      const itemTitle = normalize(item.trackName || item.name || '');
      return itemTitle === targetTitle;
    });

    return titleMatch || results[0] || null;
  }
}

export default LyricsManager;
