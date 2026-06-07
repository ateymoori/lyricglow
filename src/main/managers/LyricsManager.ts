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
  private readonly memoryCache = new Map<string, LyricsData>();
  private readonly MAX_MEMORY_CACHE = 20;

  constructor(cache: CacheManager) {
    this.cache = cache;
  }

  private setMemoryCache(key: string, value: LyricsData): void {
    if (this.memoryCache.size >= this.MAX_MEMORY_CACHE) {
      const firstKey = this.memoryCache.keys().next().value;
      if (firstKey !== undefined) this.memoryCache.delete(firstKey);
    }
    this.memoryCache.set(key, value);
  }

  async fetchLyrics(title: string, artist: string): Promise<LyricsData | null> {
    const cacheKey = `${title}-${artist}`.toLowerCase();
    const startTime = Date.now();

    const memoryCached = this.memoryCache.get(cacheKey);
    if (memoryCached) {
      Logger.lyrics.debug(`Memory cache hit: ${title} - ${artist}`);
      return memoryCached;
    }

    // Check cache first
    const cached = (await this.cache.get(
      'lyrics',
      cacheKey,
    )) as LyricsData | null;
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
      this.setMemoryCache(cacheKey, fetched);
      return fetched;
    }

    Logger.lyrics.warn(`Not found (${duration}ms): ${title} - ${artist}`);

    // Offline fallback
    const offlineCache = (await this.cache.get(
      'lyrics',
      cacheKey,
    )) as LyricsData | null;
    return offlineCache;
  }

  private async fetchFromAPI(
    title: string,
    artist: string,
    retryCount = 0,
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
        if (retryCount === 0) {
          Logger.lyrics.debug(
            `Empty result, retrying in 1.5s: ${title} - ${artist}`,
          );
          await new Promise<void>((resolve) => setTimeout(resolve, 1500));
          return this.fetchFromAPI(title, artist, 1);
        }
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
