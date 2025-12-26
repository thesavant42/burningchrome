import { download, saveHtml, saveJson } from './lib/export.js';
import { storage } from './lib/storage.js';
import { getTimemap, saveTimemap } from './lib/db.js';
import mime from 'mime/lite';

// Current row being edited/noted
let currentEditRowId = null;

// URL encode/decode toggle state: true = encode, false = decode
let urlEncodeMode = true;

let _type = '';
let domain = '';
let rawData = [];
let filteredData = [];
let selectedRows = new Set();

// Pagination state
const ROWS_PER_PAGE = 50;
let currentPage = 1;
let totalPages = 1;

// Polling timer for loading state
let loadingPollTimer = null;

// View mode: when true, we're viewing cached data (not fetching)
let viewMode = false;

async function init() {
  // Wire up cancel button once
  const cancelBtn = document.getElementById('cancelFetch');
  cancelBtn.onclick = cancelFetch;

  // Check for view mode (loading cached data from IndexedDB)
  const params = new URLSearchParams(window.location.search);
  const viewDomain = params.get('view');
  
  if (viewDomain) {
    viewMode = true;
    await loadCachedWayback(viewDomain);
    return;
  }
  
  const timemapData = await storage.get('timemapData');
  const crtshData = await storage.get('crtshData');

  if (timemapData) {
    _type = 'wayback';
    setTitle(`${timemapData.domain} - Wayback`);
    await loadWayback(timemapData);
  } else if (crtshData) {
    _type = 'crtsh';
    setTitle(`${crtshData.domain} - Crt.sh`);
    await loadCrtsh(crtshData);
  } else {
    showError('No data. Use context menu on a webpage.');
  }
}

// Load cached Wayback data from IndexedDB (view mode)
async function loadCachedWayback(domainName) {
  _type = 'wayback';
  domain = domainName;
  setTitle(`${domain} - Wayback (cached)`);
  
  const cached = await getTimemap(domain);
  
  if (!cached || !cached.data) {
    showError(`No cached data found for ${domain}`);
    return;
  }
  
  // Parse CDX data: skip header row, each row is [url, timestamp, statuscode, mimetype]
  const rows = cached.data || [];
  if (rows.length <= 1) {
    showError(`No archived URLs found for ${domain}`);
    return;
  }
  
  // Convert to objects for easier handling
  rawData = rows.slice(1).map((r, idx) => ({
    id: idx,
    url: r[0],
    timestamp: r[1],
    status: r[2] || '',
    mime: r[3] || '',
    notes: r[4] || ''
  }));

  filteredData = [...rawData];

  const fetchedDate = cached.fetchedAt ? new Date(cached.fetchedAt).toLocaleDateString() : 'unknown';
  const partialNote = cached.partial ? ' (partial)' : '';
  show(`${domain} - Wayback (cached)`, `${rawData.length} snapshots${partialNote} - cached ${fetchedDate}`);
  renderWaybackTable();
  setupWaybackFilters();
  setupSelection();
  setupRowActions();
  setupExportWayback();
}

async function loadWayback(data) {
  domain = data.domain;
  setTitle(`${domain} - Wayback`);

  // Always show debug log if present
  showDebugLog(data.debugLog);

  // Hide cancel button when not loading
  if (!data.loading) {
    showCancelButton(false);
  }

  if (data.error) {
    showError(data.error);
    return;
  }

  // Parse CDX data: skip header row, each row is [url, timestamp, statuscode, mimetype]
  const rows = data.data || [];
  if (rows.length > 1) {
    // Convert to objects for easier handling
    rawData = rows.slice(1).map((r, idx) => ({
      id: idx,
      url: r[0],
      timestamp: r[1],
      status: r[2] || '',
      mime: r[3] || '',
      notes: r[4] || ''
    }));

    filteredData = [...rawData];

    const statusText = data.loading
      ? `${rawData.length} snapshots (loading more...)`
      : `${rawData.length} snapshots`;
    show(`${domain} - Wayback`, statusText);
    renderWaybackTable();
    setupWaybackFilters();
    setupSelection();
    setupRowActions();
    setupExportWayback();
  }

  if (data.loading) {
    showLoadingProgress(data);
    return;
  }

  if (rows.length <= 1) {
    showError(`No archived URLs found for ${domain}`);
    return;
  }

  await storage.remove('timemapData');
}

