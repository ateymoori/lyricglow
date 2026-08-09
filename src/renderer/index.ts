/**
 * Renderer Process
 *
 * Main UI logic for the LyricGlow application.
 * Handles music display, lyrics synchronization, metadata, and settings.
 */

import { getLanguageName } from '../shared/constants/languages';
import { type LyricLine, parseLRC } from '../shared/utils/LrcParser';

// Type definitions
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
  bio?: {
    summary: string;
    content: string;
  };
  url?: string;
  allImages?: string[];
}

interface Metadata {
  artist: MetadataArtist;
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
      onTranslationStatus: (
        callback: (payload: { pending: boolean } | null) => void,
      ) => void;
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
};

// Honour the system setting for animation-heavy behaviour driven from JS
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// Fade-out half of the lyric line swap - keep in step with --duration-swap
const SWAP_DURATION = 80;

// How long a toast stays on screen
const TOAST_DURATION = 2600;

// macOS deep link straight to the Automation privacy pane
const AUTOMATION_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation';

// Remembers that the permission explainer has already been shown once
const PERMISSION_HINT_KEY = 'lyricglow.permissionHintShown';

// Keys that scroll a list, and so count as the user taking over
const SCROLL_KEYS = [
  'ArrowUp',
  'ArrowDown',
  'PageUp',
  'PageDown',
  'Home',
  'End',
  ' ',
];

/**
 * Transient message in the corner of the window.
 * Replaces the native alert() for things that need no answer.
 */
function showToast(message: string, variant: 'info' | 'error' = 'info'): void {
  const stack = document.getElementById('toastStack');
  if (!stack) return;

  const toast = document.createElement('div');
  toast.className = variant === 'error' ? 'toast error' : 'toast';
  toast.textContent = message;
  stack.appendChild(toast);

  // Next frame, so the entry transition actually runs
  requestAnimationFrame(() => toast.classList.add('show'));

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 250);
  }, TOAST_DURATION);
}

/**
 * In-app replacement for alert()/confirm().
 *
 * The native dialogs are Chromium chrome: they ignore the app's design, block
 * the whole renderer, and look wrong on a transparent glass window.
 */
function openDialog(options: {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  showCancel: boolean;
}): Promise<boolean> {
  const backdrop = document.getElementById('appDialog');
  const titleEl = document.getElementById('appDialogTitle');
  const messageEl = document.getElementById('appDialogMessage');
  const confirmBtn = document.getElementById('appDialogConfirm');
  const cancelBtn = document.getElementById('appDialogCancel');

  if (!backdrop || !titleEl || !messageEl || !confirmBtn || !cancelBtn) {
    return Promise.resolve(false);
  }

  titleEl.textContent = options.title;
  messageEl.textContent = options.message;
  confirmBtn.textContent = options.confirmLabel || 'OK';
  cancelBtn.textContent = options.cancelLabel || 'Cancel';
  cancelBtn.classList.toggle('hidden', !options.showCancel);
  backdrop.classList.add('show');

  return new Promise<boolean>((resolve) => {
    const close = (result: boolean) => {
      backdrop.classList.remove('show');
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
      backdrop.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };

    const onConfirm = () => close(true);
    const onCancel = () => close(false);
    const onBackdrop = (e: MouseEvent) => {
      if (e.target === backdrop) close(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false);
      if (e.key === 'Enter') close(true);
    };

    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
    backdrop.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey);

    (confirmBtn as HTMLButtonElement).focus();
  });
}

function showAlert(title: string, message: string): Promise<boolean> {
  return openDialog({ title, message, showCancel: false });
}

function showConfirm(
  title: string,
  message: string,
  confirmLabel = 'Confirm',
): Promise<boolean> {
  return openDialog({ title, message, confirmLabel, showCancel: true });
}

/**
 * Seek playback to a position and reflect it locally right away, so a click
 * feels instant instead of waiting for the next poll to come back.
 */
