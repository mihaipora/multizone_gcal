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
      dbg("No timezones saved, exiting");
      return;
    }
    dbg(`Loaded ${timezones.length} timezones: ${timezones.join(", ")}`);

    // Detect Google Calendar's display timezone
    const calendarTz = detectCalendarTimezone();
    dbg(`Calendar timezone: ${calendarTz}`);

    injectStyles(PANEL_ID, COL_WIDTH);

    let attached = false;

    const attach = async () => {
      // Keep retrying — GCal's SPA can take a long time to render on hard reload
      for (let attempt = 0; !attached; attempt++) {
        await sleep(attempt < 30 ? 1000 : 3000); // faster initially, then slower
        attached = tryAttach(PANEL_ID, COL_WIDTH, timezones, calendarTz);
        if (!attached && attempt % 10 === 9) {
          dbg(`Attach attempt ${attempt + 1} failed, still retrying...`);
        }
      }
      dbg("SUCCESS: Panel attached!");
    };

    await attach();

    // Re-attach when timezones change in storage (user adds/removes via popup)
    chrome.storage.onChanged.addListener(async (changes, area) => {
      if (area !== "local" || !changes["multizone_timezones"]) return;
      const newTzs = changes["multizone_timezones"].newValue as string[] | undefined;
      if (!newTzs || newTzs.length === 0) return;
      dbg(`Timezones changed: ${newTzs.join(", ")}`);
      timezones = newTzs;
      cleanup(PANEL_ID);
      attached = false;
      await attach();
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

    // Refresh times every minute
    setInterval(() => updateTimes(PANEL_ID, timezones, calendarTz), 60_000);
  },
});

/* ── debug overlay ───────────────────────────────────────────────── */

const DEBUG_ID = "multizone-debug";
const debugLines: string[] = [];

