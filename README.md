<div align="center">
<img width="1200" height="475" alt="Aura Music Banner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Aura Music

Aura Music is a high-fidelity, immersive music player inspired by Apple Music. This fork extends the original web player with desktop lyrics, smarter lyric loading, and batch lyric import for local music libraries.

## Features

- [x] **WebGL Fluid Background**: Dynamic fluid background powered by WebGL shaders. [Reference](https://www.shadertoy.com/view/wdyczG)
- [x] **Canvas Lyric Rendering**: Smooth, high-performance lyric visualization with bilingual lyrics and word-level timing support.
- [x] **Music Import & Search**: Import local audio files or search and import tracks from supported online providers.
- [x] **Desktop Lyrics Overlay**: Transparent always-on-top Tauri lyrics window with playback controls, mouse passthrough mode, and a global `P` shortcut to exit passthrough after the window loses focus.
- [x] **Lyric And Song Preloading**: Preloads lyrics for the next predicted track, retries automatically after a first failure, and keeps local lyrics as a fallback when online matching fails.
- [x] **Batch Lyric Upload**: Upload a folder of `.lrc` files, automatically match them to existing tracks, and fill songs that are missing lyrics.
- [x] **Playback Controls**: Play/pause, previous/next, seek, loop, shuffle, playback speed, and pitch controls.
- [x] **System Integration**: Media Session support, PWA support, IndexedDB library persistence, and keyboard shortcuts.

## Project Structure

```text
aura-music/
├─ components/              # React UI components
├─ hooks/                   # Player, playlist, lyric overlay, search, and UI hooks
├─ services/                # Lyrics parsing, NetEase/TTML fetching, cache, persistence
├─ desktop-lyrics/          # Tauri desktop lyrics overlay window
├─ lyric-overlay-server/    # WebSocket/HTTP bridge for desktop lyrics
├─ public/                  # PWA and static assets
└─ tests/                   # Bun tests
```

## Dependencies

### Web Player

- **React 19** and **React DOM 19** for the application UI.
- **Vite 6** and **TypeScript 5.8** for development and production builds.
- **@vitejs/plugin-react** for React support in Vite.
- **vite-plugin-pwa** for PWA generation.
- **@react-spring/web** for spring-based UI animation.
- **colorthief** for album-art color extraction.
- **fast-xml-parser** for TTML/XML lyric parsing.
- **jsmediatags** for local audio metadata and embedded lyric extraction.

### Lyric Overlay Server

- **Node.js** HTTP server plus **ws 8** for WebSocket relay between the web player and the desktop lyrics window.

### Desktop Lyrics Window

- **Tauri 2** for the transparent always-on-top desktop window.
- **Rust 1.77.2+** for the Tauri backend.
- **tauri-plugin-global-shortcut** for the global `P` passthrough-exit shortcut.
- **tauri-plugin-window-state** for window state persistence.
- **serde** and **serde_json** for native-side serialization.
- **Microsoft Edge WebView2 Runtime** on Windows.

## Run Locally

**Prerequisites**

- Node.js 18 or newer.
- npm.
- Rust toolchain and Microsoft C++ Build Tools if you need to rebuild the desktop lyrics executable.
- Microsoft Edge WebView2 Runtime for the Tauri desktop lyrics window on Windows.

### Web Player

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

### Lyric Overlay Server

The desktop lyrics feature uses the bridge server on port `8787`.

```bash
cd lyric-overlay-server
npm install
npm start
```

### Desktop Lyrics Window

```bash
cd desktop-lyrics
npm install
npm run build
```

The release executable is generated under:

```text
desktop-lyrics/src-tauri/target/release/aura-desktop-lyrics.exe
```

After the web player and overlay server are running, use the desktop lyrics button in the top bar to open or close the overlay window.

## Screenshots

![Screenshot1](./images/screenshot1.png)
![Screenshot2](./images/screenshot2.png)
![Screenshot3](./images/screenshot3.png)
![Screenshot4](./images/screenshot4.png)

## Credits

- Original project: [dingyi222666/aura-music](https://github.com/dingyi222666/aura-music)
- Shader source: https://www.shadertoy.com/view/wdyczG
