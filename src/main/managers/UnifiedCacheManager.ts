/**
 * Unified Cache Manager
 *
 * File-based caching system with automatic expiry and offline support.
 * Stores lyrics, metadata, and images with configurable TTL (default: 7 days).
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import https from 'https';
import Logger from '../../shared/utils/Logger';

interface CacheConfig {
  CACHE_DURATION_HOURS?: number;
}

interface CacheEntry {
  key: string;
  timestamp: number;
  file: string;
}

interface CacheIndex {
  [type: string]: {
    [hash: string]: CacheEntry;
  };
}

interface CacheStats {
  types: { [type: string]: number };
  total: number;
  oldestEntry: number | null;
  newestEntry: number | null;
}

interface CacheListEntry {
  type: string;
  key: string;
  timestamp: number;
  file: string;
  hash: string;
}

class UnifiedCacheManager {
  private cacheRoot: string;
  private indexPath: string;
  private cacheExpiry: number;
  private index: CacheIndex = {};
  private onlineStatus: boolean | null = null;
  private initPromise: Promise<void>;

  constructor(config: CacheConfig = {}, cachePath: string | null = null) {
    this.cacheRoot = cachePath || path.join(__dirname, '../../../.cache');
    this.indexPath = path.join(this.cacheRoot, 'index.json');
    this.cacheExpiry = (config.CACHE_DURATION_HOURS || 168) * 60 * 60 * 1000;
    this.initPromise = this.init();
  }

  private async init(): Promise<void> {
    try {
      await this.ensureCacheDirectoriesAsync();
      this.index = await this.loadIndexAsync();
    } catch (error) {
      Logger.cache.error('Cache initialization failed', error as Error);
    }
  }

  private async ensureCacheDirectoriesAsync(): Promise<void> {
    const dirs = [
      this.cacheRoot,
      path.join(this.cacheRoot, 'images'),
      path.join(this.cacheRoot, 'lyrics'),
      path.join(this.cacheRoot, 'metadata')
    ];
    await Promise.all(
      dirs.map(dir => fs.promises.mkdir(dir, { recursive: true }).catch(() => {}))
    );
  }

  private async loadIndexAsync(): Promise<CacheIndex> {
    try {
      const data = await fs.promises.readFile(this.indexPath, 'utf8');
      return JSON.parse(data) as CacheIndex;
    } catch (error) {
      return {};
    }
  }

  private async saveIndex(): Promise<void> {
    try {
      await fs.promises.writeFile(this.indexPath, JSON.stringify(this.index, null, 2));
    } catch (error) {
      Logger.cache.error('Failed to save cache index', error as Error);
    }
  }

  private generateHash(key: string): string {
    return crypto.createHash('sha256').update(key).digest('hex').substring(0, 32);
  }

  private getCacheFilePath(type: string, key: string): string {
    const hash = this.generateHash(key);
    const extension = type === 'images' ? 'jpg' : 'json';
    return path.join(this.cacheRoot, type, `${hash}.${extension}`);
  }

  private async isOnline(): Promise<boolean> {
    if (this.onlineStatus !== null) {
      return this.onlineStatus;
    }

    return new Promise((resolve) => {
      const req = https.request({
        hostname: 'www.google.com',
        path: '/',
        method: 'HEAD',
        timeout: 3000
      }, () => {
        this.onlineStatus = true;
        resolve(true);
      });

      req.on('error', () => {
        this.onlineStatus = false;
        resolve(false);
      });

      req.on('timeout', () => {
        req.destroy();
        this.onlineStatus = false;
        resolve(false);
      });

      req.end();
    });
  }

  private shouldRefresh(timestamp: number, isOnline: boolean): boolean {
    if (!isOnline) return false;
    const age = Date.now() - timestamp;
    return age > this.cacheExpiry;
  }

  async has(type: string, key: string): Promise<boolean> {
    await this.initPromise;
    if (!this.index[type]) return false;
    const hash = this.generateHash(key);
    return !!this.index[type]?.[hash];
  }

  async get(type: string, key: string): Promise<any> {
    await this.initPromise;
    if (!this.index[type]) return null;

    const hash = this.generateHash(key);
    const entry = this.index[type]?.[hash];

    if (!entry) return null;

    const filePath = this.getCacheFilePath(type, key);

    try {
      await fs.promises.access(filePath);
    } catch {
      delete this.index[type]![hash];
      this.saveIndex();
      return null;
    }

    const isOnline = await this.isOnline();

    if (this.shouldRefresh(entry.timestamp, isOnline)) {
      return null;
    }

    try {
      if (type === 'images') {
        const buffer = await fs.promises.readFile(filePath);
        return `data:image/jpeg;base64,${buffer.toString('base64')}`;
      } else {
        const content = await fs.promises.readFile(filePath, 'utf8');
        return JSON.parse(content);
      }
    } catch (error) {
      Logger.cache.error(`Read failed for ${type}/${key}`, error as Error);
      return null;
    }
  }

  async set(type: string, key: string, data: any): Promise<boolean> {
    await this.initPromise;
    if (!data) return false;

    try {
      const hash = this.generateHash(key);
      const filePath = this.getCacheFilePath(type, key);

      if (type === 'images') {
        if (typeof data === 'string' && data.startsWith('data:image')) {
          const base64Data = data.split(',')[1];
          const buffer = Buffer.from(base64Data!, 'base64');
          await fs.promises.writeFile(filePath, buffer);
        } else if (Buffer.isBuffer(data)) {
          await fs.promises.writeFile(filePath, data);
        } else {
          return false;
        }
      } else {
        await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2));
      }

      if (!this.index[type]) {
        this.index[type] = {};
      }

      this.index[type]![hash] = {
        key: key,
        timestamp: Date.now(),
        file: path.basename(filePath)
      };

      this.saveIndex();
      return true;
    } catch (error) {
      Logger.cache.error(`Write failed for ${type}/${key}`, error as Error);
      return false;
    }
  }

  async clearExpired(): Promise<void> {
    await this.initPromise;
    const isOnline = await this.isOnline();
    if (!isOnline) return;

    let clearedCount = 0;
    const now = Date.now();

    for (const type of Object.keys(this.index)) {
      for (const hash of Object.keys(this.index[type]!)) {
        const entry = this.index[type]![hash]!;
        const age = now - entry.timestamp;

        if (age > this.cacheExpiry) {
          const filePath = path.join(this.cacheRoot, type, entry.file);
          try {
            await fs.promises.unlink(filePath);
            delete this.index[type]![hash];
            clearedCount++;
          } catch (error: any) {
            if (error.code !== 'ENOENT') {
              Logger.cache.error('Failed to delete expired cache file', error);
            }
          }
        }
      }
    }

    if (clearedCount > 0) {
      await this.saveIndex();
      Logger.cache.info(`Cleared ${clearedCount} expired cache entries`);
    }
  }

  getStats(): CacheStats {
    const stats: CacheStats = {
      types: {},
      total: 0,
      oldestEntry: null,
      newestEntry: null
    };

    Object.keys(this.index).forEach(type => {
      const entries = Object.values(this.index[type]!);
      stats.types[type] = entries.length;
      stats.total += entries.length;

      entries.forEach(entry => {
        if (!stats.oldestEntry || entry.timestamp < stats.oldestEntry) {
          stats.oldestEntry = entry.timestamp;
        }
        if (!stats.newestEntry || entry.timestamp > stats.newestEntry) {
          stats.newestEntry = entry.timestamp;
        }
      });
    });

    return stats;
  }

  async clearAll(): Promise<void> {
    await this.initPromise;
    for (const type of Object.keys(this.index)) {
      for (const hash of Object.keys(this.index[type]!)) {
        const entry = this.index[type]![hash]!;
        const filePath = path.join(this.cacheRoot, type, entry.file);
        try {
          await fs.promises.unlink(filePath);
        } catch (error: any) {
          if (error.code !== 'ENOENT') {
            Logger.cache.error('Failed to delete cache file', error);
          }
        }
      }
    }

    this.index = {};
    await this.saveIndex();
    Logger.cache.info('Cache cleared completely');
  }

  listAllEntries(): CacheListEntry[] {
    const entries: CacheListEntry[] = [];
    Object.keys(this.index).forEach(type => {
      Object.keys(this.index[type]!).forEach(hash => {
        const entry = this.index[type]![hash]!;
        entries.push({
          type,
          key: entry.key,
          timestamp: entry.timestamp,
          file: entry.file,
          hash
        });
      });
    });
    return entries;
  }

  async getEntrySize(type: string, key: string): Promise<number> {
    const filePath = this.getCacheFilePath(type, key);
    try {
      const stats = await fs.promises.stat(filePath);
      return stats.size;
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        Logger.cache.error('Failed to get file size', error);
      }
      return 0;
    }
  }

  async deleteOne(type: string, key: string): Promise<boolean> {
    await this.initPromise;
    const hash = this.generateHash(key);
    if (!this.index[type] || !this.index[type]![hash]) {
      return false;
    }

    const filePath = this.getCacheFilePath(type, key);
    try {
      await fs.promises.unlink(filePath);
      delete this.index[type]![hash];
      await this.saveIndex();
      return true;
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        Logger.cache.error('Failed to delete cache entry', error);
      }
      return false;
    }
  }
}

export default UnifiedCacheManager;
