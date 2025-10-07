const crypto = require('crypto');
const https = require('https');
const { shell, safeStorage } = require('electron');
const Logger = require('../utils/Logger');

class SpotifyAuth {
  constructor() {
    this.store = null;
    this.initStore();
    this.clientId = null;
    this.redirectUri = 'musicdisplay://callback';
    this.codeVerifier = null;
    this.tokenRefreshInterval = null;

    this.loadConfig();
  }

  async initStore() {
    const Store = (await import('electron-store')).default;
    this.store = new Store();
  }

  loadConfig() {
    const fs = require('fs');
    const path = require('path');

    try {
      const envPath = path.join(__dirname, '../../.env');
      if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        const lines = envContent.split('\n');

        for (const line of lines) {
          if (line.includes('=')) {
            const [key, value] = line.split('=').map(s => s.trim());
            if (key === 'SPOTIFY_CLIENT_ID') {
              this.clientId = value;
            }
          }
        }
      }

      if (!this.clientId) {
        Logger.auth.warn('Spotify Client ID not found in .env file');
      }
    } catch (error) {
      Logger.auth.error('Failed to load Spotify config', error);
    }
  }

  // Generate cryptographically secure random string (43-128 chars)
  generateCodeVerifier() {
    return crypto.randomBytes(64).toString('base64url');
  }

  // Generate SHA256 hash of code verifier
  async generateCodeChallenge(verifier) {
    const hash = crypto.createHash('sha256').update(verifier).digest();
    return hash.toString('base64url');
  }

  // Build authorization URL for PKCE flow
  async buildAuthUrl() {
    this.codeVerifier = this.generateCodeVerifier();
    const codeChallenge = await this.generateCodeChallenge(this.codeVerifier);

    const scopes = [
      'user-read-private',
      'user-read-email'
    ];

    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      redirect_uri: this.redirectUri,
      code_challenge_method: 'S256',
      code_challenge: codeChallenge,
      scope: scopes.join(' '),
      state: crypto.randomBytes(16).toString('hex')
    });

    return `https://accounts.spotify.com/authorize?${params.toString()}`;
  }

  // Open browser for user to login
  async startAuthFlow() {
    if (!this.clientId) {
      throw new Error('Spotify Client ID not configured');
    }

    const authUrl = await this.buildAuthUrl();
    Logger.auth.info('Opening Spotify login');
    await shell.openExternal(authUrl);
  }

  // Exchange authorization code for access token
  async exchangeCodeForToken(code) {
    if (!this.codeVerifier) {
      throw new Error('Code verifier not found. Start auth flow first.');
    }

    const params = new URLSearchParams({
      client_id: this.clientId,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: this.redirectUri,
      code_verifier: this.codeVerifier
    });

    return this.makeTokenRequest(params);
  }

  // Make token request to Spotify
  makeTokenRequest(params) {
    return new Promise((resolve, reject) => {
      const postData = params.toString();

      const options = {
        hostname: 'accounts.spotify.com',
        path: '/api/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const json = JSON.parse(data);

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

  storeTokens(accessToken, refreshToken, expiresIn) {
    if (!this.store) return;

    const tokenData = {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: Date.now() + (expiresIn * 1000)
    };

    const encrypted = safeStorage.encryptString(JSON.stringify(tokenData));
    this.store.set('spotify_tokens', encrypted.toString('base64'));

    Logger.auth.debug('Tokens stored securely');
  }

  getStoredTokens() {
    if (!this.store) return null;

    try {
      const encryptedBase64 = this.store.get('spotify_tokens');
      if (!encryptedBase64) {
        return null;
      }

      const encrypted = Buffer.from(encryptedBase64, 'base64');
      const decrypted = safeStorage.decryptString(encrypted);
      return JSON.parse(decrypted);
    } catch (error) {
      Logger.auth.error('Failed to retrieve tokens', error);
      return null;
    }
  }

  isLoggedIn() {
    if (!this.store) return false;
    const tokens = this.getStoredTokens();
    return tokens && tokens.refresh_token;
  }

  // Get current access token (refresh if needed)
  async getAccessToken() {
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

  // Refresh access token using refresh token
  async refreshAccessToken() {
    const tokens = this.getStoredTokens();

    if (!tokens || !tokens.refresh_token) {
      throw new Error('No refresh token available. Please login again.');
    }

    const params = new URLSearchParams({
      client_id: this.clientId,
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token
    });

    try {
      const response = await this.makeTokenRequest(params);

      // Store new tokens
      this.storeTokens(
        response.access_token,
        response.refresh_token || tokens.refresh_token,
        response.expires_in
      );

      Logger.auth.info('Token refreshed successfully');
      return response.access_token;
    } catch (error) {
      Logger.auth.error('Token refresh failed', error);
      throw error;
    }
  }

  // Start auto-refresh interval (refresh every 55 minutes)
  startAutoRefresh() {
    if (this.tokenRefreshInterval) {
      clearInterval(this.tokenRefreshInterval);
    }

    // Refresh every 55 minutes (access token valid for 60 minutes)
    this.tokenRefreshInterval = setInterval(async () => {
      if (this.isLoggedIn()) {
        try {
          await this.refreshAccessToken();
        } catch (error) {
          Logger.auth.error('Auto-refresh failed', error);
        }
      }
    }, 55 * 60 * 1000);
  }

  // Stop auto-refresh interval
  stopAutoRefresh() {
    if (this.tokenRefreshInterval) {
      clearInterval(this.tokenRefreshInterval);
      this.tokenRefreshInterval = null;
    }
  }

  logout() {
    if (this.store) {
      this.store.delete('spotify_tokens');
    }
    this.stopAutoRefresh();
    Logger.auth.info('User logged out');
  }

  // Handle OAuth callback
  async handleCallback(callbackUrl) {
    try {
      const url = new URL(callbackUrl);
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      if (error) {
        throw new Error(`Authorization error: ${error}`);
      }

      if (!code) {
        throw new Error('No authorization code received');
      }

      // Exchange code for tokens
      const response = await this.exchangeCodeForToken(code);

      // Store tokens securely
      this.storeTokens(
        response.access_token,
        response.refresh_token,
        response.expires_in
      );

      // Start auto-refresh
      this.startAutoRefresh();

      Logger.auth.info('User logged in successfully');
      return true;
    } catch (error) {
      Logger.auth.error('OAuth callback failed', error);
      throw error;
    }
  }

  // Get user profile from Spotify API
  async getUserProfile() {
    const accessToken = await this.getAccessToken();

    if (!accessToken) {
      return null;
    }

    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.spotify.com',
        path: '/v1/me',
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            if (res.statusCode === 200) {
              const profile = JSON.parse(data);
              resolve({
                displayName: profile.display_name || profile.id,
                email: profile.email || null,
                imageUrl: profile.images && profile.images.length > 0 ? profile.images[0].url : null,
                country: profile.country || null,
                product: profile.product || null
              });
            } else {
              Logger.auth.error('Spotify API error', { statusCode: res.statusCode });
              resolve(null);
            }
          } catch (error) {
            Logger.auth.error('Failed to parse user profile', error);
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

module.exports = SpotifyAuth;