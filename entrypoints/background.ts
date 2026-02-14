/**
 * Background service worker.
 * Opens the side panel when the extension icon is clicked.
 */

export default defineBackground(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(console.error);
});
