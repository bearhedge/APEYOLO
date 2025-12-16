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
import { paperTrades } from '@shared/schema';
import { eq, and, isNull, lt } from 'drizzle-orm';
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

    // 2. Get current positions from IBKR
    const broker = getBroker();
    let ibkrPositions: IbkrPosition[] = [];

    if (broker.status.provider === 'ibkr') {
      try {
        await ensureIbkrReady();
        const positions = await broker.api.getPositions();
        ibkrPositions = positions.map((p: any) => ({
          conid: p.id,
          symbol: p.symbol,
          position: p.qty * (p.side === 'SELL' ? -1 : 1),
          mktPrice: p.mark,
          unrealizedPnl: p.upl,
        }));
        console.log(`[TradeMonitor] IBKR positions: ${ibkrPositions.length}`);
      } catch (err) {
        console.warn('[TradeMonitor] Could not fetch IBKR positions:', err);
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

        // Position is closed - calculate realized P&L
        // This means the options were either:
        // 1. Bought back (closed manually or via stop loss)
        // 2. Assigned (rare for OTM options)
        //
        // Without fill data, we estimate based on entry premium
        // TODO: Get actual fill price from IBKR trades API
        const entryPremium = parseFloat(trade.entryPremiumTotal as any) || 0;

        await db
          .update(paperTrades)
          .set({
            status: 'closed',
            exitReason: 'Position closed',
            realizedPnl: entryPremium.toString(), // Estimate - full premium (update with actual when available)
            closedAt: new Date(),
          })
          .where(eq(paperTrades.id, trade.id));

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
        config: {},
      });
      console.log('[TradeMonitor] Job created successfully');
    } else if (existingJob.schedule !== desiredSchedule) {
      // Update schedule if it has changed
      console.log(`[TradeMonitor] Updating schedule from ${existingJob.schedule} to ${desiredSchedule}`);
      await db.update(jobs).set({ schedule: desiredSchedule }).where(eq(jobs.id, 'trade-monitor'));
      console.log('[TradeMonitor] Schedule updated successfully');
    }
  } catch (err) {
    console.warn('[TradeMonitor] Could not ensure job exists:', err);
  }
}
