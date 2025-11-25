<div align="center">

<img src="build/icon.png" alt="LyricGlow - Real-Time Synchronized Lyrics for macOS" width="120" height="120">

# LyricGlow

**Real-Time Synchronized Lyrics for macOS**

Word-by-word lyrics highlighting for Spotify, Apple Music, and any macOS music player.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Downloads](https://img.shields.io/github/downloads/ateymoori/lyricglow/total?style=flat&logo=github&label=Downloads)](https://github.com/ateymoori/lyricglow/releases)
[![macOS](https://img.shields.io/badge/macOS-11.0+-lightgrey.svg?logo=apple)](https://www.apple.com/macos)

<img src="screenshots/lyricglow-macos-app-demo-real-time-lyrics-synchronization.gif" alt="LyricGlow Demo - Real-time synchronized lyrics" width="700">

</div>

---

## Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/ateymoori/lyricglow/main/scripts/install.sh | bash
```

**Requirements:** macOS 11.0+ (Apple Silicon & Intel supported)

<details>
<summary><b>Manual Installation</b></summary>

1. Download the latest DMG from [Releases](https://github.com/ateymoori/lyricglow/releases):
   - **Apple Silicon (M1/M2/M3/M4):** `LyricGlow-arm64.dmg`
   - **Intel Mac:** `LyricGlow-x64.dmg`
2. Open the DMG and drag LyricGlow to Applications
3. Right-click the app and select "Open" (required for first launch)

</details>

---

## Features

- **Synchronized Lyrics** - Word-by-word highlighting synced to your music
- **Universal Support** - Works with Spotify, Apple Music, YouTube Music, and more
- **Artist Metadata** - Biography, images, top tracks, and albums
- **RTL Languages** - Full support for Arabic, Persian, and Hebrew
- **Menu Bar Lyrics** - See current lyrics in your menu bar
- **Spotify Integration** - Connect your account for enhanced features
- **Offline Caching** - 7-day intelligent cache for lyrics and metadata
- **Beautiful UI** - Glassmorphism design with smooth animations

---

## Screenshots

<table>
<tr>
<td width="50%" align="center">
<img src="screenshots/lyricglow-macos-full-mode-artist-metadata-lyrics.png" alt="LyricGlow Full Mode" width="380">
<br><b>Full Mode</b>
</td>
<td width="50%" align="center">
<img src="screenshots/lyricglow-macos-compact-mode-floating-widget.png" alt="LyricGlow Compact Mode" width="380">
<br><b>Compact Mode</b>
</td>
</tr>
<tr>
<td width="50%" align="center">
<img src="screenshots/lyricglow-macos-lyrics-only-mode-word-highlighting.png" alt="LyricGlow Lyrics Only" width="380">
<br><b>Lyrics Only</b>
</td>
<td width="50%" align="center">
<img src="screenshots/lyricglow-macos-rtl-support-persian-arabic-hebrew.png" alt="LyricGlow RTL Support" width="380">
<br><b>RTL Support</b>
</td>
</tr>
</table>

<div align="center">
<img src="screenshots/lyricglow-macos-menu-bar-lyrics-animation.gif" alt="LyricGlow Menu Bar" width="500">
<br><b>Menu Bar Integration</b>
</div>

---

## Usage

1. Launch LyricGlow from Applications
2. Play music in Spotify, Apple Music, or any player
3. Watch lyrics sync automatically with word-by-word highlighting
4. Click the gear icon to customize settings

**Keyboard Shortcut:** `Cmd+L` toggles window visibility

---

## Development

```bash
# Clone and install
git clone https://github.com/ateymoori/lyricglow.git
cd lyricglow
npm install

# Development
npm run dev

# Build
npm run build
npm run dist
```

**Tech Stack:** Electron, TypeScript, electron-vite

---

## Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Submit a pull request

**Priorities:** Windows/Linux support, additional lyrics sources, UI translations

---

## Credits

- [LRCLIB](https://lrclib.net/) - Synchronized lyrics database
- [TheAudioDB](https://www.theaudiodb.com/) - Artist metadata
- [Spotify Web API](https://developer.spotify.com/) - Music metadata

---

## License

MIT License - [AmirHossein Teymoori](https://github.com/ateymoori)

<div align="center">

[![GitHub](https://img.shields.io/badge/GitHub-@ateymoori-181717?logo=github)](https://github.com/ateymoori)

**[Report Issues](https://github.com/ateymoori/lyricglow/issues)** | **[Releases](https://github.com/ateymoori/lyricglow/releases)**

</div>
