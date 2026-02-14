# Multizone GCal — Developer Guide

## What This Is
Chrome extension that overlays multi-timezone columns on Google Calendar and highlights times in Gmail with timezone conversions. Uses the Intl API exclusively — no external timezone libraries.

## Architecture

```
entrypoints/
  background.ts          — Service worker; opens side panel on icon click
  calendar.content.ts    — Injects timezone columns onto Google Calendar grid
  gmail.content.ts       — Highlights times in Gmail emails with conversion tooltips
  popup/                 — Extension popup (360px wide, quick timezone reference)
  sidepanel/             — Side panel (full timezone management)
components/
  TimezoneRow.tsx        — Single timezone display row (label, abbreviation, current time)
  TimezonePicker.tsx     — Search-enabled timezone picker (searches ~400 IANA zones + aliases)
utils/
  timezone.ts            — All timezone logic: formatting, storage, search, alias map
```

## Build & Deploy
```sh
npm run build && rm -rf dist/* && cp -r .output/chrome-mv3/* dist/
```
- **Always bump version in both `wxt.config.ts` AND `package.json`** before building
- WXT reads the manifest version from `wxt.config.ts`, not `package.json`
- Load `dist/` as unpacked extension in Chrome

## Key Constants
- Storage key: `multizone_timezones`
- Calendar panel column width: 48px
- Update intervals: 30s (TimezoneRow), 60s (calendar grid times)
- Max attach attempts: 120 (calendar content script)
- Max search results: 50
- Default timezones (when storage is empty): NY, LA, London, Berlin, Tokyo

## Design Decisions

### Storage sync
Popup and SidePanel both listen to `chrome.storage.onChanged` so changes in one instantly reflect in the other. The calendar content script also listens for storage changes to re-render the overlay when timezones are added/removed.

### Cleanup registry
`calendar.content.ts` uses a `registerCleanup()`/`runCleanups()` pattern. Every event listener, interval, and MutationObserver created during `tryAttach()` registers a teardown function. `cleanup()` calls `runCleanups()` before removing the panel, preventing memory leaks on re-attach.

### Debug overlay
The green-on-black debug overlay in `calendar.content.ts` is gated behind `localStorage.multizone_debug === "1"`. Console logging (`[Multizone GCal]` prefix) always works. To enable the visual overlay, run in the calendar page console:
```js
localStorage.setItem("multizone_debug", "1")
```

### Timezone validation
`addTimezone()` validates IDs via `isValidTimezone()` (uses `Intl.DateTimeFormat`) before persisting to storage. Invalid IDs are silently rejected.

### Empty storage recovery
If the content script starts with no saved timezones, it no longer exits — it sets up a storage listener and waits. When the user adds timezones via popup/sidepanel, the overlay appears without requiring a page refresh.

## Content Script Gotchas
- `calendar.content.ts` runs at `document_idle` and polls for the scroll container (GCal's SPA renders late)
- Attach retries cap at 120 attempts (~2-6 min), then gives up with a log message
- Timezone detection scans `<script>` tags for IANA patterns; picks the most frequently mentioned one as the calendar's display timezone
- The panel shrinks `<main>` via `marginLeft` to avoid overlapping GCal's own timezone columns (SF/KRK)
- `updateTimes()` uses `data-hour`/`data-tz-index` attributes on labels for O(n) lookup

## Gmail Content Script
- MutationObserver scoped to `[role="main"]` (falls back to `document.body`)
- Tooltips use `position: fixed` with viewport boundary clamping
- Shows all saved timezones in tooltip (no limit)
- Scanned email bodies are marked with `data-multizone-scanned` to prevent re-processing

## Timezone Search
- Empty search → shows `COMMON_TIMEZONES` (20 curated popular zones)
- Non-empty search → `searchTimezones()` searches all ~400 IANA zones against: ID, city label, aliases, UTC offset string
- `TIMEZONE_ALIASES` map covers ~120 entries: countries, alternate cities, abbreviations
- Half-hour offset timezones (e.g. India UTC+5:30, Nepal UTC+5:45) display minutes in calendar grid labels
- Picker supports Escape key to close and has ARIA attributes for accessibility

## Remaining Tech Debt
- No tests
- Magic numbers in `calendar.content.ts` grid detection (pitch > 15px, maxDev < 3, scrollHeight < 500)
- Timezone detection regex is fragile — hard-coded continent prefixes
