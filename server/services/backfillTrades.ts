/**
 * Backfill Trades Service
 *
 * One-time script to correct historical trade data by fetching
 * actual execution data from IBKR and updating P&L calculations.
 *
 * Usage: Run via job endpoint or directly call backfillClosedTrades()
 *
 * Note: IBKR API only returns ~7 days of trade history.
 * For older trades, we may need to accept current data or manually correct.
 */

import { db } from '../db';
import { paperTrades, type Trade } from '@shared/schema';
import { eq, and, or, isNull } from 'drizzle-orm';
import { getBroker } from '../broker';
import { ensureIbkrReady } from '../broker/ibkr';

// ============================================
// Types
// ============================================

interface BackfillResult {
  success: boolean;
  processed: number;
  updated: number;
  skipped: number;
  errors: string[];
}

// ============================================
// Helper Functions
// ============================================

/**
 * Find matching IBKR trade executions for a paper trade.
 */
function findMatchingExecutions(
  trade: any,
  ibkrTrades: Trade[],
  leg1Strike: number | null,
  leg2Strike: number | null
): Trade[] {
  return ibkrTrades.filter((exec) => {
    const execSymbol = exec.symbol || '';
    const underlying = trade.symbol;

    // Must be for the same underlying
    if (!execSymbol.startsWith(underlying)) return false;

    // Check if strike matches either leg (OCC format)
    if (leg1Strike) {
      const strikeStr = leg1Strike.toFixed(0).padStart(5, '0') + '000';
      if (execSymbol.includes(strikeStr)) return true;
    }
    if (leg2Strike) {
      const strikeStr = leg2Strike.toFixed(0).padStart(5, '0') + '000';
      if (execSymbol.includes(strikeStr)) return true;
    }

    return false;
  });
}

/**
 * Calculate actual P&L from IBKR trade executions.
 */
function calculateRealizedPnl(
  entryPremium: number,
  executions: Trade[]
): { exitPrice: number; realizedPnl: number } {
  if (executions.length === 0) {
    return { exitPrice: 0, realizedPnl: entryPremium };
  }

  let totalExitCost = 0;
  let totalQuantity = 0;

  for (const exec of executions) {
    const fillPrice = exec.entryFillPrice || 0;
    const qty = exec.quantity || 0;
    totalExitCost += fillPrice * qty * 100;
    totalQuantity += qty;
  }

  const avgExitPrice = totalQuantity > 0 ? totalExitCost / (totalQuantity * 100) : 0;
  const realizedPnl = entryPremium - totalExitCost;

  return { exitPrice: avgExitPrice, realizedPnl };
}

// ============================================
// Main Backfill Function
// ============================================

/**
 * Backfill closed trades with actual IBKR execution data.
 *
 * Finds all closed trades that might have incorrect P&L:
 * - exitPrice is null
 * - realizedPnl equals entryPremiumTotal (suspiciously assumes full premium kept)
 */
