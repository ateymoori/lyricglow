/**
 * Image Cache Manager
 *
 * Downloads artwork into the cache directory and hands the renderer a
 * lyricglow-cache:// URL for it. The bytes stay on disk and are streamed by the
 * protocol handler instead of being base64-encoded through IPC.
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

    // Already cached and fresh
    const cached = await this.cache.getFileUrl('images', url);
    if (cached) return cached;

    // Download if not cached
    const downloaded = await this.downloadImage(url);
    if (downloaded) {
      await this.cache.set('images', url, downloaded);
      return this.cache.getFileUrl('images', url, true);
    }

    // Offline fallback: an expired copy still beats a missing image
    return this.cache.getFileUrl('images', url, true);
  }

  private async downloadImage(url: string): Promise<Buffer | null> {
    try {
      const response = await SecureFetch.fetch(url);

      if (!response.ok) {
        Logger.cache.debug(`Image download failed (${response.status})`);
        return null;
      }

      return await response.buffer();
    } catch (error) {
      Logger.cache.error('Image download error', error as Error);
      return null;
    }
  }
}

export default ImageCacheManager;
