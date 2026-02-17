import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Multizone GCal",
    description:
      "Multi-timezone overlay for Google Calendar — schedule across timezones with ease",
    version: "1.7.0",
    permissions: ["storage", "sidePanel", "activeTab"],
    host_permissions: [
      "https://calendar.google.com/*",
      "https://mail.google.com/*",
    ],
    icons: {
      "16": "icon-16.png",
      "48": "icon-48.png",
      "128": "icon-128.png",
    },
    side_panel: {
      default_path: "sidepanel.html",
    },
  },
});
