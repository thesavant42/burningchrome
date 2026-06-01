// Bucket XML request handler
// Fetches bucket listing XML from current page and opens buckets.html

import { storage } from '../storage.js';

/**
 * Handle bucket request from context menu click
 * @param {chrome.tabs.Tab} tab - The tab where context menu was clicked
 */
export async function handleBucketRequest(tab) {
  let bucketUrl = tab.url;

  // Clean URL: strip subresources (like ?acl)
  try {
    const urlObj = new URL(bucketUrl);
    const subresources = [
      'acl',
      'cors',
      'lifecycle',
      'policy',
      'location',
      'logging',
      'notification',
      'tagging',
      'encryption',
      'website',
      'versioning',
      'requestPayment',
      'object-lock',
      'uploads'
    ];
    subresources.forEach((sub) => urlObj.searchParams.delete(sub));
    if (!urlObj.hostname.includes('googleapis.com')) {
      urlObj.searchParams.set('list-type', '2');
    }
    bucketUrl = urlObj.toString();
  } catch (e) {
    console.warn('Failed to parse and clean bucketUrl:', bucketUrl, e);
  }

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
