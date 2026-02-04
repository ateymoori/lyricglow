/**
 * Renderer Process
 *
 * Main UI logic for the LyricGlow application.
 * Handles music display, lyrics synchronization, metadata, and settings.
 */

// Type definitions
export {}; // Make this file a module
interface MusicData {
  title: string;
  artist: string;
  album: string;
  duration: number;
  position: number;
  isPlaying: boolean;
  nowPlayingAvailable: boolean;
  artworkUrl?: string;
  spotifyUrl?: string;
  popularity?: number;
  trackNumber?: number;
  discNumber?: number;
  year?: string;
  genre?: string;
  rating?: number;
  playCount?: number;
  bpm?: number;
  trackCount?: number;
  discCount?: number;
}

interface LyricsData {
  synced: string | null;
  plain: string | null;
  instrumental: boolean;
}

interface LyricLine {
  time: number;
  text: string;
}

interface SyncData {
  currentLine: LyricLine;
  prevLine: LyricLine | null;
  nextLine: LyricLine | null;
  currentIndex: number;
  totalLines: number;
  isRTL: boolean;
  position: number;
  // Translation data
  currentTranslation: string | null;
  prevTranslation: string | null;
  nextTranslation: string | null;
  isTranslationRTL: boolean;
}

interface CacheEntry {
  type: string;
  key: string;
  size: number;
  timestamp: number;
}

interface WordState {
  glowing: boolean;
  intensity: number;
}

interface MetadataArtist {
  name?: string;
  alternateName?: string;
  country?: string;
  bornYear?: string;
  formedYear?: string;
  diedYear?: string;
  genre?: string;
  website?: string;
  facebook?: string;
  twitter?: string;
  listeners?: string;
  playcount?: string;
  tags?: string[];
  bio?: {
    summary: string;
    content: string;
  };
  similar?: Array<{ name: string; url: string }>;
  url?: string;
  allImages?: string[];
}

interface MetadataTrack {
  playcount?: string;
}

interface Metadata {
  artist: MetadataArtist;
  track?: MetadataTrack;
  topTracks?: Array<{
    name: string;
    playcount: string | number;
    image: string | null;
    artist: string;
    url?: string;
  }>;
  topAlbums?: Array<{
    name: string;
    playcount: string;
    image: string | null;
    artist: string;
    url: string;
  }>;
  hasSpotifyData?: boolean;
}

// Extend global Window type to include musicAPI
declare global {
  interface Window {
    musicAPI: {
      onUpdate: (callback: (payload: MusicData) => void) => void;
      onLyricsUpdate: (callback: (payload: LyricsData) => void) => void;
      onMetadataUpdate: (callback: (payload: Metadata) => void) => void;
      onPermissionError: (callback: () => void) => void;
      onPermissionGranted: (callback: () => void) => void;
      updateTrayLyrics: (text: string) => void;
      quit: () => void;
      closeWindow: () => void;
      openExternal: (url: string) => void;
      cacheImage: (url: string) => Promise<string | null>;
      seek: (position: number) => void;
      playPause: () => void;
      nextTrack: () => void;
      previousTrack: () => void;
      spotifyIsLoggedIn: () => Promise<boolean>;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      spotifyGetUserProfile: () => Promise<any>;
      spotifyLogin: () => void;
      spotifyLogout: () => void;
      onSpotifyLoggedIn: (callback: () => void) => void;
      onSpotifyLoggedOut: (callback: () => void) => void;
      onSpotifyLoginError: (callback: (error: string) => void) => void;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cacheList: () => Promise<any[]>;
      cacheDelete: (type: string, key: string) => Promise<boolean>;
      cacheClearAll: () => Promise<boolean>;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      visibilityGet: (key?: string) => Promise<any>;
      visibilitySet: (key: string, value: boolean) => Promise<boolean>;
      visibilityReset: () => Promise<boolean>;
      getLaunchAtLogin: () => Promise<boolean>;
      setLaunchAtLogin: (enabled: boolean) => Promise<boolean>;
      getTrayLyrics: () => Promise<boolean>;
      setTrayLyrics: (enabled: boolean) => Promise<boolean>;
      onOpenSettings: (callback: () => void) => void;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      logsGetStats: () => Promise<any>;
      logsOpenFolder: () => Promise<boolean>;
      logsClear: () => Promise<boolean>;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onTranslationUpdate: (callback: (payload: any) => void) => void;
      translationGetEnabled: () => Promise<boolean>;
      translationSetEnabled: (enabled: boolean) => Promise<boolean>;
      translationGetTargetLang: () => Promise<string>;
      translationSetTargetLang: (langCode: string) => Promise<boolean>;
      translationGetLanguages: () => Promise<
        Array<{ code: string; name: string; rtl: boolean }>
      >;
      translationRefresh: () => Promise<boolean>;
    };
  }
}

const elements = {
  title: document.getElementById('title') as HTMLElement,
  artist: document.getElementById('artist') as HTMLElement,
  album: document.getElementById('album') as HTMLElement,
  albumArt: document.getElementById('albumArt') as HTMLImageElement,
  progressBar: document.getElementById('progressBar') as HTMLElement,
  currentTime: document.getElementById('currentTime') as HTMLElement,
  duration: document.getElementById('duration') as HTMLElement,
  playPauseBtn: document.getElementById('playPauseBtn') as HTMLElement,
  previousBtn: document.getElementById('previousBtn') as HTMLElement,
  nextBtn: document.getElementById('nextBtn') as HTMLElement,
  closeBtn: document.getElementById('closeBtn') as HTMLElement,
  year: document.getElementById('year') as HTMLElement,
  genre: document.getElementById('genre') as HTMLElement,
  bpm: document.getElementById('bpm') as HTMLElement,
  playCount: document.getElementById('playCount') as HTMLElement,
  rating: document.getElementById('rating') as HTMLElement,
  // Vinyl disc elements
  vinylPlayer: document.getElementById('vinylPlayer') as HTMLElement,
  vinylDisc: document.getElementById('vinylDisc') as HTMLElement,
  vinylProgressFill: document.getElementById(
    'vinylProgressFill',
  ) as unknown as SVGPathElement,
};

// Progress bar seeking functionality
let isDragging = false;
let progressBarContainer: HTMLElement | null = null;
let pendingSeekPosition: number | null = null;

