/**
 * Content script injected into calendar.google.com.
 * Adds multi-timezone columns aligned with Google Calendar's hour grid.
 *
 * Fixes applied:
 * 1. Detects calendar display timezone from page scripts so times show :00
 * 2. Positions panel to the left of scroll area without overlapping time labels
 * 3. Shrinks main area instead of pushing it, preventing column cutoff
 */

import {
  getSavedTimezones,
  formatTimeInZone,
  getTimezoneLabel,
  getTimezoneAbbreviation,
} from "@/utils/timezone";

// ── Cleanup registry for event listeners, intervals, observers ──

let activeCleanups: Array<() => void> = [];

function registerCleanup(fn: () => void) {
  activeCleanups.push(fn);
}

function runCleanups() {
  for (const fn of activeCleanups) {
    try { fn(); } catch (_) {}
  }
  activeCleanups = [];
}

// ── Constants ──

const MAX_ATTACH_ATTEMPTS = 120;

export default defineContentScript({
  matches: ["https://calendar.google.com/*"],
  runAt: "document_idle",

  async main() {
    const version = chrome.runtime.getManifest().version;
    dbg(`Multizone GCal v${version} starting`);

    const PANEL_ID = "multizone-tz-panel";
    const COL_WIDTH = 48;

    let timezones = await getSavedTimezones();
    if (timezones.length === 0) {
      dbg("No timezones saved, waiting for changes...");
      // Don't exit — listen for storage changes so we recover when user adds timezones
      chrome.storage.onChanged.addListener(async (changes, area) => {
        if (area !== "local" || !changes["multizone_timezones"]) return;
        const newTzs = changes["multizone_timezones"].newValue as string[] | undefined;
        if (!newTzs || newTzs.length === 0) return;
        dbg(`Timezones added: ${newTzs.join(", ")}`);
        timezones = newTzs;
        const calendarTz = detectCalendarTimezone();
        injectStyles(PANEL_ID, COL_WIDTH);
        attached = false;
        await attach(PANEL_ID, COL_WIDTH, timezones, calendarTz);
      });
      return;
    }
    dbg(`Loaded ${timezones.length} timezones: ${timezones.join(", ")}`);

    // Detect Google Calendar's display timezone
    const calendarTz = detectCalendarTimezone();
    dbg(`Calendar timezone: ${calendarTz}`);

    injectStyles(PANEL_ID, COL_WIDTH);

    let attached = false;

    const attach = async (panelId: string, colWidth: number, tzs: string[], calTz: string) => {
      for (let attempt = 0; !attached && attempt < MAX_ATTACH_ATTEMPTS; attempt++) {
        await sleep(attempt < 30 ? 1000 : 3000);
        attached = tryAttach(panelId, colWidth, tzs, calTz);
        if (!attached && attempt % 10 === 9) {
          dbg(`Attach attempt ${attempt + 1} failed, still retrying...`);
        }
      }
      if (attached) {
        dbg("SUCCESS: Panel attached!");
      } else {
        dbg(`Gave up after ${MAX_ATTACH_ATTEMPTS} attempts`);
      }
    };

    await attach(PANEL_ID, COL_WIDTH, timezones, calendarTz);

    // Re-attach when timezones change in storage (user adds/removes via popup)
    chrome.storage.onChanged.addListener(async (changes, area) => {
      if (area !== "local" || !changes["multizone_timezones"]) return;
      const newTzs = changes["multizone_timezones"].newValue as string[] | undefined;
      if (!newTzs || newTzs.length === 0) return;
      dbg(`Timezones changed: ${newTzs.join(", ")}`);
      timezones = newTzs;
      cleanup(PANEL_ID);
      attached = false;
      await attach(PANEL_ID, COL_WIDTH, timezones, calendarTz);
    });

    // Re-attach on SPA navigation
    let lastUrl = location.href;
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        dbg("Navigation detected, re-attaching...");
        cleanup(PANEL_ID);
        attached = false;
        let retries = 0;
        const iv = setInterval(() => {
          if (attached || retries++ > 20) { clearInterval(iv); return; }
          attached = tryAttach(PANEL_ID, COL_WIDTH, timezones, calendarTz);
        }, 1000);
      }
    }, 1000);

    // Re-attach when scroll state changes (e.g. window resize makes grid scrollable)
    setInterval(() => {
      const panel = document.getElementById(PANEL_ID);
      if (panel?.dataset.mzNeedsReattach === "1") {
        dbg("Re-attaching due to scroll state change...");
        cleanup(PANEL_ID);
        attached = false;
        attached = tryAttach(PANEL_ID, COL_WIDTH, timezones, calendarTz);
      }
    }, 500);

    // Refresh times every minute
    setInterval(() => updateTimes(PANEL_ID, timezones, calendarTz), 60_000);
  },
});

