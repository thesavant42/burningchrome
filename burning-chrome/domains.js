import { getProject, saveProject, apiKeys } from './lib/storage.js';

let project = null;
let currentDomain = null;

async function init() {
  const params = new URLSearchParams(window.location.search);
  const projectName = params.get('project');
  
  if (!projectName) {
    alert('No project specified');
    window.location.href = 'landing.html';
    return;
  }
  
  project = await getProject(projectName);
  
  if (!project) {
    project = { name: projectName, createdAt: Date.now(), domains: [] };
    await saveProject(project);
  }
  
  document.getElementById('title').textContent = project.name;
  document.title = `${project.name} - Burning Chrome`;
  
  renderDomains();
  setupEventListeners();
}

function renderDomains() {
  const tbody = document.getElementById('domainsBody');
  const table = document.getElementById('domainsTable');
  const emptyEl = document.getElementById('emptyState');
  const statsEl = document.getElementById('domainStats');
  
  tbody.innerHTML = '';
  
  if (!project.domains || project.domains.length === 0) {
    table.classList.add('hidden');
    emptyEl.classList.remove('hidden');
    statsEl.textContent = '';
    return;
  }
  
  table.classList.remove('hidden');
  emptyEl.classList.add('hidden');
  
  const totalDomains = project.domains.length;
  const uniqueSubs = new Set();
  project.domains.forEach(d => (d.subdomains || []).forEach(s => uniqueSubs.add(s.name)));
  statsEl.textContent = ` | ${totalDomains} domains, ${uniqueSubs.size} unique subdomains`;
  
  project.domains.forEach(domain => {
    const tr = document.createElement('tr');
    const subCount = domain.subdomains?.length || 0;
    
    tr.innerHTML = `
      <td><a href="#" class="domain-link" data-domain="${escapeHtml(domain.name)}">${escapeHtml(domain.name)}</a></td>
      <td>${subCount}</td>
      <td>
        <select class="enumerate-select" data-domain="${escapeHtml(domain.name)}">
          <option value="">Enumerate...</option>
          <option value="virustotal">VirusTotal</option>
          <option value="crtsh">crt.sh</option>
        </select>
        <button class="cdx-btn" data-domain="${escapeHtml(domain.name)}">CDX</button>
        <button class="delete-btn danger" data-domain="${escapeHtml(domain.name)}">X</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function setupEventListeners() {
  document.getElementById('addDomain').addEventListener('click', addDomain);
  document.getElementById('domainInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addDomain();
  });
  
  document.getElementById('domainsBody').addEventListener('click', handleDomainClick);
  document.getElementById('domainsBody').addEventListener('change', handleEnumerateChange);
  document.getElementById('closePanel').addEventListener('click', () => {
    document.getElementById('subdomainPanel').classList.add('hidden');
    currentDomain = null;
  });
  document.getElementById('subdomainsBody').addEventListener('click', handleSubdomainClick);
}

async function addDomain() {
  const input = document.getElementById('domainInput');
  let domainName = input.value.trim().toLowerCase();
  
  if (!domainName) {
    alert('Please enter a domain name');
    return;
  }
  
  domainName = domainName.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  
  if (project.domains.find(d => d.name === domainName)) {
    alert('Domain already exists');
    return;
  }
  
  project.domains.push({ name: domainName, subdomains: [] });
  await saveProject(project);
  input.value = '';
  renderDomains();
}

async function handleDomainClick(e) {
  const domainName = e.target.dataset.domain;
  if (!domainName) return;
  
  if (e.target.classList.contains('domain-link')) {
    e.preventDefault();
    showSubdomainPanel(domainName);
    return;
  }
  
  if (e.target.classList.contains('cdx-btn')) {
    chrome.runtime.sendMessage({ type: 'cdx-scan', domain: domainName });
    return;
  }
  
  if (e.target.classList.contains('delete-btn')) {
    if (confirm(`Remove "${domainName}"?`)) {
      project.domains = project.domains.filter(d => d.name !== domainName);
      await saveProject(project);
      renderDomains();
    }
  }
}

async function handleEnumerateChange(e) {
  if (!e.target.classList.contains('enumerate-select')) return;
  
  const source = e.target.value;
  const domainName = e.target.dataset.domain;
  if (!source || !domainName) return;
  
  e.target.value = '';
  await enumerateSubdomains(domainName, source);
}

async function enumerateSubdomains(domainName, source) {
  const domain = project.domains.find(d => d.name === domainName);
  if (!domain) return;
  
  if (source === 'virustotal') {
    const vtKey = await apiKeys.get('virustotal');
    if (!vtKey) {
      alert('VirusTotal API key not configured. Go to Config.');
      return;
    }
  }
  
  const statsEl = document.getElementById('domainStats');
  const originalStatus = statsEl.textContent;
  statsEl.textContent = ` | Enumerating ${domainName} via ${source}...`;
  
  try {
    let results;
    
    if (source === 'virustotal') {
      const vtKey = await apiKeys.get('virustotal');
      results = await chrome.runtime.sendMessage({
        type: 'vt-subdomains',
        domain: domainName,
        apiKey: vtKey
      });
    } else {
      results = await chrome.runtime.sendMessage({
        type: 'crtsh-subdomains',
        domain: domainName
      });
    }
    
    if (results.error) throw new Error(results.error);
    
    const existingNames = new Set((domain.subdomains || []).map(s => s.name));
    const newSubs = results.filter(s => !existingNames.has(s.name));
    domain.subdomains = [...(domain.subdomains || []), ...newSubs];
    
    await saveProject(project);
    renderDomains();
    statsEl.textContent = originalStatus;
    alert(`Found ${results.length} subdomains (${newSubs.length} new)`);
  } catch (err) {
    statsEl.textContent = originalStatus;
    alert(`Enumeration failed: ${err.message}`);
  }
}

function showSubdomainPanel(domainName) {
  const domain = project.domains.find(d => d.name === domainName);
  if (!domain) return;
  
  currentDomain = domain;
  document.getElementById('panelTitle').textContent = `Subdomains of ${domainName}`;
  document.getElementById('subdomainPanel').classList.remove('hidden');
  
  const tbody = document.getElementById('subdomainsBody');
  tbody.innerHTML = '';
  
  if (!domain.subdomains || domain.subdomains.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3">No subdomains. Use Enumerate.</td></tr>';
    return;
  }
  
  domain.subdomains.forEach(sub => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(sub.name)}</td>
      <td>${sub.source}</td>
      <td><button class="cdx-btn" data-subdomain="${escapeHtml(sub.name)}">CDX</button></td>
    `;
    tbody.appendChild(tr);
  });
}

function handleSubdomainClick(e) {
  if (e.target.classList.contains('cdx-btn')) {
    const subdomain = e.target.dataset.subdomain;
    if (subdomain) chrome.runtime.sendMessage({ type: 'cdx-scan', domain: subdomain });
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

init();

