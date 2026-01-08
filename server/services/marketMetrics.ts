/**
 * Market Metrics Service
 *
 * Calculates derived market metrics that IBKR WebSocket doesn't provide:
 * - Change % (from previous close)
 * - IV Rank (from VIX relative to 52-week range)
 * - VWAP (Volume Weighted Average Price)
 */

// Store previous close prices (fetched once at startup/market open)
let spyPrevClose: number | null = null;
let vixPrevClose: number | null = null;

// VWAP tracking (reset daily at market open)
let vwapNumerator = 0;  // Σ(price × volume)
let vwapDenominator = 0; // Σ(volume)
let lastResetDate: string | null = null;

// IV Rank constants (approximate 52-week VIX range)
// Based on historical VIX data: typically ranges 11-35, with extremes to 80+
const VIX_52WK_LOW = 11;
const VIX_52WK_HIGH = 35;

/**
 * Set previous close prices (call once at startup or market open)
 */
export function setPreviousClose(spy: number, vix: number): void {
  spyPrevClose = spy;
  vixPrevClose = vix;
  console.log(`[MarketMetrics] Previous close set: SPY=$${spy.toFixed(2)}, VIX=${vix.toFixed(2)}`);
}

/**
 * Get previous close values
 */
export function getPreviousClose(): { spy: number | null; vix: number | null } {
  return { spy: spyPrevClose, vix: vixPrevClose };
}

/**
 * Calculate percentage change from previous close
 */
export function calculateChangePercent(current: number, prevClose: number | null): number {
  if (!prevClose || prevClose === 0) return 0;
  return ((current - prevClose) / prevClose) * 100;
}

/**
 * Calculate absolute change from previous close
 */
export function calculateChange(current: number, prevClose: number | null): number {
  if (!prevClose) return 0;
  return current - prevClose;
}

/**
 * Update VWAP with new price and volume data
 * Returns current VWAP value
 */
export function updateVWAP(price: number, volume: number): number {
  // Check if we need to reset for new trading day
  const today = new Date().toISOString().split('T')[0];
  if (lastResetDate !== today) {
    resetDailyMetrics();
    lastResetDate = today;
  }

  if (volume > 0) {
    vwapNumerator += price * volume;
    vwapDenominator += volume;
  }

  return vwapDenominator > 0 ? vwapNumerator / vwapDenominator : price;
}

/**
 * Get current VWAP without updating
 */
export function getVWAP(): number | null {
  return vwapDenominator > 0 ? vwapNumerator / vwapDenominator : null;
}

/**
 * Calculate IV Rank based on current VIX
 * IV Rank = (Current VIX - 52-week Low) / (52-week High - 52-week Low) * 100
 * Returns value 0-100 (clamped)
 */
export function calculateIVRank(currentVix: number): number {
  if (!currentVix || currentVix <= 0) return 0;

  const rank = ((currentVix - VIX_52WK_LOW) / (VIX_52WK_HIGH - VIX_52WK_LOW)) * 100;

  // Clamp to 0-100 range
  return Math.max(0, Math.min(100, Math.round(rank)));
}

/**
 * Reset daily metrics (call at market open)
 */
export function resetDailyMetrics(): void {
  vwapNumerator = 0;
  vwapDenominator = 0;
  console.log('[MarketMetrics] Daily metrics reset');
}

/**
 * Get all current metrics
 */
export function getMetrics(): {
  spyPrevClose: number | null;
  vixPrevClose: number | null;
  vwap: number | null;
} {
  return {
    spyPrevClose,
    vixPrevClose,
    vwap: getVWAP(),
  };
}

/**
 * Calculate all SPY metrics at once
 */
export function calculateSpyMetrics(currentPrice: number): {
  change: number;
  changePct: number;
  vwap: number | null;
} {
  return {
    change: calculateChange(currentPrice, spyPrevClose),
    changePct: calculateChangePercent(currentPrice, spyPrevClose),
    vwap: getVWAP(),
  };
}

/**
 * Calculate all VIX metrics at once
 */
export function calculateVixMetrics(currentVix: number): {
  change: number;
  changePct: number;
  ivRank: number;
} {
  return {
    change: calculateChange(currentVix, vixPrevClose),
    changePct: calculateChangePercent(currentVix, vixPrevClose),
    ivRank: calculateIVRank(currentVix),
  };
}