/* ── debug logging ───────────────────────────────────────────────── */

const DEBUG_ID = "multizone-debug";
const debugLines: string[] = [];
let debugEnabled: boolean | null = null;

function isDebugEnabled(): boolean {
  if (debugEnabled !== null) return debugEnabled;
  try {
    debugEnabled = localStorage.getItem("multizone_debug") === "1";
  } catch {
    debugEnabled = false;
  }
  return debugEnabled;
}

function dbg(msg: string) {
  console.log(`[Multizone GCal] ${msg}`);

  if (!isDebugEnabled()) return;

  debugLines.push(`${new Date().toLocaleTimeString()} ${msg}`);
  if (debugLines.length > 20) debugLines.shift();
  let el = document.getElementById(DEBUG_ID);
  if (!el) {
    el = document.createElement("div");
    el.id = DEBUG_ID;
    el.style.cssText = `
      position: fixed; bottom: 8px; left: 8px; z-index: 99999;
      background: rgba(0,0,0,0.85); color: #0f0; font: 11px/1.4 monospace;
      padding: 8px 12px; border-radius: 6px; max-width: 500px;
      max-height: 260px; overflow-y: auto; pointer-events: none;
    `;
    document.body.appendChild(el);
  }
  el.textContent = debugLines.join("\n");
  el.scrollTop = el.scrollHeight;
}

/* ── timezone detection ──────────────────────────────────────────── */

/**
 * Detect the calendar's primary display timezone by scanning <script> tags
 * for IANA timezone strings. Falls back to browser timezone.
 */
function detectCalendarTimezone(): string {
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Strategy 1: scan script tags for IANA timezone patterns
  // Google Calendar embeds the user's timezone in its initialization data
  const scripts = document.querySelectorAll("script");
  const ianaPattern = /["']((?:Africa|America|Antarctica|Asia|Atlantic|Australia|Europe|Indian|Pacific)\/[A-Za-z_]+(?:\/[A-Za-z_]+)?)["']/g;

  const tzCounts = new Map<string, number>();
  for (const script of scripts) {
    const text = script.textContent || "";
    if (text.length < 10 || text.length > 500_000) continue;
    let match;
    while ((match = ianaPattern.exec(text)) !== null) {
      const tz = match[1];
      tzCounts.set(tz, (tzCounts.get(tz) || 0) + 1);
    }
  }

  if (tzCounts.size > 0) {
    // The most frequently mentioned timezone is likely the calendar's display timezone
    let bestTz = browserTz;
    let bestCount = 0;
    for (const [tz, count] of tzCounts) {
      if (count > bestCount) {
        bestTz = tz;
        bestCount = count;
      }
    }
    dbg(`detectTz: Found ${tzCounts.size} IANA timezones in scripts, top: ${bestTz} (${bestCount}x)`);
    return bestTz;
  }

  dbg(`detectTz: No IANA timezones found in scripts, using browser tz: ${browserTz}`);
  return browserTz;
}

/**
 * Create a Date object that represents hour:00 in the given timezone
 * on the current day. This ensures times display as :00 in all zones.
 */
function dateAtHourInTimezone(hour: number, timezone: string): Date {
  const now = new Date();
  // Start with a UTC date at the given hour
  const utcDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, 0, 0));

  // Get what hour that UTC time corresponds to in the target timezone
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    hour12: false,
  });
  const localHour = parseInt(formatter.format(utcDate)) % 24;

  // Adjust to make the target timezone show exactly `hour`
  const diff = hour - localHour;
  // Handle wraparound (e.g., diff = 23 should be -1)
  const adjustedDiff = ((diff + 12) % 24) - 12;
  return new Date(utcDate.getTime() + adjustedDiff * 3600_000);
}

