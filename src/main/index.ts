/**
 * Main Process Entry Point
 *
 * Handles app lifecycle, window management, tray integration, music detection,
 * and IPC communication with renderer process.
 */

import { exec } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  screen,
  shell,
  Tray,
} from 'electron';
import type Store from 'electron-store';
import Logger from '../shared/utils/Logger';
import SpotifyAuth from './auth/SpotifyAuth';
import ImageCacheManager from './managers/ImageCacheManager';
import LyricsManager from './managers/LyricsManager';
import SpotifyMetadataManager from './managers/SpotifyMetadataManager';
import TheAudioDBManager from './managers/TheAudioDBManager';
import TranslationManager, {
  SUPPORTED_LANGUAGES,
} from './managers/TranslationManager';
import UnifiedCacheManager from './managers/UnifiedCacheManager';
import UpdateManager from './managers/UpdateManager';

// Type definitions
interface Config {
  CACHE_DURATION_HOURS: number;
}

interface TrackData {
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

interface MergedMetadata {
  artist: Record<string, unknown>;
  topTracks?: Record<string, unknown>[] | null;
  topAlbums?: Record<string, unknown>[] | null;
  hasSpotifyData: boolean;
}

// External API data types - using unknown for flexibility with dynamic API responses
type ExternalMetadata = unknown;

// Module state for app quitting
let isAppQuitting = false;

function loadConfig(): Config {
  try {
    const envPath = path.join(__dirname, '../../.env');
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      const config: Partial<Config> = {};
      envContent.split('\n').forEach((line) => {
        if (line.includes('=')) {
          const [key, value] = line.split('=').map((s) => s.trim());
          if (key === 'CACHE_DURATION_HOURS' && value) {
            config[key] = parseInt(value, 10) || 168;
          }
        }
      });
      return { CACHE_DURATION_HOURS: config.CACHE_DURATION_HOURS || 168 };
    }
  } catch (error) {
    Logger.app.error('Failed to load config', error as Error);
  }
  return { CACHE_DURATION_HOURS: 168 };
}

const config = loadConfig();
const cachePath = path.join(app.getPath('userData'), '.cache');
const unifiedCache = new UnifiedCacheManager(config, cachePath);
const lyricsManager = new LyricsManager(unifiedCache);
const audioDBManager = new TheAudioDBManager(unifiedCache);
const imageCache = new ImageCacheManager(unifiedCache);
const translationManager = new TranslationManager(unifiedCache);

// Initialize Spotify integration
const spotifyAuth = new SpotifyAuth();
const spotifyMetadataManager = new SpotifyMetadataManager(
  spotifyAuth,
  unifiedCache,
);

let mainWindow: BrowserWindow | null = null;
let pollInterval: NodeJS.Timeout | null = null;
let currentTrackKey: string | null = null;
let tray: Tray | null = null;
let cachedScriptPath: string | null = null;
let lastTrackData: TrackData | null = null;
let currentPollInterval = 1000;
let automationPermissionDenied = false;

// Window behavior management
let autoHideEnabled = false; // false = always show (default), true = show only when playing
let windowEnabled = true; // Master switch for window visibility (default: enabled)
let manualOverride = false;
let hideTimeout: NodeJS.Timeout | null = null;
let settingsStore: Store | null = null;

// Tray lyrics setting
let trayLyricsEnabled = true; // Show lyrics in system tray (default: enabled)

// Overlay mode
let overlayWindow: BrowserWindow | null = null;
let overlayEnabled = false;
let overlayDragging = false;
let overlayDragStartPos = { x: 0, y: 0 };
let overlayWinStartPos = { x: 0, y: 0 };
let overlayOpacity = 0.8; // default to 80% (0.8)
let currentLyricsData: any = null; // Store raw lyrics data for overlay updates
let trayEnabled = true; // Show menu bar (tray) icon (default: enabled)
let overlayShowMetadata = true; // Show track details (title & artist) in overlay (default: enabled)

// Translation settings
let translationEnabled = false; // Enable lyrics translation (default: disabled)
let translationTargetLang = 'en'; // Target language code (default: English)
let currentSyncedLyrics: string | null = null; // Store raw synced lyrics for refresh
let translationInProgress = false; // Prevent concurrent translation calls

// Lyrics sync state (managed in main process for independent tray updates)
let currentLyrics: Array<{ time: number; text: string }> = [];
let currentLyricIndex = 0;
let lyricsSyncInterval: NodeJS.Timeout | null = null;
let lyricFetchDebounce: NodeJS.Timeout | null = null;

// Internal position tracking (for accurate tray sync)
let internalPosition = 0;
let lastPositionUpdate = Date.now();
let isInternalPlaying = false;

