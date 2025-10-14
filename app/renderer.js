const elements = {
  title: document.getElementById('title'),
  artist: document.getElementById('artist'),
  album: document.getElementById('album'),
  albumArt: document.getElementById('albumArt'),
  progressBar: document.getElementById('progressBar'),
  currentTime: document.getElementById('currentTime'),
  duration: document.getElementById('duration'),
  playPauseBtn: document.getElementById('playPauseBtn'),
  previousBtn: document.getElementById('previousBtn'),
  nextBtn: document.getElementById('nextBtn'),
  closeBtn: document.getElementById('closeBtn'),
  year: document.getElementById('year'),
  genre: document.getElementById('genre'),
  bpm: document.getElementById('bpm'),
  playCount: document.getElementById('playCount'),
  rating: document.getElementById('rating')
};

// Progress bar seeking functionality
let isDragging = false;
let progressBarContainer = null;
let pendingSeekPosition = null;

function updateSeekUI(e) {
  if (!currentMusicData || !currentMusicData.duration) return;

  const rect = progressBarContainer.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const percentage = Math.max(0, Math.min(1, clickX / rect.width));
  const newPosition = percentage * currentMusicData.duration;

  pendingSeekPosition = newPosition;
  internalPosition = newPosition;
  lastSyncTime = Date.now();

  elements.progressBar.style.width = `${percentage * 100}%`;
  elements.currentTime.textContent = formatTime(newPosition);
}

function commitSeek() {
  if (pendingSeekPosition !== null) {
    window.musicAPI.seek(pendingSeekPosition);
    pendingSeekPosition = null;
  }
}

function initProgressBarSeek() {
  progressBarContainer = document.querySelector('.progress-bar');

  if (!progressBarContainer) return;

  progressBarContainer.addEventListener('click', (e) => {
    if (!currentMusicData || !currentMusicData.duration) return;
    updateSeekUI(e);
    commitSeek();
  });

  progressBarContainer.addEventListener('mousedown', (e) => {
    if (!currentMusicData || !currentMusicData.duration) return;
    isDragging = true;
    updateSeekUI(e);
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    updateSeekUI(e);
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      commitSeek();
      isDragging = false;
    }
  });
}

function updatePlayPauseButton(isPlaying) {
  const playIcon = elements.playPauseBtn.querySelector('.play-icon');
  const pauseIcon = elements.playPauseBtn.querySelector('.pause-icon');

  if (isPlaying) {
    playIcon.style.display = 'none';
    pauseIcon.style.display = 'block';
  } else {
    playIcon.style.display = 'block';
    pauseIcon.style.display = 'none';
  }
}

class LyricsHandler {
  constructor() {
    this.lyrics = [];
    this.currentIndex = -1;
    this.container = null;
    this.elements = {};
    this.isRTL = false;
  }

  init() {
    this.container = document.getElementById('lyricsContainer');
    this.elements = {
      previous: document.getElementById('lyricsPrevious'),
      current: document.getElementById('lyricsCurrent'),
      next: document.getElementById('lyricsNext'),
      currentText: document.querySelector('#lyricsCurrent .lyrics-text')
    };
  }

  parseLRC(content) {
    if (!content) return [];

    const lines = content.split('\n');
    const lyrics = [];

    for (const line of lines) {
      const match = line.match(/^\[(\d{2}):(\d{2})\.(\d{2})\](.*)$/);
      if (match) {
        const [, minutes, seconds, centiseconds, text] = match;
        const time = parseInt(minutes) * 60 + parseInt(seconds) + parseInt(centiseconds) / 100;
        lyrics.push({ time, text: text.trim() });
      }
    }
    return lyrics.sort((a, b) => a.time - b.time);
  }

  setLyrics(lyricsData) {
    if (!lyricsData || !lyricsData.synced) {
      this.showNotAvailable();
      return;
    }

    if (lyricsData.instrumental) {
      this.showInstrumental();
      return;
    }

    this.lyrics = this.parseLRC(lyricsData.synced);
    this.currentIndex = 0; // Start at first line
    this.container.removeAttribute('data-state');
    this.updateDisplay(); // Show first line immediately
  }

  updatePosition(position) {
    if (!this.lyrics.length) return;

    const index = this.findCurrentIndex(position);
    if (index === this.currentIndex) {
      this.updateProgress(position);
      return;
    }

    this.currentIndex = index;
    this.updateDisplay();
    this.updateProgress(position);
  }

  findCurrentIndex(position) {
    // If position is before first lyric, show first lyric
    if (this.lyrics.length > 0 && position < this.lyrics[0].time) {
      return 0;
    }

    for (let i = this.lyrics.length - 1; i >= 0; i--) {
      if (position >= this.lyrics[i].time) {
        return i;
      }
    }
    return 0; // Default to first line instead of -1
  }

  updateDisplay() {
    const previous = this.currentIndex > 0 ? this.lyrics[this.currentIndex - 1].text : '';
    const current = this.currentIndex >= 0 ? this.lyrics[this.currentIndex].text : '';
    const next = this.currentIndex < this.lyrics.length - 1 ? this.lyrics[this.currentIndex + 1].text : '';

    this.elements.previous.textContent = previous;
    this.elements.next.textContent = next;

    this.setCurrentLineWithGlow(current || '♪ ♪ ♪');
  }

  setCurrentLineWithGlow(text) {
    this.isRTL = this.detectRTL(text);

    const words = text.split(' ').filter(w => w.length > 0);
    this.elements.currentText.innerHTML = '';
    this.elements.currentText.style.direction = this.isRTL ? 'rtl' : 'ltr';

    words.forEach((word, index) => {
      const span = document.createElement('span');
      span.className = 'lyrics-word';
      span.textContent = word;
      span.dataset.index = index;
      this.elements.currentText.appendChild(span);

      if (index < words.length - 1) {
        const space = document.createTextNode(' ');
        this.elements.currentText.appendChild(space);
      }
    });
  }