async function loadCrtsh(data) {
  domain = data.domain;
  setTitle(`${domain} - Crt.sh`);

  if (data.loading) {
    showLoadingProgress(data);
    return;
  }

  if (data.error) {
    showError(data.error);
    return;
  }

  rawData = data.data || [];
  if (rawData.length === 0) {
    showError(`No certificates found for ${domain}`);
    return;
  }

  show(`${domain} - Crt.sh`, `${rawData.length} certificates`);
  renderCrtshTable();
  setupFilter('#tableBody tr');
  setupExportCrtsh();
  await storage.remove('crtshData');
}

function setTitle(text) {
  document.getElementById('title').textContent = text;
  document.title = text;
}

function showLoadingProgress(data) {
  const elapsed = data.startTime
    ? Math.floor((Date.now() - data.startTime) / 1000)
    : 0;
  const page = data.page || 0;
  const totalPages = data.totalPages || 0;
  const count = data.recordCount || 0;
  const url = data.fetchUrl || '(no URL)';

  let msg;
  if (page > 0 && totalPages > 0) {
    msg = `Fetching page ${page}/${totalPages} (${count} records) - ${elapsed}s\n${url}`;
  } else if (page > 0) {
    msg = `Fetching page ${page}... (${count} records) - ${elapsed}s\n${url}`;
  } else {
    msg = `Fetching: ${url} (${elapsed}s)`;
  }
  showDebugLog(msg + (data.debugLog ? '\n' + data.debugLog : ''));
  
  // Show cancel button during loading
  showCancelButton(true);
  
  // Clear any existing timer before setting a new one
  if (loadingPollTimer) {
    clearTimeout(loadingPollTimer);
  }
  loadingPollTimer = setTimeout(init, 500);
}

function showCancelButton(show) {
  const cancelBtn = document.getElementById('cancelFetch');
  if (show) {
    cancelBtn.classList.remove('hidden');
  } else {
    cancelBtn.classList.add('hidden');
  }
}

async function cancelFetch() {
  // Stop the polling timer immediately
  if (loadingPollTimer) {
    clearTimeout(loadingPollTimer);
    loadingPollTimer = null;
  }
  
  const timemapData = await storage.get('timemapData');
  if (!timemapData) {
    // Storage already cleared, nothing to cancel
    showCancelButton(false);
    return;
  }
  
  if (timemapData.loading) {
    await storage.set('timemapData', {
      ...timemapData,
      cancelled: true
    });
    showCancelButton(false);
  } else {
    // Fetch already complete, just hide button
    showCancelButton(false);
  }
}

function showError(msg) {
  document.getElementById('title').innerHTML =
    `<span class="error">${msg}</span>`;
}

function showDebugLog(debugLog) {
  const debugEl = document.getElementById('debugLog');
  debugEl.textContent = debugLog || '';
}

function show(title, stats) {
  setTitle(title);
}

// Format Wayback timestamp (YYYYMMDDHHmmss) as fixed-width badge
function formatTimestamp(ts) {
  if (!ts || ts.length < 8) return '<span class="badge-date">????????</span>';
  const year = ts.slice(0, 4);
  const month = ts.slice(4, 6);
  const day = ts.slice(6, 8);
  const date = `${year}-${month}-${day}`;
  return `<span class="badge-date" title="${ts}">${date}</span>`;
}

// Build Wayback Machine URL for a specific snapshot
function getArchiveUrl(url, timestamp) {
  return `https://web.archive.org/web/${timestamp}/${url}`;
}

