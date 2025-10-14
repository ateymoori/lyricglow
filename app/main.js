const { app, BrowserWindow, ipcMain, shell, Tray, Menu } = require('electron');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const Logger = require('./utils/Logger');
const UnifiedCacheManager = require('./cache/UnifiedCacheManager');
const LyricsManager = require('./lyrics/LyricsManager');
const TheAudioDBManager = require('./metadata/TheAudioDBManager');
const ImageCacheManager = require('./cache/ImageCacheManager');
const SpotifyAuth = require('./auth/SpotifyAuth');
const SpotifyMetadataManager = require('./metadata/SpotifyMetadataManager');

function loadConfig() {
  try {
    const envPath = path.join(__dirname, '../.env');
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      const config = {};
      envContent.split('\n').forEach(line => {
        if (line.includes('=')) {
          const [key, value] = line.split('=').map(s => s.trim());
          if (key === 'CACHE_DURATION_HOURS') {
            config[key] = parseInt(value) || 168;
          }
        }
      });
      return config;
    }
  } catch (error) {
    Logger.app.error('Failed to load config', error);
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

let mainWindow = null;
let pollInterval = null;
let currentTrackKey = null;
let tray = null;

// Register custom protocol for OAuth callback (must be before app.whenReady)
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('musicdisplay', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('musicdisplay');
}

function pollMusicState() {
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

  const tmpFile = path.join(app.getPath('temp'), 'music-poll.scpt');
  fs.writeFileSync(tmpFile, script, 'utf8');

  exec(`osascript "${tmpFile}"`, (error, stdout) => {
    try {
      fs.unlinkSync(tmpFile);
    } catch (e) {
      // Ignore cleanup errors
    }

    if (error) {
      Logger.music.error('AppleScript execution failed', error);
      return;
    }

    const scriptOutput = stdout.trim();
    if (!scriptOutput || scriptOutput === '{}') {
      broadcastMusicUpdate(null);
      return;
    }

    try {
      const trackData = JSON.parse(scriptOutput);
      broadcastMusicUpdate(trackData);
    } catch (e) {
      Logger.music.error('Failed to parse music data', e);
      Logger.music.debug('Invalid JSON output:', scriptOutput);
    }
  });
}

async function broadcastMusicUpdate(trackData) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('music:update', trackData);

    if (trackData && trackData.title && trackData.artist) {
      const trackKey = `${trackData.title}-${trackData.artist}`;

      if (!currentTrackKey || currentTrackKey !== trackKey) {
        currentTrackKey = trackKey;
        Logger.music.info(`Now playing: ${trackData.artist} - ${trackData.title}`);

        const [lyricsData, audioDBMetadata, spotifyMetadata] = await Promise.all([
          lyricsManager.fetchLyrics(trackData.title, trackData.artist),
          audioDBManager.fetchMetadata(trackData.artist),
          spotifyAuth.isLoggedIn() ? spotifyMetadataManager.fetchMetadata(trackData) : Promise.resolve(null)
        ]);

        const mergedMetadata = mergeArtistMetadata(audioDBMetadata, spotifyMetadata);

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('lyrics:update', lyricsData);
          mainWindow.webContents.send('metadata:update', mergedMetadata);
        }
      }
    } else if (currentTrackKey) {
      currentTrackKey = null;
      mainWindow.webContents.send('lyrics:update', null);
      mainWindow.webContents.send('metadata:update', null);
    }
  }
}

