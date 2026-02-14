/**
 * Content script injected into mail.google.com.
 * Detects dates/times in emails and shows timezone conversions.
 */

import { getSavedTimezones, formatDateTimeInZone, getTimezoneLabel } from "@/utils/timezone";

export default defineContentScript({
  matches: ["https://mail.google.com/*"],
  runAt: "document_idle",

  async main() {
    const TOOLTIP_CLASS = "multizone-gmail-tooltip";
    const HIGHLIGHT_CLASS = "multizone-gmail-highlight";

    // Common date/time patterns in emails
    const TIME_PATTERNS = [
      // "3:00 PM", "15:00", "3:00pm"
      /\b(\d{1,2}):(\d{2})\s*(am|pm|AM|PM)?\b/g,
      // "Monday at 3pm", "Tuesday at 15:00"
      /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+at\s+(\d{1,2}(?::\d{2})?)\s*(am|pm|AM|PM)?\b/gi,
      // "Jan 15 at 3:00 PM", "February 20, 2026 at 10:00"
      /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:,?\s*(\d{4}))?\s+at\s+(\d{1,2}(?::\d{2})?)\s*(am|pm|AM|PM)?\b/gi,
    ];

    const timezones = await getSavedTimezones();
    if (timezones.length === 0) return;

    // Inject styles
    const style = document.createElement("style");
    style.textContent = `
      .${HIGHLIGHT_CLASS} {
        background-color: #e3f2fd;
        border-radius: 2px;
        padding: 0 2px;
        cursor: pointer;
        position: relative;
      }
      .${HIGHLIGHT_CLASS}:hover {
        background-color: #bbdefb;
      }
      .${TOOLTIP_CLASS} {
        position: fixed;
        background: #333;
        color: #fff;
        padding: 8px 12px;
        border-radius: 6px;
        font-size: 12px;
        white-space: nowrap;
        z-index: 10000;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        pointer-events: none;
      }
      .${TOOLTIP_CLASS} div {
        margin-bottom: 2px;
      }
    `;
    document.head.appendChild(style);

    // Watch for email content to load — scope to Gmail's main content area
    const observer = new MutationObserver(() => {
      scanEmailContent();
    });

    // Gmail's email content lives inside [role="main"] or .nH
    const observeTarget = document.querySelector('[role="main"]') || document.body;
    observer.observe(observeTarget, {
      childList: true,
      subtree: true,
    });

    function scanEmailContent() {
      // Target email body containers (Gmail uses specific classes)
      const emailBodies = document.querySelectorAll(
        '.a3s.aiL, .gmail_default, [data-message-id] .ii.gt',
      );

      emailBodies.forEach((body) => {
        if (body.getAttribute("data-multizone-scanned")) return;
        body.setAttribute("data-multizone-scanned", "true");

        const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
        const textNodes: Text[] = [];

        let node: Text | null;
        while ((node = walker.nextNode() as Text | null)) {
          textNodes.push(node);
        }

        for (const textNode of textNodes) {
          const text = textNode.textContent ?? "";

          for (const pattern of TIME_PATTERNS) {
            pattern.lastIndex = 0;
            if (pattern.test(text)) {
              highlightTimesInNode(textNode, timezones);
              break;
            }
          }
        }
      });
    }

    function highlightTimesInNode(textNode: Text, tzs: string[]) {
      const text = textNode.textContent ?? "";
      const simpleTimeRegex = /\b(\d{1,2}):(\d{2})\s*(am|pm|AM|PM)\b/g;
      let match: RegExpExecArray | null;
      const fragments: (string | HTMLElement)[] = [];
      let lastIndex = 0;

      while ((match = simpleTimeRegex.exec(text)) !== null) {
        // Add text before match
        if (match.index > lastIndex) {
          fragments.push(text.slice(lastIndex, match.index));
        }

        // Parse the matched time
        let hours = parseInt(match[1], 10);
        const minutes = parseInt(match[2], 10);
        const ampm = match[3]?.toLowerCase();

        if (ampm === "pm" && hours !== 12) hours += 12;
        if (ampm === "am" && hours === 12) hours = 0;

        const date = new Date();
        date.setHours(hours, minutes, 0, 0);

        // Create highlighted span
        const span = document.createElement("span");
        span.className = HIGHLIGHT_CLASS;
        span.textContent = match[0];

        // Build tooltip content
        const tooltip = document.createElement("div");
        tooltip.className = TOOLTIP_CLASS;
        for (const tz of tzs) {
          const line = document.createElement("div");
          line.textContent = `${getTimezoneLabel(tz)}: ${formatDateTimeInZone(date, tz)}`;
          tooltip.appendChild(line);
        }

        // Position tooltip near cursor, clamped to viewport
        span.addEventListener("mouseenter", (e) => {
          document.body.appendChild(tooltip);
          const rect = span.getBoundingClientRect();
          const tooltipRect = tooltip.getBoundingClientRect();

          let top = rect.top - tooltipRect.height - 4;
          let left = rect.left;

          // Clamp to viewport
          if (top < 4) top = rect.bottom + 4;
          if (left + tooltipRect.width > window.innerWidth - 4) {
            left = window.innerWidth - tooltipRect.width - 4;
          }
          if (left < 4) left = 4;

          tooltip.style.top = `${top}px`;
          tooltip.style.left = `${left}px`;
        });
        span.addEventListener("mouseleave", () => tooltip.remove());

        fragments.push(span);
        lastIndex = match.index + match[0].length;
      }

      if (fragments.length === 0) return;

      // Add remaining text
      if (lastIndex < text.length) {
        fragments.push(text.slice(lastIndex));
      }

      // Replace text node with fragments
      const container = document.createDocumentFragment();
      for (const frag of fragments) {
        if (typeof frag === "string") {
          container.appendChild(document.createTextNode(frag));
        } else {
          container.appendChild(frag);
        }
      }

      textNode.parentNode?.replaceChild(container, textNode);
    }
  },
});