// Render the Wayback table with all metadata (paginated)
function renderWaybackTable() {
  const table = document.getElementById('waybackTable');
  const tbody = document.getElementById('waybackBody');
  table.classList.remove('hidden');
  tbody.innerHTML = '';

  // Calculate pagination
  calculateTotalPages();
  const pageData = getPageData();

  pageData.forEach((row) => {
    const tr = document.createElement('tr');
    tr.dataset.id = row.id;
    if (selectedRows.has(row.id)) {
      tr.classList.add('selected');
    }

    const archiveUrl = getArchiveUrl(row.url, row.timestamp);

    tr.innerHTML = `
      <td class="col-check"><input type="checkbox" class="row-check" data-id="${row.id}" ${selectedRows.has(row.id) ? 'checked' : ''}></td>
      <td class="col-url"><a href="${row.url}" target="_blank" title="${row.url}">${row.url}</a></td>
      <td class="col-date">${formatTimestamp(row.timestamp)}</td>
      <td class="col-status">${formatStatus(row.status)}</td>
      <td class="col-mime">${formatMime(row.mime)}</td>
      <td class="col-actions">
        <button class="btn-icon btn-edit" data-id="${row.id}" title="Edit row">E</button>
        <button class="btn-icon btn-notes${row.notes ? ' has-notes' : ''}" data-id="${row.id}" title="Add/view notes">N</button>
        <a href="${archiveUrl}" target="_blank" class="badge-action badge-action-archive" title="View archived snapshot">WARC</a>
        <a href="${row.url}" target="_blank" class="badge-action badge-action-live" title="View live page">LIVE</a>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Render pagination controls (top and bottom)
  renderPaginationControls('paginationTop');
  renderPaginationControls('paginationBottom');
}

function formatStatus(status) {
  let label, className;
  if (!status || status === '-') {
    label = '???';
    className = 'badge-status-unk';
  } else {
    const code = parseInt(status, 10);
    label = status;
    if (code >= 200 && code < 300)
      className = 'badge-status-ok';
    else if (code >= 300 && code < 400)
      className = 'badge-status-redirect';
    else if (code >= 400 && code < 500)
      className = 'badge-status-client';
    else if (code >= 500)
      className = 'badge-status-server';
    else
      className = 'badge-status-other';
  }
  return `<span class="badge-status ${className}" title="HTTP ${status || 'unknown'}">${label}</span>`;
}

function getShortLabel(mimeType) {
  if (!mimeType) return '???';
  
  const extension = mime.getExtension(mimeType);
  return extension ? extension.toUpperCase() : '???';
}

function formatMime(mimeType) {
  const label = getShortLabel(mimeType);
  return `<span class="badge-mime" title="${mimeType || 'Unknown'}">${label}</span>`;
}

function setupWaybackFilters() {
  const searchInput = document.getElementById('search');
  const statusFilter = document.getElementById('statusFilter');
  const mimeFilter = document.getElementById('mimeFilter');

  const applyFilters = () => {
    const searchTerm = searchInput.value.toLowerCase();
    const statusVal = statusFilter.value;
    const mimeVal = mimeFilter.value;

    filteredData = rawData.filter((row) => {
      // URL text filter
      if (searchTerm && !row.url.toLowerCase().includes(searchTerm)) {
        return false;
      }
      // Status filter
      if (statusVal && row.status !== statusVal) {
        return false;
      }
      // MIME filter (prefix match for categories like "image/")
      if (mimeVal && !row.mime.startsWith(mimeVal)) {
        return false;
      }
      return true;
    });

    // Reset to first page when filters change
    currentPage = 1;
    renderWaybackTable();
  };

  searchInput.addEventListener('input', applyFilters);
  statusFilter.addEventListener('change', applyFilters);
  mimeFilter.addEventListener('change', applyFilters);
}

function setupSelection() {
  const headerCheck = document.getElementById('headerCheck');
  const headerDelete = document.getElementById('headerDelete');
  const tbody = document.getElementById('waybackBody');

  // Individual row checkbox
  tbody.addEventListener('change', (e) => {
    if (e.target.classList.contains('row-check')) {
      const id = parseInt(e.target.dataset.id, 10);
      if (e.target.checked) {
        selectedRows.add(id);
        e.target.closest('tr').classList.add('selected');
      } else {
        selectedRows.delete(id);
        e.target.closest('tr').classList.remove('selected');
      }
      updateSelectionUI();
    }
  });

  // Header checkbox (select all visible)
  headerCheck.addEventListener('change', () => {
    const checkAll = headerCheck.checked;
    document.querySelectorAll('.row-check').forEach((cb) => {
      const id = parseInt(cb.dataset.id, 10);
      cb.checked = checkAll;
      if (checkAll) {
        selectedRows.add(id);
        cb.closest('tr').classList.add('selected');
      } else {
        selectedRows.delete(id);
        cb.closest('tr').classList.remove('selected');
      }
    });
    updateSelectionUI();
  });

  // Delete selected (header delete button)
  headerDelete.addEventListener('click', async () => {
    if (selectedRows.size === 0) return;

    const confirmMsg = `Delete ${selectedRows.size} selected row(s)?`;
    if (!confirm(confirmMsg)) return;

    // Remove from rawData
    rawData = rawData.filter((row) => !selectedRows.has(row.id));
    selectedRows.clear();

    // Re-apply filters and render
    const searchTerm = document.getElementById('search').value.toLowerCase();
    const statusVal = document.getElementById('statusFilter').value;
    const mimeVal = document.getElementById('mimeFilter').value;

    filteredData = rawData.filter((row) => {
      if (searchTerm && !row.url.toLowerCase().includes(searchTerm))
        return false;
      if (statusVal && row.status !== statusVal) return false;
      if (mimeVal && !row.mime.startsWith(mimeVal)) return false;
      return true;
    });

    // Persist changes, recalculate pagination and re-render
    await persistChanges();
    calculateTotalPages();
    renderWaybackTable();
    updateSelectionUI();
  });
}

function updateSelectionUI() {
  const headerDelete = document.getElementById('headerDelete');
  const headerCheck = document.getElementById('headerCheck');

  // Toggle disabled state on header delete button
  headerDelete.disabled = selectedRows.size === 0;

  // Sync header checkbox with row selections
  const allVisible = document.querySelectorAll('.row-check');
  const allChecked = allVisible.length > 0 && [...allVisible].every((cb) => cb.checked);
  headerCheck.checked = allChecked;
}


// Pagination functions
function calculateTotalPages() {
  totalPages = Math.max(1, Math.ceil(filteredData.length / ROWS_PER_PAGE));
  if (currentPage > totalPages) {
    currentPage = totalPages;
  }
}

function getPageData() {
  const start = (currentPage - 1) * ROWS_PER_PAGE;
  const end = start + ROWS_PER_PAGE;
  return filteredData.slice(start, end);
}

function goToPage(page) {
  const newPage = Math.max(1, Math.min(page, totalPages));
  if (newPage !== currentPage) {
    currentPage = newPage;
    renderWaybackTable();
    // Scroll to top of table
    document.getElementById('waybackTable').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function renderPaginationControls(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  
  container.innerHTML = '';
  
  if (totalPages <= 1) {
    return;
  }
  
  // First/Prev buttons
  const firstBtn = document.createElement('button');
  firstBtn.textContent = '<<';
  firstBtn.title = 'First page';
  firstBtn.disabled = currentPage === 1;
  firstBtn.onclick = () => goToPage(1);
  container.appendChild(firstBtn);
  
  const prevBtn = document.createElement('button');
  prevBtn.textContent = '<';
  prevBtn.title = 'Previous page';
  prevBtn.disabled = currentPage === 1;
  prevBtn.onclick = () => goToPage(currentPage - 1);
  container.appendChild(prevBtn);
  
  // Page info
  const pageInfo = document.createElement('span');
  pageInfo.className = 'page-info';
  pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
  container.appendChild(pageInfo);
  
  // Jump to page input
  const jumpInput = document.createElement('input');
  jumpInput.type = 'number';
  jumpInput.className = 'page-jump';
  jumpInput.min = 1;
  jumpInput.max = totalPages;
  jumpInput.placeholder = '#';
  jumpInput.title = 'Jump to page';
  jumpInput.onkeydown = (e) => {
    if (e.key === 'Enter') {
      const page = parseInt(jumpInput.value, 10);
      if (!isNaN(page)) {
        goToPage(page);
        jumpInput.value = '';
      }
    }
  };
  container.appendChild(jumpInput);
  
  const goBtn = document.createElement('button');
  goBtn.textContent = 'Go';
  goBtn.title = 'Jump to page';
  goBtn.onclick = () => {
    const page = parseInt(jumpInput.value, 10);
    if (!isNaN(page)) {
      goToPage(page);
      jumpInput.value = '';
    }
  };
  container.appendChild(goBtn);
  
  // Next/Last buttons
  const nextBtn = document.createElement('button');
  nextBtn.textContent = '>';
  nextBtn.title = 'Next page';
  nextBtn.disabled = currentPage === totalPages;
  nextBtn.onclick = () => goToPage(currentPage + 1);
  container.appendChild(nextBtn);
  
  const lastBtn = document.createElement('button');
  lastBtn.textContent = '>>';
  lastBtn.title = 'Last page';
  lastBtn.disabled = currentPage === totalPages;
  lastBtn.onclick = () => goToPage(totalPages);
  container.appendChild(lastBtn);
  
  // Row range info
  const start = (currentPage - 1) * ROWS_PER_PAGE + 1;
  const end = Math.min(currentPage * ROWS_PER_PAGE, filteredData.length);
  const rangeInfo = document.createElement('span');
  rangeInfo.className = 'range-info';
  rangeInfo.textContent = `(${start}-${end} of ${filteredData.length})`;
  container.appendChild(rangeInfo);
}

// Crt.sh table rendering
function renderCrtshTable() {
  document.getElementById('dataTable').classList.remove('hidden');

  const thead = document.getElementById('tableHead');
  thead.innerHTML =
    '<tr><th>ID</th><th>Logged</th><th>Not Before</th><th>Not After</th><th>Common Name</th><th>Identities</th></tr>';

  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '';
  rawData.forEach((c) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${c.id}</td>
      <td>${fmtDate(c.entry_timestamp)}</td>
      <td>${fmtDate(c.not_before)}</td>
      <td>${fmtDate(c.not_after)}</td>
      <td>${linkify(c.common_name)}</td>
      <td>${linkify(c.name_value)}</td>
    `;
    tbody.appendChild(tr);
  });
}

