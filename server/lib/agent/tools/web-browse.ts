// server/lib/agent/tools/web-browse.ts
// Hybrid approach: Brave API for search + Playwright for navigation to source
import { getBrowserService } from '../../browser';
import { braveSearch } from '../../search';

export interface WebBrowseArgs {
  query: string;
  url?: string;
}

export interface WebBrowseResult {
  content: string;
  url: string;
  screenshot?: string;
  searchResults?: string; // Text summary of search results
}

export async function webBrowse(args: WebBrowseArgs): Promise<WebBrowseResult> {
  const browser = getBrowserService();

  // If URL is provided, navigate directly
  if (args.url) {
    console.log(`[WebBrowse] Direct navigation to: ${args.url}`);
    const result = await browser.navigateTo(args.url);

    if (!result.success) {
      throw new Error(result.error || 'Navigation failed');
    }

    return {
      content: result.content || '',
      url: result.url || args.url,
      screenshot: result.screenshot,
    };
  }

  // Hybrid approach: Search with Brave API, navigate to best result with Playwright
  console.log(`[WebBrowse] Hybrid search for: ${args.query}`);

  // Step 1: Search with Brave API
  const searchResult = await braveSearch(args.query);

  if (!searchResult.success || !searchResult.results?.length) {
    // Fallback: return search results as text if we have them
    if (searchResult.results?.length) {
      const textResults = searchResult.results
        .map((r, i) => `${i + 1}. ${r.title}\n   ${r.description}\n   Source: ${r.url}`)
        .join('\n\n');
      return {
        content: textResults,
        url: 'brave-search-results',
        searchResults: textResults,
      };
    }
    throw new Error(searchResult.error || 'Search failed');
  }

  // Step 2: Navigate to the best URL with Playwright (get screenshot)
  const targetUrl = searchResult.bestUrl || searchResult.results[0].url;
  console.log(`[WebBrowse] Navigating to best result: ${targetUrl}`);

  const navResult = await browser.navigateTo(targetUrl);

  // Format search results as context
  const searchSummary = searchResult.results
    .slice(0, 5)
    .map((r, i) => `${i + 1}. ${r.title}: ${r.description}`)
    .join('\n');

  if (!navResult.success) {
    // Navigation failed, but we still have search results
    console.warn(`[WebBrowse] Navigation failed, returning search results only`);
    return {
      content: `Search results for "${args.query}":\n\n${searchSummary}`,
      url: targetUrl,
      searchResults: searchSummary,
      // No screenshot since navigation failed
    };
  }

  // Success: return page content + screenshot + search context
  return {
    content: `Source: ${targetUrl}\n\nPage content:\n${navResult.content}\n\nOther search results:\n${searchSummary}`,
    url: navResult.url || targetUrl,
    screenshot: navResult.screenshot,
    searchResults: searchSummary,
  };
}