// Register custom protocol for OAuth callback (must be before app.whenReady)
if (process.defaultApp) {
  if (process.argv.length >= 2 && process.argv[1]) {
    app.setAsDefaultProtocolClient('musicdisplay', process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  }
} else {
  app.setAsDefaultProtocolClient('musicdisplay');
}

// Settings store management
async function getSettingsStore(): Promise<Store> {
  if (!settingsStore) {
    const StoreModule = await import('electron-store');
    settingsStore = new StoreModule.default();
    autoHideEnabled = settingsStore.get('autoHideEnabled', false) as boolean;
    windowEnabled = settingsStore.get('windowEnabled', true) as boolean;
    trayLyricsEnabled = settingsStore.get('trayLyricsEnabled', true) as boolean;
    translationEnabled = settingsStore.get(
      'translationEnabled',
      false,
    ) as boolean;
    translationTargetLang = settingsStore.get(
      'translationTargetLang',
      'en',
    ) as string;
    overlayEnabled = settingsStore.get('overlayEnabled', false) as boolean;
    overlayOpacity = settingsStore.get('overlayOpacity', 0.8) as number;
    trayEnabled = settingsStore.get('trayEnabled', true) as boolean;
    overlayShowMetadata = settingsStore.get('overlayShowMetadata', true) as boolean;

    // Protection: Ensure at least one UI component is enabled on startup
    if (!windowEnabled && !overlayEnabled && !trayEnabled) {
      overlayEnabled = true;
      settingsStore.set('overlayEnabled', true);
      Logger.app.warn('All UI components were disabled. Enabling Overlay Mode by default.');
    }
  }
  return settingsStore;
}

function saveWindowEnabledSetting(enabled: boolean): void {
  let finalEnabled = enabled;
  if (!enabled && !overlayEnabled && !trayEnabled) {
    overlayEnabled = true;
    if (settingsStore) {
      settingsStore.set('overlayEnabled', true);
    }
    createOverlayWindow();
    updateTrayMenu();
    Logger.app.warn('Prevented disabling all UI components: forced enabling Overlay Mode.');
  }

  windowEnabled = finalEnabled;
  if (settingsStore) {
    settingsStore.set('windowEnabled', finalEnabled);
  }

  // Immediately apply window state
  if (!finalEnabled) {
    // User disabled window - hide it
    hideWindow();
  } else {
    // User enabled window - show based on current music state
    if (lastTrackData) {
      handleWindowVisibility(lastTrackData.isPlaying);
    }
  }

  Logger.app.info(`Window ${finalEnabled ? 'enabled' : 'disabled'}`);
}

function saveTrayLyricsSetting(enabled: boolean): void {
  trayLyricsEnabled = enabled;
  if (settingsStore) {
    settingsStore.set('trayLyricsEnabled', enabled);
  }

  // Clear tray immediately if disabled, restart sync if enabled
  if (!enabled) {
    if (tray) tray.setTitle('');
  } else {
    // Re-sync current line if we have lyrics
    if (currentLyrics.length > 0 && currentLyricIndex < currentLyrics.length) {
      const currentLine = currentLyrics[currentLyricIndex];
      if (currentLine) {
        updateTrayLyrics(currentLine.text);
      }
    }
  }

  Logger.app.info(`Tray lyrics ${enabled ? 'enabled' : 'disabled'}`);
}

function createOverlayWindow(): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) return;

  const savedPos = settingsStore?.get('overlayPosition') as
    | { x: number; y: number }
    | undefined;
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width } = primaryDisplay.workArea;
  const defaultX = Math.round((width - 360) / 2);
  const defaultY = 40;

  const overlayHeight = overlayShowMetadata ? 60 : 44;

  overlayWindow = new BrowserWindow({
    width: 360,
    height: overlayHeight,
    x: savedPos?.x ?? defaultX,
    y: savedPos?.y ?? defaultY,
    resizable: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    hasShadow: true,
    show: true,
    vibrancy: 'under-window',
    visualEffectState: 'active',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  overlayWindow.setAlwaysOnTop(true, 'floating');
  overlayWindow.setVisibleOnAllWorkspaces(true);
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });

  overlayWindow.loadFile(
    path.join(__dirname, '../renderer/resources/overlay.html'),
  );

  overlayWindow.on('closed', () => {
    overlayWindow = null;
    overlayDragging = false;
    if (overlayEnabled) {
      overlayEnabled = false;
      if (settingsStore) settingsStore.set('overlayEnabled', false);
      updateTrayMenu();
      handleWindowVisibility(lastTrackData?.isPlaying ?? false);
    }
  });

  Logger.app.info('Overlay window created');
}

function destroyOverlayWindow(): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.destroy();
    overlayWindow = null;
  }
  overlayDragging = false;
  overlayDragStartPos = { x: 0, y: 0 };
  overlayWinStartPos = { x: 0, y: 0 };
}

function saveOverlayEnabledSetting(enabled: boolean): void {
  let finalEnabled = enabled;
  if (!enabled && !windowEnabled && !trayEnabled) {
    windowEnabled = true;
    if (settingsStore) {
      settingsStore.set('windowEnabled', true);
    }
    Logger.app.warn('Prevented disabling all UI components: forced enabling Main Window.');
  }

  overlayEnabled = finalEnabled;
  if (settingsStore) {
    settingsStore.set('overlayEnabled', finalEnabled);
  }

  if (finalEnabled) {
    createOverlayWindow();
    hideWindow();
  } else {
    destroyOverlayWindow();
    handleWindowVisibility(lastTrackData?.isPlaying ?? false);
  }

  updateTrayMenu();
  Logger.app.info(`Overlay mode ${finalEnabled ? 'enabled' : 'disabled'}`);
}

// Window visibility control
function showWindow(shouldFocus: boolean = false): void {
  if (!windowEnabled) return; // Don't show if window is disabled by user

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    if (shouldFocus) {
      mainWindow.focus();
    }
  }
}

function hideWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }
}

function handleTrayClick(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isVisible()) {
      mainWindow.focus();
    } else {
      manualOverride = false;
      showWindow(true); // User action: focus the window
      updateTrayMenu();
      Logger.app.debug('Window shown via tray click');
    }
  }
}

function handleWindowVisibility(isPlaying: boolean): void {
  if (overlayEnabled) return;
  if (!mainWindow || mainWindow.isDestroyed()) return;

  // If window is disabled by user, always keep it hidden
  if (!windowEnabled) {
    if (mainWindow.isVisible()) {
      hideWindow();
    }
    return;
  }

  if (hideTimeout) clearTimeout(hideTimeout);

  if (!autoHideEnabled) {
    // Always show mode - keep window visible
    if (!mainWindow.isVisible() && !manualOverride) {
      showWindow();
    }
    return;
  }

  // Auto-hide mode - show when playing, hide when stopped/paused
  if (isPlaying && !manualOverride) {
    // Only call show() if window is actually hidden to prevent focus stealing
    if (!mainWindow.isVisible()) {
      showWindow();
    }
  } else if (!isPlaying && !manualOverride) {
    hideTimeout = setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      hideWindow();
    }, 1000);
  }
}

/**
 * Parse synced lyrics text into time-stamped lines
 */
function parseSyncedLyrics(
  syncedText: string,
): Array<{ time: number; text: string }> {
  const lines: Array<{ time: number; text: string }> = [];
  const lrcLines = syncedText.split('\n');

  for (const line of lrcLines) {
    const match = line.match(/\[(\d+):(\d+\.\d+)\](.*)/);
    if (match?.[1] && match[2] && match[3] !== undefined) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseFloat(match[2]);
      const text = match[3].trim();
      const time = minutes * 60 + seconds;

      if (text) {
        // Only add non-empty lyrics
        lines.push({ time, text });
      }
    }
  }

  return lines.sort((a, b) => a.time - b.time);
}

/**
 * Calculate current position based on elapsed time (accurate like renderer)
 */
