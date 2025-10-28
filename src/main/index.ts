/**
 * Main Process Entry Point
 *
 * Handles app lifecycle, window management, tray integration, music detection,
 * and IPC communication with renderer process.
 */

import {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  Tray,
  Menu,
  globalShortcut,
  screen
} from 'electron';
import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import type Store from 'electron-store';
import Logger from '../shared/utils/Logger';
import UnifiedCacheManager from './managers/UnifiedCacheManager';
import LyricsManager from './managers/LyricsManager';
import TheAudioDBManager from './managers/TheAudioDBManager';
import ImageCacheManager from './managers/ImageCacheManager';
import SpotifyAuth from './auth/SpotifyAuth';
import SpotifyMetadataManager from './managers/SpotifyMetadataManager';

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
  artist: any;
  topTracks?: any[] | null;
  topAlbums?: any[] | null;
  hasSpotifyData: boolean;
}


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
            config[key] = parseInt(value) || 168;
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

// Initialize Spotify integration
const spotifyAuth = new SpotifyAuth();
const spotifyMetadataManager = new SpotifyMetadataManager(spotifyAuth, unifiedCache);

let mainWindow: BrowserWindow | null = null;
let pollInterval: NodeJS.Timeout | null = null;
let currentTrackKey: string | null = null;
let tray: Tray | null = null;
let cachedScriptPath: string | null = null;
let lastTrackData: TrackData | null = null;
let currentPollInterval = 1000;

// Window behavior management
let autoHideEnabled = false; // false = always show (default), true = show only when playing
let manualOverride = false;
let hideTimeout: NodeJS.Timeout | null = null;
let settingsStore: Store | null = null;

// Tray lyrics setting
let trayLyricsEnabled = true; // Show lyrics in system tray (default: enabled)

