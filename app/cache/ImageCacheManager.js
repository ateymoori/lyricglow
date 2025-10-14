const secureFetch = require('../utils/SecureFetch');
const Logger = require('../utils/Logger');

class ImageCacheManager {
  constructor(cache) {
    this.cache = cache;
  }

  async getImage(url) {
    if (!url || url === '') return null;

    const cached = await this.cache.get('images', url);
    if (cached) {
      return cached;
    }

    const downloaded = await this.downloadImage(url);
    if (downloaded) {
      this.cache.set('images', url, downloaded);
      return downloaded;
    }

    const offlineCache = await this.cache.get('images', url);
    return offlineCache;
  }

  async downloadImage(url) {
    try {
      const response = await secureFetch.fetch(url);

      if (!response.ok) {
        Logger.cache.debug(`Image download failed (${response.status})`);
        return null;
      }

      const buffer = await response.buffer();
      const base64 = `data:image/jpeg;base64,${buffer.toString('base64')}`;
      return base64;
    } catch (error) {
      Logger.cache.error('Image download error', error);
      return null;
    }
  }
}

module.exports = ImageCacheManager;