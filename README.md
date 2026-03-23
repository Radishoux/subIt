# subIt

A Chrome extension for managing and tracking subscriptions.

## Overview

subIt is a browser extension that helps you keep track of your subscriptions — giving you visibility into what you're subscribed to, when renewals happen, and how much you're spending.

## Features

- Track active subscriptions
- Get renewal reminders
- View spending summaries

## Development

### Prerequisites

- Google Chrome or Chromium-based browser
- Node.js (for build tooling, optional)

### Getting Started

1. Clone the repository:
   ```bash
   git clone https://github.com/Radishoux/subIt.git
   cd subIt
   ```

2. Load the extension in Chrome:
   - Open `chrome://extensions/`
   - Enable **Developer mode**
   - Click **Load unpacked** and select the project folder

## Project Structure

```
subIt/
├── manifest.json       # Chrome extension manifest
├── popup/              # Popup UI
├── background/         # Background service worker
├── content/            # Content scripts
└── assets/             # Icons and static assets
```

## License

MIT
