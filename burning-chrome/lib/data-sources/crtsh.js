// crt.sh Certificate Transparency API
// Provides subdomain enumeration via CT logs

/**
 * Fetch subdomains from crt.sh for enumeration purposes
 * @param {string} domain - The domain to enumerate
 * @returns {Promise<Array<{name: string, source: string, fetchedAt: number}>>}
 */
export async function fetchCrtshSubdomains(domain) {
  const response = await fetch(
    `https://crt.sh/?q=${encodeURIComponent(domain)}&output=json`,
    { headers: { 'Accept': 'application/json' } }
  );

  if (!response.ok) {
    throw new Error(`crt.sh API error: ${response.status}`);
  }

  const json = await response.json();
  return extractUniqueSubdomains(json);
}

/**
 * Fetch raw certificate data from crt.sh for display
 * @param {string} domain - The domain to query
 * @returns {Promise<Array>} Raw certificate records
 */
export async function fetchCrtshData(domain) {
  const url = `https://crt.sh/?q=${domain}&output=json`;
  console.log(`Fetching crt.sh data for ${domain}...`);

  const response = await fetch(url, {
    headers: { 'Accept': 'application/json' }
  });

  if (!response.ok) {
    throw new Error(`Crt.sh API returned ${response.status}`);
  }

  const json = await response.json();
  console.log(`Crt.sh returned ${json.length} certificates`);
  return json;
}

function extractUniqueSubdomains(certRecords) {
  const seen = new Set();
  const results = [];

  for (const cert of certRecords) {
    const names = (cert.name_value || '').split('\n');
    for (const name of names) {
      const cleaned = name.trim().toLowerCase();
      if (cleaned && !cleaned.startsWith('*') && !seen.has(cleaned)) {
        seen.add(cleaned);
        results.push({
          name: cleaned,
          source: 'crtsh',
          fetchedAt: Date.now()
        });
      }
    }
  }

  return results;
}

