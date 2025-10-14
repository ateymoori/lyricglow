const secureFetch = require('../utils/SecureFetch');
const Logger = require('../utils/Logger');

class TheAudioDBManager {
  constructor(cache) {
    this.baseUrl = 'https://www.theaudiodb.com';
    this.cache = cache;
    this.apiKey = '523532'; // Free test key
    this.lastRequestTime = 0;
    this.minRequestInterval = 500; // 2 calls per second = 500ms between calls
  }

  async makeRequest(endpoint) {
    // Rate limiting
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.minRequestInterval) {
      await new Promise(resolve => setTimeout(resolve, this.minRequestInterval - timeSinceLastRequest));
    }
    this.lastRequestTime = Date.now();

    try {
      const url = `${this.baseUrl}/api/v1/json/${this.apiKey}/${endpoint}`;

      // Use smart fetch with SSL fallback
      const response = await secureFetch.fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'LyricGlow/1.0'
        }
      });

      if (!response.ok) {
        Logger.metadata.error(`TheAudioDB request failed: ${response.status}`);
        return null;
      }

      const json = await response.json();
      return json;
    } catch (error) {
      Logger.metadata.error('TheAudioDB request failed', error);
      return null;
    }
  }

  async searchArtist(artistName) {
    if (!artistName) return null;

    // Check cache first (1 year cache for artist data)
    const cacheKey = `audiodb_artist:${artistName.toLowerCase()}`;
    const cached = await this.cache.get('metadata', cacheKey);
    if (cached) {
      Logger.metadata.debug('TheAudioDB: Cache hit');
      return cached;
    }

    // Search by artist name
    const encodedArtist = encodeURIComponent(artistName);
    const response = await this.makeRequest(`search.php?s=${encodedArtist}`);

    if (response && response.artists && response.artists.length > 0) {
      const artist = response.artists[0]; // Take first result
      const parsedData = this.parseArtistData(artist);

      // Cache for 1 year (artist data rarely changes)
      await this.cache.set('metadata', cacheKey, parsedData);
      return parsedData;
    }

    // If not found, try offline cache
    const offlineCache = await this.cache.get('metadata', cacheKey);
    return offlineCache;
  }

  parseArtistData(artist) {
    // Extract all fanart images (different photos, not just sizes)
    const fanartImages = [
      artist.strArtistThumb,
      artist.strArtistFanart,
      artist.strArtistFanart2,
      artist.strArtistFanart3,
      artist.strArtistFanart4,
      artist.strArtistWideThumb,
      artist.strArtistBanner
    ].filter(img => img && img !== ''); // Remove null/empty

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

      // Biography in multiple languages
      bio: {
        summary: this.truncateBio(artist.strBiographyEN, 300),
        content: artist.strBiographyEN,
        de: artist.strBiographyDE,
        fr: artist.strBiographyFR,
        es: artist.strBiographyES,
        pt: artist.strBiographyPT,
        it: artist.strBiographyIT,
        jp: artist.strBiographyJP,
        ru: artist.strBiographyRU
      },

      // Social media
      website: artist.strWebsite,
      facebook: artist.strFacebook,
      twitter: artist.strTwitter,

      // Images - multiple different photos
      allImages: fanartImages,
      thumb: artist.strArtistThumb,
      logo: artist.strArtistLogo,
      clearart: artist.strArtistClearart,
      banner: artist.strArtistBanner,

      // External IDs
      musicBrainzId: artist.strMusicBrainzID
    };
  }

  truncateBio(text, limit = 300) {
    if (!text) return null;
    if (text.length <= limit) return text;
    return text.substring(0, limit) + '...';
  }

  async fetchMetadata(artistName) {
    if (!artistName) {
      Logger.metadata.debug('TheAudioDB: No artist name provided');
      return null;
    }

    try {
      const artistData = await this.searchArtist(artistName);

      if (!artistData) {
        Logger.metadata.debug(`TheAudioDB: Artist not found: ${artistName}`);
        return null;
      }

      return {
        artist: artistData
      };
    } catch (error) {
      Logger.metadata.error('TheAudioDB fetch failed', error);
      return null;
    }
  }
}

module.exports = TheAudioDBManager;