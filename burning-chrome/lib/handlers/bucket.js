// Bucket XML request handler
// Fetches bucket listing XML from current page and opens buckets.html

import { storage } from '../storage.js';
import { cleanBucketUrl } from '../bucket-parser.js';

/**
 * Handle bucket request from context menu click
 * @param {chrome.tabs.Tab} tab - The tab where context menu was clicked
 */
export async function handleBucketRequest(tab) {
  const bucketUrl = cleanBucketUrl(tab.url);

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
    const response = await chrome.runtime.sendMessage({
      type: 'fetch-bucket',
      url: bucketUrl
    });

    if (response.error) {
      throw new Error(response.error);
    }

    await storage.set('bucketData', {
      url: bucketUrl,
      xml: response.xml,
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