function getCurrentPosition(): number {
  if (!isInternalPlaying || !lastTrackData) {
    return internalPosition;
  }

  const now = Date.now();
  const elapsed = (now - lastPositionUpdate) / 1000;
  const calculatedPosition = internalPosition + elapsed;

  // Cap at track duration
  if (lastTrackData.duration && calculatedPosition > lastTrackData.duration) {
    return lastTrackData.duration;
  }

  return calculatedPosition;
}

/**
 * Update internal position from polling data
 */
function updateInternalPosition(position: number, isPlaying: boolean): void {
  // Detect if position jumped significantly (seek or track change)
  const positionDiff = Math.abs(position - internalPosition);
  const needsHardSync = positionDiff > 1.0 || internalPosition === 0;

  if (needsHardSync) {
    internalPosition = position;
  }

  isInternalPlaying = isPlaying;
  lastPositionUpdate = Date.now();
}

/**
 * Start lyrics sync loop (main process manages tray independently)
 */
function startLyricsSync(lyricsData: {
  synced?: string | null;
  plain?: string | null;
}): void {
  // Stop existing sync
  stopLyricsSync();

  // Parse synced lyrics
  if (lyricsData?.synced) {
    currentLyrics = parseSyncedLyrics(lyricsData.synced);
    currentLyricIndex = 0;

    // Immediately show the correct line for current position (atomic sync with window)
    if (currentLyrics.length > 0) {
      const position = getCurrentPosition();

      // Find current line (same logic as interval)
      let initialIndex = 0;
      while (initialIndex < currentLyrics.length - 1) {
        const nextLine = currentLyrics[initialIndex + 1];
        if (!nextLine || nextLine.time > position) break;
        initialIndex++;
      }

      currentLyricIndex = initialIndex;
      const currentLine = currentLyrics[currentLyricIndex];
      if (currentLine) {
        updateTrayLyrics(currentLine.text);
      }
    }

    // Start sync interval (100ms for smooth updates, using calculated position)
    lyricsSyncInterval = setInterval(() => {
      if (!isInternalPlaying) return;

      // Use time-based calculated position (not polling position)
      const position = getCurrentPosition();

      // Find current lyric line based on position
      let newIndex = currentLyricIndex;

      // Search forward
      while (newIndex < currentLyrics.length - 1) {
        const nextLine = currentLyrics[newIndex + 1];
        if (!nextLine || nextLine.time > position) break;
        newIndex++;
      }

      // Search backward (in case of seek)
      while (newIndex > 0) {
        const currentLine = currentLyrics[newIndex];
        if (!currentLine || currentLine.time <= position) break;
        newIndex--;
      }

      // Update tray if line changed
      if (newIndex !== currentLyricIndex) {
        currentLyricIndex = newIndex;
        const currentLine = currentLyrics[currentLyricIndex];
        if (currentLine) {
          updateTrayLyrics(currentLine.text);
        }
      }
    }, 100);

    Logger.app.debug('Lyrics sync started in main process');
  }
}

/**
 * Stop lyrics sync loop
 */
function stopLyricsSync(): void {
  if (lyricsSyncInterval) {
    clearInterval(lyricsSyncInterval);
    lyricsSyncInterval = null;
  }
  currentLyrics = [];
  currentLyricIndex = 0;
  internalPosition = 0;
  isInternalPlaying = false;
  lastPositionUpdate = Date.now();
}

/**
 * Update tray with lyrics text (main process single source of truth)
 */
function updateTrayLyrics(text: string): void {
  if (!tray || !trayLyricsEnabled) return;

  // Truncate to 60 characters with ellipsis
  const maxLength = 60;
  const displayText =
    text.length > maxLength ? `${text.substring(0, maxLength - 3)}...` : text;

  tray.setTitle(displayText);
}

/**
 * Legacy IPC handler (kept for backward compatibility with renderer)
 * Main process now manages tray directly, but renderer can still send updates
 */
function handleTrayLyricsUpdate(text: string): void {
  // Only accept renderer updates if main sync is not active
  if (lyricsSyncInterval) return; // Main process is handling it

  updateTrayLyrics(text);
}

