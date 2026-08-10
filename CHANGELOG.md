# Changelog

All notable changes to LyricGlow are documented here.
This project follows [Semantic Versioning](https://semver.org/).

## [0.8.0] - 2026-08-10

### Added

- **Floating Lyrics.** A desktop overlay mode that shows only the current lyric
  line — large, centred, word-by-word glow, translation underneath, no window
  chrome or background. It is click-through and floats above full-screen apps;
  **Move Floating Lyrics** in the menu bar makes it draggable, **Lock Floating
  Lyrics** puts it back and remembers the position. Toggle it from the menu bar
  or Settings → General.
- **Capture-friendly mode.** Launching with `LYRICGLOW_CAPTURE=1` keeps the
  window on the normal layer, so screen recorders and the window pickers in
  Zoom, Meet and Cap can finally see and share it. (The always-on-top overlay
  layer is invisible to them.)

### Changed

- **Translation is far more reliable — and faster.** Translation now runs
  through a modular provider system: Google Translate's own web endpoint
  first, Lingva as automatic fallback. A dead service gets one log line and a
  10-minute cooldown instead of a 60-second retry storm per song. Fresh songs
  translate in about a second; previously cached translations are untouched.
- New retina demo GIFs, a promo-video preview, and two downloadable promo
  videos in the README; repo media slimmed from 16 MB to ~3 MB.

## [0.7.0] - 2026-08-09

The biggest release so far: a full bug-fix round, security hardening, a large
performance overhaul, and a pass of UX polish across the whole app.

### Added

- **Click to seek.** Click any line in the full lyrics view, or the line above
  or below the current one in the main window, to jump straight to that point in
  the song.
- **Resume auto-scroll pill.** Scrolling the full lyrics view by hand now stops
  it following along, and a small button appears to hand control back.
- **Translation progress.** A subtle "Translating…" indicator shows while
  lyrics are being translated in the background.
- **Automation permission onboarding.** The first time macOS blocks access to
  Spotify or Music, the app explains what it needs, lists the exact System
  Settings path, and offers a button that opens that pane directly. Previously
  the only hint was an error string in place of the track title.
- **In-app dialogs and toasts.** Confirmations (clear cache, clear logs) and
  errors now use dialogs styled like the rest of the window instead of the
  native browser `alert()`/`confirm()` boxes.
- **Reduced-motion support.** Animations shorten or switch off for users who
  ask for reduced motion in macOS accessibility settings.

### Changed — performance

- **Roughly 4x less background CPU while playing.** The playback poll that
  spawns an `osascript` process dropped from twice a second to once every
  1.8 seconds; both processes already interpolate the position between polls, so
  nothing moves less smoothly. Using the app's own transport controls still
  triggers an immediate poll, so buttons react at once.
- **Menu bar lyrics are event-scheduled.** The 100 ms tray timer is gone; the
  next line is now scheduled for exactly when it is due, so idle cost between
  lines is nil.
- **The render loop stops when playback stops**, instead of running forever, and
  no longer redraws an invisible progress arc on every frame.
- **The progress bar is written about once a second** and left to the CSS
  transition, rather than being rewritten 60 times a second against it.
- **Artwork is streamed from disk** over an internal `lyricglow-cache://`
  protocol instead of being base64-encoded through IPC, and top tracks and
  albums load their covers in parallel rather than one at a time.
- **Faster, cleaner startup.** The window stays hidden until its first paint
  (no more flash of empty glass), and the GPU flags that were previously set too
  late to have any effect now apply.

### Changed — lyrics and UI

- **Smooth line transitions.** Lyric lines fade and settle into place instead of
  snapping, using compositor-only properties.
- **The word glow no longer shifts the line.** It animated font weight, which
  reflowed the whole line up to 30 times a second; it now animates colour and
  shadow only.
- Every `transition: all` in the stylesheet was replaced with an explicit list
  of paint and compositor properties.

### Fixed

- **The menu bar icon works again after closing the window** with the × button.
  It previously did nothing at all until you used the tray menu.
- **Settings opened from the menu bar stays open.** It could hide itself again
  moments later.
- **Full lyrics auto-scroll no longer switches itself off** on the first line
  change; only deliberate scrolling stops it.
- **One shared LRC parser.** Three different parsers disagreed about timestamp
  formats, so a line could appear in the menu bar but not the window, and
  translations could drift out of alignment with the lyrics.
- **Translation reliability.** A track change during a slow translation used to
  leave the new track untranslated forever; jobs now supersede each other. A
  mangled batch response is detected and retried line by line instead of
  silently shifting every following line, and a failed translation is no longer
  cached as blank text.
- **Cached content is served when a request fails.** The "offline fallback" path
  re-ran the same expiry check and always came back empty.
- **Connectivity is re-checked periodically.** An app started offline stayed
  convinced it was offline for the rest of the session.
- **Update checks accept pre-release versions** instead of failing to compare.
- **Spotify sessions survive a fast startup** — the token store is now loaded
  before the first login check.
- **Spotify's new Premium requirement no longer floods the log.** Spotify now
  refuses Web API requests unless the app owner holds an active Premium
  subscription, answering with plain text that the app tried to parse as JSON
  on every track. It now explains the situation once, pauses Spotify metadata
  requests for 30 minutes, and keeps serving artist data from TheAudioDB.

### Security

- **TLS verification is never disabled.** Failed handshakes used to be retried
  with certificate checking turned off, silently downgrading lyrics, metadata
  and image requests to connections an attacker on the path could read or
  rewrite. A TLS failure is now an ordinary error, and cached content covers it.
- **OAuth callbacks are validated.** The `state` parameter is generated, stored
  and checked in constant time, so an unsolicited callback is rejected.
- **External links are restricted** to `http`, `https`, `spotify:` and the macOS
  System Settings scheme, instead of handing any string to the OS.
- **Cache browser entries are built as DOM nodes**, so a crafted track name can
  no longer inject markup into the settings list.
- **The polling AppleScript lives in the app's own data directory** with `0600`
  permissions, not the shared temp directory where another local process could
  have swapped it between write and execution.

### Removed

- The similar-artists section and the listeners/plays/tags fields, which had no
  data source behind them.
- An unreferenced webfont, the dead vinyl progress arc, and the environment
  variables `.env.example` advertised but nothing read.

## [0.6.1] and earlier

See the [release notes](https://github.com/ateymoori/lyricglow/releases) on
GitHub.
