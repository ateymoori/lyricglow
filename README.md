<div align="center">

<!-- Logo & Title -->
<img src="build/icon.png" alt="LyricGlow" width="140" height="140">

# LyricGlow

### Real-Time Synchronized Lyrics for macOS

Word-by-word lyrics highlighting for Spotify, Apple Music, and any macOS music player.

<!-- Primary Badges -->
<p>
  <a href="https://github.com/ateymoori/lyricglow/actions/workflows/ci.yml">
    <img src="https://github.com/ateymoori/lyricglow/actions/workflows/ci.yml/badge.svg" alt="CI">
  </a>
  <a href="https://github.com/ateymoori/lyricglow/releases">
    <img src="https://img.shields.io/github/v/release/ateymoori/lyricglow?color=00ff9f&label=Version" alt="Version">
  </a>
  <a href="https://github.com/ateymoori/lyricglow/releases">
    <img src="https://img.shields.io/github/downloads/ateymoori/lyricglow/total?color=00b8ff&label=Downloads" alt="Downloads">
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/github/license/ateymoori/lyricglow?color=blue" alt="License">
  </a>
</p>

<!-- Tech Badges -->
<p>
  <img src="https://img.shields.io/badge/Platform-macOS%2011+-black?logo=apple&logoColor=white" alt="macOS">
  <img src="https://img.shields.io/badge/Electron-33-47848F?logo=electron&logoColor=white" alt="Electron">
  <img src="https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Architecture-ARM64%20%7C%20x64-orange" alt="Architecture">
</p>

<!-- Demo GIF -->
<br>
<img src="screenshots/lyricglow-macos-app-demo-real-time-lyrics-synchronization.gif" alt="LyricGlow Demo" width="720">
<br>
<sub>Real-time synchronized lyrics with word-by-word highlighting</sub>

</div>

<br>

## Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/ateymoori/lyricglow/main/scripts/install.sh | bash
```

> **Supports:** Apple Silicon (M1/M2/M3/M4) and Intel Macs • macOS 11.0+

<details>
<summary><strong>Manual Installation</strong></summary>
<br>

1. Download from [Releases](https://github.com/ateymoori/lyricglow/releases):
   - **Apple Silicon:** `LyricGlow-arm64.dmg`
   - **Intel:** `LyricGlow-x64.dmg`
2. Open DMG → Drag to Applications
3. First launch: Right-click → Open

</details>

<br>

## Features

<table>
<tr>
<td>

**Core**
- Real-time word-by-word highlighting
- Auto-sync with playback position
- Full lyrics modal view
- Progress bar seek support

</td>
<td>

**Integrations**
- Spotify, Apple Music, YouTube Music
- Spotify OAuth for top tracks/albums
- Menu bar live lyrics display
- 7-day intelligent caching

</td>
<td>

**Design**
- Glassmorphism UI
- RTL support (Arabic, Persian, Hebrew)
- Customizable sections
- Always-on-top floating window

</td>
</tr>
</table>

<br>

## Screenshots

<div align="center">
<table>
<tr>
<td align="center"><img src="screenshots/lyricglow-macos-full-mode-artist-metadata-lyrics.png" width="360"><br><strong>Full Mode</strong></td>
<td align="center"><img src="screenshots/lyricglow-macos-compact-mode-floating-widget.png" width="360"><br><strong>Compact Mode</strong></td>
</tr>
<tr>
<td align="center"><img src="screenshots/lyricglow-macos-lyrics-only-mode-word-highlighting.png" width="360"><br><strong>Lyrics Only</strong></td>
<td align="center"><img src="screenshots/lyricglow-macos-rtl-support-persian-arabic-hebrew.png" width="360"><br><strong>RTL Support</strong></td>
</tr>
</table>

<img src="screenshots/lyricglow-macos-menu-bar-lyrics-animation.gif" width="480">
<br>
<sub>Menu Bar Integration</sub>
</div>

<br>

## Usage

1. **Launch** LyricGlow from Applications
2. **Play** music in any supported player
3. **Watch** lyrics sync with word-by-word glow
4. **Customize** via settings (gear icon)

| Shortcut | Action |
|----------|--------|
| `Cmd+L` | Toggle window |
| Click progress bar | Seek to position |
| Click album art | Open in Spotify |

<br>

## Development

```bash
git clone https://github.com/ateymoori/lyricglow.git && cd lyricglow
npm install
npm run dev      # Development with hot reload
npm run build    # Compile TypeScript
npm run dist     # Build DMG
```

<details>
<summary><strong>Project Structure</strong></summary>

```
src/
├── main/           # Electron main process
│   ├── auth/       # Spotify OAuth
│   └── managers/   # Lyrics, metadata, cache
├── preload/        # IPC bridge
├── renderer/       # UI (DOM manipulation)
└── shared/         # Types, utilities, logger
```

</details>

<br>

## Contributing

PRs welcome! Priority areas:

- Windows/Linux support
- Additional lyrics sources
- UI translations

<br>

## Credits

| Service | Purpose |
|---------|---------|
| [LRCLIB](https://lrclib.net/) | Synchronized lyrics |
| [TheAudioDB](https://www.theaudiodb.com/) | Artist metadata |
| [Spotify API](https://developer.spotify.com/) | Top tracks & albums |

<br>

---

<div align="center">

**MIT License** © [AmirHossein Teymoori](https://github.com/ateymoori)

<p>
  <a href="https://github.com/ateymoori/lyricglow/issues">Report Bug</a>
  •
  <a href="https://github.com/ateymoori/lyricglow/issues">Request Feature</a>
  •
  <a href="https://github.com/ateymoori/lyricglow/releases">Releases</a>
</p>

<br>

**If you find LyricGlow useful, consider giving it a ⭐**

</div>
