import { openDB } from 'idb';

const DB_NAME = 'BurningChromeDB';
const DB_VERSION = 2;

const dbPromise = openDB(DB_NAME, DB_VERSION, {
  upgrade(db, oldVersion) {
    // Version 1 stores
    if (oldVersion < 1) {
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
    // Version 2: Add buckets store
    if (oldVersion < 2) {
      if (!db.objectStoreNames.contains('buckets')) {
        db.createObjectStore('buckets');
      }
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

// Bucket operations (keyed by URL)
export async function saveBucket(url, data) {
  const db = await dbPromise;
  return db.put('buckets', data, url);
}

export async function getBucket(url) {
  const db = await dbPromise;
  return db.get('buckets', url);
}

export async function deleteBucket(url) {
  const db = await dbPromise;
  return db.delete('buckets', url);
}

export async function listBuckets() {
  const db = await dbPromise;
  return db.getAllKeys('buckets');
}

