// Bucket XML request handler
// Fetches bucket listing XML from current page and opens buckets.html

import { storage } from '../storage.js';
import { cleanBucketUrl } from '../bucket-parser.js';
import { getBucket } from '../db.js';

/**
 * Handle bucket request from context menu click
 * @param {chrome.tabs.Tab} tab - The tab where context menu was clicked
 */
export async function handleBucketRequest(tab) {
  const bucketUrl = cleanBucketUrl(tab.url);

  // Check cache first
  const cached = await getBucket(bucketUrl);
  if (cached && cached.items && cached.items.length > 0) {
    console.log(`[DEBUG] Found cached bucket data for: ${bucketUrl}`);

    await storage.set('bucketData', {
      url: bucketUrl,
      cached: true,
      loading: false,
      error: null,
      timestamp: Date.now()
    });

    const bucketsPageUrl = chrome.runtime.getURL('buckets.html');
    await chrome.tabs.create({ url: bucketsPageUrl });
    return;
  }

  // No cache, proceed with fetch
  await storage.set('bucketData', {
    url: bucketUrl,
    xml: null,
    loading: true,
    error: null,
    timestamp: Date.now()
  });

  const bucketsPageUrl = chrome.runtime.getURL('buckets.html');
  await chrome.tabs.create({ url: bucketsPageUrl });

  try {
    let response = await fetch(bucketUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    let xmlText = await response.text();

    // Azure retry: if server header is Windows-Azure-Blob and body is blank, retry with &comp=list
    if (response.headers.get('server')?.toLowerCase().includes('windows-azure-blob') && !xmlText.trim()) {
      const azureUrl = bucketUrl.includes('?') ? `${bucketUrl}&comp=list` : `${bucketUrl}?comp=list`;
      response = await fetch(azureUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      xmlText = await response.text();
    }

    await storage.set('bucketData', {
      url: bucketUrl,
      xml: xmlText
    });
  } catch (error) {
    console.error('Bucket fetch failed:', error);
    await storage.set('bucketData', {
      url: bucketUrl,
      xml: null,
      loading: false,
      error: error.message,
      timestamp: Date.now()
    });
  }
}
