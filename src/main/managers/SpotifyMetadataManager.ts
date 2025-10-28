/**
 * Spotify Metadata Manager
 *
 * Fetches artist and track metadata from Spotify API with OAuth authentication.
 * Implements caching and offline fallback support.
 */

import https from 'https';
import Logger from '../../shared/utils/Logger';
import type UnifiedCacheManager from './UnifiedCacheManager';
import type SpotifyAuth from '../auth/SpotifyAuth';

// Spotify API response interfaces
interface SpotifyImage {
  url: string;
  height: number;
  width: number;
}

interface SpotifyArtistRaw {
  id: string;
  name: string;
  images?: SpotifyImage[];
  genres?: string[];
  popularity: number;
  followers?: {
    total: number;
  };
  external_urls?: {
    spotify: string;
  };
}

interface SpotifyTrackRaw {
  id: string;
  name: string;
  popularity: number;
  external_urls?: {
    spotify: string;
  };
  album?: {
    name: string;
    images?: SpotifyImage[];
  };
  artists?: Array<{
    name: string;
    id: string;
  }>;
}

interface SpotifyTopTracksResponse {
  tracks: SpotifyTrackRaw[];
}

interface SpotifyAlbumsResponse {
  items: Array<{
    name: string;
    id: string;
    release_date: string;
    total_tracks: number;
    images?: SpotifyImage[];
    external_urls?: {
      spotify: string;
    };
    artists?: Array<{
      name: string;
    }>;
  }>;
}

interface SpotifySearchResponse {
  artists: {
    items: SpotifyArtistRaw[];
  };
}

// Parsed data structures
export interface ArtistData {
  id: string;
  name: string;
  images: SpotifyImage[];
  genres: string[];
  popularity: number;
  followers: number;
  url: string | null;
}

export interface TrackData {
  name: string;
  id: string;
  popularity: number;
  url: string | null;
  album: {
    name: string | undefined;
    images: SpotifyImage[];
  };
  artist: string | null;
}

export interface AlbumData {
  name: string;
  id: string;
  release_date: string;
  total_tracks: number;
  images: SpotifyImage[];
  url: string | null;
  artist: string | null;
}

export interface SpotifyMetadata {
  artist: ArtistData | null;
  topTracks: TrackData[] | null;
  topAlbums: AlbumData[] | null;
}

interface TrackDataInput {
  spotifyUrl?: string;
  artist?: string;
}

class SpotifyMetadataManager {
  private auth: SpotifyAuth;
  private cache: UnifiedCacheManager;
  private baseUrl: string;

  constructor(spotifyAuth: SpotifyAuth, cache: UnifiedCacheManager) {
    this.auth = spotifyAuth;
    this.cache = cache;
    this.baseUrl = 'api.spotify.com';
  }

