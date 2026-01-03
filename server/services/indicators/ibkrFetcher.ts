/**
 * IBKR-based Indicator Fetcher
 *
 * Uses existing IBKR services to fetch price data for indicator calculation.
 * This keeps the data source consistent with trading execution.
 */

import { getRecentBars } from '../ibkrHistoricalService';
import { getVIXData } from '../marketDataService';
import { PriceBar, calculateIndicators, IndicatorSnapshot } from './calculator';

/**
 * Convert IBKR CuratedBar to PriceBar format for indicator calculation
 */
function convertToPriceBar(bar: { time: number; open: number; high: number; low: number; close: number; volume?: number }): PriceBar {
  return {
    date: new Date(bar.time * 1000), // IBKR uses Unix seconds
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume || 0,
  };
}

/**
 * Fetch price bars from IBKR and convert to PriceBar format
 */
export async function fetchPriceBars(symbol: string, count: number = 60): Promise<PriceBar[]> {
  try {
    // Use daily bars for indicator calculation (more stable signals)
    const bars = await getRecentBars(symbol, '1D', count);
    return bars.map(convertToPriceBar);
  } catch (error) {
    console.error(`Failed to fetch price bars for ${symbol} from IBKR:`, error);
    throw error;
  }
}

/**
 * Fetch current VIX value from IBKR
 */
export async function fetchVix(): Promise<number> {
  try {
    const vixData = await getVIXData();
    return vixData?.value || 20; // Default to 20 if unavailable
  } catch (error) {
    console.warn('Failed to fetch VIX from IBKR, using default:', error);
    return 20;
  }
}

/**
 * Get complete indicator snapshot for a symbol
 *
 * This is the main function used by the RLHF system to capture
 * market context at the time of each trading decision.
 */
export async function getIndicatorSnapshot(symbol: string): Promise<IndicatorSnapshot & { vix: number }> {
  // Fetch price bars and VIX in parallel
  const [bars, vix] = await Promise.all([
    fetchPriceBars(symbol, 60),
    fetchVix(),
  ]);

  if (bars.length === 0) {
    throw new Error(`No price data available for ${symbol}`);
  }

  const indicators = calculateIndicators(bars, vix);
  return { ...indicators, vix };
}

/**
 * Get indicator snapshot with fallback for missing data
 *
 * Returns partial data if VIX is unavailable, rather than failing entirely.
 */
export async function getIndicatorSnapshotSafe(symbol: string): Promise<(IndicatorSnapshot & { vix: number }) | null> {
  try {
    return await getIndicatorSnapshot(symbol);
  } catch (error) {
    console.error(`Failed to get indicator snapshot for ${symbol}:`, error);
    return null;
  }
}
