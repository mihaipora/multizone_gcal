# Multizone GCal

Chrome extension that adds multi-timezone columns to Google Calendar and highlights times in Gmail with timezone conversions.

![Chrome](https://img.shields.io/badge/Chrome-MV3-blue) ![React](https://img.shields.io/badge/React-19-61dafb) ![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6)

## Features

- **Calendar overlay** — Adds timezone columns to the left of Google Calendar's hour grid, aligned and scroll-synced with the native layout
- **Gmail time detection** — Highlights times in emails (e.g. "3:00 PM") with hover tooltips showing conversions across all your saved timezones
- **Searchable timezone picker** — Search ~400 IANA timezones by city, country name, abbreviation, or UTC offset (e.g. "India", "Mumbai", "IST", "UTC+5:30")
- **Half-hour offset support** — Correctly displays :30 and :45 offsets (India, Nepal, etc.)
- **Side panel + popup** — Manage timezones from either the side panel or toolbar popup, changes sync instantly between both
- **No external APIs** — All timezone logic uses the browser's built-in `Intl` API

## Development

### Prerequisites

- Node.js 18+
- npm

### Setup

```sh
git clone git@github.com:mihaipora/multizone_gcal.git
cd multizone_gcal
npm install
```

### Run in dev mode (hot reload)

```sh
npm run dev
```

This starts WXT's dev server with hot module replacement. To load it in Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode** (toggle in top right)
3. Click **Load unpacked**
4. Select the `.output/chrome-mv3-dev` folder inside the project

The extension will auto-reload when you edit source files.

### Build for production

```sh
npm run build
```

Output goes to `.output/chrome-mv3`. To test the production build:

1. Open `chrome://extensions`
2. Click **Load unpacked**
3. Select `.output/chrome-mv3`

### Create distributable ZIP

```sh
npm run zip
```

Creates a ready-to-upload ZIP for the Chrome Web Store.

### Firefox

```sh
npm run dev:firefox      # dev mode
npm run build:firefox    # production build
npm run zip:firefox      # distributable ZIP
```

## Project Structure

```
entrypoints/
  background.ts            Service worker — opens side panel on icon click
  calendar.content.ts      Injects timezone columns onto Google Calendar
  gmail.content.ts         Highlights times in Gmail with conversion tooltips
  popup/                   Toolbar popup (360px, quick timezone reference)
  sidepanel/               Side panel (full timezone management)
components/
  TimezoneRow.tsx           Single timezone display row
  TimezonePicker.tsx        Search-enabled timezone picker with alias support
utils/
  timezone.ts              Timezone formatting, storage, search, and alias map
```

## How It Works

**Calendar overlay**: The content script waits for Google Calendar's SPA to render, finds the scrollable hour grid, and injects a fixed panel to the left of `<main>`. It shrinks the main area via `marginLeft` so nothing gets clipped. Times are scroll-synced and repositioned on resize/layout changes.

**Timezone search**: An alias map of ~120 entries maps IANA IDs to country names, alternate cities, and abbreviations. Searching "Romania" finds `Europe/Bucharest`, "Beijing" finds `Asia/Shanghai`, "UK" finds `Europe/London`.

**Storage**: Timezone list is persisted in `chrome.storage.local`. Popup, side panel, and content scripts all listen for changes and update in real time.

## Debugging

Console logs are always available with the `[Multizone GCal]` prefix. To enable the visual debug overlay on the calendar page:

```js
// Run in the calendar page's DevTools console
localStorage.setItem("multizone_debug", "1");
// Reload the page to see the overlay
```

Set to `"0"` or remove to disable.

## License

MIT
