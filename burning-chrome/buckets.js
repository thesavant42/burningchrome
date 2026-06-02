import { storage } from './lib/storage.js';
import {
  parseBucketXml,
  buildDownloadUrl,
  formatSize,
  formatDate,
  escapeHtml
} from './lib/bucket-parser.js';
import { renderPaginationControls } from './lib/bucket-pagination.js';
import { saveBucket, getBucket, deleteBucket, listBuckets } from './lib/db.js';

let bucketName = '';
let bucketUrl = ''; // Current bucket URL (for saving)
let allItems = []; // All parsed items from XML
let filteredItems = []; // Items after search filter
let currentPage = 1;
const ROWS_PER_PAGE = 50;

// View mode: when true, we're viewing cached data
let _viewMode = false;

async function init() {
  // Set version number from manifest
  const version = chrome.runtime.getManifest().version;
  const versionEl = document.getElementById('extVersion');
  if (versionEl) {
    versionEl.textContent = version;
  }

  // Parse URL params for project context
  const params = new URLSearchParams(window.location.search);
  const projectName = params.get('project');
  const viewUrl = params.get('view');

  // Update nav links with project parameter if present
  if (projectName) {
    const projectParam = `?project=${encodeURIComponent(projectName)}`;
    document.getElementById('navDomains').href = `domains.html${projectParam}`;
    document.getElementById('navPoi').href = `poi.html${projectParam}`;
    document.getElementById('navGithub').href = `github.html${projectParam}`;
    document.getElementById('navDockerhub').href =
      `dockerhub.html${projectParam}`;
    document.getElementById('navCreds').href = `creds.html${projectParam}`;
  }

  // Setup event listeners
  setupEventListeners();

  // Load saved reports list
  await loadSavedReportsList();

  // Check for view mode (loading cached data from IndexedDB)
  if (viewUrl) {
    _viewMode = true;
    await loadCachedBucket(viewUrl);
    return;
  }

  // Check if context menu passed bucket data
  await checkForStoredBucket();

  // Show empty state initially if no data loaded
  if (allItems.length === 0) {
    document.getElementById('emptyState').classList.remove('hidden');
  }
}

async function checkForStoredBucket() {
  const data = await storage.get('bucketData');

  if (!data) return;

  // If still loading, poll until complete
  if (data.loading === true) {
    document.getElementById('loadingStatus').textContent = 'Loading...';

    // Poll every 500ms until loading is complete
    const pollInterval = setInterval(async () => {
      const updatedData = await storage.get('bucketData');

      if (!updatedData || updatedData.loading === false) {
        clearInterval(pollInterval);
        document.getElementById('loadingStatus').textContent = '';

        if (updatedData) {
          if (updatedData.error) {
            showError(updatedData.error);
          } else if (updatedData.xml) {
            loadBucketXml(updatedData.url, updatedData.xml);
          }
          // Clear bucket data from storage after reading
          await storage.remove('bucketData');
        }
      }
    }, 500);

    return;
  }

  // Data is ready
  if (data.error) {
    showError(data.error);
  } else if (data.xml) {
    loadBucketXml(data.url, data.xml);
  }

  // Clear bucket data from storage after reading
  await storage.remove('bucketData');
}

async function fetchBucketFromUrl(url) {
  // Clear previous state
  hideError();
  document.getElementById('loadingStatus').textContent = 'Fetching...';

  // Ensure URL has a protocol - default to https:// if missing
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }

  // Clean URL: strip subresources (like ?acl)
  try {
    const urlObj = new URL(url);
    const subresources = [
      'acl',
      'cors',
      'lifecycle',
      'policy',
      'location',
      'logging',
      'notification',
      'tagging',
      'encryption',
      'website',
      'versioning',
      'requestPayment',
      'object-lock',
      'uploads'
    ];
    subresources.forEach((sub) => urlObj.searchParams.delete(sub));
    if (!urlObj.hostname.includes('googleapis.com')) {
      urlObj.searchParams.set('list-type', '2');
    }
    url = urlObj.toString();
  } catch (e) {
    console.warn(
      '[DEBUG] Failed to parse/clean URL in fetchBucketFromUrl:',
      url,
      e
    );
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'fetch-bucket',
      url: url
    });

    document.getElementById('loadingStatus').textContent = '';

    if (response.error) {
      showError(response.error);
      return;
    }

    if (response.xml) {
      loadBucketXml(url, response.xml);
    }
  } catch (err) {
    document.getElementById('loadingStatus').textContent = '';
    showError(err.message);
  }
}

