const https = require('https');
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
    return new Promise((resolve) => {
      https.get(url, (response) => {
        if (response.statusCode !== 200) {
          Logger.cache.debug(`Image download failed (${response.statusCode})`);
          resolve(null);
          return;
        }

        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));

        response.on('end', () => {
          const buffer = Buffer.concat(chunks);
          const base64 = `data:image/jpeg;base64,${buffer.toString('base64')}`;
          resolve(base64);
        });
      }).on('error', (error) => {
        Logger.cache.error('Image download error', error);
        resolve(null);
      });
    });
  }
}

module.exports = ImageCacheManager;