function initCachedScript(): void {
  const script = `set output to "{}"

on escapeJSON(txt)
  set txt to txt as text
  set AppleScript's text item delimiters to "\\\\"
  set txt to text items of txt
  set AppleScript's text item delimiters to "\\\\\\\\"
  set txt to txt as text
  set AppleScript's text item delimiters to "\\""
  set txt to text items of txt
  set AppleScript's text item delimiters to "\\\\\\""
  set txt to txt as text
  set AppleScript's text item delimiters to (ASCII character 10)
  set txt to text items of txt
  set AppleScript's text item delimiters to "\\\\n"
  set txt to txt as text
  set AppleScript's text item delimiters to (ASCII character 13)
  set txt to text items of txt
  set AppleScript's text item delimiters to "\\\\r"
  set txt to txt as text
  set AppleScript's text item delimiters to (ASCII character 9)
  set txt to text items of txt
  set AppleScript's text item delimiters to "\\\\t"
  set txt to txt as text
  set AppleScript's text item delimiters to ""
  return txt
end escapeJSON

if application "Spotify" is running then
  try
    tell application "Spotify"
      if player state is playing or player state is paused then
        set trackName to my escapeJSON(name of current track)
        set trackArtist to my escapeJSON(artist of current track)
        set trackAlbum to my escapeJSON(album of current track)
        set trackDuration to ((duration of current track) / 1000) as integer
        set trackPosition to (player position) as integer
        set trackPopularity to popularity of current track
        set trackNumber to track number of current track as string
        set discNumber to disc number of current track as string
        set isPlaying to (player state is playing)
        set artworkUrl to my escapeJSON(artwork url of current track)
        set spotifyUrl to my escapeJSON(spotify url of current track)

        set output to "{"
        set output to output & "\\"title\\":\\"" & trackName & "\\","
        set output to output & "\\"artist\\":\\"" & trackArtist & "\\","
        set output to output & "\\"album\\":\\"" & trackAlbum & "\\","
        set output to output & "\\"duration\\":" & trackDuration & ","
        set output to output & "\\"position\\":" & trackPosition & ","
        set output to output & "\\"popularity\\":" & trackPopularity & ","
        set output to output & "\\"trackNumber\\":" & trackNumber & ","
        set output to output & "\\"discNumber\\":" & discNumber & ","
        set output to output & "\\"artworkUrl\\":\\"" & artworkUrl & "\\","
        set output to output & "\\"spotifyUrl\\":\\"" & spotifyUrl & "\\","
        set output to output & "\\"isPlaying\\":" & isPlaying & ","
        set output to output & "\\"nowPlayingAvailable\\":true}"
        return output
      end if
    end tell
  end try
end if

if application "Music" is running then
  try
    tell application "Music"
      if player state is playing or player state is paused then
        set trackName to my escapeJSON(name of current track)
        set trackArtist to my escapeJSON(artist of current track)
        set trackAlbum to my escapeJSON(album of current track)
        set trackDuration to (duration of current track) as integer
        set trackPosition to (player position) as integer
        set trackYear to year of current track as string
        set trackGenre to my escapeJSON(genre of current track)
        set trackRating to rating of current track
        set trackPlayCount to played count of current track as string
        set trackBpm to bpm of current track as string
        set trackNumber to track number of current track as string
        set trackCount to track count of current track as string
        set discNumber to disc number of current track as string
        set discCount to disc count of current track as string
        set isPlaying to (player state is playing)

        set output to "{"
        set output to output & "\\"title\\":\\"" & trackName & "\\","
        set output to output & "\\"artist\\":\\"" & trackArtist & "\\","
        set output to output & "\\"album\\":\\"" & trackAlbum & "\\","
        set output to output & "\\"duration\\":" & trackDuration & ","
        set output to output & "\\"position\\":" & trackPosition & ","
        set output to output & "\\"year\\":\\"" & trackYear & "\\","
        set output to output & "\\"genre\\":\\"" & trackGenre & "\\","
        set output to output & "\\"rating\\":" & trackRating & ","
        set output to output & "\\"playCount\\":" & trackPlayCount & ","
        set output to output & "\\"bpm\\":" & trackBpm & ","
        set output to output & "\\"trackNumber\\":" & trackNumber & ","
        set output to output & "\\"trackCount\\":" & trackCount & ","
        set output to output & "\\"discNumber\\":" & discNumber & ","
        set output to output & "\\"discCount\\":" & discCount & ","
        set output to output & "\\"isPlaying\\":" & isPlaying & ","
        set output to output & "\\"nowPlayingAvailable\\":true}"
        return output
      end if
    end tell
  end try
end if

return output`;

  cachedScriptPath = path.join(
    app.getPath('temp'),
    'lyricglow-music-poll.scpt',
  );
  fs.writeFileSync(cachedScriptPath, script, 'utf8');
  Logger.app.info('AppleScript cached for polling');
}

function pollMusicState(): void {
  if (!cachedScriptPath) {
    Logger.music.error('Cached script not initialized');
    return;
  }

  exec(`osascript "${cachedScriptPath}"`, (error, stdout, stderr) => {
    if (error) {
      Logger.music.error('AppleScript execution failed', error);
      updatePollInterval(null);
      return;
    }

    // Check stderr for Automation permission errors (macOS Sequoia+)
    // Error -1743: "not authorized to send Apple events"
    if (
      stderr &&
      (stderr.includes('not authorized') ||
        stderr.includes('-1743') ||
        stderr.includes('assistive access'))
    ) {
      if (!automationPermissionDenied) {
        automationPermissionDenied = true;
        Logger.music.warn(
          'Automation permission denied - user needs to grant access in System Settings',
        );
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('music:permission-error');
        }
      }
      updatePollInterval(null);
      return;
    }

    // If we get valid output, permission is granted - reset the flag
    const scriptOutput = stdout.trim();
    if (scriptOutput && scriptOutput !== '{}') {
      if (automationPermissionDenied) {
        automationPermissionDenied = false;
        Logger.music.info('Automation permission granted');
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('music:permission-granted');
        }
      }
    }

    if (!scriptOutput || scriptOutput === '{}') {
      broadcastMusicUpdate(null);
      updatePollInterval(null);
      return;
    }

    try {
      const trackData = JSON.parse(scriptOutput) as TrackData;
      const dataChanged =
        !lastTrackData ||
        lastTrackData.title !== trackData.title ||
        lastTrackData.artist !== trackData.artist ||
        lastTrackData.isPlaying !== trackData.isPlaying ||
        Math.abs((lastTrackData.position || 0) - (trackData.position || 0)) > 2;

      if (dataChanged) {
        lastTrackData = trackData;
        broadcastMusicUpdate(trackData);
      }

      updatePollInterval(trackData);
    } catch (e) {
      Logger.music.error('Failed to parse music data', e as Error);
      updatePollInterval(null);
    }
  });
}

function updatePollInterval(trackData: TrackData | null): void {
  let newInterval = 5000;

  if (trackData?.nowPlayingAvailable) {
    newInterval = trackData.isPlaying ? 500 : 2000;
  }

  if (newInterval !== currentPollInterval) {
    currentPollInterval = newInterval;
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = setInterval(pollMusicState, currentPollInterval);
      Logger.music.debug(`Poll interval adjusted to ${currentPollInterval}ms`);
    }
  }
}

/**
 * Translate lyrics asynchronously and send to renderer when ready
 * Non-blocking - app continues working while translation happens in background
 * Includes race condition protection to prevent stale translations
 */
async function translateLyricsAsync(
  syncedLyrics: string,
  trackKey: string,
): Promise<void> {
  // Prevent concurrent translation calls - last one wins
  if (translationInProgress) {
    Logger.lyrics.debug('Translation skipped: another in progress');
    return;
  }

  translationInProgress = true;
  const targetLang = translationTargetLang; // Capture at call time

  try {
    // Parse synced lyrics to extract text lines
    const lines = syncedLyrics.split('\n');
    const textLines: string[] = [];

    for (const line of lines) {
      const match = line.match(/^\[\d{2}:\d{2}\.\d{2}\](.*)$/);
      if (match && match[1] !== undefined) {
        textLines.push(match[1].trim());
      }
    }

    if (!textLines.length) {
      translationInProgress = false;
      return;
    }

    // Translate batch
    const result = await translationManager.translateBatch(
      textLines,
      targetLang,
      trackKey,
    );

    // Verify settings haven't changed during translation
    if (result && mainWindow && !mainWindow.isDestroyed()) {
      // Check if track or language changed while translating
      if (
        currentTrackKey === trackKey &&
        translationTargetLang === targetLang &&
        translationEnabled
      ) {
        mainWindow.webContents.send('translation:update', {
          translations: result.translated,
          targetLang: result.targetLang,
          isTargetRTL: result.isTargetRTL,
        });
        Logger.lyrics.debug(
          `Translation sent: ${textLines.length} lines → ${targetLang}`,
        );
      } else {
        Logger.lyrics.debug(
          'Translation discarded: settings changed during fetch',
        );
      }
    }
  } catch (error) {
    Logger.lyrics.error('Translation failed', error as Error);
  } finally {
    translationInProgress = false;
  }
}

