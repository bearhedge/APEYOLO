/**
 * Option Bar Capture Job
 *
 * Captures 5-minute option OHLC bars from the streamer.
 * Uses WebSocket OHLC when available, falls back to HTTP snapshot.
 * Stores to option_bars table for historical backtesting.
 */

import { db } from '../../db';
import { optionBars, type InsertOptionBar } from '@shared/schema';
import { getOptionChainStreamer, type CachedOptionChain, type CachedStrike } from '../../broker/optionChainStreamer';
import { getETDateString } from '../marketCalendar';

// ============================================
// Types
// ============================================

export interface CaptureResult {
  symbol: string;
  intervalStart: Date;
  barsInserted: number;
  completeCount: number;
  partialCount: number;
  snapshotOnlyCount: number;
  wsConnected: boolean;
}

// ============================================
// Helper Functions
// ============================================

/**
 * Get the start of a 5-minute interval, aligned to clock boundaries
 */
function getIntervalStart(date: Date, intervalMinutes: number = 5): Date {
  const ms = date.getTime();
  const intervalMs = intervalMinutes * 60 * 1000;
  return new Date(Math.floor(ms / intervalMs) * intervalMs);
}

/**
 * Get today's date in YYYYMMDD format (ET timezone)
 */
function getTodayExpiry(): string {
  // getETDateString returns YYYY-MM-DD, convert to YYYYMMDD
  const etDate = getETDateString();
  return etDate.replace(/-/g, '');
}

/**
 * Filter to liquid strikes only (ATM ± $7)
 * Based on plan: roughly 1% from SPY price, ~28 options per snapshot
 */
function filterLiquidStrikes(
  strikes: CachedStrike[],
  underlyingPrice: number,
  optionType: 'PUT' | 'CALL'
): CachedStrike[] {
  const STRIKE_RANGE = 7; // ± $7 from ATM

  return strikes.filter(strike => {
    const distanceFromATM = Math.abs(strike.strike - underlyingPrice);

    // Primary filter: within $7 of ATM
    if (distanceFromATM <= STRIKE_RANGE) {
      return true;
    }

    // Secondary filter: high open interest (>1000)
    if (strike.openInterest && strike.openInterest > 1000) {
      return true;
    }

    return false;
  }).map(s => ({ ...s, optionType }));
}

/**
 * Determine data quality based on tick count and WS connection
 */
function getDataQuality(strike: CachedStrike, wsConnected: boolean): 'complete' | 'partial' | 'snapshot_only' {
  if (!wsConnected) {
    return 'snapshot_only';
  }

  // If we have OHLC data from tick tracking
  if (strike.tickCount && strike.tickCount > 0) {
    // Complete if we have multiple ticks
    return strike.tickCount >= 2 ? 'complete' : 'partial';
  }

  return 'partial';
}

// ============================================
// Main Capture Function
// ============================================

/**
 * Capture option bars for a symbol
 * Called every 5 minutes by the scheduler
 */
export async function captureOptionBars(symbol: string = 'SPY'): Promise<CaptureResult> {
  const streamer = getOptionChainStreamer();
  const chain = streamer.getOptionChain(symbol);
  const status = streamer.getStatus();
  const intervalStart = getIntervalStart(new Date(), 5);
  // Use chain's expiry if available, otherwise compute from current date
  const expiry = chain?.expiry || getTodayExpiry();

  const result: CaptureResult = {
    symbol,
    intervalStart,
    barsInserted: 0,
    completeCount: 0,
    partialCount: 0,
    snapshotOnlyCount: 0,
    wsConnected: status.wsConnected,
  };

  if (!chain) {
    console.log(`[OptionBarCapture] No cached chain for ${symbol}, skipping`);
    return result;
  }

  // Filter to liquid strikes only
  const liquidPuts = filterLiquidStrikes(chain.puts, chain.underlyingPrice, 'PUT');
  const liquidCalls = filterLiquidStrikes(chain.calls, chain.underlyingPrice, 'CALL');
  const allStrikes = [...liquidPuts, ...liquidCalls];

  console.log(`[OptionBarCapture] Capturing ${allStrikes.length} liquid strikes for ${symbol} at ${intervalStart.toISOString()}`);

  // Build bars for insertion
  const bars: InsertOptionBar[] = allStrikes.map(strike => {
    const hasOHLC = strike.tickCount && strike.tickCount > 0;
    const dataQuality = getDataQuality(strike, status.wsConnected);

    // Track quality counts
    if (dataQuality === 'complete') result.completeCount++;
    else if (dataQuality === 'partial') result.partialCount++;
    else result.snapshotOnlyCount++;

    return {
      symbol,
      strike: String(strike.strike),
      expiry,
      optionType: strike.optionType || 'PUT',
      intervalStart,

      // OHLC from WebSocket (if available)
      open: hasOHLC && strike.intervalOpen != null ? String(strike.intervalOpen) : null,
      high: hasOHLC && strike.intervalHigh != null ? String(strike.intervalHigh) : null,
      low: hasOHLC && strike.intervalLow != null ? String(strike.intervalLow) : null,
      close: hasOHLC && strike.intervalClose != null
        ? String(strike.intervalClose)
        : (strike.last != null ? String(strike.last) : null),

      // Always capture current bid/ask
      bidClose: strike.bid != null ? String(strike.bid) : null,
      askClose: strike.ask != null ? String(strike.ask) : null,

      // Greeks
      delta: strike.delta != null ? String(strike.delta) : null,
      gamma: strike.gamma != null ? String(strike.gamma) : null,
      theta: strike.theta != null ? String(strike.theta) : null,
      vega: strike.vega != null ? String(strike.vega) : null,
      iv: strike.iv != null ? String(strike.iv) : null,
      openInterest: strike.openInterest ?? null,

      // Quality tracking
      dataQuality,
      tickCount: strike.tickCount ?? 0,

      // Underlying context
      underlyingPrice: String(chain.underlyingPrice),
      vix: chain.vix != null ? String(chain.vix) : null,
    };
  });

  if (bars.length === 0) {
    console.log(`[OptionBarCapture] No bars to insert for ${symbol}`);
    return result;
  }

  // Batch insert with conflict handling (idempotent)
  try {
    if (!db) {
      throw new Error('Database not initialized');
    }
    await db.insert(optionBars).values(bars).onConflictDoNothing();
    result.barsInserted = bars.length;
    console.log(`[OptionBarCapture] Inserted ${bars.length} bars for ${symbol} (complete: ${result.completeCount}, partial: ${result.partialCount}, snapshot: ${result.snapshotOnlyCount})`);
  } catch (error: any) {
    console.error(`[OptionBarCapture] Insert failed:`, error.message);
    throw error;
  }

  // Reset OHLC accumulators for next interval
  streamer.resetIntervalTracking(symbol);

  return result;
}
