/**
 * Preload Script
 *
 * Exposes secure IPC API to renderer process via contextBridge.
 * Provides type-safe communication between main and renderer processes.
 */

import { contextBridge, type IpcRendererEvent, ipcRenderer } from 'electron';

// Type definitions for the exposed API
// Using 'any' for dynamic IPC payloads to avoid strict type checking issues
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IpcPayload = any;

interface MusicAPI {
  // Music updates
  onUpdate: (callback: (payload: IpcPayload) => void) => void;
  onLyricsUpdate: (callback: (payload: IpcPayload) => void) => void;
  onMetadataUpdate: (callback: (payload: IpcPayload) => void) => void;
  onPermissionError: (callback: () => void) => void;
  onPermissionGranted: (callback: () => void) => void;
  updateTrayLyrics: (text: string) => void;

  // App control
  quit: () => void;
  closeWindow: () => void;
  openExternal: (url: string) => void;

  // Cache
  cacheImage: (url: string) => Promise<string | null>;

  // Media controls
  seek: (position: number) => void;
  playPause: () => void;
  nextTrack: () => void;
  previousTrack: () => void;

  // Spotify auth
  spotifyIsLoggedIn: () => Promise<boolean>;
  spotifyGetUserProfile: () => Promise<IpcPayload>;
  spotifyLogin: () => void;
  spotifyLogout: () => void;
  onSpotifyLoggedIn: (callback: () => void) => void;
  onSpotifyLoggedOut: (callback: () => void) => void;
  onSpotifyLoginError: (callback: (error: string) => void) => void;

  // Cache management
  cacheList: () => Promise<IpcPayload[]>;
  cacheDelete: (type: string, key: string) => Promise<boolean>;
  cacheClearAll: () => Promise<boolean>;

  // Visibility settings
  visibilityGet: (key?: string) => Promise<IpcPayload>;
  visibilitySet: (key: string, value: boolean) => Promise<boolean>;
  visibilityReset: () => Promise<boolean>;

  // App settings
  getLaunchAtLogin: () => Promise<boolean>;
  setLaunchAtLogin: (enabled: boolean) => Promise<boolean>;
  getTrayLyrics: () => Promise<boolean>;
  setTrayLyrics: (enabled: boolean) => Promise<boolean>;
  onOpenSettings: (callback: () => void) => void;

  // Logs
  logsGetStats: () => Promise<IpcPayload>;
  logsOpenFolder: () => Promise<boolean>;
  logsClear: () => Promise<boolean>;

  // Translation
  onTranslationUpdate: (callback: (payload: IpcPayload) => void) => void;
  translationGetEnabled: () => Promise<boolean>;
  translationSetEnabled: (enabled: boolean) => Promise<boolean>;
  translationGetTargetLang: () => Promise<string>;
  translationSetTargetLang: (langCode: string) => Promise<boolean>;
  translationGetLanguages: () => Promise<
    Array<{ code: string; name: string; rtl: boolean }>
  >;
  translationRefresh: () => Promise<boolean>;
}

