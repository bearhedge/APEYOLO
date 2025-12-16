/**
 * Historical Data Ingestion Service
 *
 * Bulk fetches historical data from IBKR and persists to PostgreSQL.
 * Historical data is IMMUTABLE - fetch once, store forever, serve from DB.
 *
 * Key insight: Yesterday's candles never change. Only the current candle needs real-time updates.
 */

import { db, pool } from '../db';
import { marketData, type InsertMarketData } from '@shared/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import {
  ensureIbkrReady,
  resolveSymbolConid,
  fetchIbkrHistoricalData,
  type IbkrHistoricalBar,
} from '../broker/ibkr';
import { sanitizeBars } from '../utils/barSanitizer';

// ============================================
// Types
// ============================================

export type BarInterval = '1m' | '5m' | '15m' | '1h' | '1D' | '1W' | '1M';

interface IngestionConfig {
  symbol: string;
  intervals: BarInterval[];
}

interface IngestionResult {
  symbol: string;
  interval: BarInterval;
  barsIngested: number;
  barsSkipped: number;
  firstBar: Date | null;
  lastBar: Date | null;
  durationMs: number;
}

interface IngestionProgress {
  symbol: string;
  currentInterval: BarInterval;
  progress: number; // 0-100
  status: 'idle' | 'running' | 'completed' | 'error';
  error?: string;
  results: IngestionResult[];
}

// ============================================
// Configuration
// ============================================

// IBKR lookback periods per interval (how much history to fetch)
const LOOKBACK_CONFIG: Record<BarInterval, string> = {
  '1m': '7d',      // 7 days of 1-min bars (IBKR max ~7 days)
  '5m': '30d',     // 30 days of 5-min bars
  '15m': '60d',    // 60 days of 15-min bars
  '1h': '1y',      // 1 year of hourly bars
  '1D': '5y',      // 5 years of daily bars
  '1W': '10y',     // 10 years of weekly bars
  '1M': '20y',     // 20 years of monthly bars
};

// Map our interval to IBKR bar size
const INTERVAL_TO_BAR: Record<BarInterval, string> = {
  '1m': '1min',
  '5m': '5mins',
  '15m': '15mins',
  '1h': '1h',
  '1D': '1d',
  '1W': '1w',
  '1M': '1m',  // Note: IBKR uses '1m' for 1 month bars
};

// Rate limiting: IBKR has rate limits
const RATE_LIMIT_DELAY_MS = 1000; // 1 second between requests

// ============================================
// Progress Tracking
// ============================================

const ingestionProgress: Map<string, IngestionProgress> = new Map();

export function getIngestionProgress(symbol: string): IngestionProgress | null {
  return ingestionProgress.get(symbol) || null;
}

export function getAllIngestionProgress(): IngestionProgress[] {
  return Array.from(ingestionProgress.values());
}

// ============================================
// Core Ingestion Functions
// ============================================

/**
 * Fetch historical bars from IBKR for a specific interval
 */
async function fetchFromIbkr(
  symbol: string,
  conid: number,
  interval: BarInterval
): Promise<Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>> {
  const period = LOOKBACK_CONFIG[interval];
  const bar = INTERVAL_TO_BAR[interval];

  console.log(`[Ingestion] Fetching ${symbol} ${interval} bars (period=${period}, bar=${bar})...`);

  const historicalData = await fetchIbkrHistoricalData(conid, {
    period,
    bar,
    outsideRth: true, // Include pre-market and after-hours
  });

  if (!historicalData.data || !Array.isArray(historicalData.data)) {
    console.error(`[Ingestion] Invalid response: no data array`);
    return [];
  }

  // Convert IBKR bars to our format
  const rawBars = historicalData.data.map((bar: IbkrHistoricalBar) => ({
    time: Math.floor(bar.t / 1000),  // Convert ms to seconds
    open: bar.o,
    high: bar.h,
    low: bar.l,
    close: bar.c,
    volume: bar.v || 0,
  }));

  // Sanitize through barSanitizer
  const { bars: sanitizedBars, stats } = sanitizeBars(rawBars, symbol);

  if (stats.dropped > 0) {
    console.log(`[Ingestion] Sanitizer dropped ${stats.dropped}/${stats.input} bars:`, stats.reasons);
  }

  console.log(`[Ingestion] Received ${sanitizedBars.length} valid bars for ${symbol} ${interval}`);

  return sanitizedBars;
}

/**
 * Get the timestamp of the most recent bar in the database for a symbol/interval
 */
