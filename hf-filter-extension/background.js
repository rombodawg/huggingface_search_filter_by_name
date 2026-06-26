// background.js
// Minimal service worker. Ensures storage is initialized on install so the
// content script never has to special-case "undefined" vs "empty array".

chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get("hfFilterRules");
  if (!Array.isArray(data.hfFilterRules)) {
    await chrome.storage.local.set({ hfFilterRules: [] });
  }
});
