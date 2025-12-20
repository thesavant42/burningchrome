import { storage } from './lib/storage.js';

// CDX API constants
const MAX_RETRIES = 3;
const CDX_BATCH_SIZE = 1000;
const CDX_TIMEOUT_MS = 60000; // 60 seconds - Wayback Machine can be slow

// Keep service worker alive during long operations
let keepAliveInterval = null;
function startKeepAlive() {
  if (!keepAliveInterval) {
    keepAliveInterval = setInterval(() => chrome.runtime.getPlatformInfo(), 25000);
  }
}
function stopKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
}

// Create context menus on install
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

// Handle context menu click
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'timemap-domain') {
    await handleTimemapRequest(tab);
  } else if (info.menuItemId === 'crtsh-domain') {
    await handleCrtshRequest(tab);
  }
});

async function handleTimemapRequest(tab) {
  const url = new URL(tab.url);
  const domain = url.hostname.replace(/^www\./, '');
  const startTime = Date.now();
  const fetchUrl = `https://web.archive.org/cdx/search/cdx?url=*.${domain}&output=json&fl=original,timestamp,statuscode,mimetype&collapse=urlkey&limit=${CDX_BATCH_SIZE}&showResumeKey=true`;

  // Store loading state immediately
  await storage.set('timemapData', {
    domain: domain,
    data: null,
    loading: true,
    error: null,
    page: 0,
    recordCount: 0,
    startTime: startTime,
    fetchUrl: fetchUrl,
    timestamp: Date.now()
  });

  // Open report page immediately
  const reportUrl = chrome.runtime.getURL('report.html');
  await chrome.tabs.create({ url: reportUrl });

  // Fetch data in background with progress updates - send partial data as pages arrive
  startKeepAlive();
  try {
    const allData = await fetchAllCDXData(domain, async (partialData, recordCount, page, totalPages) => {
      await storage.set('timemapData', {
        domain: domain,
        data: partialData,
        loading: true,
        error: null,
        page: page,
        totalPages: totalPages,
        recordCount: recordCount,
        startTime: startTime,
        debugLog: getDebugLog(),
        timestamp: Date.now()
      });
    });
    await storage.set('timemapData', {
      domain: domain,
      data: allData,
      loading: false,
      error: null,
      fetchUrl: fetchUrl,
      debugLog: getDebugLog(),
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('CDX fetch failed:', error);
    // Get current data to preserve partial results on cancel
    const current = await storage.get('timemapData');
    await storage.set('timemapData', {
      domain: domain,
      data: error.cancelled && current?.data ? current.data : null,
      loading: false,
      error: error.message,
      cancelled: error.cancelled || false,
      debugLog: error.debugLog || getDebugLog(),
      timestamp: Date.now()
    });
  } finally {
    clearDebugLog();
    stopKeepAlive();
  }
}

async function handleCrtshRequest(tab) {
  // Extract domain from tab URL
  const url = new URL(tab.url);
  const domain = url.hostname;
  const startTime = Date.now();
  const fetchUrl = `https://crt.sh/json?q=${domain}`;

  // Store domain immediately so the report page can show loading state
  await storage.set('crtshData', {
    domain: domain,
    data: null,
    loading: true,
    error: null,
    fetchUrl: fetchUrl,
    startTime: startTime,
    timestamp: Date.now()
  });

  // Open report page immediately
  const reportUrl = chrome.runtime.getURL('report.html');
  await chrome.tabs.create({ url: reportUrl });

  // Fetch data in background
  startKeepAlive();
  try {
    const crtData = await fetchCrtshData(domain);
    await storage.set('crtshData', {
      domain: domain,
      data: crtData,
      loading: false,
      error: null,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Crt.sh fetch failed:', error);
    await storage.set('crtshData', {
      domain: domain,
      data: null,
      loading: false,
      error: error.message,
      timestamp: Date.now()
    });
  } finally {
    stopKeepAlive();
  }
}

// CDX API with resumeKey pagination based on:
// https://github.com/thesavant42/gitsome-ng/blob/main/internal/api/wayback.go

async function fetchAllCDXData(domain, progressCallback) {
  const allRecords = [];
  let resumeKey = '';
  let page = 0;

  while (true) {
    // Check for cancel request
    const timemapData = await storage.get('timemapData');
    if (timemapData?.cancelled) {
      addDebug('Fetch cancelled by user');
      const err = new Error('Cancelled by user');
      err.cancelled = true;
      err.debugLog = getDebugLog();
      throw err;
    }

    page++;
    const result = await fetchCDXPage(domain, resumeKey);
    
    allRecords.push(...result.records);
    console.log(`Page ${page}: ${result.records.length} records, total: ${allRecords.length}, hasMore: ${result.hasMore}`);

    // Build partial data array and send to UI immediately
    const partialData = [
      ['original', 'timestamp', 'statuscode', 'mimetype'],
      ...allRecords.map(r => [r.url, r.timestamp, r.statuscode, r.mimetype])
    ];

    if (progressCallback) {
      await progressCallback(partialData, allRecords.length, page, result.hasMore ? 0 : page);
    }

    if (!result.hasMore || !result.resumeKey) {
      break;
    }

    resumeKey = result.resumeKey;
  }

  console.log(`Completed: ${page} pages, ${allRecords.length} total records`);

  return [
    ['original', 'timestamp', 'statuscode', 'mimetype'],
    ...allRecords.map(r => [r.url, r.timestamp, r.statuscode, r.mimetype])
  ];
}

// Debug info collector for UI display
let cdxDebugLog = [];

function addDebug(msg) {
  const ts = new Date().toISOString().split('T')[1].split('.')[0];
  cdxDebugLog.push(`[${ts}] ${msg}`);
  console.log(`[CDX] ${msg}`);
}

function getDebugLog() {
  return cdxDebugLog.join('\n');
}

function clearDebugLog() {
  cdxDebugLog = [];
}

async function fetchCDXPage(domain, resumeKey = '', retryCount = 0) {
  // Build URL with resumeKey pagination - NO fl parameter for showNumPages compatibility
  let url = `https://web.archive.org/cdx/search/cdx?url=*.${domain}&output=json&fl=original,timestamp,statuscode,mimetype&collapse=urlkey&limit=${CDX_BATCH_SIZE}&showResumeKey=true`;
  if (resumeKey) {
    url += `&resumeKey=${encodeURIComponent(resumeKey)}`;
  }
  
  // Debug logging for UI
  addDebug(`Request ${retryCount > 0 ? `(retry ${retryCount}/${MAX_RETRIES})` : '(initial)'}`);
  addDebug(`URL: ${url}`);
  addDebug(`Timeout: ${CDX_TIMEOUT_MS}ms`);
  const start = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      addDebug(`ABORT triggered after ${CDX_TIMEOUT_MS}ms`);
      controller.abort();
    }, CDX_TIMEOUT_MS);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    addDebug(`Response: ${response.status} (${Date.now() - start}ms)`);

    if (response.status === 503 || response.status === 429) {
      if (retryCount < MAX_RETRIES) {
        const backoff = Math.pow(2, retryCount) * 10000;
        addDebug(`Rate limited (${response.status}), waiting ${backoff}ms...`);
        await sleep(backoff);
        return fetchCDXPage(domain, resumeKey, retryCount + 1);
      }
      const err = new Error(`Rate limited after ${MAX_RETRIES} retries`);
      err.debugLog = getDebugLog();
      throw err;
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
    const elapsed = Date.now() - start;
    
    if (error.name === 'AbortError') {
      addDebug(`TIMEOUT after ${elapsed}ms (limit: ${CDX_TIMEOUT_MS}ms)`);
      if (retryCount < MAX_RETRIES) {
        const backoff = Math.pow(2, retryCount) * 5000;
        addDebug(`Will retry in ${backoff}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`);
        await sleep(backoff);
        return fetchCDXPage(domain, resumeKey, retryCount + 1);
      }
      addDebug(`FAILED - exhausted all ${MAX_RETRIES} retries`);
      const err = new Error(`Request timed out after ${MAX_RETRIES} retries (${CDX_TIMEOUT_MS / 1000}s timeout each)`);
      err.debugLog = getDebugLog();
      throw err;
    }
    
    if (retryCount < MAX_RETRIES && error.name === 'TypeError') {
      addDebug(`Network error after ${elapsed}ms: ${error.message}`);
      const backoff = Math.pow(2, retryCount) * 5000;
      addDebug(`Will retry in ${backoff}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`);
      await sleep(backoff);
      return fetchCDXPage(domain, resumeKey, retryCount + 1);
    }
    
    addDebug(`ERROR: ${error.name}: ${error.message}`);
    addDebug(`Elapsed: ${elapsed}ms`);
    error.debugLog = error.debugLog || getDebugLog();
    throw error;
  }
}

function parseCDXResponse(rawRows) {
  const result = {
    records: [],
    resumeKey: '',
    hasMore: false
  };

  if (!Array.isArray(rawRows) || rawRows.length === 0) {
    return result;
  }

  // Check last row for resume key (single-element array)
  const lastRow = rawRows[rawRows.length - 1];
  if (Array.isArray(lastRow) && lastRow.length === 1) {
    result.resumeKey = lastRow[0];
    result.hasMore = true;
    rawRows = rawRows.slice(0, -1);
  }

  // Skip header row (index 0), parse data rows
  for (let i = 1; i < rawRows.length; i++) {
    const row = rawRows[i];

    // Skip empty rows
    if (!Array.isArray(row) || row.length === 0) {
      continue;
    }

    // Skip malformed rows
    if (row.length < 4) {
      continue;
    }

    result.records.push({
      url: row[0],
      timestamp: row[1],
      statuscode: row[2] || '',
      mimetype: row[3] || ''
    });
  }

  return result;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Crt.sh API functions
async function fetchCrtshData(domain) {
  const crtUrl = `https://crt.sh/json?q=${domain}`;
  console.log(`Fetching crt.sh data for ${domain}...`);

  const response = await fetch(crtUrl, {
    headers: {
      'Accept': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Crt.sh API returned ${response.status}`);
  }

  const json = await response.json();
  console.log(`Crt.sh returned ${json.length} certificates`);
  
  return json;
}