async function broadcastMusicUpdate(
  trackData: TrackData | null,
): Promise<void> {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('music:update', trackData);
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('music:update', trackData);
    }

    if (trackData?.title && trackData.artist) {
      const trackKey = `${trackData.title}-${trackData.artist}`;

      if (!currentTrackKey || currentTrackKey !== trackKey) {
        currentTrackKey = trackKey;
        manualOverride = false; // Reset on new track
        Logger.music.info(
          `Now playing: ${trackData.artist} - ${trackData.title}`,
        );

        // Reset internal position on track change
        internalPosition = trackData.position;
        isInternalPlaying = trackData.isPlaying;
        lastPositionUpdate = Date.now();

        // Fire all fetches in parallel but send results independently as they complete
        // This makes the app feel faster - each data type shows as soon as it's ready

        // Lyrics fetch — debounced 300ms so Spotify settles before querying
        if (lyricFetchDebounce) clearTimeout(lyricFetchDebounce);
        lyricFetchDebounce = setTimeout(() => {
          lyricsManager
            .fetchLyrics(trackData.title, trackData.artist)
            .then((lyricsData) => {
              if (
                mainWindow &&
                !mainWindow.isDestroyed() &&
                currentTrackKey === trackKey
              ) {
                mainWindow.webContents.send('lyrics:update', lyricsData);
                currentLyricsData = lyricsData;
                if (overlayWindow && !overlayWindow.isDestroyed() && currentTrackKey === trackKey) {
                  overlayWindow.webContents.send('lyrics:update', lyricsData);
                }

                // Store synced lyrics for potential refresh when translation settings change
                currentSyncedLyrics = lyricsData?.synced || null;

                // Async translation - non-blocking
                if (translationEnabled && lyricsData && lyricsData.synced) {
                  translateLyricsAsync(lyricsData.synced, trackKey);
                }

                // Main process manages tray lyrics sync
                if (lyricsData?.synced) {
                  startLyricsSync(lyricsData);
                } else {
                  stopLyricsSync();
                  if (tray) tray.setTitle('');
                }
              }
            });
        }, 300);

        // Metadata fetches - run in parallel, merge and send when both complete
        const audioDBPromise = audioDBManager.fetchMetadata(trackData.artist);
        const spotifyPromise = spotifyAuth.isLoggedIn()
          ? spotifyMetadataManager.fetchMetadata(trackData)
          : Promise.resolve(null);

        Promise.all([audioDBPromise, spotifyPromise]).then(
          ([audioDBMetadata, spotifyMetadata]) => {
            if (
              mainWindow &&
              !mainWindow.isDestroyed() &&
              currentTrackKey === trackKey
            ) {
              const mergedMetadata = mergeArtistMetadata(
                audioDBMetadata,
                spotifyMetadata,
              );
              mainWindow.webContents.send('metadata:update', mergedMetadata);
            }
          },
        );
      } else {
        // Same track - update position smoothly
        updateInternalPosition(trackData.position, trackData.isPlaying);
      }

      handleWindowVisibility(trackData.isPlaying);
    } else if (currentTrackKey) {
      currentTrackKey = null;
      currentLyricsData = null;
      stopLyricsSync();
      if (tray) tray.setTitle('');
      mainWindow.webContents.send('lyrics:update', null);
      mainWindow.webContents.send('metadata:update', null);
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send('music:update', null);
        overlayWindow.webContents.send('lyrics:update', null);
        overlayWindow.webContents.send('metadata:update', null);
      }
      handleWindowVisibility(false);
    }
  }
}

function mergeArtistMetadata(
  audioDBData: ExternalMetadata,
  spotifyData: ExternalMetadata,
): MergedMetadata | null {
  if (!audioDBData && !spotifyData) return null;

  // Cast to Record for property access - these are dynamic API responses
  const audioDB = audioDBData as Record<string, unknown> | null;
  const spotify = spotifyData as Record<string, unknown> | null;

  // Type helpers for dynamic API data
  const getArtist = (data: Record<string, unknown>) =>
    (data.artist as Record<string, unknown>) || {};
  const getImages = (artist: Record<string, unknown>) =>
    (artist.images as Array<{ url: string }>) || [];
  const getAllImages = (artist: Record<string, unknown>) =>
    (artist.allImages as string[]) || [];

  if (!spotify && audioDB) {
    const artist = getArtist(audioDB);
    return {
      ...audioDB,
      artist: {
        ...artist,
        allImages: getAllImages(artist)
          .filter((img) => img && img !== '')
          .slice(0, 8),
      },
      hasSpotifyData: false,
    };
  }

  if (!audioDB && spotify) {
    const artist = getArtist(spotify);
    return {
      artist: {
        ...artist,
        allImages: getImages(artist).map((img) => img.url),
      },
      topTracks: spotify.topTracks as Record<string, unknown>[] | undefined,
      topAlbums: spotify.topAlbums as Record<string, unknown>[] | undefined,
      hasSpotifyData: true,
    };
  }

  if (!audioDB || !spotify) return null;

  const audioArtist = getArtist(audioDB);
  const spotifyArtist = getArtist(spotify);
  const spotifyImages = getImages(spotifyArtist);

  const mergedArtist = {
    ...audioArtist,
    ...(spotifyArtist && {
      allImages: [spotifyImages[0]?.url, ...getAllImages(audioArtist)]
        .filter((img): img is string => typeof img === 'string' && img !== '')
        .filter((img, index, self) => self.indexOf(img) === index)
        .slice(0, 8),
      spotifyPopularity: spotifyArtist.popularity,
      spotifyGenres: spotifyArtist.genres,
      spotifyFollowers:
        typeof spotifyArtist.followers === 'number'
          ? spotifyArtist.followers.toLocaleString()
          : spotifyArtist.followers,
    }),
  };

  const topTracks = spotify.topTracks as Array<Record<string, unknown>>;
  const topAlbums = spotify.topAlbums as Array<Record<string, unknown>>;

  return {
    artist: mergedArtist,
    topTracks:
      topTracks && topTracks.length > 0
        ? topTracks.map((t) => ({
            name: t.name,
            playcount: t.popularity,
            image:
              (
                (t.album as Record<string, unknown>)?.images as Array<{
                  url: string;
                }>
              )?.[0]?.url || null,
            artist: t.artist,
            url: t.url,
          }))
        : null,
    topAlbums:
      topAlbums && topAlbums.length > 0
        ? topAlbums.map((a) => ({
            name: a.name,
            playcount: `${a.total_tracks} tracks`,
            image: (a.images as Array<{ url: string }>)?.[0]?.url || null,
            artist: a.artist,
            url: a.url,
          }))
        : null,
    hasSpotifyData: true,
  };
}

function openSettingsWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    // Temporarily enable window to show settings
    const wasDisabled = !windowEnabled;
    if (wasDisabled) {
      windowEnabled = true;
    }
    showWindow(true); // User action: show and focus
    mainWindow.webContents.send('open-settings');
    if (wasDisabled) {
      windowEnabled = false; // Restore state but keep window visible for settings
    }
  }
}

function setupApplicationMenu(): void {
  const isMac = process.platform === 'darwin';
  const template: any[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              {
                label: 'Settings...',
                accelerator: 'Cmd+,',
                click: () => {
                  openSettingsWindow();
                },
              },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [isMac ? { role: 'close' } : { role: 'quit' }],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac
          ? [
              { role: 'pasteAndMatchStyle' },
              { role: 'delete' },
              { role: 'selectAll' },
              { type: 'separator' },
              {
                label: 'Speech',
                submenu: [{ role: 'startSpeaking' }, { role: 'stopSpeaking' }],
              },
            ]
          : [{ role: 'delete' }, { type: 'separator' }, { role: 'selectAll' }]),
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [
              { type: 'separator' },
              { role: 'front' },
              { type: 'separator' },
              { role: 'window' },
            ]
          : [{ role: 'close' }]),
      ],
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'Learn More',
          click: async () => {
            await shell.openExternal('https://github.com/ateymoori/lyricglow');
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function updateTrayMenu(): void {
  if (!tray) return;

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'LyricGlow',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Show Window',
      type: 'checkbox',
      checked: windowEnabled,
      click: () => {
        saveWindowEnabledSetting(!windowEnabled);
        updateTrayMenu();
      },
    },
    {
      label: 'Show Tray Lyrics',
      type: 'checkbox',
      checked: trayLyricsEnabled,
      click: () => {
        saveTrayLyricsSetting(!trayLyricsEnabled);
        updateTrayMenu();
      },
    },
    {
      label: 'Overlay Mode',
      type: 'checkbox',
      checked: overlayEnabled,
      click: () => {
        saveOverlayEnabledSetting(!overlayEnabled);
      },
    },
    { type: 'separator' },
    {
      label: 'Settings',
      click: () => {
        openSettingsWindow();
      },
    },
    {
      label: 'Check for Updates',
      click: async () => {
        try {
          const updateInfo = await UpdateManager.checkForUpdates();
          await UpdateManager.showUpdateDialog(updateInfo);
        } catch (_error) {
          dialog.showErrorBox(
            'Update Check Failed',
            'Could not check for updates. Please try again later.',
          );
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isAppQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
}

function createTray(): void {
  try {
    const iconName =
      process.platform === 'darwin' ? 'iconTemplate.png' : 'icon.png';

    // In production (packaged app), icons are in Resources folder
    // In development, icons are in build folder
    const iconPath = app.isPackaged
      ? path.join(process.resourcesPath, iconName)
      : path.join(__dirname, '../../build', iconName);

    tray = new Tray(iconPath);
    tray.setToolTip('LyricGlow');
    Logger.app.info('System tray created successfully');
  } catch (error) {
    Logger.app.error('Tray creation failed:', (error as Error).message);
    return;
  }

  updateTrayMenu();

  tray.on('click', () => handleTrayClick());
}

function createWindow(): void {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width } = primaryDisplay.workArea;

  const windowWidth = 550;
  const windowHeight = 600;
  const padding = 20;

  app.commandLine.appendSwitch('enable-gpu-rasterization');
  app.commandLine.appendSwitch('enable-zero-copy');
  app.commandLine.appendSwitch('disable-gpu-driver-bug-workarounds');

  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    minWidth: 300,
    minHeight: 240,
    x: width - windowWidth - padding,
    y: padding,
    resizable: true,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    // Native macOS Liquid Glass vibrancy
    vibrancy: 'under-window',
    visualEffectState: 'active',
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    hasShadow: true,
    show: windowEnabled && !overlayEnabled,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      devTools: process.env.NODE_ENV === 'development',
    },
  });

  mainWindow.setAlwaysOnTop(true, 'floating');
  mainWindow.setVisibleOnAllWorkspaces(true);

  Logger.app.debug(
    `Window positioned at: x=${width - windowWidth - padding}, y=${padding}`,
  );

  mainWindow.on('close', (event) => {
    if (!isAppQuitting) {
      event.preventDefault();
      hideWindow();
      Logger.app.debug('Window hidden via close button');
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/resources/index.html'));

  mainWindow.webContents.once('did-finish-load', () => {
    Logger.app.info('Window loaded, starting music detection');
    initCachedScript();
    pollMusicState();
    pollInterval = setInterval(pollMusicState, currentPollInterval);
  });
}

app.on('open-url', async (event, url) => {
  event.preventDefault();

  if (url.startsWith('musicdisplay://callback')) {
    try {
      await spotifyAuth.handleCallback(url);

      currentTrackKey = null;

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('spotify:logged-in');
      }
    } catch (error) {
      Logger.auth.error('OAuth callback failed', error as Error);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(
          'spotify:login-error',
          (error as Error).message,
        );
      }
    }
  }
});