/**
 * Format time to match Google Calendar's native style: "10 PM", "1 AM", etc.
 */
function formatHourGcalStyle(date: Date, timezone: string): string {
  const full = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: timezone,
  }).format(date);
  // "5:00 AM" → "5 AM" (match GCal style), but keep "5:30 AM" as-is
  return full.replace(":00", "");
}

/* ── helpers ─────────────────────────────────────────────────────── */

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function findMain(): HTMLElement | null {
  return document.querySelector('main, [role="main"]') as HTMLElement | null;
}

/**
 * Find the hour grid element: a container with 23-49 evenly-spaced children.
 * Returns the parent of those rows, or null if not found.
 */
function findHourGrid(root: HTMLElement): HTMLElement | null {
  let result: HTMLElement | null = null;

  const walk = (el: HTMLElement, depth: number) => {
    if (result || depth > 20) return;
    const children = Array.from(el.children).filter(c => c instanceof HTMLElement) as HTMLElement[];

    if (children.length >= 23 && children.length <= 49) {
      const rects = children.slice(0, Math.min(children.length, 24)).map(c => c.getBoundingClientRect());
      if (rects.length >= 2) {
        const pitches: number[] = [];
        for (let i = 1; i < rects.length; i++) {
          pitches.push(rects[i].top - rects[i - 1].top);
        }
        const avgPitch = pitches.reduce((a, b) => a + b, 0) / pitches.length;
        if (avgPitch > 15) {
          const maxDev = Math.max(...pitches.map(p => Math.abs(p - avgPitch)));
          if (maxDev < 3) {
            result = el;
            return;
          }
        }
      }
    }

    for (const child of children) {
      if (child instanceof HTMLElement) walk(child, depth + 1);
    }
  };

  walk(root, 0);
  return result;
}

function cleanup(panelId: string) {
  // Run all registered cleanups (listeners, intervals, observers)
  runCleanups();

  document.getElementById(panelId)?.remove();
  const main = findMain();
  if (main) {
    // Restore original styles
    if (main.dataset.mzOrigStyle !== undefined) {
      main.style.cssText = main.dataset.mzOrigStyle;
      delete main.dataset.mzOrigStyle;
    }
  }
}

