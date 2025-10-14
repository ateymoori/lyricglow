const https = require('https');
const Logger = require('../utils/Logger');

class SpotifyMetadataManager {
  constructor(spotifyAuth, cache) {
    this.auth = spotifyAuth;
    this.cache = cache;
    this.baseUrl = 'api.spotify.com';
  }

  // Make authenticated request to Spotify API
  async makeRequest(endpoint) {
    const accessToken = await this.auth.getAccessToken();

    if (!accessToken) {
      Logger.metadata.warn('No Spotify access token available');
      return null;
    }

    return new Promise((resolve) => {
      const options = {
        hostname: this.baseUrl,
        path: endpoint,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
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
              Logger.metadata.error('Spotify API error', json.error);
              resolve(null);
            } else {
              resolve(json);
            }
          } catch (error) {
            Logger.metadata.error('JSON parse failed', error);
            resolve(null);
          }
        });
      });

      req.on('error', (error) => {
        Logger.metadata.error('Spotify request failed', error);
        resolve(null);
      });

      req.end();
    });
  }

  // Extract track ID from Spotify URL
  extractTrackId(spotifyUrl) {
    // Handle formats:
    // spotify:track:5jkFvD4UJrmdoezzT1FRoP
    // https://open.spotify.com/track/5jkFvD4UJrmdoezzT1FRoP
    if (!spotifyUrl) return null;

    if (spotifyUrl.startsWith('spotify:track:')) {
      return spotifyUrl.split(':')[2];
    }

    if (spotifyUrl.includes('open.spotify.com/track/')) {
      const match = spotifyUrl.match(/track\/([a-zA-Z0-9]+)/);
      return match ? match[1] : null;
    }

    return null;
  }

  // Get track details from Spotify
  async getTrack(trackId) {
    if (!trackId) return null;

    const cacheKey = `track:${trackId}`;
    const cached = await this.cache.get('metadata', cacheKey);
    if (cached) return cached;

    const response = await this.makeRequest(`/v1/tracks/${trackId}`);

    if (response) {
      this.cache.set('metadata', cacheKey, response);
    }

    return response || (await this.cache.get('metadata', cacheKey));
  }

  // Get artist details from Spotify
  async getArtist(artistId) {
    if (!artistId) return null;

    const cacheKey = `spotify_artist:${artistId}`;
    const cached = await this.cache.get('metadata', cacheKey);
    if (cached) {
      Logger.metadata.debug(`Spotify cache hit: artist ${artistId}`);
      return cached;
    }

    const startTime = Date.now();
    const response = await this.makeRequest(`/v1/artists/${artistId}`);
    const duration = Date.now() - startTime;

    if (response) {
      const artistData = this.parseArtistData(response);
      Logger.metadata.info(`Spotify found (${duration}ms): ${artistData.name}`);
      this.cache.set('metadata', cacheKey, artistData);
      return artistData;
    }

    Logger.metadata.warn(`Spotify not found (${duration}ms): artist ${artistId}`);
    return await this.cache.get('metadata', cacheKey);
  }

  // Parse artist data into consistent format
  parseArtistData(artist) {
    return {
      id: artist.id,
      name: artist.name,
      images: artist.images || [], // Array of {url, height, width}
      genres: artist.genres || [],
      popularity: artist.popularity,
      followers: artist.followers?.total || 0,
      url: artist.external_urls?.spotify || null
    };
  }

  // Get artist's top tracks
  async getArtistTopTracks(artistId, market = 'US') {
    if (!artistId) return null;

    const cacheKey = `spotify_toptracks:${artistId}`;
    const cached = await this.cache.get('metadata', cacheKey);
    if (cached) return cached;

    const response = await this.makeRequest(`/v1/artists/${artistId}/top-tracks?market=${market}`);

    if (response && response.tracks) {
      const tracks = response.tracks.slice(0, 5).map(track => ({
        name: track.name,
        id: track.id,
        popularity: track.popularity,
        url: track.external_urls?.spotify || null,
        album: {
          name: track.album?.name,
          images: track.album?.images || []
        },
        artist: track.artists?.[0]?.name || null
      }));

      this.cache.set('metadata', cacheKey, tracks);
      return tracks;
    }

    return await this.cache.get('metadata', cacheKey) || [];
  }

  // Get artist's albums
  async getArtistAlbums(artistId, limit = 4) {
    if (!artistId) return null;

    const cacheKey = `spotify_albums:${artistId}`;
    const cached = await this.cache.get('metadata', cacheKey);
    if (cached) return cached;

    const response = await this.makeRequest(`/v1/artists/${artistId}/albums?limit=${limit}&include_groups=album`);

    if (response && response.items) {
      const albums = response.items.slice(0, limit).map(album => ({
        name: album.name,
        id: album.id,
        release_date: album.release_date,
        total_tracks: album.total_tracks,
        images: album.images || [],
        url: album.external_urls?.spotify || null,
        artist: album.artists?.[0]?.name || null
      }));

      this.cache.set('metadata', cacheKey, albums);
      return albums;
    }

    return await this.cache.get('metadata', cacheKey) || [];
  }

  // Search for artist by name (fallback)
  async searchArtist(artistName) {
    if (!artistName) return null;

    const cacheKey = `spotify_search:${artistName.toLowerCase()}`;
    const cached = await this.cache.get('metadata', cacheKey);
    if (cached) return cached;

    const query = encodeURIComponent(artistName);
    const response = await this.makeRequest(`/v1/search?q=${query}&type=artist&limit=1`);

    if (response && response.artists && response.artists.items.length > 0) {
      const artist = response.artists.items[0];
      const artistData = this.parseArtistData(artist);
      this.cache.set('metadata', cacheKey, artistData);
      return artistData;
    }

    return await this.cache.get('metadata', cacheKey);
  }

  // Fetch complete metadata for a track
  async fetchMetadata(trackData) {
    try {
      // Extract track ID from Spotify URL
      const trackId = this.extractTrackId(trackData.spotifyUrl);

      if (!trackId) {
        Logger.metadata.debug('No Spotify track ID, trying artist search');
        // Fallback: search by artist name
        if (trackData.artist) {
          const artist = await this.searchArtist(trackData.artist);
          if (artist) {
            const [topTracks, albums] = await Promise.all([
              this.getArtistTopTracks(artist.id),
              this.getArtistAlbums(artist.id)
            ]);

            return {
              artist: artist,
              topTracks: topTracks,
              topAlbums: albums
            };
          }
        }
        return null;
      }

      // Get track details
      const track = await this.getTrack(trackId);

      if (!track || !track.artists || track.artists.length === 0) {
        return null;
      }

      // Get primary artist ID
      const artistId = track.artists[0].id;

      // Fetch artist details, top tracks, and albums in parallel
      const [artist, topTracks, albums] = await Promise.all([
        this.getArtist(artistId),
        this.getArtistTopTracks(artistId),
        this.getArtistAlbums(artistId)
      ]);

      return {
        artist: artist,
        topTracks: topTracks,
        topAlbums: albums
      };
    } catch (error) {
      Logger.metadata.error('Spotify metadata fetch failed', error);
      return null;
    }
  }
}

module.exports = SpotifyMetadataManager;