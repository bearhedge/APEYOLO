/**
 * Bar Sanitizer - Ensures only valid OHLCV data reaches the chart
 *
 * This module provides strict validation and sanitization for price bars.
 * Invalid bars are dropped with logging, never passed through.
 */

// Canonical bar type - always Unix seconds, always positive numbers
export interface Bar {
  time: number;      // Unix timestamp in SECONDS (not ms)
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface SanitizeResult {
  bars: Bar[];
  stats: {
    input: number;
    output: number;
    dropped: number;
    reasons: Record<string, number>;
  };
}

// Price bounds by symbol (can be extended)
const PRICE_BOUNDS: Record<string, { min: number; max: number }> = {
  SPY: { min: 100, max: 1000 },
  QQQ: { min: 100, max: 1000 },
  IWM: { min: 50, max: 500 },
  DIA: { min: 100, max: 1000 },
  DEFAULT: { min: 0.01, max: 100000 },
};

/**
 * Validate that a value is a valid positive price
 */
function isValidPrice(value: any): value is number {
  return (
    typeof value === 'number' &&
    isFinite(value) &&
    value > 0 &&
    value < 1000000 // No stock is worth $1M
  );
}

/**
 * Validate timestamp is Unix seconds in reasonable range
 */
function isValidTimestamp(ts: any): ts is number {
  if (typeof ts !== 'number' || !isFinite(ts)) return false;

  // If timestamp is in milliseconds (> 10 billion), it's invalid format
  // Caller should normalize first
  if (ts > 10_000_000_000) return false;

  // Must be between 2020 and 2035
  const MIN_TS = 1577836800; // 2020-01-01
  const MAX_TS = 2051222400; // 2035-01-01

  return ts >= MIN_TS && ts <= MAX_TS;
}

/**
 * Validate OHLC relationships
 */
function isValidOHLC(bar: any): boolean {
  const { open, high, low, close } = bar;

  // High must be >= all other prices
  if (high < open || high < close || high < low) return false;

  // Low must be <= all other prices
  if (low > open || low > close) return false;

  return true;
}

/**
 * Check if price is within reasonable bounds for the symbol
 */
function isWithinBounds(price: number, symbol: string): boolean {
  const bounds = PRICE_BOUNDS[symbol.toUpperCase()] || PRICE_BOUNDS.DEFAULT;
  return price >= bounds.min && price <= bounds.max;
}

/**
 * Normalize timestamp to Unix seconds
 * - If in milliseconds (> 10 billion), divide by 1000
 * - If string, parse to Unix seconds
 */
export function normalizeTimestamp(ts: any): number | null {
  if (typeof ts === 'string') {
    const parsed = new Date(ts).getTime();
    if (isNaN(parsed)) return null;
    return Math.floor(parsed / 1000);
  }

  if (typeof ts !== 'number' || !isFinite(ts)) return null;

  // If in milliseconds, convert to seconds
  if (ts > 10_000_000_000) {
    return Math.floor(ts / 1000);
  }

  return Math.floor(ts);
}

/**
 * Sanitize an array of raw bars into clean Bar objects
 *
 * Rules:
 * 1. Reject if any OHLC is null, undefined, NaN, or <= 0
 * 2. Normalize timestamps to Unix seconds
 * 3. Sort by time ASC, drop duplicates
 * 4. Validate OHLC relationships (high >= low, etc.)
 * 5. Check price is within reasonable bounds for symbol
 * 6. Log dropped bars with reason
 */
export function sanitizeBars(rawBars: any[], symbol: string): SanitizeResult {
  const reasons: Record<string, number> = {};
  const validBars: Bar[] = [];
  const seenTimestamps = new Set<number>();

  const addReason = (reason: string) => {
    reasons[reason] = (reasons[reason] || 0) + 1;
  };

  for (const raw of rawBars) {
    // Skip null/undefined entries
    if (!raw || typeof raw !== 'object') {
      addReason('null_or_invalid_object');
      continue;
    }

    // Normalize timestamp
    const time = normalizeTimestamp(raw.time ?? raw.timestamp ?? raw.t);
    if (time === null) {
      addReason('invalid_timestamp');
      continue;
    }

    if (!isValidTimestamp(time)) {
      addReason('timestamp_out_of_range');
      continue;
    }

    // Skip duplicates
    if (seenTimestamps.has(time)) {
      addReason('duplicate_timestamp');
      continue;
    }

    // Extract OHLC values (support multiple field names)
    const open = raw.open ?? raw.o;
    const high = raw.high ?? raw.h;
    const low = raw.low ?? raw.l;
    const close = raw.close ?? raw.c;
    const volume = raw.volume ?? raw.v;

    // Validate all prices
    if (!isValidPrice(open)) {
      addReason('invalid_open');
      continue;
    }
    if (!isValidPrice(high)) {
      addReason('invalid_high');
      continue;
    }
    if (!isValidPrice(low)) {
      addReason('invalid_low');
      continue;
    }
    if (!isValidPrice(close)) {
      addReason('invalid_close');
      continue;
    }

    // Validate OHLC relationships
    const bar = { time, open, high, low, close, volume };
    if (!isValidOHLC(bar)) {
      addReason('invalid_ohlc_relationship');
      continue;
    }

    // Check bounds for the symbol
    if (!isWithinBounds(close, symbol)) {
      addReason('price_out_of_bounds');
      continue;
    }

    // Validate volume if present
    if (volume !== undefined && volume !== null) {
      if (typeof volume !== 'number' || !isFinite(volume) || volume < 0) {
        // Just nullify bad volume, don't drop the bar
        bar.volume = undefined;
      }
    }

    seenTimestamps.add(time);
    validBars.push(bar);
  }

  // Sort by time ascending
  validBars.sort((a, b) => a.time - b.time);

  const stats = {
    input: rawBars.length,
    output: validBars.length,
    dropped: rawBars.length - validBars.length,
    reasons,
  };

  // Log if significant drops
  if (stats.dropped > 0) {
    console.log(`[barSanitizer] ${symbol}: ${stats.output}/${stats.input} bars valid, dropped ${stats.dropped}:`, reasons);
  }

  return { bars: validBars, stats };
}

/**
 * Validate a single price tick for live updates
 */
export function isValidTick(price: any, timestamp: any): boolean {
  if (!isValidPrice(price)) return false;

  const normalizedTs = normalizeTimestamp(timestamp);
  if (normalizedTs === null) return false;

  return isValidTimestamp(normalizedTs);
}

/**
 * Sanitize a single tick, returning null if invalid
 */
export function sanitizeTick(
  price: any,
  timestamp: any,
  symbol: string
): { price: number; time: number } | null {
  if (!isValidPrice(price)) {
    console.warn(`[barSanitizer] ${symbol}: invalid tick price`, price);
    return null;
  }

  const time = normalizeTimestamp(timestamp);
  if (time === null || !isValidTimestamp(time)) {
    console.warn(`[barSanitizer] ${symbol}: invalid tick timestamp`, timestamp);
    return null;
  }

  if (!isWithinBounds(price, symbol)) {
    console.warn(`[barSanitizer] ${symbol}: tick price out of bounds`, price);
    return null;
  }

  return { price, time };
}