function tryAttach(panelId: string, colWidth: number, timezones: string[], calendarTz: string): boolean {
  if (document.getElementById(panelId)) return true;

  const main = findMain();
  if (!main) return false;

  const hourGrid = findHourGrid(main);
  if (!hourGrid) return false;

  // Measure row height from hour grid children
  const gridChildren = Array.from(hourGrid.children).filter(c => c instanceof HTMLElement) as HTMLElement[];
  if (gridChildren.length < 23) return false;
  const gridRects = gridChildren.slice(0, 24).map(c => c.getBoundingClientRect());
  const pitches: number[] = [];
  for (let i = 1; i < gridRects.length; i++) pitches.push(gridRects[i].top - gridRects[i - 1].top);
  const rowHeight = pitches.reduce((a, b) => a + b, 0) / pitches.length;
  if (rowHeight < 15) return false;

  // Find the grid viewport: the scrollable ancestor that clips the hour grid.
  // If no scrollable ancestor (window tall enough), use hourGrid itself as boundary.
  let gridViewport: HTMLElement | null = null;
  let el: HTMLElement | null = hourGrid.parentElement;
  while (el && el !== document.body) {
    const style = getComputedStyle(el);
    const overflow = style.overflow + " " + style.overflowY;
    if ((overflow.includes("auto") || overflow.includes("scroll") || overflow.includes("overlay")) &&
        el.scrollHeight > el.clientHeight + 50) {
      gridViewport = el;
      break;
    }
    el = el.parentElement;
  }

  const panelWidth = timezones.length * colWidth;

  // Save original main styles for cleanup
  if (main.dataset.mzOrigStyle === undefined) {
    main.dataset.mzOrigStyle = main.style.cssText || "";
  }

  // Shrink main to make room (prevents right-side cutoff)
  main.style.marginLeft = `${panelWidth}px`;
  main.style.minWidth = "0";
  main.style.maxWidth = `calc(100% - ${panelWidth}px)`;

  // Wait a frame for layout to settle after shrinking main
  requestAnimationFrame(() => {
    const mainRect = main.getBoundingClientRect();
    // Grid viewport boundary: where the scrollable/visible grid area starts
    const viewportEl = gridViewport || hourGrid;
    const viewportRect = viewportEl.getBoundingClientRect();
    const headerHeight = Math.max(0, Math.round(viewportRect.top - mainRect.top));
    const bodyHeight = Math.max(0, Math.round(mainRect.bottom - viewportRect.top));
    const panelLeft = mainRect.left - panelWidth;

    dbg(`layout: headerH=${headerHeight}, bodyH=${bodyHeight}, rowH=${rowHeight.toFixed(1)}, viewport=${gridViewport ? "scroll" : "grid"}`);

    // Create panel
    const panel = document.createElement("div");
    panel.id = panelId;
    panel.style.cssText = `
      position: fixed;
      top: ${mainRect.top}px;
      left: ${panelLeft}px;
      width: ${panelWidth}px;
      height: ${mainRect.height}px;
      z-index: 100;
      overflow: hidden;
      background: #fff;
    `;

    // Header — timezone labels aligned with GCal's column headers
    const header = document.createElement("div");
    header.className = "mz-header-row";
    header.style.cssText = `height: ${headerHeight}px; position: relative; overflow: hidden;`;

    const headerPadTop = measureHeaderLabelTarget(main, mainRect.top);
    const labelRow = document.createElement("div");
    labelRow.className = "mz-label-row";
    labelRow.style.cssText = `position: absolute; top: ${headerPadTop}px; left: 0; width: 100%; display: flex;`;
    for (const tz of timezones) {
      const col = document.createElement("div");
      col.className = "mz-tz-header";
      col.style.width = `${colWidth}px`;
      col.textContent = getTimezoneLabel(tz);
      labelRow.appendChild(col);
    }
    header.appendChild(labelRow);
    panel.appendChild(header);

    // Body — clips to the visible grid area
    const body = document.createElement("div");
    body.className = "mz-body";
    body.style.cssText = `height: ${bodyHeight}px; overflow: hidden; position: relative;`;

    const totalGridHeight = rowHeight * 24;
    renderHourGrid(body, timezones, calendarTz, colWidth, totalGridHeight, rowHeight);
    panel.appendChild(body);
    document.body.appendChild(panel);

    const mzGrid = body.querySelector(".mz-grid") as HTMLElement;
    const hour0Child = gridChildren[0]; // Hour-0 row in GCal's grid

    // ── Position-based scroll sync ──
    // Track where GCal's hour-0 row is on screen and mirror with translateY.
    const syncPosition = () => {
      if (!hour0Child.isConnected || !mzGrid.isConnected) return;
      const bodyRect = body.getBoundingClientRect();
      const rowRect = hour0Child.getBoundingClientRect();
      const offset = rowRect.top - bodyRect.top;
      mzGrid.style.transform = `translateY(${offset}px)`;
    };

    // Capture ALL scroll events (GCal may scroll in various nested containers)
    window.addEventListener("scroll", syncPosition, { capture: true, passive: true });
    registerCleanup(() => window.removeEventListener("scroll", syncPosition, { capture: true }));

    // Initial sync
    syncPosition();

    // ── Reposition panel on layout changes ──
    let lastMainTop = mainRect.top;
    let lastViewportTop = viewportRect.top;

    const reposition = () => {
      if (!document.getElementById(panelId)) return;
      const mRect = main.getBoundingClientRect();
      const vRect = viewportEl.getBoundingClientRect();
      const hh = Math.max(0, Math.round(vRect.top - mRect.top));
      const bh = Math.max(0, Math.round(mRect.bottom - vRect.top));

      panel.style.top = `${mRect.top}px`;
      panel.style.left = `${mRect.left - panelWidth}px`;
      panel.style.height = `${mRect.height}px`;
      header.style.height = `${hh}px`;
      body.style.height = `${bh}px`;

      const hpt = measureHeaderLabelTarget(main, mRect.top);
      const lr = header.querySelector(".mz-label-row") as HTMLElement;
      if (lr) lr.style.top = `${hpt}px`;

      lastMainTop = mRect.top;
      lastViewportTop = vRect.top;

      syncPosition();
    };

    // Window resize → full re-attach (scroll container may appear/disappear)
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const onResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        dbg("Window resized, re-attaching...");
        panel.dataset.mzNeedsReattach = "1";
      }, 300);
    };
    window.addEventListener("resize", onResize);
    registerCleanup(() => window.removeEventListener("resize", onResize));

    // Periodic layout check (catches changes not triggered by scroll or mutation)
    const layoutCheck = setInterval(() => {
      if (!document.getElementById(panelId)) { clearInterval(layoutCheck); return; }
      const mRect = main.getBoundingClientRect();
      const vRect = viewportEl.getBoundingClientRect();
      if (Math.abs(mRect.top - lastMainTop) > 1 || Math.abs(vRect.top - lastViewportTop) > 1) {
        reposition();
      }
    }, 500);
    registerCleanup(() => clearInterval(layoutCheck));

    // DOM mutation observer for layout shifts
    let repositionRafId = 0;
    const scheduleReposition = () => {
      if (repositionRafId) return;
      repositionRafId = requestAnimationFrame(() => {
        repositionRafId = 0;
        reposition();
      });
    };
    registerCleanup(() => { if (repositionRafId) cancelAnimationFrame(repositionRafId); });

    const observer = new MutationObserver(scheduleReposition);
    observer.observe(main, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class"] });
    registerCleanup(() => observer.disconnect());

    // Match GCal's time label styles
    applyGcalStyles(panel, main);

    dbg(`Panel attached: left=${panelLeft.toFixed(0)}, headerH=${headerHeight}, rowH=${rowHeight.toFixed(1)}`);
  });

  return true;
}