  updateProgress(position) {
    if (this.currentIndex < 0 || this.currentIndex >= this.lyrics.length - 1) {
      this.clearGlow();
      return;
    }

    const currentLine = this.lyrics[this.currentIndex];
    const nextLine = this.lyrics[this.currentIndex + 1];
    const duration = nextLine.time - currentLine.time;
    const elapsed = position - currentLine.time;
    const progress = Math.min(1, Math.max(0, elapsed / duration));

    this.applyWordGlow(progress);
  }

  applyWordGlow(progress) {
    const words = this.elements.currentText.querySelectorAll('.lyrics-word');
    if (!words.length) return;

    const totalWords = words.length;
    const glowPosition = progress * totalWords;

    words.forEach((word, index) => {
      const wordIndex = index;
      const wordProgress = Math.min(1, Math.max(0, glowPosition - wordIndex));

      if (wordProgress > 0) {
        const intensity = wordProgress > 0.5 ? 1 : wordProgress * 2;
        word.style.setProperty('--glow-intensity', intensity);
        word.classList.add('glowing');
      } else {
        word.classList.remove('glowing');
        word.style.removeProperty('--glow-intensity');
      }
    });
  }

  clearGlow() {
    const words = this.elements.currentText.querySelectorAll('.lyrics-word');
    words.forEach(word => {
      word.classList.remove('glowing');
      word.style.removeProperty('--glow-intensity');
    });
  }

  detectRTL(text) {
    const rtlChars = /[\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
    return rtlChars.test(text);
  }

  showLoading() {
    this.container.setAttribute('data-state', 'loading');
    this.clear();
  }

  showNotAvailable() {
    this.container.setAttribute('data-state', 'unavailable');
    this.clear();
  }

  showInstrumental() {
    this.container.setAttribute('data-state', 'instrumental');
    this.clear();
  }

  clear() {
    this.lyrics = [];
    this.currentIndex = -1;
    this.elements.previous.textContent = '';
    this.elements.currentText.innerHTML = '';
    this.elements.next.textContent = '';
    this.clearGlow();
  }
}

class FullLyricsModal {
  constructor(lyricsHandler) {
    this.lyricsHandler = lyricsHandler;
    this.modal = null;
    this.elements = {};
    this.isOpen = false;
    this.autoScrollEnabled = true;
  }

  init() {
    this.modal = document.getElementById('fullLyricsModal');
    this.elements = {
      body: document.getElementById('fullLyricsBody'),
      text: document.getElementById('fullLyricsText'),
      closeBtn: document.getElementById('fullLyricsClose'),
      openBtn: document.getElementById('fullLyricsBtn')
    };

    this.elements.openBtn.addEventListener('click', () => {
      this.show();
    });

    this.elements.closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.hide();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        this.hide();
      }
    });

    // Disable auto-scroll on user interaction
    this.elements.body.addEventListener('scroll', () => {
      this.autoScrollEnabled = false;
    });

    this.elements.body.addEventListener('click', () => {
      this.autoScrollEnabled = false;
    });

    this.elements.body.addEventListener('wheel', () => {
      this.autoScrollEnabled = false;
    });
  }

  show() {
    if (!currentMusicData || !currentMusicData.title) {
      return;
    }

    this.updateLyrics();
    this.modal.style.display = 'flex';
    this.isOpen = true;
    this.autoScrollEnabled = true;

    setTimeout(() => this.scrollToCurrentLine(), 100);
  }

  hide() {
    this.modal.style.display = 'none';
    this.isOpen = false;
  }

  updateLyrics() {
    const lyrics = this.lyricsHandler.lyrics;
    const container = this.lyricsHandler.container;
    const state = container?.getAttribute('data-state');

    if (state === 'loading') {
      this.elements.text.setAttribute('data-state', 'loading');
      this.elements.text.textContent = 'Loading lyrics...';
      return;
    }

    if (state === 'unavailable') {
      this.elements.text.setAttribute('data-state', 'unavailable');
      this.elements.text.textContent = 'No lyrics available';
      return;
    }

    if (state === 'instrumental') {
      this.elements.text.setAttribute('data-state', 'instrumental');
      this.elements.text.textContent = '♪ Instrumental ♪';
      return;
    }

    if (!lyrics || lyrics.length === 0) {
      this.elements.text.setAttribute('data-state', 'unavailable');
      this.elements.text.textContent = 'No lyrics available';
      return;
    }

    this.elements.text.removeAttribute('data-state');
    this.elements.text.innerHTML = '';

    const isRTL = lyrics.length > 0 && this.lyricsHandler.detectRTL(lyrics[0].text);
    this.elements.text.style.direction = isRTL ? 'rtl' : 'ltr';

    lyrics.forEach((line, index) => {
      const lineEl = document.createElement('div');
      lineEl.className = 'lyrics-line';
      lineEl.textContent = line.text || ' ';
      lineEl.dataset.index = index;
      lineEl.dataset.time = line.time;

      if (index === this.lyricsHandler.currentIndex) {
        lineEl.classList.add('current');
      }

      if (!line.text || line.text.trim() === '') {
        lineEl.classList.add('empty');
      }

      this.elements.text.appendChild(lineEl);
    });
  }

  updateCurrentLine() {
    if (!this.isOpen) return;

    const lines = this.elements.text.querySelectorAll('.lyrics-line');
    const currentIndex = this.lyricsHandler.currentIndex;

    lines.forEach((line, index) => {
      if (index === currentIndex) {
        line.classList.add('current');
      } else {
        line.classList.remove('current');
      }
    });

    this.scrollToCurrentLine();
  }

  scrollToCurrentLine() {
    if (!this.autoScrollEnabled) return;

    const currentLine = this.elements.text.querySelector('.lyrics-line.current');
    if (currentLine) {
      currentLine.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
    }
  }
}

