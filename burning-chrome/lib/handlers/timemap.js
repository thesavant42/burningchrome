// Timemap request handler
// Orchestrates CDX fetch operations triggered from context menu or domains page

import { storage } from '../storage.js';
import { saveTimemap } from '../db.js';
import { startKeepAlive, stopKeepAlive } from '../keep-alive.js';
import { fetchAllCDXData, getDebugLog, clearDebugLog, CDX_BATCH_SIZE } from '../data-sources/cdx.js';

/**
 * Handle timemap request from context menu click
 * @param {chrome.tabs.Tab} tab - The tab where context menu was clicked
 */
export async function handleTimemapRequest(tab) {
  const url = new URL(tab.url);
  const domain = url.hostname.replace(/^www\./, '');
  await executeCdxScan(domain);
}

/**
 * Handle CDX scan triggered from domains page message
 * @param {string} domain - Domain to scan
 */
export async function handleCdxScanFromMessage(domain) {
  await executeCdxScan(domain);
}

async function executeCdxScan(domain) {
  const startTime = Date.now();
  const fetchUrl = `https://web.archive.org/cdx/search/cdx?url=*.${domain}&output=json&fl=original,timestamp,statuscode,mimetype&collapse=urlkey&limit=${CDX_BATCH_SIZE}&showResumeKey=true`;

  await storage.set('timemapData', {
    domain,
    data: null,
    loading: true,
    error: null,
    page: 0,
    recordCount: 0,
    startTime,
    fetchUrl,
    timestamp: Date.now()
  });

  chrome.tabs.create({ url: chrome.runtime.getURL('report.html') });

  startKeepAlive();
  try {
    const allData = await fetchAllCDXData(domain, async (partialData, recordCount, page, totalPages) => {
      await storage.set('timemapData', {
        domain,
        data: partialData,
        loading: true,
        error: null,
        page,
        totalPages,
        recordCount,
        startTime,
        debugLog: getDebugLog(),
        timestamp: Date.now()
      });
    });

    await storage.set('timemapData', {
      domain,
      data: allData,
      loading: false,
      error: null,
      fetchUrl,
      debugLog: getDebugLog(),
      timestamp: Date.now()
    });

    await saveTimemap(domain, { data: allData, fetchedAt: Date.now() });
  } catch (error) {
    console.error('CDX fetch failed:', error);
    const current = await storage.get('timemapData');
    await storage.set('timemapData', {
      domain,
      data: error.cancelled && current?.data ? current.data : null,
      loading: false,
      error: error.message,
      cancelled: error.cancelled || false,
      debugLog: error.debugLog || getDebugLog(),
      timestamp: Date.now()
    });

    if (error.cancelled && current?.data) {
      await saveTimemap(domain, { data: current.data, fetchedAt: Date.now(), partial: true });
    }
  } finally {
    clearDebugLog();
    stopKeepAlive();
  }
}

