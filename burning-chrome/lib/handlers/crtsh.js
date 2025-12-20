// Crt.sh request handler
// Orchestrates crt.sh fetch operations triggered from context menu

import { storage } from '../storage.js';
import { startKeepAlive, stopKeepAlive } from '../keep-alive.js';
import { fetchCrtshData } from '../data-sources/crtsh.js';

/**
 * Handle crt.sh request from context menu click
 * @param {chrome.tabs.Tab} tab - The tab where context menu was clicked
 */
export async function handleCrtshRequest(tab) {
  const url = new URL(tab.url);
  const domain = url.hostname;
  const startTime = Date.now();
  const fetchUrl = `https://crt.sh/json?q=${domain}`;

  await storage.set('crtshData', {
    domain,
    data: null,
    loading: true,
    error: null,
    fetchUrl,
    startTime,
    timestamp: Date.now()
  });

  const reportUrl = chrome.runtime.getURL('report.html');
  await chrome.tabs.create({ url: reportUrl });

  startKeepAlive();
  try {
    const crtData = await fetchCrtshData(domain);
    await storage.set('crtshData', {
      domain,
      data: crtData,
      loading: false,
      error: null,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Crt.sh fetch failed:', error);
    await storage.set('crtshData', {
      domain,
      data: null,
      loading: false,
      error: error.message,
      timestamp: Date.now()
    });
  } finally {
    stopKeepAlive();
  }
}

