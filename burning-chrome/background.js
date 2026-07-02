// Burning Chrome - Background Service Worker
// Thin orchestrator that delegates to focused modules

import { setupContextMenus } from './lib/context-menus.js';
import { setupMessageRouter } from './lib/message-router.js';
import { handleBucketRequest } from './lib/handlers/bucket.js';

console.log('[BURNING-CHROME] === BACKGROUND.JS STARTUP ===');

// Open buckets page with current tab's URL parsed as bucket XML
chrome.action.onClicked.addListener(async () => {
  console.log('[BURNING-CHROME] chrome.action.onClicked handler');
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });
  if (tab && tab.url) {
    await handleBucketRequest(tab);
  }
});

// Initialize context menus
console.log('[BURNING-CHROME] I am now calling setupContextMenus()');
setupContextMenus();
console.log('[BURNING-CHROME] I have landed at setupContextMenus() complete');

// Initialize message routing
console.log('[BURNING-CHROME] I am now calling setupMessageRouter()');
setupMessageRouter();
console.log('[BURNING-CHROME] I have landed at setupMessageRouter() complete');

// Listen for hotkey commands
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'index-bucket') {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });
    if (tab && tab.url) {
      await handleBucketRequest(tab);
    }
  }
});
