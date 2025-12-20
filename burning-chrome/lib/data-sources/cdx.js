// CDX API - Main paginated fetch orchestrator
// Wayback Machine CDX API with resumeKey pagination

import { storage } from '../storage.js';
import { fetchCDXPage } from './cdx-fetch.js';
import { formatRecordsForDisplay } from './cdx-parser.js';
import { addDebug, getDebugLog } from './cdx-debug.js';

/**
 * Check if the current CDX fetch has been cancelled by user
 */
async function isCancelled() {
  const data = await storage.get('timemapData');
  return data?.cancelled === true;
}

/**
 * Fetch all CDX data for a domain with pagination and progress callbacks
 * @param {string} domain - Domain to query
 * @param {Function} progressCallback - Called with (partialData, recordCount, page, totalPages)
 * @returns {Promise<Array>} All records formatted for display
 */
export async function fetchAllCDXData(domain, progressCallback) {
  const allRecords = [];
  let resumeKey = '';
  let page = 0;

  while (true) {
    // Check for cancel request before each page
    if (await isCancelled()) {
      addDebug('Fetch cancelled by user');
      const err = new Error('Cancelled by user');
      err.cancelled = true;
      err.debugLog = getDebugLog();
      throw err;
    }

    page++;
    const result = await fetchCDXPage(domain, resumeKey);
    
    // Check for cancel after fetch completes
    if (await isCancelled()) {
      addDebug('Fetch cancelled by user after page completed');
      const err = new Error('Cancelled by user');
      err.cancelled = true;
      err.debugLog = getDebugLog();
      throw err;
    }
    
    allRecords.push(...result.records);
    console.log(`Page ${page}: ${result.records.length} records, total: ${allRecords.length}, hasMore: ${result.hasMore}`);

    // Send partial data to UI immediately
    if (progressCallback) {
      const partialData = formatRecordsForDisplay(allRecords);
      await progressCallback(partialData, allRecords.length, page, result.hasMore ? 0 : page);
    }

    if (!result.hasMore || !result.resumeKey) {
      break;
    }

    resumeKey = result.resumeKey;
  }

  console.log(`Completed: ${page} pages, ${allRecords.length} total records`);
  return formatRecordsForDisplay(allRecords);
}

// Re-export debug utilities for handlers
export { getDebugLog, clearDebugLog } from './cdx-debug.js';
export { CDX_BATCH_SIZE } from './cdx-constants.js';

