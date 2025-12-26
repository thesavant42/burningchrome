// Bucket XML request handler
// Fetches bucket listing XML from current page and opens buckets.html

import { storage } from '../storage.js';

/**
 * Handle bucket request from context menu click
 * @param {chrome.tabs.Tab} tab - The tab where context menu was clicked
 */
export async function handleBucketRequest(tab) {
  const bucketUrl = tab.url;

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
    const response = await fetch(bucketUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const xmlText = await response.text();

    await storage.set('bucketData', {
      url: bucketUrl,
      xml: xmlText,
      loading: false,
      error: null,
      timestamp: Date.now()
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