function seekTo(seconds: number): void {
  const position = Math.max(0, seconds);

  window.musicAPI.seek(position);

  internalPosition = position;
  lastSyncTime = Date.now();
  lyricsSyncManager.updatePosition(position);

  if (currentMusicData?.duration) {
    setProgressBar((position / currentMusicData.duration) * 100, true);
  }
  elements.currentTime.textContent = formatTime(position);
}

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

  setProgressBar(percentage * 100, true);
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
 * VinylDiscController: shows/hides the disc and tracks playback state.
 *
 * The radial progress arc this class used to redraw every frame was invisible
 * (.vinyl-progress is display:none), so that path is gone: it cost a string
 * build and an SVG attribute write 60 times a second and painted nothing.
 */
class VinylDiscController {
  private isPlaying: boolean;

  constructor() {
    this.isPlaying = false;
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

    // Parse and store lyrics (shared parser keeps indices aligned with the
    // menu bar sync loop and the translation list)
    this.lyrics = parseLRC(lyricsData.synced);
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
  private swapTimer: number | null = null;

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

    // Clicking the line above or below jumps there
    this.elements.previous?.addEventListener('click', () => {
      this.seekToLine(this.currentSyncData?.prevLine ?? null);
    });

    this.elements.next?.addEventListener('click', () => {
      this.seekToLine(this.currentSyncData?.nextLine ?? null);
    });
  }

  /**
   * Jump playback to a neighbouring lyric line
   */
  private seekToLine(line: LyricLine | null): void {
    if (!line || !line.text) return;
    seekTo(line.time);
  }

  /**
   * Render 3-line display from sync data
   *
   * The swap runs in two phases - the old lines fade and lift, the text is
   * replaced, the new lines settle back - because text content itself cannot
   * be transitioned. Only opacity and transform move, so it stays on the
   * compositor and the line never reflows.
   */
  render(syncData: SyncData): void {
    const isFirstLine = this.currentSyncData === null;
    this.currentSyncData = syncData;

    if (isFirstLine || reducedMotion.matches || !this.container) {
      this.applyLines();
      return;
    }

    this.container.classList.add('is-swapping');

    // A faster line arriving mid-swap replaces the pending one
    if (this.swapTimer !== null) clearTimeout(this.swapTimer);

    this.swapTimer = window.setTimeout(() => {
      this.swapTimer = null;
      this.applyLines();
      this.container?.classList.remove('is-swapping');
    }, SWAP_DURATION);
  }

