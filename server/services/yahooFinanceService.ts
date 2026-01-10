/**
 * Yahoo Finance Service
 *
 * Real-time and historical market data integration for VIX, SPY, and other symbols.
 * Data is structured for both UI display and AI model consumption.
 */

import yahooFinance from 'yahoo-finance2';

// Types
export interface OHLCData {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface QuoteData {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  open: number;
  high: number;
  low: number;
  previousClose: number;
  volume: number;
  marketState: 'PRE' | 'REGULAR' | 'POST' | 'CLOSED';
  lastUpdate: Date;
}

export interface VIXContext {
  current: number;
  open: number;
  high: number;
  low: number;
  close: number;
  change: number;
  changePercent: number;
  trend: 'up' | 'down' | 'flat';
  level: 'low' | 'normal' | 'elevated' | 'high';
  marketState: string;
  lastUpdate: Date;
}

// Time range = how far back to look (lookback period)
export type TimeRange = '1D' | '5D' | '1M' | '3M' | '6M' | '1Y' | 'MAX';

// Bar interval = candlestick size (what each bar represents)
export type BarInterval = '1m' | '5m' | '15m' | '30m' | '1h' | '1d';

// Map TimeRange to lookback period
const rangeConfig: Record<TimeRange, { period1: string | Date }> = {
  '1D': { period1: getDateOffset(1) },
  '5D': { period1: getDateOffset(5) },
  '1M': { period1: getDateOffset(30) },
  '3M': { period1: getDateOffset(90) },
  '6M': { period1: getDateOffset(180) },
  '1Y': { period1: getDateOffset(365) },
  'MAX': { period1: '2010-01-01' }
};

// Default intervals for each range (used when no interval specified)
const defaultIntervalForRange: Record<TimeRange, BarInterval> = {
  '1D': '5m',
  '5D': '15m',
  '1M': '1h',
  '3M': '1d',
  '6M': '1d',
  '1Y': '1d',
  'MAX': '1d'
};

// Price bounds for sanity checking OHLC data (filter outliers/artifacts)
const PRICE_BOUNDS: Record<string, { min: number; max: number }> = {
  'SPY': { min: 300, max: 700 },
  '^VIX': { min: 5, max: 100 },
  '^GSPC': { min: 3000, max: 7000 },
};

/**
 * Validate OHLC data for sanity
 * Filters out:
 * - Invalid OHLC relationships (high < low, etc.)
 * - Price values outside reasonable bounds
 * - Yahoo Finance artifacts (splits, corporate actions showing as spikes)
 */
function validateOHLCData(data: OHLCData[], symbol: string): OHLCData[] {
  const bounds = PRICE_BOUNDS[symbol] || { min: 0, max: Infinity };

  return data.filter(d => {
    // OHLC relationship validation
    if (d.high < d.low) return false;
    if (d.high < d.open || d.high < d.close) return false;
    if (d.low > d.open || d.low > d.close) return false;

    // Bounds check - filter extreme outliers
    if (d.close < bounds.min || d.close > bounds.max) return false;
    if (d.high < bounds.min || d.high > bounds.max) return false;
    if (d.low < bounds.min || d.low > bounds.max) return false;
    if (d.open < bounds.min || d.open > bounds.max) return false;

    // Volume sanity check (negative or extremely high values are likely errors)
    if (d.volume < 0 || d.volume > 1e12) return false;

    return true;
  });
}

function getDateOffset(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

// Cache for reducing API calls
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const cache = new Map<string, CacheEntry<any>>();
const CACHE_TTL = {
  quote: 120 * 1000, // 2 minutes for quotes (increased to reduce rate limiting)
  history: 5 * 60 * 1000 // 5 minutes for historical data
};

// Last known good data - survives cache expiration and API errors
// This ensures we always have SOME data to return even during rate limits
const lastKnownGood = new Map<string, { data: any; timestamp: number }>();
const STALE_DATA_MAX_AGE = 30 * 60 * 1000; // Serve stale data up to 30 minutes old

// Rate limit tracking
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 2000; // 2 seconds between requests (increased)

function getCached<T>(key: string, ttl: number): T | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < ttl) {
    return entry.data;
  }
  return null;
}

