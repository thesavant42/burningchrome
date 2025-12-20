// VirusTotal subdomain enumeration API
// API docs: https://docs.virustotal.com/reference/subdomains
// Rate limit: 4 requests per minute (public API) = 1 request per 15 seconds

const REQUEST_INTERVAL = 15000; // 15 seconds between requests
const PAGE_LIMIT = 40; // Max results per request (default is 10)

/**
 * Fetch all subdomains for a domain from VirusTotal with pagination
 * @param {string} domain - The domain to enumerate
 * @param {string} apiKey - VirusTotal API key
 * @returns {Promise<Array<{name: string, source: string, fetchedAt: number}>>}
 */
export async function fetchVirusTotalSubdomains(domain, apiKey) {
  const results = [];
  let cursor = null;
  let previousCursor = null;

  while (true) {
    const url = buildUrl(domain, cursor);
    const response = await fetch(url, {
      headers: {
        'x-apikey': apiKey,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      await handleError(response);
    }

    const json = await response.json();

    if (!json.data || json.data.length === 0) {
      break;
    }

    for (const item of json.data) {
      results.push({
        name: item.id,
        source: 'virustotal',
        fetchedAt: Date.now()
      });
    }

    cursor = json.meta?.cursor || null;
    if (!cursor) break;

    // Duplicate cursor detection - prevent infinite loops
    if (cursor === previousCursor) {
      console.warn('VirusTotal returned duplicate cursor, stopping pagination');
      break;
    }
    previousCursor = cursor;

    // Rate limiting: wait before next request
    await new Promise(resolve => setTimeout(resolve, REQUEST_INTERVAL));
  }

  return results;
}

function buildUrl(domain, cursor) {
  const url = new URL(`https://www.virustotal.com/api/v3/domains/${domain}/subdomains`);
  url.searchParams.set('limit', PAGE_LIMIT);
  if (cursor) {
    url.searchParams.set('cursor', cursor);
  }
  return url.toString();
}

async function handleError(response) {
  if (response.status === 401) {
    throw new Error('Invalid VirusTotal API key');
  }
  throw new Error(`VirusTotal API error: ${response.status}`);
}