function fmtDate(s) {
  return s ? s.split('T')[0] : '';
}

function linkify(text) {
  if (!text) return '';
  return text
    .split('\n')
    .map((line) => {
      return line.replace(/((?:\*\.)?[\w.-]+\.[a-z]{2,})/gi, (m) => {
        const url = m.replace(/^\*\.?/, '');
        return `<a href="https://${url}" target="_blank">${m}</a>`;
      });
    })
    .join('<br>');
}

function setupFilter(selector) {
  document.getElementById('search').addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    document.querySelectorAll(selector).forEach((el) => {
      el.classList.toggle(
        'hidden',
        !el.textContent.toLowerCase().includes(term)
      );
    });
  });
}

function setupExportWayback() {
  const modal = document.getElementById('exportModal');
  const exportLink = document.getElementById('exportLink');
  const cancelBtn = document.getElementById('exportCancel');

  // Show modal
  exportLink.onclick = (e) => {
    e.preventDefault();
    modal.classList.remove('hidden');
  };

  // Hide modal
  cancelBtn.onclick = (e) => {
    e.preventDefault();
    modal.classList.add('hidden');
  };

  // Close on overlay click
  modal.onclick = (e) => {
    if (e.target === modal) {
      modal.classList.add('hidden');
    }
  };

  // Export HTML
  document.getElementById('exportHtml').onclick = () => {
    saveHtml(domain, '-wayback');
    modal.classList.add('hidden');
  };

  // Export JSON
  document.getElementById('exportJson').onclick = () => {
    const exportData = filteredData.map((r) => ({
      url: r.url,
      timestamp: r.timestamp,
      status: r.status,
      mime: r.mime,
      archiveUrl: getArchiveUrl(r.url, r.timestamp)
    }));
    saveJson(domain, exportData, '-wayback');
    modal.classList.add('hidden');
  };

  // Export Markdown
  document.getElementById('exportMd').onclick = () => {
    const lines = [
      `# ${domain} - Wayback Archive`,
      '',
      `${filteredData.length} snapshots`,
      ''
    ];
    filteredData.forEach((r) => {
      const archiveUrl = getArchiveUrl(r.url, r.timestamp);
      lines.push(
        `- [${formatTimestamp(r.timestamp)}] [${r.status || '?'}] [${r.url}](${archiveUrl})`
      );
    });
    download(lines.join('\n'), `${domain}-wayback.md`, 'text/markdown');
    modal.classList.add('hidden');
  };
}

