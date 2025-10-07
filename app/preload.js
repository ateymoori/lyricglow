const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('musicAPI', {
  onUpdate: (callback) => {
    ipcRenderer.on('music:update', (_event, payload) => callback(payload));
  },
  onLyricsUpdate: (callback) => {
    ipcRenderer.on('lyrics:update', (_event, payload) => callback(payload));
  },
  onMetadataUpdate: (callback) => {
    ipcRenderer.on('metadata:update', (_event, payload) => callback(payload));
  },
  quit: () => {
    ipcRenderer.send('app:quit');
  },
  openExternal: (url) => {
    ipcRenderer.send('open:external', url);
  },
  cacheImage: (url) => {
    return ipcRenderer.invoke('cache:image', url);
  },
  seek: (position) => {
    ipcRenderer.send('music:seek', position);
  },
  playPause: () => {
    ipcRenderer.send('music:play-pause');
  },
  nextTrack: () => {
    ipcRenderer.send('music:next');
  },
  previousTrack: () => {
    ipcRenderer.send('music:previous');
  },
  // Spotify Auth
  spotifyIsLoggedIn: () => {
    return ipcRenderer.invoke('spotify:is-logged-in');
  },
  spotifyGetUserProfile: () => {
    return ipcRenderer.invoke('spotify:get-user-profile');
  },
  spotifyLogin: () => {
    ipcRenderer.send('spotify:login');
  },
  spotifyLogout: () => {
    ipcRenderer.send('spotify:logout');
  },
  onSpotifyLoggedIn: (callback) => {
    ipcRenderer.on('spotify:logged-in', () => callback());
  },
  onSpotifyLoggedOut: (callback) => {
    ipcRenderer.on('spotify:logged-out', () => callback());
  },
  onSpotifyLoginError: (callback) => {
    ipcRenderer.on('spotify:login-error', (_event, error) => callback(error));
  },
  cacheList: () => {
    return ipcRenderer.invoke('cache:list');
  },
  cacheDelete: (type, key) => {
    return ipcRenderer.invoke('cache:delete', type, key);
  },
  cacheClearAll: () => {
    return ipcRenderer.invoke('cache:clear-all');
  },
  visibilityGet: (key) => {
    return ipcRenderer.invoke('visibility:get', key);
  },
  visibilitySet: (key, value) => {
    return ipcRenderer.invoke('visibility:set', key, value);
  },
  visibilityReset: () => {
    return ipcRenderer.invoke('visibility:reset');
  },
  getLaunchAtLogin: () => {
    return ipcRenderer.invoke('settings:get-launch-at-login');
  },
  setLaunchAtLogin: (enabled) => {
    return ipcRenderer.invoke('settings:set-launch-at-login', enabled);
  },
  onOpenSettings: (callback) => {
    ipcRenderer.on('open-settings', () => callback());
  }
});