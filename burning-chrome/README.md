# Burning Chrome

Chrome extension for investigating public web data with quick, local reports.

## What it does

- Wayback Machine timemap reports
- crt.sh subdomain discovery
- Bucket indexing with table, tree, and stats views
- Saved reports and export helpers

## Dev

```bash
cd burning-chrome
npm install
npm run build
```

Load the `burning-chrome` folder as an unpacked extension in Chrome.

### Theme Workflow (Quick)

Use this when adding a new palette, for example Doki Rory.

- 1. Add a theme block in `styles.css` using the same variable keys:

```css
:root.theme-mytheme {
	--bg: #141417;
	--bg-alt: #1c1c22;
	--fg: #f2edf0;
	--comment: #9e8a90;
	--cyan: #d6d9e7;
	--green: #df8c96;
	--orange: #d49a7b;
	--pink: #b53241;
	--purple: #b7a4c8;
	--red: #8b2b36;
	--yellow: #e1bf9f;
}
```

- 2. Theme Select

Add an option to every `themeSelect` dropdown in these files:

- `landing.html`
- `buckets.html`
- `report.html`
- `config.html`
- `domains.html`
- `poi.html`
- `github.html`
- `dockerhub.html`
- `creds.html`

- Example option:

```html
<option value="mytheme">My Theme</option>
```

3. Theme names must match exactly:

- CSS class: `theme-mytheme`
- option value: `mytheme`

`theme.js` automatically applies `theme-<value>` and persists it via `localStorage`, so no JS changes are needed if names match.

4. Build and verify:

```powershell
& "C:\Program Files\nodejs\npm.cmd" --prefix "c:\Users\jbras\GitHub\burningchrome\burning-chrome" run build
```

5. Test in UI:

- Reload extension
- Select the new theme from any page
- Confirm it persists after navigation and refresh
- Confirm contrast/readability in table headers, buttons, links, and stats cards

## Notes

- Bundles are built with Rollup into `dist\`
- Extension version is defined in `manifest.json`

---;

BUG REPORT BEGINS HERE!

---;

## Problem Statement The Plugin does not load XML from the context menu any longer

- **This used to work**,
  - but then a change in how xml handling occurs seems to have interrupted this function.

### Searching Efficiently

The project comes with `context7` mcp for updating docs, and `codebase-memory-mcp`, which indexes the code into a vector database. The project is indexed but must be updated with current project code.

### MCP codebase-memory-mcp

- **Always use the codebase-memory-MCP**,
  - it's **way fast**
  - and safer on your context budget
- The project name is "C-Users-jbras-GitHub-burningchrome"
  - with **dashes instead of slashes**
  
### Flow, detailed

- Now I have a clear picture of the call graph. Let me trace the flow:

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

- The flow is:
  - context menu sets `bucketData.loading = true` and opens `buckets.html`,
    - which calls `checkForStoredBucket()`.
    - It:
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