function getNextPageUrl(
  currentUrl,
  nextContinuationToken,
  nextMarker,
  lastKey
) {
  const urlObj = new URL(currentUrl);

  // Strip S3/GCS subresource query parameters that interfere with ListObjects listing
  const subresources = [
    'acl',
    'cors',
    'lifecycle',
    'policy',
    'location',
    'logging',
    'notification',
    'tagging',
    'encryption',
    'website',
    'versioning',
    'requestPayment',
    'object-lock',
    'uploads'
  ];
  subresources.forEach((sub) => urlObj.searchParams.delete(sub));

  if (nextContinuationToken) {
    urlObj.searchParams.set('list-type', '2');
    urlObj.searchParams.set('continuation-token', nextContinuationToken);
    urlObj.searchParams.delete('marker');
  } else {
    // Fall back to marker pagination
    const marker = nextMarker || lastKey;
    if (marker) {
      urlObj.searchParams.set('marker', marker);
    }
    urlObj.searchParams.delete('continuation-token');
    urlObj.searchParams.delete('list-type'); // Prevent GCS from rejecting marker queries
  }

  return urlObj.toString();
}

async function loadBucketXml(url, xmlText) {
  // Clean initial URL by stripping non-listing query parameters like ?acl
  try {
    const cleanUrlObj = new URL(url);
    const subresources = [
      'acl',
      'cors',
      'lifecycle',
      'policy',
      'location',
      'logging',
      'notification',
      'tagging',
      'encryption',
      'website',
      'versioning',
      'requestPayment',
      'object-lock',
      'uploads'
    ];
    subresources.forEach((sub) => cleanUrlObj.searchParams.delete(sub));
    url = cleanUrlObj.toString();
  } catch (e) {
    console.warn('[DEBUG] Failed to parse URL for cleaning:', url, e);
  }

  let currentXmlText = xmlText;
  let currentUrl = url;
  let allItemsList = [];
  let pageCount = 1;
  let hasMore = true;
  const fetchedUrls = new Set();

  // Clear any existing errors
  hideError();

  const loadingStatusEl = document.getElementById('loadingStatus');

  const updateLoadingStatus = (msg) => {
    loadingStatusEl.innerHTML = `${msg} <button id="stopFetchBtn" class="btn-action" style="margin-left: 10px; padding: 2px 6px; font-size: 11px;">Stop</button>`;
    const btn = document.getElementById('stopFetchBtn');
    if (btn) {
      btn.addEventListener('click', () => {
        hasMore = false;
        loadingStatusEl.textContent = 'Stopping...';
        console.log('User clicked Stop button.');
      });
    }
  };

  updateLoadingStatus('Parsing page 1...');

  while (hasMore) {
    fetchedUrls.add(currentUrl);
    const result = parseBucketXml(currentXmlText);

    console.log(`[DEBUG] Page ${pageCount} Parse Result:`, {
      itemsCount: result.items.length,
      isTruncated: result.isTruncated,
      nextContinuationToken: result.nextContinuationToken,
      nextMarker: result.nextMarker,
      error: result.error
    });

    if (result.error) {
      showError(result.error);
      if (pageCount === 1) {
        loadingStatusEl.textContent = '';
        return;
      }
      break;
    }

    if (pageCount === 1) {
      bucketName = result.bucketName;
      bucketUrl = url;
      window.bucketBaseUrl = url;
      document.getElementById('title').textContent = bucketName;
      document.getElementById('bucketUrlInput').value = url;
    }

    // Map items to have sequential IDs to prevent duplicates/conflicts
    const items = result.items.map((item, idx) => ({
      ...item,
      id: allItemsList.length + idx
    }));

    allItemsList.push(...items);

    // Update global state and render table incrementally (preserving current page)
    allItems = allItemsList;
    applyFilter(true);

    document.getElementById('bucketStats').textContent =
      ` | ${allItemsList.length} items fetched`;

    if (!result.isTruncated) {
      console.log(
        `[DEBUG] Page ${pageCount} indicates isTruncated = false. Stopping fetch loop.`
      );
      hasMore = false;
      break;
    }

    const lastKey = items.length > 0 ? items[items.length - 1].key : '';
    const nextContinuationToken = result.nextContinuationToken;
    const nextMarker = result.nextMarker;

    if (!nextContinuationToken && !nextMarker && !lastKey) {
      console.warn(
        '[DEBUG] No pagination tokens or lastKey available on truncated response; stopping.'
      );
      break;
    }

    const nextUrl = getNextPageUrl(
      currentUrl,
      nextContinuationToken,
      nextMarker,
      lastKey
    );

    console.log(
      `[DEBUG] Calculated next page URL for Page ${pageCount + 1}:`,
      nextUrl
    );

    if (fetchedUrls.has(nextUrl)) {
      console.warn(
        `[DEBUG] Pagination URL repeated; stopping to avoid loop. nextUrl: ${nextUrl}`
      );
      break;
    }

    pageCount++;
    updateLoadingStatus(
      `Fetching page ${pageCount} (${allItemsList.length} items)...`
    );

    try {
      console.log(
        `[DEBUG] Sending message to fetch Page ${pageCount}: ${nextUrl}`
      );
      const response = await chrome.runtime.sendMessage({
        type: 'fetch-bucket',
        url: nextUrl
      });

      if (response.error) {
        showError(`Error fetching page ${pageCount}: ${response.error}`);
        console.error(
          `[DEBUG] Fetch Page ${pageCount} returned error:`,
          response.error
        );
        break;
      }

      if (!response.xml) {
        showError(`Error fetching page ${pageCount}: Empty response`);
        console.error(
          `[DEBUG] Fetch Page ${pageCount} returned empty XML response.`
        );
        break;
      }

      currentXmlText = response.xml;
      currentUrl = nextUrl;
    } catch (err) {
      showError(`Error fetching page ${pageCount}: ${err.message}`);
      console.error(`[DEBUG] Failed to fetch Page ${pageCount}:`, err);
      break;
    }
  }

  if (
    !loadingStatusEl.textContent.includes('reached') &&
    !loadingStatusEl.textContent.includes('Stopping')
  ) {
    loadingStatusEl.textContent = '';
  } else if (loadingStatusEl.textContent === 'Stopping...') {
    loadingStatusEl.textContent = 'Stopped by user.';
  }

  allItems = allItemsList;
  document.getElementById('bucketStats').textContent =
    ` | ${allItems.length} items`;

  // Auto-save to IndexedDB on fetch
  await saveBucketToCache();
}

