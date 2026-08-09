/**
 * Unified Cache Manager
 *
 * File-based caching system with automatic expiry and offline support.
 * Stores lyrics, metadata, and images with configurable TTL (default: 7 days).
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import Logger from '../../shared/utils/Logger';

// How long a connectivity probe result stays valid
const ONLINE_STATUS_TTL = 60 * 1000;

// Custom scheme used to serve cached files to the renderer straight from disk
export const CACHE_SCHEME = 'lyricglow-cache';

// Cache file names are hex hashes - anything else is rejected by the handler
const CACHE_FILE_NAME = /^[a-f0-9]{32}\.(jpg|json)$/;

const CACHE_TYPES = ['images', 'lyrics', 'metadata', 'translations'];

// Connectivity is judged by the lyrics API, the one service the app cannot
// work without - reaching it means "online" in any sense that matters here
const PROBE_HOST = 'lrclib.net';

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
  private onlineCheckedAt = 0;
  private onlineCheckInFlight: Promise<boolean> | null = null;
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
      ...CACHE_TYPES.map((type) => path.join(this.cacheRoot, type)),
    ];
    await Promise.all(
      dirs.map((dir) =>
        fs.promises.mkdir(dir, { recursive: true }).catch(() => {}),
      ),
    );
  }

  private async loadIndexAsync(): Promise<CacheIndex> {
    try {
      const data = await fs.promises.readFile(this.indexPath, 'utf8');
      return JSON.parse(data) as CacheIndex;
    } catch (_error) {
      return {};
    }
  }

  private async saveIndex(): Promise<void> {
    try {
      await fs.promises.writeFile(
        this.indexPath,
        JSON.stringify(this.index, null, 2),
      );
    } catch (error) {
      Logger.cache.error('Failed to save cache index', error as Error);
    }
  }

  private generateHash(key: string): string {
    return crypto
      .createHash('sha256')
      .update(key)
      .digest('hex')
      .substring(0, 32);
  }

  private getCacheFilePath(type: string, key: string): string {
    const hash = this.generateHash(key);
    const extension = type === 'images' ? 'jpg' : 'json';
    return path.join(this.cacheRoot, type, `${hash}.${extension}`);
  }

  private async isOnline(): Promise<boolean> {
    // Re-check periodically: an app started offline must notice when the
    // network comes back, otherwise it serves stale cache forever
    const isFresh =
      this.onlineStatus !== null &&
      Date.now() - this.onlineCheckedAt < ONLINE_STATUS_TTL;

    if (isFresh) {
      return this.onlineStatus as boolean;
    }

    // Collapse concurrent checks into one probe
    if (this.onlineCheckInFlight) {
      return this.onlineCheckInFlight;
    }

    this.onlineCheckInFlight = new Promise<boolean>((resolve) => {
      const settle = (online: boolean) => {
        this.onlineStatus = online;
        this.onlineCheckedAt = Date.now();
        this.onlineCheckInFlight = null;
        resolve(online);
      };

      // Probe an API host the app actually depends on, not a third party
      const req = https.request(
        {
          hostname: PROBE_HOST,
          path: '/',
          method: 'HEAD',
          timeout: 3000,
        },
        () => settle(true),
      );

      req.on('error', () => settle(false));

      req.on('timeout', () => {
        req.destroy();
        settle(false);
      });

      req.end();
    });

    return this.onlineCheckInFlight;
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

  /**
   * Read a fresh cache entry (expired entries are treated as a miss)
   */
  async get(type: string, key: string): Promise<unknown> {
    return this.read(type, key, false);
  }

  /**
   * Read an entry even if it has expired.
   *
   * Used as the offline/API-failure fallback: a stale answer beats no answer.
   * Calling get() again would just repeat the same expiry check and return null.
   */
  async getStale(type: string, key: string): Promise<unknown> {
    return this.read(type, key, true);
  }

  /**
   * URL for a cached entry, served from disk by the custom protocol handler.
   *
   * Returns null when the entry is missing (or expired, unless allowExpired).
   * Used for images so bytes never travel through IPC.
   */
  async getFileUrl(
    type: string,
    key: string,
    allowExpired = false,
  ): Promise<string | null> {
    await this.initPromise;

    const hash = this.generateHash(key);
    const entry = this.index[type]?.[hash];
    if (!entry) return null;

    const filePath = this.getCacheFilePath(type, key);

    try {
      await fs.promises.access(filePath);
    } catch {
      delete this.index[type]?.[hash];
      this.saveIndex();
      return null;
    }

    if (!allowExpired) {
      const isOnline = await this.isOnline();
      if (this.shouldRefresh(entry.timestamp, isOnline)) return null;
    }

    // Cache-bust on the stored timestamp so a refreshed file is picked up
    return `${CACHE_SCHEME}://${type}/${path.basename(filePath)}?v=${entry.timestamp}`;
  }

  /**
   * Map a custom-scheme URL back to a file inside the cache directory.
   * Rejects anything that is not a known cache type + hashed file name.
   */
  resolveCacheFile(type: string, fileName: string): string | null {
    if (!CACHE_TYPES.includes(type)) return null;
    if (!CACHE_FILE_NAME.test(fileName)) return null;

    return path.join(this.cacheRoot, type, fileName);
  }

  private async read(
    type: string,
    key: string,
    allowExpired: boolean,
  ): Promise<unknown> {
    await this.initPromise;
    if (!this.index[type]) return null;

    const hash = this.generateHash(key);
    const entry = this.index[type]?.[hash];

    if (!entry) return null;

    const filePath = this.getCacheFilePath(type, key);

    try {
      await fs.promises.access(filePath);
    } catch {
      delete this.index[type]?.[hash];
      this.saveIndex();
      return null;
    }

    if (!allowExpired) {
      const isOnline = await this.isOnline();

      if (this.shouldRefresh(entry.timestamp, isOnline)) {
        return null;
      }
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

  async set(type: string, key: string, data: unknown): Promise<boolean> {
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
        file: path.basename(filePath),
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
        const entry = this.index[type]?.[hash]!;
        const age = now - entry.timestamp;

        if (age > this.cacheExpiry) {
          const filePath = path.join(this.cacheRoot, type, entry.file);
          try {
            await fs.promises.unlink(filePath);
            delete this.index[type]?.[hash];
            clearedCount++;
          } catch (error: unknown) {
            if (
              error instanceof Error &&
              (error as NodeJS.ErrnoException).code !== 'ENOENT'
            ) {
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
      newestEntry: null,
    };

    Object.keys(this.index).forEach((type) => {
      const entries = Object.values(this.index[type]!);
      stats.types[type] = entries.length;
      stats.total += entries.length;

      entries.forEach((entry) => {
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
        const entry = this.index[type]?.[hash]!;
        const filePath = path.join(this.cacheRoot, type, entry.file);
        try {
          await fs.promises.unlink(filePath);
        } catch (error: unknown) {
          if (
            error instanceof Error &&
            (error as NodeJS.ErrnoException).code !== 'ENOENT'
          ) {
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
    Object.keys(this.index).forEach((type) => {
      Object.keys(this.index[type]!).forEach((hash) => {
        const entry = this.index[type]?.[hash]!;
        entries.push({
          type,
          key: entry.key,
          timestamp: entry.timestamp,
          file: entry.file,
          hash,
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
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        (error as NodeJS.ErrnoException).code !== 'ENOENT'
      ) {
        Logger.cache.error('Failed to get file size', error);
      }
      return 0;
    }
  }

  async deleteOne(type: string, key: string): Promise<boolean> {
    await this.initPromise;
    const hash = this.generateHash(key);
    if (!this.index[type] || !this.index[type]?.[hash]) {
      return false;
    }

    const filePath = this.getCacheFilePath(type, key);
    try {
      await fs.promises.unlink(filePath);
      delete this.index[type]?.[hash];
      await this.saveIndex();
      return true;
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        (error as NodeJS.ErrnoException).code !== 'ENOENT'
      ) {
        Logger.cache.error('Failed to delete cache entry', error);
      }
      return false;
    }
  }
}

export default UnifiedCacheManager;