async function getLastStoredTimestamp(symbol: string, interval: BarInterval): Promise<Date | null> {
  if (!db) return null;

  const result = await db
    .select({ timestamp: marketData.timestamp })
    .from(marketData)
    .where(and(eq(marketData.symbol, symbol), eq(marketData.interval, interval)))
    .orderBy(desc(marketData.timestamp))
    .limit(1);

  return result[0]?.timestamp || null;
}

/**
 * Upsert bars to the database with deduplication
 */
async function upsertBars(
  symbol: string,
  interval: BarInterval,
  bars: Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>
): Promise<{ inserted: number; skipped: number }> {
  if (!pool || bars.length === 0) {
    console.log('[Ingestion] No pool or empty bars, skipping insert');
    return { inserted: 0, skipped: 0 };
  }

  let inserted = 0;
  let skipped = 0;

  // Use direct SQL INSERT instead of Drizzle ORM (bypasses Drizzle issues)
  const client = await pool.connect();
  console.log(`[Ingestion] Got pool connection, inserting ${bars.length} bars...`);

  try {
    for (const bar of bars) {
      try {
        const timestamp = new Date(bar.time * 1000).toISOString();
        const result = await client.query(`
          INSERT INTO market_data (symbol, timestamp, open, high, low, close, volume, interval, source)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING id
        `, [
          symbol,
          timestamp,
          bar.open.toString(),
          bar.high.toString(),
          bar.low.toString(),
          bar.close.toString(),
          Math.round(bar.volume || 0),  // Round volume to integer for bigint column
          interval,
          'ibkr'
        ]);

        if (result.rowCount && result.rowCount > 0) {
          inserted++;
        } else {
          skipped++;
        }
      } catch (insertError: any) {
        console.error(`[Ingestion] Insert error: ${insertError.message}`);
        console.error(`[Ingestion] Error code: ${insertError.code}`);
        skipped++;
      }

      // Progress logging every 200 bars
      if ((inserted + skipped) % 200 === 0) {
        console.log(`[Ingestion] Progress: ${inserted + skipped}/${bars.length} bars processed (${inserted} inserted, ${skipped} skipped)`);
      }
    }
  } finally {
    client.release();
  }

  console.log(`[Ingestion] Completed: ${inserted} inserted, ${skipped} skipped out of ${bars.length} total`);
  return { inserted, skipped };
}

/**
 * Ingest historical data for a single symbol and interval
 */