app.whenReady().then(async () => {
  Logger.app.info('App ready, initializing...');

  // Initialize settings store and load settings
  await getSettingsStore();
  setupApplicationMenu();
  Logger.app.info(`Window: ${windowEnabled ? 'enabled' : 'disabled'}`);
  Logger.app.info(
    `Auto-hide mode: ${autoHideEnabled ? 'enabled' : 'disabled'}`,
  );
  Logger.app.info(`Tray lyrics: ${trayLyricsEnabled ? 'enabled' : 'disabled'}`);

  // Register global hotkey to toggle window enabled setting
  const hotkeyRegistered = globalShortcut.register('CommandOrControl+L', () => {
    saveWindowEnabledSetting(!windowEnabled);
    updateTrayMenu();
  });

  if (hotkeyRegistered) {
    Logger.app.info('Global hotkey registered: Cmd/Ctrl+L');
  } else {
    Logger.app.warn('Failed to register global hotkey');
  }

  if (trayEnabled) {
    createTray();
  }
  createWindow();

  if (overlayEnabled) {
    createOverlayWindow();
    hideWindow();
  }

  unifiedCache.clearExpired().catch((err) => {
    Logger.cache.error('Background cache cleanup failed', err as Error);
  });

  if (spotifyAuth.isLoggedIn()) {
    spotifyAuth.startAutoRefresh();
    Logger.auth.info('Spotify auto-refresh enabled');
  }
});

ipcMain.on('app:quit', () => {
  if (pollInterval) {
    clearInterval(pollInterval);
  }
  if (lyricFetchDebounce) {
    clearTimeout(lyricFetchDebounce);
  }
  isAppQuitting = true;
  app.quit();
});

// Tray lyrics IPC handler (unified sync from renderer)
ipcMain.on('tray:update-lyrics', (_event, text: string) => {
  handleTrayLyricsUpdate(text);
});

ipcMain.on('open:external', (_event, url: string) => {
  if (url && typeof url === 'string') {
    shell.openExternal(url);
  }
});

// Window close IPC handler (hide window, don't quit)
ipcMain.on('window:close', () => {
  saveWindowEnabledSetting(false);
  updateTrayMenu();
  Logger.app.debug(
    'Window closed by user via close button (Show Window disabled)',
  );
});

// Overlay drag IPC handlers
ipcMain.on(
  'overlay:drag-start',
  (_event, pos: { x: number; y: number }) => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    overlayDragging = true;
    overlayDragStartPos = pos;
    const pos2 = overlayWindow.getPosition();
    overlayWinStartPos = { x: pos2[0] ?? 0, y: pos2[1] ?? 0 };
  },
);

ipcMain.on(
  'overlay:drag-move',
  (_event, pos: { x: number; y: number }) => {
    if (!overlayDragging || !overlayWindow || overlayWindow.isDestroyed()) return;
    const dx = pos.x - overlayDragStartPos.x;
    const dy = pos.y - overlayDragStartPos.y;
    overlayWindow.setPosition(
      overlayWinStartPos.x + dx,
      overlayWinStartPos.y + dy,
    );
  },
);

ipcMain.on('overlay:drag-stop', () => {
  overlayDragging = false;
  if (overlayWindow && !overlayWindow.isDestroyed() && settingsStore) {
    const overlayPos = overlayWindow.getPosition();
    settingsStore.set('overlayPosition', { x: overlayPos[0] ?? 0, y: overlayPos[1] ?? 0 });
  }
});

ipcMain.handle('overlay:get-enabled', () => overlayEnabled);

ipcMain.handle('overlay:set-enabled', (_event, enabled: boolean) => {
  saveOverlayEnabledSetting(enabled);
  return true;
});

ipcMain.on('overlay:ready', () => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    if (lastTrackData) {
      overlayWindow.webContents.send('music:update', lastTrackData);
    }
    if (currentLyricsData) {
      overlayWindow.webContents.send('lyrics:update', currentLyricsData);
    }
    overlayWindow.webContents.send('overlay:metadata-visibility-update', overlayShowMetadata);
  }
});

ipcMain.on(
  'overlay:set-ignore-mouse',
  (_event, ignore: boolean, options?: { forward: boolean }) => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.setIgnoreMouseEvents(ignore, options);
    }
  },
);

ipcMain.handle('overlay:get-opacity', () => overlayOpacity);

ipcMain.handle('overlay:set-opacity', (_event, opacity: number) => {
  overlayOpacity = opacity;
  if (settingsStore) {
    settingsStore.set('overlayOpacity', opacity);
  }
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('overlay:opacity-update', opacity);
  }
  return true;
});

ipcMain.on('overlay:open-settings', () => {
  openSettingsWindow();
});

ipcMain.handle('settings:get-tray-icon-enabled', () => trayEnabled);

ipcMain.handle('settings:set-tray-icon-enabled', (_event, enabled: boolean) => {
  updateTrayVisibility(enabled);
  return true;
});

ipcMain.handle('overlay:get-show-metadata', () => overlayShowMetadata);

ipcMain.handle('overlay:set-show-metadata', (_event, enabled: boolean) => {
  overlayShowMetadata = enabled;
  if (settingsStore) {
    settingsStore.set('overlayShowMetadata', enabled);
  }
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setSize(360, enabled ? 60 : 44);
    overlayWindow.webContents.send('overlay:metadata-visibility-update', enabled);
  }
  return true;
});

function updateTrayVisibility(enabled: boolean): void {
  let finalEnabled = enabled;
  if (!enabled && !windowEnabled && !overlayEnabled) {
    overlayEnabled = true;
    if (settingsStore) {
      settingsStore.set('overlayEnabled', true);
    }
    createOverlayWindow();
    Logger.app.warn('Prevented disabling all UI components: forced enabling Overlay Mode.');
  }

  trayEnabled = finalEnabled;
  if (settingsStore) {
    settingsStore.set('trayEnabled', finalEnabled);
  }

  if (finalEnabled) {
    if (!tray) {
      createTray();
    }
  } else {
    if (tray) {
      tray.destroy();
      tray = null;
    }
  }
}

function executeMediaControl(
  command: string,
  param: number | null = null,
): void {
  const spotifyCmd = param !== null ? `${command} to ${param}` : command;
  const musicCmd = param !== null ? `${command} to ${param}` : command;

  const script = `
    if application "Spotify" is running then
      try
        tell application "Spotify" to ${spotifyCmd}
      end try
    end if
    if application "Music" is running then
      try
        tell application "Music" to ${musicCmd}
      end try
    end if
  `;

  exec(`osascript -e '${script}'`, (error) => {
    if (error) {
      Logger.music.error(`Media control failed: ${command}`, error);
    }
  });
}