function setupExportCrtsh() {
  const modal = document.getElementById('exportModal');
  const exportLink = document.getElementById('exportLink');
  const cancelBtn = document.getElementById('exportCancel');
  const mdBtn = document.getElementById('exportMd');

  // Hide MD option for crtsh (not applicable)
  mdBtn.classList.add('hidden');

  // Show modal
  exportLink.onclick = (e) => {
    e.preventDefault();
    modal.classList.remove('hidden');
  };

  // Hide modal
  cancelBtn.onclick = (e) => {
    e.preventDefault();
    modal.classList.add('hidden');
  };

  // Close on overlay click
  modal.onclick = (e) => {
    if (e.target === modal) {
      modal.classList.add('hidden');
    }
  };

  // Export HTML
  document.getElementById('exportHtml').onclick = () => {
    saveHtml(domain, '-crtsh');
    modal.classList.add('hidden');
  };

  // Export JSON
  document.getElementById('exportJson').onclick = () => {
    saveJson(domain, rawData, '-crtsh');
    modal.classList.add('hidden');
  };
}

// Persist changes to IndexedDB (only in view mode)
async function persistChanges() {
  if (!viewMode) return;
  
  // Reconstruct CDX format: header + data rows
  const header = ['url', 'timestamp', 'statuscode', 'mimetype', 'notes'];
  const rows = [header, ...rawData.map(r => [r.url, r.timestamp, r.status, r.mime, r.notes || ''])];
  
  const cached = await getTimemap(domain);
  await saveTimemap(domain, {
    ...cached,
    data: rows
  });
}

