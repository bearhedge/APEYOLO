// @ts-nocheck
// TODO: Add proper null checks for db and broker.api
/**
 * Option Chain Capture Job
 *
 * Captures option chain data from IBKR before market close.
 * Stores the snapshot in PostgreSQL for historical analysis and off-hours display.
 */

import { db } from '../../db';
import { optionChainSnapshots } from '@shared/schema';
import { eq, and, desc } from 'drizzle-orm';
import { getOptionChainWithStrikes } from '../../broker/ibkr';
import { registerJobHandler, type JobResult, type JobHandler } from '../jobExecutor';
import { getETDateString, getMarketStatus } from '../marketCalendar';

// ============================================
// Types
// ============================================

interface CaptureConfig {
  symbol: string;
}

interface OptionChainCaptureResult {
  snapshotId: string;
  symbol: string;
  underlyingPrice: number;
  vix: number;
  expiration: string;
  putsCount: number;
  callsCount: number;
  capturedAt: string;
}

// ============================================
// Job Handler Implementation
// ============================================

/**
 * Option Chain Capture Job Handler
 */
export const optionChainCaptureHandler: JobHandler = {
  id: 'market-close-options',
  name: 'Market Close Option Chain',
  description: 'Capture option chain data for SPY before market close',

  async execute(): Promise<JobResult> {
    const marketDay = getETDateString();
    const symbol = 'SPY'; // Default symbol, could be made configurable

    console.log(`[OptionChainCapture] Starting capture for ${symbol} on ${marketDay}`);

    // 1. Check if market is open today (redundant but safe)
    const marketStatus = getMarketStatus();
    if (!marketStatus.isOpen) {
      console.log(`[OptionChainCapture] Market is closed: ${marketStatus.reason}`);
      return {
        success: false,
        skipped: true,
        reason: `Market closed: ${marketStatus.reason}`,
      };
    }

    // 2. Check if we already have a snapshot for today
    const existingSnapshots = await db
      .select()
      .from(optionChainSnapshots)
      .where(
        and(
          eq(optionChainSnapshots.symbol, symbol),
          eq(optionChainSnapshots.marketDay, marketDay)
        )
      )
      .limit(1);

    if (existingSnapshots && existingSnapshots.length > 0) {
      console.log(`[OptionChainCapture] Already have snapshot for ${symbol} on ${marketDay}`);
      return {
        success: true,
        skipped: true,
        reason: `Snapshot already exists for ${marketDay}`,
        data: { existingSnapshotId: existingSnapshots[0].id },
      };
    }

    // 3. Fetch option chain from IBKR
    console.log(`[OptionChainCapture] Fetching option chain from IBKR...`);
    let chainData;
    try {
      chainData = await getOptionChainWithStrikes(symbol);
    } catch (error: any) {
      console.error(`[OptionChainCapture] IBKR fetch failed:`, error.message);
      return {
        success: false,
        error: `IBKR fetch failed: ${error.message}`,
      };
    }

    if (!chainData || !chainData.underlyingPrice) {
      console.error(`[OptionChainCapture] Invalid chain data received`);
      return {
        success: false,
        error: 'Invalid option chain data received from IBKR',
      };
    }

    // 4. Store snapshot in database
    console.log(`[OptionChainCapture] Storing snapshot...`);
    const [snapshot] = await db
      .insert(optionChainSnapshots)
      .values({
        symbol,
        marketDay,
        underlyingPrice: String(chainData.underlyingPrice),
        vix: chainData.vix ? String(chainData.vix) : null,
        expiration: chainData.expiration || null,
        chainData: {
          puts: chainData.puts || [],
          calls: chainData.calls || [],
        },
        metadata: {
          capturedAt: new Date().toISOString(),
          marketStatus: marketStatus.reason,
          source: 'ibkr',
        },
      })
      .returning();

    console.log(`[OptionChainCapture] Snapshot stored: ${snapshot.id}`);

    // 5. Return success with captured data summary
    const result: OptionChainCaptureResult = {
      snapshotId: snapshot.id,
      symbol,
      underlyingPrice: chainData.underlyingPrice,
      vix: chainData.vix || 0,
      expiration: chainData.expiration || 'N/A',
      putsCount: chainData.puts?.length || 0,
      callsCount: chainData.calls?.length || 0,
      capturedAt: new Date().toISOString(),
    };

    return {
      success: true,
      data: result,
    };
  },
};

// ============================================
// Helper Functions
// ============================================

/**
 * Get the latest snapshot for a symbol
 */
export async function getLatestSnapshot(symbol: string) {
  const [snapshot] = await db
    .select()
    .from(optionChainSnapshots)
    .where(eq(optionChainSnapshots.symbol, symbol.toUpperCase()))
    .orderBy(desc(optionChainSnapshots.capturedAt))
    .limit(1);

  return snapshot || null;
}

/**
 * Get snapshots for a symbol within a date range
 */
export async function getSnapshotHistory(
  symbol: string,
  days: number = 30
): Promise<typeof optionChainSnapshots.$inferSelect[]> {
  const snapshots = await db
    .select()
    .from(optionChainSnapshots)
    .where(eq(optionChainSnapshots.symbol, symbol.toUpperCase()))
    .orderBy(desc(optionChainSnapshots.capturedAt))
    .limit(days);

  return snapshots;
}

// ============================================
// Registration
// ============================================

/**
 * Initialize and register the option chain capture job handler
 */
export function initializeOptionChainCaptureJob(): void {
  registerJobHandler(optionChainCaptureHandler);
  console.log('[OptionChainCapture] Job handler registered');
}
