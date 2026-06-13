import JSZip from 'jszip/dist/jszip.min.js';
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

let sortField = 'key';
let sortAsc = true;

// View mode: when true, we're viewing cached data
let _viewMode = false;
let currentTab = 'table';

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

async function fetchBucketFromUrl(url, forceFetch = false) {
  // Clear previous state
  hideError();

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

  // Check cache first if not forced
  if (!forceFetch) {
    const cached = await getBucket(url);
    if (cached && cached.items && cached.items.length > 0) {
      console.log(`[DEBUG] Found cached bucket data for: ${url}`);
      await loadCachedBucket(url);

      const loadingStatus = document.getElementById('loadingStatus');
      if (loadingStatus) {
        loadingStatus.innerHTML = `Loaded from cache. <button id="forceRefetchBtn" class="btn-action" style="cursor: pointer; padding: 2px 6px; font-size: 11px; margin-left: 10px;">Refetch</button>`;
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

async function loadBucketXml(url, xmlText) {
  currentTab = 'table';
  const tableBtn = document.getElementById('viewTableBtn');
  const statsBtn = document.getElementById('viewStatsBtn');
  const statsContainer = document.getElementById('statsContainer');
  if (tableBtn) tableBtn.classList.add('active');
  if (statsBtn) statsBtn.classList.remove('active');
  if (statsContainer) statsContainer.classList.add('hidden');

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
  currentTab = 'table';
  const tableBtn = document.getElementById('viewTableBtn');
  const statsBtn = document.getElementById('viewStatsBtn');
  const statsContainer = document.getElementById('statsContainer');
  if (tableBtn) tableBtn.classList.add('active');
  if (statsBtn) statsBtn.classList.remove('active');
  if (statsContainer) statsContainer.classList.add('hidden');

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

  loadingStatusEl.innerHTML = `Downloading <span id="zipProgress">0/${totalCount}</span> files... <button id="stopZipBtn" class="btn-action" style="margin-left: 10px; padding: 2px 6px; font-size: 11px;">Cancel</button>`;

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

  if (allItems.length === 0) {
    table.classList.add('hidden');
    emptyState.classList.remove('hidden');
    if (viewTabs) viewTabs.classList.add('hidden');
  } else {
    emptyState.classList.add('hidden');
    if (viewTabs) viewTabs.classList.remove('hidden');

    if (currentTab === 'table') {
      if (filteredItems.length === 0) {
        table.classList.add('hidden');
      } else {
        table.classList.remove('hidden');
      }
    } else {
      table.classList.add('hidden');
    }
  }

  const exportJsonBtn = document.getElementById('exportJson');
  const exportCsvBtn = document.getElementById('exportCsv');
  const exportWgetBtn = document.getElementById('exportWget');
  const exportZipBtn = document.getElementById('exportZip');
  if (allItems.length > 0) {
    exportJsonBtn.classList.remove('hidden');
    exportCsvBtn.classList.remove('hidden');
    exportWgetBtn.classList.remove('hidden');
    exportZipBtn.classList.remove('hidden');
  } else {
    exportJsonBtn.classList.add('hidden');
    exportCsvBtn.classList.add('hidden');
    exportWgetBtn.classList.add('hidden');
    exportZipBtn.classList.add('hidden');
  }

  // Build table rows
  const tbody = document.getElementById('bucketBody');
  tbody.innerHTML = '';

  if (currentTab === 'stats') {
    renderStats();
    // clear pagination controls when viewing stats
    const pagTop = document.getElementById('paginationTop');
    const pagBot = document.getElementById('paginationBottom');
    if (pagTop) pagTop.innerHTML = '';
    if (pagBot) pagBot.innerHTML = '';
  } else {
    pageItems.forEach((item) => {
      const tr = document.createElement('tr');
      const isDir = item.key.endsWith('/');
      const downloadUrl = buildDownloadUrl(window.bucketBaseUrl, item.key);

      let keyHtml;
      let actionHtml;

      if (isDir) {
        keyHtml = `<a href="#" class="directory-link" data-key="${escapeHtml(item.key)}">📁 ${escapeHtml(item.key)}</a>`;
        actionHtml = `<a href="#" class="btn-action directory-zip-btn" data-key="${escapeHtml(item.key)}">ZIP</a>`;
      } else {
        keyHtml = `<a href="${downloadUrl}" target="_blank">${escapeHtml(item.key)}</a>`;
        actionHtml = `<a href="${downloadUrl}" target="_blank" class="btn-action">Open</a>`;
      }

      tr.innerHTML = `
        <td class="col-url">${keyHtml}</td>
        <td>${isDir ? '-' : formatSize(item.size)}</td>
        <td>${formatDate(item.lastModified)}</td>
        <td>${actionHtml}</td>
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

  // Size Ranges
  const ranges = [
    { name: 'Tiny (< 10 KB)', min: 0, max: 10240 },
    { name: 'Small (10 KB - 100 KB)', min: 10240, max: 102400 },
    { name: 'Medium (100 KB - 1 MB)', min: 102400, max: 1048576 },
    { name: 'Large (1 MB - 10 MB)', min: 1048576, max: 10485760 },
    { name: 'Very Large (10 MB - 100 MB)', min: 10485760, max: 104857600 },
    { name: 'Huge (> 100 MB)', min: 104857600, max: Infinity }
  ];

  const rangeMap = ranges.map((r) => ({
    name: r.name,
    min: r.min,
    max: r.max,
    count: 0,
    size: 0
  }));

  files.forEach((file) => {
    const size = file.size || 0;
    for (const r of rangeMap) {
      if (size >= r.min && size < r.max) {
        r.count++;
        r.size += size;
        break;
      }
    }
  });

  const bySizeRange = rangeMap.map((r) => ({
    range: r.name,
    count: r.count,
    countPercent: (r.count / totalFiles) * 100,
    size: r.size,
    sizePercent: totalSize > 0 ? (r.size / totalSize) * 100 : 0
  }));

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
    .sort((a, b) => b.count - a.count);

  const byDirectorySize = Object.entries(dirMap)
    .map(([dir, data]) => ({
      dir,
      size: data.size,
      sizePercent: totalSize > 0 ? (data.size / totalSize) * 100 : 0
    }))
    .sort((a, b) => b.size - a.size);

  return {
    totalFiles,
    totalSize,
    bySize,
    byExtension,
    bySizeRange,
    byModifiedDate,
    byDirectoryCount,
    byDirectorySize,
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
      '<div class="stats" style="text-align: center; padding: 2rem;">No data available matching your filters.</div>';
    return;
  }

  const stats = calculateStats(filteredItems);

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

  const rangeRowsHtml = stats.bySizeRange
    .map(
      (item) => `
    <tr>
      <td>${escapeHtml(item.range)}</td>
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
      <td class="clickable-stat clickable-dir" style="word-break: break-all;" data-dir="${escapeHtml(item.dir)}"><code>${escapeHtml(item.dir)}</code></td>
      <td>${item.count.toLocaleString()} (${item.countPercent.toFixed(1)}%)
        <div class="stats-bar-container"><div class="stats-bar-fill count" style="width: ${item.countPercent}%"></div></div>
      </td>
    </tr>
  `
    )
    .join('');

  const dirSizeRowsHtml = stats.byDirectorySize
    .map(
      (item) => `
    <tr>
      <td class="clickable-stat clickable-dir" style="word-break: break-all;" data-dir="${escapeHtml(item.dir)}"><code>${escapeHtml(item.dir)}</code></td>
      <td>${formatSize(item.size)} (${item.sizePercent.toFixed(1)}%)
        <div class="stats-bar-container"><div class="stats-bar-fill size" style="width: ${item.sizePercent}%"></div></div>
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
          <a href="${downloadUrl}" target="_blank" class="btn-action" style="margin-right: 5px;">Open</a>
          <button class="btn-action locate-btn" data-key="${escapeHtml(item.key)}">Show in List</button>
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
        <div class="value" style="font-size: 1.3rem; margin-top: 5px;">${stats.earliestDate}</div>
        <div class="sub-value">Earliest file timestamp</div>
      </div>
      <div class="stats-card summary">
        <h4>Latest Modification</h4>
        <div class="value" style="font-size: 1.3rem; margin-top: 5px;">${stats.latestDate}</div>
        <div class="sub-value">Most recent update</div>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stats-card full-width">
        <h3>Top 10 Largest Files</h3>
        <table class="stats-table">
          <thead>
            <tr>
              <th style="width: 50%;">Key</th>
              <th style="width: 15%;">Size</th>
              <th style="width: 20%;">Last Modified</th>
              <th style="width: 15%;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${largestFilesRowsHtml || '<tr><td colspan="4">No files found</td></tr>'}
          </tbody>
        </table>
      </div>

      <div class="stats-card">
        <h3>By Extension <span style="font-size: 0.75rem; font-weight: normal; color: var(--comment); opacity: 0.85;">(click ext to filter)</span></h3>
        <div style="max-height: 300px; overflow-y: auto;">
          <table class="stats-table">
            <thead>
              <tr>
                <th style="width: 25%;">Ext</th>
                <th style="width: 37%;">Count</th>
                <th style="width: 38%;">Total Size</th>
              </tr>
            </thead>
            <tbody>
              ${extRowsHtml || '<tr><td colspan="3">No files found</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <div class="stats-card">
        <h3>By Size Range</h3>
        <table class="stats-table">
          <thead>
            <tr>
              <th style="width: 35%;">Range</th>
              <th style="width: 32%;">Count</th>
              <th style="width: 33%;">Total Size</th>
            </tr>
          </thead>
          <tbody>
            ${rangeRowsHtml || '<tr><td colspan="3">No files found</td></tr>'}
          </tbody>
        </table>
      </div>

      <div class="stats-card">
        <h3>Modification Timeline</h3>
        <div style="max-height: 300px; overflow-y: auto;">
          <table class="stats-table">
            <thead>
              <tr>
                <th style="width: 40%;">Year-Month</th>
                <th style="width: 60%;">Files Modified</th>
              </tr>
            </thead>
            <tbody>
              ${timelineRowsHtml || '<tr><td colspan="2">No dates found</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <div class="stats-card">
        <h3>All Directories (File Count) <span style="font-size: 0.75rem; font-weight: normal; color: var(--comment); opacity: 0.85;">(click path to filter)</span></h3>
        <div style="max-height: 300px; overflow-y: auto;">
          <table class="stats-table">
            <thead>
              <tr>
                <th style="width: 60%;">Directory</th>
                <th style="width: 40%;">Files</th>
              </tr>
            </thead>
            <tbody>
              ${dirCountRowsHtml || '<tr><td colspan="2">No directories found</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <div class="stats-card">
        <h3>All Directories (Size Footprint) <span style="font-size: 0.75rem; font-weight: normal; color: var(--comment); opacity: 0.85;">(click path to filter)</span></h3>
        <div style="max-height: 300px; overflow-y: auto;">
          <table class="stats-table">
            <thead>
              <tr>
                <th style="width: 60%;">Directory</th>
                <th style="width: 40%;">Total Size</th>
              </tr>
            </thead>
            <tbody>
              ${dirSizeRowsHtml || '<tr><td colspan="2">No directories found</td></tr>'}
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
  const statsBtn = document.getElementById('viewStatsBtn');
  const statsContainer = document.getElementById('statsContainer');

  if (tabName === 'table') {
    if (tableBtn) tableBtn.classList.add('active');
    if (statsBtn) statsBtn.classList.remove('active');
    if (statsContainer) statsContainer.classList.add('hidden');
  } else if (tabName === 'stats') {
    if (tableBtn) tableBtn.classList.remove('active');
    if (statsBtn) statsBtn.classList.add('active');
    if (statsContainer) statsContainer.classList.remove('hidden');
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
  document.getElementById('exportZip').addEventListener('click', exportZipData);

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
  const statsBtn = document.getElementById('viewStatsBtn');
  if (tableBtn && statsBtn) {
    tableBtn.addEventListener('click', (e) => {
      e.preventDefault();
      switchTab('table');
    });
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

  loadingStatusEl.innerHTML = `Downloading <span id="zipProgress">0/${totalCount}</span> files... <button id="stopZipBtn" class="btn-action" style="margin-left: 10px; padding: 2px 6px; font-size: 11px;">Cancel</button>`;

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