// Notes Modal functions
function openNotesModal(rowId) {
  const row = rawData.find(r => r.id === rowId);
  if (!row) return;
  
  currentEditRowId = rowId;
  
  const modal = document.getElementById('notesModal');
  const urlPreview = document.getElementById('notesUrlPreview');
  const textarea = document.getElementById('notesTextarea');
  
  // Truncate URL for display
  const displayUrl = row.url.length > 80 ? row.url.slice(0, 80) + '...' : row.url;
  urlPreview.textContent = displayUrl;
  urlPreview.title = row.url;
  textarea.value = row.notes || '';
  
  modal.classList.remove('hidden');
  textarea.focus();
}

function closeNotesModal() {
  document.getElementById('notesModal').classList.add('hidden');
  currentEditRowId = null;
}

async function saveNotes() {
  if (currentEditRowId === null) return;
  
  const textarea = document.getElementById('notesTextarea');
  const notesText = textarea.value;
  
  // Update rawData
  const row = rawData.find(r => r.id === currentEditRowId);
  if (row) {
    row.notes = notesText;
  }
  
  // Update filteredData
  const filteredRow = filteredData.find(r => r.id === currentEditRowId);
  if (filteredRow) {
    filteredRow.notes = notesText;
  }
  
  // Persist and re-render
  await persistChanges();
  renderWaybackTable();
  closeNotesModal();
}

function setupNotesModal() {
  const modal = document.getElementById('notesModal');
  const saveBtn = document.getElementById('notesSave');
  const cancelBtn = document.getElementById('notesCancel');
  
  saveBtn.onclick = saveNotes;
  
  cancelBtn.onclick = (e) => {
    e.preventDefault();
    closeNotesModal();
  };
  
  modal.onclick = (e) => {
    if (e.target === modal) {
      closeNotesModal();
    }
  };
}