function mergeArtistMetadata(audioDBData, spotifyData) {
  if (!audioDBData && !spotifyData) return null;

  if (!spotifyData) {
    return {
      ...audioDBData,
      artist: {
        ...audioDBData.artist,
        allImages: audioDBData.artist.allImages
          .filter(img => img && img !== '')
          .slice(0, 8)
      },
      hasSpotifyData: false
    };
  }

  if (!audioDBData) {
    return {
      artist: {
        ...spotifyData.artist,
        allImages: spotifyData.artist.images.map(img => img.url)
      },
      topTracks: spotifyData.topTracks,
      topAlbums: spotifyData.topAlbums,
      hasSpotifyData: true
    };
  }

  const mergedArtist = {
    ...audioDBData.artist,
    ...(spotifyData.artist && {
      allImages: [
        spotifyData.artist.images[0]?.url,
        ...audioDBData.artist.allImages
      ]
        .filter(img => img && img !== '')
        .filter((img, index, self) => self.indexOf(img) === index)
        .slice(0, 8),
      spotifyPopularity: spotifyData.artist.popularity,
      spotifyGenres: spotifyData.artist.genres,
      spotifyFollowers: spotifyData.artist.followers.toLocaleString()
    })
  };

  return {
    artist: mergedArtist,
    topTracks: spotifyData.topTracks && spotifyData.topTracks.length > 0
      ? spotifyData.topTracks.map(t => ({
          name: t.name,
          playcount: t.popularity,
          image: t.album.images[0]?.url || null,
          artist: t.artist,
          url: t.url
        }))
      : null,
    topAlbums: spotifyData.topAlbums && spotifyData.topAlbums.length > 0
      ? spotifyData.topAlbums.map(a => ({
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

function createTray() {
  try {
    const iconName = process.platform === 'darwin' ? 'iconTemplate.png' : 'icon.png';
    
    // In production (packaged app), icons are in Resources folder
    // In development, icons are in build folder
    const iconPath = app.isPackaged
      ? path.join(process.resourcesPath, iconName)
      : path.join(__dirname, '../build', iconName);
    
    tray = new Tray(iconPath);
    tray.setToolTip('LyricGlow');
    Logger.app.info('System tray created successfully');
  } catch (error) {
    Logger.app.error('Tray creation failed:', error.message);
    Logger.app.debug('Attempted icon path:', iconPath);
    return;
  }
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'LyricGlow',
      enabled: false
    },
    { type: 'separator' },
    {
      label: 'Settings',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send('open-settings');
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);
  
  tray.setContextMenu(contextMenu);
  
  tray.on('click', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function createWindow() {
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workArea;

  const windowWidth = 550;
  const windowHeight = 600;
  const padding = 20;

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
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      devTools: process.env.NODE_ENV === 'development'
    }
  });

  mainWindow.setAlwaysOnTop(true, 'floating');
  mainWindow.setVisibleOnAllWorkspaces(true);

  Logger.app.debug(`Window positioned at: x=${width - windowWidth - padding}, y=${padding}`);

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.webContents.once('did-finish-load', () => {
    Logger.app.info('Window loaded, starting music detection');
    pollMusicState();
    pollInterval = setInterval(pollMusicState, 3000);
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
      Logger.auth.error('OAuth callback failed', error);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('spotify:login-error', error.message);
      }
    }
  }
});

app.whenReady().then(() => {
  Logger.app.info('App ready, initializing...');

  createTray();
  createWindow();

  unifiedCache.clearExpired().catch(err => {
    Logger.cache.error('Background cache cleanup failed', err);
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
  app.isQuitting = true;
  app.quit();
});

ipcMain.on('open:external', (_event, url) => {
  if (url && typeof url === 'string') {
    shell.openExternal(url);
  }
});

ipcMain.on('music:seek', (_event, position) => {
  if (position === null || position === undefined) return;

  const positionInSeconds = Math.floor(position);

  const script = `
    if application "Spotify" is running then
      try
        tell application "Spotify"
          set player position to ${positionInSeconds}
        end tell
      end try
    end if

    if application "Music" is running then
      try
        tell application "Music"
          set player position to ${positionInSeconds}
        end tell
      end try
    end if
  `;

  exec(`osascript -e '${script}'`, (error) => {
    if (error) {
      Logger.music.error('Seek failed', error);
    }
  });
});

ipcMain.on('music:play-pause', () => {
  const script = `
    if application "Spotify" is running then
      try
        tell application "Spotify"
          playpause
        end tell
      end try
    end if

    if application "Music" is running then
      try
        tell application "Music"
          playpause
        end tell
      end try
    end if
  `;

  exec(`osascript -e '${script}'`, (error) => {
    if (error) {
      Logger.music.error('Play/pause failed', error);
    }
  });
});

ipcMain.on('music:next', () => {
  const script = `
    if application "Spotify" is running then
      try
        tell application "Spotify"
          next track
        end tell
      end try
    end if

    if application "Music" is running then
      try
        tell application "Music"
          next track
        end tell
      end try
    end if
  `;

  exec(`osascript -e '${script}'`, (error) => {
    if (error) {
      Logger.music.error('Next track failed', error);
    }
  });
});

ipcMain.on('music:previous', () => {
  const script = `
    if application "Spotify" is running then
      try
        tell application "Spotify"
          previous track
        end tell
      end try
    end if

    if application "Music" is running then
      try
        tell application "Music"
          previous track
        end tell
      end try
    end if
  `;

  exec(`osascript -e '${script}'`, (error) => {
    if (error) {
      Logger.music.error('Previous track failed', error);
    }
  });
});

ipcMain.handle('cache:image', async (_event, url) => {
  if (!url || typeof url !== 'string') {
    return null;
  }
  try {
    const cachedImage = await imageCache.getImage(url);
    return cachedImage;
  } catch (error) {
    Logger.cache.error('Image cache failed', error);
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
    Logger.auth.error('Failed to fetch user profile', error);
    return null;
  }
});

ipcMain.on('spotify:login', async () => {
  try {
    await spotifyAuth.startAuthFlow();
  } catch (error) {
    Logger.auth.error('Login failed', error);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('spotify:login-error', error.message);
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
    entries.map(async entry => ({
      ...entry,
      size: await unifiedCache.getEntrySize(entry.type, entry.key)
    }))
  );
  return enriched;
});

ipcMain.handle('cache:delete', async (_event, type, key) => {
  return await unifiedCache.deleteOne(type, key);
});

ipcMain.handle('cache:clear-all', async () => {
  await unifiedCache.clearAll();
  return true;
});

let visibilityStore = null;

async function getVisibilityStore() {
  if (!visibilityStore) {
    const Store = (await import('electron-store')).default;
    visibilityStore = new Store();
  }
  return visibilityStore;
}

ipcMain.handle('visibility:get', async (_event, key) => {
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
    return store.get(`visibility.${key}`, defaults[key]);
  }
  return store.get('visibility', defaults);
});

ipcMain.handle('visibility:set', async (_event, key, value) => {
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

ipcMain.handle('settings:set-launch-at-login', (_event, enabled) => {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: false
  });
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
  app.isQuitting = true;
  if (pollInterval) {
    clearInterval(pollInterval);
  }
});