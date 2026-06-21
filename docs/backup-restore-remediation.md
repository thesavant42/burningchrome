# Backup / Restore Remediation Plan

**Date:** 2026-06-21  
**Status:** Proposed  
**Scope:** `burning-chrome/lib/db.js`, `burning-chrome/buckets.js`

---

## 1. What Is Broken and Why

### 1.1 The Crash

`exportAllReports()` in `buckets.js` calls `exportStoreInChunks()`, which is **imported from `db.js` but does not exist there.** Every click of the backup button throws:

```
TypeError: exportStoreInChunks is not a function
```

The OOM crash the user experiences is from a **prior version** of this function that materialized entire store contents into the JS heap before the streaming rewrite was attempted. That prior version was removed, but the call site was never updated.

### 1.2 Dead Code Inventory

| Symbol | File | Lines | Why Dead |
|--------|------|-------|----------|
| `exportStoreInChunks` | `buckets.js` import (line 17) | — | Imported, never defined in `db.js` |
| `iterateStoreRecords` | `db.js` | 140–178 | Defined, never called (`in_degree: 0`) |
| `utf8Encoder` | `db.js` | 4 | Declared at module scope, never referenced |
| `_viewMode` | `buckets.js` | 32 | Set to `false`, never read |

### 1.3 Design Problems in `exportAllReports`

Even if `exportStoreInChunks` were fixed, the logic has fundamental problems:

- **`maxRecordsPerPart = 10`** — forces thousands of separate async writes for any real dataset. The timemap store for a single domain can hold tens of thousands of CDX rows.
- **Per-record `setTimeout(resolve, 0)` yield loops** — intended to prevent blocking but instead causes massive GC pressure and extends the operation across hundreds of microtask turns, making the browser appear frozen.
- **Handwritten JSON streaming** — manually writing `{`, `,`, `[`, `]` tokens into a writable stream. Any exception mid-write leaves a corrupt file with no recovery.
- **No restore path** — the entire backup flow is one-way. There is no import/restore function anywhere in the codebase.

---

## 2. What to Remove

### 2.1 From `burning-chrome/buckets.js`

**Remove from the import block (lines 13–18):**
```js
// REMOVE this line:
exportStoreInChunks
```
The corrected import block becomes:
```js
import {
  saveBucket,
  getBucket,
  deleteBucket,
  listBuckets,
  getDatabaseSummary
} from './lib/db.js';
```

**Remove the entire `exportAllReports` function (lines 1739–1878).**  
It will be replaced by the simpler `backupDatabase` function described in Section 3.

**Remove the dead variable (line 32):**
```js
// REMOVE:
let _viewMode = false;
```

**Remove the event listener wiring in `setupEventListeners`:**
```js
// REMOVE:
document
  .getElementById('exportAllReports')
  .addEventListener('click', exportAllReports);
```
Replace with wiring to the new `backupDatabase` function (see Section 3).

### 2.2 From `burning-chrome/lib/db.js`

**Remove dead declaration (line 4):**
```js
// REMOVE:
const utf8Encoder = new TextEncoder();
```

**Remove orphaned function `iterateStoreRecords` (lines 140–178).**  
It is never called. The new backup approach does not need cursor-based pagination.

---

## 3. The New Plan: Simple Backup and Restore

### Core Principle

The BurningChrome IndexedDB is **metadata storage for a browser extension**, not a data warehouse. Even with months of active use, the total serialized size of all stores will be well under 50 MB. There is no need for streaming, chunking, or pagination. The right approach is:

1. **Backup:** Read all stores into memory with `getAll()`, serialize to JSON, trigger a file download.
2. **Restore:** Read a backup file, parse JSON, write each record back with `put()`.

### 3.1 New Functions for `db.js`

Add two exported functions at the bottom of `burning-chrome/lib/db.js`:

```js
/**
 * Backup: export all IndexedDB stores to a plain JSON object.
 * Returns { dbName, dbVersion, exportedAt, stores: { [storeName]: [{key, value}, ...] } }
 */
export async function exportDatabase() {
  const db = await dbPromise;
  const storeNames = Array.from(db.objectStoreNames);
  const stores = {};

  for (const name of storeNames) {
    const tx = db.transaction(name, 'readonly');
    const keys = await tx.store.getAllKeys();
    const values = await tx.store.getAll();
    await tx.done;

    stores[name] = keys.map((key, i) => ({ key, value: values[i] }));
  }

  return {
    dbName: db.name,
    dbVersion: db.version,
    exportedAt: new Date().toISOString(),
    stores
  };
}

/**
 * Restore: import a backup object produced by exportDatabase().
 * Replaces all records in each store. Stores not present in the backup are untouched.
 * Returns { restored: { [storeName]: number } } — count of records written per store.
 */
export async function importDatabase(backup) {
  if (!backup || typeof backup.stores !== 'object') {
    throw new Error('Invalid backup format: missing "stores" key.');
  }

  const db = await dbPromise;
  const restored = {};

  for (const [storeName, records] of Object.entries(backup.stores)) {
    if (!db.objectStoreNames.contains(storeName)) {
      console.warn(`importDatabase: skipping unknown store "${storeName}"`);
      continue;
    }

    const tx = db.transaction(storeName, 'readwrite');
    await tx.store.clear();

    for (const { key, value } of records) {
      await tx.store.put(value, key);
    }

    await tx.done;
    restored[storeName] = records.length;
  }

  return { restored };
}
```