// Register custom protocol for OAuth callback (must be before app.whenReady)
if (process.defaultApp) {
  if (process.argv.length >= 2 && process.argv[1]) {
    app.setAsDefaultProtocolClient('musicdisplay', process.execPath, [
      path.resolve(process.argv[1])
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
    trayLyricsEnabled = settingsStore.get('trayLyricsEnabled', true) as boolean;
  }
  return settingsStore;
}

function saveAutoHideSetting(enabled: boolean): void {
  autoHideEnabled = enabled;
  if (settingsStore) {
    settingsStore.set('autoHideEnabled', enabled);
  }
  Logger.app.info(`Auto-hide ${enabled ? 'enabled' : 'disabled'}`);
}

function saveTrayLyricsSetting(enabled: boolean): void {
  trayLyricsEnabled = enabled;
  if (settingsStore) {
    settingsStore.set('trayLyricsEnabled', enabled);
  }

  // Clear tray immediately if disabled
  if (!enabled && tray) {
    tray.setTitle('');
  }

  Logger.app.info(`Tray lyrics ${enabled ? 'enabled' : 'disabled'}`);
}

// Window visibility control
function showWindow(shouldFocus: boolean = false): void {
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

function toggleWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isVisible()) {
      manualOverride = true;
      hideWindow();
      updateTrayMenu();
      Logger.app.debug('Window hidden by user (manual override enabled)');
    } else {
      manualOverride = false;
      showWindow(true); // User action: focus the window
      updateTrayMenu();
      Logger.app.debug('Window shown by user (manual override disabled)');
    }
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
  if (!mainWindow || mainWindow.isDestroyed()) return;

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
 * Tray lyrics IPC handler
 * Receives current lyrics text from renderer process and displays in system tray
 * This is the single entry point for tray updates - no state management here
 */
function handleTrayLyricsUpdate(text: string): void {
  if (!tray || !trayLyricsEnabled) return;

  // Truncate to 60 characters with ellipsis
  const maxLength = 60;
  const displayText =
    text.length > maxLength ? text.substring(0, maxLength - 3) + '...' : text;

  tray.setTitle(displayText);
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

  cachedScriptPath = path.join(app.getPath('temp'), 'lyricglow-music-poll.scpt');
  fs.writeFileSync(cachedScriptPath, script, 'utf8');
  Logger.app.info('AppleScript cached for polling');
}

function pollMusicState(): void {
  if (!cachedScriptPath) {
    Logger.music.error('Cached script not initialized');
    return;
  }

  exec(`osascript "${cachedScriptPath}"`, (error, stdout) => {
    if (error) {
      Logger.music.error('AppleScript execution failed', error);
      updatePollInterval(null);
      return;
    }

    const scriptOutput = stdout.trim();
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

  if (trackData && trackData.nowPlayingAvailable) {
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

async function broadcastMusicUpdate(trackData: TrackData | null): Promise<void> {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('music:update', trackData);

    if (trackData && trackData.title && trackData.artist) {
      const trackKey = `${trackData.title}-${trackData.artist}`;

      if (!currentTrackKey || currentTrackKey !== trackKey) {
        currentTrackKey = trackKey;
        manualOverride = false; // Reset on new track
        Logger.music.info(`Now playing: ${trackData.artist} - ${trackData.title}`);

        const [lyricsData, audioDBMetadata, spotifyMetadata] = await Promise.all([
          lyricsManager.fetchLyrics(trackData.title, trackData.artist),
          audioDBManager.fetchMetadata(trackData.artist),
          spotifyAuth.isLoggedIn()
            ? spotifyMetadataManager.fetchMetadata(trackData)
            : Promise.resolve(null)
        ]);

        const mergedMetadata = mergeArtistMetadata(audioDBMetadata, spotifyMetadata);

        // Send data to renderer (renderer manages tray via unified sync)
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('lyrics:update', lyricsData);
          mainWindow.webContents.send('metadata:update', mergedMetadata);
        }

        // Clear tray if no lyrics
        if (!lyricsData || !lyricsData.synced) {
          if (tray) tray.setTitle('');
        }
      }

      // Tray lyrics are now updated by renderer via IPC (unified sync)

      handleWindowVisibility(trackData.isPlaying);
    } else if (currentTrackKey) {
      currentTrackKey = null;
      if (tray) tray.setTitle('');
      mainWindow.webContents.send('lyrics:update', null);
      mainWindow.webContents.send('metadata:update', null);
      handleWindowVisibility(false);
    }
  }
}

function mergeArtistMetadata(audioDBData: any, spotifyData: any): MergedMetadata | null {
  if (!audioDBData && !spotifyData) return null;

  if (!spotifyData) {
    return {
      ...audioDBData,
      artist: {
        ...audioDBData.artist,
        allImages: audioDBData.artist.allImages
          .filter((img: string) => img && img !== '')
          .slice(0, 8)
      },
      hasSpotifyData: false
    };
  }

  if (!audioDBData) {
    return {
      artist: {
        ...spotifyData.artist,
        allImages: spotifyData.artist.images.map((img: any) => img.url)
      },
      topTracks: spotifyData.topTracks,
      topAlbums: spotifyData.topAlbums,
      hasSpotifyData: true
    };
  }

  const mergedArtist = {
    ...audioDBData.artist,
    ...(spotifyData.artist && {
      allImages: [spotifyData.artist.images[0]?.url, ...audioDBData.artist.allImages]
        .filter((img: string) => img && img !== '')
        .filter((img: string, index: number, self: string[]) => self.indexOf(img) === index)
        .slice(0, 8),
      spotifyPopularity: spotifyData.artist.popularity,
      spotifyGenres: spotifyData.artist.genres,
      spotifyFollowers: spotifyData.artist.followers.toLocaleString()
    })
  };

  return {
    artist: mergedArtist,
    topTracks:
      spotifyData.topTracks && spotifyData.topTracks.length > 0
        ? spotifyData.topTracks.map((t: any) => ({
            name: t.name,
            playcount: t.popularity,
            image: t.album.images[0]?.url || null,
            artist: t.artist,
            url: t.url
          }))
        : null,
    topAlbums:
      spotifyData.topAlbums && spotifyData.topAlbums.length > 0
        ? spotifyData.topAlbums.map((a: any) => ({
            name: a.name,
            playcount: a.total_tracks + ' tracks',
            image: a.images[0]?.url || null,
            artist: a.artist,
            url: a.url
          }))
        : null,
    hasSpotifyData: true
  };
}

function updateTrayMenu(): void {
  if (!tray) return;

  const isVisible = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible();

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'LyricGlow',
      enabled: false
    },
    { type: 'separator' },
    {
      label: isVisible ? 'Hide Window' : 'Show Window',
      accelerator: 'CommandOrControl+L',
      click: () => toggleWindow()
    },
    { type: 'separator' },
    {
      label: 'Window Behavior',
      submenu: [
        {
          label: 'Always Show',
          type: 'radio',
          checked: !autoHideEnabled,
          click: () => {
            saveAutoHideSetting(false);
            manualOverride = false;
            showWindow(false); // Don't steal focus from user's current app
            updateTrayMenu();
          }
        },
        {
          label: 'Show Only When Playing',
          type: 'radio',
          checked: autoHideEnabled,
          click: () => {
            saveAutoHideSetting(true);
            manualOverride = false;
            updateTrayMenu();
          }
        }
      ]
    },
    { type: 'separator' },
    {
      label: 'Settings',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          showWindow(true); // User action: show and focus
          mainWindow.webContents.send('open-settings');
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        (app as any).isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
}

function createTray(): void {
  try {
    const iconName = process.platform === 'darwin' ? 'iconTemplate.png' : 'icon.png';

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
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    hasShadow: true,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      devTools: process.env.NODE_ENV === 'development'
    }
  });

  mainWindow.setAlwaysOnTop(true, 'floating');
  mainWindow.setVisibleOnAllWorkspaces(true);

  Logger.app.debug(`Window positioned at: x=${width - windowWidth - padding}, y=${padding}`);

  mainWindow.on('close', (event) => {
    if (!(app as any).isQuitting) {
      event.preventDefault();
      manualOverride = true;
      hideWindow();
      updateTrayMenu();
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
        mainWindow.webContents.send('spotify:login-error', (error as Error).message);
      }
    }
  }
});

app.whenReady().then(async () => {
  Logger.app.info('App ready, initializing...');

  // Initialize settings store and load auto-hide setting
  await getSettingsStore();
  Logger.app.info(`Auto-hide mode: ${autoHideEnabled ? 'enabled' : 'disabled'}`);

  // Register global hotkey
  const hotkeyRegistered = globalShortcut.register('CommandOrControl+L', () => {
    toggleWindow();
    updateTrayMenu();
  });

  if (hotkeyRegistered) {
    Logger.app.info('Global hotkey registered: Cmd/Ctrl+L');
  } else {
    Logger.app.warn('Failed to register global hotkey');
  }

  createTray();
  createWindow();

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
  (app as any).isQuitting = true;
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

function executeMediaControl(command: string, param: number | null = null): void {
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
      mainWindow.webContents.send('spotify:login-error', (error as Error).message);
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
      size: await unifiedCache.getEntrySize(entry.type, entry.key)
    }))
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
    similar: true
  };

  if (key) {
    return store.get(`visibility.${key}`, defaults[key as keyof typeof defaults]);
  }
  return store.get('visibility', defaults);
});

ipcMain.handle('visibility:set', async (_event, key: string, value: boolean) => {
  const store = await getVisibilityStore();
  store.set(`visibility.${key}`, value);
  return true;
});

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
    openAsHidden: false
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
  (app as any).isQuitting = true;
  globalShortcut.unregisterAll();
  if (hideTimeout) clearTimeout(hideTimeout);
  if (pollInterval) {
    clearInterval(pollInterval);
  }
  if (cachedScriptPath) {
    try {
      fs.unlinkSync(cachedScriptPath);
      Logger.app.info('Cached script cleaned up');
    } catch (e) {
      Logger.app.debug('Cache cleanup skipped (file not found)');
    }
  }
});