// Load cached bucket data from IndexedDB (view mode)
async function loadCachedBucket(url) {
  const cached = await getBucket(url);

  if (!cached) {
    showError(`No cached data found for this bucket`);
    return;
  }

  bucketName = cached.bucketName;
  bucketUrl = url;
  allItems = cached.items || [];
  window.bucketBaseUrl = url;

  if (allItems.length === 0) {
    showError(`No items found in cached bucket`);
    return;
  }

  const savedDate = cached.savedAt
    ? new Date(cached.savedAt).toLocaleDateString()
    : 'unknown';

  // Update title and stats
  document.getElementById('title').textContent = `${bucketName} (cached)`;
  document.getElementById('bucketStats').textContent =
    ` | ${allItems.length} items - saved ${savedDate}`;

  // Populate URL input with the bucket URL
  document.getElementById('bucketUrlInput').value = url;

  // Apply filter and render
  applyFilter();
}

// Save current bucket report to IndexedDB (auto-save on fetch)
async function saveBucketToCache() {
  if (!bucketUrl || allItems.length === 0) {
    return;
  }

  const data = {
    url: bucketUrl,
    bucketName: bucketName,
    items: allItems,
    savedAt: Date.now()
  };

  await saveBucket(bucketUrl, data);

  // Refresh saved reports list
  await loadSavedReportsList();
}

