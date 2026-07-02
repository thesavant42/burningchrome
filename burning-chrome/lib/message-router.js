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
        .catch((err) => sendResponse({ error: err.message }));
      return true; // Keep channel open for async response
    }

    if (msg.type === 'crtsh-subdomains') {
      fetchCrtshSubdomains(msg.domain)
        .then(sendResponse)
        .catch((err) => sendResponse({ error: err.message }));
      return true;
    }

    if (msg.type === 'shodan-subdomains') {
      fetchShodanSubdomains(msg.domain, msg.apiKey)
        .then(sendResponse)
        .catch((err) => sendResponse({ error: err.message }));
      return true;
    }

    if (msg.type === 'cdx-scan') {
      handleCdxScanFromMessage(msg.domain);
      sendResponse({ started: true });
    }

    if (msg.type === 'fetch-bucket') {
      fetch(msg.url)
        .then(async (response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          let xml = await response.text();

          // Azure retry: if server header is Windows-Azure-Blob and body is blank, retry with &comp=list
          if (response.headers.get('server')?.toLowerCase().includes('windows-azure-blob') && !xml.trim()) {
            const azureUrl = msg.url.includes('?') ? `${msg.url}&comp=list` : `${msg.url}?comp=list`;
            const retryResponse = await fetch(azureUrl);
            if (!retryResponse.ok) throw new Error(`HTTP ${retryResponse.status}`);
            xml = await retryResponse.text();
          }

          sendResponse({ xml });
        })
        .catch(async (err) => {
          console.warn(`[DEBUG] service worker fetch-bucket failed: ${err.message}. Trying tab fallback...`);
          try {
            const xml = await tryFetchViaTab(msg.url, 'text');
            sendResponse({ xml });
          } catch (tabErr) {
            sendResponse({
              error: `Failed to fetch: ${err.message}. (Note: Tab fallback failed: ${tabErr.message})`
            });
          }
        });
      return true; // Keep channel open for async response
    }

    if (msg.type === 'fetch-file-base64') {
      fetch(msg.url)
        .then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.arrayBuffer();
        })
        .then((buffer) => {
          const bytes = new Uint8Array(buffer);
          let binary = '';
          const chunk = 8192;
          for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode.apply(
              null,
              bytes.subarray(i, i + chunk)
            );
          }
          const base64 = btoa(binary);
          sendResponse({ base64 });
        })
        .catch(async (err) => {
          console.warn(`[DEBUG] service worker fetch-file-base64 failed: ${err.message}. Trying tab fallback...`);
          try {
            const base64 = await tryFetchViaTab(msg.url, 'base64');
            sendResponse({ base64 });
          } catch (tabErr) {
            sendResponse({
              error: `Failed to download: ${err.message}. (Note: Tab fallback failed: ${tabErr.message})`
            });
          }
        });
      return true; // Keep channel open for async response
    }
  });
}

/**
 * Attempt to execute fetch on a tab belonging to the same host
 * @param {string} url
 * @param {'text'|'base64'} responseType
 * @returns {Promise<any>}
 */
async function tryFetchViaTab(url, responseType) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    // Find tabs matching the same domain (allowing http/https)
    const tabs = await chrome.tabs.query({ url: `*://${hostname}/*` });

    if (!tabs || tabs.length === 0) {
      throw new Error(`No active tab found for domain ${hostname}. Please open a tab to ${urlObj.origin} and type 'thisisunsafe' on your keyboard to authorize certificate overrides.`);
    }

    const tabId = tabs[0].id;

    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (fetchUrl, type) => {
        const resp = await fetch(fetchUrl);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        if (type === 'base64') {
          const buffer = await resp.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          let binary = '';
          const chunk = 8192;
          for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
          }
          return btoa(binary);
        } else {
          return await resp.text();
        }
      },
      args: [url, responseType]
    });

    if (result && result.error) {
      throw new Error(result.error);
    }

    return result.result;
  } catch (err) {
    console.error('[DEBUG] Failed tab fetch:', err);
    throw err;
  }
}
