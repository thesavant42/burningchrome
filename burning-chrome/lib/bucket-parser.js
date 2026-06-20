// Bucket XML Parser - Parse S3/GCS ListBucketResult and Azure EnumerationResults XML

/**
 * Normalize and clean bucket/container URLs for S3, GCS, or Azure Blob Storage
 * @param {string} url
 * @returns {string}
 */
export function cleanBucketUrl(url) {
  // Ensure URL has a protocol - default to https:// if missing
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }

  try {
    const urlObj = new URL(url);
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

    const isAzure = urlObj.hostname.includes('blob.core.windows.net') ||
                    urlObj.searchParams.get('restype') === 'container' ||
                    urlObj.searchParams.get('comp') === 'list';

    if (isAzure) {
      urlObj.searchParams.set('restype', 'container');
      urlObj.searchParams.set('comp', 'list');
      urlObj.searchParams.delete('list-type');
    } else if (!urlObj.hostname.includes('googleapis.com')) {
      urlObj.searchParams.set('list-type', '2');
    }
    return urlObj.toString();
  } catch (e) {
    console.warn('[DEBUG] Failed to parse/clean URL:', url, e);
    return url;
  }
}

/**
 * Parse bucket listing XML and extract items
 * @param {string} xmlText - Raw XML string
 * @returns {{ bucketName: string, items: Array, isTruncated: boolean, nextContinuationToken: string|null, nextMarker: string|null, error: string|null }}
 */
export function parseBucketXml(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'text/xml');

  const errorNode = doc.querySelector('parsererror');
  if (errorNode) {
    return {
      bucketName: '',
      items: [],
      isTruncated: false,
      nextContinuationToken: null,
      nextMarker: null,
      error: 'Invalid XML format'
    };
  }

  // Check if it is an Azure Storage Error or standard Error response
  if (doc.documentElement.nodeName === 'Error') {
    const code = doc.getElementsByTagName('Code')[0]?.textContent;
    const message = doc.getElementsByTagName('Message')[0]?.textContent;
    return {
      bucketName: '',
      items: [],
      isTruncated: false,
      nextContinuationToken: null,
      nextMarker: null,
      error: message || code || 'Storage Error'
    };
  }

  // Check if it is Azure XML
  const isAzure = doc.documentElement.nodeName === 'EnumerationResults';

  if (isAzure) {
    const bucketName = doc.documentElement.getAttribute('ContainerName') || 'Azure Container';
    const blobs = doc.getElementsByTagName('Blob');
    const items = Array.from(blobs).map((b, idx) => {
      const properties = b.getElementsByTagName('Properties')[0];
      return {
        id: idx,
        key: b.getElementsByTagName('Name')[0]?.textContent || '',
        size: parseInt(
          properties?.getElementsByTagName('Content-Length')[0]?.textContent ||
          b.getElementsByTagName('Content-Length')[0]?.textContent || '0',
          10
        ),
        lastModified:
          properties?.getElementsByTagName('Last-Modified')[0]?.textContent ||
          b.getElementsByTagName('Last-Modified')[0]?.textContent || ''
      };
    });

    const nextMarker = doc.getElementsByTagName('NextMarker')[0]?.textContent || null;
    const isTruncated = !!nextMarker;

    return {
      bucketName,
      items,
      isTruncated,
      nextContinuationToken: null,
      nextMarker,
      error: null
    };
  }

  // Extract bucket name from <Name> element (use getElementsByTagName for namespace support)
  const bucketName =
    doc.getElementsByTagName('Name')[0]?.textContent || 'Unknown Bucket';

  // Extract all <Contents> elements (getElementsByTagName ignores namespaces)
  const contents = doc.getElementsByTagName('Contents');
  const items = Array.from(contents).map((c, idx) => ({
    id: idx,
    key: c.getElementsByTagName('Key')[0]?.textContent || '',
    size: parseInt(c.getElementsByTagName('Size')[0]?.textContent || '0', 10),
    lastModified: c.getElementsByTagName('LastModified')[0]?.textContent || ''
  }));

  // Extract pagination info
  const isTruncatedNode = doc.getElementsByTagName('IsTruncated')[0];
  const isTruncated = isTruncatedNode
    ? isTruncatedNode.textContent.trim().toLowerCase() === 'true'
    : false;

  const nextContinuationToken =
    doc.getElementsByTagName('NextContinuationToken')[0]?.textContent || null;
  const nextMarker =
    doc.getElementsByTagName('NextMarker')[0]?.textContent || null;

  return {
    bucketName,
    items,
    isTruncated,
    nextContinuationToken,
    nextMarker,
    error: null
  };
}

/**
 * Build download URL for a bucket item
 * @param {string} baseUrl - Bucket base URL
 * @param {string} key - Object key
 * @returns {string}
 */
export function buildDownloadUrl(baseUrl, key) {
  if (!baseUrl) return '#';
  const base = baseUrl.replace(/\?.*$/, '').replace(/\/$/, '');
  // Encode each path segment individually to preserve forward slashes
  const encodedKey = key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${base}/${encodedKey}`;
}

/**
 * Format bytes to human-readable size
 * @param {number} bytes
 * @returns {string}
 */
export function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * Format ISO date string to YYYY-MM-DD
 * @param {string} isoString
 * @returns {string}
 */
export function formatDate(isoString) {
  if (!isoString) return '';
  return isoString.split('T')[0];
}

/**
 * Escape HTML special characters
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
