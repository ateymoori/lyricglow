const https = require('https');

class LyricsManager {
  constructor(cache) {
    this.cache = cache;
  }

  async fetchLyrics(title, artist) {
    const cacheKey = `${title}-${artist}`.toLowerCase();

    const cached = await this.cache.get('lyrics', cacheKey);
    if (cached) {
      return cached;
    }

    const fetched = await this.fetchFromAPI(title, artist);
    if (fetched) {
      this.cache.set('lyrics', cacheKey, fetched);
      return fetched;
    }

    const offlineCache = await this.cache.get('lyrics', cacheKey);
    return offlineCache;
  }

  async fetchFromAPI(title, artist) {
    return new Promise((resolve) => {
      const query = encodeURIComponent(`${title} ${artist}`);
      const url = `https://lrclib.net/api/search?q=${query}`;

      https.get(url, (response) => {
        let data = '';

        response.on('data', (chunk) => {
          data += chunk;
        });

        response.on('end', () => {
          try {
            const results = JSON.parse(data);

            if (!results || results.length === 0) {
              resolve(null);
              return;
            }

            const exactMatch = this.findBestMatch(results, title, artist);

            if (exactMatch && exactMatch.syncedLyrics) {
              resolve({
                synced: exactMatch.syncedLyrics,
                plain: exactMatch.plainLyrics,
                instrumental: exactMatch.instrumental
              });
            } else {
              resolve(null);
            }
          } catch (error) {
            resolve(null);
          }
        });

        response.on('error', () => {
          resolve(null);
        });
      }).on('error', () => {
        resolve(null);
      });
    });
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