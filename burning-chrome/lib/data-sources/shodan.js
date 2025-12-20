// Shodan DNS domain lookup API
// API docs: https://developer.shodan.io/api
// Each request consumes 1 query credit

/**
 * Fetch all subdomains for a domain from Shodan with pagination
 * @param {string} domain - The domain to enumerate
 * @param {string} apiKey - Shodan API key
 * @returns {Promise<Array<{name: string, source: string, fetchedAt: number}>>}
 */
export async function fetchShodanSubdomains(domain, apiKey) {
  const results = [];
  const seen = new Set();
  let page = 1;

  while (true) {
    const url = buildUrl(domain, apiKey, page);
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      await handleError(response);
    }

    const json = await response.json();
    const fetchedAt = Date.now();

    // Extract from subdomains array
    if (json.subdomains && Array.isArray(json.subdomains)) {
      for (const sub of json.subdomains) {
        const fullName = sub ? `${sub}.${domain}` : domain;
        if (!seen.has(fullName)) {
          seen.add(fullName);
          results.push({
            name: fullName,
            source: 'shodan',
            fetchedAt
          });
        }
      }
    }

    // Extract from data array (DNS records)
    if (json.data && Array.isArray(json.data)) {
      for (const record of json.data) {
        if (record.subdomain) {
          const fullName = `${record.subdomain}.${domain}`;
          if (!seen.has(fullName)) {
            seen.add(fullName);
            results.push({
              name: fullName,
              source: 'shodan',
              fetchedAt
            });
          }
        }
      }
    }

    // Check if there are more pages
    if (!json.more) {
      break;
    }

    page++;
  }

  return results;
}

function buildUrl(domain, apiKey, page) {
  const url = new URL(`https://api.shodan.io/dns/domain/${domain}`);
  url.searchParams.set('key', apiKey);
  if (page > 1) {
    url.searchParams.set('page', page);
  }
  return url.toString();
}

async function handleError(response) {
  if (response.status === 401) {
    throw new Error('Invalid Shodan API key');
  }
  if (response.status === 403) {
    throw new Error('Shodan API access denied - check your plan');
  }
  throw new Error(`Shodan API error: ${response.status}`);
}

