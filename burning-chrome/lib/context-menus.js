// Context menu setup and event handling

import { handleTimemapRequest } from './handlers/timemap.js';
import { handleCrtshRequest } from './handlers/crtsh.js';

/**
 * Create context menus on extension install
 */
export function setupContextMenus() {
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
      id: 'timemap-domain',
      title: 'Timemap this domain',
      contexts: ['page']
    });
    chrome.contextMenus.create({
      id: 'crtsh-domain',
      title: 'Crt.sh Domain',
      contexts: ['page']
    });
  });

  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === 'timemap-domain') {
      await handleTimemapRequest(tab);
    } else if (info.menuItemId === 'crtsh-domain') {
      await handleCrtshRequest(tab);
    }
  });
}