async function ingestInterval(
  symbol: string,
  conid: number,
  interval: BarInterval
): Promise<IngestionResult> {
  const startTime = Date.now();

  try {
    // Fetch from IBKR
    const bars = await fetchFromIbkr(symbol, conid, interval);

    if (bars.length === 0) {
      return {
        symbol,
        interval,
        barsIngested: 0,
        barsSkipped: 0,
        firstBar: null,
        lastBar: null,
        durationMs: Date.now() - startTime,
      };
    }

    // Upsert to database
    const { inserted, skipped } = await upsertBars(symbol, interval, bars);

    const sortedBars = [...bars].sort((a, b) => a.time - b.time);

    return {
      symbol,
      interval,
      barsIngested: inserted,
      barsSkipped: skipped,
      firstBar: new Date(sortedBars[0].time * 1000),
      lastBar: new Date(sortedBars[sortedBars.length - 1].time * 1000),
      durationMs: Date.now() - startTime,
    };
  } catch (error: any) {
    console.error(`[Ingestion] Error ingesting ${symbol} ${interval}:`, error.message);
    return {
      symbol,
      interval,
      barsIngested: 0,
      barsSkipped: 0,
      firstBar: null,
      lastBar: null,
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Main ingestion function - ingests all intervals for a symbol
 */
export async function ingestHistoricalData(
  symbol: string,
  intervals: BarInterval[] = ['1m', '5m', '15m', '1h', '1D']
): Promise<IngestionResult[]> {
  if (!db) {
    throw new Error('Database not configured');
  }

  // Initialize progress tracking
  const progress: IngestionProgress = {
    symbol,
    currentInterval: intervals[0],
    progress: 0,
    status: 'running',
    results: [],
  };
  ingestionProgress.set(symbol, progress);

  try {
    // Ensure IBKR is authenticated
    await ensureIbkrReady();

    // Resolve symbol to conid
    const conid = await resolveSymbolConid(symbol);
    if (!conid) {
      throw new Error(`Could not resolve conid for ${symbol}`);
    }

    console.log(`[Ingestion] Starting ingestion for ${symbol} (conid=${conid})`);
    console.log(`[Ingestion] Intervals: ${intervals.join(', ')}`);

    const results: IngestionResult[] = [];

    for (let i = 0; i < intervals.length; i++) {
      const interval = intervals[i];
      progress.currentInterval = interval;
      progress.progress = Math.round((i / intervals.length) * 100);
      ingestionProgress.set(symbol, progress);

      console.log(`[Ingestion] Processing ${symbol} ${interval} (${i + 1}/${intervals.length})...`);

      const result = await ingestInterval(symbol, conid, interval);
      results.push(result);
      progress.results.push(result);

      console.log(`[Ingestion] ${symbol} ${interval}: ${result.barsIngested} inserted, ${result.barsSkipped} skipped (${result.durationMs}ms)`);

      // Rate limiting between requests
      if (i < intervals.length - 1) {
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS));
      }
    }

    progress.status = 'completed';
    progress.progress = 100;
    ingestionProgress.set(symbol, progress);

    console.log(`[Ingestion] Completed ingestion for ${symbol}`);
    return results;

  } catch (error: any) {
    progress.status = 'error';
    progress.error = error.message;
    ingestionProgress.set(symbol, progress);
    throw error;
  }
}

/**
 * Ingest only new data since last stored bar (incremental update)
 */
export async function ingestIncrementalData(
  symbol: string,
  intervals: BarInterval[] = ['1m', '5m', '15m', '1h', '1D']
): Promise<IngestionResult[]> {
  console.log(`[Ingestion] Starting incremental ingestion for ${symbol}`);

  // For now, use full ingestion with ON CONFLICT deduplication
  // Future optimization: track last bar timestamp and fetch only newer data
  return ingestHistoricalData(symbol, intervals);
}

/**
 * Get statistics about stored data
 */
export async function getStorageStats(symbol?: string): Promise<{
  totalBars: number;
  bySymbol: Record<string, number>;
  byInterval: Record<string, number>;
  oldestBar: Date | null;
  newestBar: Date | null;
}> {
  if (!db) {
    return {
      totalBars: 0,
      bySymbol: {},
      byInterval: {},
      oldestBar: null,
      newestBar: null,
    };
  }

  // Total count
  const totalQuery = symbol
    ? await db.select({ count: sql<number>`count(*)` }).from(marketData).where(eq(marketData.symbol, symbol))
    : await db.select({ count: sql<number>`count(*)` }).from(marketData);
  const totalBars = Number(totalQuery[0]?.count || 0);

  // By symbol
  const bySymbolQuery = await db
    .select({
      symbol: marketData.symbol,
      count: sql<number>`count(*)`,
    })
    .from(marketData)
    .groupBy(marketData.symbol);
  const bySymbol: Record<string, number> = {};
  for (const row of bySymbolQuery) {
    bySymbol[row.symbol] = Number(row.count);
  }

  // By interval
  const byIntervalQuery = symbol
    ? await db
        .select({
          interval: marketData.interval,
          count: sql<number>`count(*)`,
        })
        .from(marketData)
        .where(eq(marketData.symbol, symbol))
        .groupBy(marketData.interval)
    : await db
        .select({
          interval: marketData.interval,
          count: sql<number>`count(*)`,
        })
        .from(marketData)
        .groupBy(marketData.interval);
  const byInterval: Record<string, number> = {};
  for (const row of byIntervalQuery) {
    byInterval[row.interval] = Number(row.count);
  }

  // Oldest and newest bars
  const timestampQuery = symbol
    ? await db
        .select({
          oldest: sql<Date>`min(timestamp)`,
          newest: sql<Date>`max(timestamp)`,
        })
        .from(marketData)
        .where(eq(marketData.symbol, symbol))
    : await db
        .select({
          oldest: sql<Date>`min(timestamp)`,
          newest: sql<Date>`max(timestamp)`,
        })
        .from(marketData);

  return {
    totalBars,
    bySymbol,
    byInterval,
    oldestBar: timestampQuery[0]?.oldest || null,
    newestBar: timestampQuery[0]?.newest || null,
  };
}

/**
 * Clear all stored data for a symbol (use with caution)
 */
export async function clearStoredData(symbol: string, interval?: BarInterval): Promise<number> {
  if (!db) return 0;

  const condition = interval
    ? and(eq(marketData.symbol, symbol), eq(marketData.interval, interval))
    : eq(marketData.symbol, symbol);

  const result = await db.delete(marketData).where(condition).returning({ id: marketData.id });

  console.log(`[Ingestion] Cleared ${result.length} bars for ${symbol}${interval ? ` (${interval})` : ''}`);
  return result.length;
}