function renderHourGrid(
  container: HTMLElement,
  timezones: string[],
  calendarTz: string,
  colWidth: number,
  totalGridHeight: number,
  rowHeight: number,
) {
  container.querySelector(".mz-grid")?.remove();

  const grid = document.createElement("div");
  grid.className = "mz-grid";
  grid.style.cssText = `position: relative; height: ${totalGridHeight}px;`;

  // Determine current hour in the CALENDAR timezone for highlighting
  const now = new Date();
  const currentCalHour = parseInt(
    new Intl.DateTimeFormat("en-US", { timeZone: calendarTz, hour: "numeric", hour12: false }).format(now),
  ) % 24;

  // Start at h=1: GCal hides the first hour label at the top of the grid
  for (let h = 1; h < 24; h++) {
    const hourDate = dateAtHourInTimezone(h, calendarTz);

    for (let i = 0; i < timezones.length; i++) {
      // Replicate GCal's structure: absolute-positioned, zero-height inline-block
      // with line-height: 16px — text naturally centers on the gridline
      const label = document.createElement("div");
      label.className = "mz-tz-label" + (h === currentCalHour ? " mz-current" : "");
      label.dataset.hour = String(h);
      label.dataset.tzIndex = String(i);
      // Offset top by half line-height (8px) so the text centers on the gridline.
      // GCal achieves this via its parent container structure; we do it explicitly.
      label.style.cssText = `
        position: absolute;
        top: ${h * rowHeight - 8}px;
        left: ${i * colWidth}px;
        width: ${colWidth}px;
        height: 0;
        display: inline-block;
        text-align: right;
      `;
      const span = document.createElement("span");
      span.className = "mz-tz-time";
      span.textContent = formatHourGcalStyle(hourDate, timezones[i]);
      label.appendChild(span);
      grid.appendChild(label);
    }
  }

  container.appendChild(grid);
}