function dbg(msg: string) {
  console.log(`[Multizone GCal] ${msg}`);
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

function findScrollContainer(): HTMLElement | null {
  const main = findMain();
  if (!main) {
    dbg("findScroll: No <main> or [role=main] element");
    return null;
  }

  let best: HTMLElement | null = null;
  let bestHeight = 0;
  let count = 0;

  const walk = (el: Element, depth: number) => {
    if (!(el instanceof HTMLElement) || depth > 15) return;
    const style = getComputedStyle(el);
    const scrollable =
      style.overflowY === "scroll" || style.overflowY === "auto" ||
      style.overflow === "scroll" || style.overflow === "auto";

    if (scrollable && el.scrollHeight > el.clientHeight + 50) {
      count++;
      if (el.scrollHeight > bestHeight) { best = el; bestHeight = el.scrollHeight; }
    }
    for (const child of el.children) walk(child, depth + 1);
  };

  walk(main, 0);
  dbg(`findScroll: ${count} scrollable divs, best height: ${bestHeight}`);
  return best;
}

function cleanup(panelId: string) {
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

/**
 * Find the actual hour row pitch (top-to-top distance) and top offset by inspecting
 * the scroll container's DOM for a group of ~24 equally-sized children.
 * Uses top-to-top pitch instead of element height to capture borders/gaps.
 */
function findGridMetrics(scrollContainer: HTMLElement): { rowHeight: number; topOffset: number } {
  let best: { rowHeight: number; topOffset: number; count: number } | null = null;

  const walk = (el: HTMLElement, depth: number) => {
    if (depth > 6) return;
    const children = Array.from(el.children).filter(c => c instanceof HTMLElement) as HTMLElement[];

    if (children.length >= 23 && children.length <= 49) {
      const rects = children.slice(0, Math.min(children.length, 24)).map(c => c.getBoundingClientRect());

      // Measure pitch: top-to-top distance between consecutive rows
      // This captures element height + borders + gaps accurately
      if (rects.length >= 2) {
        const pitches: number[] = [];
        for (let i = 1; i < rects.length; i++) {
          pitches.push(rects[i].top - rects[i - 1].top);
        }
        const avgPitch = pitches.reduce((a, b) => a + b, 0) / pitches.length;

        if (avgPitch > 15) {
          const maxDev = Math.max(...pitches.map(p => Math.abs(p - avgPitch)));
          if (maxDev < 3) {
            const scrollRect = scrollContainer.getBoundingClientRect();
            const topOff = rects[0].top - scrollRect.top + scrollContainer.scrollTop;
            if (!best || children.length > best.count) {
              best = { rowHeight: avgPitch, topOffset: topOff, count: children.length };
            }
          }
        }
      }
    }

    for (const child of children) walk(child, depth + 1);
  };

  walk(scrollContainer, 0);

  if (best) {
    dbg(`gridMetrics: ${best.count} rows, pitch=${best.rowHeight.toFixed(2)}px, offset=${best.topOffset.toFixed(1)}px`);
    return best;
  }

  const fallback = scrollContainer.scrollHeight / 24;
  dbg(`gridMetrics: fallback h=${fallback.toFixed(1)}px`);
  return { rowHeight: fallback, topOffset: 0 };
}

function tryAttach(panelId: string, colWidth: number, timezones: string[], calendarTz: string): boolean {
  if (document.getElementById(panelId)) return true;

  const scrollContainer = findScrollContainer();
  if (!scrollContainer) return false;

  if (scrollContainer.scrollHeight < 500) {
    dbg(`tryAttach: scrollHeight ${scrollContainer.scrollHeight} too small`);
    return false;
  }

  const main = findMain();
  if (!main) return false;

  const panelWidth = timezones.length * colWidth;

  // Measure grid top offset from the DOM
  const { topOffset } = findGridMetrics(scrollContainer);

  // Measure main's position BEFORE modifying layout
  const origMainRect = main.getBoundingClientRect();

  // Save original main styles for cleanup
  if (main.dataset.mzOrigStyle === undefined) {
    main.dataset.mzOrigStyle = main.style.cssText || "";
  }

  // Shrink the main area to make room (prevents right-side cutoff)
  // Don't set overflow:hidden — it can clip Google Calendar's time labels
  main.style.marginLeft = `${panelWidth}px`;
  main.style.minWidth = "0";
  main.style.maxWidth = `calc(100% - ${panelWidth}px)`;

  // Wait a frame for layout to settle after shrinking main
  requestAnimationFrame(() => {
    const scrollRect = scrollContainer.getBoundingClientRect();
    const mainRect = main.getBoundingClientRect();

    // Position panel to the left of MAIN (not scroll container)
    // so Google Calendar's own timezone columns (SF/KRK) remain visible
    const panelLeft = mainRect.left - panelWidth;

    // Dynamically measure GCal's header height (from main top to scroll container top)
    // This changes when all-day section expands/collapses
    let headerHeight = Math.round(scrollRect.top - mainRect.top);
    dbg(`layout: main.left=${mainRect.left.toFixed(0)}, scroll.left=${scrollRect.left.toFixed(0)}, tzGap=${(scrollRect.left - mainRect.left).toFixed(0)}px, headerH=${headerHeight}`);

    const panel = document.createElement("div");
    panel.id = panelId;
    panel.style.cssText = `
      position: fixed;
      top: ${mainRect.top}px;
      left: ${panelLeft}px;
      width: ${panelWidth}px;
      height: ${scrollRect.height + headerHeight}px;
      z-index: 100;
      overflow: hidden;
      background: #fff;
    `;

    // Header — matches GCal's header height, labels positioned absolutely
    // to align with GCal's timezone labels (at columnheader.bottom)
    const header = document.createElement("div");
    header.className = "mz-header-row";
    let headerPadTop = measureHeaderLabelTarget(main, mainRect.top);
    header.style.cssText = `height: ${headerHeight}px; position: relative; overflow: visible;`;

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

    // Scrollable body with hour rows
    const body = document.createElement("div");
    body.className = "mz-body";
    body.style.cssText = `height: ${scrollRect.height}px; overflow: hidden;`;

    // Add spacer to match grid top offset
    if (topOffset > 0) {
      const spacer = document.createElement("div");
      spacer.style.height = `${topOffset}px`;
      body.appendChild(spacer);
    }

    // Calculate exact row height and total grid height from scrollHeight
    const totalGridHeight = scrollContainer.scrollHeight - topOffset;
    const exactRowHeight = totalGridHeight / 24;
    renderHourGrid(body, timezones, calendarTz, colWidth, totalGridHeight, exactRowHeight);
    dbg(`grid: totalH=${totalGridHeight}px, rowH=${exactRowHeight}px`);
    panel.appendChild(body);
    document.body.appendChild(panel);

    // Scroll sync — use proportional scrolling to handle content height differences
    const syncScroll = () => {
      const gcalMaxScroll = scrollContainer.scrollHeight - scrollContainer.clientHeight;
      const bodyMaxScroll = body.scrollHeight - body.clientHeight;
      if (gcalMaxScroll > 0 && bodyMaxScroll > 0) {
        const ratio = scrollContainer.scrollTop / gcalMaxScroll;
        body.scrollTop = ratio * bodyMaxScroll;
      } else {
        body.scrollTop = scrollContainer.scrollTop;
      }
    };
    scrollContainer.addEventListener("scroll", syncScroll, { passive: true });
    syncScroll();

    // Reposition on resize AND when all-day section expands/collapses
    let lastScrollTop = -1;
    let lastScrollHeight = -1;
    const reposition = () => {
      const rect = scrollContainer.getBoundingClientRect();
      const mRect = main.getBoundingClientRect();
      // Re-measure header height and label offset (changes when all-day section expands/collapses)
      headerHeight = Math.round(rect.top - mRect.top);
      headerPadTop = measureHeaderLabelTarget(main, mRect.top);
      panel.style.top = `${mRect.top}px`;
      panel.style.left = `${mRect.left - panelWidth}px`;
      panel.style.height = `${rect.height + headerHeight}px`;
      header.style.height = `${headerHeight}px`;
      const lr = header.querySelector(".mz-label-row") as HTMLElement;
      if (lr) lr.style.top = `${headerPadTop}px`;
      body.style.height = `${rect.height}px`;
      lastScrollTop = rect.top;
      lastScrollHeight = rect.height;
    };
    window.addEventListener("resize", reposition);

    // Watch for layout changes (all-day section expand/collapse moves the scroll container)
    const layoutCheck = setInterval(() => {
      if (!document.getElementById(panelId)) { clearInterval(layoutCheck); return; }
      const rect = scrollContainer.getBoundingClientRect();
      if (Math.abs(rect.top - lastScrollTop) > 1 || Math.abs(rect.height - lastScrollHeight) > 1) {
        reposition();
      }
    }, 300);

    // Also observe DOM mutations in main that might shift layout
    const observer = new MutationObserver(() => {
      requestAnimationFrame(reposition);
    });
    observer.observe(main, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class"] });

    dbg(`Panel at left=${panelLeft.toFixed(0)}, top=${mainRect.top.toFixed(0)}, headerH=${headerHeight}`);

    // Dynamically match GCal's time label styles
    applyGcalStyles(panel, main);

    // Measure header alignment: compare our label Y with columnheader bottom
    requestAnimationFrame(() => {
      const ch = main.querySelector('[role="columnheader"]');
      const mzLabel = panel.querySelector(".mz-label-row .mz-tz-header") as HTMLElement;
      if (ch && mzLabel) {
        const chBottom = ch.getBoundingClientRect().bottom;
        const mzTop = mzLabel.getBoundingClientRect().top;
        dbg(`HEADER ALIGN: colHeader.bottom=${chBottom.toFixed(1)}, mz="${mzLabel.textContent}" top=${mzTop.toFixed(1)}, diff=${(mzTop - chBottom).toFixed(1)}px`);
      }
    });
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

  for (let h = 0; h < 24; h++) {
    const hourDate = dateAtHourInTimezone(h, calendarTz);

    for (let i = 0; i < timezones.length; i++) {
      // Replicate GCal's structure: absolute-positioned, zero-height inline-block
      // with line-height: 16px — text naturally centers on the gridline
      const label = document.createElement("div");
      label.className = "mz-tz-label" + (h === currentCalHour ? " mz-current" : "");
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
  labels.forEach((label) => {
    const time = label.querySelector(".mz-tz-time");
    if (!time) return;
    // Labels are ordered: h0-tz0, h0-tz1, ..., h1-tz0, h1-tz1, ...
    const idx = Array.from(labels).indexOf(label);
    const h = Math.floor(idx / timezones.length);
    const i = idx % timezones.length;
    const hourDate = dateAtHourInTimezone(h, calendarTz);
    time.textContent = formatHourGcalStyle(hourDate, timezones[i]);
    label.classList.toggle("mz-current", h === currentCalHour);
  });
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