ipcMain.on('music:seek', (_event, position: number) => {
  if (position !== null && position !== undefined) {
    executeMediaControl('set player position', Math.floor(position));
  }
});

ipcMain.on('music:play-pause', () => {
  executeMediaControl('playpause');
});

ipcMain.on('music:next', () => {
  executeMediaControl('next track');
});

ipcMain.on('music:previous', () => {
  executeMediaControl('previous track');
});

ipcMain.handle('cache:image', async (_event, url: string) => {
  if (!url || typeof url !== 'string') {
    return null;
  }
  try {
    const cachedImage = await imageCache.getImage(url);
    return cachedImage;
  } catch (error) {
    Logger.cache.error('Image cache failed', error as Error);
    return null;
  }
});

// Spotify Auth IPC Handlers
ipcMain.handle('spotify:is-logged-in', () => {
  return spotifyAuth.isLoggedIn();
});

ipcMain.handle('spotify:get-user-profile', async () => {
  try {
    return await spotifyAuth.getUserProfile();
  } catch (error) {
    Logger.auth.error('Failed to fetch user profile', error as Error);
    return null;
  }
});

ipcMain.on('spotify:login', async () => {
  try {
    await spotifyAuth.startAuthFlow();
  } catch (error) {
    Logger.auth.error('Login failed', error as Error);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(
        'spotify:login-error',
        (error as Error).message,
      );
    }
  }
});

ipcMain.on('spotify:logout', () => {
  spotifyAuth.logout();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('spotify:logged-out');
  }
});

ipcMain.handle('cache:list', async () => {
  const entries = unifiedCache.listAllEntries();
  const enriched = await Promise.all(
    entries.map(async (entry) => ({
      ...entry,
      size: await unifiedCache.getEntrySize(entry.type, entry.key),
    })),
  );
  return enriched;
});

ipcMain.handle('cache:delete', async (_event, type: string, key: string) => {
  return await unifiedCache.deleteOne(type, key);
});

ipcMain.handle('cache:clear-all', async () => {
  await unifiedCache.clearAll();
  return true;
});

let visibilityStore: Store | null = null;

async function getVisibilityStore(): Promise<Store> {
  if (!visibilityStore) {
    const StoreModule = await import('electron-store');
    visibilityStore = new StoreModule.default();
  }
  return visibilityStore;
}

ipcMain.handle('visibility:get', async (_event, key?: string) => {
  const store = await getVisibilityStore();
  const defaults = {
    player: true,
    lyrics: true,
    images: true,
    info: true,
    bio: true,
    tracks: true,
    albums: true,
    similar: true,
  };

  if (key) {
    return store.get(
      `visibility.${key}`,
      defaults[key as keyof typeof defaults],
    );
  }
  return store.get('visibility', defaults);
});

ipcMain.handle(
  'visibility:set',
  async (_event, key: string, value: boolean) => {
    const store = await getVisibilityStore();
    store.set(`visibility.${key}`, value);
    return true;
  },
);

ipcMain.handle('visibility:reset', async () => {
  const store = await getVisibilityStore();
  store.delete('visibility');
  return true;
});

ipcMain.handle('settings:get-launch-at-login', () => {
  return app.getLoginItemSettings().openAtLogin;
});

ipcMain.handle('settings:set-launch-at-login', (_event, enabled: boolean) => {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: false,
  });
  return true;
});

ipcMain.handle('settings:get-tray-lyrics', () => {
  return trayLyricsEnabled;
});

ipcMain.handle('settings:set-tray-lyrics', (_event, enabled: boolean) => {
  saveTrayLyricsSetting(enabled);
  return true;
});

// Translation settings IPC handlers
ipcMain.handle('translation:get-enabled', () => {
  return translationEnabled;
});

ipcMain.handle('translation:set-enabled', (_event, enabled: boolean) => {
  translationEnabled = enabled;
  if (settingsStore) {
    settingsStore.set('translationEnabled', enabled);
  }
  Logger.app.info(`Translation ${enabled ? 'enabled' : 'disabled'}`);
  return true;
});

ipcMain.handle('translation:get-target-lang', () => {
  return translationTargetLang;
});

ipcMain.handle('translation:set-target-lang', (_event, langCode: string) => {
  translationTargetLang = langCode;
  if (settingsStore) {
    settingsStore.set('translationTargetLang', langCode);
  }
  Logger.app.info(`Translation target language set to: ${langCode}`);
  return true;
});

ipcMain.handle('translation:get-languages', () => {
  return SUPPORTED_LANGUAGES;
});

// Refresh translations with current lyrics and new settings
ipcMain.handle('translation:refresh', async () => {
  if (!translationEnabled) {
    // Translation disabled - send complete clear payload to UI
    translationInProgress = false; // Reset flag to allow future translations
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('translation:update', {
        translations: [],
        targetLang: translationTargetLang,
        isTargetRTL: false,
      });
    }
    return true;
  }

  if (!currentSyncedLyrics || !currentTrackKey) {
    Logger.lyrics.debug('No synced lyrics available for translation refresh');
    return false;
  }

  // Wait for any in-progress translation to complete before starting new one
  // This ensures language changes take effect
  while (translationInProgress) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  // Re-translate with new settings
  await translateLyricsAsync(currentSyncedLyrics, currentTrackKey);
  return true;
});

// Update check IPC handler
ipcMain.handle('update:check', async () => {
  try {
    return await UpdateManager.checkForUpdates();
  } catch (error) {
    Logger.app.error('Update check failed', error as Error);
    throw error;
  }
});

ipcMain.handle('logs:get-stats', async () => {
  return await Logger.getLogStats();
});

ipcMain.handle('logs:open-folder', () => {
  const logsPath = Logger.getLogPath();
  shell.showItemInFolder(logsPath);
  return true;
});

ipcMain.handle('logs:clear', async () => {
  return await Logger.clearLogs();
});

app.on('before-quit', () => {
  isAppQuitting = true;
  globalShortcut.unregisterAll();
  if (hideTimeout) clearTimeout(hideTimeout);
  if (pollInterval) {
    clearInterval(pollInterval);
  }
  stopLyricsSync(); // Clean up lyrics sync interval
  if (cachedScriptPath) {
    try {
      fs.unlinkSync(cachedScriptPath);
      Logger.app.info('Cached script cleaned up');
    } catch (_e) {
      Logger.app.debug('Cache cleanup skipped (file not found)');
    }
  }
});
