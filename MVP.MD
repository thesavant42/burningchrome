

MVP for buckets:

Fetch a bucket URL (S3/GCS)
Parse the XML listing
Display objects in a table with key, size, last modified
Paginate results (50 per page)
Filter by search string
Export as JSON, CSV, or wget URLs
Tree view - hierarchical directory structure
Stats view - directory-level statistics
Cache bucket data in IndexedDB for offline access
That's it. The rest is bloat.
---

Chrome extension layer MVP:

Manifest - permissions for contextMenus, storage, scripting + host_permissions for web.archive.org, crt.sh, and *://*/* for bucket URLs
Background service worker - handles fetch requests to bucket URLs (proxying CORS), manages IndexedDB cache
Context menu - right-click on bucket page to index it
Buckets page - HTML/JS for fetching, parsing, displaying bucket listings
Theme system - CSS variables + localStorage persistence
Storage layer - IndexedDB for caching bucket XML data
Export helpers - JSON, CSV, wget URL generation, ZIP packaging
That's the plugin layer. Everything else (reporting, shodan, virustotal, dockerhub, github, creds, domains, poi) is bloat relative to buckets.

---