// Edit Modal functions
function openEditModal(rowId) {
  const row = rawData.find(r => r.id === rowId);
  if (!row) return;
  
  currentEditRowId = rowId;
  
  const modal = document.getElementById('editModal');
  document.getElementById('editUrl').value = row.url;
  document.getElementById('editTimestamp').value = row.timestamp;
  document.getElementById('editStatus').value = row.status;
  document.getElementById('editMime').value = row.mime;
  
  modal.classList.remove('hidden');
  document.getElementById('editUrl').focus();
}

function closeEditModal() {
  document.getElementById('editModal').classList.add('hidden');
  currentEditRowId = null;
}

async function saveEdit() {
  if (currentEditRowId === null) return;
  
  const newUrl = document.getElementById('editUrl').value;
  const newTimestamp = document.getElementById('editTimestamp').value;
  const newStatus = document.getElementById('editStatus').value;
  const newMime = document.getElementById('editMime').value;
  
  // Update rawData
  const row = rawData.find(r => r.id === currentEditRowId);
  if (row) {
    row.url = newUrl;
    row.timestamp = newTimestamp;
    row.status = newStatus;
    row.mime = newMime;
  }
  
  // Update filteredData
  const filteredRow = filteredData.find(r => r.id === currentEditRowId);
  if (filteredRow) {
    filteredRow.url = newUrl;
    filteredRow.timestamp = newTimestamp;
    filteredRow.status = newStatus;
    filteredRow.mime = newMime;
  }
  
  // Persist and re-render
  await persistChanges();
  renderWaybackTable();
  closeEditModal();
}

function setupEditModal() {
  const modal = document.getElementById('editModal');
  const saveBtn = document.getElementById('editSave');
  const cancelBtn = document.getElementById('editCancel');
  
  saveBtn.onclick = saveEdit;
  
  cancelBtn.onclick = (e) => {
    e.preventDefault();
    closeEditModal();
  };
  
  modal.onclick = (e) => {
    if (e.target === modal) {
      closeEditModal();
    }
  };
  
  // URL encode/decode toggle and apply buttons
  const toggleBtn = document.getElementById('editUrlToggle');
  const applyBtn = document.getElementById('editUrlApply');
  const urlTextarea = document.getElementById('editUrl');

  // Toggle button - switches mode
  toggleBtn.onclick = () => {
    urlEncodeMode = !urlEncodeMode;
    toggleBtn.textContent = urlEncodeMode ? 'ENC' : 'DEC';
    toggleBtn.classList.toggle('active', !urlEncodeMode);
    toggleBtn.title = urlEncodeMode ? 'Mode: Encode' : 'Mode: Decode';
  };

  // Apply button - encodes/decodes selection without toggling mode
  applyBtn.onclick = () => {
    const start = urlTextarea.selectionStart;
    const end = urlTextarea.selectionEnd;
    
    // Only act if text is selected
    if (start === end) return;
    
    const text = urlTextarea.value;
    const selected = text.substring(start, end);
    
    // MDN-verified encode/decode functions
    let transformed;
    try {
      transformed = urlEncodeMode 
        ? encodeURIComponent(selected)
        : decodeURIComponent(selected);
    } catch (e) {
      // URIError: malformed URI sequence - leave unchanged
      return;
    }
    
    // Replace selection with transformed text
    urlTextarea.value = text.substring(0, start) + transformed + text.substring(end);
    
    // Restore selection around transformed text
    urlTextarea.selectionStart = start;
    urlTextarea.selectionEnd = start + transformed.length;
    urlTextarea.focus();
  };
}

// Setup row action buttons (Edit, Notes)
function setupRowActions() {
  const tbody = document.getElementById('waybackBody');
  
  tbody.addEventListener('click', (e) => {
    const target = e.target;
    
    if (target.classList.contains('btn-edit')) {
      const rowId = parseInt(target.dataset.id, 10);
      openEditModal(rowId);
    } else if (target.classList.contains('btn-notes')) {
      const rowId = parseInt(target.dataset.id, 10);
      openNotesModal(rowId);
    }
  });
  
  // Setup modals once
  setupNotesModal();
  setupEditModal();
}

init();
