// server/lib/search/brave-search.ts

export interface BraveSearchResult {
  title: string;
  url: string;
  description: string;
}

export interface SearchResult {
  success: boolean;
  results?: BraveSearchResult[];
  bestUrl?: string; // First good URL to navigate to
  error?: string;
}

const BRAVE_API_URL = 'https://api.search.brave.com/res/v1/web/search';

// Domains we trust for navigation (no bot detection)
const TRUSTED_DOMAINS = [
  'nyse.com',
  'nasdaq.com',
  'investopedia.com',
  'marketwatch.com',
  'finance.yahoo.com',
  'bloomberg.com',
  'reuters.com',
  'cnbc.com',
  'wsj.com',
  'sec.gov',
  'federalreserve.gov',
  'bls.gov',
  'wikipedia.org',
  'cnn.com',
  'nytimes.com',
  'fool.com',
  'barrons.com',
  'schwab.com',
  'fidelity.com',
  'etrade.com',
  'tdameritrade.com',
];

function isTrustedUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return TRUSTED_DOMAINS.some(domain =>
      hostname === domain || hostname.endsWith('.' + domain)
    );
  } catch {
    return false;
  }
}

function findBestUrl(results: BraveSearchResult[]): string | undefined {
  // First, try to find a trusted domain
  for (const result of results) {
    if (isTrustedUrl(result.url)) {
      return result.url;
    }
  }
  // If no trusted domain, return first result (might get blocked but worth trying)
  return results[0]?.url;
}

export async function braveSearch(query: string): Promise<SearchResult> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;

  if (!apiKey) {
    console.warn('[BraveSearch] BRAVE_SEARCH_API_KEY not configured');
    return { success: false, error: 'BRAVE_SEARCH_API_KEY not configured' };
  }

  try {
    console.log(`[BraveSearch] Searching: ${query}`);
    const url = `${BRAVE_API_URL}?q=${encodeURIComponent(query)}&count=10`;

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[BraveSearch] API error: ${response.status} - ${errorText}`);
      return { success: false, error: `Brave API error: ${response.status}` };
    }

    const data = await response.json();

    // Extract web results
    const webResults = data.web?.results || [];
    const results: BraveSearchResult[] = webResults.slice(0, 10).map((r: any) => ({
      title: r.title || '',
      url: r.url || '',
      description: r.description || '',
    }));

    const bestUrl = findBestUrl(results);

    console.log(`[BraveSearch] Found ${results.length} results, best URL: ${bestUrl}`);
    return { success: true, results, bestUrl };
  } catch (error: any) {
    console.error(`[BraveSearch] Error: ${error.message}`);
    return { success: false, error: error.message };
  }
}
