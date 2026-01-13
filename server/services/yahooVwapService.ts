/**
 * Yahoo Finance VWAP Service - Free intraday data with volume
 *
 * Yahoo Finance provides free 1-minute intraday bars with volume.
 * No API key required, just rate limiting (be reasonable).
 *
 * Strategy:
 * - Fetch 1-minute bars for current trading day
 * - Calculate VWAP: Σ(price × volume) / Σ(volume)
 * - Cache for 1 minute to avoid excessive requests
 */

interface YahooBar {
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
let lastResetDate: string | null = null;

/**
 * Reset daily counters at midnight
 */
function checkDailyReset(): void {
  const today = new Date().toISOString().split('T')[0];
  if (lastResetDate !== today) {
    cachedVWAP = null;
    lastResetDate = today;
    console.log('[YahooVWAP] Daily reset - cache cleared');
  }
}

/**
 * Fetch intraday 1-minute bars from Yahoo Finance
 */
async function fetchIntradayBars(symbol: string): Promise<YahooBar[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1m&range=1d`;

  try {
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

    const result = data.chart?.result?.[0];
    if (!result || !result.timestamp || !result.indicators?.quote?.[0]) {
      throw new Error('No intraday data returned');
    }

    const timestamps = result.timestamp;
    const closes = result.indicators.quote[0].close;
    const volumes = result.indicators.quote[0].volume;

    // Parse bars
    const bars: YahooBar[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      // Skip bars with null values
      if (closes[i] != null && volumes[i] != null && volumes[i] > 0) {
        bars.push({
          timestamp: timestamps[i],
          close: closes[i],
          volume: volumes[i],
        });
      }
    }

    console.log(`[YahooVWAP] Fetched ${bars.length} intraday bars for ${symbol}`);
    return bars;

  } catch (error: any) {
    console.error('[YahooVWAP] Fetch error:', error.message);
    throw error;
  }
}

/**
 * Calculate VWAP from intraday bars
 * VWAP = Σ(price × volume) / Σ(volume)
 */
function calculateVWAP(bars: YahooBar[]): number {
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
    console.log('[YahooVWAP] Fetching fresh VWAP data...');
    const bars = await fetchIntradayBars('SPY');

    if (bars.length === 0) {
      console.warn('[YahooVWAP] No bars returned');
      return null;
    }

    // Filter to today's market hours (9:30 AM - 4:00 PM ET)
    // Yahoo already filters to today, but let's ensure we only use regular market hours
    const now_date = new Date();
    const marketOpen = new Date(now_date);
    marketOpen.setHours(9, 30, 0, 0);
    const marketClose = new Date(now_date);
    marketClose.setHours(16, 0, 0, 0);

    const marketOpenTimestamp = marketOpen.getTime() / 1000;
    const marketCloseTimestamp = marketClose.getTime() / 1000;

    const tradingBars = bars.filter(b =>
      b.timestamp >= marketOpenTimestamp && b.timestamp <= marketCloseTimestamp
    );

    if (tradingBars.length === 0) {
      console.warn('[YahooVWAP] No bars during market hours');
      return null;
    }

    const vwap = calculateVWAP(tradingBars);

    // Cache result
    cachedVWAP = {
      vwap,
      lastUpdate: now,
      barCount: tradingBars.length,
    };
    lastFetchTime = now;

    console.log(`[YahooVWAP] VWAP calculated: $${vwap.toFixed(2)} (${tradingBars.length} bars)`);

    return vwap;

  } catch (error: any) {
    console.error('[YahooVWAP] Error getting VWAP:', error.message);
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
} {
  return {
    hasCachedVWAP: cachedVWAP !== null,
    lastUpdate: cachedVWAP?.lastUpdate ?? null,
    barCount: cachedVWAP?.barCount ?? null,
  };
}
