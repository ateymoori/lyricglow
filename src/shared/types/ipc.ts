/**
 * IPC Channel Definitions
 *
 * Centralized IPC channel names for type-safe main ↔ renderer communication.
 * Using const assertions for strict literal types.
 */

export const IPC_CHANNELS = {
  // Music playback events
  MUSIC_UPDATE: 'music:update',
  MUSIC_SEEK: 'music:seek',
  MUSIC_PLAY_PAUSE: 'music:play-pause',
  MUSIC_NEXT: 'music:next',
  MUSIC_PREVIOUS: 'music:previous',

  // Lyrics events
  LYRICS_UPDATE: 'lyrics:update',

  // Metadata events
  METADATA_UPDATE: 'metadata:update',

  // Tray events
  TRAY_UPDATE_LYRICS: 'tray:update-lyrics',

  // App control
  APP_QUIT: 'app:quit',
  OPEN_EXTERNAL: 'open:external',
  OPEN_SETTINGS: 'open-settings',

  // Cache operations
  CACHE_IMAGE: 'cache:image',
  CACHE_LIST: 'cache:list',
  CACHE_DELETE: 'cache:delete',
  CACHE_CLEAR_ALL: 'cache:clear-all',

  // Visibility settings
  VISIBILITY_GET: 'visibility:get',
  VISIBILITY_SET: 'visibility:set',
  VISIBILITY_RESET: 'visibility:reset',

  // App settings
  SETTINGS_GET_LAUNCH_AT_LOGIN: 'settings:get-launch-at-login',
  SETTINGS_SET_LAUNCH_AT_LOGIN: 'settings:set-launch-at-login',
  SETTINGS_GET_TRAY_LYRICS: 'settings:get-tray-lyrics',
  SETTINGS_SET_TRAY_LYRICS: 'settings:set-tray-lyrics',

  // Spotify auth
  SPOTIFY_IS_LOGGED_IN: 'spotify:is-logged-in',
  SPOTIFY_GET_USER_PROFILE: 'spotify:get-user-profile',
  SPOTIFY_LOGIN: 'spotify:login',
  SPOTIFY_LOGOUT: 'spotify:logout',
  SPOTIFY_LOGGED_IN: 'spotify:logged-in',
  SPOTIFY_LOGGED_OUT: 'spotify:logged-out',
  SPOTIFY_LOGIN_ERROR: 'spotify:login-error',

  // Logs
  LOGS_GET_STATS: 'logs:get-stats',
  LOGS_OPEN_FOLDER: 'logs:open-folder',
  LOGS_CLEAR: 'logs:clear'
} as const;

export type IpcChannel = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS];
