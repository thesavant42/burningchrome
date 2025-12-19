import { download, saveHtml, saveJson } from './lib/export.js';
import mime from 'mime/lite';

let _type = '';
let domain = '';
let rawData = [];
let filteredData = [];
let selectedRows = new Set();

async function init() {
  const result = await chrome.storage.local.get(['timemapData', 'crtshData']);

  if (result.timemapData) {
    _type = 'wayback';
    setTitle(`${result.timemapData.domain} - Wayback`);
    document.getElementById('stats').textContent = 'Loading...';
    await loadWayback(result.timemapData);
  } else if (result.crtshData) {
    _type = 'crtsh';
    setTitle(`${result.crtshData.domain} - Crt.sh`);
    document.getElementById('stats').textContent = 'Loading...';
    await loadCrtsh(result.crtshData);
  } else {
    showError('No data. Use context menu on a webpage.');
  }
}

async function loadWayback(data) {
  domain = data.domain;
  setTitle(`${domain} - Wayback`);

  // Always show debug log if present
  showDebugLog(data.debugLog);

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

  await chrome.storage.local.remove('timemapData');
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
  await chrome.storage.local.remove('crtshData');
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
  setTimeout(init, 500);
}

function showError(msg) {
  document.getElementById('stats').innerHTML =
    `<span class="error">${msg}</span>`;
}

function showDebugLog(debugLog) {
  if (!debugLog) return;
  const debugEl = document.getElementById('debugLog');
  debugEl.classList.remove('hidden');
  debugEl.textContent = debugLog;
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

// Render the Wayback table with all metadata
function renderWaybackTable() {
  const table = document.getElementById('waybackTable');
  const tbody = document.getElementById('waybackBody');
  table.classList.remove('hidden');
  tbody.innerHTML = '';

  filteredData.forEach((row) => {
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
        <a href="${archiveUrl}" target="_blank" class="badge-action badge-action-archive" title="View archived snapshot">ARC</a>
        <a href="${row.url}" target="_blank" class="badge-action badge-action-live" title="View live page">LIV</a>
      </td>
    `;
    tbody.appendChild(tr);
  });

  updateStats();
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

    renderWaybackTable();
  };

  searchInput.addEventListener('input', applyFilters);
  statusFilter.addEventListener('change', applyFilters);
  mimeFilter.addEventListener('change', applyFilters);
}

function setupSelection() {
  const headerCheck = document.getElementById('headerCheck');
  const selectAllCheck = document.getElementById('selectAll');
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

  // Select All Visible label checkbox
  selectAllCheck.addEventListener('change', () => {
    headerCheck.checked = selectAllCheck.checked;
    headerCheck.dispatchEvent(new Event('change'));
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

    renderWaybackTable();
    updateSelectionUI();
  });
}

function updateSelectionUI() {
  const deleteBtn = document.getElementById('deleteSelected');
  const countSpan = document.getElementById('selectedCount');
  const selectAllCheck = document.getElementById('selectAll');
  const headerCheck = document.getElementById('headerCheck');

  if (selectedRows.size > 0) {
    deleteBtn.classList.remove('hidden');
    countSpan.textContent = `${selectedRows.size} selected`;
  } else {
    deleteBtn.classList.add('hidden');
    countSpan.textContent = '';
  }

  // Sync checkboxes
  const allVisible = document.querySelectorAll('.row-check');
  const allChecked =
    allVisible.length > 0 && [...allVisible].every((cb) => cb.checked);
  headerCheck.checked = allChecked;
  selectAllCheck.checked = allChecked;
}

function updateStats() {
  const stats = document.getElementById('stats');
  if (filteredData.length === rawData.length) {
    stats.textContent = `${rawData.length} snapshots`;
  } else {
    stats.textContent = `${filteredData.length} of ${rawData.length} snapshots`;
  }
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
