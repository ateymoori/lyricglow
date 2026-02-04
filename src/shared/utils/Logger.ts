/**
 * Centralized Logging Utility
 *
 * Provides scoped logging with electron-log for consistent log formatting
 * across all application modules. Preserves existing clean architecture.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import log from 'electron-log';

type LogData = Error | object | string | number | null | undefined;

interface LogStats {
  count: number;
  size: number;
  path: string;
}

interface ScopedLogger {
  info: (msg: string, data?: LogData) => void;
  debug: (msg: string, data?: LogData) => void;
  error: (msg: string, err?: LogData) => void;
  warn: (msg: string, data?: LogData) => void;
}

class Logger {
  private static isConfigured = false;

  static configure(): void {
    if (Logger.isConfigured) return;

    log.transports.file.level = 'debug';
    log.transports.console.level = 'debug';

    log.transports.file.maxSize = 5 * 1024 * 1024;
    log.transports.file.format =
      '[{y}-{m}-{d} {h}:{i}:{s}] [{level}] [{scope}] {text}';
    log.transports.console.format = '[{h}:{i}:{s}] [{scope}] {text}';

    const logsPath = path.join(app.getPath('logs'), 'main.log');
    log.transports.file.resolvePathFn = () => logsPath;

    Logger.isConfigured = true;
  }

  private static formatMessage(
    _category: string,
    message: string,
    data?: LogData,
  ): string {
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

  static error(category: string, message: string, error: LogData = null): void {
    const scope = log.scope(category);
    const msg = Logger.formatMessage(category, message, error);
    scope.error(msg);
  }

  static warn(category: string, message: string, data: LogData = null): void {
    const scope = log.scope(category);
    const msg = Logger.formatMessage(category, message, data);
    scope.warn(msg);
  }

  static info(category: string, message: string, data: LogData = null): void {
    const scope = log.scope(category);
    const msg = Logger.formatMessage(category, message, data);
    scope.info(msg);
  }

  static debug(category: string, message: string, data: LogData = null): void {
    const scope = log.scope(category);
    const msg = Logger.formatMessage(category, message, data);
    scope.debug(msg);
  }

  // Scoped loggers for different modules
  static app: ScopedLogger = {
    info: (msg, data) => Logger.info('APP', msg, data),
    debug: (msg, data) => Logger.debug('APP', msg, data),
    error: (msg, err) => Logger.error('APP', msg, err),
    warn: (msg, data) => Logger.warn('APP', msg, data),
  };

  static music: ScopedLogger = {
    info: (msg, data) => Logger.info('MUSIC', msg, data),
    debug: (msg, data) => Logger.debug('MUSIC', msg, data),
    error: (msg, err) => Logger.error('MUSIC', msg, err),
    warn: (msg, data) => Logger.warn('MUSIC', msg, data),
  };

  static lyrics: ScopedLogger = {
    info: (msg, data) => Logger.info('LYRICS', msg, data),
    debug: (msg, data) => Logger.debug('LYRICS', msg, data),
    error: (msg, err) => Logger.error('LYRICS', msg, err),
    warn: (msg, data) => Logger.warn('LYRICS', msg, data),
  };

  static metadata: ScopedLogger = {
    info: (msg, data) => Logger.info('METADATA', msg, data),
    debug: (msg, data) => Logger.debug('METADATA', msg, data),
    error: (msg, err) => Logger.error('METADATA', msg, err),
    warn: (msg, data) => Logger.warn('METADATA', msg, data),
  };

  static cache: ScopedLogger = {
    info: (msg, data) => Logger.info('CACHE', msg, data),
    debug: (msg, data) => Logger.debug('CACHE', msg, data),
    error: (msg, err) => Logger.error('CACHE', msg, err),
    warn: (msg, data) => Logger.warn('CACHE', msg, data),
  };

  static auth: ScopedLogger = {
    info: (msg, data) => Logger.info('AUTH', msg, data),
    debug: (msg, data) => Logger.debug('AUTH', msg, data),
    error: (msg, err) => Logger.error('AUTH', msg, err),
    warn: (msg, data) => Logger.warn('AUTH', msg, data),
  };

  static getLogPath(): string {
    return path.join(app.getPath('logs'), 'main.log');
  }

  static async clearLogs(): Promise<boolean> {
    const logsDir = app.getPath('logs');

    try {
      const files = await fs.readdir(logsDir);
      const logFiles = files.filter((f) => f.endsWith('.log'));

      for (const file of logFiles) {
        await fs.unlink(path.join(logsDir, file));
      }

      Logger.app.info('Logs cleared successfully');
      return true;
    } catch (error) {
      Logger.app.error('Failed to clear logs', error as Error);
      return false;
    }
  }

  static async getLogStats(): Promise<LogStats> {
    const logsDir = app.getPath('logs');

    try {
      const files = await fs.readdir(logsDir);
      const logFiles = files.filter((f) => f.endsWith('.log'));

      let totalSize = 0;
      for (const file of logFiles) {
        const stats = await fs.stat(path.join(logsDir, file));
        totalSize += stats.size;
      }

      return {
        count: logFiles.length,
        size: totalSize,
        path: logsDir,
      };
    } catch (_error) {
      return { count: 0, size: 0, path: logsDir };
    }
  }
}

// Auto-configure on import
Logger.configure();

export default Logger;
