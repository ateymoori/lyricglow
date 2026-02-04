/**
 * TheAudioDB Metadata Manager
 *
 * Fetches artist biographies and metadata from TheAudioDB API.
 * Implements rate limiting (500ms) and offline fallback support.
 */

import Logger from '../../shared/utils/Logger';
import SecureFetch from '../../shared/utils/SecureFetch';
import type UnifiedCacheManager from './UnifiedCacheManager';

// TheAudioDB API response interface
interface AudioDBArtistRaw {
  strArtist: string;
  strArtistAlternate: string | null;
  strCountry: string | null;
  strCountryCode: string | null;
  intFormedYear: string | null;
  intBornYear: string | null;
  intDiedYear: string | null;
  strDisbanded: string | null;
  strGenre: string | null;
  strStyle: string | null;
  strMood: string | null;
  strGender: string | null;
  intMembers: string | null;
  strBiographyEN: string | null;
  strBiographyDE: string | null;
  strBiographyFR: string | null;
  strBiographyES: string | null;
  strBiographyPT: string | null;
  strBiographyIT: string | null;
  strBiographyJP: string | null;
  strBiographyRU: string | null;
  strWebsite: string | null;
  strFacebook: string | null;
  strTwitter: string | null;
  strArtistThumb: string | null;
  strArtistFanart: string | null;
  strArtistFanart2: string | null;
  strArtistFanart3: string | null;
  strArtistFanart4: string | null;
  strArtistWideThumb: string | null;
  strArtistBanner: string | null;
  strArtistLogo: string | null;
  strArtistClearart: string | null;
  strMusicBrainzID: string | null;
}

interface AudioDBSearchResponse {
  artists: AudioDBArtistRaw[] | null;
}

// Parsed artist data structure
interface AudioDBArtistData {
  name: string;
  alternateName: string | null;
  country: string | null;
  countryCode: string | null;
  formedYear: string | null;
  bornYear: string | null;
  diedYear: string | null;
  disbanded: string | null;
  genre: string | null;
  style: string | null;
  mood: string | null;
  gender: string | null;
  members: string | null;
  bio: {
    summary: string | null;
    content: string | null;
    de: string | null;
    fr: string | null;
    es: string | null;
    pt: string | null;
    it: string | null;
    jp: string | null;
    ru: string | null;
  };
  website: string | null;
  facebook: string | null;
  twitter: string | null;
  allImages: string[];
  thumb: string | null;
  logo: string | null;
  clearart: string | null;
  banner: string | null;
  musicBrainzId: string | null;
}

interface AudioDBMetadata {
  artist: AudioDBArtistData | null;
}

class TheAudioDBManager {
  private baseUrl: string;
  private cache: UnifiedCacheManager;
  private apiKey: string;
  private lastRequestTime: number;
  private minRequestInterval: number;

  constructor(cache: UnifiedCacheManager) {
    this.baseUrl = 'https://www.theaudiodb.com';
    this.cache = cache;
    this.apiKey = '523532';
    this.lastRequestTime = 0;
    this.minRequestInterval = 500;
  }

  private async makeRequest(endpoint: string): Promise<unknown> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.minRequestInterval) {
      await new Promise((resolve) =>
        setTimeout(resolve, this.minRequestInterval - timeSinceLastRequest),
      );
    }
    this.lastRequestTime = Date.now();

    try {
      const url = `${this.baseUrl}/api/v1/json/${this.apiKey}/${endpoint}`;

      const response = await SecureFetch.fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'LyricGlow/1.0',
        },
      });

      if (!response.ok) {
        Logger.metadata.error(`TheAudioDB error: HTTP ${response.status}`);
        return null;
      }

      const json = await response.json();
      return json;
    } catch (error) {
      Logger.metadata.error('TheAudioDB request failed', error as Error);
      return null;
    }
  }

  async searchArtist(artistName: string): Promise<AudioDBArtistData | null> {
    if (!artistName) return null;

    const cacheKey = `audiodb_artist:${artistName.toLowerCase()}`;
    const cached = await this.cache.get('metadata', cacheKey);
    if (cached) {
      Logger.metadata.debug(`TheAudioDB cache hit: ${artistName}`);
      return cached as AudioDBArtistData;
    }

    const startTime = Date.now();
    const encodedArtist = encodeURIComponent(artistName);
    const response = await this.makeRequest(`search.php?s=${encodedArtist}`);
    const duration = Date.now() - startTime;

    const searchResponse = response as AudioDBSearchResponse | null;
    const artists = searchResponse?.artists;

    if (artists && artists.length > 0) {
      const artist = artists[0];
      if (artist) {
        const parsedData = this.parseArtistData(artist);

        Logger.metadata.info(`TheAudioDB found (${duration}ms): ${artistName}`);
        await this.cache.set('metadata', cacheKey, parsedData);
        return parsedData;
      }
    }

    Logger.metadata.warn(`TheAudioDB not found (${duration}ms): ${artistName}`);
    const offlineCache = await this.cache.get('metadata', cacheKey);
    return offlineCache as AudioDBArtistData | null;
  }

  private parseArtistData(artist: AudioDBArtistRaw): AudioDBArtistData {
    const fanartImages = [
      artist.strArtistThumb,
      artist.strArtistFanart,
      artist.strArtistFanart2,
      artist.strArtistFanart3,
      artist.strArtistFanart4,
      artist.strArtistWideThumb,
      artist.strArtistBanner,
    ].filter((img): img is string => img !== null && img !== '');

    return {
      name: artist.strArtist,
      alternateName: artist.strArtistAlternate,
      country: artist.strCountry,
      countryCode: artist.strCountryCode,
      formedYear: artist.intFormedYear,
      bornYear: artist.intBornYear,
      diedYear: artist.intDiedYear,
      disbanded: artist.strDisbanded,
      genre: artist.strGenre,
      style: artist.strStyle,
      mood: artist.strMood,
      gender: artist.strGender,
      members: artist.intMembers,
      bio: {
        summary: this.truncateBio(artist.strBiographyEN, 300),
        content: artist.strBiographyEN,
        de: artist.strBiographyDE,
        fr: artist.strBiographyFR,
        es: artist.strBiographyES,
        pt: artist.strBiographyPT,
        it: artist.strBiographyIT,
        jp: artist.strBiographyJP,
        ru: artist.strBiographyRU,
      },
      website: artist.strWebsite,
      facebook: artist.strFacebook,
      twitter: artist.strTwitter,
      allImages: fanartImages,
      thumb: artist.strArtistThumb,
      logo: artist.strArtistLogo,
      clearart: artist.strArtistClearart,
      banner: artist.strArtistBanner,
      musicBrainzId: artist.strMusicBrainzID,
    };
  }

  private truncateBio(text: string | null, limit: number = 300): string | null {
    if (!text) return null;
    if (text.length <= limit) return text;
    return `${text.substring(0, limit)}...`;
  }

  async fetchMetadata(artistName: string): Promise<AudioDBMetadata | null> {
    if (!artistName) {
      Logger.metadata.debug('TheAudioDB: No artist name provided');
      return null;
    }

    try {
      const artistData = await this.searchArtist(artistName);

      if (!artistData) {
        return null;
      }

      return {
        artist: artistData,
      };
    } catch (error) {
      Logger.metadata.error('TheAudioDB fetch failed', error as Error);
      return null;
    }
  }
}

export default TheAudioDBManager;
