# M0SH TimeStretch Player

A desktop audio player for focused listening, transcription, and practice. Open MP3 or WAV files, slow them down while preserving pitch, shift pitch independently, and study the waveform at your own pace.

Repository: [github.com/MoshRadix/TimeStretch](https://github.com/MoshRadix/TimeStretch).

## Features

- Variable playback tempo with pitch preservation and independent semitone shifting
- Scrubbable waveform, playback controls, bookmarks, and volume control
- Voice clarity processing and a noise reduction toggle
- Three-band equalizer for bass, mids, and treble (±12 dB)
- Transcription editor with Dhivehi phonetic input, English mode, and text export
- Global keyboard shortcuts, editable in Settings
- Audio preferences saved per file on this device, including tempo, pitch, volume, clarity, noise reduction, and EQ settings
- Waveform analysis and playback position saved locally

## Run in development

Install Node.js 20.19+ (or 22.12+), then from this folder:

```sh
npm install
npm start
```

The development build does not check for application updates. Updates are checked by packaged installations.

## Build an installer

```sh
npm run pack
```

Electron 44.7.0 is pinned in `package.json`. Electron Builder is configured for Windows NSIS, macOS DMG, and Linux AppImage installers. The automated release workflow currently publishes Windows installers.

## Automatic updates

Packaged stable releases use `electron-updater` with GitHub Releases. The app checks for updates at startup and every four hours, downloads available updates automatically, and shows download progress in the app. Once a download is ready, it installs when playback stops and restarts the app. You can also select **Check for updates** in the About panel. Update checks require an installed, packaged app.

Large files (64 MB and above) use the bundled Windows `audiowaveform` command-line generator to create and cache the waveform quickly. Other platforms, or installations where the generator cannot run, use the built-in streamed analyzer. The bundled audiowaveform 1.10.2 executable is distributed under GPL-3.0-or-later; its license and corresponding source archive are included with the installed app under `resources/audiowaveform`.

## Publish a Windows release

Update the version in `package.json`, commit and push the changes to `main`, then run:

```sh
npm run release
```

The release script creates and pushes the matching `v<version>` tag. GitHub Actions builds and publishes the Windows installer and updater metadata using the repository's `GITHUB_TOKEN`; do not run `publish:win` locally for the same release.

## Controls and audio settings

- Use the Playback speed slider for tempo and the Pitch shift slider for semitones. Reset returns them to `1×` and `0 st`.
- Use the waveform to seek. The transport includes play, stop, loop, volume, and three-second skip controls.
- Enable Voice clarity for a presence filter and gentle compression. Noise reduction applies filtering and reduces low-level background sound.
- Enable the Equalizer to adjust bass, mids, and treble independently from −12 dB to +12 dB.
- Audio settings are stored separately for each file on this device and restored when that file is opened again.
- Open Settings and click any shortcut to change it. Defaults are `Ctrl+Space` for play/pause, `Alt+Up/Down` for tempo, `Ctrl+Alt+Left/Right` for pitch, and `Alt+Left/Right` for seeking.

Tempo and pitch processing run through the SoundTouchJS AudioWorklet. Waveforms are cached locally and refreshed automatically when the audio file changes.
