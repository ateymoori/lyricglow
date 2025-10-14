const secureFetch = require('../utils/SecureFetch');
const Logger = require('../utils/Logger');

class TheAudioDBManager {
  constructor(cache) {
    this.baseUrl = 'https://www.theaudiodb.com';
    this.cache = cache;
    this.apiKey = '523532';
    this.lastRequestTime = 0;
    this.minRequestInterval = 500;
  }

  async makeRequest(endpoint) {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.minRequestInterval) {
      await new Promise(resolve => setTimeout(resolve, this.minRequestInterval - timeSinceLastRequest));
    }
    this.lastRequestTime = Date.now();

    try {
      const url = `${this.baseUrl}/api/v1/json/${this.apiKey}/${endpoint}`;

      const response = await secureFetch.fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'LyricGlow/1.0'
        }
      });

      if (!response.ok) {
        Logger.metadata.error(`TheAudioDB error: HTTP ${response.status}`);
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

    const cacheKey = `audiodb_artist:${artistName.toLowerCase()}`;
    const cached = await this.cache.get('metadata', cacheKey);
    if (cached) {
      Logger.metadata.debug(`TheAudioDB cache hit: ${artistName}`);
      return cached;
    }

    const startTime = Date.now();
    const encodedArtist = encodeURIComponent(artistName);
    const response = await this.makeRequest(`search.php?s=${encodedArtist}`);
    const duration = Date.now() - startTime;

    if (response && response.artists && response.artists.length > 0) {
      const artist = response.artists[0];
      const parsedData = this.parseArtistData(artist);

      Logger.metadata.info(`TheAudioDB found (${duration}ms): ${artistName}`);
      await this.cache.set('metadata', cacheKey, parsedData);
      return parsedData;
    }

    Logger.metadata.warn(`TheAudioDB not found (${duration}ms): ${artistName}`);
    const offlineCache = await this.cache.get('metadata', cacheKey);
    return offlineCache;
  }

  parseArtistData(artist) {
    const fanartImages = [
      artist.strArtistThumb,
      artist.strArtistFanart,
      artist.strArtistFanart2,
      artist.strArtistFanart3,
      artist.strArtistFanart4,
      artist.strArtistWideThumb,
      artist.strArtistBanner
    ].filter(img => img && img !== '');

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
        ru: artist.strBiographyRU
      },
      website: artist.strWebsite,
      facebook: artist.strFacebook,
      twitter: artist.strTwitter,
      allImages: fanartImages,
      thumb: artist.strArtistThumb,
      logo: artist.strArtistLogo,
      clearart: artist.strArtistClearart,
      banner: artist.strArtistBanner,
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
