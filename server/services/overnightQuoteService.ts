/**
 * Overnight Quote Service - Yahoo Finance Extended Hours Data
 *
 * During overnight hours (8PM-4AM ET), IBKR WebSocket doesn't stream data.
 * This service fetches extended hours quotes from Yahoo Finance as a fallback.
 *
 * Yahoo Finance provides free extended hours data via the chart API:
 * - postMarketPrice: After-hours and overnight trading price
 * - preMarketPrice: Pre-market trading price
 * - No API key required
 *
 * Rate limits: ~2000 requests/hour (plenty for 2-min polling)
 */

export interface OvernightQuote {
  symbol: string;
  price: number;               // Current extended hours price
  regularMarketPrice: number;  // Closing price from regular session
  extendedPrice: number;       // Pre/post market price
  extendedChange: number;      // Change from close
  extendedChangePct: number;   // Change percent from close
  timestamp: number;           // Unix timestamp of extended quote
  isExtendedHours: boolean;    // True if this is extended hours data
  source: 'yahoo';
}

interface CacheEntry {
  quote: OvernightQuote;
  expiry: number;
}

// Cache with 2-minute TTL to avoid hammering Yahoo
const quoteCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

/**
 * Fetch extended hours quote from Yahoo Finance
 */
export async function fetchOvernightQuote(symbol: string): Promise<OvernightQuote | null> {
  const now = Date.now();
  const cacheKey = symbol.toUpperCase();

  // Check cache first
  const cached = quoteCache.get(cacheKey);
  if (cached && cached.expiry > now) {
    console.log(`[OvernightQuote] Cache hit for ${symbol}`);
    return cached.quote;
  }

  // Fetch from Yahoo Finance with extended hours data
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1m&range=1d&includePrePost=true`;

  try {
    console.log(`[OvernightQuote] Fetching extended hours data for ${symbol}...`);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`Yahoo Finance API error: ${response.status}`);
    }

    const data = await response.json();

    if (data.chart?.error) {
      throw new Error(`Yahoo Finance error: ${data.chart.error.description}`);
    }

    const meta = data.chart?.result?.[0]?.meta;
    if (!meta) {
      throw new Error('No metadata returned from Yahoo Finance');
    }

    // Extract extended hours pricing
    // Yahoo provides these fields for extended hours:
    // - postMarketPrice / postMarketChange / postMarketChangePercent / postMarketTime
    // - preMarketPrice / preMarketChange / preMarketChangePercent / preMarketTime
    const regularMarketPrice = meta.regularMarketPrice ?? meta.previousClose ?? 0;

    // Determine which extended hours data to use
    let extendedPrice = regularMarketPrice;
    let extendedChange = 0;
    let extendedChangePct = 0;
    let extendedTimestamp = Date.now();
    let isExtendedHours = false;

    // Post-market data (after-hours, overnight)
    if (meta.postMarketPrice != null && meta.postMarketPrice > 0) {
      extendedPrice = meta.postMarketPrice;
      extendedChange = meta.postMarketChange ?? (extendedPrice - regularMarketPrice);
      extendedChangePct = meta.postMarketChangePercent ?? ((extendedChange / regularMarketPrice) * 100);
      extendedTimestamp = (meta.postMarketTime ?? Math.floor(Date.now() / 1000)) * 1000;
      isExtendedHours = true;
      console.log(`[OvernightQuote] Using post-market price: $${extendedPrice.toFixed(2)}`);
    }
    // Pre-market data (morning before open)
    else if (meta.preMarketPrice != null && meta.preMarketPrice > 0) {
      extendedPrice = meta.preMarketPrice;
      extendedChange = meta.preMarketChange ?? (extendedPrice - regularMarketPrice);
      extendedChangePct = meta.preMarketChangePercent ?? ((extendedChange / regularMarketPrice) * 100);
      extendedTimestamp = (meta.preMarketTime ?? Math.floor(Date.now() / 1000)) * 1000;
      isExtendedHours = true;
      console.log(`[OvernightQuote] Using pre-market price: $${extendedPrice.toFixed(2)}`);
    }

    const quote: OvernightQuote = {
      symbol: cacheKey,
      price: extendedPrice,
      regularMarketPrice,
      extendedPrice,
      extendedChange,
      extendedChangePct,
      timestamp: extendedTimestamp,
      isExtendedHours,
      source: 'yahoo',
    };

    // Cache the result
    quoteCache.set(cacheKey, {
      quote,
      expiry: now + CACHE_TTL_MS,
    });

    console.log(`[OvernightQuote] ${symbol}: $${extendedPrice.toFixed(2)} (${extendedChange >= 0 ? '+' : ''}${extendedChange.toFixed(2)}, ${extendedChangePct.toFixed(2)}%)`);

    return quote;

  } catch (error: any) {
    console.error(`[OvernightQuote] Error fetching ${symbol}:`, error.message);

    // Return stale cached data if available
    if (cached) {
      console.log(`[OvernightQuote] Returning stale cache for ${symbol}`);
      return cached.quote;
    }

    return null;
  }
}

/**
 * Get cached quote without fetching (for checking freshness)
 */
export function getCachedQuote(symbol: string): OvernightQuote | null {
  const cached = quoteCache.get(symbol.toUpperCase());
  if (cached && cached.expiry > Date.now()) {
    return cached.quote;
  }
  return null;
}

/**
 * Clear cache for a symbol
 */
export function clearCache(symbol?: string): void {
  if (symbol) {
    quoteCache.delete(symbol.toUpperCase());
  } else {
    quoteCache.clear();
  }
}

/**
 * Get service status
 */
export function getStatus(): {
  cachedSymbols: string[];
  cacheSize: number;
} {
  return {
    cachedSymbols: Array.from(quoteCache.keys()),
    cacheSize: quoteCache.size,
  };
}
