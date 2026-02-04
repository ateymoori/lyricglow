/**
 * Smart Fetch with SSL Fallback
 *
 * Provides fetch with automatic SSL verification fallback for corporate VPN compatibility.
 * Tries secure connection first, falls back to insecure if SSL fails.
 * Preserves existing clean architecture and SSL handling logic.
 */

import https from 'node:https';
import fetch, { type RequestInit, type Response } from 'node-fetch';
import Logger from './Logger';

type ConnectionMode = 'untested' | 'secure' | 'corporate-vpn';

class SecureFetch {
  private sslBypassEnabled = false;
  private hasTestedConnection = false;

  /**
   * Fetch with automatic SSL fallback
   */
  async fetch(
    url: string,
    options: RequestInit & { timeout?: number } = {},
  ): Promise<Response> {
    const timeoutMs = options.timeout || 10000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await this.fetchSecure(url, {
        ...options,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!this.hasTestedConnection) {
        Logger.app.info(
          'Secure connection successful (SSL verification enabled)',
        );
        this.hasTestedConnection = true;
      }

      return response;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        const timeoutError = new Error(`Request timeout after ${timeoutMs}ms`);
        Logger.app.error('Request timeout', { url, timeout: timeoutMs });
        throw timeoutError;
      }

      if (this.isSSLError(error as Error)) {
        Logger.app.warn(
          'SSL verification failed, retrying with bypass (corporate VPN detected)',
        );

        const retryController = new AbortController();
        const retryTimeoutId = setTimeout(
          () => retryController.abort(),
          timeoutMs,
        );

        try {
          const response = await this.fetchInsecure(url, {
            ...options,
            signal: retryController.signal,
          });

          clearTimeout(retryTimeoutId);

          if (!this.sslBypassEnabled) {
            Logger.app.info(
              'Connection successful with SSL bypass (corporate VPN mode)',
            );
            this.sslBypassEnabled = true;
          }

          return response;
        } catch (fallbackError) {
          clearTimeout(retryTimeoutId);

          if (
            fallbackError instanceof Error &&
            fallbackError.name === 'AbortError'
          ) {
            const timeoutError = new Error(
              `Request timeout after ${timeoutMs}ms`,
            );
            Logger.app.error('Request timeout on SSL bypass', {
              url,
              timeout: timeoutMs,
            });
            throw timeoutError;
          }

          Logger.app.error(
            'Both secure and insecure connection attempts failed',
            fallbackError as Error,
          );
          throw fallbackError;
        }
      }

      throw error;
    }
  }

  /**
   * Fetch with SSL verification enabled (secure)
   */
  private async fetchSecure(
    url: string,
    options: RequestInit,
  ): Promise<Response> {
    return fetch(url, {
      ...options,
      agent: new https.Agent({
        rejectUnauthorized: true, // SSL verification ON
      }),
    });
  }

  /**
   * Fetch with SSL verification disabled (insecure fallback)
   */
  private async fetchInsecure(
    url: string,
    options: RequestInit,
  ): Promise<Response> {
    return fetch(url, {
      ...options,
      agent: new https.Agent({
        rejectUnauthorized: false, // SSL verification OFF
      }),
    });
  }

  /**
   * Check if error is SSL-related
   */
  private isSSLError(error: Error): boolean {
    const sslErrorCodes = [
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      'SELF_SIGNED_CERT_IN_CHAIN',
      'CERT_HAS_EXPIRED',
      'UNABLE_TO_GET_ISSUER_CERT',
      'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
      'CERT_UNTRUSTED',
      'DEPTH_ZERO_SELF_SIGNED_CERT',
    ];

    const errorMessage = error.message || '';
    const errorCode = (error as NodeJS.ErrnoException).code || '';

    return sslErrorCodes.some(
      (code) => errorMessage.includes(code) || errorCode === code,
    );
  }

  /**
   * Get current connection mode
   */
  getConnectionMode(): ConnectionMode {
    if (!this.hasTestedConnection) {
      return 'untested';
    }
    return this.sslBypassEnabled ? 'corporate-vpn' : 'secure';
  }
}

// Export singleton instance
export default new SecureFetch();
