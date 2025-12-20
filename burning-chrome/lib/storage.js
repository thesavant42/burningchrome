import { get, set, del, createStore } from 'idb-keyval';

const store = createStore('burning-chrome-db', 'data-store');

export const storage = {
  async get(key) {
    return get(key, store);
  },
  async set(key, value) {
    return set(key, value, store);
  },
  async remove(key) {
    return del(key, store);
  }
};

// Project operations (IndexedDB)
export async function getProjects() {
  return await get('projects', store) || [];
}

export async function saveProject(project) {
  const projects = await getProjects();
  const idx = projects.findIndex(p => p.name === project.name);
  if (idx >= 0) {
    projects[idx] = project;
  } else {
    projects.push(project);
  }
  await set('projects', projects, store);
}

export async function getProject(name) {
  const projects = await getProjects();
  return projects.find(p => p.name === name) || null;
}

export async function deleteProject(name) {
  const projects = await getProjects();
  const filtered = projects.filter(p => p.name !== name);
  await set('projects', filtered, store);
}

// API Keys (Chrome Local Storage - persists across projects)
export const apiKeys = {
  async get(service) {
    const data = await chrome.storage.local.get('apiKeys');
    return data?.apiKeys?.[service] || null;
  },
  async set(service, key) {
    const data = await chrome.storage.local.get('apiKeys');
    const apiKeys = data?.apiKeys || {};
    apiKeys[service] = key;
    await chrome.storage.local.set({ apiKeys });
  },
  async getAll() {
    const data = await chrome.storage.local.get('apiKeys');
    return data?.apiKeys || {};
  },
  async remove(service) {
    const data = await chrome.storage.local.get('apiKeys');
    const apiKeys = data?.apiKeys || {};
    delete apiKeys[service];
    await chrome.storage.local.set({ apiKeys });
  }
};

