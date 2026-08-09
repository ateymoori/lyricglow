/**
 * Fetch with a request timeout and enforced TLS verification
 *
 * Certificate verification is never disabled. An earlier version retried failed
 * TLS handshakes with rejectUnauthorized: false to paper over corporate VPN
 * proxies, which silently downgraded every lyrics, metadata and image request
 * to a connection an attacker on the path could read and rewrite.
 *
 * A TLS failure now surfaces as an ordinary fetch error; callers already treat
 * that like any other network failure and fall back to cached content.
 */

import https from 'node:https';
import fetch, { type RequestInit, type Response } from 'node-fetch';
import Logger from './Logger';

// One verified agent for every request
const secureAgent = new https.Agent({ rejectUnauthorized: true });

class SecureFetch {
  async fetch(
    url: string,
    options: RequestInit & { timeout?: number } = {},
  ): Promise<Response> {
    const timeoutMs = options.timeout || 10000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal,
        agent: secureAgent,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        Logger.app.error('Request timeout', { url, timeout: timeoutMs });
        throw new Error(`Request timeout after ${timeoutMs}ms`);
      }

      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

// Export singleton instance
export default new SecureFetch();
