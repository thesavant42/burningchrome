// CDX single page fetch with timeout and abort support
// Based on: https://github.com/thesavant42/gitsome-ng/blob/main/internal/api/wayback.go

import { storage } from '../storage.js';
import { CDX_BATCH_SIZE, CDX_TIMEOUT_MS } from './cdx-constants.js';
import { parseCDXResponse } from './cdx-parser.js';
import { addDebug, getDebugLog } from './cdx-debug.js';
import { handleRateLimit, handleFetchError } from './cdx-retry.js';

/**
 * Fetch a single page of CDX data with timeout and retry logic
 * @param {string} domain - Domain to query
 * @param {string} resumeKey - Resume key for pagination
 * @param {number} retryCount - Current retry attempt
 * @returns {Promise<{records: Array, resumeKey: string, hasMore: boolean}>}
 */
export async function fetchCDXPage(domain, resumeKey = '', retryCount = 0) {
  const url = buildCDXUrl(domain, resumeKey);

  addDebug(`Request ${retryCount > 0 ? `(retry ${retryCount})` : '(initial)'}`);
  addDebug(`URL: ${url}`);
  addDebug(`Timeout: ${CDX_TIMEOUT_MS}ms`);

  const start = Date.now();
  const controller = new AbortController();
  let cancelCheckId = null;
  let timeoutId = null;
  let wasCancelled = false;

  const retryFn = (nextRetry) => fetchCDXPage(domain, resumeKey, nextRetry);

  try {
    timeoutId = setTimeout(() => {
      addDebug(`ABORT triggered after ${CDX_TIMEOUT_MS}ms`);
      controller.abort();
    }, CDX_TIMEOUT_MS);

    cancelCheckId = setInterval(async () => {
      const data = await storage.get('timemapData');
      if (data?.cancelled) {
        addDebug('Cancel requested - aborting fetch');
        wasCancelled = true;
        controller.abort();
      }
    }, 500);

    const response = await fetch(url, { signal: controller.signal });
    clearInterval(cancelCheckId);
    clearTimeout(timeoutId);
    addDebug(`Response: ${response.status} (${Date.now() - start}ms)`);

    if (response.status === 503 || response.status === 429) {
      return await handleRateLimit(retryFn, retryCount, response.status);
    }

    if (!response.ok) {
      addDebug(`ERROR: HTTP ${response.status} after ${Date.now() - start}ms`);
      const err = new Error(`CDX API returned ${response.status}`);
      err.debugLog = getDebugLog();
      throw err;
    }

    const json = await response.json();
    addDebug(`SUCCESS: received ${Array.isArray(json) ? json.length : 0} rows in ${Date.now() - start}ms`);
    return parseCDXResponse(json);

  } catch (error) {
    clearInterval(cancelCheckId);
    clearTimeout(timeoutId);
    return handleFetchError(error, retryFn, retryCount, Date.now() - start, wasCancelled);
  }
}

function buildCDXUrl(domain, resumeKey) {
  let url = `https://web.archive.org/cdx/search/cdx?url=*.${domain}&output=json&fl=original,timestamp,statuscode,mimetype&collapse=urlkey&limit=${CDX_BATCH_SIZE}&showResumeKey=true`;
  if (resumeKey) {
    url += `&resumeKey=${encodeURIComponent(resumeKey)}`;
  }
  return url;
}
