import { openDB } from 'idb';

const DB_NAME = 'BurningChromeDB';
const DB_VERSION = 1;

const dbPromise = openDB(DB_NAME, DB_VERSION, {
  upgrade(db) {
    if (!db.objectStoreNames.contains('timemap')) {
      db.createObjectStore('timemap');
    }
    if (!db.objectStoreNames.contains('crtsh')) {
      db.createObjectStore('crtsh');
    }
    if (!db.objectStoreNames.contains('meta')) {
      db.createObjectStore('meta');
    }
  }
});

// Timemap operations (keyed by domain)
export async function saveTimemap(domain, data) {
  const db = await dbPromise;
  return db.put('timemap', data, domain);
}

export async function getTimemap(domain) {
  const db = await dbPromise;
  return db.get('timemap', domain);
}

export async function deleteTimemap(domain) {
  const db = await dbPromise;
  return db.delete('timemap', domain);
}

// Crtsh operations (keyed by domain)
export async function saveCrtsh(domain, data) {
  const db = await dbPromise;
  return db.put('crtsh', data, domain);
}

export async function getCrtsh(domain) {
  const db = await dbPromise;
  return db.get('crtsh', domain);
}

export async function deleteCrtsh(domain) {
  const db = await dbPromise;
  return db.delete('crtsh', domain);
}

// Meta operations (loading state, keyed by 'timemap' or 'crtsh')
export async function saveMeta(key, value) {
  const db = await dbPromise;
  return db.put('meta', value, key);
}

export async function getMeta(key) {
  const db = await dbPromise;
  return db.get('meta', key);
}

export async function deleteMeta(key) {
  const db = await dbPromise;
  return db.delete('meta', key);
}

