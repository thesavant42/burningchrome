// Burning Chrome - Background Service Worker
// Thin orchestrator that delegates to focused modules

import { setupContextMenus } from './lib/context-menus.js';
import { setupMessageRouter } from './lib/message-router.js';
import { handleBucketRequest } from './lib/handlers/bucket.js';

// Open landing page when extension icon is clicked
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('landing.html') });
});

// Initialize context menus
setupContextMenus();

// Initialize message routing
setupMessageRouter();

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
