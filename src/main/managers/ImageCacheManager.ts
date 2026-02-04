/**
 * Image Cache Manager
 *
 * Handles downloading and caching album artwork with offline fallback support.
 */

import Logger from '../../shared/utils/Logger';
import SecureFetch from '../../shared/utils/SecureFetch';
import type UnifiedCacheManager from './UnifiedCacheManager';

class ImageCacheManager {
  private cache: UnifiedCacheManager;

  constructor(cache: UnifiedCacheManager) {
    this.cache = cache;
  }

  async getImage(url: string): Promise<string | null> {
    if (!url || url === '') return null;

    // Check cache first
    const cached = await this.cache.get('images', url);
    if (cached) {
      return cached as string;
    }

    // Download if not cached
    const downloaded = await this.downloadImage(url);
    if (downloaded) {
      this.cache.set('images', url, downloaded);
      return downloaded;
    }

    // Offline fallback
    const offlineCache = await this.cache.get('images', url);
    return offlineCache as string | null;
  }

  private async downloadImage(url: string): Promise<string | null> {
    try {
      const response = await SecureFetch.fetch(url);

      if (!response.ok) {
        Logger.cache.debug(`Image download failed (${response.status})`);
        return null;
      }

      const buffer = await response.buffer();
      const base64 = `data:image/jpeg;base64,${buffer.toString('base64')}`;
      return base64;
    } catch (error) {
      Logger.cache.error('Image download error', error as Error);
      return null;
    }
  }
}

export default ImageCacheManager;