function setCache<T>(key: string, data: T): void {
  cache.set(key, { data, timestamp: Date.now() });
  // Also update last known good
  lastKnownGood.set(key, { data, timestamp: Date.now() });
}

/**
 * Get stale data as fallback when API fails
 */
function getStaleData<T>(key: string): T | null {
  const entry = lastKnownGood.get(key);
  if (entry && Date.now() - entry.timestamp < STALE_DATA_MAX_AGE) {
    console.log(`[YahooFinance] Serving stale data for ${key} (${Math.round((Date.now() - entry.timestamp) / 1000)}s old)`);
    return entry.data;
  }
  return null;
}

/**
 * Wait for rate limit
 */
async function waitForRateLimit(): Promise<void> {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLastRequest));
  }
  lastRequestTime = Date.now();
}

/**
 * Fetch current quote for a symbol with retry logic
 */
export async function fetchQuote(symbol: string): Promise<QuoteData> {
  const cacheKey = `quote:${symbol}`;
  const cached = getCached<QuoteData>(cacheKey, CACHE_TTL.quote);
  if (cached) return cached;

  // Retry up to 3 times with exponential backoff
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await waitForRateLimit();
      const quote = await yahooFinance.quote(symbol);

      const data: QuoteData = {
        symbol: quote.symbol,
        price: quote.regularMarketPrice ?? 0,
        change: quote.regularMarketChange ?? 0,
        changePercent: quote.regularMarketChangePercent ?? 0,
        open: quote.regularMarketOpen ?? 0,
        high: quote.regularMarketDayHigh ?? 0,
        low: quote.regularMarketDayLow ?? 0,
        previousClose: quote.regularMarketPreviousClose ?? 0,
        volume: quote.regularMarketVolume ?? 0,
        marketState: mapMarketState(quote.marketState),
        lastUpdate: new Date()
      };

      setCache(cacheKey, data);
      return data;
    } catch (error: any) {
      lastError = error;
      const isRateLimit = error.message?.includes('Too Many Requests') || error.message?.includes('429');
      if (isRateLimit && attempt < 2) {
        console.log(`[YahooFinance] Rate limited for ${symbol}, retry ${attempt + 1} in ${(attempt + 1) * 2}s`);
        await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 2000));
        continue;
      }
      break;
    }
  }

  // Try to return stale data if available
  const staleData = getStaleData<QuoteData>(cacheKey);
  if (staleData) {
    console.log(`[YahooFinance] API failed for ${symbol}, returning stale data`);
    return staleData;
  }

  console.error(`[YahooFinance] Error fetching quote for ${symbol}:`, lastError);
  throw new Error(`Failed to fetch quote for ${symbol}`);
}

/**
 * Fetch historical OHLC data
 * @param symbol - Stock symbol (SPY, ^VIX, etc.)
 * @param range - How far back to look (1D, 5D, 1M, etc.)
 * @param interval - Candlestick bar size (1m, 5m, 15m, 30m, 1h, 1d)
 */
export async function fetchHistoricalData(
  symbol: string,
  range: TimeRange,
  interval?: BarInterval
): Promise<OHLCData[]> {
  // Use provided interval or default based on range
  const actualInterval = interval || defaultIntervalForRange[range];
  const cacheKey = `history:${symbol}:${range}:${actualInterval}`;
  const cached = getCached<OHLCData[]>(cacheKey, CACHE_TTL.history);
  if (cached) return cached;

  try {
    const config = rangeConfig[range];

    const result = await yahooFinance.chart(symbol, {
      period1: config.period1,
      interval: actualInterval
    });

    if (!result.quotes || result.quotes.length === 0) {
      return [];
    }

    // Parse raw quotes
    const rawData: OHLCData[] = result.quotes
      .filter(q => q.open != null && q.high != null && q.low != null && q.close != null)
      .map(q => ({
        timestamp: new Date(q.date),
        open: q.open!,
        high: q.high!,
        low: q.low!,
        close: q.close!,
        volume: q.volume ?? 0
      }));

    // Apply OHLC validation to filter out artifacts and outliers
    const data = validateOHLCData(rawData, symbol);

    if (data.length < rawData.length) {
      console.log(`[YahooFinance] Filtered ${rawData.length - data.length} invalid data points for ${symbol}`);
    }

    setCache(cacheKey, data);
    return data;
  } catch (error) {
    console.error(`[YahooFinance] Error fetching history for ${symbol}:`, error);
    throw new Error(`Failed to fetch historical data for ${symbol}`);
  }
}

