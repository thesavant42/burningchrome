// Burning Chrome - Background Service Worker
// Thin orchestrator that delegates to focused modules

import { setupContextMenus } from './lib/context-menus.js';
import { setupMessageRouter } from './lib/message-router.js';

// Open landing page when extension icon is clicked
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('landing.html') });
});

// Initialize context menus
setupContextMenus();

// Initialize message routing
setupMessageRouter();