function updateSeekUI(e: MouseEvent): void {
  if (!currentMusicData || !currentMusicData.duration || !progressBarContainer)
    return;

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

function commitSeek(): void {
  if (pendingSeekPosition !== null) {
    window.musicAPI.seek(pendingSeekPosition);
    pendingSeekPosition = null;
  }
}

function initProgressBarSeek(): void {
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

function updatePlayPauseButton(isPlaying: boolean): void {
  const playIcon = elements.playPauseBtn.querySelector(
    '.play-icon',
  ) as HTMLElement;
  const pauseIcon = elements.playPauseBtn.querySelector(
    '.pause-icon',
  ) as HTMLElement;

  if (isPlaying) {
    playIcon.style.display = 'none';
    pauseIcon.style.display = 'block';
  } else {
    playIcon.style.display = 'block';
    pauseIcon.style.display = 'none';
  }
}

/**
 * VinylDiscController: Manages the vinyl disc animation and progress
 *
 * Features:
 * - Rotation animation synced to playback state
 * - Radial progress arc (expands from center like gramophone)
 * - Smooth transitions
 */
class VinylDiscController {
  private isPlaying: boolean;
  private readonly centerX = 50;
  private readonly centerY = 50;
  private readonly innerRadius = 24; // Start from center (near album art)
  private readonly outerRadius = 48; // Expand to edge

  constructor() {
    this.isPlaying = false;
  }

  /**
   * Create SVG arc path for radial progress
   * Progress expands from inner radius to outer radius
   */
  private createArcPath(progress: number): string {
    if (progress <= 0) return '';

    const clampedProgress = Math.max(0, Math.min(1, progress));

    // Calculate the current radius based on progress
    const currentRadius =
      this.innerRadius +
      (this.outerRadius - this.innerRadius) * clampedProgress;

    // Full circle arc from inner to current radius
    // We draw a donut/ring shape
    const innerR = this.innerRadius;
    const outerR = currentRadius;

    // Create a full ring (donut) path
    return `
      M ${this.centerX} ${this.centerY - outerR}
      A ${outerR} ${outerR} 0 1 1 ${this.centerX - 0.001} ${this.centerY - outerR}
      L ${this.centerX - 0.001} ${this.centerY - innerR}
      A ${innerR} ${innerR} 0 1 0 ${this.centerX} ${this.centerY - innerR}
      Z
    `;
  }

  /**
   * Update the radial progress based on playback position
   * @param progress - Value from 0 to 1
   */
  updateProgress(progress: number): void {
    if (!elements.vinylProgressFill) return;

    const path = this.createArcPath(progress);
    elements.vinylProgressFill.setAttribute('d', path);
  }

  /**
   * Set playing state (controls rotation animation)
   */
  setPlaying(playing: boolean): void {
    if (this.isPlaying === playing) return;
    this.isPlaying = playing;

    if (elements.vinylDisc) {
      if (playing) {
        elements.vinylDisc.classList.add('playing');
      } else {
        elements.vinylDisc.classList.remove('playing');
      }
    }
  }

  /**
   * Show the vinyl player
   */
  show(): void {
    if (elements.vinylPlayer) {
      elements.vinylPlayer.classList.add('show');
    }
  }

  /**
   * Hide the vinyl player
   */
  hide(): void {
    if (elements.vinylPlayer) {
      elements.vinylPlayer.classList.remove('show');
    }
    this.setPlaying(false);
    this.updateProgress(0);
  }

  /**
   * Reset to initial state
   */
  reset(): void {
    this.updateProgress(0);
    this.setPlaying(false);
  }
}

// Create vinyl disc controller instance
const vinylDiscController = new VinylDiscController();

/**
 * LyricsSyncManager: Single source of truth for lyrics state
 *
 * This class manages all lyrics state and coordinates atomic updates
 * across display locations (main app window, full lyrics modal).
 *
 * Design principles:
 * - Single source of truth: All lyrics state lives here
 * - Atomic broadcast: All displays update simultaneously from same data
 * - No duplication: Logic exists in one place only
 * - Pure consumers: Display components are stateless UI renderers
 *
 * NOTE: Tray lyrics are now managed independently by main process
 */
class LyricsSyncManager {
  lyrics: LyricLine[];
  currentIndex: number;
  currentPosition: number;
  isRTL: boolean;
  state: 'empty' | 'loading' | 'unavailable' | 'instrumental' | 'ready';
  mainDisplay: LyricsMainDisplay | null;
  modalDisplay: FullLyricsModalDisplay | null;

  // Translation state
  translations: string[];
  isTranslationRTL: boolean;
  translationLang: string;

  constructor() {
    // Single source of truth for lyrics state
    this.lyrics = [];
    this.currentIndex = -1;
    this.currentPosition = 0;
    this.isRTL = false;
    this.state = 'empty'; // empty | loading | unavailable | instrumental | ready

    // Translation state
    this.translations = [];
    this.isTranslationRTL = false;
    this.translationLang = '';

    // Display references (injected after construction)
    this.mainDisplay = null;
    this.modalDisplay = null;
  }

  /**
   * Parse LRC format into structured lyrics array
   * Format: [MM:SS.CS]Text
   */
  parseLRC(content: string): LyricLine[] {
    if (!content) return [];

    const lines = content.split('\n');
    const lyrics: LyricLine[] = [];

    for (const line of lines) {
      const match = line.match(/^\[(\d{2}):(\d{2})\.(\d{2})\](.*)$/);
      if (match?.[1] && match[2] && match[3] && match[4] !== undefined) {
        const minutes = match[1];
        const seconds = match[2];
        const centiseconds = match[3];
        const text = match[4];
        const time =
          parseInt(minutes, 10) * 60 +
          parseInt(seconds, 10) +
          parseInt(centiseconds, 10) / 100;
        lyrics.push({ time, text: text.trim() });
      }
    }

    return lyrics.sort((a, b) => a.time - b.time);
  }

  /**
   * Set lyrics from IPC event (single entry point)
   */
  setLyrics(lyricsData: LyricsData | null): void {
    // Handle unavailable lyrics
    if (!lyricsData || !lyricsData.synced) {
      this.clear();
      this.state = 'unavailable';
      this.broadcastState();
      return;
    }

    // Handle instrumental tracks
    if (lyricsData.instrumental) {
      this.clear();
      this.state = 'instrumental';
      this.broadcastState();
      return;
    }

    // Parse and store lyrics
    this.lyrics = this.parseLRC(lyricsData.synced);
    this.currentIndex = 0;
    this.state = 'ready';

    // Detect text direction once for all displays
    if (this.lyrics.length > 0 && this.lyrics[0]) {
      this.isRTL = this.detectRTL(this.lyrics[0].text);
    }

    this.broadcastState();
    this.broadcast(); // Initial display
  }

  /**
   * Update playback position and trigger sync if line changed
   * Called from animation loop (60 FPS)
   */
  updatePosition(position: number): void {
    if (this.state !== 'ready' || !this.lyrics.length) return;

    this.currentPosition = position;
    const newIndex = this.findCurrentIndex(position);

    // Only broadcast when line changes (atomic update)
    if (newIndex !== this.currentIndex) {
      this.currentIndex = newIndex;
      this.broadcast(); // ← Single atomic update to ALL displays
    }
  }

  /**
   * Find current lyric line index based on position
   */
  findCurrentIndex(position: number): number {
    if (!this.lyrics.length) return -1;

    // Show first line if before first timestamp
    const firstLine = this.lyrics[0];
    if (firstLine && position < firstLine.time) return 0;

    // Find the last line whose timestamp has passed
    for (let i = this.lyrics.length - 1; i >= 0; i--) {
      const line = this.lyrics[i];
      if (line && position >= line.time) return i;
    }

    return 0;
  }

  /**
   * ATOMIC BROADCAST: Update all three displays simultaneously
   * This is the core synchronization mechanism
   */
  broadcast(): void {
    if (this.state !== 'ready' || this.currentIndex < 0) return;

    const currentLine = this.lyrics[this.currentIndex];
    if (!currentLine) return; // Guard against undefined

    const prevLine =
      this.currentIndex > 0 ? this.lyrics[this.currentIndex - 1] || null : null;
    const nextLine =
      this.currentIndex < this.lyrics.length - 1
        ? this.lyrics[this.currentIndex + 1] || null
        : null;

    // Get translations for current lines
    const currentTranslation = this.translations[this.currentIndex] || null;
    const prevTranslation =
      this.currentIndex > 0
        ? this.translations[this.currentIndex - 1] || null
        : null;
    const nextTranslation =
      this.currentIndex < this.translations.length - 1
        ? this.translations[this.currentIndex + 1] || null
        : null;

    // Prepare sync data payload
    const syncData: SyncData = {
      currentLine,
      prevLine,
      nextLine,
      currentIndex: this.currentIndex,
      totalLines: this.lyrics.length,
      isRTL: this.isRTL,
      position: this.currentPosition,
      // Translation data
      currentTranslation,
      prevTranslation,
      nextTranslation,
      isTranslationRTL: this.isTranslationRTL,
    };

    // 1. Update main app display (3-line view with word glow)
    if (this.mainDisplay) {
      this.mainDisplay.render(syncData);
    }

    // 2. Update modal display (full lyrics scroll)
    if (this.modalDisplay) {
      this.modalDisplay.updateCurrent(syncData);
    }

    // NOTE: Tray lyrics now managed by main process independently
    // Renderer only handles window display (no tray IPC)
  }

  /**
   * Broadcast state changes (loading, unavailable, instrumental)
   */
  broadcastState(): void {
    if (this.mainDisplay) {
      this.mainDisplay.setState(this.state);
    }

    if (this.modalDisplay) {
      this.modalDisplay.setState(this.state);
    }

    // NOTE: Tray clearing handled by main process
  }

  /**
   * Detect RTL languages (Arabic, Persian, Hebrew)
   */
  detectRTL(text: string): boolean {
    const rtlChars =
      /[\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
    return rtlChars.test(text);
  }

  /**
   * Show loading state
   */
  showLoading(): void {
    this.clear();
    this.state = 'loading';
    this.broadcastState();
  }

  /**
   * Clear all lyrics state
   */
  clear(): void {
    this.lyrics = [];
    this.currentIndex = -1;
    this.currentPosition = 0;
    this.isRTL = false;
    this.state = 'empty';
    this.translations = [];
    this.isTranslationRTL = false;
    this.translationLang = '';
  }

  /**
   * Set translations from IPC event
   */
  setTranslations(data: {
    translations: string[];
    targetLang: string;
    isTargetRTL: boolean;
  }): void {
    if (!data || !data.translations) return;

    this.translations = data.translations;
    this.translationLang = data.targetLang;
    this.isTranslationRTL = data.isTargetRTL;

    // Re-broadcast to update displays with translations
    if (this.state === 'ready') {
      this.broadcast();
    }
  }
}

/**
 * LyricsMainDisplay: Pure UI component for 3-line lyrics display
 *
 * Responsibilities:
 * - Render previous/current/next lines
 * - Display word-by-word glow effect
 * - Handle text direction (LTR/RTL)
 *
 * Does NOT manage state - receives all data from LyricsSyncManager
 */
class LyricsMainDisplay {
  container: HTMLElement | null;
  elements: {
    previous: HTMLElement | null;
    current: HTMLElement | null;
    next: HTMLElement | null;
    currentText: HTMLElement | null;
    previousTranslation: HTMLElement | null;
    currentTranslation: HTMLElement | null;
    nextTranslation: HTMLElement | null;
  };
  cachedWords: HTMLElement[];
  wordStates: WordState[];
  lastGlowUpdate: number;
  glowUpdateInterval: number;
  currentSyncData: SyncData | null;

  constructor() {
    this.container = null;
    this.elements = {
      previous: null,
      current: null,
      next: null,
      currentText: null,
      previousTranslation: null,
      currentTranslation: null,
      nextTranslation: null,
    };

    // Word glow state (managed per current line)
    this.cachedWords = [];
    this.wordStates = [];
    this.lastGlowUpdate = 0;
    this.glowUpdateInterval = 33; // 30 FPS for word glow

    // Store current sync data for glow calculation
    this.currentSyncData = null;
  }

  init(): void {
    this.container = document.getElementById('lyricsContainer');
    this.elements = {
      previous: document.getElementById('lyricsPrevious'),
      current: document.getElementById('lyricsCurrent'),
      next: document.getElementById('lyricsNext'),
      currentText: document.querySelector('#lyricsCurrent .lyrics-text'),
      previousTranslation: document.getElementById('lyricsPreviousTranslation'),
      currentTranslation: document.getElementById('lyricsCurrentTranslation'),
      nextTranslation: document.getElementById('lyricsNextTranslation'),
    };
  }

  /**
   * Render 3-line display from sync data (pure function)
   * Called by LyricsSyncManager when line changes
   */
  render(syncData: SyncData): void {
    this.currentSyncData = syncData;

    // Update previous and next lines
    if (this.elements.previous) {
      this.elements.previous.textContent = syncData.prevLine?.text || '';
    }
    if (this.elements.next) {
      this.elements.next.textContent = syncData.nextLine?.text || '';
    }

    // Update current line with word spans
    this.setCurrentLine(syncData.currentLine.text, syncData.isRTL);

    // Update translations (if available)
    this.renderTranslations(syncData);
  }

  /**
   * Render translation lines below original lyrics
   */
  renderTranslations(syncData: SyncData): void {
    const hasTranslation =
      syncData.currentTranslation ||
      syncData.prevTranslation ||
      syncData.nextTranslation;

    // Show/hide translation container
    if (this.container) {
      if (hasTranslation) {
        this.container.classList.add('has-translation');
      } else {
        this.container.classList.remove('has-translation');
      }
    }

    // Update translation text
    if (this.elements.previousTranslation) {
      this.elements.previousTranslation.textContent =
        syncData.prevTranslation || '';
      this.elements.previousTranslation.style.direction =
        syncData.isTranslationRTL ? 'rtl' : 'ltr';
    }
    if (this.elements.currentTranslation) {
      this.elements.currentTranslation.textContent =
        syncData.currentTranslation || '';
      this.elements.currentTranslation.style.direction =
        syncData.isTranslationRTL ? 'rtl' : 'ltr';
    }
    if (this.elements.nextTranslation) {
      this.elements.nextTranslation.textContent =
        syncData.nextTranslation || '';
      this.elements.nextTranslation.style.direction = syncData.isTranslationRTL
        ? 'rtl'
        : 'ltr';
    }
  }

  /**
   * Create word spans for current line
   */
  setCurrentLine(text: string, isRTL: boolean): void {
    if (!this.elements.currentText) return;

    const words = text.split(' ').filter((w) => w.length > 0);

    // Clear and rebuild
    this.elements.currentText.innerHTML = '';
    this.elements.currentText.style.direction = isRTL ? 'rtl' : 'ltr';

    this.cachedWords = [];
    this.wordStates = [];

    words.forEach((word, index) => {
      const span = document.createElement('span');
      span.className = 'lyrics-word';
      span.textContent = word;
      this.elements.currentText?.appendChild(span);

      this.cachedWords.push(span);
      this.wordStates.push({ glowing: false, intensity: 0 });

      // Add space between words
      if (index < words.length - 1) {
        this.elements.currentText?.appendChild(document.createTextNode(' '));
      }
    });
  }

  /**
   * Update word glow effect (called from animation loop at 60 FPS)
   * Throttled internally to 30 FPS for performance
   */
  updateGlow(position: number): void {
    if (!this.currentSyncData || !this.currentSyncData.nextLine) return;

    // Throttle to 30 FPS
    const now = Date.now();
    if (now - this.lastGlowUpdate < this.glowUpdateInterval) return;
    this.lastGlowUpdate = now;

    const { currentLine, nextLine } = this.currentSyncData;
    const duration = nextLine.time - currentLine.time;
    const elapsed = position - currentLine.time;
    const progress = Math.min(1, Math.max(0, elapsed / duration));

    this.applyWordGlow(progress);
  }

  /**
   * Apply glow effect to words based on progress (0 to 1)
   */
  applyWordGlow(progress: number): void {
    if (!this.cachedWords.length) return;

    const totalWords = this.cachedWords.length;
    const glowPosition = progress * totalWords;

    this.cachedWords.forEach((word, index) => {
      const wordProgress = Math.min(1, Math.max(0, glowPosition - index));
      const shouldGlow = wordProgress > 0;

      // Fade in effect: 0-0.5 = fade, 0.5-1.0 = full glow
      const newIntensity = shouldGlow
        ? wordProgress > 0.5
          ? 1
          : wordProgress * 2
        : 0;

      const state = this.wordStates[index];
      if (!state) return; // Skip if state doesn't exist

      // Only update DOM if state changed (performance)
      if (
        shouldGlow !== state.glowing ||
        Math.abs(newIntensity - state.intensity) > 0.01
      ) {
        state.glowing = shouldGlow;
        state.intensity = newIntensity;

        if (shouldGlow) {
          word.style.setProperty('--glow-intensity', String(newIntensity));
          word.classList.add('glowing');
        } else {
          word.classList.remove('glowing');
          word.style.removeProperty('--glow-intensity');
        }
      }
    });
  }

  /**
   * Set display state (loading, unavailable, instrumental, ready)
   */
  setState(state: string): void {
    if (!this.container) return;

    if (state === 'ready') {
      this.container.removeAttribute('data-state');
    } else {
      this.container.setAttribute('data-state', state);
      this.clear();
    }
  }

  /**
   * Clear display
   */
  clear(): void {
    if (this.elements.previous) this.elements.previous.textContent = '';
    if (this.elements.currentText) this.elements.currentText.innerHTML = '';
    if (this.elements.next) this.elements.next.textContent = '';
    if (this.elements.previousTranslation)
      this.elements.previousTranslation.textContent = '';
    if (this.elements.currentTranslation)
      this.elements.currentTranslation.textContent = '';
    if (this.elements.nextTranslation)
      this.elements.nextTranslation.textContent = '';
    if (this.container) this.container.classList.remove('has-translation');
    this.cachedWords = [];
    this.wordStates = [];
    this.currentSyncData = null;
    this.lastGlowUpdate = 0;
  }
}

/**
 * FullLyricsModalDisplay: Pure UI component for full lyrics modal
 *
 * Responsibilities:
 * - Display all lyrics in scrollable view
 * - Highlight current line
 * - Auto-scroll to current line
 *
 * Does NOT manage state - receives all data from LyricsSyncManager
 */
class FullLyricsModalDisplay {
  syncManager: LyricsSyncManager;
  modal: HTMLElement | null;
  elements: {
    body: HTMLElement | null;
    text: HTMLElement | null;
    closeBtn: HTMLElement | null;
    openBtn: HTMLElement | null;
  };
  isOpen: boolean;
  autoScrollEnabled: boolean;

  constructor(syncManager: LyricsSyncManager) {
    this.syncManager = syncManager;
    this.modal = null;
    this.elements = {
      body: null,
      text: null,
      closeBtn: null,
      openBtn: null,
    };
    this.isOpen = false;
    this.autoScrollEnabled = true;
  }

  init(): void {
    this.modal = document.getElementById('fullLyricsModal');
    this.elements = {
      body: document.getElementById('fullLyricsBody'),
      text: document.getElementById('fullLyricsText'),
      closeBtn: document.getElementById('fullLyricsClose'),
      openBtn: document.getElementById('fullLyricsBtn'),
    };

    // Event listeners
    if (this.elements.openBtn) {
      this.elements.openBtn.addEventListener('click', () => {
        this.show();
      });
    }

    if (this.elements.closeBtn) {
      this.elements.closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.hide();
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        this.hide();
      }
    });

    // Disable auto-scroll on user interaction
    if (this.elements.body) {
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
  }

  show(): void {
    if (!currentMusicData || !currentMusicData.title || !this.modal) {
      return;
    }

    this.updateLyrics();
    this.modal.style.display = 'flex';
    this.isOpen = true;
    this.autoScrollEnabled = true;

    setTimeout(() => this.scrollToCurrentLine(), 100);
  }

  hide(): void {
    if (!this.modal) return;
    this.modal.style.display = 'none';
    this.isOpen = false;
  }

  /**
   * Refresh entire lyrics list (called when lyrics change)
   */
  refresh(): void {
    if (!this.isOpen) return;

    this.updateLyrics();
    this.autoScrollEnabled = true;
    if (this.elements.body) {
      this.elements.body.scrollTop = 0;
    }

    setTimeout(() => this.scrollToCurrentLine(), 100);
  }

  /**
   * Rebuild full lyrics list from sync manager
   */
  updateLyrics(): void {
    const textEl = this.elements.text;
    if (!textEl) return;

    const state = this.syncManager.state;
    const lyrics = this.syncManager.lyrics;

    // Handle special states
    if (state === 'loading') {
      textEl.setAttribute('data-state', 'loading');
      textEl.textContent = 'Loading lyrics...';
      return;
    }

    if (state === 'unavailable') {
      textEl.setAttribute('data-state', 'unavailable');
      textEl.textContent = 'No lyrics available';
      return;
    }

    if (state === 'instrumental') {
      textEl.setAttribute('data-state', 'instrumental');
      textEl.textContent = '♪ Instrumental ♪';
      return;
    }

    if (state !== 'ready' || !lyrics.length) {
      textEl.setAttribute('data-state', 'unavailable');
      textEl.textContent = 'No lyrics available';
      return;
    }

    // Render all lyrics
    textEl.removeAttribute('data-state');
    textEl.innerHTML = '';
    textEl.style.direction = this.syncManager.isRTL ? 'rtl' : 'ltr';

    lyrics.forEach((line, index) => {
      const lineEl = document.createElement('div');
      lineEl.className = 'lyrics-line';
      lineEl.textContent = line.text || ' ';
      lineEl.dataset.index = String(index);
      lineEl.dataset.time = String(line.time);

      if (index === this.syncManager.currentIndex) {
        lineEl.classList.add('current');
      }

      if (!line.text || line.text.trim() === '') {
        lineEl.classList.add('empty');
      }

      textEl.appendChild(lineEl);
    });
  }

  /**
   * Update current line highlight (called by LyricsSyncManager on broadcast)
   */
  updateCurrent(syncData: SyncData): void {
    if (!this.isOpen || !this.elements.text) return;

    const lines = this.elements.text.querySelectorAll('.lyrics-line');
    lines.forEach((line, index) => {
      if (index === syncData.currentIndex) {
        line.classList.add('current');
      } else {
        line.classList.remove('current');
      }
    });

    this.scrollToCurrentLine();
  }

  /**
   * Scroll to current line if auto-scroll enabled
   */
  scrollToCurrentLine(): void {
    if (!this.autoScrollEnabled || !this.elements.text) return;

    const currentLine = this.elements.text.querySelector(
      '.lyrics-line.current',
    );
    if (currentLine) {
      currentLine.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }

  /**
   * Set state for modal display
   */
  setState(_state: string): void {
    // State is already handled in updateLyrics()
    // This is called for consistency with LyricsMainDisplay
  }
}

// ═══════════════════════════════════════════════════════════════════
// Initialize unified sync system
// ═══════════════════════════════════════════════════════════════════

const lyricsSyncManager = new LyricsSyncManager();
const lyricsMainDisplay = new LyricsMainDisplay();
const fullLyricsModalDisplay = new FullLyricsModalDisplay(lyricsSyncManager);

// Connect displays to sync manager for atomic updates
lyricsSyncManager.mainDisplay = lyricsMainDisplay;
lyricsSyncManager.modalDisplay = fullLyricsModalDisplay;

// ═══════════════════════════════════════════════════════════════════

let currentMusicData: MusicData | null = null;
let previousTrackKey: string | null = null;

let internalPosition = 0;
let internalIsPlaying = false;
let lastSyncTime = Date.now();
let internalAnimationRunning = false;
let isTrackChanging = false;
let hasPermissionError = false;

function startInternalTimer(): void {
  if (internalAnimationRunning) return;
  internalAnimationRunning = true;
  updateInternalPosition();
}

/**
 * Main animation loop (60 FPS)
 *
 * Updates:
 * - Progress bar
 * - Time display
 * - Lyrics sync (atomic update via LyricsSyncManager)
 * - Word glow effect (high FPS for smoothness)
 */
function updateInternalPosition(): void {
  if (internalIsPlaying && currentMusicData && currentMusicData.duration) {
    const now = Date.now();
    const elapsed = (now - lastSyncTime) / 1000;
    internalPosition += elapsed;
    lastSyncTime = now;

    if (internalPosition > currentMusicData.duration) {
      internalPosition = currentMusicData.duration;
    }

    // Update progress bar (linear)
    const progress = (internalPosition / currentMusicData.duration) * 100;
    elements.progressBar.style.width = `${progress}%`;
    elements.currentTime.textContent = formatTime(internalPosition);

    // Update vinyl disc progress (circular)
    vinylDiscController.updateProgress(
      internalPosition / currentMusicData.duration,
    );

    // ★★★ ATOMIC SYNC ★★★
    // Update position in sync manager (broadcasts to all displays when line changes)
    lyricsSyncManager.updatePosition(internalPosition);

    // Update word glow separately (needs 60 FPS, throttled internally to 30 FPS)
    lyricsMainDisplay.updateGlow(internalPosition);
  }

  requestAnimationFrame(updateInternalPosition);
}

function formatTime(seconds: number): string {
  if (!seconds || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatRating(rating: number): string {
  if (!rating || rating === 0) return '';
  const stars = Math.round(rating / 20);
  return '★'.repeat(stars) + '☆'.repeat(5 - stars);
}

function updateDisplay(data: MusicData | null): void {
  currentMusicData = data;

  if (!data || !data.nowPlayingAvailable) {
    document.body.classList.add('no-music');

    // Show appropriate message based on permission state
    if (hasPermissionError) {
      elements.title.textContent = 'Permission Required';
      elements.artist.textContent =
        'LyricGlow needs permission to read music data';
      elements.album.textContent =
        'System Settings → Privacy & Security → Automation → Enable Music for LyricGlow';
    } else {
      elements.title.textContent = 'No music playing';
      elements.artist.textContent = '';
      elements.album.textContent = '';
    }

    elements.albumArt.classList.remove('show');
    vinylDiscController.hide();
    elements.progressBar.style.width = '0%';
    elements.currentTime.textContent = '0:00';
    elements.duration.textContent = '0:00';
    updatePlayPauseButton(false);
    clearDetails();
    lyricsSyncManager.clear();
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
    lyricsSyncManager.clear();
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
    vinylDiscController.show();
    if (data.spotifyUrl) {
      elements.albumArt.title = 'Open in Spotify';
      elements.albumArt.onclick = () =>
        window.musicAPI.openExternal(data.spotifyUrl!);
      if (elements.vinylDisc) {
        elements.vinylDisc.title = 'Open in Spotify';
        elements.vinylDisc.onclick = () =>
          window.musicAPI.openExternal(data.spotifyUrl!);
      }
    }
  } else {
    elements.albumArt.classList.remove('show');
    vinylDiscController.show(); // Still show vinyl even without artwork
  }

  // Update vinyl rotation based on playback state
  vinylDiscController.setPlaying(data.isPlaying);

  if (data.duration && data.position !== undefined) {
    const positionDiff = Math.abs(data.position - internalPosition);
    const needsHardSync =
      trackChanged || positionDiff > 1.0 || internalPosition === 0;

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
  vinylDiscController.setPlaying(data.isPlaying);

  updateDetails(data);
}

function updateDetails(data: MusicData): void {
  elements.year.textContent =
    data.year && data.year !== '0' ? `Year: ${data.year}` : '';
  elements.genre.textContent = data.genre ? `Genre: ${data.genre}` : '';
  elements.bpm.textContent =
    data.bpm && data.bpm !== 0 ? `${data.bpm} BPM` : '';

  if (data.playCount && data.playCount !== 0) {
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

function clearDetails(): void {
  Object.values(elements).forEach((el) => {
    if (
      el?.id &&
      (el.id === 'year' ||
        el.id === 'genre' ||
        el.id === 'bpm' ||
        el.id === 'playCount' ||
        el.id === 'rating')
    ) {
      el.textContent = '';
    }
  });
}

window.musicAPI.onUpdate(updateDisplay);

// Permission error handlers
window.musicAPI.onPermissionError(() => {
  hasPermissionError = true;
  updateDisplay(null); // Refresh display to show permission message
});

window.musicAPI.onPermissionGranted(() => {
  hasPermissionError = false;
  // Display will update automatically when music data comes through
});

/**
 * Lyrics IPC handler: Single entry point for lyrics updates
 * Coordinates updates to all three displays atomically
 */
window.musicAPI.onLyricsUpdate((lyricsData: LyricsData | null) => {
  if (lyricsData === null) {
    // Show loading state if not during track change
    if (!isTrackChanging) {
      lyricsSyncManager.showLoading();
      setTimeout(() => {
        if (lyricsSyncManager.state === 'loading') {
          lyricsSyncManager.clear();
          lyricsSyncManager.state = 'unavailable';
          lyricsSyncManager.broadcastState();
        }
      }, 2000);
    }
  } else {
    // Set lyrics in sync manager (broadcasts atomically to all displays)
    lyricsSyncManager.setLyrics(lyricsData);

    // Refresh modal if open
    fullLyricsModalDisplay.refresh();

    // Update position if we have valid data
    if (
      !isTrackChanging &&
      currentMusicData &&
      currentMusicData.position !== undefined
    ) {
      lyricsSyncManager.updatePosition(internalPosition);
    }
  }
});

/**
 * Translation IPC handler: Receives async translations from main process
 */
window.musicAPI.onTranslationUpdate(
  (
    translationData: {
      translations: string[];
      targetLang: string;
      isTargetRTL: boolean;
    } | null,
  ) => {
    if (translationData) {
      lyricsSyncManager.setTranslations(translationData);
    }
  },
);

class MetadataHandler {
  bioExpanded: boolean;
  fullBio: string;
  currentImageIndex: number;
  artistImages: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  elements: any;

  constructor() {
    this.bioExpanded = false;
    this.fullBio = '';
    this.currentImageIndex = 0;
    this.artistImages = [];
    this.elements = {};
  }

  init(): void {
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
      modalDownload: document.getElementById('modalDownload'),
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

    this.elements.modalClose.addEventListener('click', (e: Event) => {
      e.stopPropagation();
      this.closeModal();
    });

    this.elements.modalDownload.addEventListener('click', (e: Event) => {
      e.stopPropagation();
      this.downloadImage();
    });

    this.elements.imageModal.addEventListener('click', (e: MouseEvent) => {
      if (e.target === this.elements.imageModal) {
        this.closeModal();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (
        e.key === 'Escape' &&
        this.elements.imageModal.style.display === 'flex'
      ) {
        this.closeModal();
      }
    });
  }

  update(metadata: Metadata | null): void {
    if (!metadata) {
      this.clear();
      return;
    }

    this.elements.container.style.display = 'block';

    // Update artist info (from TheAudioDB)
    if (metadata.artist) {
      let hasInfo = false;

      if (
        metadata.artist.alternateName &&
        metadata.artist.alternateName.trim() !== ''
      ) {
        this.elements.artistAlternateName.removeAttribute('data-label');
        this.elements.artistAlternateName.textContent =
          metadata.artist.alternateName;
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
        if (!url.startsWith('http')) url = `https://${url}`;
        this.elements.artistWebsite.href = url;
        this.elements.artistWebsite.textContent = '🌐 Website';
        this.elements.artistWebsite.style.display = 'inline-block';
        hasLinks = true;
      } else {
        this.elements.artistWebsite.style.display = 'none';
      }

      if (
        metadata.artist.facebook &&
        metadata.artist.facebook.trim() !== '' &&
        metadata.artist.facebook !== '1'
      ) {
        const fbUrl = metadata.artist.facebook.startsWith('http')
          ? metadata.artist.facebook
          : `https://facebook.com/${metadata.artist.facebook}`;
        this.elements.artistFacebook.href = fbUrl;
        this.elements.artistFacebook.textContent = '📘 Facebook';
        this.elements.artistFacebook.style.display = 'inline-block';
        hasLinks = true;
      } else {
        this.elements.artistFacebook.style.display = 'none';
      }

      if (
        metadata.artist.twitter &&
        metadata.artist.twitter.trim() !== '' &&
        metadata.artist.twitter !== '1'
      ) {
        const twUrl = metadata.artist.twitter.startsWith('http')
          ? metadata.artist.twitter
          : `https://twitter.com/${metadata.artist.twitter}`;
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
        metadata.artist.tags.forEach((tag) => {
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
      if (metadata.artist.bio?.summary) {
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

          if (index < (metadata.artist.similar?.length ?? 0) - 1) {
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
    if (metadata.track?.playcount) {
      this.elements.trackPlaycount.textContent = `🎵 ${metadata.track.playcount} track plays`;
      this.elements.trackPlaycount.style.display = 'inline-block';
    } else {
      this.elements.trackPlaycount.style.display = 'none';
    }

    // Update artist profile link
    if (metadata.artist?.url) {
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

  async updateArtistImages(images: string[]): Promise<void> {
    this.artistImages = [];
    this.currentImageIndex = 0;
    this.elements.carouselTrack.innerHTML = '';

    const validImages = images.filter((img) => img);

    if (validImages.length === 0) {
      this.elements.artistImagesCarousel.style.display = 'none';
      return;
    }

    // Cache all images and filter out failed ones
    const imageResults = await Promise.all(
      validImages.map((url) => window.musicAPI.cacheImage(url)),
    );

    const cachedImages = validImages
      .map((url, i) => ({ url, cached: imageResults[i] }))
      .filter(
        (item): item is { url: string; cached: string } => item.cached !== null,
      );

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

  async updateTopTracks(
    tracks: Array<{
      name: string;
      playcount: string | number;
      image: string | null;
      artist: string;
      url?: string;
    }>,
  ): Promise<void> {
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
          const spotifySearchUrl = `spotify:search:${encodeURIComponent(`${track.name} ${track.artist}`)}`;
          window.musicAPI.openExternal(spotifySearchUrl);
        };

        this.elements.topTracksList.appendChild(trackEl);
      }

      this.elements.topTracksSection.style.display = 'block';
    } else {
      this.elements.topTracksSection.style.display = 'none';
    }
  }

  async updateTopAlbums(
    albums: Array<{
      name: string;
      playcount: string;
      image: string | null;
      artist: string;
      url: string;
    }>,
  ): Promise<void> {
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

  navigateCarousel(direction: number): void {
    if (this.artistImages.length === 0) return;

    this.currentImageIndex += direction;
    if (this.currentImageIndex < 0) {
      this.currentImageIndex = this.artistImages.length - 1;
    } else if (this.currentImageIndex >= this.artistImages.length) {
      this.currentImageIndex = 0;
    }

    this.updateCarouselPosition();
  }

  updateCarouselPosition(): void {
    const imageWidth = 120;
    const offset = -this.currentImageIndex * imageWidth;
    this.elements.carouselTrack.style.transform = `translateX(${offset}px)`;
  }

  openModal(imageUrl: string): void {
    this.elements.modalImage.src = imageUrl;
    this.elements.imageModal.style.display = 'flex';
  }

  closeModal(): void {
    this.elements.imageModal.style.display = 'none';
  }

  downloadImage(): void {
    const imageUrl = this.elements.modalImage.src;

    // Create safe filename from artist and track names
    const artist = currentMusicData?.artist || 'Unknown';
    const track = currentMusicData?.title || 'Unknown';

    // Sanitize filename: remove/replace unsafe characters
    const sanitize = (str: string) =>
      str
        .replace(/[<>:"/\\|?*]/g, '') // Remove invalid filename chars
        .replace(/\s+/g, '_') // Replace spaces with underscores
        .replace(/_{2,}/g, '_') // Replace multiple underscores with single
        .replace(/^_|_$/g, '') // Remove leading/trailing underscores
        .substring(0, 100); // Limit length

    const safeArtist = sanitize(artist);
    const safeTrack = sanitize(track);
    const extension = imageUrl.includes('.png') ? 'png' : 'jpg';
    const filename = `${safeArtist}_-_${safeTrack}.${extension}`;

    const link = document.createElement('a');
    link.href = imageUrl;
    link.download = filename;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  toggleBio(): void {
    if (this.bioExpanded) {
      this.elements.bioSummary.textContent = `${this.fullBio.substring(0, 300)}...`;
      this.elements.bioExpand.textContent = 'Show more';
    } else {
      this.elements.bioSummary.textContent = this.fullBio;
      this.elements.bioExpand.textContent = 'Show less';
    }
    this.bioExpanded = !this.bioExpanded;
  }

  clear(): void {
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

window.musicAPI.onMetadataUpdate((metadata: Metadata | null) => {
  metadataHandler.update(metadata);
});

class SettingsHandler {
  modal: HTMLElement | null;
  settingsBtn: HTMLElement | null;
  closeBtn: HTMLElement | null;
  loggedInSection: HTMLElement | null;
  loggedOutSection: HTMLElement | null;
  loginBtn: HTMLElement | null;
  logoutBtn: HTMLElement | null;
  userAvatar: HTMLImageElement | null;
  userName: HTMLElement | null;
  userEmail: HTMLElement | null;
  currentTab: string;

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

  init(): void {
    this.modal = document.getElementById('settingsModal');
    this.settingsBtn = document.getElementById('settingsBtn');
    this.closeBtn = document.getElementById('settingsClose');
    this.loggedInSection = document.getElementById('spotifyLoggedIn');
    this.loggedOutSection = document.getElementById('spotifyLoggedOut');
    this.loginBtn = document.getElementById('spotifyLoginBtn');
    this.logoutBtn = document.getElementById('spotifyLogoutBtn');
    this.userAvatar = document.getElementById('userAvatar') as HTMLImageElement;
    this.userName = document.getElementById('userName');
    this.userEmail = document.getElementById('userEmail');

    this.initTabs();
    this.initCacheTab();
    this.initLogsTab();
    this.initLaunchAtLogin();
    this.initTrayLyrics();
    this.initTranslation();

    window.musicAPI.onOpenSettings(() => {
      this.show();
    });

    if (this.settingsBtn) {
      this.settingsBtn.addEventListener('click', async () => {
        await this.updateLoginStatus();
        if (this.currentTab === 'storage') {
          await this.loadCacheList();
        }
        this.show();
      });
    }

    if (this.closeBtn) {
      this.closeBtn.addEventListener('click', () => {
        this.hide();
      });
    }

    if (this.modal) {
      this.modal.addEventListener('click', (e) => {
        if (e.target === this.modal) {
          this.hide();
        }
      });
    }

    if (this.loginBtn) {
      this.loginBtn.addEventListener('click', () => {
        window.musicAPI.spotifyLogin();
      });
    }

    if (this.logoutBtn) {
      this.logoutBtn.addEventListener('click', () => {
        window.musicAPI.spotifyLogout();
      });
    }

    window.musicAPI.onSpotifyLoggedIn(() => {
      this.updateLoginStatus();
    });

    window.musicAPI.onSpotifyLoggedOut(() => {
      this.updateLoginStatus();
    });

    window.musicAPI.onSpotifyLoginError((error: string) => {
      console.error('Spotify login error:', error);
      alert(`Login failed: ${error}`);
    });
  }

  async updateLoginStatus(): Promise<void> {
    const isLoggedIn = await window.musicAPI.spotifyIsLoggedIn();

    if (isLoggedIn) {
      const profile = await window.musicAPI.spotifyGetUserProfile();

      if (profile && this.userAvatar && this.userName && this.userEmail) {
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

      if (this.loggedOutSection && this.loggedInSection) {
        this.loggedOutSection.style.display = 'none';
        this.loggedInSection.style.display = 'flex';
      }
    } else {
      if (this.loggedInSection && this.loggedOutSection) {
        this.loggedInSection.style.display = 'none';
        this.loggedOutSection.style.display = 'flex';
      }
    }
  }

  show(): void {
    if (this.modal) {
      this.modal.style.display = 'flex';
    }
  }

  hide(): void {
    if (this.modal) {
      this.modal.style.display = 'none';
    }
  }

  initTabs(): void {
    const tabs = document.querySelectorAll('.settings-tab');
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const tabName = (tab as HTMLElement).dataset.tab;
        if (tabName) {
          this.switchTab(tabName);
        }
      });
    });
  }

  switchTab(tabName: string): void {
    this.currentTab = tabName;

    document.querySelectorAll('.settings-tab').forEach((tab) => {
      tab.classList.toggle(
        'active',
        (tab as HTMLElement).dataset.tab === tabName,
      );
    });

    document.querySelectorAll('.settings-section').forEach((section) => {
      (section as HTMLElement).style.display =
        section.id === `tab-${tabName}` ? 'block' : 'none';
    });

    if (tabName === 'storage') {
      this.loadCacheList();
    }

    if (tabName === 'logs') {
      this.loadLogsStats();
    }
  }

  initCacheTab(): void {
    const clearAllBtn = document.getElementById('cacheClearAllBtn');
    if (clearAllBtn) {
      clearAllBtn.addEventListener('click', async () => {
        if (
          confirm(
            'Are you sure you want to clear all caches? This cannot be undone.',
          )
        ) {
          await window.musicAPI.cacheClearAll();
          await this.loadCacheList();
        }
      });
    }
  }

  initLogsTab(): void {
    const openFolderBtn = document.getElementById('logsOpenFolderBtn');
    const clearBtn = document.getElementById('logsClearBtn');

    if (openFolderBtn) {
      openFolderBtn.addEventListener('click', async () => {
        await window.musicAPI.logsOpenFolder();
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', async () => {
        if (
          confirm(
            'Are you sure you want to clear all logs? This cannot be undone.',
          )
        ) {
          const success = await window.musicAPI.logsClear();
          if (success) {
            await this.loadLogsStats();
          }
        }
      });
    }
  }

  async loadLogsStats(): Promise<void> {
    const statsEl = document.getElementById('logsStatsText');
    const pathEl = document.getElementById('logsPath');

    if (!statsEl || !pathEl) return;

    try {
      const stats = await window.musicAPI.logsGetStats();
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
      statsEl.textContent = `${stats.count} log files • ${sizeMB} MB`;
      pathEl.textContent = stats.path;
    } catch (_error) {
      statsEl.textContent = 'Unable to load log stats';
      pathEl.textContent = '~/Library/Logs/LyricGlow';
    }
  }

  async initLaunchAtLogin(): Promise<void> {
    const checkbox = document.getElementById(
      'settings-launch-at-login',
    ) as HTMLInputElement;
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

  async initTrayLyrics(): Promise<void> {
    const checkbox = document.getElementById(
      'settings-tray-lyrics',
    ) as HTMLInputElement;
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

  async initTranslation(): Promise<void> {
    const checkbox = document.getElementById(
      'settings-translation-enabled',
    ) as HTMLInputElement;
    const select = document.getElementById(
      'settings-translation-lang',
    ) as HTMLSelectElement;
    const langContainer = document.getElementById(
      'translation-lang-container',
    ) as HTMLElement;

    if (!checkbox || !select) return;

    // Load initial state
    const enabled = await window.musicAPI.translationGetEnabled();
    const targetLang = await window.musicAPI.translationGetTargetLang();
    const languages = await window.musicAPI.translationGetLanguages();

    checkbox.checked = enabled;

    // Populate language dropdown
    select.innerHTML = '';
    languages.forEach((lang) => {
      const option = document.createElement('option');
      option.value = lang.code;
      option.textContent = lang.name;
      if (lang.code === targetLang) {
        option.selected = true;
      }
      select.appendChild(option);
    });

    // Show/hide language selector based on enabled state
    if (langContainer) {
      langContainer.style.display = enabled ? 'flex' : 'none';
    }

    // Enable/disable toggle
    const enableLabel = checkbox.closest('.visibility-option');
    if (enableLabel) {
      enableLabel.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        checkbox.checked = !checkbox.checked;
        await window.musicAPI.translationSetEnabled(checkbox.checked);

        // Show/hide language selector
        if (langContainer) {
          langContainer.style.display = checkbox.checked ? 'flex' : 'none';
        }

        // Refresh translations immediately with new settings
        await window.musicAPI.translationRefresh();
      });
    }

    // Language change handler
    select.addEventListener('change', async () => {
      await window.musicAPI.translationSetTargetLang(select.value);
      // Refresh translations immediately with new language
      await window.musicAPI.translationRefresh();
    });
  }

  async loadCacheList(): Promise<void> {
    const entries = (await window.musicAPI.cacheList()) as CacheEntry[];
    const statsEl = document.getElementById('cacheStatsText');
    const listEl = document.getElementById('cacheList');

    if (!statsEl || !listEl) return;

    if (entries.length === 0) {
      statsEl.textContent = 'No cached items';
      listEl.innerHTML = '<div class="cache-empty">Cache is empty</div>';
      return;
    }

    const totalSize = entries.reduce(
      (sum: number, e: CacheEntry) => sum + e.size,
      0,
    );
    const totalSizeMB = (totalSize / 1024 / 1024).toFixed(2);
    statsEl.textContent = `${entries.length} items • ${totalSizeMB} MB`;

    listEl.innerHTML = '';
    entries.forEach((entry: CacheEntry) => {
      const item = document.createElement('div');
      item.className = 'cache-item';

      const icon = this.getCacheIcon(entry.type);
      const title = this.formatCacheTitle(entry.key, entry.type);
      const sizeMB = (entry.size / 1024 / 1024).toFixed(2);
      const date = this.formatDate(entry.timestamp);

      item.innerHTML = `
        <div class="cache-item-icon">${icon}</div>
        <div class="cache-item-info">
          <div class="cache-item-title">${title}</div>
          <div class="cache-item-meta">${sizeMB} MB • ${date}</div>
        </div>
        <button class="icon-btn icon-btn-danger cache-item-delete" data-type="${entry.type}" data-key="${entry.key}" title="Delete">×</button>
      `;

      const deleteBtn = item.querySelector('.cache-item-delete');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', async () => {
          const success = await window.musicAPI.cacheDelete(
            entry.type,
            entry.key,
          );
          if (success) {
            item.remove();
            await this.loadCacheList();
          }
        });
      }

      listEl.appendChild(item);
    });
  }

  getCacheIcon(type: string): string {
    const icons: { [key: string]: string } = {
      lyrics: '🎵',
      images: '🖼️',
      metadata: '📊',
      translations: '🌐',
    };
    return icons[type] || '📁';
  }

  formatCacheTitle(key: string, type: string): string {
    // Handle translation cache keys (format: "Song-Artist:langCode")
    if (type === 'translations' && key.includes(':')) {
      const [songArtist, langCode] = key.split(':');
      const langName = this.getLanguageName(langCode || '');
      if (songArtist && langName) {
        const displayKey =
          songArtist.length > 35
            ? `${songArtist.substring(0, 32)}...`
            : songArtist;
        return `${displayKey} → ${langName}`;
      }
    }

    if (key.length > 50) {
      return `${key.substring(0, 47)}...`;
    }
    return key;
  }

  getLanguageName(code: string): string {
    const languages: { [key: string]: string } = {
      en: 'English',
      es: 'Spanish',
      fr: 'French',
      de: 'German',
      it: 'Italian',
      pt: 'Portuguese',
      ru: 'Russian',
      ja: 'Japanese',
      ko: 'Korean',
      zh: 'Chinese',
      ar: 'Arabic',
      fa: 'Persian',
      he: 'Hebrew',
      hi: 'Hindi',
      tr: 'Turkish',
      nl: 'Dutch',
      pl: 'Polish',
      sv: 'Swedish',
      da: 'Danish',
      no: 'Norwegian',
      fi: 'Finnish',
      el: 'Greek',
      cs: 'Czech',
      hu: 'Hungarian',
      ro: 'Romanian',
      th: 'Thai',
      vi: 'Vietnamese',
      id: 'Indonesian',
      ms: 'Malay',
      uk: 'Ukrainian',
    };
    return languages[code] || code.toUpperCase();
  }

  formatDate(timestamp: number): string {
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
  sections: string[];
  settings: { [key: string]: boolean };

  constructor() {
    this.sections = [
      'player',
      'lyrics',
      'images',
      'info',
      'bio',
      'tracks',
      'albums',
      'similar',
    ];
    this.settings = {};
  }

  async init(): Promise<void> {
    this.settings = await window.musicAPI.visibilityGet();
    this.applyAll();
    this.bindCheckboxes();
    this.bindResetButton();
  }

  applyAll(): void {
    this.sections.forEach((section) => {
      const visible =
        this.settings[section] !== undefined ? this.settings[section] : true;
      this.applyVisibility(section, visible);
    });
  }

  applyVisibility(section: string, visible: boolean): void {
    const elements = document.querySelectorAll(`[data-section="${section}"]`);
    elements.forEach((el) => {
      el.setAttribute('data-visible', visible ? 'true' : 'false');
    });
  }

  bindCheckboxes(): void {
    this.sections.forEach((section) => {
      const checkbox = document.getElementById(
        `visibility-${section}`,
      ) as HTMLInputElement;
      if (checkbox) {
        checkbox.checked =
          this.settings[section] !== undefined ? this.settings[section] : true;

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

  bindResetButton(): void {
    const resetBtn = document.getElementById('resetVisibilityBtn');
    if (resetBtn) {
      resetBtn.addEventListener('click', async () => {
        await window.musicAPI.visibilityReset();
        this.settings = await window.musicAPI.visibilityGet();
        this.applyAll();
        this.sections.forEach((section) => {
          const checkbox = document.getElementById(
            `visibility-${section}`,
          ) as HTMLInputElement;
          if (checkbox) {
            checkbox.checked =
              this.settings[section] !== undefined
                ? this.settings[section]
                : true;
          }
        });
      });
    }
  }
}

const visibilityManager = new UIVisibilityManager();
const settingsHandler = new SettingsHandler();

// Enable horizontal scrolling with vertical wheel for all horizontal scroll containers
function initHorizontalScrolling(): void {
  const horizontalScrollContainers = [
    document.getElementById('topTracksList'),
    document.getElementById('carouselTrack')?.parentElement,
    document.querySelector('.artist-images-carousel'),
  ].filter((el): el is HTMLElement => el !== null);

  horizontalScrollContainers.forEach((container) => {
    container.addEventListener(
      'wheel',
      (e) => {
        if (e.deltaY !== 0) {
          e.preventDefault();
          container.scrollLeft += e.deltaY;
        }
      },
      { passive: false },
    );
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize displays
  lyricsMainDisplay.init();
  fullLyricsModalDisplay.init();
  metadataHandler.init();
  settingsHandler.init();
  await visibilityManager.init();
  initProgressBarSeek();
  initHorizontalScrolling();
  updateDisplay(null);

  if (elements.closeBtn) {
    elements.closeBtn.addEventListener('click', () => {
      window.musicAPI.closeWindow();
    });
  }

  if (elements.playPauseBtn) {
    elements.playPauseBtn.addEventListener('click', () => {
      if (currentMusicData?.nowPlayingAvailable) {
        window.musicAPI.playPause();
      }
    });
  }

  if (elements.previousBtn) {
    elements.previousBtn.addEventListener('click', () => {
      if (currentMusicData?.nowPlayingAvailable) {
        window.musicAPI.previousTrack();
      }
    });
  }

  if (elements.nextBtn) {
    elements.nextBtn.addEventListener('click', () => {
      if (currentMusicData?.nowPlayingAvailable) {
        window.musicAPI.nextTrack();
      }
    });
  }
});
