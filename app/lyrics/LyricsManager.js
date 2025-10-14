const secureFetch = require('../utils/SecureFetch');
const Logger = require('../utils/Logger');

class LyricsManager {
  constructor(cache) {
    this.cache = cache;
  }

  async fetchLyrics(title, artist) {
    const cacheKey = `${title}-${artist}`.toLowerCase();
    const startTime = Date.now();

    const cached = await this.cache.get('lyrics', cacheKey);
    if (cached) {
      Logger.lyrics.debug(`Cache hit: ${title} - ${artist}`);
      return cached;
    }

    Logger.lyrics.debug(`Fetching: ${title} - ${artist}`);

    const fetched = await this.fetchFromAPI(title, artist);
    const duration = Date.now() - startTime;

    if (fetched) {
      const hasSync = fetched.synced ? 'yes' : 'no';
      Logger.lyrics.info(`Found (${duration}ms, synced: ${hasSync}): ${title} - ${artist}`);
      this.cache.set('lyrics', cacheKey, fetched);
      return fetched;
    }

    Logger.lyrics.warn(`Not found (${duration}ms): ${title} - ${artist}`);
    const offlineCache = await this.cache.get('lyrics', cacheKey);
    return offlineCache;
  }

  async fetchFromAPI(title, artist) {
    try {
      const query = encodeURIComponent(`${title} ${artist}`);
      const url = `https://lrclib.net/api/search?q=${query}`;

      const response = await secureFetch.fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'LyricGlow/1.0'
        }
      });

      if (!response.ok) {
        Logger.lyrics.error(`API error: HTTP ${response.status}`);
        return null;
      }

      const results = await response.json();

      if (!results || results.length === 0) {
        return null;
      }

      const exactMatch = this.findBestMatch(results, title, artist);

      if (exactMatch && exactMatch.syncedLyrics) {
        return {
          synced: exactMatch.syncedLyrics,
          plain: exactMatch.plainLyrics,
          instrumental: exactMatch.instrumental
        };
      }

      return null;
    } catch (error) {
      Logger.lyrics.error('Fetch failed', error);
      return null;
    }
  }

  findBestMatch(results, title, artist) {
    const normalize = str => str.toLowerCase().replace(/[^a-z0-9]/g, '');
    const targetTitle = normalize(title);
    const targetArtist = normalize(artist);

    const exactMatch = results.find(item => {
      const itemTitle = normalize(item.trackName || item.name || '');
      const itemArtist = normalize(item.artistName || '');
      return itemTitle === targetTitle && itemArtist === targetArtist;
    });

    if (exactMatch) return exactMatch;

    const titleMatch = results.find(item => {
      const itemTitle = normalize(item.trackName || item.name || '');
      return itemTitle === targetTitle;
    });

    return titleMatch || results[0];
  }
}

module.exports = LyricsManager;
