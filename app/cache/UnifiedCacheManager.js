const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Logger = require('../utils/Logger');

class UnifiedCacheManager {
  constructor(config = {}, cachePath = null) {
    this.cacheRoot = cachePath || path.join(__dirname, '../../.cache');
    this.indexPath = path.join(this.cacheRoot, 'index.json');
    this.cacheExpiry = (config.CACHE_DURATION_HOURS || 168) * 60 * 60 * 1000;
    this.index = this.loadIndex();
    this.onlineStatus = null;
    this.ensureCacheDirectories();
  }

  ensureCacheDirectories() {
    const dirs = [
      this.cacheRoot,
      path.join(this.cacheRoot, 'images'),
      path.join(this.cacheRoot, 'lyrics'),
      path.join(this.cacheRoot, 'metadata')
    ];
    dirs.forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  loadIndex() {
    if (fs.existsSync(this.indexPath)) {
      try {
        return JSON.parse(fs.readFileSync(this.indexPath, 'utf8'));
      } catch (error) {
        return {};
      }
    }
    return {};
  }

  saveIndex() {
    try {
      fs.writeFileSync(this.indexPath, JSON.stringify(this.index, null, 2));
    } catch (error) {
      Logger.cache.error('Failed to save cache index', error);
    }
  }

  generateHash(key) {
    return crypto.createHash('sha256').update(key).digest('hex').substring(0, 32);
  }

  getCacheFilePath(type, key) {
    const hash = this.generateHash(key);
    const extension = type === 'images' ? 'jpg' : 'json';
    return path.join(this.cacheRoot, type, `${hash}.${extension}`);
  }

  async isOnline() {
    if (this.onlineStatus !== null) {
      return this.onlineStatus;
    }

    return new Promise((resolve) => {
      const https = require('https');
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

  shouldRefresh(timestamp, isOnline) {
    if (!isOnline) return false;
    const age = Date.now() - timestamp;
    return age > this.cacheExpiry;
  }

  has(type, key) {
    if (!this.index[type]) return false;
    const hash = this.generateHash(key);
    return !!this.index[type][hash];
  }

  async get(type, key) {
    if (!this.index[type]) return null;

    const hash = this.generateHash(key);
    const entry = this.index[type][hash];

    if (!entry) return null;

    const filePath = this.getCacheFilePath(type, key);
    if (!fs.existsSync(filePath)) {
      delete this.index[type][hash];
      this.saveIndex();
      return null;
    }

    const isOnline = await this.isOnline();

    if (this.shouldRefresh(entry.timestamp, isOnline)) {
      return null;
    }

    try {
      if (type === 'images') {
        const buffer = fs.readFileSync(filePath);
        return `data:image/jpeg;base64,${buffer.toString('base64')}`;
      } else {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
      }
    } catch (error) {
      Logger.cache.error(`Read failed for ${type}/${key}`, error);
      return null;
    }
  }

  set(type, key, data) {
    if (!data) return false;

    try {
      const hash = this.generateHash(key);
      const filePath = this.getCacheFilePath(type, key);

      if (type === 'images') {
        if (typeof data === 'string' && data.startsWith('data:image')) {
          const base64Data = data.split(',')[1];
          const buffer = Buffer.from(base64Data, 'base64');
          fs.writeFileSync(filePath, buffer);
        } else if (Buffer.isBuffer(data)) {
          fs.writeFileSync(filePath, data);
        } else {
          return false;
        }
      } else {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      }

      if (!this.index[type]) {
        this.index[type] = {};
      }

      this.index[type][hash] = {
        key: key,
        timestamp: Date.now(),
        file: path.basename(filePath)
      };

      this.saveIndex();
      return true;
    } catch (error) {
      Logger.cache.error(`Write failed for ${type}/${key}`, error);
      return false;
    }
  }

  async clearExpired() {
    const isOnline = await this.isOnline();
    if (!isOnline) return;

    let clearedCount = 0;
    const now = Date.now();

    Object.keys(this.index).forEach(type => {
      Object.keys(this.index[type]).forEach(hash => {
        const entry = this.index[type][hash];
        const age = now - entry.timestamp;

        if (age > this.cacheExpiry) {
          const filePath = path.join(this.cacheRoot, type, entry.file);
          try {
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
            }
            delete this.index[type][hash];
            clearedCount++;
          } catch (error) {
            Logger.cache.error('Failed to delete expired cache file', error);
          }
        }
      });
    });

    if (clearedCount > 0) {
      this.saveIndex();
      Logger.cache.info(`Cleared ${clearedCount} expired cache entries`);
    }
  }

  getStats() {
    const stats = {
      types: {},
      total: 0,
      oldestEntry: null,
      newestEntry: null
    };

    Object.keys(this.index).forEach(type => {
      const entries = Object.values(this.index[type]);
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

  clearAll() {
    Object.keys(this.index).forEach(type => {
      Object.keys(this.index[type]).forEach(hash => {
        const entry = this.index[type][hash];
        const filePath = path.join(this.cacheRoot, type, entry.file);
        try {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        } catch (error) {
          Logger.cache.error('Failed to delete cache file', error);
        }
      });
    });

    this.index = {};
    this.saveIndex();
    Logger.cache.info('Cache cleared completely');
  }

  listAllEntries() {
    const entries = [];
    Object.keys(this.index).forEach(type => {
      Object.keys(this.index[type]).forEach(hash => {
        const entry = this.index[type][hash];
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

  getEntrySize(type, key) {
    const filePath = this.getCacheFilePath(type, key);
    try {
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        return stats.size;
      }
    } catch (error) {
      Logger.cache.error('Failed to get file size', error);
    }
    return 0;
  }

  deleteOne(type, key) {
    const hash = this.generateHash(key);
    if (!this.index[type] || !this.index[type][hash]) {
      return false;
    }

    const filePath = this.getCacheFilePath(type, key);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      delete this.index[type][hash];
      this.saveIndex();
      return true;
    } catch (error) {
      Logger.cache.error('Failed to delete cache entry', error);
      return false;
    }
  }
}

module.exports = UnifiedCacheManager;