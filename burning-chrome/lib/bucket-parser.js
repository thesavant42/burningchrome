// Bucket XML Parser - Parse S3/GCS ListBucketResult XML

/**
 * Parse bucket listing XML and extract items
 * @param {string} xmlText - Raw XML string
 * @returns {{ bucketName: string, items: Array, error: string|null }}
 */
export function parseBucketXml(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'text/xml');
  
  const errorNode = doc.querySelector('parsererror');
  if (errorNode) {
    return { bucketName: '', items: [], error: 'Invalid XML format' };
  }
  
  // Extract bucket name from <Name> element (use getElementsByTagName for namespace support)
  const bucketName = doc.getElementsByTagName('Name')[0]?.textContent || 'Unknown Bucket';
  
  // Extract all <Contents> elements (getElementsByTagName ignores namespaces)
  const contents = doc.getElementsByTagName('Contents');
  const items = Array.from(contents).map((c, idx) => ({
    id: idx,
    key: c.getElementsByTagName('Key')[0]?.textContent || '',
    size: parseInt(c.getElementsByTagName('Size')[0]?.textContent || '0', 10),
    lastModified: c.getElementsByTagName('LastModified')[0]?.textContent || ''
  }));
  
  return { bucketName, items, error: null };
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
  const encodedKey = key.split('/').map(segment => encodeURIComponent(segment)).join('/');
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

