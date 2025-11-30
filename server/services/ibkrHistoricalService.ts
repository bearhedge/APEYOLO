/**
 * IBKR Historical Data Service
 *
 * Fetches historical OHLCV bars from IBKR's HMDS (Historical Market Data Service).
 * This is the ONLY source of truth for chart data - no Yahoo Finance fallbacks.
 *
 * Key features:
 * - Uses existing IBKR auth from broker/ibkr.ts
 * - Pipes data through barSanitizer for validation
 * - Caches bars to reduce API calls
 * - Supports multiple timeframes: 1m, 5m, 15m, 1h, 1D
 */

import { ensureIbkrReady, resolveSymbolConid, getIbkrCookieString } from '../broker/ibkr';
import { sanitizeBars, type Bar } from '../utils/barSanitizer';
import axios, { AxiosInstance } from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';

// Curated bar with provenance tracking
export interface CuratedBar extends Bar {
  symbol: string;
  timeframe: Timeframe;
  source: 'ibkr';
  fetchedAt: number;  // Unix timestamp when fetched
  version: number;    // Schema version for future migrations
}

export type Timeframe = '1m' | '5m' | '15m' | '1h' | '1D';

// IBKR HMDS API parameters
interface HmdsParams {
  conid: number;
  period: string;     // "1d", "1w", "1m", "1y"
  bar: string;        // "1min", "5min", "15min", "1h", "1d"
  outsideRth?: boolean;
}

// IBKR HMDS response format
interface HmdsResponse {
  serverId: string;
  symbol: string;
  text: string;
  priceFactor: number;
  startTime: string;
  high: string;       // Formatted "price/time"
  low: string;        // Formatted "price/time"
  timePeriod: string;
  barLength: number;
  mdAvailability: string;
  mktDataDelay: number;
  outsideRth: boolean;
  tradingDayDuration: number;
  volumeFactor: number;
  priceDisplayRule: number;
  priceDisplayValue: string;
  negativeCapable: boolean;
  messageVersion: number;
  data: HmdsBar[];
  points: number;
  travelTime: number;
}

interface HmdsBar {
  o: number;  // Open
  c: number;  // Close
  h: number;  // High
  l: number;  // Low
  v: number;  // Volume
  t: number;  // Timestamp (Unix ms)
}

// Cache for historical bars
interface CacheEntry {
  bars: CuratedBar[];
  fetchedAt: number;
  symbol: string;
  timeframe: Timeframe;
}

class HistoricalDataCache {
  private cache: Map<string, CacheEntry> = new Map();
  private ttl: number;

  constructor(ttlMs: number = 60_000) {  // 1 minute default TTL
    this.ttl = ttlMs;
  }

  private key(symbol: string, timeframe: Timeframe): string {
    return `${symbol}:${timeframe}`;
  }

  get(symbol: string, timeframe: Timeframe): CuratedBar[] | null {
    const entry = this.cache.get(this.key(symbol, timeframe));
    if (!entry) return null;

    const age = Date.now() - entry.fetchedAt;
    if (age > this.ttl) {
      this.cache.delete(this.key(symbol, timeframe));
      return null;
    }

    return entry.bars;
  }

  set(symbol: string, timeframe: Timeframe, bars: CuratedBar[]): void {
    this.cache.set(this.key(symbol, timeframe), {
      bars,
      fetchedAt: Date.now(),
      symbol,
      timeframe,
    });
  }

  clear(): void {
    this.cache.clear();
  }