/**
 * Fetch VIX data with context for trading decisions
 */
export async function fetchVIXData(): Promise<VIXContext> {
  const cacheKey = 'vix:context';
  const cached = getCached<VIXContext>(cacheKey, CACHE_TTL.quote);
  if (cached) return cached;

  try {
    const quote = await fetchQuote('^VIX');

    // Determine VIX level for trading context
    let level: VIXContext['level'];
    if (quote.price < 15) level = 'low';
    else if (quote.price < 20) level = 'normal';
    else if (quote.price < 25) level = 'elevated';
    else level = 'high';

    // Determine trend
    let trend: VIXContext['trend'];
    if (quote.changePercent > 1) trend = 'up';
    else if (quote.changePercent < -1) trend = 'down';
    else trend = 'flat';

    const data: VIXContext = {
      current: quote.price,
      open: quote.open,
      high: quote.high,
      low: quote.low,
      close: quote.previousClose, // Yesterday's close when market closed
      change: quote.change,
      changePercent: quote.changePercent,
      trend,
      level,
      marketState: quote.marketState,
      lastUpdate: quote.lastUpdate
    };

    setCache(cacheKey, data);
    return data;
  } catch (error) {
    console.error('[YahooFinance] Error fetching VIX data:', error);
    throw new Error('Failed to fetch VIX data');
  }
}

/**
 * Fetch SPY data for market context
 */
export async function fetchSPYData(): Promise<QuoteData> {
  return fetchQuote('SPY');
}

/**
 * Get combined market data for AI consumption
 * Fetches sequentially to avoid rate limits
 */
export async function fetchMarketSnapshot(): Promise<{
  vix: VIXContext;
  spy: QuoteData;
  timestamp: Date;
}> {
  // Fetch sequentially to avoid hitting rate limits
  const spy = await fetchSPYData();
  const vix = await fetchVIXData();

  return {
    vix,
    spy,
    timestamp: new Date()
  };
}

/**
 * Map Yahoo Finance market state to our simplified states
 */
function mapMarketState(state?: string): QuoteData['marketState'] {
  switch (state) {
    case 'PRE':
      return 'PRE';
    case 'REGULAR':
      return 'REGULAR';
    case 'POST':
    case 'POSTPOST':
      return 'POST';
    default:
      return 'CLOSED';
  }
}

/**
 * Clear cache (useful for testing or forced refresh)
 */
export function clearCache(): void {
  cache.clear();
}

/**
 * Bootstrap cache with fallback values
 * Called on server startup to ensure we always have SOME data
 * even if Yahoo Finance is completely rate limited
 */
export function bootstrapCache(): void {
  const now = new Date();

  // Reasonable fallback values (updated periodically)
  // These are approximate values - better than showing 0.00
  const fallbackSPY: QuoteData = {
    symbol: 'SPY',
    price: 588.00,  // Approximate SPY price
    change: 0,
    changePercent: 0,
    open: 588.00,
    high: 590.00,
    low: 586.00,
    previousClose: 588.00,
    volume: 0,
    marketState: 'CLOSED',
    lastUpdate: now
  };

  const fallbackVIX: VIXContext = {
    current: 15.50,  // Approximate VIX
    open: 15.50,
    high: 16.00,
    low: 15.00,
    close: 15.50,
    change: 0,
    changePercent: 0,
    trend: 'flat',
    level: 'normal',
    marketState: 'CLOSED',
    lastUpdate: now
  };

  // Seed the lastKnownGood cache (not the regular cache)
  // This ensures we have fallback data when Yahoo is rate limited
  lastKnownGood.set('quote:SPY', { data: fallbackSPY, timestamp: now.getTime() });
  lastKnownGood.set('quote:^VIX', { data: fallbackVIX, timestamp: now.getTime() });
  lastKnownGood.set('vix:context', { data: fallbackVIX, timestamp: now.getTime() });

  console.log('[YahooFinance] Bootstrapped fallback cache with static values');
}