function applyFilter(preservePage = false) {
  const query = document.getElementById('searchInput').value.trim();

  if (query) {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const inclusions = [];
    const exclusions = [];

    for (const term of terms) {
      if ((term.startsWith('-') || term.startsWith('!')) && term.length > 1) {
        exclusions.push(term.slice(1));
      } else {
        inclusions.push(term);
      }
    }

    filteredItems = allItems.filter((item) => {
      const keyLower = item.key.toLowerCase();

      // Exclude if any exclusion term matches
      for (const exc of exclusions) {
        if (keyLower.includes(exc)) {
          return false;
        }
      }

      // Include only if all inclusion terms match
      for (const inc of inclusions) {
        if (!keyLower.includes(inc)) {
          return false;
        }
      }

      return true;
    });
  } else {
    filteredItems = [...allItems];
  }

  if (!preservePage) {
    currentPage = 1;
  }
  renderTable();
}

function renderTable() {
  const totalPages = Math.max(
    1,
    Math.ceil(filteredItems.length / ROWS_PER_PAGE)
  );

  // Clamp current page
  if (currentPage < 1) currentPage = 1;
  if (currentPage > totalPages) currentPage = totalPages;

  const start = (currentPage - 1) * ROWS_PER_PAGE;
  const pageItems = filteredItems.slice(start, start + ROWS_PER_PAGE);

  const table = document.getElementById('bucketTable');
  const emptyState = document.getElementById('emptyState');

  if (filteredItems.length === 0) {
    table.classList.add('hidden');
    if (allItems.length === 0) {
      emptyState.classList.remove('hidden');
    } else {
      emptyState.classList.add('hidden');
    }
  } else {
    table.classList.remove('hidden');
    emptyState.classList.add('hidden');
  }

  const exportJsonBtn = document.getElementById('exportJson');
  const exportCsvBtn = document.getElementById('exportCsv');
  const exportWgetBtn = document.getElementById('exportWget');
  if (allItems.length > 0) {
    exportJsonBtn.classList.remove('hidden');
    exportCsvBtn.classList.remove('hidden');
    exportWgetBtn.classList.remove('hidden');
  } else {
    exportJsonBtn.classList.add('hidden');
    exportCsvBtn.classList.add('hidden');
    exportWgetBtn.classList.add('hidden');
  }

  // Build table rows
  const tbody = document.getElementById('bucketBody');
  tbody.innerHTML = '';

  pageItems.forEach((item) => {
    const tr = document.createElement('tr');
    const downloadUrl = buildDownloadUrl(window.bucketBaseUrl, item.key);
    tr.innerHTML = `
      <td class="col-url"><a href="${downloadUrl}" target="_blank">${escapeHtml(item.key)}</a></td>
      <td>${formatSize(item.size)}</td>
      <td>${formatDate(item.lastModified)}</td>
      <td><a href="${downloadUrl}" target="_blank" class="btn-action">Open</a></td>
    `;
    tbody.appendChild(tr);
  });

  // Render pagination controls
  renderPaginationControls(
    'paginationTop',
    {
      currentPage,
      totalPages,
      filteredCount: filteredItems.length,
      rowsPerPage: ROWS_PER_PAGE
    },
    handlePageChange
  );

  renderPaginationControls(
    'paginationBottom',
    {
      currentPage,
      totalPages,
      filteredCount: filteredItems.length,
      rowsPerPage: ROWS_PER_PAGE
    },
    handlePageChange
  );
}

function handlePageChange(newPage) {
  const totalPages = Math.max(
    1,
    Math.ceil(filteredItems.length / ROWS_PER_PAGE)
  );

  // Clamp new page
  if (newPage < 1) newPage = 1;
  if (newPage > totalPages) newPage = totalPages;

  currentPage = newPage;
  renderTable();
}

function showError(message) {
  const errorEl = document.getElementById('errorState');
  errorEl.textContent = `Error: ${message}`;
  errorEl.classList.remove('hidden');
  document.getElementById('bucketTable').classList.add('hidden');
}

