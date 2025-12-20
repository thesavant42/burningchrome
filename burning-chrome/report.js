import { download, saveHtml, saveJson } from './lib/export.js';
import { storage } from './lib/storage.js';
import mime from 'mime/lite';

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

async function init() {
  // Wire up cancel button once
  const cancelBtn = document.getElementById('cancelFetch');
  cancelBtn.onclick = cancelFetch;

  // Wire up debug toggle button
  document.getElementById('debugToggle').addEventListener('click', () => {
    const debugEl = document.getElementById('debugLog');
    const toggleBtn = document.getElementById('debugToggle');
    const isHidden = debugEl.classList.toggle('hidden');
    toggleBtn.classList.toggle('active', !isHidden);
    localStorage.setItem('showDebugLog', !isHidden);
  });
  
  const timemapData = await storage.get('timemapData');
  const crtshData = await storage.get('crtshData');

  if (timemapData) {
    _type = 'wayback';
    setTitle(`${timemapData.domain} - Wayback`);
    document.getElementById('stats').textContent = 'Loading...';
    await loadWayback(timemapData);
  } else if (crtshData) {
    _type = 'crtsh';
    setTitle(`${crtshData.domain} - Crt.sh`);
    document.getElementById('stats').textContent = 'Loading...';
    await loadCrtsh(crtshData);
  } else {
    showError('No data. Use context menu on a webpage.');
  }
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
      mime: r[3] || ''
    }));

    filteredData = [...rawData];

    const statusText = data.loading
      ? `${rawData.length} snapshots (loading more...)`
      : `${rawData.length} snapshots`;
    show(`${domain} - Wayback`, statusText);
    renderWaybackTable();
    setupWaybackFilters();
    setupSelection();
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
    document.getElementById('stats').innerHTML = '<span class="error">Cancelling...</span>';
  } else {
    // Fetch already complete, just hide button
    showCancelButton(false);
  }
}

function showError(msg) {
  document.getElementById('stats').innerHTML =
    `<span class="error">${msg}</span>`;
}

function showDebugLog(debugLog) {
  if (!debugLog) return;
  const debugEl = document.getElementById('debugLog');
  const toggleBtn = document.getElementById('debugToggle');
  
  // Show toggle button when there's debug content
  toggleBtn.classList.remove('hidden');
  debugEl.textContent = debugLog;
  
  // Apply stored visibility preference (default: hidden)
  const showDebug = localStorage.getItem('showDebugLog') === 'true';
  debugEl.classList.toggle('hidden', !showDebug);
  toggleBtn.classList.toggle('active', showDebug);
}

function show(title, stats) {
  setTitle(title);
  document.getElementById('stats').textContent = stats;
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
        <a href="${archiveUrl}" target="_blank" class="badge-action badge-action-archive" title="View archived snapshot">WARC</a>
        <a href="${row.url}" target="_blank" class="badge-action badge-action-live" title="View live page">LIVE</a>
      </td>
    `;
    tbody.appendChild(tr);
  });

  updateStats();
  
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
  const deleteBtn = document.getElementById('deleteSelected');
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

  // Pagination select-all checkboxes (delegated)
  document.addEventListener('change', (e) => {
    if (e.target.classList.contains('select-all-check')) {
      headerCheck.checked = e.target.checked;
      headerCheck.dispatchEvent(new Event('change'));
    }
  });

  // Delete selected
  deleteBtn.addEventListener('click', () => {
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

    // Recalculate pagination after deletion
    calculateTotalPages();
    renderWaybackTable();
    updateSelectionUI();
  });
}

function updateSelectionUI() {
  const deleteBtn = document.getElementById('deleteSelected');
  const headerCheck = document.getElementById('headerCheck');

  // Update all selected count spans
  document.querySelectorAll('.pagination-selected-count').forEach((span) => {
    span.textContent = selectedRows.size > 0 ? `${selectedRows.size} selected` : '';
  });

  if (selectedRows.size > 0) {
    deleteBtn.classList.remove('hidden');
  } else {
    deleteBtn.classList.add('hidden');
  }

  // Sync all checkboxes
  const allVisible = document.querySelectorAll('.row-check');
  const allChecked = allVisible.length > 0 && [...allVisible].every((cb) => cb.checked);
  headerCheck.checked = allChecked;
  document.querySelectorAll('.select-all-check').forEach((cb) => {
    cb.checked = allChecked;
  });
}

function updateStats() {
  const stats = document.getElementById('stats');
  if (filteredData.length === rawData.length) {
    stats.textContent = `${rawData.length} snapshots`;
  } else {
    stats.textContent = `${filteredData.length} of ${rawData.length} snapshots`;
  }
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
    container.classList.add('hidden');
    return;
  }
  
  container.classList.remove('hidden');
  
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

  // Select All Visible checkbox (inline with pagination)
  const selectLabel = document.createElement('label');
  selectLabel.className = 'pagination-select-all';
  const selectCheck = document.createElement('input');
  selectCheck.type = 'checkbox';
  selectCheck.id = containerId === 'paginationTop' ? 'selectAllTop' : 'selectAllBottom';
  selectCheck.className = 'select-all-check';
  selectCheck.setAttribute('aria-label', 'Select all visible snapshots');
  selectLabel.appendChild(selectCheck);
  selectLabel.appendChild(document.createTextNode(' Select All'));
  container.appendChild(selectLabel);

  // Selected count indicator
  const countSpan = document.createElement('span');
  countSpan.className = 'selected-count pagination-selected-count';
  countSpan.id = containerId === 'paginationTop' ? 'selectedCountTop' : 'selectedCountBottom';
  if (selectedRows.size > 0) {
    countSpan.textContent = `${selectedRows.size} selected`;
  }
  container.appendChild(countSpan);
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
  document.getElementById('saveHtml').onclick = () =>
    saveHtml(domain, '-wayback');
  document.getElementById('saveJson').onclick = () => {
    // Export current filtered data as JSON
    const exportData = filteredData.map((r) => ({
      url: r.url,
      timestamp: r.timestamp,
      status: r.status,
      mime: r.mime,
      archiveUrl: getArchiveUrl(r.url, r.timestamp)
    }));
    saveJson(domain, exportData, '-wayback');
  };

  const btn = document.getElementById('saveExtra');
  btn.textContent = 'Save MD';
  btn.classList.remove('hidden');
  btn.onclick = () => {
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
  };
}

function setupExportCrtsh() {
  document.getElementById('saveHtml').onclick = () =>
    saveHtml(domain, '-crtsh');
  document.getElementById('saveJson').onclick = () =>
    saveJson(domain, rawData, '-crtsh');
  const btn = document.getElementById('saveExtra');
  btn.textContent = 'Save CSV';
  btn.classList.remove('hidden');
  btn.onclick = () => {
    const header = 'id,logged_at,not_before,not_after,common_name,name_value';
    const rows = rawData.map((c) =>
      [
        c.id,
        c.entry_timestamp,
        c.not_before,
        c.not_after,
        c.common_name,
        `"${(c.name_value || '').replace(/"/g, '""')}"`
      ].join(',')
    );
    download([header, ...rows].join('\n'), `${domain}-crtsh.csv`, 'text/csv');
  };
}

init();
