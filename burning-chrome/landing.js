import { getProjects, saveProject, deleteProject } from './lib/storage.js';

async function init() {
  await renderProjects();
  setupEventListeners();
}

async function renderProjects() {
  const projects = await getProjects();
  const table = document.getElementById('projectTable');
  const tbody = document.getElementById('projectBody');
  const emptyEl = document.getElementById('emptyState');
  
  tbody.innerHTML = '';
  
  if (projects.length === 0) {
    table.classList.add('hidden');
    emptyEl.classList.remove('hidden');
    return;
  }
  
  table.classList.remove('hidden');
  emptyEl.classList.add('hidden');
  
  // Sort by createdAt descending (newest first)
  projects.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  
  projects.forEach(project => {
    const tr = document.createElement('tr');
    const domainCount = project.domains?.length || 0;
    const subdomainCount = project.domains?.reduce((sum, d) => sum + (d.subdomains?.length || 0), 0) || 0;
    
    tr.innerHTML = `
      <td><a href="domains.html?project=${encodeURIComponent(project.name)}">${escapeHtml(project.name)}</a></td>
      <td>${domainCount}</td>
      <td>${subdomainCount}</td>
      <td>
        <button class="open-btn" data-project="${escapeHtml(project.name)}">Open</button>
        <button class="delete-btn danger" data-project="${escapeHtml(project.name)}">Delete</button>
      </td>
    `;
    
    tbody.appendChild(tr);
  });
}

function setupEventListeners() {
  document.getElementById('createProject').addEventListener('click', createProject);
  document.getElementById('projectName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') createProject();
  });
  
  document.getElementById('projectBody').addEventListener('click', async (e) => {
    const projectName = e.target.dataset.project;
    if (!projectName) return;
    
    if (e.target.classList.contains('open-btn')) {
      window.location.href = `domains.html?project=${encodeURIComponent(projectName)}`;
    }
    
    if (e.target.classList.contains('delete-btn')) {
      if (confirm(`Delete project "${projectName}"?`)) {
        await deleteProject(projectName);
        await renderProjects();
      }
    }
  });
}

async function createProject() {
  const input = document.getElementById('projectName');
  const name = input.value.trim();
  
  if (!name) {
    alert('Please enter a project name');
    return;
  }
  
  const existing = await getProjects();
  if (existing.find(p => p.name.toLowerCase() === name.toLowerCase())) {
    alert('A project with that name already exists');
    return;
  }
  
  const project = { name, createdAt: Date.now(), domains: [] };
  await saveProject(project);
  window.location.href = `domains.html?project=${encodeURIComponent(name)}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

init();

