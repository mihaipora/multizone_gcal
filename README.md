# Multizone GCal

Chrome extension that adds multi-timezone columns to Google Calendar and highlights times in Gmail with timezone conversions.

## Features

- **Calendar overlay** — Adds timezone columns to the left of Google Calendar's hour grid, scroll-synced with the native layout
- **Gmail time detection** — Highlights times in emails (e.g. "3:00 PM") with hover tooltips showing conversions across your saved timezones
- **Searchable timezone picker** — Search ~400 IANA timezones by city, country, abbreviation, or UTC offset (e.g. "India", "Mumbai", "IST", "UTC+5:30"). Works with half-hour offsets like India (UTC+5:30) and Nepal (UTC+5:45)
- **Side panel + popup** — Manage timezones from either the side panel or toolbar popup, changes sync instantly across both and the calendar overlay
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

See `CLAUDE.md` for detailed architecture notes, design decisions, and content script gotchas.

## Debugging

Console logs use the `[Multizone GCal]` prefix. To enable the visual debug overlay on the calendar page:

```js
// Run in the calendar page's DevTools console
localStorage.setItem("multizone_debug", "1");
// Reload the page to see the overlay
```

Set to `"0"` or remove to disable.