const lyricsHandler = new LyricsHandler();
const fullLyricsModal = new FullLyricsModal(lyricsHandler);
let currentMusicData = null;
let previousTrackKey = null;

let internalPosition = 0;
let internalIsPlaying = false;
let lastSyncTime = Date.now();
let internalAnimationRunning = false;
let isTrackChanging = false;

function startInternalTimer() {
  if (internalAnimationRunning) return;
  internalAnimationRunning = true;
  updateInternalPosition();
}

function updateInternalPosition() {
  if (internalIsPlaying && currentMusicData && currentMusicData.duration) {
    const now = Date.now();
    const elapsed = (now - lastSyncTime) / 1000;
    internalPosition += elapsed;
    lastSyncTime = now;

    if (internalPosition > currentMusicData.duration) {
      internalPosition = currentMusicData.duration;
    }

    const progress = (internalPosition / currentMusicData.duration) * 100;
    elements.progressBar.style.width = `${progress}%`;
    elements.currentTime.textContent = formatTime(internalPosition);

    lyricsHandler.updatePosition(internalPosition);
    fullLyricsModal.updateCurrentLine();
  }

  requestAnimationFrame(updateInternalPosition);
}

function formatTime(seconds) {
  if (!seconds || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatRating(rating) {
  if (!rating || rating === 0) return '';
  const stars = Math.round(rating / 20);
  return '★'.repeat(stars) + '☆'.repeat(5 - stars);
}

function updateDisplay(data) {
  currentMusicData = data;

  if (!data || !data.nowPlayingAvailable) {
    document.body.classList.add('no-music');
    elements.title.textContent = 'No music playing';
    elements.artist.textContent = '';
    elements.album.textContent = '';
    elements.albumArt.classList.remove('show');
    elements.progressBar.style.width = '0%';
    elements.currentTime.textContent = '0:00';
    elements.duration.textContent = '0:00';
    updatePlayPauseButton(false);
    clearDetails();
    lyricsHandler.clear();
    metadataHandler.clear();
    previousTrackKey = null;
    internalIsPlaying = false;
    internalPosition = 0;
    isTrackChanging = false;
    return;
  }

  const currentTrackKey = `${data.title}-${data.artist}`;
  const trackChanged = previousTrackKey && previousTrackKey !== currentTrackKey;

  if (trackChanged) {
    isTrackChanging = true;
    lyricsHandler.clear();
    metadataHandler.clear();
    internalPosition = 0;
    previousTrackKey = currentTrackKey;
  } else if (!previousTrackKey) {
    previousTrackKey = currentTrackKey;
  }

  document.body.classList.remove('no-music');

  elements.title.textContent = data.title || 'Unknown';
  elements.artist.textContent = data.artist || 'Unknown Artist';
  elements.album.textContent = data.album || 'Unknown Album';

  if (data.artworkUrl) {
    elements.albumArt.src = data.artworkUrl;
    elements.albumArt.classList.add('show');
    if (data.spotifyUrl) {
      elements.albumArt.title = 'Open in Spotify';
      elements.albumArt.onclick = () => window.musicAPI.openExternal(data.spotifyUrl);
    }
  } else {
    elements.albumArt.classList.remove('show');
  }

  if (data.duration && data.position !== undefined) {
    const positionDiff = Math.abs(data.position - internalPosition);
    const needsHardSync = trackChanged || positionDiff > 1.0 || internalPosition === 0;

    if (needsHardSync) {
      internalPosition = data.position;
      isTrackChanging = false;
    }

    internalIsPlaying = data.isPlaying;
    lastSyncTime = Date.now();

    elements.duration.textContent = formatTime(data.duration);

    if (!internalAnimationRunning) {
      startInternalTimer();
    }
  }

  updatePlayPauseButton(data.isPlaying);

  updateDetails(data);
}

function updateDetails(data) {
  elements.year.textContent = data.year && data.year !== '0' ? `Year: ${data.year}` : '';
  elements.genre.textContent = data.genre ? `Genre: ${data.genre}` : '';
  elements.bpm.textContent = data.bpm && data.bpm !== '0' ? `${data.bpm} BPM` : '';

  if (data.playCount && data.playCount !== '0') {
    elements.playCount.textContent = `Played: ${data.playCount} times`;
  } else {
    elements.playCount.textContent = '';
  }

  if (data.rating && data.rating > 0) {
    elements.rating.textContent = formatRating(data.rating);
    elements.rating.classList.add('rating');
  } else {
    elements.rating.textContent = '';
  }
}

function clearDetails() {
  Object.values(elements).forEach(el => {
    if (el && el.id && (el.id === 'year' || el.id === 'genre' ||
        el.id === 'bpm' || el.id === 'playCount' || el.id === 'rating')) {
      el.textContent = '';
    }
  });
}

window.musicAPI.onUpdate(updateDisplay);

window.musicAPI.onLyricsUpdate((lyricsData) => {
  if (lyricsData === null) {
    if (!isTrackChanging) {
      lyricsHandler.showLoading();
      setTimeout(() => {
        if (!lyricsHandler.lyrics.length) {
          lyricsHandler.showNotAvailable();
        }
      }, 2000);
    }
  } else {
    lyricsHandler.setLyrics(lyricsData);
    if (!isTrackChanging && currentMusicData && currentMusicData.position !== undefined) {
      lyricsHandler.updatePosition(internalPosition);
    }
  }
});

class MetadataHandler {
  constructor() {
    this.bioExpanded = false;
    this.fullBio = '';
    this.currentImageIndex = 0;
    this.artistImages = [];
  }

  init() {
    this.elements = {
      container: document.getElementById('metadataContainer'),
      artistInfo: document.getElementById('artistInfo'),
      artistAlternateName: document.getElementById('artistAlternateName'),
      artistCountry: document.getElementById('artistCountry'),
      artistBornYear: document.getElementById('artistBornYear'),
      artistDiedYear: document.getElementById('artistDiedYear'),
      artistGenre: document.getElementById('artistGenre'),
      artistLinks: document.getElementById('artistLinks'),
      artistWebsite: document.getElementById('artistWebsite'),
      artistFacebook: document.getElementById('artistFacebook'),
      artistTwitter: document.getElementById('artistTwitter'),
      artistListeners: document.getElementById('artistListeners'),
      artistPlaycount: document.getElementById('artistPlaycount'),
      trackPlaycount: document.getElementById('trackPlaycount'),
      artistProfile: document.getElementById('artistProfile'),
      tags: document.getElementById('metadataTags'),
      bioSummary: document.getElementById('bioSummary'),
      bioExpand: document.getElementById('bioExpand'),
      similarArtists: document.getElementById('similarArtists'),
      metadataBio: document.getElementById('metadataBio'),
      metadataSimilar: document.getElementById('metadataSimilar'),
      carouselTrack: document.getElementById('carouselTrack'),
      carouselPrev: document.getElementById('carouselPrev'),
      carouselNext: document.getElementById('carouselNext'),
      artistImagesCarousel: document.getElementById('artistImagesCarousel'),
      topTracksList: document.getElementById('topTracksList'),
      topTracksSection: document.getElementById('topTracksSection'),
      topAlbumsGrid: document.getElementById('topAlbumsGrid'),
      topAlbumsSection: document.getElementById('topAlbumsSection'),
      imageModal: document.getElementById('imageModal'),
      modalImage: document.getElementById('modalImage'),
      modalClose: document.getElementById('modalClose'),
      modalDownload: document.getElementById('modalDownload')
    };

    this.elements.bioExpand.addEventListener('click', () => {
      this.toggleBio();
    });

    this.elements.carouselPrev.addEventListener('click', () => {
      this.navigateCarousel(-1);
    });

    this.elements.carouselNext.addEventListener('click', () => {
      this.navigateCarousel(1);
    });

    this.elements.modalClose.addEventListener('click', () => {
      this.closeModal();
    });

    this.elements.modalDownload.addEventListener('click', () => {
      this.downloadImage();
    });

    this.elements.imageModal.addEventListener('click', (e) => {
      if (e.target === this.elements.imageModal) {
        this.closeModal();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.elements.imageModal.style.display === 'flex') {
        this.closeModal();
      }
    });
  }

  update(metadata) {
    if (!metadata) {
      this.clear();
      return;
    }

    this.elements.container.style.display = 'block';

    // Update artist info (from TheAudioDB)
    if (metadata.artist) {
      let hasInfo = false;

      if (metadata.artist.alternateName && metadata.artist.alternateName.trim() !== '') {
        this.elements.artistAlternateName.removeAttribute('data-label');
        this.elements.artistAlternateName.textContent = metadata.artist.alternateName;
        this.elements.artistAlternateName.style.display = 'inline-block';
        hasInfo = true;
      } else {
        this.elements.artistAlternateName.style.display = 'none';
      }

      if (metadata.artist.country) {
        this.elements.artistCountry.setAttribute('data-label', '📍');
        this.elements.artistCountry.textContent = metadata.artist.country;
        this.elements.artistCountry.style.display = 'inline-block';
        hasInfo = true;
      } else {
        this.elements.artistCountry.style.display = 'none';
      }

      if (metadata.artist.bornYear || metadata.artist.formedYear) {
        const year = metadata.artist.bornYear || metadata.artist.formedYear;
        this.elements.artistBornYear.setAttribute('data-label', '🎂');
        this.elements.artistBornYear.textContent = year;
        this.elements.artistBornYear.style.display = 'inline-block';
        hasInfo = true;
      } else {
        this.elements.artistBornYear.style.display = 'none';
      }

      if (metadata.artist.diedYear) {
        this.elements.artistDiedYear.setAttribute('data-label', '†');
        this.elements.artistDiedYear.textContent = metadata.artist.diedYear;
        this.elements.artistDiedYear.style.display = 'inline-block';
        hasInfo = true;
      } else {
        this.elements.artistDiedYear.style.display = 'none';
      }

      if (metadata.artist.genre) {
        this.elements.artistGenre.setAttribute('data-label', '🎵');
        this.elements.artistGenre.textContent = metadata.artist.genre;
        this.elements.artistGenre.style.display = 'inline-block';
        hasInfo = true;
      } else {
        this.elements.artistGenre.style.display = 'none';
      }

      // Hide artist info container if no info available
      this.elements.artistInfo.style.display = hasInfo ? 'flex' : 'none';

      // Update social/website links
      let hasLinks = false;

      if (metadata.artist.website && metadata.artist.website.trim() !== '') {
        let url = metadata.artist.website;
        if (!url.startsWith('http')) url = 'https://' + url;
        this.elements.artistWebsite.href = url;
        this.elements.artistWebsite.textContent = '🌐 Website';
        this.elements.artistWebsite.style.display = 'inline-block';
        hasLinks = true;
      } else {
        this.elements.artistWebsite.style.display = 'none';
      }

      if (metadata.artist.facebook && metadata.artist.facebook.trim() !== '' && metadata.artist.facebook !== '1') {
        const fbUrl = metadata.artist.facebook.startsWith('http')
          ? metadata.artist.facebook
          : 'https://facebook.com/' + metadata.artist.facebook;
        this.elements.artistFacebook.href = fbUrl;
        this.elements.artistFacebook.textContent = '📘 Facebook';
        this.elements.artistFacebook.style.display = 'inline-block';
        hasLinks = true;
      } else {
        this.elements.artistFacebook.style.display = 'none';
      }

      if (metadata.artist.twitter && metadata.artist.twitter.trim() !== '' && metadata.artist.twitter !== '1') {
        const twUrl = metadata.artist.twitter.startsWith('http')
          ? metadata.artist.twitter
          : 'https://twitter.com/' + metadata.artist.twitter;
        this.elements.artistTwitter.href = twUrl;
        this.elements.artistTwitter.textContent = '🐦 Twitter';
        this.elements.artistTwitter.style.display = 'inline-block';
        hasLinks = true;
      } else {
        this.elements.artistTwitter.style.display = 'none';
      }

      // Hide links container if no links available
      this.elements.artistLinks.style.display = hasLinks ? 'flex' : 'none';
    }

    // Update stats
    if (metadata.artist) {
      if (metadata.artist.listeners) {
        this.elements.artistListeners.textContent = `👥 ${metadata.artist.listeners} listeners`;
        this.elements.artistListeners.style.display = 'inline-block';
      } else {
        this.elements.artistListeners.style.display = 'none';
      }

      if (metadata.artist.playcount) {
        this.elements.artistPlaycount.textContent = `▶ ${metadata.artist.playcount} plays`;
        this.elements.artistPlaycount.style.display = 'inline-block';
      } else {
        this.elements.artistPlaycount.style.display = 'none';
      }

      // Update tags
      if (metadata.artist.tags && metadata.artist.tags.length > 0) {
        this.elements.tags.innerHTML = '';
        metadata.artist.tags.forEach(tag => {
          const tagEl = document.createElement('span');
          tagEl.className = 'tag-pill';
          tagEl.textContent = tag;
          this.elements.tags.appendChild(tagEl);
        });
        this.elements.tags.style.display = 'flex';
      } else {
        this.elements.tags.style.display = 'none';
      }

      // Update bio
      if (metadata.artist.bio && metadata.artist.bio.summary) {
        const summary = metadata.artist.bio.summary;
        this.fullBio = metadata.artist.bio.content || summary;

        this.elements.bioSummary.textContent = summary;

        if (this.fullBio.length > summary.length && summary.endsWith('...')) {
          this.elements.bioExpand.style.display = 'inline-block';
        } else {
          this.elements.bioExpand.style.display = 'none';
        }
        this.elements.metadataBio.style.display = 'block';
      } else {
        this.elements.metadataBio.style.display = 'none';
      }

      // Update similar artists
      if (metadata.artist.similar && metadata.artist.similar.length > 0) {
        this.elements.similarArtists.innerHTML = '';
        metadata.artist.similar.forEach((artist, index) => {
          const artistEl = document.createElement('span');
          artistEl.className = 'similar-artist';
          artistEl.textContent = artist.name;
          artistEl.onclick = () => window.musicAPI.openExternal(artist.url);
          this.elements.similarArtists.appendChild(artistEl);

          if (index < metadata.artist.similar.length - 1) {
            const separator = document.createTextNode(', ');
            this.elements.similarArtists.appendChild(separator);
          }
        });
        this.elements.metadataSimilar.style.display = 'block';
      } else {
        this.elements.metadataSimilar.style.display = 'none';
      }
    }

    // Update track stats
    if (metadata.track && metadata.track.playcount) {
      this.elements.trackPlaycount.textContent = `🎵 ${metadata.track.playcount} track plays`;
      this.elements.trackPlaycount.style.display = 'inline-block';
    } else {
      this.elements.trackPlaycount.style.display = 'none';
    }

    // Update artist profile link
    if (metadata.artist && metadata.artist.url) {
      this.elements.artistProfile.href = metadata.artist.url;
      this.elements.artistProfile.textContent = '🔗 Artist Profile';
      this.elements.artistProfile.style.display = 'inline-block';
    } else {
      this.elements.artistProfile.style.display = 'none';
    }

    // Always show artist images carousel (TheAudioDB provides multiple fanart images)
    this.updateArtistImages(metadata.artist?.allImages || []);

    // Only show top tracks and albums if user is logged in to Spotify
    if (metadata.hasSpotifyData) {
      // Update top tracks (with Spotify data)
      this.updateTopTracks(metadata.topTracks || []);

      // Update top albums (with Spotify data)
      this.updateTopAlbums(metadata.topAlbums || []);
    } else {
      // User not logged in - hide Spotify-only sections
      this.elements.topTracksSection.style.display = 'none';
      this.elements.topAlbumsSection.style.display = 'none';
    }
  }

  async updateArtistImages(images) {
    this.artistImages = [];
    this.currentImageIndex = 0;
    this.elements.carouselTrack.innerHTML = '';

    const validImages = images.filter(img => img);

    if (validImages.length === 0) {
      this.elements.artistImagesCarousel.style.display = 'none';
      return;
    }

    // Cache all images and filter out failed ones
    const imageResults = await Promise.all(
      validImages.map(url => window.musicAPI.cacheImage(url))
    );

    const cachedImages = validImages
      .map((url, i) => ({ url, cached: imageResults[i] }))
      .filter(item => item.cached);

    // Only proceed if we have valid cached images
    if (cachedImages.length === 0) {
      this.elements.artistImagesCarousel.style.display = 'none';
      return;
    }

    // Create img elements for successfully cached images
    for (const { cached } of cachedImages) {
      const img = document.createElement('img');
      img.className = 'carousel-image';
      img.alt = 'Artist image';
      img.src = cached;

      img.onerror = () => {
        img.style.display = 'none';
      };

      img.onclick = () => this.openModal(cached);
      this.elements.carouselTrack.appendChild(img);
      this.artistImages.push(cached);
    }

    this.elements.artistImagesCarousel.style.display = 'block';
    this.updateCarouselPosition();
  }

  async updateTopTracks(tracks) {
    if (tracks.length > 0) {
      this.elements.topTracksList.innerHTML = '';

      for (const track of tracks) {
        const trackEl = document.createElement('div');
        trackEl.className = 'top-track-item';

        const img = document.createElement('img');
        img.className = 'track-image';
        img.alt = track.name;

        if (track.image) {
          const cachedImage = await window.musicAPI.cacheImage(track.image);
          img.src = cachedImage || track.image;
        }

        const info = document.createElement('div');
        info.className = 'track-info-mini';

        const name = document.createElement('div');
        name.className = 'track-name';
        name.textContent = track.name;

        const plays = document.createElement('div');
        plays.className = 'track-plays';
        plays.textContent = `${track.playcount} plays`;

        info.appendChild(name);
        info.appendChild(plays);

        trackEl.appendChild(img);
        trackEl.appendChild(info);

        trackEl.onclick = () => {
          const spotifySearchUrl = `spotify:search:${encodeURIComponent(track.name + ' ' + track.artist)}`;
          window.musicAPI.openExternal(spotifySearchUrl);
        };

        this.elements.topTracksList.appendChild(trackEl);
      }

      this.elements.topTracksSection.style.display = 'block';
    } else {
      this.elements.topTracksSection.style.display = 'none';
    }
  }

  async updateTopAlbums(albums) {
    if (albums.length > 0) {
      this.elements.topAlbumsGrid.innerHTML = '';

      for (const album of albums) {
        const albumEl = document.createElement('div');
        albumEl.className = 'top-album-item';

        const img = document.createElement('img');
        img.className = 'album-artwork';
        img.alt = album.name;

        if (album.image) {
          const cachedImage = await window.musicAPI.cacheImage(album.image);
          img.src = cachedImage || album.image;
        }

        const name = document.createElement('div');
        name.className = 'album-name';
        name.textContent = album.name;

        const plays = document.createElement('div');
        plays.className = 'album-plays';
        plays.textContent = `${album.playcount} plays`;

        albumEl.appendChild(img);
        albumEl.appendChild(name);
        albumEl.appendChild(plays);

        albumEl.onclick = () => {
          window.musicAPI.openExternal(album.url);
        };

        this.elements.topAlbumsGrid.appendChild(albumEl);
      }

      this.elements.topAlbumsSection.style.display = 'block';
    } else {
      this.elements.topAlbumsSection.style.display = 'none';
    }
  }

  navigateCarousel(direction) {
    if (this.artistImages.length === 0) return;

    this.currentImageIndex += direction;
    if (this.currentImageIndex < 0) {
      this.currentImageIndex = this.artistImages.length - 1;
    } else if (this.currentImageIndex >= this.artistImages.length) {
      this.currentImageIndex = 0;
    }

    this.updateCarouselPosition();
  }

  updateCarouselPosition() {
    const imageWidth = 120;
    const offset = -this.currentImageIndex * imageWidth;
    this.elements.carouselTrack.style.transform = `translateX(${offset}px)`;
  }

  openModal(imageUrl) {
    this.elements.modalImage.src = imageUrl;
    this.elements.imageModal.style.display = 'flex';
  }

  closeModal() {
    this.elements.imageModal.style.display = 'none';
  }

  downloadImage() {
    const imageUrl = this.elements.modalImage.src;
    const link = document.createElement('a');
    link.href = imageUrl;
    link.download = 'artist-image.jpg';
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  toggleBio() {
    if (this.bioExpanded) {
      this.elements.bioSummary.textContent = this.fullBio.substring(0, 300) + '...';
      this.elements.bioExpand.textContent = 'Show more';
    } else {
      this.elements.bioSummary.textContent = this.fullBio;
      this.elements.bioExpand.textContent = 'Show less';
    }
    this.bioExpanded = !this.bioExpanded;
  }

  clear() {
    this.elements.container.style.display = 'none';
    this.elements.artistListeners.textContent = '';
    this.elements.artistPlaycount.textContent = '';
    this.elements.trackPlaycount.textContent = '';
    this.elements.artistProfile.style.display = 'none';
    this.elements.tags.innerHTML = '';
    this.elements.bioSummary.textContent = '';
    this.elements.similarArtists.innerHTML = '';
    this.elements.carouselTrack.innerHTML = '';
    this.elements.topTracksList.innerHTML = '';
    this.elements.topAlbumsGrid.innerHTML = '';
    this.elements.artistImagesCarousel.style.display = 'none';
    this.elements.topTracksSection.style.display = 'none';
    this.elements.topAlbumsSection.style.display = 'none';
    this.fullBio = '';
    this.bioExpanded = false;
    this.artistImages = [];
    this.currentImageIndex = 0;
  }
}

const metadataHandler = new MetadataHandler();

window.musicAPI.onMetadataUpdate((metadata) => {
  metadataHandler.update(metadata);
});

class SettingsHandler {
  constructor() {
    this.modal = null;
    this.settingsBtn = null;
    this.closeBtn = null;
    this.loggedInSection = null;
    this.loggedOutSection = null;
    this.loginBtn = null;
    this.logoutBtn = null;
    this.userAvatar = null;
    this.userName = null;
    this.userEmail = null;
    this.currentTab = 'general';
  }

  init() {
    this.modal = document.getElementById('settingsModal');
    this.settingsBtn = document.getElementById('settingsBtn');
    this.closeBtn = document.getElementById('settingsClose');
    this.loggedInSection = document.getElementById('spotifyLoggedIn');
    this.loggedOutSection = document.getElementById('spotifyLoggedOut');
    this.loginBtn = document.getElementById('spotifyLoginBtn');
    this.logoutBtn = document.getElementById('spotifyLogoutBtn');
    this.userAvatar = document.getElementById('userAvatar');
    this.userName = document.getElementById('userName');
    this.userEmail = document.getElementById('userEmail');

    this.initTabs();
    this.initCacheTab();
    this.initLogsTab();
    this.initLaunchAtLogin();
    this.initTrayLyrics();

    window.musicAPI.onOpenSettings(() => {
      this.show();
    });

    this.settingsBtn.addEventListener('click', async () => {
      await this.updateLoginStatus();
      if (this.currentTab === 'storage') {
        await this.loadCacheList();
      }
      this.show();
    });

    this.closeBtn.addEventListener('click', () => {
      this.hide();
    });

    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) {
        this.hide();
      }
    });

    this.loginBtn.addEventListener('click', () => {
      window.musicAPI.spotifyLogin();
    });

    this.logoutBtn.addEventListener('click', () => {
      window.musicAPI.spotifyLogout();
    });

    window.musicAPI.onSpotifyLoggedIn(() => {
      this.updateLoginStatus();
    });

    window.musicAPI.onSpotifyLoggedOut(() => {
      this.updateLoginStatus();
    });

    window.musicAPI.onSpotifyLoginError((error) => {
      console.error('Spotify login error:', error);
      alert(`Login failed: ${error}`);
    });
  }

  async updateLoginStatus() {
    const isLoggedIn = await window.musicAPI.spotifyIsLoggedIn();

    if (isLoggedIn) {
      const profile = await window.musicAPI.spotifyGetUserProfile();

      if (profile) {
        if (profile.imageUrl) {
          this.userAvatar.src = profile.imageUrl;
          this.userAvatar.style.display = 'block';
        } else {
          this.userAvatar.style.display = 'none';
        }

        this.userName.textContent = profile.displayName || 'Spotify User';

        if (profile.email) {
          this.userEmail.textContent = profile.email;
          this.userEmail.style.display = 'block';
        } else {
          this.userEmail.style.display = 'none';
        }
      }

      this.loggedOutSection.style.display = 'none';
      this.loggedInSection.style.display = 'flex';
    } else {
      this.loggedInSection.style.display = 'none';
      this.loggedOutSection.style.display = 'flex';
    }
  }

  show() {
    this.modal.style.display = 'flex';
  }

  hide() {
    this.modal.style.display = 'none';
  }

  initTabs() {
    const tabs = document.querySelectorAll('.settings-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const tabName = tab.dataset.tab;
        this.switchTab(tabName);
      });
    });
  }

  switchTab(tabName) {
    this.currentTab = tabName;

    document.querySelectorAll('.settings-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.tab === tabName);
    });

    document.querySelectorAll('.settings-section').forEach(section => {
      section.style.display = section.id === `tab-${tabName}` ? 'block' : 'none';
    });

    if (tabName === 'storage') {
      this.loadCacheList();
    }

    if (tabName === 'logs') {
      this.loadLogsStats();
    }
  }

  initCacheTab() {
    const clearAllBtn = document.getElementById('cacheClearAllBtn');
    clearAllBtn.addEventListener('click', async () => {
      if (confirm('Are you sure you want to clear all caches? This cannot be undone.')) {
        await window.musicAPI.cacheClearAll();
        await this.loadCacheList();
      }
    });
  }

  initLogsTab() {
    const openFolderBtn = document.getElementById('logsOpenFolderBtn');
    const clearBtn = document.getElementById('logsClearBtn');

    openFolderBtn.addEventListener('click', async () => {
      await window.musicAPI.logsOpenFolder();
    });

    clearBtn.addEventListener('click', async () => {
      if (confirm('Are you sure you want to clear all logs? This cannot be undone.')) {
        const success = await window.musicAPI.logsClear();
        if (success) {
          await this.loadLogsStats();
        }
      }
    });
  }

  async loadLogsStats() {
    const statsEl = document.getElementById('logsStatsText');
    const pathEl = document.getElementById('logsPath');

    try {
      const stats = await window.musicAPI.logsGetStats();
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
      statsEl.textContent = `${stats.count} log files • ${sizeMB} MB`;
      pathEl.textContent = stats.path;
    } catch (error) {
      statsEl.textContent = 'Unable to load log stats';
      pathEl.textContent = '~/Library/Logs/LyricGlow';
    }
  }

  async initLaunchAtLogin() {
    const checkbox = document.getElementById('settings-launch-at-login');
    if (!checkbox) return;

    const enabled = await window.musicAPI.getLaunchAtLogin();
    checkbox.checked = enabled;

    const label = checkbox.closest('.visibility-option');
    if (label) {
      label.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        checkbox.checked = !checkbox.checked;
        await window.musicAPI.setLaunchAtLogin(checkbox.checked);
      });
    }
  }

  async initTrayLyrics() {
    const checkbox = document.getElementById('settings-tray-lyrics');
    if (!checkbox) return;

    const enabled = await window.musicAPI.getTrayLyrics();
    checkbox.checked = enabled;

    const label = checkbox.closest('.visibility-option');
    if (label) {
      label.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        checkbox.checked = !checkbox.checked;
        await window.musicAPI.setTrayLyrics(checkbox.checked);
      });
    }
  }

  async loadCacheList() {
    const entries = await window.musicAPI.cacheList();
    const statsEl = document.getElementById('cacheStatsText');
    const listEl = document.getElementById('cacheList');

    if (entries.length === 0) {
      statsEl.textContent = 'No cached items';
      listEl.innerHTML = '<div class="cache-empty">Cache is empty</div>';
      return;
    }

    const totalSize = entries.reduce((sum, e) => sum + e.size, 0);
    const totalSizeMB = (totalSize / 1024 / 1024).toFixed(2);
    statsEl.textContent = `${entries.length} items • ${totalSizeMB} MB`;

    listEl.innerHTML = '';
    entries.forEach(entry => {
      const item = document.createElement('div');
      item.className = 'cache-item';

      const icon = this.getCacheIcon(entry.type);
      const title = this.formatCacheTitle(entry.key);
      const sizeMB = (entry.size / 1024 / 1024).toFixed(2);
      const date = this.formatDate(entry.timestamp);

      item.innerHTML = `
        <div class="cache-item-icon">${icon}</div>
        <div class="cache-item-info">
          <div class="cache-item-title">${title}</div>
          <div class="cache-item-meta">${sizeMB} MB • ${date}</div>
        </div>
        <button class="cache-item-delete" data-type="${entry.type}" data-key="${entry.key}">×</button>
      `;

      const deleteBtn = item.querySelector('.cache-item-delete');
      deleteBtn.addEventListener('click', async () => {
        const success = await window.musicAPI.cacheDelete(entry.type, entry.key);
        if (success) {
          item.remove();
          await this.loadCacheList();
        }
      });

      listEl.appendChild(item);
    });
  }

  getCacheIcon(type) {
    const icons = {
      'lyrics': '🎵',
      'images': '🖼️',
      'metadata': '📊'
    };
    return icons[type] || '📁';
  }

  formatCacheTitle(key) {
    if (key.length > 50) {
      return key.substring(0, 47) + '...';
    }
    return key;
  }

  formatDate(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  }
}

