const log = require('electron-log');
const path = require('path');
const { app } = require('electron');

class Logger {
  static isConfigured = false;

  static configure() {
    if (this.isConfigured) return;

    log.transports.file.level = 'debug';
    log.transports.console.level = 'debug';

    log.transports.file.maxSize = 5 * 1024 * 1024;
    log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}] [{level}] [{scope}] {text}';
    log.transports.console.format = '[{h}:{i}:{s}] [{scope}] {text}';

    const logsPath = path.join(app.getPath('logs'), 'main.log');
    log.transports.file.resolvePathFn = () => logsPath;

    this.isConfigured = true;
  }

  static formatMessage(category, message, data) {
    if (data !== null && data !== undefined) {
      if (data instanceof Error) {
        return `${message}: ${data.message}`;
      }
      if (typeof data === 'object') {
        return `${message} ${JSON.stringify(data)}`;
      }
      return `${message} ${data}`;
    }
    return message;
  }

  static error(category, message, error = null) {
    const scope = log.scope(category);
    const msg = this.formatMessage(category, message, error);
    scope.error(msg);
  }

  static warn(category, message, data = null) {
    const scope = log.scope(category);
    const msg = this.formatMessage(category, message, data);
    scope.warn(msg);
  }

  static info(category, message, data = null) {
    const scope = log.scope(category);
    const msg = this.formatMessage(category, message, data);
    scope.info(msg);
  }

  static debug(category, message, data = null) {
    const scope = log.scope(category);
    const msg = this.formatMessage(category, message, data);
    scope.debug(msg);
  }

  static app = {
    info: (msg, data) => Logger.info('APP', msg, data),
    debug: (msg, data) => Logger.debug('APP', msg, data),
    error: (msg, err) => Logger.error('APP', msg, err),
    warn: (msg, data) => Logger.warn('APP', msg, data)
  };

  static music = {
    info: (msg, data) => Logger.info('MUSIC', msg, data),
    debug: (msg, data) => Logger.debug('MUSIC', msg, data),
    error: (msg, err) => Logger.error('MUSIC', msg, err),
    warn: (msg, data) => Logger.warn('MUSIC', msg, data)
  };

  static lyrics = {
    info: (msg, data) => Logger.info('LYRICS', msg, data),
    debug: (msg, data) => Logger.debug('LYRICS', msg, data),
    error: (msg, err) => Logger.error('LYRICS', msg, err),
    warn: (msg, data) => Logger.warn('LYRICS', msg, data)
  };

  static metadata = {
    info: (msg, data) => Logger.info('METADATA', msg, data),
    debug: (msg, data) => Logger.debug('METADATA', msg, data),
    error: (msg, err) => Logger.error('METADATA', msg, err),
    warn: (msg, data) => Logger.warn('METADATA', msg, data)
  };

  static cache = {
    info: (msg, data) => Logger.info('CACHE', msg, data),
    debug: (msg, data) => Logger.debug('CACHE', msg, data),
    error: (msg, err) => Logger.error('CACHE', msg, err),
    warn: (msg, data) => Logger.warn('CACHE', msg, data)
  };

  static auth = {
    info: (msg, data) => Logger.info('AUTH', msg, data),
    debug: (msg, data) => Logger.debug('AUTH', msg, data),
    error: (msg, err) => Logger.error('AUTH', msg, err),
    warn: (msg, data) => Logger.warn('AUTH', msg, data)
  };

  static getLogPath() {
    return path.join(app.getPath('logs'), 'main.log');
  }

  static async clearLogs() {
    const fs = require('fs').promises;
    const logsDir = app.getPath('logs');

    try {
      const files = await fs.readdir(logsDir);
      const logFiles = files.filter(f => f.endsWith('.log'));

      for (const file of logFiles) {
        await fs.unlink(path.join(logsDir, file));
      }

      Logger.app.info('Logs cleared successfully');
      return true;
    } catch (error) {
      Logger.app.error('Failed to clear logs', error);
      return false;
    }
  }

  static async getLogStats() {
    const fs = require('fs').promises;
    const logsDir = app.getPath('logs');

    try {
      const files = await fs.readdir(logsDir);
      const logFiles = files.filter(f => f.endsWith('.log'));

      let totalSize = 0;
      for (const file of logFiles) {
        const stats = await fs.stat(path.join(logsDir, file));
        totalSize += stats.size;
      }

      return {
        count: logFiles.length,
        size: totalSize,
        path: logsDir
      };
    } catch (error) {
      return { count: 0, size: 0, path: logsDir };
    }
  }
}

Logger.configure();

module.exports = Logger;
