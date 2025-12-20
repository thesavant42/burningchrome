// CDX response parser
// Parses the raw CDX API JSON response into structured records

/**
 * Parse CDX API response rows into structured data
 * @param {Array} rawRows - Raw JSON array from CDX API
 * @returns {{records: Array, resumeKey: string, hasMore: boolean}}
 */
export function parseCDXResponse(rawRows) {
  const result = {
    records: [],
    resumeKey: '',
    hasMore: false
  };

  if (!Array.isArray(rawRows) || rawRows.length === 0) {
    return result;
  }

  // Check last row for resume key (single-element array)
  const lastRow = rawRows[rawRows.length - 1];
  if (Array.isArray(lastRow) && lastRow.length === 1) {
    result.resumeKey = lastRow[0];
    result.hasMore = true;
    rawRows = rawRows.slice(0, -1);
  }

  // Skip header row (index 0), parse data rows
  for (let i = 1; i < rawRows.length; i++) {
    const row = rawRows[i];

    // Skip empty or malformed rows
    if (!Array.isArray(row) || row.length < 4) {
      continue;
    }

    result.records.push({
      url: row[0],
      timestamp: row[1],
      statuscode: row[2] || '',
      mimetype: row[3] || ''
    });
  }

  return result;
}

/**
 * Format records array into display format with header
 * @param {Array} records - Array of parsed record objects
 * @returns {Array} Array suitable for UI display
 */
export function formatRecordsForDisplay(records) {
  return [
    ['original', 'timestamp', 'statuscode', 'mimetype'],
    ...records.map(r => [r.url, r.timestamp, r.statuscode, r.mimetype])
  ];
}

