# Loading Sequence Entity Diagram

## Entities

```
┌─────────────────────────────────────────────────────────────────┐
│                        PAGE LAYER                               │
├─────────────────────────────────────────────────────────────────┤
│  buckets.html                                                   │
│    ├── loads: buckets.js (module)                               │
│    ├── contains: #savedReportsSelect (dropdown)                 │
│    ├── contains: #fetchBucket (button)                          │
│    ├── contains: #exportAllReports (button)                     │
│    └── contains: #importXmlBtn (button)                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      INITIALIZATION LAYER                       │
├─────────────────────────────────────────────────────────────────┤
│  buckets.js                                                     │
│    ├── init()                                                    │
│    │    ├── sets extVersion                                     │
│    │    ├── parses URL params (project, view)                   │
│    │    ├── updates nav links                                   │
│    │    ├── setupEventListeners()                                │
│    │    │    ├── fetchBucket button → fetchBucketFromUrl()       │
│    │    │    ├── savedReportsSelect → handleSavedReportChange()  │
│    │    │    ├── deleteSavedReport → handleDeleteSavedReport()   │
│    │    │    └── exportAllReports → backupDatabase()             │
│    │    ├── if viewUrl → loadCachedBucket(viewUrl)              │
│    │    └── checkForStoredBucket()                              │
│    │         └── storage.get('bucketData')                      │
│    │              └── if data.xml → loadBucketXml()             │
│    └── saveBucketToCache()                                      │
│         └── calls loadSavedReportsList()  ← PROBLEM             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      STORAGE LAYER                              │
├─────────────────────────────────────────────────────────────────┤
│  lib/storage.js                                                 │
│    ├── storage.get('bucketData')  ← context menu data           │
│    └── storage.set('bucketData')  ← context menu data           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      DATABASE LAYER                             │
├─────────────────────────────────────────────────────────────────┤
│  lib/db.js (IndexedDB: BurningChromeDB)                         │
│    ├── saveBucket(url, data)                                    │
│    ├── getBucket(url)                                           │
│    ├── deleteBucket(url)                                        │
│    ├── listBuckets()  ← returns all bucket URLs                 │
│    │    └── db.getAllKeys('buckets')  ← reads ALL keys          │
│    └── saveTimemap(domain, data)                                │
│        └── db.put('timemap', data, domain)                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      DATA LAYER                                 │
├─────────────────────────────────────────────────────────────────┤
│  IndexedDB: BurningChromeDB                                     │
│    Store: 'buckets'                                             │
│    └── keyed by: bucket URL                                     │
│        ├── url                                                  │
│        ├── bucketName                                           │
│        ├── items[]  ← array of parsed XML items                 │
│        └── savedAt                                              │
│    Store: 'timemap'                                             │
│    └── keyed by: domain                                         │
│        ├── data[]  ← CDX rows                                   │
│        ├── fetchedAt                                            │
│        └── partial                                              │
└─────────────────────────────────────────────────────────────────┘
```

## Loading Sequence Flow

```
Page Load (buckets.html)
        │
        ▼
┌─────────────────┐
│  init()         │
│  (buckets.js)   │
└────────┬────────┘
         │
         ├──► setupEventListeners()
         │      │
         │      ├── saves handlers for:
         │      │   - #fetchBucket (click)
         │      │   - #savedReportsSelect (change)
         │      │   - #deleteSavedReport (click)
         │      │   - #exportAllReports (click)
         │      │   - #importXmlBtn (click)
         │      │   - #searchInput (input)
         │      │   - sort headers (click)
         │      │
         │      └── NO call to loadSavedReportsList()
         │
         ├──► if viewUrl param → loadCachedBucket(viewUrl)
         │         │
         │         └──► getBucket(viewUrl)  [IndexedDB]
         │
         └──► checkForStoredBucket()
                │
                └──► storage.get('bucketData')
                       │
                       └──► if data.xml → loadBucketXml(url, xml)
                              │
                              └──► parseBucketXml(xml)
                                     │
                                     └──► loadBucketXml(url, xml)
                                            │
                                            ├──► allItems = parsed items
                                            ├──► renderTable()
                                            ├──► updateDataDependentControls()
                                            └──► saveBucketToCache()  ← CALLS loadSavedReportsList()
                                                   │
                                                   └──► saveBucket(url, data)  [IndexedDB]
                                                          │
                                                          └──► loadSavedReportsList()  ← PROBLEM: loads ALL bucket URLs
                                                                 │
                                                                 └──► listBuckets()  [IndexedDB]
                                                                        │
                                                                        └──► db.getAllKeys('buckets')
                                                                               │
                                                                               └─── reads ALL bucket keys from DB ───┐
                                                                                                               │
                                                                                                               ▼
                                                                                                      Dropdown populates
                                                                                                      (blocks UI)
```

## Problem: loadSavedReportsList() Called on Every Save

### Call Chain
```
init()
  └──► checkForStoredBucket()
        └──► loadBucketXml()
              └──► saveBucketToCache()
                    └──► loadSavedReportsList()  ← PROBLEM
```

### Why It's Bad
1. **Every bucket fetch triggers a full DB scan** — `listBuckets()` calls `db.getAllKeys('buckets')` which reads ALL bucket URLs from IndexedDB
2. **With 3GB of data**, this is a massive blocking operation
3. **The dropdown is disabled by default** — so the user never sees the loaded data unless they interact with it
4. **The load happens synchronously during init** — blocks the entire page from rendering

### Where It's Called
| Location | File | Line | Context |
|----------|------|------|---------|
| `saveBucketToCache()` | buckets.js | 512 | After saving a bucket — triggers on every fetch |
| `handleDeleteSavedReport()` | buckets.js | 1685 | After deleting a report |

### What Should Happen
- Reports should only load when the user **deliberately** interacts with the dropdown
- NOT on page load
- NOT on every bucket save
- Only when the user clicks/selects the dropdown or explicitly triggers a load