const musicAPI: MusicAPI = {
  // Music updates
  onUpdate: (callback: (payload: IpcPayload) => void) => {
    ipcRenderer.on(
      'music:update',
      (_event: IpcRendererEvent, payload: IpcPayload) => callback(payload),
    );
  },
  onLyricsUpdate: (callback: (payload: IpcPayload) => void) => {
    ipcRenderer.on(
      'lyrics:update',
      (_event: IpcRendererEvent, payload: IpcPayload) => callback(payload),
    );
  },
  onMetadataUpdate: (callback: (payload: IpcPayload) => void) => {
    ipcRenderer.on(
      'metadata:update',
      (_event: IpcRendererEvent, payload: IpcPayload) => callback(payload),
    );
  },
  onPermissionError: (callback: () => void) => {
    ipcRenderer.on('music:permission-error', () => callback());
  },
  onPermissionGranted: (callback: () => void) => {
    ipcRenderer.on('music:permission-granted', () => callback());
  },
  updateTrayLyrics: (text: string) => {
    ipcRenderer.send('tray:update-lyrics', text);
  },

  // App control
  quit: () => {
    ipcRenderer.send('app:quit');
  },
  closeWindow: () => {
    ipcRenderer.send('window:close');
  },
  openExternal: (url: string) => {
    ipcRenderer.send('open:external', url);
  },

  // Cache
  cacheImage: (url: string) => {
    return ipcRenderer.invoke('cache:image', url);
  },

  // Media controls
  seek: (position: number) => {
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

  // Spotify auth
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
  onSpotifyLoggedIn: (callback: () => void) => {
    ipcRenderer.on('spotify:logged-in', () => callback());
  },
  onSpotifyLoggedOut: (callback: () => void) => {
    ipcRenderer.on('spotify:logged-out', () => callback());
  },
  onSpotifyLoginError: (callback: (error: string) => void) => {
    ipcRenderer.on(
      'spotify:login-error',
      (_event: IpcRendererEvent, error: string) => callback(error),
    );
  },

  // Cache management
  cacheList: () => {
    return ipcRenderer.invoke('cache:list');
  },
  cacheDelete: (type: string, key: string) => {
    return ipcRenderer.invoke('cache:delete', type, key);
  },
  cacheClearAll: () => {
    return ipcRenderer.invoke('cache:clear-all');
  },

  // Visibility settings
  visibilityGet: (key?: string) => {
    return ipcRenderer.invoke('visibility:get', key);
  },
  visibilitySet: (key: string, value: boolean) => {
    return ipcRenderer.invoke('visibility:set', key, value);
  },
  visibilityReset: () => {
    return ipcRenderer.invoke('visibility:reset');
  },

  // App settings
  getLaunchAtLogin: () => {
    return ipcRenderer.invoke('settings:get-launch-at-login');
  },
  setLaunchAtLogin: (enabled: boolean) => {
    return ipcRenderer.invoke('settings:set-launch-at-login', enabled);
  },
  getTrayLyrics: () => {
    return ipcRenderer.invoke('settings:get-tray-lyrics');
  },
  setTrayLyrics: (enabled: boolean) => {
    return ipcRenderer.invoke('settings:set-tray-lyrics', enabled);
  },
  onOpenSettings: (callback: () => void) => {
    ipcRenderer.on('open-settings', () => callback());
  },

  // Logs
  logsGetStats: () => {
    return ipcRenderer.invoke('logs:get-stats');
  },
  logsOpenFolder: () => {
    return ipcRenderer.invoke('logs:open-folder');
  },
  logsClear: () => {
    return ipcRenderer.invoke('logs:clear');
  },

  // Translation
  onTranslationUpdate: (callback: (payload: IpcPayload) => void) => {
    ipcRenderer.on(
      'translation:update',
      (_event: IpcRendererEvent, payload: IpcPayload) => callback(payload),
    );
  },
  translationGetEnabled: () => {
    return ipcRenderer.invoke('translation:get-enabled');
  },
  translationSetEnabled: (enabled: boolean) => {
    return ipcRenderer.invoke('translation:set-enabled', enabled);
  },
  translationGetTargetLang: () => {
    return ipcRenderer.invoke('translation:get-target-lang');
  },
  translationSetTargetLang: (langCode: string) => {
    return ipcRenderer.invoke('translation:set-target-lang', langCode);
  },
  translationGetLanguages: () => {
    return ipcRenderer.invoke('translation:get-languages');
  },
  translationRefresh: () => {
    return ipcRenderer.invoke('translation:refresh');
  },
};

contextBridge.exposeInMainWorld('musicAPI', musicAPI);

// Type declaration for global window object (used in renderer)
declare global {
  interface Window {
    musicAPI: MusicAPI;
  }
}
