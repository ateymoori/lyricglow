/**
 * Spotify OAuth Authentication Manager
 *
 * Implements Spotify PKCE (Proof Key for Code Exchange) OAuth flow.
 * Handles token storage with encryption, auto-refresh, and user profile.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { safeStorage, shell } from 'electron';
import type Store from 'electron-store';
import Logger from '../../shared/utils/Logger';
import { getStore } from '../store';

// Spotify API response interfaces
interface SpotifyTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
  error?: string;
  error_description?: string;
}

interface SpotifyProfileResponse {
  display_name?: string;
  id: string;
  email?: string;
  images?: Array<{ url: string }>;
  country?: string;
  product?: string;
}

interface TokenData {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

interface UserProfile {
  displayName: string;
  email: string | null;
  imageUrl: string | null;
  country: string | null;
  product: string | null;
}

class SpotifyAuth {
  private store: Store | null;
  private clientId: string | null;
  private redirectUri: string;
  private codeVerifier: string | null;
  private authState: string | null;
  private tokenRefreshInterval: NodeJS.Timeout | null;
  private storeReady: Promise<void>;

  constructor() {
    this.store = null;
    this.storeReady = this.initStore();
    this.clientId = null;
    this.redirectUri = 'musicdisplay://callback';
    this.codeVerifier = null;
    this.authState = null;
    this.tokenRefreshInterval = null;

    this.loadConfig();
  }

  private async initStore(): Promise<void> {
    try {
      // Shared with window/visibility settings: separate instances over the
      // same config file can overwrite each other's writes
      this.store = await getStore();
    } catch (error) {
      Logger.auth.error('Failed to initialize token store', error as Error);
    }
  }

  /**
   * Resolves once the token store is loaded.
   * Must be awaited before any synchronous store access (isLoggedIn) so that
   * a stored session is not reported as logged out on a fast startup.
   */
  async whenReady(): Promise<void> {
    await this.storeReady;
  }

  private loadConfig(): void {
    try {
      // After bundling, __dirname is dist/main, so ../../.env gets to project root
      const envPath = path.join(__dirname, '../../.env');
      Logger.auth.debug(`Looking for .env at: ${envPath}`);

      if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        const lines = envContent.split('\n');

        for (const line of lines) {
          if (line.includes('=')) {
            const [key, value] = line.split('=').map((s) => s.trim());
            if (key === 'SPOTIFY_CLIENT_ID' && value) {
              this.clientId = value;
              Logger.auth.info('Spotify Client ID loaded successfully');
            }
          }
        }
      } else {
        Logger.auth.warn(`Spotify .env file not found at: ${envPath}`);
      }

      if (!this.clientId) {
        Logger.auth.warn('Spotify Client ID not found in .env file');
      }
    } catch (error) {
      Logger.auth.error('Failed to load Spotify config', error as Error);
    }
  }

  private generateCodeVerifier(): string {
    return crypto.randomBytes(64).toString('base64url');
  }

  /**
   * Constant-time comparison of the callback state against the stored one
   */
  private statesMatch(received: string): boolean {
    if (!this.authState) return false;

    const expected = Buffer.from(this.authState, 'utf8');
    const actual = Buffer.from(received, 'utf8');

    if (expected.length !== actual.length) return false;
    return crypto.timingSafeEqual(expected, actual);
  }

  private async generateCodeChallenge(verifier: string): Promise<string> {
    const hash = crypto.createHash('sha256').update(verifier).digest();
    return hash.toString('base64url');
  }

  private async buildAuthUrl(): Promise<string> {
    this.codeVerifier = this.generateCodeVerifier();
    const codeChallenge = await this.generateCodeChallenge(this.codeVerifier);

    const scopes = ['user-read-private', 'user-read-email'];

    // Remembered so the callback can prove it belongs to this flow
    this.authState = crypto.randomBytes(16).toString('hex');

    const params = new URLSearchParams({
      client_id: this.clientId!,
      response_type: 'code',
      redirect_uri: this.redirectUri,
      code_challenge_method: 'S256',
      code_challenge: codeChallenge,
      scope: scopes.join(' '),
      state: this.authState,
    });

    return `https://accounts.spotify.com/authorize?${params.toString()}`;
  }

  async startAuthFlow(): Promise<void> {
    if (!this.clientId) {
      throw new Error('Spotify Client ID not configured');
    }

    const authUrl = await this.buildAuthUrl();
    Logger.auth.info('Opening Spotify login');
    await shell.openExternal(authUrl);
  }

  private async exchangeCodeForToken(
    code: string,
  ): Promise<SpotifyTokenResponse> {
    if (!this.codeVerifier) {
      throw new Error('Code verifier not found. Start auth flow first.');
    }

    const params = new URLSearchParams({
      client_id: this.clientId!,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: this.redirectUri,
      code_verifier: this.codeVerifier,
    });

    return this.makeTokenRequest(params);
  }

  private makeTokenRequest(
    params: URLSearchParams,
  ): Promise<SpotifyTokenResponse> {
    return new Promise((resolve, reject) => {
      const postData = params.toString();

      const options: https.RequestOptions = {
        hostname: 'accounts.spotify.com',
        path: '/api/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData),
        },
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const json = JSON.parse(data) as SpotifyTokenResponse;

            if (json.error) {
              reject(new Error(json.error_description || json.error));
            } else {
              resolve(json);
            }
          } catch (error) {
            reject(error);
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.write(postData);
      req.end();
    });
  }

  private storeTokens(
    accessToken: string,
    refreshToken: string,
    expiresIn: number,
  ): void {
    if (!this.store) return;

    const tokenData: TokenData = {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: Date.now() + expiresIn * 1000,
    };

    const encrypted = safeStorage.encryptString(JSON.stringify(tokenData));
    this.store.set('spotify_tokens', encrypted.toString('base64'));

    Logger.auth.debug('Tokens stored securely');
  }

  private getStoredTokens(): TokenData | null {
    if (!this.store) return null;

    try {
      const encryptedBase64 = this.store.get('spotify_tokens');
      if (!encryptedBase64 || typeof encryptedBase64 !== 'string') {
        return null;
      }

      const encrypted = Buffer.from(encryptedBase64, 'base64');
      const decrypted = safeStorage.decryptString(encrypted);
      return JSON.parse(decrypted) as TokenData;
    } catch (error) {
      Logger.auth.error('Failed to retrieve tokens', error as Error);
      return null;
    }
  }

  isLoggedIn(): boolean {
    if (!this.store) return false;
    const tokens = this.getStoredTokens();
    return !!tokens?.refresh_token;
  }

  async getAccessToken(): Promise<string | null> {
    await this.storeReady;
    const tokens = this.getStoredTokens();

    if (!tokens) {
      return null;
    }

    // Check if token expires in less than 5 minutes
    const expiresIn = tokens.expires_at - Date.now();
    if (expiresIn < 300000) {
      Logger.auth.debug('Token expiring soon, refreshing');
      return await this.refreshAccessToken();
    }

    return tokens.access_token;
  }

  private async refreshAccessToken(): Promise<string> {
    const tokens = this.getStoredTokens();

    if (!tokens || !tokens.refresh_token) {
      throw new Error('No refresh token available. Please login again.');
    }

    const params = new URLSearchParams({
      client_id: this.clientId!,
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
    });

    try {
      const response = await this.makeTokenRequest(params);

      // Store new tokens
      this.storeTokens(
        response.access_token,
        response.refresh_token || tokens.refresh_token,
        response.expires_in,
      );

      Logger.auth.info('Token refreshed successfully');
      return response.access_token;
    } catch (error) {
      Logger.auth.error('Token refresh failed', error as Error);
      throw error;
    }
  }

  startAutoRefresh(): void {
    if (this.tokenRefreshInterval) {
      clearInterval(this.tokenRefreshInterval);
    }

    // Refresh every 55 minutes (access token valid for 60 minutes)
    this.tokenRefreshInterval = setInterval(
      async () => {
        if (this.isLoggedIn()) {
          try {
            await this.refreshAccessToken();
          } catch (error) {
            Logger.auth.error('Auto-refresh failed', error as Error);
          }
        }
      },
      55 * 60 * 1000,
    );
  }

  stopAutoRefresh(): void {
    if (this.tokenRefreshInterval) {
      clearInterval(this.tokenRefreshInterval);
      this.tokenRefreshInterval = null;
    }
  }

  logout(): void {
    if (this.store) {
      this.store.delete('spotify_tokens');
    }
    this.stopAutoRefresh();
    Logger.auth.info('User logged out');
  }

  async handleCallback(callbackUrl: string): Promise<boolean> {
    await this.storeReady;

    try {
      const url = new URL(callbackUrl);
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');

      if (error) {
        throw new Error(`Authorization error: ${error}`);
      }

      // Reject callbacks that do not carry the state we generated: anything
      // else was not started by this app
      if (!this.authState || !state || !this.statesMatch(state)) {
        throw new Error('Invalid state parameter. Please start login again.');
      }
      this.authState = null;

      if (!code) {
        throw new Error('No authorization code received');
      }

      // Exchange code for tokens
      const response = await this.exchangeCodeForToken(code);

      // Store tokens securely
      this.storeTokens(
        response.access_token,
        response.refresh_token!,
        response.expires_in,
      );

      // Start auto-refresh
      this.startAutoRefresh();

      Logger.auth.info('User logged in successfully');
      return true;
    } catch (error) {
      Logger.auth.error('OAuth callback failed', error as Error);
      throw error;
    }
  }

  async getUserProfile(): Promise<UserProfile | null> {
    const accessToken = await this.getAccessToken();

    if (!accessToken) {
      return null;
    }

    return new Promise((resolve) => {
      const options: https.RequestOptions = {
        hostname: 'api.spotify.com',
        path: '/v1/me',
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            if (res.statusCode === 200) {
              const profile = JSON.parse(data) as SpotifyProfileResponse;
              resolve({
                displayName: profile.display_name || profile.id,
                email: profile.email || null,
                imageUrl:
                  profile.images &&
                  profile.images.length > 0 &&
                  profile.images[0]
                    ? profile.images[0].url
                    : null,
                country: profile.country || null,
                product: profile.product || null,
              });
            } else {
              Logger.auth.error('Spotify API error', {
                statusCode: res.statusCode,
              });
              resolve(null);
            }
          } catch (error) {
            Logger.auth.error('Failed to parse user profile', error as Error);
            resolve(null);
          }
        });
      });

      req.on('error', (error) => {
        Logger.auth.error('Failed to fetch user profile', error);
        resolve(null);
      });

      req.end();
    });
  }
}

export default SpotifyAuth;
