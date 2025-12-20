// Message router for inter-page communication
// Handles messages from extension pages to background service worker

import { fetchVirusTotalSubdomains } from './data-sources/virustotal.js';
import { fetchCrtshSubdomains } from './data-sources/crtsh.js';
import { fetchShodanSubdomains } from './data-sources/shodan.js';
import { handleCdxScanFromMessage } from './handlers/timemap.js';

/**
 * Setup message listener for runtime messages
 */
export function setupMessageRouter() {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'vt-subdomains') {
      fetchVirusTotalSubdomains(msg.domain, msg.apiKey)
        .then(sendResponse)
        .catch(err => sendResponse({ error: err.message }));
      return true; // Keep channel open for async response
    }

    if (msg.type === 'crtsh-subdomains') {
      fetchCrtshSubdomains(msg.domain)
        .then(sendResponse)
        .catch(err => sendResponse({ error: err.message }));
      return true;
    }

    if (msg.type === 'shodan-subdomains') {
      fetchShodanSubdomains(msg.domain, msg.apiKey)
        .then(sendResponse)
        .catch(err => sendResponse({ error: err.message }));
      return true;
    }

    if (msg.type === 'cdx-scan') {
      handleCdxScanFromMessage(msg.domain);
      sendResponse({ started: true });
    }
  });
}

