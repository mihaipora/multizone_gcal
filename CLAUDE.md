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
- Max search results: 50
- Default timezones (when storage is empty): NY, LA, London, Berlin, Tokyo

## Known Issues & Tech Debt

### Critical
- **calendar.content.ts memory leaks**: Event listeners (`scroll`, `resize`), MutationObserver, and setIntervals created in `tryAttach()` are never cleaned up on re-attach. Every SPA navigation or timezone change accumulates orphaned listeners.
- **Infinite retry loop**: `attach()` retries forever if `tryAttach()` never succeeds (e.g. non-calendar page). Needs a max attempt limit.
- **Debug overlay visible in production**: The green-on-black debug console (bottom-left) is always injected. Should be behind a flag.

### Medium
- **SidePanel has unused state**: `setTimezoneInfos` is computed but never read — dead code from a refactor.
- **Popup doesn't sync**: If user changes timezones in side panel, popup won't reflect it until re-opened. Needs `chrome.storage.onChanged` listener.
- **O(n²) in `updateTimes()`**: Uses `Array.from(labels).indexOf(label)` inside a forEach. Should use `data-index` attributes or a pre-built map.
- **`getHoursForDay()` parses locale string**: `new Date(date.toLocaleString(...).split(",")[0])` is fragile. Should use `formatToParts()`.

### Low
- Magic numbers throughout `calendar.content.ts` (grid thresholds, scroll heights)
- No loading state in popup/sidepanel (brief blank flash on open)
- Gmail tooltip can overflow viewport (no boundary detection)
- No tests anywhere

## Content Script Gotchas
- `calendar.content.ts` runs at `document_idle` and polls for the scroll container (GCal's SPA renders late)
- If `getSavedTimezones()` returns empty, content script exits entirely and never sets up the storage listener — won't recover until page refresh
- Timezone detection scans `<script>` tags for IANA patterns; picks the most frequently mentioned one as the calendar's display timezone
- The panel shrinks `<main>` via `marginLeft` to avoid overlapping GCal's own timezone columns (SF/KRK)

## Timezone Search
- Empty search → shows `COMMON_TIMEZONES` (20 curated popular zones)
- Non-empty search → `searchTimezones()` searches all ~400 IANA zones against: ID, city label, aliases, UTC offset string
- `TIMEZONE_ALIASES` map covers ~120 entries: countries, alternate cities, abbreviations
- Half-hour offset timezones (e.g. India UTC+5:30, Nepal UTC+5:45) display minutes in calendar grid labels
