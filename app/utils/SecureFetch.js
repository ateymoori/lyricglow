const https = require('https');
const Logger = require('./Logger');

/**
 * Smart fetch with SSL fallback for corporate VPN compatibility
 * Tries secure connection first, falls back to insecure if SSL fails
 */
class SecureFetch {
  constructor() {
    this.sslBypassEnabled = false;
    this.hasTestedConnection = false;
  }

  /**
   * Fetch with automatic SSL fallback
   * @param {string} url - URL to fetch
   * @param {object} options - Fetch options
   * @returns {Promise<Response>}
   */
  async fetch(url, options = {}) {
    const timeoutMs = options.timeout || 10000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await this._fetchSecure(url, {
        ...options,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!this.hasTestedConnection) {
        Logger.app.info('Secure connection successful (SSL verification enabled)');
        this.hasTestedConnection = true;
      }

      return response;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error.name === 'AbortError') {
        const timeoutError = new Error(`Request timeout after ${timeoutMs}ms`);
        Logger.app.error('Request timeout', { url, timeout: timeoutMs });
        throw timeoutError;
      }

      if (this._isSSLError(error)) {
        Logger.app.warn('SSL verification failed, retrying with bypass (corporate VPN detected)');

        const retryController = new AbortController();
        const retryTimeoutId = setTimeout(() => retryController.abort(), timeoutMs);

        try {
          const response = await this._fetchInsecure(url, {
            ...options,
            signal: retryController.signal
          });

          clearTimeout(retryTimeoutId);

          if (!this.sslBypassEnabled) {
            Logger.app.info('Connection successful with SSL bypass (corporate VPN mode)');
            this.sslBypassEnabled = true;
          }

          return response;
        } catch (fallbackError) {
          clearTimeout(retryTimeoutId);

          if (fallbackError.name === 'AbortError') {
            const timeoutError = new Error(`Request timeout after ${timeoutMs}ms`);
            Logger.app.error('Request timeout on SSL bypass', { url, timeout: timeoutMs });
            throw timeoutError;
          }

          Logger.app.error('Both secure and insecure connection attempts failed', fallbackError);
          throw fallbackError;
        }
      }

      throw error;
    }
  }

  /**
   * Fetch with SSL verification enabled (secure)
   */
  async _fetchSecure(url, options) {
    const fetchModule = await import('node-fetch');
    const fetch = fetchModule.default;

    return fetch(url, {
      ...options,
      agent: new https.Agent({
        rejectUnauthorized: true // SSL verification ON
      })
    });
  }

  /**
   * Fetch with SSL verification disabled (insecure fallback)
   */
  async _fetchInsecure(url, options) {
    const fetchModule = await import('node-fetch');
    const fetch = fetchModule.default;

    return fetch(url, {
      ...options,
      agent: new https.Agent({
        rejectUnauthorized: false // SSL verification OFF
      })
    });
  }

  /**
   * Check if error is SSL-related
   */
  _isSSLError(error) {
    const sslErrorCodes = [
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      'SELF_SIGNED_CERT_IN_CHAIN',
      'CERT_HAS_EXPIRED',
      'UNABLE_TO_GET_ISSUER_CERT',
      'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
      'CERT_UNTRUSTED',
      'DEPTH_ZERO_SELF_SIGNED_CERT'
    ];

    const errorMessage = error.message || '';
    const errorCode = error.code || '';

    return sslErrorCodes.some(code =>
      errorMessage.includes(code) || errorCode === code
    );
  }

  /**
   * Get current connection mode
   */
  getConnectionMode() {
    if (!this.hasTestedConnection) {
      return 'untested';
    }
    return this.sslBypassEnabled ? 'corporate-vpn' : 'secure';
  }
}

// Export singleton instance
module.exports = new SecureFetch();
