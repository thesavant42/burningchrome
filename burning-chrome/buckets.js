import { storage } from './lib/storage.js';
import { parseBucketXml, buildDownloadUrl, formatSize, formatDate, escapeHtml } from './lib/bucket-parser.js';
import { renderPaginationControls } from './lib/bucket-pagination.js';
import { saveBucket, getBucket, deleteBucket, listBuckets } from './lib/db.js';

let bucketName = '';
let bucketUrl = '';       // Current bucket URL (for saving)
let allItems = [];        // All parsed items from XML
let filteredItems = [];   // Items after search filter
let currentPage = 1;
const ROWS_PER_PAGE = 50;

// View mode: when true, we're viewing cached data
let viewMode = false;

async function init() {
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
    document.getElementById('navDockerhub').href = `dockerhub.html${projectParam}`;
    document.getElementById('navCreds').href = `creds.html${projectParam}`;
  }
  
  // Setup event listeners
  setupEventListeners();
  
  // Load saved reports list
  await loadSavedReportsList();
  
  // Check for view mode (loading cached data from IndexedDB)
  if (viewUrl) {
    viewMode = true;
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
  
  try {
    const response = await chrome.runtime.sendMessage({ type: 'fetch-bucket', url: url });
    
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

async function loadBucketXml(url, xmlText) {
  const result = parseBucketXml(xmlText);
  
  if (result.error) {
    showError(result.error);
    return;
  }
  
  bucketName = result.bucketName;
  bucketUrl = url;
  allItems = result.items;
  window.bucketBaseUrl = url;
  
  // Update title and stats
  document.getElementById('title').textContent = bucketName;
  document.getElementById('bucketStats').textContent = ` | ${allItems.length} items`;
  
  // Populate URL input with the fetched URL
  document.getElementById('bucketUrlInput').value = url;
  
  // Auto-save to IndexedDB on fetch
  await saveBucketToCache();
  
  // Apply filter and render
  applyFilter();
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
  
  const savedDate = cached.savedAt ? new Date(cached.savedAt).toLocaleDateString() : 'unknown';
  
  // Update title and stats
  document.getElementById('title').textContent = `${bucketName} (cached)`;
  document.getElementById('bucketStats').textContent = ` | ${allItems.length} items - saved ${savedDate}`;
  
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

function applyFilter() {
  const searchTerm = document.getElementById('searchInput').value.trim().toLowerCase();
  
  if (searchTerm) {
    filteredItems = allItems.filter(item => item.key.toLowerCase().includes(searchTerm));
  } else {
    filteredItems = [...allItems];
  }
  
  currentPage = 1;
  renderTable();
}

function renderTable() {
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / ROWS_PER_PAGE));
  
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
  
  // Build table rows
  const tbody = document.getElementById('bucketBody');
  tbody.innerHTML = '';
  
  pageItems.forEach(item => {
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
  renderPaginationControls('paginationTop', {
    currentPage,
    totalPages,
    filteredCount: filteredItems.length,
    rowsPerPage: ROWS_PER_PAGE
  }, handlePageChange);
  
  renderPaginationControls('paginationBottom', {
    currentPage,
    totalPages,
    filteredCount: filteredItems.length,
    rowsPerPage: ROWS_PER_PAGE
  }, handlePageChange);
}

function handlePageChange(newPage) {
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / ROWS_PER_PAGE));
  
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
  document.getElementById('savedReportsSelect').addEventListener('change', handleSavedReportChange);
  
  // Delete saved report button
  document.getElementById('deleteSavedReport').addEventListener('click', handleDeleteSavedReport);
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
  const savedReportsContainer = document.getElementById('savedReportsContainer');
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

