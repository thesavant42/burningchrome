import JSZip from 'jszip/dist/jszip.min.js';
import { storage } from './lib/storage.js';
import {
  parseBucketXml,
  buildDownloadUrl,
  formatSize,
  formatDate,
  escapeHtml,
  cleanBucketUrl
} from './lib/bucket-parser.js';
import { renderPaginationControls } from './lib/bucket-pagination.js';
import {
  saveBucket,
  getBucket,
  deleteBucket,
  listBuckets
} from './lib/db.js';

let bucketName = '';
let bucketUrl = ''; // Current bucket URL (for saving)
let allItems = []; // All parsed items from XML
let filteredItems = []; // Items after search filter
let currentPage = 1;
const ROWS_PER_PAGE = 50;

let sortField = 'key';
let sortAsc = true;

// Directory stats sort mode: 'count', 'size', or 'alpha'
let dirSortMode = 'count';

// View mode: when true, we're viewing cached data
let _viewMode = false;
let currentTab = 'table';

function updateDataDependentControls() {
  const hasBucketData = allItems.length > 0;
  const searchInput = document.getElementById('searchInput');
  const viewTabs = document.getElementById('viewTabs');
  const tableBtn = document.getElementById('viewTableBtn');
  const treeBtn = document.getElementById('viewTreeBtn');
  const statsBtn = document.getElementById('viewStatsBtn');
  const exportContainer = document.querySelector('.export-dropdown-container');
  const exportSelect = document.getElementById('exportFormatSelect');

  if (searchInput) {
    searchInput.disabled = !hasBucketData;
  }
  if (viewTabs) {
    viewTabs.classList.remove('hidden');
  }
  if (tableBtn) {
    tableBtn.disabled = false;
  }
  if (treeBtn) {
    treeBtn.disabled = !hasBucketData;
  }
  if (statsBtn) {
    statsBtn.disabled = !hasBucketData;
  }
  if (exportContainer) {
    exportContainer.classList.remove('hidden');
  }
  if (exportSelect) {
    exportSelect.disabled = !hasBucketData;
  }
}

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
    const navTargets = {
      navDomains: `domains.html${projectParam}`,
      navPoi: `poi.html${projectParam}`,
      navGithub: `github.html${projectParam}`,
      navDockerhub: `dockerhub.html${projectParam}`,
      navCreds: `creds.html${projectParam}`
    };

    Object.entries(navTargets).forEach(([id, href]) => {
      const el = document.getElementById(id);
      if (el) el.href = href;
    });
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

  // Render the empty structured state if no data loaded
  if (allItems.length === 0) {
    renderTable();
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

async function fetchBucketFromUrl(url, forceFetch = false) {
  // Clear previous state
  hideError();

  url = cleanBucketUrl(url);

  // Check cache first if not forced
  if (!forceFetch) {
    const cached = await getBucket(url);
    if (cached && cached.items && cached.items.length > 0) {
      console.log(`[DEBUG] Found cached bucket data for: ${url}`);
      await loadCachedBucket(url);

      const loadingStatus = document.getElementById('loadingStatus');
      if (loadingStatus) {
        loadingStatus.innerHTML = `Loaded from cache. <button id="forceRefetchBtn" class="btn-action btn-loading-status">Refetch</button>`;
        const refetchBtn = document.getElementById('forceRefetchBtn');
        if (refetchBtn) {
          refetchBtn.addEventListener('click', () => {
            fetchBucketFromUrl(url, true);
          });
        }
      }
      return;
    }
  }

  document.getElementById('loadingStatus').textContent = 'Fetching...';

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
      await loadBucketXml(url, response.xml);
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

async function loadBucketXml(url, xmlText, isImported = false) {
  currentTab = 'table';
  const tableBtn = document.getElementById('viewTableBtn');
  const treeBtn = document.getElementById('viewTreeBtn');
  const statsBtn = document.getElementById('viewStatsBtn');
  const viewTabsContainer = document.getElementById('viewTabs');
  const statsContainer = document.getElementById('statsContainer');
  const treeContainer = document.getElementById('treeContainer');
  if (tableBtn) tableBtn.classList.add('active');
  if (treeBtn) treeBtn.classList.remove('active');
  if (statsBtn) statsBtn.classList.remove('active');
  if (viewTabsContainer) viewTabsContainer.classList.remove('hidden');
  if (statsContainer) statsContainer.classList.add('hidden');
  if (treeContainer) treeContainer.classList.add('hidden');

  // Clean initial URL
  url = cleanBucketUrl(url);

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
    loadingStatusEl.innerHTML = `${msg} <button id="stopFetchBtn" class="btn-action btn-loading-status">Stop</button>`;
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

    // Update global state and item count without re-rendering the table
    // (rendering during fetch causes scroll to reset)
    allItems = allItemsList;
    filteredItems = [...allItems];
    sortItems();
    currentPage = 1;

    document.getElementById('bucketStats').textContent =
      ` | ${allItemsList.length} items fetched`;

    if (isImported) {
      console.log('[DEBUG] XML was imported locally, stopping next page fetch.');
      hasMore = false;
      break;
    }

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

  // Now render the complete table with all fetched items
  applyFilter();

  // Auto-save to IndexedDB on fetch
  await saveBucketToCache();
}

// Load cached bucket data from IndexedDB (view mode)
async function loadCachedBucket(url) {
  currentTab = 'table';
  const tableBtn = document.getElementById('viewTableBtn');
  const treeBtn = document.getElementById('viewTreeBtn');
  const statsBtn = document.getElementById('viewStatsBtn');
  const viewTabsContainer = document.getElementById('viewTabs');
  const statsContainer = document.getElementById('statsContainer');
  const treeContainer = document.getElementById('treeContainer');
  if (tableBtn) tableBtn.classList.add('active');
  if (treeBtn) treeBtn.classList.remove('active');
  if (statsBtn) statsBtn.classList.remove('active');
  if (viewTabsContainer) viewTabsContainer.classList.remove('hidden');
  if (statsContainer) statsContainer.classList.add('hidden');
  if (treeContainer) treeContainer.classList.add('hidden');

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

  sortItems();

  // Dynamically inject virtual folder row if search query represents a folder prefix
  const trimmedQuery = query.trim();
  if (trimmedQuery && filteredItems.length > 0) {
    let dirPrefix = trimmedQuery;
    if (!dirPrefix.endsWith('/')) {
      dirPrefix += '/';
    }

    const firstMatch = filteredItems[0].key;
    const idx = firstMatch.toLowerCase().indexOf(dirPrefix.toLowerCase());
    if (idx === 0) {
      const actualPrefix = firstMatch.substring(0, dirPrefix.length);
      const hasExplicitDir = filteredItems.some(
        (item) => item.key === actualPrefix
      );
      if (!hasExplicitDir) {
        filteredItems.unshift({
          id: 'virtual-dir',
          key: actualPrefix,
          size: 0,
          lastModified: ''
        });
      }
    }
  }

  if (!preservePage) {
    currentPage = 1;
  }
  renderTable();
}

function sortItems() {
  if (!sortField) return;

  filteredItems.sort((a, b) => {
    let valA, valB;

    if (sortField === 'key') {
      valA = a.key.toLowerCase();
      valB = b.key.toLowerCase();
    } else if (sortField === 'size') {
      valA = a.size;
      valB = b.size;
    } else if (sortField === 'lastModified') {
      valA = a.lastModified ? new Date(a.lastModified).getTime() : 0;
      valB = b.lastModified ? new Date(b.lastModified).getTime() : 0;
    }

    if (valA < valB) return sortAsc ? -1 : 1;
    if (valA > valB) return sortAsc ? 1 : -1;
    return 0;
  });
}

function handleSort(field) {
  if (sortField === field) {
    sortAsc = !sortAsc;
  } else {
    sortField = field;
    sortAsc = true;
  }
  applyFilter(true);
}

function updateSortHeadersUI() {
  const headers = {
    key: document.getElementById('thKey'),
    size: document.getElementById('thSize'),
    lastModified: document.getElementById('thLastModified')
  };

  for (const [field, el] of Object.entries(headers)) {
    if (!el) continue;
    el.classList.remove('sort-asc', 'sort-desc');
    if (field === sortField) {
      el.classList.add(sortAsc ? 'sort-asc' : 'sort-desc');
    }
  }
}

async function base64ToUint8Array(base64) {
  const res = await fetch(`data:application/octet-stream;base64,${base64}`);
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

async function downloadDirectory(dirKey) {
  const loadingStatusEl = document.getElementById('loadingStatus');
  loadingStatusEl.textContent = 'Scanning directory...';

  // Find all subfiles
  const subFiles = allItems.filter(
    (item) => item.key.startsWith(dirKey) && item.key !== dirKey
  );

  if (subFiles.length === 0) {
    alert('This directory contains no files.');
    loadingStatusEl.textContent = '';
    return;
  }

  const segments = dirKey.split('/').filter(Boolean);
  const folderName =
    segments.length > 0 ? segments[segments.length - 1] : 'archive';
  const zipFilename = `${folderName}.zip`;

  const limit = 5;
  const results = [];
  const queue = [...subFiles];

  let completedCount = 0;
  const totalCount = subFiles.length;
  let isCancelled = false;

  loadingStatusEl.innerHTML = `Downloading <span id="zipProgress" class="progress-span">0/${totalCount}</span> files... <button id="stopZipBtn" class="btn-action btn-loading-status">Cancel</button>`;

  const stopBtn = document.getElementById('stopZipBtn');
  if (stopBtn) {
    stopBtn.addEventListener('click', () => {
      isCancelled = true;
      loadingStatusEl.textContent = 'Zip download cancelled.';
      setTimeout(() => {
        if (loadingStatusEl.textContent === 'Zip download cancelled.') {
          loadingStatusEl.textContent = '';
        }
      }, 3000);
    });
  }

  async function downloadWorker() {
    while (queue.length > 0 && !isCancelled) {
      const item = queue.shift();
      try {
        const url = buildDownloadUrl(window.bucketBaseUrl, item.key);
        const response = await chrome.runtime.sendMessage({
          type: 'fetch-file-base64',
          url: url
        });

        if (response.error) {
          throw new Error(response.error);
        }

        const data = await base64ToUint8Array(response.base64);
        results.push({ key: item.key, data });
      } catch (err) {
        console.error(`Failed to download ${item.key}:`, err);
      } finally {
        completedCount++;
        if (!isCancelled) {
          const progressSpan = document.getElementById('zipProgress');
          if (progressSpan) {
            progressSpan.textContent = `${completedCount}/${totalCount}`;
          }
        }
      }
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(limit, subFiles.length); i++) {
    workers.push(downloadWorker());
  }
  await Promise.all(workers);

  if (isCancelled) {
    return;
  }

  loadingStatusEl.textContent = 'Generating ZIP archive...';

  try {
    const zip = new JSZip();
    const parentPathLength = dirKey.lastIndexOf('/', dirKey.length - 2) + 1;

    for (const result of results) {
      const relativePath = result.key.substring(parentPathLength);
      zip.file(relativePath, result.data);
    }

    const content = await zip.generateAsync({ type: 'blob' });
    loadingStatusEl.textContent = 'Downloading...';

    const a = document.createElement('a');
    a.href = URL.createObjectURL(content);
    a.download = zipFilename;
    a.click();

    loadingStatusEl.textContent = 'Download complete.';
  } catch (err) {
    console.error('Failed to create ZIP:', err);
    loadingStatusEl.textContent = 'Failed to create ZIP archive.';
  }

  setTimeout(() => {
    if (
      loadingStatusEl.textContent === 'Download complete.' ||
      loadingStatusEl.textContent === 'Failed to create ZIP archive.'
    ) {
      loadingStatusEl.textContent = '';
    }
  }, 3000);
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
  const viewTabs = document.getElementById('viewTabs');
  const tbody = document.getElementById('bucketBody');
  const exportDropdown = document.querySelector('.export-dropdown-container');
  const pagTop = document.getElementById('paginationTop');
  const pagBot = document.getElementById('paginationBottom');
  const pagTopRow = document.getElementById('paginationTopRow');

  updateDataDependentControls();

  if (emptyState) {
    emptyState.classList.add('hidden');
  }
  if (viewTabs) {
    viewTabs.classList.remove('hidden');
  }
  if (exportDropdown) {
    exportDropdown.classList.remove('hidden');
  }

  if (allItems.length === 0) {
    table.classList.remove('hidden');
    tbody.innerHTML = `
      <tr class="table-empty-row">
        <td colspan="4" class="table-empty-state">
          No bucket loaded yet. Enter a bucket URL above or open a saved report to populate this view.
        </td>
      </tr>
    `;
    if (pagTop) pagTop.innerHTML = '';
    if (pagBot) pagBot.innerHTML = '';
    if (pagTopRow) pagTopRow.classList.add('hidden');
    return;
  }

  if (currentTab === 'table') {
    table.classList.remove('hidden');
  } else {
    // Hide table for tree and stats views
    table.classList.add('hidden');
  }

  // Build table rows
  tbody.innerHTML = '';

  if (currentTab === 'table' && filteredItems.length === 0) {
    table.classList.remove('hidden');
    tbody.innerHTML = `
      <tr class="table-empty-row">
        <td colspan="4" class="table-empty-state">
          No bucket items match the current filter.
        </td>
      </tr>
    `;
    if (pagTop) pagTop.innerHTML = '';
    if (pagBot) pagBot.innerHTML = '';
    if (pagTopRow) pagTopRow.classList.add('hidden');
    updateSortHeadersUI();
    return;
  }

  if (currentTab === 'stats') {
    renderStats();
    // clear pagination controls when viewing stats
    if (pagTop) pagTop.innerHTML = '';
    if (pagBot) pagBot.innerHTML = '';
    if (pagTopRow) pagTopRow.classList.add('hidden');
  } else {
    pageItems.forEach((item) => {
      const tr = document.createElement('tr');
      const isDir = item.key.endsWith('/');
      const downloadUrl = buildDownloadUrl(window.bucketBaseUrl, item.key);

      let keyHtml;
      let actionHtml;

      if (isDir) {
        keyHtml = `<a href="#" class="directory-link" data-key="${escapeHtml(item.key)}">📁 ${escapeHtml(item.key)}</a>`;
        actionHtml = `<a href="#" class="btn-action bucket-action-btn directory-zip-btn" data-key="${escapeHtml(item.key)}">ZIP</a>`;
      } else {
        keyHtml = `<a href="${downloadUrl}" target="_blank">${escapeHtml(item.key)}</a>`;
        actionHtml = `<a href="${downloadUrl}" target="_blank" class="btn-action bucket-action-btn">Open</a>`;
      }

      tr.innerHTML = `
        <td class="col-url">${keyHtml}</td>
        <td>${isDir ? '-' : formatSize(item.size)}</td>
        <td>${formatDate(item.lastModified)}</td>
        <td class="col-actions">${actionHtml}</td>
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
    // Show the centered pagination top row
    // Show the centered pagination top row
    if (pagTopRow) pagTopRow.classList.remove('hidden');

    updateSortHeadersUI();
  }
}

function calculateStats(items) {
  const files = items.filter(
    (item) => item.id !== 'virtual-dir' && !item.key.endsWith('/')
  );

  let totalSize = 0;
  files.forEach((f) => {
    totalSize += f.size || 0;
  });

  const totalFiles = files.length;

  if (totalFiles === 0) {
    return {
      totalFiles: 0,
      totalSize: 0,
      bySize: [],
      byExtension: [],
      bySizeRange: [],
      byModifiedDate: [],
      byDirectoryCount: [],
      byDirectorySize: [],
      earliestDate: 'N/A',
      latestDate: 'N/A'
    };
  }

  // Largest Files
  const bySize = [...files].sort((a, b) => b.size - a.size).slice(0, 10);

  // Extensions
  const extMap = {};
  files.forEach((file) => {
    const parts = file.key.split('/');
    const filename = parts[parts.length - 1];
    const lastDot = filename.lastIndexOf('.');
    let ext = '(no extension)';
    if (lastDot > 0 && lastDot < filename.length - 1) {
      ext = filename.substring(lastDot + 1).toLowerCase();
    }
    if (!extMap[ext]) {
      extMap[ext] = { count: 0, size: 0 };
    }
    extMap[ext].count++;
    extMap[ext].size += file.size || 0;
  });

  const byExtension = Object.entries(extMap)
    .map(([ext, data]) => ({
      ext,
      count: data.count,
      countPercent: (data.count / totalFiles) * 100,
      size: data.size,
      sizePercent: totalSize > 0 ? (data.size / totalSize) * 100 : 0
    }))
    .sort((a, b) => b.count - a.count);

  // Modified Dates
  const dateMap = {};
  let earliest = null;
  let latest = null;

  files.forEach((file) => {
    if (!file.lastModified) return;
    const d = new Date(file.lastModified);
    if (isNaN(d.getTime())) return;

    const time = d.getTime();
    if (earliest === null || time < earliest) earliest = time;
    if (latest === null || time > latest) latest = time;

    const yyyymm = file.lastModified.substring(0, 7); // "YYYY-MM"
    if (!dateMap[yyyymm]) {
      dateMap[yyyymm] = 0;
    }
    dateMap[yyyymm]++;
  });

  const byModifiedDate = Object.entries(dateMap)
    .map(([dateStr, count]) => ({
      dateStr,
      count
    }))
    .sort((a, b) => a.dateStr.localeCompare(b.dateStr));

  // Directories footprint
  const dirMap = {};
  files.forEach((file) => {
    const lastSlash = file.key.lastIndexOf('/');
    let dir = '/ (root)';
    if (lastSlash > 0) {
      dir = file.key.substring(0, lastSlash + 1);
    } else if (lastSlash === 0) {
      dir = '/';
    }
    if (!dirMap[dir]) {
      dirMap[dir] = { count: 0, size: 0 };
    }
    dirMap[dir].count++;
    dirMap[dir].size += file.size || 0;
  });

  const byDirectoryCount = Object.entries(dirMap)
    .map(([dir, data]) => ({
      dir,
      count: data.count,
      countPercent: (data.count / totalFiles) * 100
    }))
    .sort((a, b) => {
      if (dirSortMode === 'alpha') return a.dir.localeCompare(b.dir);
      return b.count - a.count;
    });

  return {
    totalFiles,
    totalSize,
    bySize,
    byExtension,
    byModifiedDate,
    byDirectoryCount,
    earliestDate: earliest
      ? formatDate(new Date(earliest).toISOString())
      : 'N/A',
    latestDate: latest ? formatDate(new Date(latest).toISOString()) : 'N/A'
  };
}

function renderStats() {
  const container = document.getElementById('statsContainer');
  if (!container) return;

  if (filteredItems.length === 0) {
    container.innerHTML =
      '<div class="stats stats-empty">No data available matching your filters.</div>';
    return;
  }

  const stats = calculateStats(filteredItems);

  // Build sort mode toggle buttons
  const buildDirSortButtons = (currentMode, sectionId) => {
    const modes = [
      { key: 'alpha', label: 'A-Z' },
      { key: 'count', label: 'Count' },
      { key: 'size', label: 'Size' }
    ];
    return modes.map(m => 
      `<button class="dir-sort-btn${m.key === currentMode ? ' active' : ''}" data-mode="${m.key}" data-section="${sectionId}">${m.label}</button>`
    ).join('');
  };

  let extRowsHtml = stats.byExtension
    .map(
      (item) => `
    <tr>
      <td><code class="clickable-stat clickable-ext" data-ext="${escapeHtml(item.ext)}">.${escapeHtml(item.ext)}</code></td>
      <td>${item.count.toLocaleString()} (${item.countPercent.toFixed(1)}%)
        <div class="stats-bar-container"><div class="stats-bar-fill count" style="width: ${item.countPercent}%"></div></div>
      </td>
      <td>${formatSize(item.size)} (${item.sizePercent.toFixed(1)}%)
        <div class="stats-bar-container"><div class="stats-bar-fill size" style="width: ${item.sizePercent}%"></div></div>
      </td>
    </tr>
  `
    )
    .join('');

  const timelineRowsHtml = stats.byModifiedDate
    .map((item) => {
      const percent =
        stats.totalFiles > 0 ? (item.count / stats.totalFiles) * 100 : 0;
      return `
      <tr>
        <td><code>${escapeHtml(item.dateStr)}</code></td>
        <td>${item.count.toLocaleString()} (${percent.toFixed(1)}%)
          <div class="stats-bar-container"><div class="stats-bar-fill count" style="width: ${percent}%"></div></div>
        </td>
      </tr>
    `;
    })
    .join('');

  const dirCountRowsHtml = stats.byDirectoryCount
    .map(
      (item) => `
    <tr>
      <td class="clickable-stat clickable-dir stats-cell-wrap" data-dir="${escapeHtml(item.dir)}"><code>${escapeHtml(item.dir)}</code></td>
      <td>${item.count.toLocaleString()} (${item.countPercent.toFixed(1)}%)
        <div class="stats-bar-container"><div class="stats-bar-fill count" style="width: ${item.countPercent}%"></div></div>
      </td>
    </tr>
  `
    )
    .join('');

  const largestFilesRowsHtml = stats.bySize
    .map((item) => {
      const downloadUrl = buildDownloadUrl(window.bucketBaseUrl, item.key);
      return `
      <tr>
        <td style="word-break: break-all;"><a href="${downloadUrl}" target="_blank">${escapeHtml(item.key)}</a></td>
        <td>${formatSize(item.size)}</td>
        <td>${formatDate(item.lastModified)}</td>
        <td>
          <a href="${downloadUrl}" target="_blank" class="btn-action">Open</a>
          <button class="btn-action btn-locate locate-btn" data-key="${escapeHtml(item.key)}">Show in List</button>
        </td>
      </tr>
    `;
    })
    .join('');

  container.innerHTML = `
    <div class="stats-summary-grid">
      <div class="stats-card summary">
        <h4>Files Observed</h4>
        <div class="value">${stats.totalFiles.toLocaleString()}</div>
        <div class="sub-value">Real file objects</div>
      </div>
      <div class="stats-card summary">
        <h4>Total Footprint</h4>
        <div class="value">${formatSize(stats.totalSize)}</div>
        <div class="sub-value">${stats.totalSize.toLocaleString()} bytes</div>
      </div>
      <div class="stats-card summary">
        <h4>Oldest Modification</h4>
        <div class="value summary-value-large">${stats.earliestDate}</div>
        <div class="sub-value">Earliest file timestamp</div>
      </div>
      <div class="stats-card summary">
        <h4>Latest Modification</h4>
        <div class="value summary-value-large">${stats.latestDate}</div>
        <div class="sub-value">Most recent update</div>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stats-card full-width">
        <h3>Top 10 Largest Files</h3>
        <table class="stats-table">
          <thead>
            <tr>
              <th class="stats-col-key">Key</th>
              <th class="stats-col-size">Size</th>
              <th class="stats-col-date">Last Modified</th>
              <th class="stats-col-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${largestFilesRowsHtml || '<tr><td colspan="4">No files found</td></tr>'}
          </tbody>
        </table>
      </div>

      <div class="stats-card">
        <h3>By Extension <span class="stats-card-hint">(click ext to filter)</span></h3>
        <div class="stats-card-scroll">
          <table class="stats-table">
            <thead>
              <tr>
                <th class="stats-col-ext">Ext</th>
                <th class="stats-col-count">Count</th>
                <th class="stats-col-total-size">Total Size</th>
              </tr>
            </thead>
            <tbody>
              ${extRowsHtml || '<tr><td colspan="3">No files found</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <div class="stats-card">
        <h3>Modification Timeline</h3>
        <div class="stats-card-scroll">
          <table class="stats-table">
            <thead>
              <tr>
                <th class="stats-col-date-str">Year-Month</th>
                <th class="stats-col-files-modified">Files Modified</th>
              </tr>
            </thead>
            <tbody>
              ${timelineRowsHtml || '<tr><td colspan="2">No dates found</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <div class="stats-card">
        <h3>All Directories <span class="stats-card-hint">(click path to filter)</span> <span class="dir-sort-buttons" data-section="dirCount">${buildDirSortButtons(dirSortMode, 'dirCount')}</span></h3>
        <div class="stats-card-scroll">
          <table class="stats-table">
            <thead>
              <tr>
                <th class="stats-col-dir">Directory</th>
                <th class="stats-col-count">Files</th>
              </tr>
            </thead>
            <tbody>
              ${dirCountRowsHtml || '<tr><td colspan="2">No directories found</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function filterAndShow(queryText) {
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.value = queryText;
  }
  switchTab('table');
  applyFilter();
}

function switchTab(tabName) {
  currentTab = tabName;

  const tableBtn = document.getElementById('viewTableBtn');
  const treeBtn = document.getElementById('viewTreeBtn');
  const statsBtn = document.getElementById('viewStatsBtn');
  const viewTabsContainer = document.getElementById('viewTabs');
  const statsContainer = document.getElementById('statsContainer');
  const treeContainer = document.getElementById('treeContainer');

  if (tabName === 'table') {
    if (tableBtn) tableBtn.classList.add('active');
    if (treeBtn) treeBtn.classList.remove('active');
    if (statsBtn) statsBtn.classList.remove('active');
    if (viewTabsContainer) viewTabsContainer.classList.remove('hidden');
    if (statsContainer) statsContainer.classList.add('hidden');
    if (treeContainer) treeContainer.classList.add('hidden');
  } else if (tabName === 'tree') {
    if (tableBtn) tableBtn.classList.remove('active');
    if (treeBtn) treeBtn.classList.add('active');
    if (statsBtn) statsBtn.classList.remove('active');
    if (viewTabsContainer) viewTabsContainer.classList.remove('hidden');
    if (statsContainer) statsContainer.classList.add('hidden');
    if (treeContainer) treeContainer.classList.remove('hidden');
    renderTreeView();
  } else if (tabName === 'stats') {
    if (tableBtn) tableBtn.classList.remove('active');
    if (treeBtn) treeBtn.classList.remove('active');
    if (statsBtn) statsBtn.classList.add('active');
    if (viewTabsContainer) viewTabsContainer.classList.remove('hidden');
    if (statsContainer) statsContainer.classList.remove('hidden');
    if (treeContainer) treeContainer.classList.add('hidden');
  }

  renderTable();
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
  if (allItems.length === 0) {
    renderTable();
  }
}

function hideError() {
  document.getElementById('errorState').classList.add('hidden');
}

function setupEventListeners() {
  const importXmlBtn = document.getElementById('importXmlBtn');
  const importXmlFile = document.getElementById('importXmlFile');
  if (importXmlBtn && importXmlFile) {
    importXmlBtn.addEventListener('click', () => {
      importXmlFile.click();
    });

    importXmlFile.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (event) => {
        const xmlText = event.target.result;
        const parsed = parseBucketXml(xmlText);
        if (parsed.error) {
          showError(`Failed to parse XML: ${parsed.error}`);
          return;
        }

        let url = document.getElementById('bucketUrlInput').value.trim();
        if (!url) {
          const promptVal = prompt(
            `Enter the base URL for bucket "${parsed.bucketName || 'imported'}" (optional, used for file download links):`,
            `https://${parsed.bucketName || 'bucket.s3.amazonaws.com'}`
          );
          if (promptVal === null) return; // User cancelled
          url = promptVal.trim();
        }

        if (!url) {
          url = `https://${parsed.bucketName || 'imported-bucket'}`;
        }

        e.target.value = ''; // Clear input
        await loadBucketXml(url, xmlText, true);
      };
      reader.readAsText(file);
    });
  }

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

  // Export dropdown
  document
    .getElementById('exportFormatSelect')
    .addEventListener('change', (e) => {
      const format = e.target.value;
      if (format === 'json') exportJsonData();
      else if (format === 'csv') exportCsvData();
      else if (format === 'wget') exportWgetData();
      else if (format === 'zip') exportZipData();
      e.target.value = ''; // Reset dropdown
    });

  // Export all saved reports
  document
    .getElementById('exportAllReports')
    .addEventListener('click', exportAllReports);

  // Sorting header click events
  ['thKey', 'thSize', 'thLastModified'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('click', () => {
        const field = el.dataset.sort;
        handleSort(field);
      });
    }
  });

  // Directory download delegation
  const tbody = document.getElementById('bucketBody');
  if (tbody) {
    tbody.addEventListener('click', (e) => {
      const target = e.target;
      if (
        target.classList.contains('directory-link') ||
        target.classList.contains('directory-zip-btn')
      ) {
        e.preventDefault();
        const key = target.dataset.key;
        downloadDirectory(key);
      }
    });
  }

  // View tabs click events
  const tableBtn = document.getElementById('viewTableBtn');
  const treeBtn = document.getElementById('viewTreeBtn');
  const statsBtn = document.getElementById('viewStatsBtn');
  if (tableBtn && statsBtn) {
    tableBtn.addEventListener('click', (e) => {
      e.preventDefault();
      switchTab('table');
    });
    if (treeBtn) {
      treeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        switchTab('tree');
      });
    }
    statsBtn.addEventListener('click', (e) => {
      e.preventDefault();
      switchTab('stats');
    });
  }

  // Stats container click events for interactive stats filtering
  const statsContainer = document.getElementById('statsContainer');
  if (statsContainer) {
    statsContainer.addEventListener('click', (e) => {
      const target = e.target;

      // Click on Locate file button
      if (target.classList.contains('locate-btn')) {
        const key = target.dataset.key;
        if (key) {
          filterAndShow(key);
        }
      }

      // Click on clickable extension
      const clickableExt = target.closest('.clickable-ext');
      if (clickableExt) {
        const ext = clickableExt.dataset.ext;
        if (ext) {
          if (ext === '(no extension)') {
            filterAndShow('');
          } else {
            filterAndShow(`.${ext}`);
          }
        }
      }

      // Click on clickable directory
      const clickableDir = target.closest('.clickable-dir');
      if (clickableDir) {
        const dir = clickableDir.dataset.dir;
        if (dir) {
          if (dir === '/ (root)' || dir === '/') {
            filterAndShow('');
          } else {
            filterAndShow(dir);
          }
        }
      }

      // Click on directory sort mode button
      const dirSortBtn = target.closest('.dir-sort-btn');
      if (dirSortBtn) {
        const mode = dirSortBtn.dataset.mode;
        if (mode) {
          dirSortMode = mode;
          renderStats();
        }
      }
    });
  }
}

function exportJsonData() {
  const itemsToExport = filteredItems.filter(
    (item) => item.id !== 'virtual-dir'
  );
  if (itemsToExport.length === 0) return;
  const data = {
    url: bucketUrl,
    bucketName: bucketName,
    items: itemsToExport.map((item) => ({
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
  const itemsToExport = filteredItems.filter(
    (item) => item.id !== 'virtual-dir'
  );
  if (itemsToExport.length === 0) return;
  const headers = ['Key', 'Size (Bytes)', 'Last Modified'];
  const rows = itemsToExport.map((item) => [
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
  const itemsToExport = filteredItems.filter(
    (item) => item.id !== 'virtual-dir'
  );
  if (itemsToExport.length === 0) return;
  const urls = itemsToExport.map((item) =>
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

async function exportZipData() {
  if (filteredItems.length === 0) return;

  const loadingStatusEl = document.getElementById('loadingStatus');
  loadingStatusEl.textContent = 'Preparing ZIP download...';

  // Determine zip filename based on search term or fallback to bucketName
  const searchTerm = document.getElementById('searchInput').value.trim();
  const zipFilename = searchTerm
    ? `${bucketName || 'bucket'}-${searchTerm.replace(/[^a-zA-Z0-9_-]/g, '_')}.zip`
    : `${bucketName || 'bucket'}-export.zip`;

  const filesToZip = filteredItems.filter((item) => !item.key.endsWith('/'));

  if (filesToZip.length === 0) {
    alert('No files available to ZIP (directory placeholders are ignored).');
    loadingStatusEl.textContent = '';
    return;
  }

  const limit = 5;
  const results = [];
  const queue = [...filesToZip];

  let completedCount = 0;
  const totalCount = filesToZip.length;
  let isCancelled = false;

  loadingStatusEl.innerHTML = `Downloading <span id="zipProgress" class="progress-span">0/${totalCount}</span> files... <button id="stopZipBtn" class="btn-action btn-loading-status">Cancel</button>`;

  const stopBtn = document.getElementById('stopZipBtn');
  if (stopBtn) {
    stopBtn.addEventListener('click', () => {
      isCancelled = true;
      loadingStatusEl.textContent = 'Zip download cancelled.';
      setTimeout(() => {
        if (loadingStatusEl.textContent === 'Zip download cancelled.') {
          loadingStatusEl.textContent = '';
        }
      }, 3000);
    });
  }

  async function downloadWorker() {
    while (queue.length > 0 && !isCancelled) {
      const item = queue.shift();
      try {
        const url = buildDownloadUrl(window.bucketBaseUrl, item.key);
        const response = await chrome.runtime.sendMessage({
          type: 'fetch-file-base64',
          url: url
        });

        if (response.error) {
          throw new Error(response.error);
        }

        const data = await base64ToUint8Array(response.base64);
        results.push({ key: item.key, data });
      } catch (err) {
        console.error(`Failed to download ${item.key}:`, err);
      } finally {
        completedCount++;
        if (!isCancelled) {
          const progressSpan = document.getElementById('zipProgress');
          if (progressSpan) {
            progressSpan.textContent = `${completedCount}/${totalCount}`;
          }
        }
      }
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(limit, filesToZip.length); i++) {
    workers.push(downloadWorker());
  }
  await Promise.all(workers);

  if (isCancelled) {
    return;
  }

  loadingStatusEl.textContent = 'Generating ZIP archive...';

  try {
    const zip = new JSZip();

    for (const result of results) {
      zip.file(result.key, result.data);
    }

    const content = await zip.generateAsync({ type: 'blob' });
    loadingStatusEl.textContent = 'Downloading...';

    const a = document.createElement('a');
    a.href = URL.createObjectURL(content);
    a.download = zipFilename;
    a.click();

    loadingStatusEl.textContent = 'Download complete.';
  } catch (err) {
    console.error('Failed to create ZIP:', err);
    loadingStatusEl.textContent = 'Failed to create ZIP archive.';
  }

  setTimeout(() => {
    if (
      loadingStatusEl.textContent === 'Download complete.' ||
      loadingStatusEl.textContent === 'Failed to create ZIP archive.'
    ) {
      loadingStatusEl.textContent = '';
    }
  }, 3000);
}

// Load saved reports list from IndexedDB
async function loadSavedReportsList() {
  const select = document.getElementById('savedReportsSelect');
  const savedReportsContainer = document.getElementById(
    'savedReportsContainer'
  );
  const exportAllBtn = document.getElementById('exportAllReports');

  if (!select) {
    return;
  }

  if (savedReportsContainer) {
    savedReportsContainer.classList.remove('hidden');
  }

  // Clear existing options (except first placeholder)
  while (select.options.length > 1) {
    select.remove(1);
  }

  try {
    const urls = await listBuckets();

    // Populate with saved bucket URLs
    for (const url of urls) {
      const cached = await getBucket(url);
      const option = document.createElement('option');
      option.value = url;
      // Show bucket name + URL for easy identification
      option.textContent = `${cached?.bucketName || url} — ${url}`;
      select.appendChild(option);
    }

    select.disabled = urls.length === 0;
    if (exportAllBtn) {
      exportAllBtn.disabled = urls.length === 0;
    }
  } catch (err) {
    select.disabled = true;
    if (exportAllBtn) {
      exportAllBtn.disabled = true;
    }
    showError(`Failed to load saved bucket reports: ${err.message}`);
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

// Export all saved reports as a single JSON backup
async function exportAllReports() {
  const loadingStatusEl = document.getElementById('loadingStatus');
  const exportAllBtn = document.getElementById('exportAllReports');

  try {
    if (loadingStatusEl) {
      loadingStatusEl.textContent = 'Preparing backup...';
    }
    if (exportAllBtn) {
      exportAllBtn.disabled = true;
    }

    const urls = await listBuckets();
    if (urls.length === 0) {
      alert('No saved reports to export.');
      if (loadingStatusEl) {
        loadingStatusEl.textContent = '';
      }
      return;
    }

    const exportedAt = new Date().toISOString();
    const chunks = [
      `{"exportedAt":${JSON.stringify(exportedAt)},"totalReports":${urls.length},"reports":[`
    ];

    for (let i = 0; i < urls.length; i++) {
      const cached = await getBucket(urls[i]);
      if (!cached) {
        continue;
      }

      if (loadingStatusEl) {
        loadingStatusEl.textContent = `Preparing backup ${i + 1}/${urls.length}...`;
      }

      const report = {
        url: cached.url,
        bucketName: cached.bucketName,
        savedAt: cached.savedAt,
        itemCount: cached.items?.length || 0,
        items: cached.items
      };

      if (chunks.length > 1) {
        chunks.push(',');
      }
      chunks.push(JSON.stringify(report));

      // Yield periodically so large exports don't look hung.
      if ((i + 1) % 5 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    chunks.push(']}');

    const filename = `burningchrome-backup-${new Date().toISOString().split('T')[0]}.json`;
    const blob = new Blob(chunks, {
      type: 'application/json'
    });

    if (loadingStatusEl) {
      loadingStatusEl.textContent = 'Starting download...';
    }

    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);

    if (loadingStatusEl) {
      loadingStatusEl.textContent = 'Backup download started.';
      setTimeout(() => {
        if (loadingStatusEl.textContent === 'Backup download started.') {
          loadingStatusEl.textContent = '';
        }
      }, 3000);
    }
  } catch (err) {
    if (loadingStatusEl) {
      loadingStatusEl.textContent = `Backup failed: ${err.message}`;
    }
  } finally {
    if (exportAllBtn) {
      exportAllBtn.disabled = false;
    }
  }
}

// Build a tree structure from flat item list
function buildTreeStructure(items) {
  const root = { children: {}, files: [], dir: '', size: 0, fileCount: 0 };

  for (const item of items) {
    if (item.id === 'virtual-dir') continue;

    if (item.key.endsWith('/')) {
      // It's a directory marker
      const parts = item.key.split('/').filter(Boolean);
      let current = root;
      for (const part of parts) {
        if (!current.children[part]) {
          current.children[part] = { children: {}, files: [], dir: current.dir + part + '/', size: 0, fileCount: 0 };
        }
        current = current.children[part];
      }
    } else {
      // It's a file - add to appropriate directory
      const parts = item.key.split('/').filter(Boolean);
      let current = root;
      const ancestors = [root];
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (!current.children[part]) {
          current.children[part] = { children: {}, files: [], dir: current.dir + part + '/', size: 0, fileCount: 0 };
        }
        current = current.children[part];
        ancestors.push(current);
      }
      const fileName = parts[parts.length - 1];
      current.files.push({ name: fileName, ...item });
      for (const ancestor of ancestors) {
        ancestor.size += item.size || 0;
        ancestor.fileCount++;
      }
    }
  }

  return root;
}

// Get sorted directory keys (alphabetical)
function getSortedDirs(node) {
  return Object.keys(node.children).sort((a, b) => a.localeCompare(b));
}

// Render a single tree node (recursive)
function renderTreeNode(node, depth = 0, expandedDirs = new Set()) {
  const sortedDirs = getSortedDirs(node);
  const hasChildren = sortedDirs.length > 0;
  const hasFiles = node.files.length > 0;
  const isExpandable = hasChildren || hasFiles;
  const dirName = node.dir ? node.dir.replace(/\/$/, '') : 'Root';
  const isRoot = node.dir === '';
  
  // Determine if this node should be expanded
  const nodeKey = node.dir || '__root__';
  const isExpanded = expandedDirs.has(nodeKey);

  let html = '';
  const indent = depth * 20;
  const icon = isExpandable ? (isExpanded ? '📂' : '📁') : '📁';
  const toggle = isExpandable ? `<span class="tree-toggle" data-dir="${escapeHtml(nodeKey)}">${isExpanded ? '▼' : '▶'}</span>` : '<span class="tree-toggle-placeholder"></span>';

  html += `<div class="tree-node tree-row-indent" data-dir="${escapeHtml(nodeKey)}" style="--tree-indent: ${indent}px;">`;
  html += `<div class="tree-row">`;
  html += `${toggle}${icon} `;
  html += `<span class="tree-dir-name tree-dir-name-clickable" data-dir="${escapeHtml(nodeKey)}">${escapeHtml(isRoot ? '(root)' : dirName)}</span> `;
  html += `<span class="tree-meta">(${node.fileCount} files, ${formatSize(node.size)})</span>`;
  html += `</div>`;

  if (hasChildren && isExpanded) {
    html += '<div class="tree-children">';
    for (const childName of sortedDirs) {
      html += renderTreeNode(node.children[childName], depth + 1, expandedDirs);
    }
    html += '</div>';
  }

  if (hasFiles && isExpanded) {
    html += '<div class="tree-children">';
    const sortedFiles = [...node.files].sort((a, b) => a.name.localeCompare(b.name));
    for (const file of sortedFiles) {
      const downloadUrl = buildDownloadUrl(window.bucketBaseUrl, file.key);
      html += `<div class="tree-file tree-file-indent" style="--tree-file-indent: ${indent + 24}px;">`;
      html += `📄 <a href="${downloadUrl}" target="_blank">${escapeHtml(file.name)}</a> `;
      html += `<span class="tree-meta">${formatSize(file.size)}</span>`;
      html += `</div>`;
    }
    html += '</div>';
  }

  html += '</div>';
  return html;
}

// Track expanded directories
let expandedDirs = new Set();

function toggleDir(dirKey) {
  if (expandedDirs.has(dirKey)) {
    expandedDirs.delete(dirKey);
  } else {
    expandedDirs.add(dirKey);
  }
  renderTreeView();
}

function expandAll() {
  function collectDirs(node, prefix = '') {
    expandedDirs.add(prefix || '__root__');
    for (const childName of Object.keys(node.children)) {
      collectDirs(node.children[childName], prefix + childName + '/');
    }
  }
  const tree = buildTreeStructure(filteredItems);
  collectDirs(tree);
  renderTreeView();
}

function collapseAll() {
  expandedDirs.clear();
  renderTreeView();
}

// Render the tree view
function renderTreeView() {
  const container = document.getElementById('treeContainer');
  if (!container) return;

  if (filteredItems.length === 0) {
    container.innerHTML = '<div class="stats stats-empty">No data available matching your filters.</div>';
    return;
  }

  const tree = buildTreeStructure(filteredItems);
  const treeHtml = renderTreeNode(tree, 0, expandedDirs);

  container.innerHTML = `
    <div class="tree-toolbar">
      <button id="expandAllBtn" class="btn-tree-expand">Expand All</button>
      <button id="collapseAllBtn" class="btn-tree-collapse">Collapse All</button>
      <span class="tree-help-text">Click folders to filter. Click arrows to expand/collapse.</span>
    </div>
    <div class="tree-view">${treeHtml}</div>
  `;

  // Add event listeners for tree toggles
  container.querySelectorAll('.tree-toggle').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDir(el.dataset.dir);
    });
  });

  // Add event listeners for directory names (click to filter)
  container.querySelectorAll('.tree-dir-name').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const dir = el.dataset.dir;
      if (dir && dir !== '__root__') {
        filterAndShow(dir);
      }
    });
  });

  // Expand/Collapse all buttons
  const expandAllBtn = document.getElementById('expandAllBtn');
  const collapseAllBtn = document.getElementById('collapseAllBtn');
  if (expandAllBtn) expandAllBtn.addEventListener('click', expandAll);
  if (collapseAllBtn) collapseAllBtn.addEventListener('click', collapseAll);
}

init();