export async function backfillClosedTrades(): Promise<BackfillResult> {
  console.log('[BackfillTrades] Starting backfill of closed trades...');

  const result: BackfillResult = {
    success: true,
    processed: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  if (!db) {
    result.success = false;
    result.errors.push('Database not available');
    return result;
  }

  try {
    // 1. Get all closed trades that might need correction
    const closedTrades = await db
      .select()
      .from(paperTrades)
      .where(
        and(
          eq(paperTrades.status, 'closed'),
          or(
            isNull(paperTrades.exitPrice),
            // Also check trades where exitReason suggests no fill data was used
            eq(paperTrades.exitReason, 'Position closed'),
            eq(paperTrades.exitReason, 'Position closed (no fill data)')
          )
        )
      );

    console.log(`[BackfillTrades] Found ${closedTrades.length} trades to check`);
    result.processed = closedTrades.length;

    if (closedTrades.length === 0) {
      console.log('[BackfillTrades] No trades need backfill');
      return result;
    }

    // 2. Get trade executions from IBKR
    const broker = getBroker();
    let ibkrTrades: Trade[] = [];

    if (broker.status.provider === 'ibkr') {
      try {
        await ensureIbkrReady();
        ibkrTrades = await broker.api!.getTrades();
        console.log(`[BackfillTrades] Fetched ${ibkrTrades.length} IBKR executions`);
      } catch (err) {
        console.warn('[BackfillTrades] Could not fetch IBKR trades:', err);
        result.errors.push(`IBKR fetch error: ${err}`);
      }
    } else {
      console.log('[BackfillTrades] IBKR not connected, skipping');
      result.errors.push('IBKR broker not connected');
      return result;
    }

    // 3. Try to match each trade with IBKR executions
    for (const trade of closedTrades) {
      const tradeInfo = `${trade.symbol} ${trade.strategy} (${trade.id.slice(0, 8)})`;

      try {
        const leg1Strike = trade.leg1Strike ? parseFloat(trade.leg1Strike as any) : null;
        const leg2Strike = trade.leg2Strike ? parseFloat(trade.leg2Strike as any) : null;
        const entryPremium = parseFloat(trade.entryPremiumTotal as any) || 0;

        // Find matching executions
        const matchingExecs = findMatchingExecutions(trade, ibkrTrades, leg1Strike, leg2Strike);

        if (matchingExecs.length === 0) {
          console.log(`[BackfillTrades] No IBKR matches for ${tradeInfo} (may be too old)`);
          result.skipped++;
          continue;
        }

        // Calculate actual P&L
        const { exitPrice, realizedPnl } = calculateRealizedPnl(entryPremium, matchingExecs);

        // Check if update is needed
        const currentPnl = parseFloat(trade.realizedPnl as any) || 0;
        const currentExit = parseFloat(trade.exitPrice as any) || 0;

        if (Math.abs(realizedPnl - currentPnl) < 0.01 && Math.abs(exitPrice - currentExit) < 0.0001) {
          console.log(`[BackfillTrades] ${tradeInfo} already correct, skipping`);
          result.skipped++;
          continue;
        }

        // Update the trade
        console.log(`[BackfillTrades] Updating ${tradeInfo}: P&L $${currentPnl.toFixed(2)} -> $${realizedPnl.toFixed(2)}`);

        await db
          .update(paperTrades)
          .set({
            exitPrice: exitPrice.toString(),
            exitReason: 'Backfilled from IBKR',
            realizedPnl: realizedPnl.toString(),
          })
          .where(eq(paperTrades.id, trade.id));

        result.updated++;
      } catch (err: any) {
        console.error(`[BackfillTrades] Error processing ${tradeInfo}:`, err);
        result.errors.push(`${tradeInfo}: ${err.message}`);
      }
    }

    console.log(`[BackfillTrades] Complete: ${result.updated} updated, ${result.skipped} skipped, ${result.errors.length} errors`);
    return result;
  } catch (error: any) {
    console.error('[BackfillTrades] Fatal error:', error);
    result.success = false;
    result.errors.push(error.message || 'Unknown error');
    return result;
  }
}

/**
 * Backfill a single trade by ID (for manual corrections)
 */
export async function backfillSingleTrade(tradeId: string): Promise<{ success: boolean; message: string }> {
  if (!db) {
    return { success: false, message: 'Database not available' };
  }

  try {
    const [trade] = await db
      .select()
      .from(paperTrades)
      .where(eq(paperTrades.id, tradeId));

    if (!trade) {
      return { success: false, message: 'Trade not found' };
    }

    const broker = getBroker();
    if (broker.status.provider !== 'ibkr') {
      return { success: false, message: 'IBKR not connected' };
    }

    await ensureIbkrReady();
    const ibkrTrades = await broker.api!.getTrades();

    const leg1Strike = trade.leg1Strike ? parseFloat(trade.leg1Strike as any) : null;
    const leg2Strike = trade.leg2Strike ? parseFloat(trade.leg2Strike as any) : null;
    const entryPremium = parseFloat(trade.entryPremiumTotal as any) || 0;

    const matchingExecs = findMatchingExecutions(trade, ibkrTrades, leg1Strike, leg2Strike);

    if (matchingExecs.length === 0) {
      return { success: false, message: 'No matching IBKR executions found (may be older than 7 days)' };
    }

    const { exitPrice, realizedPnl } = calculateRealizedPnl(entryPremium, matchingExecs);

    await db
      .update(paperTrades)
      .set({
        exitPrice: exitPrice.toString(),
        exitReason: 'Manually backfilled from IBKR',
        realizedPnl: realizedPnl.toString(),
      })
      .where(eq(paperTrades.id, tradeId));

    return {
      success: true,
      message: `Updated: exit=$${exitPrice.toFixed(4)}, P&L=$${realizedPnl.toFixed(2)}`,
    };
  } catch (error: any) {
    return { success: false, message: error.message || 'Unknown error' };
  }
}

// ============================================
// Fix Expired Trades
// ============================================

/**
 * Fix expired trades that have null/0 realizedPnl.
 *
 * For expired options, the full premium is kept (they expired worthless).
 * No IBKR lookup needed - just set realizedPnl = entryPremiumTotal.
 */
export async function fixExpiredTrades(): Promise<BackfillResult> {
  console.log('[BackfillTrades] Starting fix for expired trades...');

  const result: BackfillResult = {
    success: true,
    processed: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  if (!db) {
    result.success = false;
    result.errors.push('Database not available');
    return result;
  }

  try {
    // Find expired trades with null or '0' realizedPnl
    const expiredTrades = await db
      .select()
      .from(paperTrades)
      .where(
        and(
          eq(paperTrades.status, 'expired'),
          or(
            isNull(paperTrades.realizedPnl),
            eq(paperTrades.realizedPnl, '0')
          )
        )
      );

    console.log(`[BackfillTrades] Found ${expiredTrades.length} expired trades to fix`);
    result.processed = expiredTrades.length;

    if (expiredTrades.length === 0) {
      console.log('[BackfillTrades] No expired trades need fixing');
      return result;
    }

    // For each expired trade, set realizedPnl = entryPremiumTotal
    for (const trade of expiredTrades) {
      const tradeInfo = `${trade.symbol} ${trade.strategy} (${trade.id.slice(0, 8)})`;
      const entryPremium = trade.entryPremiumTotal;

      if (!entryPremium) {
        console.log(`[BackfillTrades] ${tradeInfo} has no entry premium, skipping`);
        result.skipped++;
        continue;
      }

      try {
        console.log(`[BackfillTrades] Fixing ${tradeInfo}: realizedPnl = $${entryPremium}`);

        await db
          .update(paperTrades)
          .set({
            realizedPnl: entryPremium.toString(),
            exitPrice: '0.00',
            exitReason: 'Expired worthless',
          })
          .where(eq(paperTrades.id, trade.id));

        result.updated++;
      } catch (err: any) {
        console.error(`[BackfillTrades] Error fixing ${tradeInfo}:`, err);
        result.errors.push(`${tradeInfo}: ${err.message}`);
      }
    }

    console.log(`[BackfillTrades] Expired fix complete: ${result.updated} updated, ${result.skipped} skipped`);
    return result;
  } catch (error: any) {
    console.error('[BackfillTrades] Fatal error:', error);
    result.success = false;
    result.errors.push(error.message || 'Unknown error');
    return result;
  }
}