class UIVisibilityManager {
  constructor() {
    this.sections = ['player', 'lyrics', 'images', 'info', 'bio', 'tracks', 'albums', 'similar'];
    this.settings = {};
  }

  async init() {
    this.settings = await window.musicAPI.visibilityGet();
    this.applyAll();
    this.bindCheckboxes();
    this.bindResetButton();
  }

  applyAll() {
    this.sections.forEach(section => {
      this.applyVisibility(section, this.settings[section]);
    });
  }

  applyVisibility(section, visible) {
    const elements = document.querySelectorAll(`[data-section="${section}"]`);
    elements.forEach(el => {
      el.setAttribute('data-visible', visible ? 'true' : 'false');
    });
  }

  bindCheckboxes() {
    this.sections.forEach(section => {
      const checkbox = document.getElementById(`visibility-${section}`);
      if (checkbox) {
        checkbox.checked = this.settings[section];
        
        const label = checkbox.closest('.visibility-option');
        if (label) {
          label.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            checkbox.checked = !checkbox.checked;
            const visible = checkbox.checked;
            
            this.settings[section] = visible;
            this.applyVisibility(section, visible);
            await window.musicAPI.visibilitySet(section, visible);
          });
        }
      }
    });
  }

  bindResetButton() {
    const resetBtn = document.getElementById('resetVisibilityBtn');
    if (resetBtn) {
      resetBtn.addEventListener('click', async () => {
        await window.musicAPI.visibilityReset();
        this.settings = await window.musicAPI.visibilityGet();
        this.applyAll();
        this.sections.forEach(section => {
          const checkbox = document.getElementById(`visibility-${section}`);
          if (checkbox) {
            checkbox.checked = this.settings[section];
          }
        });
      });
    }
  }
}

