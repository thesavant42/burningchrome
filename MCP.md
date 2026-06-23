# Tips

## Building Well

- **Mandatory: Bump Sem Ver before testing is accepted**
  - Build the npm **any time** you change semver
    - `SemVer` is updated in `manifest.json` and `packages.json`
  - And then after that:

```powershell
Push-Location burning-chrome; npm run build
```

## Searching Efficiently

The project comes with `context7` mcp for updating docs, and `codebase-memory-mcp`, which indexes the code into a vector database. The project is indexed but must be updated with current project code.

### MCP codebase-memory-mcp

- Always use the mcp, it's way fast and safer on your context budget
- The project name is `C-Users-jbras-GitHub-burningchrome`
  - **with dashes instead of slashes**. Let me retry with the correct project name.

---

###

Now I have a clear picture of the call graph. Let me trace the flow:


- `init()` calls:

    `setupEventListeners()` - setup UI
    `loadCachedBucket()` - if view mode
    `checkForStoredBucket()` - check for context menu data
    `renderTable()` - render empty state
    `loadSavedReportsList()` is called by:

      `init()` - during page load (PROBLEM)
      `saveBucketToCache()` - after saving a bucket
      `handleDeleteSavedReport()` - after deleting a report
      `checkForStoredBucket()` calls:
          `storage.get()` - get bucketData
          `showError()` - show errors
          `loadBucketXml()` - load bucket XML
          `storage.remove()` - remove from storage

 - Now I need to trace where `loadSavedReportsList()` is actually invoked during initialization and understand the full call chain to identify the root cause.

### The Init Sequence Summary
Looking at the init sequence, I see it calls `setupEventListeners()`, then `loadSavedReportsList()`, then `loadCachedBucket()`, then `checkForStoredBucket()`, and finally `renderTable()`. 

- The problem is that `loadSavedReportsList()` is being called during `init`, which triggers `listBuckets()` and **causes a full table scan.**

 I need to check if `setupEventListeners()` is where this is being invoked, and then trace through `checkForStoredBucket()` to see how it handles the polling and data loading.

 
 ### The Flow
 The flow is: 
    - context menu sets `bucketData.loading = true` and opens `buckets.html`, 
        - which calls `checkForStoredBucket()`. 
        - It 
            - detects loading is `true`, 
            - starts polling every `500ms`,
            - and when complete,
                - calls `loadBucketXml()`
                    - which eventually triggers 
                        - `saveBucketToCache()` and
                        - `loadSavedReportsList()`.

- The real issue is that `loadSavedReportsList()` is being called during init when it shouldn't be, and I need to find where in the init flow this is happening and remove it from there.
- I'm tracing through the call graph to understand where loadSavedReportsList() gets invoked.

The query shows it's called from `init()`, `saveBucketToCache()`, and `handleDeleteSavedReport()`, but I need to verify the actual line numbers in the code since the graph data seems inconsistent with what I'm seeing in the file.

- Let me check the exact line where this function is called during initialization to understand the execution flow.
- I'm realizing the graph query might be returning approximate line ranges rather than exact call sites, so I need to search more carefully through the actual code to find where loadSavedReportsList() is being invoked during initialization.