  async makeRequest(endpoint: string, timeoutMs: number = 10000): Promise<any> {
    const accessToken = await this.auth.getAccessToken();

    if (!accessToken) {
      Logger.metadata.warn('No Spotify access token available');
      return null;
    }

    return new Promise((resolve) => {
      const options: https.RequestOptions = {
        hostname: this.baseUrl,
        path: endpoint,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        timeout: timeoutMs
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
            Logger.metadata.error('JSON parse failed', error as Error);
            resolve(null);
          }
        });
      });

      req.on('timeout', () => {
        Logger.metadata.error('Spotify request timeout', { endpoint, timeout: timeoutMs });
        req.destroy();
        resolve(null);
      });

      req.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'ECONNRESET') {
          Logger.metadata.error('Spotify request timeout', error);
        } else {
          Logger.metadata.error('Spotify request failed', error);
        }
        resolve(null);
      });

      req.end();
    });
  }

  extractTrackId(spotifyUrl: string): string | null {
    // Handle formats:
    // spotify:track:5jkFvD4UJrmdoezzT1FRoP
    // https://open.spotify.com/track/5jkFvD4UJrmdoezzT1FRoP
    if (!spotifyUrl) return null;

    if (spotifyUrl.startsWith('spotify:track:')) {
      return spotifyUrl.split(':')[2] || null;
    }

    if (spotifyUrl.includes('open.spotify.com/track/')) {
      const match = spotifyUrl.match(/track\/([a-zA-Z0-9]+)/);
      return match ? (match[1] || null) : null;
    }

    return null;
  }

  async getTrack(trackId: string): Promise<SpotifyTrackRaw | null> {
    if (!trackId) return null;

    const cacheKey = `track:${trackId}`;
    const cached = await this.cache.get('metadata', cacheKey);
    if (cached) return cached as SpotifyTrackRaw;

    const response = await this.makeRequest(`/v1/tracks/${trackId}`);

    if (response) {
      this.cache.set('metadata', cacheKey, response);
    }

    const offlineCache = await this.cache.get('metadata', cacheKey);
    return (response as SpotifyTrackRaw) || (offlineCache as SpotifyTrackRaw | null);
  }

  async getArtist(artistId: string): Promise<ArtistData | null> {
    if (!artistId) return null;

    const cacheKey = `spotify_artist:${artistId}`;
    const cached = await this.cache.get('metadata', cacheKey);
    if (cached) {
      Logger.metadata.debug(`Spotify cache hit: artist ${artistId}`);
      return cached as ArtistData;
    }

    const startTime = Date.now();
    const response = await this.makeRequest(`/v1/artists/${artistId}`);
    const duration = Date.now() - startTime;

    if (response) {
      const artistData = this.parseArtistData(response as SpotifyArtistRaw);
      Logger.metadata.info(`Spotify found (${duration}ms): ${artistData.name}`);
      this.cache.set('metadata', cacheKey, artistData);
      return artistData;
    }

    Logger.metadata.warn(`Spotify not found (${duration}ms): artist ${artistId}`);
    const offlineCache = await this.cache.get('metadata', cacheKey);
    return offlineCache as ArtistData | null;
  }

  private parseArtistData(artist: SpotifyArtistRaw): ArtistData {
    return {
      id: artist.id,
      name: artist.name,
      images: artist.images || [],
      genres: artist.genres || [],
      popularity: artist.popularity,
      followers: artist.followers?.total || 0,
      url: artist.external_urls?.spotify || null
    };
  }

  async getArtistTopTracks(artistId: string, market: string = 'US'): Promise<TrackData[]> {
    if (!artistId) return [];

    const cacheKey = `spotify_toptracks:${artistId}`;
    const cached = await this.cache.get('metadata', cacheKey);
    if (cached) return cached as TrackData[];

    const response = await this.makeRequest(
      `/v1/artists/${artistId}/top-tracks?market=${market}`
    );

    if (response && (response as SpotifyTopTracksResponse).tracks) {
      const tracks = (response as SpotifyTopTracksResponse).tracks.slice(0, 5).map((track) => ({
        name: track.name,
        id: track.id,
        popularity: track.popularity,
        url: track.external_urls?.spotify || null,
        album: {
          name: track.album?.name || undefined,
          images: track.album?.images || []
        },
        artist: track.artists?.[0]?.name || null
      }));

      this.cache.set('metadata', cacheKey, tracks);
      return tracks;
    }

    const offlineCache = await this.cache.get('metadata', cacheKey);
    return (offlineCache as TrackData[]) || [];
  }

  async getArtistAlbums(artistId: string, limit: number = 4): Promise<AlbumData[]> {
    if (!artistId) return [];

    const cacheKey = `spotify_albums:${artistId}`;
    const cached = await this.cache.get('metadata', cacheKey);
    if (cached) return cached as AlbumData[];

    const response = await this.makeRequest(
      `/v1/artists/${artistId}/albums?limit=${limit}&include_groups=album`
    );

    if (response && (response as SpotifyAlbumsResponse).items) {
      const albums = (response as SpotifyAlbumsResponse).items.slice(0, limit).map((album) => ({
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

    const offlineCache = await this.cache.get('metadata', cacheKey);
    return (offlineCache as AlbumData[]) || [];
  }

  async searchArtist(artistName: string): Promise<ArtistData | null> {
    if (!artistName) return null;

    const cacheKey = `spotify_search:${artistName.toLowerCase()}`;
    const cached = await this.cache.get('metadata', cacheKey);
    if (cached) return cached as ArtistData;

    const query = encodeURIComponent(artistName);
    const response = await this.makeRequest(`/v1/search?q=${query}&type=artist&limit=1`);

    if (
      response &&
      (response as SpotifySearchResponse).artists &&
      (response as SpotifySearchResponse).artists.items.length > 0
    ) {
      const artist = (response as SpotifySearchResponse).artists.items[0];
      if (artist) {
        const artistData = this.parseArtistData(artist);
        this.cache.set('metadata', cacheKey, artistData);
        return artistData;
      }
    }

    const offlineCache = await this.cache.get('metadata', cacheKey);
    return offlineCache as ArtistData | null;
  }

  async fetchMetadata(trackData: TrackDataInput): Promise<SpotifyMetadata | null> {
    try {
      // Extract track ID from Spotify URL
      const trackId = this.extractTrackId(trackData.spotifyUrl || '');

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

      if (!track || !track.artists || track.artists.length === 0 || !track.artists[0]) {
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
      Logger.metadata.error('Spotify metadata fetch failed', error as Error);
      return null;
    }
  }
}

export default SpotifyMetadataManager;
