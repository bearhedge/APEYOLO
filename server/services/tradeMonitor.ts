// @ts-nocheck
// TODO: Add proper null checks for db and broker.api
/**
 * Trade Monitor Service
 *
 * Monitors open trades and automatically updates their status when:
 * - Position is closed (no longer in IBKR portfolio)
 * - Option expires (past expiration date)
 * - Stop loss triggered
 *
 * Calculates and records realized P&L for track record.
 */

import { db } from '../db';
import { paperTrades, orders, type Trade } from '@shared/schema';
import { eq, and, isNull, lt, inArray } from 'drizzle-orm';
import { getBroker } from '../broker';
import { ensureIbkrReady } from '../broker/ibkr';
import { registerJobHandler, type JobResult } from './jobExecutor';

// ============================================
// Types
// ============================================

interface OpenTrade {
  id: string;
  symbol: string;
  strategy: string;
  contracts: number;
  leg1Strike: string | null;
  leg2Strike: string | null;
  entryPremiumTotal: string;
  expiration: Date;
  ibkrOrderIds: any;
  status: string;
}

interface IbkrPosition {
  conid: string;
  symbol: string;
  position: number;
  mktPrice: number;
  unrealizedPnl: number;
}

// ============================================
// Helper: Match IBKR execution to a trade
// ============================================

/**
 * Find matching IBKR trade executions for a paper trade.
 * Matches by underlying symbol and strike price in the OCC symbol format.
 */