### 3.2 New Backup Function for `buckets.js`

Replace `exportAllReports` with this function:

```js
async function backupDatabase() {
  const btn = document.getElementById('exportAllReports');
  const statusEl = document.getElementById('loadingStatus');

  try {
    if (btn) btn.disabled = true;
    if (statusEl) statusEl.textContent = 'Reading database...';

    const backup = await exportDatabase();

    const totalRecords = Object.values(backup.stores)
      .reduce((sum, records) => sum + records.length, 0);

    if (totalRecords === 0) {
      alert('No data to back up.');
      return;
    }

    const filename = `burningchrome-backup-${backup.exportedAt.split('T')[0]}.json`;
    const json = JSON.stringify(backup, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);

    if (statusEl) {
      statusEl.textContent = `Backup complete: ${totalRecords} records saved.`;
      setTimeout(() => { statusEl.textContent = ''; }, 4000);
    }
  } catch (err) {
    if (statusEl) statusEl.textContent = `Backup failed: ${err.message}`;
  } finally {
    if (btn) btn.disabled = false;
  }
}
```

### 3.3 New Restore Function for `buckets.js`

Add this function and wire it to a restore button in the UI:

```js
async function restoreDatabase() {
  const statusEl = document.getElementById('loadingStatus');

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';

  input.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      if (statusEl) statusEl.textContent = 'Reading backup file...';

      const text = await file.text();
      const backup = JSON.parse(text);

      if (
        !confirm(
          `Restore ${file.name}?\n\nThis will overwrite all current data.\nThis cannot be undone.`
        )
      ) {
        if (statusEl) statusEl.textContent = '';
        return;
      }

      if (statusEl) statusEl.textContent = 'Restoring...';

      const result = await importDatabase(backup);
      const total = Object.values(result.restored).reduce((s, n) => s + n, 0);

      if (statusEl) {
        statusEl.textContent = `Restored ${total} records. Reload the page to see changes.`;
      }

      // Refresh the saved reports dropdown
      await loadSavedReportsList();
    } catch (err) {
      if (statusEl) statusEl.textContent = `Restore failed: ${err.message}`;
    }
  });

  input.click();
}
```

### 3.4 Updated Import Block for `buckets.js`

```js
import {
  saveBucket,
  getBucket,
  deleteBucket,
  listBuckets,
  getDatabaseSummary,
  exportDatabase,
  importDatabase
} from './lib/db.js';
```

### 3.5 Event Listener Wiring in `setupEventListeners`

```js
// Backup (replaces old exportAllReports listener)
document
  .getElementById('exportAllReports')
  .addEventListener('click', backupDatabase);

// Restore (add a "Restore Backup" button to buckets.html)
document
  .getElementById('restoreBackup')
  .addEventListener('click', restoreDatabase);
```

### 3.6 HTML Change for Restore Button (`buckets.html`)

Add a restore button near the existing backup button. Exact placement TBD by the developer, but the element needed is:

```html
<button id="restoreBackup" class="btn-action">Restore Backup</button>
```

---

## 4. Summary of Changes

| File | Action |
|------|--------|
| `lib/db.js` | Remove `utf8Encoder` (line 4), remove `iterateStoreRecords` (lines 140–178), **add** `exportDatabase()`, **add** `importDatabase()` |
| `buckets.js` | Fix import block (remove `exportStoreInChunks`), remove `_viewMode`, remove `exportAllReports` (lines 1739–1878), **add** `backupDatabase()`, **add** `restoreDatabase()`, update event listener wiring |
| `buckets.html` | Add `id="restoreBackup"` button |

**Net change:** ~140 lines removed, ~80 lines added. No new dependencies.

---

## 5. Why This Approach Is Safe

- `db.getAll()` is a single indexed transaction — Chrome handles it efficiently, same as the browser does when loading the extension popup.
- `JSON.stringify` of extension-scale data (< 50 MB) is synchronous and fast; it will not block the browser in any meaningful way.
- `Blob` + `URL.createObjectURL` is the established, safe pattern already used by every other export function in this project (`exportJsonData`, `exportCsvData`, `exportWgetData`).
- The restore uses a `<input type="file">` — no permissions, no CSP issues, no File System Access API quirks.
- Both functions are ~20 lines each. They can be read, tested, and reasoned about in 30 seconds.