const visibilityManager = new UIVisibilityManager();
const settingsHandler = new SettingsHandler();

// Enable horizontal scrolling with vertical wheel for all horizontal scroll containers
function initHorizontalScrolling() {
  const horizontalScrollContainers = [
    document.getElementById('topTracksList'),
    document.getElementById('carouselTrack')?.parentElement,
    document.querySelector('.artist-images-carousel')
  ].filter(el => el);

  horizontalScrollContainers.forEach(container => {
    container.addEventListener('wheel', (e) => {
      if (e.deltaY !== 0) {
        e.preventDefault();
        container.scrollLeft += e.deltaY;
      }
    }, { passive: false });
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  lyricsHandler.init();
  fullLyricsModal.init();
  metadataHandler.init();
  settingsHandler.init();
  await visibilityManager.init();
  initProgressBarSeek();
  initHorizontalScrolling();
  updateDisplay(null);

  if (elements.closeBtn) {
    elements.closeBtn.addEventListener('click', () => {
      window.musicAPI.quit();
    });
  }

  if (elements.playPauseBtn) {
    elements.playPauseBtn.addEventListener('click', () => {
      if (currentMusicData && currentMusicData.nowPlayingAvailable) {
        window.musicAPI.playPause();
      }
    });
  }

  if (elements.previousBtn) {
    elements.previousBtn.addEventListener('click', () => {
      if (currentMusicData && currentMusicData.nowPlayingAvailable) {
        window.musicAPI.previousTrack();
      }
    });
  }

  if (elements.nextBtn) {
    elements.nextBtn.addEventListener('click', () => {
      if (currentMusicData && currentMusicData.nowPlayingAvailable) {
        window.musicAPI.nextTrack();
      }
    });
  }
});