/**
 * Alpha Vantage Service - Intraday data with volume for VWAP calculation
 *
 * API Limits:
 * - 5 calls per minute
 * - 500 calls per day
 *
 * Strategy:
 * - Fetch intraday 1-minute bars once at market open
 * - Update every 1 minute during market hours
 * - Calculate VWAP: Σ(price × volume) / Σ(volume)
 */

const BASE_URL = 'https://www.alphavantage.co/query';

/**
 * Get Alpha Vantage API key from environment
 */
function getAlphaVantageApiKey(): string | undefined {
  return process.env.ALPHA_VANTAGE_API_KEY;
}

interface IntradayBar {
  timestamp: number;  // Unix timestamp in seconds
  close: number;
  volume: number;
}

interface VWAPData {
  vwap: number;
  lastUpdate: number;  // Unix timestamp
  barCount: number;
}

// Cache for VWAP data (reset daily)
let cachedVWAP: VWAPData | null = null;
let lastFetchTime = 0;
let dailyCallCount = 0;
let lastResetDate: string | null = null;

// Rate limiting: Track calls per minute
let callsThisMinute = 0;
let minuteStartTime = Date.now();

/**
 * Check if we can make an API call (respects rate limits)
 */
function canMakeCall(): boolean {
  const now = Date.now();

  // Reset minute counter if 60 seconds have passed
  if (now - minuteStartTime > 60000) {
    callsThisMinute = 0;
    minuteStartTime = now;
  }

  // Check rate limits
  if (callsThisMinute >= 5) {
    console.log('[AlphaVantage] Rate limit: 5 calls/minute reached');
    return false;
  }

  if (dailyCallCount >= 500) {
    console.log('[AlphaVantage] Daily limit: 500 calls/day reached');
    return false;
  }

  return true;
}

/**
 * Reset daily counters at midnight
 */
function checkDailyReset(): void {
  const today = new Date().toISOString().split('T')[0];
  if (lastResetDate !== today) {
    dailyCallCount = 0;
    cachedVWAP = null;
    lastResetDate = today;
    console.log('[AlphaVantage] Daily reset - counters cleared');
  }
}

/**
 * Fetch intraday 1-minute bars from Alpha Vantage
 */
async function fetchIntradayBars(symbol: string): Promise<IntradayBar[]> {
  const apiKey = getAlphaVantageApiKey();
  if (!apiKey) {
    throw new Error('ALPHA_VANTAGE_API_KEY not configured');
  }

  if (!canMakeCall()) {
    throw new Error('Rate limit exceeded');
  }

  const url = `${BASE_URL}?function=TIME_SERIES_INTRADAY&symbol=${symbol}&interval=1min&apikey=${apiKey}&outputsize=full`;

  try {
    callsThisMinute++;
    dailyCallCount++;

    const response = await fetch(url);
    const data = await response.json();

    if (data['Error Message']) {
      throw new Error(`Alpha Vantage API error: ${data['Error Message']}`);
    }

    if (data['Note']) {
      // Rate limit message
      console.warn('[AlphaVantage] API message:', data['Note']);
      throw new Error('Rate limit reached');
    }

    const timeSeries = data['Time Series (1min)'];
    if (!timeSeries) {
      throw new Error('No time series data returned');
    }

    // Parse bars
    const bars: IntradayBar[] = [];
    for (const [timestamp, values] of Object.entries(timeSeries)) {
      const bar: any = values;
      bars.push({
        timestamp: new Date(timestamp).getTime() / 1000,  // Convert to Unix seconds
        close: parseFloat(bar['4. close']),
        volume: parseInt(bar['5. volume'], 10),
      });
    }

    // Sort by timestamp ascending (oldest first)
    bars.sort((a, b) => a.timestamp - b.timestamp);

    console.log(`[AlphaVantage] Fetched ${bars.length} intraday bars for ${symbol}`);
    return bars;

  } catch (error: any) {
    console.error('[AlphaVantage] Fetch error:', error.message);
    throw error;
  }
}

/**
 * Calculate VWAP from intraday bars
 * VWAP = Σ(price × volume) / Σ(volume)
 */
function calculateVWAP(bars: IntradayBar[]): number {
  let sumPriceVolume = 0;
  let sumVolume = 0;

  for (const bar of bars) {
    if (bar.volume > 0) {
      sumPriceVolume += bar.close * bar.volume;
      sumVolume += bar.volume;
    }
  }

  if (sumVolume === 0) {
    return 0;
  }

  return sumPriceVolume / sumVolume;
}

/**
 * Get current VWAP for SPY
 * Fetches fresh data if:
 * - No cached data
 * - Last fetch was more than 1 minute ago
 * - New trading day
 */
export async function getSPYVWAP(): Promise<number | null> {
  try {
    checkDailyReset();

    const now = Date.now();
    const ONE_MINUTE = 1 * 60 * 1000;

    // Return cached if recent
    if (cachedVWAP && (now - lastFetchTime < ONE_MINUTE)) {
      return cachedVWAP.vwap;
    }

    // Fetch fresh data
    console.log('[AlphaVantage] Fetching fresh VWAP data...');
    const bars = await fetchIntradayBars('SPY');

    if (bars.length === 0) {
      return null;
    }

    // Filter to today's bars only (market open to now)
    const todayStart = new Date();
    todayStart.setHours(9, 30, 0, 0);  // 9:30 AM
    const todayStartTimestamp = todayStart.getTime() / 1000;

    const todayBars = bars.filter(b => b.timestamp >= todayStartTimestamp);

    if (todayBars.length === 0) {
      console.warn('[AlphaVantage] No bars for today');
      return null;
    }

    const vwap = calculateVWAP(todayBars);

    // Cache result
    cachedVWAP = {
      vwap,
      lastUpdate: now,
      barCount: todayBars.length,
    };
    lastFetchTime = now;

    console.log(`[AlphaVantage] VWAP calculated: $${vwap.toFixed(2)} (${todayBars.length} bars)`);

    return vwap;

  } catch (error: any) {
    console.error('[AlphaVantage] Error getting VWAP:', error.message);
    // Return cached if available
    return cachedVWAP?.vwap ?? null;
  }
}

/**
 * Get cached VWAP without fetching (for frequent polling)
 */
export function getCachedVWAP(): number | null {
  return cachedVWAP?.vwap ?? null;
}

/**
 * Get service status
 */
export function getStatus(): {
  hasCachedVWAP: boolean;
  lastUpdate: number | null;
  barCount: number | null;
  callsThisMinute: number;
  dailyCallCount: number;
} {
  return {
    hasCachedVWAP: cachedVWAP !== null,
    lastUpdate: cachedVWAP?.lastUpdate ?? null,
    barCount: cachedVWAP?.barCount ?? null,
    callsThisMinute,
    dailyCallCount,
  };
}
