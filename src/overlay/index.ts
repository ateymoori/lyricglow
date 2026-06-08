interface MusicData {
  title?: string;
  artist?: string;
  artworkUrl?: string;
  position: number;
  isPlaying: boolean;
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

const api = window.musicAPI;
const artwork = document.getElementById('artwork') as HTMLImageElement;
const trackInfo = document.getElementById('track-info') as HTMLSpanElement;
const lyricLine = document.getElementById('lyric-line') as HTMLDivElement;
const settingsBtn = document.getElementById('settings-btn') as HTMLButtonElement;

let syncedLyrics: LyricLine[] = [];
let position = 0;
let isPlaying = false;
let lastUpdateTime = Date.now();

function parseLRC(lrc: string): LyricLine[] {
  return lrc
    .split('\n')
    .map((line) => {
      const match = line.match(/^\[(\d+):(\d+\.\d+)\](.*)/);
      if (!match) return null;
      return {
        time: parseInt(match[1], 10) * 60 + parseFloat(match[2]),
        text: match[3].trim(),
      };
    })
    .filter((l): l is LyricLine => l !== null)
    .sort((a, b) => a.time - b.time);
}

function getActiveLyric(pos: number): string {
  if (syncedLyrics.length === 0) return '—';
  let result = '';
  for (const line of syncedLyrics) {
    if (line.time <= pos) result = line.text;
    else break;
  }
  return result || '—';
}

api.onUpdate((data: MusicData) => {
  isPlaying = data.isPlaying;
  position = data.position;
  lastUpdateTime = Date.now();

  const title = data.title || '';
  const artist = data.artist || '';
  trackInfo.textContent = [title, artist].filter(Boolean).join(' • ') || '—';

  if (data.artworkUrl) {
    artwork.src = data.artworkUrl;
    artwork.classList.add('visible');
  } else {
    artwork.classList.remove('visible');
  }
});

api.onLyricsUpdate((data: LyricsData | null) => {
  if (!data) {
    syncedLyrics = [];
    lyricLine.textContent = '—';
    return;
  }
  if (data.synced) {
    syncedLyrics = parseLRC(data.synced);
    lyricLine.textContent = getActiveLyric(position);
  } else {
    syncedLyrics = [];
    lyricLine.textContent = data.plain?.split('\n')[0] || '—';
  }
});

// Interpolates position between AppleScript polls at 60fps
function tick(): void {
  if (syncedLyrics.length > 0) {
    const elapsed = isPlaying ? (Date.now() - lastUpdateTime) / 1000 : 0;
    const current = getActiveLyric(position + elapsed);
    if (lyricLine.textContent !== current) {
      lyricLine.textContent = current;
    }
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// Drag — works with setIgnoreMouseEvents(true, { forward: true })
// Events pass through to apps below AND are forwarded to this renderer
let isDragging = false;
let isMouseInside = false;

const overlay = document.getElementById('overlay')!;

overlay.addEventListener('mouseenter', () => {
  isMouseInside = true;
  api.setIgnoreMouseEvents(false);
});

overlay.addEventListener('mouseleave', () => {
  isMouseInside = false;
  if (!isDragging) {
    api.setIgnoreMouseEvents(true, { forward: true });
  }
});

document.addEventListener('mousedown', (e: MouseEvent) => {
  if (e.button !== 0) return;
  isDragging = true;
  api.overlayDragStart({ x: e.screenX, y: e.screenY });
});

document.addEventListener('mousemove', (e: MouseEvent) => {
  if (isDragging) {
    if (e.buttons === 0) {
      isDragging = false;
      api.overlayDragStop();
      if (!isMouseInside) {
        api.setIgnoreMouseEvents(true, { forward: true });
      }
      return;
    }
    api.overlayDragMove({ x: e.screenX, y: e.screenY });
  }
});

document.addEventListener('mouseup', () => {
  if (isDragging) {
    isDragging = false;
    api.overlayDragStop();
    if (!isMouseInside) {
      api.setIgnoreMouseEvents(true, { forward: true });
    }
  }
});

// Load initial opacity
api.getOverlayOpacity().then((opacity: number) => {
  document.documentElement.style.setProperty('--overlay-bg-opacity', opacity.toString());
});

// Listen for opacity updates
api.onOverlayOpacityUpdate((opacity: number) => {
  document.documentElement.style.setProperty('--overlay-bg-opacity', opacity.toString());
});

// Signal main process that overlay renderer is ready to receive current music / lyrics updates
api.overlayReady();

// Open Settings
if (settingsBtn) {
  settingsBtn.addEventListener('click', (e) => {
    e.stopPropagation(); // Stop click from propagating (which would start a drag)
    api.openSettings();
  });
}

function updateMetadataVisibility(visible: boolean) {
  const container = document.getElementById('overlay')!;
  if (visible) {
    container.classList.remove('no-metadata');
  } else {
    container.classList.add('no-metadata');
  }
}

// Load initial metadata visibility
api.getOverlayShowMetadata().then((visible: boolean) => {
  updateMetadataVisibility(visible);
});

// Listen for metadata visibility updates
api.onOverlayShowMetadataUpdate((visible: boolean) => {
  updateMetadataVisibility(visible);
});