  clearSymbol(symbol: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${symbol}:`)) {
        this.cache.delete(key);
      }
    }
  }
}

// Singleton cache instance
const cache = new HistoricalDataCache();

// HTTP client for HMDS requests
let hmdsClient: AxiosInstance | null = null;
let hmdsJar: CookieJar | null = null;

async function getHmdsClient(): Promise<AxiosInstance> {
  if (hmdsClient) return hmdsClient;

  // Get cookies from IBKR session
  const cookieString = await getIbkrCookieString();

  hmdsJar = new CookieJar();

  // Parse and add cookies to jar
  if (cookieString) {
    const cookies = cookieString.split(';').map(c => c.trim());
    for (const cookie of cookies) {
      try {
        await hmdsJar.setCookie(cookie, 'https://api.ibkr.com');
      } catch {
        // Ignore invalid cookies
      }
    }
  }

  hmdsClient = wrapper(axios.create({
    baseURL: 'https://api.ibkr.com',
    // @ts-ignore
    jar: hmdsJar,
    withCredentials: true,
    validateStatus: () => true,
    headers: { 'User-Agent': 'apeyolo/1.0' },
  }));

  return hmdsClient;
}

// Reset HTTP client (call when auth changes)
export function resetHmdsClient(): void {
  hmdsClient = null;
  hmdsJar = null;
}

/**
 * Map our timeframe to IBKR bar size
 */
function timeframeToBar(tf: Timeframe): string {
  switch (tf) {
    case '1m': return '1min';
    case '5m': return '5mins';
    case '15m': return '15mins';
    case '1h': return '1h';
    case '1D': return '1d';
    default: return '5mins';
  }
}

/**
 * Map our timeframe to IBKR period (how far back to fetch)
 */
function timeframeToPeriod(tf: Timeframe): string {
  switch (tf) {
    case '1m': return '1d';    // 1 day of 1-min bars
    case '5m': return '2d';    // 2 days of 5-min bars
    case '15m': return '5d';   // 5 days of 15-min bars
    case '1h': return '1w';    // 1 week of hourly bars
    case '1D': return '3m';    // 3 months of daily bars
    default: return '1d';
  }
}

/**
 * Fetch historical bars from IBKR HMDS API
 */
export async function fetchHistoricalBars(
  symbol: string,
  timeframe: Timeframe,
  options: {
    outsideRth?: boolean;
    forceRefresh?: boolean;
  } = {}
): Promise<CuratedBar[]> {
  const { outsideRth = false, forceRefresh = false } = options;

  // Check cache first (unless force refresh)
  if (!forceRefresh) {
    const cached = cache.get(symbol, timeframe);
    if (cached) {
      console.log(`[IBKR-Historical] Cache hit for ${symbol} ${timeframe}: ${cached.length} bars`);
      return cached;
    }
  }

  // Ensure IBKR is authenticated
  await ensureIbkrReady();

  // Resolve symbol to conid
  const conid = await resolveSymbolConid(symbol);
  if (!conid) {
    console.error(`[IBKR-Historical] Could not resolve conid for ${symbol}`);
    throw new Error(`Could not resolve conid for ${symbol}`);
  }

  console.log(`[IBKR-Historical] Fetching ${symbol} (conid=${conid}) ${timeframe} bars...`);

  // Build HMDS request
  const params: HmdsParams = {
    conid,
    period: timeframeToPeriod(timeframe),
    bar: timeframeToBar(timeframe),
    outsideRth,
  };

  const client = await getHmdsClient();

  // IBKR HMDS endpoint
  const url = `/v1/api/hmds/history`;
  const queryParams = new URLSearchParams({
    conid: String(params.conid),
    period: params.period,
    bar: params.bar,
    outsideRth: String(params.outsideRth),
  });

  const resp = await client.get(`${url}?${queryParams.toString()}`);

  if (resp.status !== 200) {
    console.error(`[IBKR-Historical] HMDS request failed: status=${resp.status} body=${JSON.stringify(resp.data).slice(0, 500)}`);
    throw new Error(`HMDS request failed with status ${resp.status}`);
  }

  const hmdsData = resp.data as HmdsResponse;

  if (!hmdsData.data || !Array.isArray(hmdsData.data)) {
    console.error(`[IBKR-Historical] Invalid HMDS response: no data array`);
    throw new Error('Invalid HMDS response: no data array');
  }

  console.log(`[IBKR-Historical] Received ${hmdsData.data.length} raw bars for ${symbol}`);

  // Convert HMDS bars to our format
  const rawBars = hmdsData.data.map(bar => ({
    time: Math.floor(bar.t / 1000),  // Convert ms to seconds
    open: bar.o,
    high: bar.h,
    low: bar.l,
    close: bar.c,
    volume: bar.v,
  }));

  // Sanitize through barSanitizer
  const { bars: sanitizedBars, stats } = sanitizeBars(rawBars, symbol);

  if (stats.dropped > 0) {
    console.log(`[IBKR-Historical] Sanitizer dropped ${stats.dropped}/${stats.input} bars:`, stats.reasons);
  }

  // Add provenance info
  const fetchedAt = Date.now();
  const curatedBars: CuratedBar[] = sanitizedBars.map(bar => ({
    ...bar,
    symbol,
    timeframe,
    source: 'ibkr' as const,
    fetchedAt,
    version: 1,
  }));

  // Cache the result
  cache.set(symbol, timeframe, curatedBars);

  console.log(`[IBKR-Historical] Returning ${curatedBars.length} curated bars for ${symbol} ${timeframe}`);

  return curatedBars;
}

/**
 * Get bars for a specific time range (filtered from full fetch)
 */
export async function getBarsInRange(
  symbol: string,
  timeframe: Timeframe,
  startTime: number,  // Unix seconds
  endTime: number,    // Unix seconds
): Promise<CuratedBar[]> {
  const bars = await fetchHistoricalBars(symbol, timeframe);
  return bars.filter(bar => bar.time >= startTime && bar.time <= endTime);
}

/**
 * Get the most recent N bars
 */
export async function getRecentBars(
  symbol: string,
  timeframe: Timeframe,
  count: number = 100,
): Promise<CuratedBar[]> {
  const bars = await fetchHistoricalBars(symbol, timeframe);
  return bars.slice(-count);
}

/**
 * Clear cache for a symbol or all symbols
 */
export function clearHistoricalCache(symbol?: string): void {
  if (symbol) {
    cache.clearSymbol(symbol);
    console.log(`[IBKR-Historical] Cleared cache for ${symbol}`);
  } else {
    cache.clear();
    console.log(`[IBKR-Historical] Cleared all cache`);
  }
}

/**
 * Get cache status for debugging
 */
export function getCacheStatus(): { entries: number; symbols: string[] } {
  const symbols = new Set<string>();
  // Access private cache via type assertion for debugging
  const cacheMap = (cache as any).cache as Map<string, CacheEntry>;
  for (const entry of cacheMap.values()) {
    symbols.add(entry.symbol);
  }
  return {
    entries: cacheMap.size,
    symbols: Array.from(symbols),
  };
}
