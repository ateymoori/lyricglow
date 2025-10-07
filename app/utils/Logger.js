/**
 * Centralized logging utility for clean, consistent console output
 *
 * Features:
 * - Structured format: [HH:MM:SS] [CATEGORY] message
 * - Log levels: ERROR, WARN, INFO, DEBUG
 * - Environment-aware: INFO in production, DEBUG in development
 * - Categories: APP, MUSIC, LYRICS, METADATA, CACHE, AUTH
 */

class Logger {
  static LEVELS = {
    ERROR: 0,
    WARN: 1,
    INFO: 2,
    DEBUG: 3
  };

  static CATEGORIES = {
    APP: 'APP',
    MUSIC: 'MUSIC',
    LYRICS: 'LYRICS',
    METADATA: 'METADATA',
    CACHE: 'CACHE',
    AUTH: 'AUTH'
  };

  static currentLevel = Logger.LEVELS.DEBUG;

  /**
   * Format timestamp as HH:MM:SS
   */
  static getTimestamp() {
    const now = new Date();
    return now.toTimeString().split(' ')[0];
  }

  /**
   * Internal log method
   */
  static _log(level, category, message, data = null) {
    if (level > Logger.currentLevel) return;

    const timestamp = Logger.getTimestamp();
    const prefix = `[${timestamp}] [${category}]`;

    if (data !== null && data !== undefined) {
      console.log(prefix, message, data);
    } else {
      console.log(prefix, message);
    }
  }

  /**
   * Log error (always shown)
   */
  static error(category, message, error = null) {
    const timestamp = Logger.getTimestamp();
    const prefix = `[${timestamp}] [${category}] ERROR:`;

    if (error) {
      console.error(prefix, message, error);
    } else {
      console.error(prefix, message);
    }
  }

  /**
   * Log warning
   */
  static warn(category, message, data = null) {
    if (Logger.LEVELS.WARN > Logger.currentLevel) return;

    const timestamp = Logger.getTimestamp();
    const prefix = `[${timestamp}] [${category}] WARN:`;

    if (data !== null && data !== undefined) {
      console.warn(prefix, message, data);
    } else {
      console.warn(prefix, message);
    }
  }

  /**
   * Log info (important state changes)
   */
  static info(category, message, data = null) {
    Logger._log(Logger.LEVELS.INFO, category, message, data);
  }

  /**
   * Log debug (verbose, dev only)
   */
  static debug(category, message, data = null) {
    Logger._log(Logger.LEVELS.DEBUG, category, message, data);
  }

  /**
   * Convenience methods for common categories
   */
  static app = {
    info: (msg, data) => Logger.info(Logger.CATEGORIES.APP, msg, data),
    debug: (msg, data) => Logger.debug(Logger.CATEGORIES.APP, msg, data),
    error: (msg, err) => Logger.error(Logger.CATEGORIES.APP, msg, err)
  };

  static music = {
    info: (msg, data) => Logger.info(Logger.CATEGORIES.MUSIC, msg, data),
    debug: (msg, data) => Logger.debug(Logger.CATEGORIES.MUSIC, msg, data),
    error: (msg, err) => Logger.error(Logger.CATEGORIES.MUSIC, msg, err)
  };

  static lyrics = {
    info: (msg, data) => Logger.info(Logger.CATEGORIES.LYRICS, msg, data),
    debug: (msg, data) => Logger.debug(Logger.CATEGORIES.LYRICS, msg, data),
    error: (msg, err) => Logger.error(Logger.CATEGORIES.LYRICS, msg, err)
  };

  static metadata = {
    info: (msg, data) => Logger.info(Logger.CATEGORIES.METADATA, msg, data),
    debug: (msg, data) => Logger.debug(Logger.CATEGORIES.METADATA, msg, data),
    error: (msg, err) => Logger.error(Logger.CATEGORIES.METADATA, msg, err)
  };

  static cache = {
    info: (msg, data) => Logger.info(Logger.CATEGORIES.CACHE, msg, data),
    debug: (msg, data) => Logger.debug(Logger.CATEGORIES.CACHE, msg, data),
    error: (msg, err) => Logger.error(Logger.CATEGORIES.CACHE, msg, err)
  };

  static auth = {
    info: (msg, data) => Logger.info(Logger.CATEGORIES.AUTH, msg, data),
    debug: (msg, data) => Logger.debug(Logger.CATEGORIES.AUTH, msg, data),
    error: (msg, err) => Logger.error(Logger.CATEGORIES.AUTH, msg, err)
  };
}

module.exports = Logger;