function updateTimes(panelId: string, timezones: string[], calendarTz: string) {
  const panel = document.getElementById(panelId);
  if (!panel) return;

  const now = new Date();
  const currentCalHour = parseInt(
    new Intl.DateTimeFormat("en-US", { timeZone: calendarTz, hour: "numeric", hour12: false }).format(now),
  ) % 24;

  const labels = panel.querySelectorAll(".mz-tz-label");
  for (const label of labels) {
    if (!(label instanceof HTMLElement)) continue;
    const time = label.querySelector(".mz-tz-time");
    if (!time) continue;
    const h = parseInt(label.dataset.hour ?? "0", 10);
    const i = parseInt(label.dataset.tzIndex ?? "0", 10);
    const hourDate = dateAtHourInTimezone(h, calendarTz);
    time.textContent = formatHourGcalStyle(hourDate, timezones[i]);
    label.classList.toggle("mz-current", h === currentCalHour);
  }
}

/**
 * Find a GCal native time label element (e.g. "4 PM") inside main.
 */
function findGcalTimeLabelElement(main: HTMLElement): HTMLElement | null {
  const timePattern = /^\d{1,2}\s*(AM|PM)$/i;
  for (const el of main.querySelectorAll("*")) {
    if (!(el instanceof HTMLElement)) continue;
    const text = el.textContent?.trim() || "";
    if (timePattern.test(text) && el.children.length === 0) {
      return el;
    }
  }
  return null;
}

function findGcalTimeLabelStyle(main: HTMLElement): CSSStyleDeclaration | null {
  const el = findGcalTimeLabelElement(main);
  return el ? getComputedStyle(el) : null;
}

/**
 * Read GCal's actual computed styles and apply them as CSS custom properties
 * on the panel element so our labels automatically match.
 * Also extracts and logs GCal's positioning logic for the time labels.
 */
function applyGcalStyles(panel: HTMLElement, main: HTMLElement) {
  const el = findGcalTimeLabelElement(main);
  if (!el) {
    dbg("applyGcalStyles: no GCal time label found, using fallbacks");
    return;
  }
  const cs = getComputedStyle(el);
  panel.style.setProperty("--mz-font-size", cs.fontSize);
  panel.style.setProperty("--mz-font-weight", cs.fontWeight);
  panel.style.setProperty("--mz-color", cs.color);
  panel.style.setProperty("--mz-font-family", cs.fontFamily);
  dbg(`applyGcalStyles: size=${cs.fontSize}, weight=${cs.fontWeight}, color=${cs.color}`);
}

/**
 * Find GCal's timezone header labels (e.g. "SF", "KRK") in the header area
 * and return the distance from their bottom to the scroll container top.
 * This tells us how much padding-bottom our header needs.
 */
/**
 * Measure the Y position where our header labels should be placed,
 * using GCal's [role="columnheader"] elements as a stable anchor.
 * The GCal timezone labels (SF/KRK) sit just below the column headers.
 * Returns the target label top as distance from panelTop.
 */
function measureHeaderLabelTarget(main: HTMLElement, panelTop: number): number {
  const ch = main.querySelector('[role="columnheader"]');
  if (!ch) {
    dbg("headerTarget: no columnheader found");
    return 0;
  }
  const chRect = ch.getBoundingClientRect();
  // GCal timezone labels start just below the column header bottom
  const targetTop = chRect.bottom;
  const offset = targetTop - panelTop;
  return Math.max(offset, 0);
}

function injectStyles(panelId: string, colWidth: number) {
  if (document.getElementById("multizone-styles")) return;

  const style = document.createElement("style");
  style.id = "multizone-styles";
  style.textContent = `
    #${panelId} {
      --mz-font-size: 11px;
      --mz-font-weight: 500;
      --mz-color: #444746;
      --mz-font-family: 'Google Sans', Roboto, Arial, sans-serif;
    }
    #${panelId} .mz-header-row {
      position: relative;
      overflow: visible;
    }
    #${panelId} .mz-tz-header {
      text-align: center;
      font-size: var(--mz-font-size);
      font-weight: var(--mz-font-weight);
      font-family: var(--mz-font-family);
      color: var(--mz-color);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    #${panelId} .mz-tz-label {
      padding-right: 8px;
      box-sizing: border-box;
    }
    #${panelId} .mz-tz-time {
      font-size: var(--mz-font-size);
      font-weight: var(--mz-font-weight);
      font-family: var(--mz-font-family);
      color: var(--mz-color);
      line-height: 16px;
    }
  `;
  document.head.appendChild(style);
}