function hideError() {
  document.getElementById('errorState').classList.add('hidden');
}

function setupEventListeners() {
  document.getElementById('fetchBucket').addEventListener('click', () => {
    const url = document.getElementById('bucketUrlInput').value.trim();
    if (url) fetchBucketFromUrl(url);
  });

  document.getElementById('bucketUrlInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const url = e.target.value.trim();
      if (url) fetchBucketFromUrl(url);
    }
  });

  document.getElementById('searchInput').addEventListener('input', () => {
    applyFilter();
  });

  // Saved reports dropdown change
  document
    .getElementById('savedReportsSelect')
    .addEventListener('change', handleSavedReportChange);

  // Delete saved report button
  document
    .getElementById('deleteSavedReport')
    .addEventListener('click', handleDeleteSavedReport);

  // Export buttons
  document
    .getElementById('exportJson')
    .addEventListener('click', exportJsonData);
  document.getElementById('exportCsv').addEventListener('click', exportCsvData);
  document
    .getElementById('exportWget')
    .addEventListener('click', exportWgetData);
}

function exportJsonData() {
  if (filteredItems.length === 0) return;
  const data = {
    url: bucketUrl,
    bucketName: bucketName,
    items: filteredItems.map((item) => ({
      key: item.key,
      size: item.size,
      lastModified: item.lastModified
    })),
    exportedAt: new Date().toISOString()
  };
  const filename = `${bucketName || 'bucket'}-export.json`;
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json'
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

function exportCsvData() {
  if (filteredItems.length === 0) return;
  const headers = ['Key', 'Size (Bytes)', 'Last Modified'];
  const rows = filteredItems.map((item) => [
    item.key,
    item.size,
    item.lastModified
  ]);

  const csvContent = [
    headers.map((h) => `"${h.replace(/"/g, '""')}"`).join(','),
    ...rows.map((row) =>
      row.map((val) => `"${String(val).replace(/"/g, '""')}"`).join(',')
    )
  ].join('\n');

  const filename = `${bucketName || 'bucket'}-export.csv`;
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

function exportWgetData() {
  if (filteredItems.length === 0) return;
  const urls = filteredItems.map((item) =>
    buildDownloadUrl(window.bucketBaseUrl, item.key)
  );
  const textContent = urls.join('\n');
  const filename = `${bucketName || 'bucket'}-urls.txt`;
  const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

// Load saved reports list from IndexedDB
async function loadSavedReportsList() {
  const urls = await listBuckets();
  const select = document.getElementById('savedReportsSelect');

  // Clear existing options (except first placeholder)
  while (select.options.length > 1) {
    select.remove(1);
  }

  // Populate with saved bucket URLs
  for (const url of urls) {
    const cached = await getBucket(url);
    const option = document.createElement('option');
    option.value = url;
    option.textContent = cached?.bucketName || url;
    select.appendChild(option);
  }

  // Show/hide the saved reports section based on whether we have saved reports
  const savedReportsContainer = document.getElementById(
    'savedReportsContainer'
  );
  if (urls.length > 0) {
    savedReportsContainer.classList.remove('hidden');
  } else {
    savedReportsContainer.classList.add('hidden');
  }
}

// Handle saved report selection
async function handleSavedReportChange(e) {
  const url = e.target.value;
  if (!url) {
    document.getElementById('deleteSavedReport').classList.add('hidden');
    return;
  }

  // Show delete button when a report is selected
  document.getElementById('deleteSavedReport').classList.remove('hidden');

  // Load the selected cached bucket
  await loadCachedBucket(url);
}

// Handle delete saved report
async function handleDeleteSavedReport() {
  const select = document.getElementById('savedReportsSelect');
  const url = select.value;

  if (!url) return;

  const cached = await getBucket(url);
  const name = cached?.bucketName || url;

  if (!confirm(`Delete saved report "${name}"?`)) {
    return;
  }

  await deleteBucket(url);

  // Reset selection
  select.value = '';
  document.getElementById('deleteSavedReport').classList.add('hidden');

  // Refresh list
  await loadSavedReportsList();
}

init();