  /**
   * Write the current sync data into the DOM (phase two of the swap)
   */
  private applyLines(): void {
    const syncData = this.currentSyncData;
    if (!syncData) return;

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
    // A pending swap must not repaint the line we are clearing
    if (this.swapTimer !== null) {
      clearTimeout(this.swapTimer);
      this.swapTimer = null;
    }
    this.container?.classList.remove('is-swapping');

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
  private resumeBtn: HTMLElement | null = null;
  private lineNodes: HTMLElement[] = [];
  private highlightedIndex = -1;

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
      if (!this.isOpen) return;

      if (e.key === 'Escape') {
        this.hide();
        return;
      }

      // Scrolling by keyboard is the user taking over too
      if (SCROLL_KEYS.includes(e.key)) {
        this.setAutoScroll(false);
      }
    });

    this.resumeBtn = document.getElementById('resumeScrollBtn');
    this.resumeBtn?.addEventListener('click', () => {
      this.setAutoScroll(true);
      this.scrollToCurrentLine();
    });

    // Only deliberate scrolling turns auto-scroll off. Listening to 'scroll'
    // here used to switch it off on the app's own scrollIntoView call, so
    // auto-scroll died on the very first line change.
    if (this.elements.body) {
      this.elements.body.addEventListener('wheel', () => {
        this.setAutoScroll(false);
      });

      // Scrollbar drag: a press to the right of the content box
      this.elements.body.addEventListener('mousedown', (e) => {
        const target = e.currentTarget as HTMLElement;
        if (e.offsetX > target.clientWidth) {
          this.setAutoScroll(false);
        }
      });
    }

    // Click any line to jump there
    this.elements.text?.addEventListener('click', (e) => {
      const line = (e.target as HTMLElement).closest(
        '.lyrics-line',
      ) as HTMLElement | null;
      if (!line?.dataset.time) return;

      const time = Number.parseFloat(line.dataset.time);
      if (Number.isNaN(time)) return;

      seekTo(time);
      this.setAutoScroll(true);
    });
  }

  /**
   * Toggle following the current line, and the pill that offers it back
   */
  private setAutoScroll(enabled: boolean): void {
    this.autoScrollEnabled = enabled;
    this.resumeBtn?.classList.toggle('show', !enabled && this.isOpen);
  }

  show(): void {
    if (!currentMusicData || !currentMusicData.title || !this.modal) {
      return;
    }

    this.updateLyrics();
    this.modal.style.display = 'flex';
    this.isOpen = true;
    this.setAutoScroll(true);

    setTimeout(() => this.scrollToCurrentLine(), 100);
  }

  hide(): void {
    if (!this.modal) return;
    this.modal.style.display = 'none';
    this.isOpen = false;
    this.resumeBtn?.classList.remove('show');
  }

  /**
   * Refresh entire lyrics list (called when lyrics change)
   */
  refresh(): void {
    if (!this.isOpen) return;

    this.updateLyrics();
    this.setAutoScroll(true);
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

    this.lineNodes = [];
    this.highlightedIndex = -1;

    const fragment = document.createDocumentFragment();

    lyrics.forEach((line, index) => {
      const lineEl = document.createElement('div');
      lineEl.className = 'lyrics-line';
      lineEl.textContent = line.text || ' ';
      lineEl.dataset.index = String(index);
      lineEl.dataset.time = String(line.time);
      lineEl.title = 'Jump to this line';

      if (index === this.syncManager.currentIndex) {
        lineEl.classList.add('current');
        this.highlightedIndex = index;
      }

      if (!line.text || line.text.trim() === '') {
        lineEl.classList.add('empty');
      }

      fragment.appendChild(lineEl);
      this.lineNodes.push(lineEl);
    });

    textEl.appendChild(fragment);
  }

  /**
   * Move the highlight to the current line.
   *
   * Touches only the two lines involved. Re-querying and re-classing every
   * line on each change was O(lines) work several times a minute.
   */
  updateCurrent(syncData: SyncData): void {
    if (!this.isOpen || !this.lineNodes.length) return;
    if (syncData.currentIndex === this.highlightedIndex) return;

    this.lineNodes[this.highlightedIndex]?.classList.remove('current');
    this.lineNodes[syncData.currentIndex]?.classList.add('current');
    this.highlightedIndex = syncData.currentIndex;

    this.scrollToCurrentLine();
  }

  /**
   * Scroll to current line if auto-scroll enabled
   */
  scrollToCurrentLine(): void {
    if (!this.autoScrollEnabled) return;

    const currentLine =
      this.lineNodes[this.highlightedIndex] ??
      this.elements.text?.querySelector('.lyrics-line.current');

    currentLine?.scrollIntoView({
      behavior: reducedMotion.matches ? 'auto' : 'smooth',
      block: 'center',
    });
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
let lastProgressWrite = 0;

// The progress bar transition covers the gap between writes
const PROGRESS_WRITE_INTERVAL = 1000;

function startInternalTimer(): void {
  if (internalAnimationRunning) return;
  internalAnimationRunning = true;
  updateInternalPosition();
}

/**
 * Move the progress bar.
 *
 * Written about once a second: the CSS transition on .progress-fill draws the
 * in-between frames, so writing it every frame only fought the transition.
 * Seeks pass immediate=true to jump instead of gliding.
 */
function setProgressBar(percent: number, immediate = false): void {
  const clamped = Math.max(0, Math.min(100, percent));

  if (immediate) {
    elements.progressBar.style.transition = 'none';
    elements.progressBar.style.width = `${clamped}%`;
    // Commit the jump before the transition comes back, otherwise the browser
    // collapses both changes into one recalc and animates the seek
    elements.progressBar.getBoundingClientRect();
    elements.progressBar.style.transition = '';
    lastProgressWrite = Date.now();
    return;
  }

  elements.progressBar.style.width = `${clamped}%`;
  lastProgressWrite = Date.now();
}

/**
 * Main animation loop
 *
 * Runs only while playback is running: lyrics sync and the word glow are the
 * only things that genuinely need frame-rate updates. The loop suspends itself
 * when paused and is restarted by updateDisplay().
 */
function updateInternalPosition(): void {
  if (!internalIsPlaying || !currentMusicData?.duration) {
    // Nothing is moving - stop burning frames until playback resumes
    internalAnimationRunning = false;
    return;
  }

  const now = Date.now();
  const elapsed = (now - lastSyncTime) / 1000;
  internalPosition += elapsed;
  lastSyncTime = now;

  if (internalPosition > currentMusicData.duration) {
    internalPosition = currentMusicData.duration;
  }

  // Progress bar and clock: ~1 Hz is all the resolution these have
  if (now - lastProgressWrite >= PROGRESS_WRITE_INTERVAL) {
    setProgressBar((internalPosition / currentMusicData.duration) * 100);
    elements.currentTime.textContent = formatTime(internalPosition);
  }

  // ★★★ ATOMIC SYNC ★★★
  // Update position in sync manager (broadcasts to all displays when line changes)
  lyricsSyncManager.updatePosition(internalPosition);

  // Update word glow separately (throttled internally to 30 FPS)
  lyricsMainDisplay.updateGlow(internalPosition);

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
    setProgressBar(0, true);
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
      // Jump rather than glide to the new position
      setProgressBar((internalPosition / data.duration) * 100, true);
      elements.currentTime.textContent = formatTime(internalPosition);
    }

    internalIsPlaying = data.isPlaying;
    lastSyncTime = Date.now();

    elements.duration.textContent = formatTime(data.duration);

    if (data.isPlaying) {
      // The loop suspends itself when paused, so resume it here
      startInternalTimer();
    } else {
      // Paused: paint the final position the loop will not draw
      setProgressBar((internalPosition / data.duration) * 100, true);
      elements.currentTime.textContent = formatTime(internalPosition);
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

/**
 * Explain the macOS Automation requirement the first time it bites.
 *
 * Previously the only clue was the track title turning into an error string,
 * which reads like a broken app rather than a one-time system permission.
 */
function showPermissionOnboarding(): void {
  document.body.classList.add('permission-needed');

  // Storage can be unavailable on a file:// origin; the inline notice above
  // still explains everything, so never let this throw
  try {
    if (localStorage.getItem(PERMISSION_HINT_KEY)) return;
    localStorage.setItem(PERMISSION_HINT_KEY, '1');
  } catch (_error) {
    // Fall through and show the dialog anyway
  }

  showConfirm(
    'One-time setup needed',
    'macOS has to allow LyricGlow to read what Spotify and Music are playing.\n\n' +
      'System Settings → Privacy & Security → Automation → LyricGlow → ' +
      'turn on Spotify and Music.',
    'Open Settings',
  ).then((openSettings) => {
    if (openSettings) {
      window.musicAPI.openExternal(AUTOMATION_SETTINGS_URL);
    }
  });
}

// Permission error handlers
window.musicAPI.onPermissionError(() => {
  hasPermissionError = true;
  showPermissionOnboarding();
  updateDisplay(null); // Refresh display to show permission message
});

window.musicAPI.onPermissionGranted(() => {
  hasPermissionError = false;
  document.body.classList.remove('permission-needed');
  // Display will update automatically when music data comes through
});

/**
 * Translation progress indicator
 */
window.musicAPI.onTranslationStatus((status: { pending: boolean } | null) => {
  document
    .getElementById('translatingIndicator')
    ?.classList.toggle('show', Boolean(status?.pending));
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
      artistProfile: document.getElementById('artistProfile'),
      bioSummary: document.getElementById('bioSummary'),
      bioExpand: document.getElementById('bioExpand'),
      metadataBio: document.getElementById('metadataBio'),
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

    if (metadata.artist) {
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

      // Cache every cover at once: awaiting them one by one made the list
      // appear a round-trip at a time
      const covers = await Promise.all(
        tracks.map((track) =>
          track.image ? window.musicAPI.cacheImage(track.image) : null,
        ),
      );

      tracks.forEach((track, index) => {
        const trackEl = document.createElement('div');
        trackEl.className = 'top-track-item';

        const img = document.createElement('img');
        img.className = 'track-image';
        img.alt = track.name;

        if (track.image) {
          img.src = covers[index] || track.image;
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
      });

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

      // All covers in flight together rather than one round-trip per album
      const covers = await Promise.all(
        albums.map((album) =>
          album.image ? window.musicAPI.cacheImage(album.image) : null,
        ),
      );

      albums.forEach((album, index) => {
        const albumEl = document.createElement('div');
        albumEl.className = 'top-album-item';

        const img = document.createElement('img');
        img.className = 'album-artwork';
        img.alt = album.name;

        if (album.image) {
          img.src = covers[index] || album.image;
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
      });

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

  async downloadImage(): Promise<void> {
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

    // Cached images live behind a custom scheme, which <a download> refuses to
    // save directly - pull the bytes into a blob first
    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      URL.revokeObjectURL(objectUrl);
      showToast('Image saved to Downloads');
    } catch (_error) {
      showToast('Could not save the image', 'error');
    }
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
    this.elements.artistProfile.style.display = 'none';
    this.elements.bioSummary.textContent = '';
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
      showAlert('Spotify login failed', error);
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
        const confirmed = await showConfirm(
          'Clear all caches?',
          'Lyrics, artwork, metadata and translations will be downloaded again next time. This cannot be undone.',
          'Clear All',
        );

        if (confirmed) {
          await window.musicAPI.cacheClearAll();
          await this.loadCacheList();
          showToast('Cache cleared');
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
        const confirmed = await showConfirm(
          'Clear all logs?',
          'Every log file is deleted. This cannot be undone.',
          'Clear Logs',
        );

        if (!confirmed) return;

        const success = await window.musicAPI.logsClear();
        if (success) {
          await this.loadLogsStats();
          showToast('Logs cleared');
        } else {
          showToast('Could not clear the logs', 'error');
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

      const sizeMB = (entry.size / 1024 / 1024).toFixed(2);

      // Built as nodes, never as an HTML string: cache keys are track titles
      // and artist names straight from the player, so interpolating them into
      // markup let a crafted track name inject elements into this list.
      const icon = document.createElement('div');
      icon.className = 'cache-item-icon';
      icon.textContent = this.getCacheIcon(entry.type);

      const info = document.createElement('div');
      info.className = 'cache-item-info';

      const title = document.createElement('div');
      title.className = 'cache-item-title';
      title.textContent = this.formatCacheTitle(entry.key, entry.type);

      const meta = document.createElement('div');
      meta.className = 'cache-item-meta';
      meta.textContent = `${sizeMB} MB • ${this.formatDate(entry.timestamp)}`;

      info.appendChild(title);
      info.appendChild(meta);

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'icon-btn icon-btn-danger cache-item-delete';
      deleteBtn.title = 'Delete';
      deleteBtn.textContent = '×';
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

      item.appendChild(icon);
      item.appendChild(info);
      item.appendChild(deleteBtn);

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
      const langName = getLanguageName(langCode || '');
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

  document
    .getElementById('permissionOpenSettings')
    ?.addEventListener('click', () => {
      window.musicAPI.openExternal(AUTOMATION_SETTINGS_URL);
    });

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
