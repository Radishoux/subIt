# LinguaLive

A Chrome Extension (Manifest V3) that provides **real-time audio translation subtitles** as a floating overlay on any browser tab.

## Features

- **Side panel UI** — language selection, controls, and settings accessible via the toolbar icon
- **Tab audio capture** — captures audio from the active tab (no separate app required)
- **Web Speech API** — real-time speech recognition with interim results
- **Offline-first translation** — uses `@xenova/transformers` with Helsinki-NLP/opus-mt models
- **Background verification** — asynchronously checks translations every 5s via MyMemory/LibreTranslate APIs
- **Configurable subtitles** — 1–5 lines, 4 font sizes, top/bottom position, opacity control
- **15 language pairs** — French, Spanish, German, Italian, Portuguese, Dutch, Russian, Japanese, Chinese, Korean, Arabic, Polish, Turkish, Swedish, Norwegian (all ↔ English)

## Project Structure

```
subIt/
├── manifest.json           # MV3 manifest
├── background.js           # Service worker — orchestrates everything
├── sidepanel/
│   ├── sidepanel.html      # Side panel UI
│   ├── sidepanel.css
│   └── sidepanel.js        # Language selection, controls, pack management
├── overlay/
│   ├── overlay.html        # Subtitle overlay (injected as iframe)
│   ├── overlay.css
│   └── overlay.js          # Subtitle rendering and animations
├── content/
│   └── content.js          # Injected into tab — bridges background ↔ overlay
├── offscreen/
│   ├── offscreen.html      # Offscreen document (audio + speech recognition)
│   └── offscreen.js        # Capture, recognition, translation pipeline
├── translation/
│   ├── engine.js           # Offline translation (Transformers.js, singleton pipelines)
│   ├── downloader.js       # Language pack downloader with progress reporting
│   └── verifier.js         # Background online verification (every 5s)
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── _locales/en/messages.json
```

## How to Load (Development)

1. Clone the repo:
   ```bash
   git clone https://github.com/Radishoux/subIt.git
   ```

2. Open Chrome and go to `chrome://extensions/`

3. Enable **Developer mode** (top-right toggle)

4. Click **Load unpacked** and select the `subIt/` folder

5. Click the LinguaLive icon in the toolbar to open the side panel

## How to Use

1. **Select languages** — choose source language (or Auto-detect) and target language
2. **Download a language pack** — in the "Language Packs" section, download the model for your language pair (first-time only, ~50–100 MB per pair)
3. **Click "Start Listening"** — subtitles will appear as a floating bar on the active tab
4. **Adjust settings** — configure lines, font size, position, and opacity in real time

## Architecture

### Message Flow

```
sidepanel.js
  → START_LISTENING → background.js
  → background creates offscreen doc, gets tab stream ID
  → offscreen.js: speech recognition → translate()
  → SUBTITLE_UPDATE → background → content.js → overlay iframe

verifier.js (in offscreen)
  → every 5s: online API check
  → SUBTITLE_CORRECTION → background → content.js → overlay (flash ✓)

downloader.js (in offscreen)
  → DOWNLOAD_PROGRESS → background → sidepanel UI
```

### Offline Translation

Uses [`@xenova/transformers`](https://github.com/xenova/transformers.js) loaded via CDN (cached in browser after first load). Models are stored in the browser's Cache API (IndexedDB) and reused across sessions. Models auto-unload after 5 minutes of inactivity.

### Audio Capture

Uses `chrome.tabCapture.getMediaStreamId()` (MV3 approach) to capture the active tab's audio. Falls back to `getUserMedia` (microphone) if tab capture fails. System-wide audio capture across all tabs would require a native messaging host — the code is architected to support this as a drop-in replacement.

## Known Limitations

- **Tab audio only** — cannot capture audio from other tabs or system audio (e.g. desktop apps) without a native messaging companion
- **Web Speech API** — depends on Google's speech recognition service; accuracy varies by language and accent
- **Model download size** — each language model is ~50–100 MB (quantized); downloaded once and cached
- **Rate limits** — the background verifier uses MyMemory (free tier: ~100 req/day) and LibreTranslate as fallback
- **Offscreen document** — MV3 allows only one offscreen document at a time; the extension handles this gracefully

## Development Notes

All debug logs are prefixed with `[LinguaLive]` and use `console.debug` — filter by this prefix in DevTools for clean output.

## License

MIT