function findMatchingExecutions(
  trade: OpenTrade,
  ibkrTrades: Trade[],
  leg1Strike: number | null,
  leg2Strike: number | null
): Trade[] {
  return ibkrTrades.filter((exec) => {
    const execSymbol = exec.symbol || '';
    const underlying = trade.symbol;

    // Must be for the same underlying
    if (!execSymbol.startsWith(underlying)) return false;

    // Check if strike matches either leg (OCC format: "SPY   251219P00590000")
    // Strike is encoded as 8 digits with 3 decimal places: 590.000 = 00590000
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
 * For sold options: P&L = entry premium - exit cost
 */
function calculateRealizedPnl(
  entryPremium: number,
  executions: Trade[],
  contracts: number
): { exitPrice: number; realizedPnl: number } {
  if (executions.length === 0) {
    // No executions found - assume full premium kept (expired worthless or data unavailable)
    return { exitPrice: 0, realizedPnl: entryPremium };
  }

  // Sum up the exit costs from all matching executions
  // For BUY orders (closing a short position), this is what we paid
  let totalExitCost = 0;
  let totalQuantity = 0;

  for (const exec of executions) {
    const fillPrice = exec.entryFillPrice || 0;
    const qty = exec.quantity || 0;
    // Options are quoted per share, multiply by 100 for contract value
    totalExitCost += fillPrice * qty * 100;
    totalQuantity += qty;
  }

  // Average exit price per contract
  const avgExitPrice = totalQuantity > 0 ? totalExitCost / (totalQuantity * 100) : 0;

  // For sold options: P&L = premium received - cost to close
  const realizedPnl = entryPremium - totalExitCost;

  return { exitPrice: avgExitPrice, realizedPnl };
}

// ============================================
// Trade Monitoring Logic
// ============================================

/**
 * Check and update status of all open trades
 */
export async function monitorOpenTrades(): Promise<JobResult> {
  console.log('[TradeMonitor] Starting trade monitoring...');

  if (!db) {
    return { success: false, error: 'Database not available' };
  }

  try {
    // 1. Get all open trades from database
    const openTrades = await db
      .select()
      .from(paperTrades)
      .where(eq(paperTrades.status, 'open'));

    if (openTrades.length === 0) {
      console.log('[TradeMonitor] No open trades to monitor');
      return { success: true, data: { processed: 0, closed: 0 } };
    }

    console.log(`[TradeMonitor] Found ${openTrades.length} open trades`);

    // 2. Get current positions and recent trades from IBKR
    const broker = getBroker();
    let ibkrPositions: IbkrPosition[] = [];
    let ibkrTrades: Trade[] = [];

    if (broker.status.provider === 'ibkr') {
      try {
        await ensureIbkrReady();

        // Get current open positions
        const positions = await broker.api.getPositions();
        ibkrPositions = positions.map((p: any) => ({
          conid: p.id,
          symbol: p.symbol,
          position: p.qty * (p.side === 'SELL' ? -1 : 1),
          mktPrice: p.mark,
          unrealizedPnl: p.upl,
        }));
        console.log(`[TradeMonitor] IBKR positions: ${ibkrPositions.length}`);

        // Get recent trade executions (for P&L calculation)
        ibkrTrades = await broker.api.getTrades();
        console.log(`[TradeMonitor] IBKR trade executions: ${ibkrTrades.length}`);
      } catch (err) {
        console.warn('[TradeMonitor] Could not fetch IBKR data:', err);
      }
    }

    // 3. Check each open trade
    let closedCount = 0;
    const now = new Date();

    for (const trade of openTrades) {
      const tradeInfo = `${trade.symbol} ${trade.strategy} (${trade.id.slice(0, 8)})`;
      console.log(`[TradeMonitor] Checking: ${tradeInfo}`);

      // Check if expired
      const expiration = new Date(trade.expiration);
      const isExpired = now > expiration;

      if (isExpired) {
        console.log(`[TradeMonitor] Trade EXPIRED: ${tradeInfo}`);

        // Calculate realized P&L for expired options
        // If options expired worthless (most common for OTM), full premium is kept
        const entryPremium = parseFloat(trade.entryPremiumTotal as any) || 0;

        await db
          .update(paperTrades)
          .set({
            status: 'expired',
            exitPrice: '0.00',
            exitReason: 'Expired worthless',
            realizedPnl: entryPremium.toString(), // Full premium kept
            closedAt: new Date(),
          })
          .where(eq(paperTrades.id, trade.id));

        closedCount++;
        continue;
      }

      // Check if position still exists in IBKR
      // Match by strike prices in the symbol (e.g., "ARM   251212P00135000" contains "135")
      const leg1Strike = trade.leg1Strike ? parseFloat(trade.leg1Strike as any) : null;
      const leg2Strike = trade.leg2Strike ? parseFloat(trade.leg2Strike as any) : null;

      const hasOpenPosition = ibkrPositions.some((pos) => {
        const posSymbol = pos.symbol || '';
        const underlying = trade.symbol;

        // Check if this position belongs to this trade
        if (!posSymbol.startsWith(underlying)) return false;

        // Check if strike matches either leg
        if (leg1Strike) {
          const strikeStr = leg1Strike.toFixed(0).padStart(5, '0') + '000';
          if (posSymbol.includes(strikeStr)) return true;
        }
        if (leg2Strike) {
          const strikeStr = leg2Strike.toFixed(0).padStart(5, '0') + '000';
          if (posSymbol.includes(strikeStr)) return true;
        }

        return false;
      });

      if (!hasOpenPosition && ibkrPositions.length > 0) {
        console.log(`[TradeMonitor] Trade CLOSED (position not found): ${tradeInfo}`);

        // Position is closed - calculate realized P&L from actual IBKR executions
        const entryPremium = parseFloat(trade.entryPremiumTotal as any) || 0;
        const contracts = trade.contracts || 1;

        // Find matching trade executions from IBKR
        const matchingExecs = findMatchingExecutions(trade, ibkrTrades, leg1Strike, leg2Strike);
        console.log(`[TradeMonitor] Found ${matchingExecs.length} matching executions for ${tradeInfo}`);

        // Calculate actual P&L from executions
        const { exitPrice, realizedPnl } = calculateRealizedPnl(entryPremium, matchingExecs, contracts);

        const exitReason = matchingExecs.length > 0
          ? 'Closed via IBKR'
          : 'Position closed (no fill data)';

        console.log(`[TradeMonitor] ${tradeInfo}: entry=$${entryPremium.toFixed(2)}, exit=$${exitPrice.toFixed(4)}, P&L=$${realizedPnl.toFixed(2)}`);

        const now = new Date();

        await db
          .update(paperTrades)
          .set({
            status: 'closed',
            exitPrice: exitPrice.toString(),
            exitReason,
            realizedPnl: realizedPnl.toString(),
            closedAt: now,
          })
          .where(eq(paperTrades.id, trade.id));

        // Update stop order(s) with fill time for holding time calculation
        const orderIds = trade.ibkrOrderIds as string[] | null;
        if (orderIds?.length) {
          try {
            // Update all stop orders (typically index 1+ in the array)
            // Entry orders are at index 0, stops are at 1, 2, etc.
            const stopOrderIds = orderIds.slice(1);
            if (stopOrderIds.length > 0) {
              await db
                .update(orders)
                .set({ status: 'filled', filledAt: now })
                .where(inArray(orders.ibkrOrderId, stopOrderIds));
              console.log(`[TradeMonitor] Updated ${stopOrderIds.length} stop order(s) with fill time`);
            }
          } catch (orderErr) {
            console.warn(`[TradeMonitor] Could not update order records:`, orderErr);
          }
        }

        closedCount++;
      }
    }

    console.log(`[TradeMonitor] Completed: ${closedCount}/${openTrades.length} trades closed`);

    return {
      success: true,
      data: {
        processed: openTrades.length,
        closed: closedCount,
      },
    };
  } catch (error: any) {
    console.error('[TradeMonitor] Error:', error);
    return {
      success: false,
      error: error.message || 'Unknown error',
    };
  }
}

// ============================================
// Job Handler Registration
// ============================================

/**
 * Register the trade monitor job handler
 */
export function initTradeMonitorJob(): void {
  console.log('[TradeMonitor] Initializing job handler...');

  registerJobHandler({
    id: 'trade-monitor',
    name: 'Trade Monitor',
    description: 'Monitor open trades and update status when closed/expired',
    execute: monitorOpenTrades,
  });

  console.log('[TradeMonitor] Job handler registered');
}

/**
 * Create the trade-monitor job in the database if it doesn't exist
 */
export async function ensureTradeMonitorJob(): Promise<void> {
  if (!db) return;

  try {
    const { jobs } = await import('@shared/schema');
    const [existingJob] = await db.select().from(jobs).where(eq(jobs.id, 'trade-monitor')).limit(1);

    const desiredSchedule = '*/30 9-16 * * 1-5'; // Every 30 minutes during market hours (9AM-4PM ET, weekdays)

    if (!existingJob) {
      console.log('[TradeMonitor] Creating trade-monitor job in database...');
      await db.insert(jobs).values({
        id: 'trade-monitor',
        name: 'Trade Monitor',
        description: 'Monitor open trades and update status when closed/expired',
        type: 'trade-monitor',
        schedule: desiredSchedule,
        timezone: 'America/New_York',
        enabled: true,
        config: { skipMarketCheck: true },  // Allow job to run after market close
      });
      console.log('[TradeMonitor] Job created successfully');
    } else {
      // Update config to ensure skipMarketCheck is enabled
      const currentConfig = existingJob.config as Record<string, any> || {};
      if (!currentConfig.skipMarketCheck || existingJob.schedule !== desiredSchedule) {
        console.log('[TradeMonitor] Updating job config with skipMarketCheck: true');
        await db.update(jobs).set({
          schedule: desiredSchedule,
          config: { ...currentConfig, skipMarketCheck: true }
        }).where(eq(jobs.id, 'trade-monitor'));
        console.log('[TradeMonitor] Job config updated successfully');
      }
    }
  } catch (err) {
    console.warn('[TradeMonitor] Could not ensure job exists:', err);
  }
}
