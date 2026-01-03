// @ts-nocheck
/**
 * Trade Engine Job
 *
 * Cloud Scheduler triggered job that runs the 5-step trading engine.
 * Executes once daily at 11:00 AM ET (12:00 AM HKT).
 *
 * Flow:
 * 1. Check if we already traded today (idempotency)
 * 2. Run the 5-step engine analysis
 * 3. If conditions are met, auto-execute the trade
 * 4. Record results in paper_trades table
 */

import { db } from '../../db';
import { paperTrades, jobs, auditLogs } from '@shared/schema';
import { eq, and, sql, gte } from 'drizzle-orm';
import { getBroker } from '../../broker';
import { ensureIbkrReady, placeOptionOrderWithStop } from '../../broker/ibkr';
import { registerJobHandler, type JobResult } from '../jobExecutor';
import { getETDateString, getETTimeString, isMarketOpen, getMarketStatus } from '../marketCalendar';
import { TradingEngine, type TradingDecision } from '../../engine/index';
import type { AccountInfo } from '@shared/types';

// ============================================
// Constants
// ============================================

const JOB_ID = 'trade-engine';
const DEFAULT_SYMBOL = 'SPY';
const DEFAULT_RISK_PROFILE = 'BALANCED';

// ============================================
// Types
// ============================================

interface TradeEngineResult {
  timestamp: string;
  timeET: string;
  marketDay: string;
  decision: {
    canTrade: boolean;
    direction?: string;
    putStrike?: number;
    callStrike?: number;
    contracts?: number;
    expectedPremium?: number;
    reason?: string;
  };
  execution: {
    executed: boolean;
    orders: Array<{
      type: 'PUT' | 'CALL';
      strike: number;
      contracts: number;
      premium: number;
      orderId?: string;
      status: string;
    }>;
    error?: string;
  };
  summary: string;
}

// ============================================
// Helper Functions
// ============================================

/**
 * Log to audit trail
 */
async function logAudit(eventType: string, details: string, status: string = 'info'): Promise<void> {
  if (!db) return;

  try {
    await db.insert(auditLogs).values({
      eventType,
      details,
      status,
      userId: 'trade-engine',
    });
  } catch (err) {
    console.error('[TradeEngine] Audit log error:', err);
  }
}

/**
 * Check if we already placed a trade today
 */
async function hasTradeToday(): Promise<boolean> {
  if (!db) return false;

  const today = getETDateString();
  const startOfDay = new Date(today + 'T00:00:00-05:00'); // ET timezone

  const existingTrades = await db
    .select()
    .from(paperTrades)
    .where(
      and(
        gte(paperTrades.createdAt, startOfDay),
        eq(paperTrades.symbol, DEFAULT_SYMBOL)
      )
    )
    .limit(1);

  return existingTrades.length > 0;
}

/**
 * Get today's expiration date in YYYYMMDD format
 */
function getTodayExpiration(): string {
  const now = new Date();
  // Format as YYYYMMDD
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

// ============================================
// Main Logic
// ============================================

/**
 * Execute the trade engine job
 */
export async function executeTradeEngine(): Promise<JobResult> {
  const result: TradeEngineResult = {
    timestamp: new Date().toISOString(),
    timeET: getETTimeString(new Date()),
    marketDay: getETDateString(),
    decision: {
      canTrade: false,
    },
    execution: {
      executed: false,
      orders: [],
    },
    summary: '',
  };

  console.log(`[TradeEngine] Starting trade engine at ${result.timeET} ET`);

  // Check if market is open
  if (!isMarketOpen()) {
    const marketStatus = getMarketStatus();
    console.log(`[TradeEngine] ${marketStatus.reason}, skipping`);
    result.summary = `Market closed: ${marketStatus.reason}`;
    return {
      success: true,
      skipped: true,
      reason: marketStatus.reason,
      data: result,
    };
  }

  if (!db) {
    result.summary = 'Database not available';
    return { success: false, error: 'Database not available', data: result };
  }

  // Check idempotency - already traded today?
  const alreadyTraded = await hasTradeToday();
  if (alreadyTraded) {
    console.log('[TradeEngine] Already placed a trade today, skipping');
    result.summary = 'Already traded today';
    return {
      success: true,
      skipped: true,
      reason: 'Already traded today',
      data: result,
    };
  }

  try {
    // Get broker and ensure IBKR is ready
    const broker = getBroker();
    if (broker.status.provider !== 'ibkr' || !broker.api) {
      result.summary = 'IBKR not connected';
      return { success: false, error: 'IBKR not connected', data: result };
    }

    await ensureIbkrReady();

    // Get account info for position sizing
    const account = await broker.api.getAccount();
    const accountInfo: AccountInfo = {
      buyingPower: account.buyingPower,
      cashBalance: account.totalCash,
      netLiquidation: account.netLiquidation,
      currentPositions: 0,
    };

    console.log('[TradeEngine] Account info:', {
      buyingPower: accountInfo.buyingPower,
      netLiquidation: accountInfo.netLiquidation,
    });

    // Create and run the trading engine
    const engine = new TradingEngine({
      riskProfile: DEFAULT_RISK_PROFILE,
      underlyingSymbol: DEFAULT_SYMBOL,
      expirationMode: '0DTE',
      mockMode: false,
    });

    console.log('[TradeEngine] Running 5-step analysis...');
    const decision: TradingDecision = await engine.executeTradingDecision(accountInfo);

    // Record decision in result
    result.decision = {
      canTrade: decision.executionReady,
      direction: decision.direction?.direction,
      putStrike: decision.strikes?.putStrike?.strike,
      callStrike: decision.strikes?.callStrike?.strike,
      contracts: decision.positionSize?.contracts,
      expectedPremium: decision.strikes?.expectedPremium,
      reason: decision.reason,
    };

    console.log('[TradeEngine] Decision:', {
      canTrade: decision.executionReady,
      direction: decision.direction?.direction,
      contracts: decision.positionSize?.contracts,
    });

    // If not ready to trade, log and return
    if (!decision.executionReady) {
      result.summary = `Analysis complete - No trade: ${decision.reason}`;
      await logAudit('TRADE_ENGINE_NO_TRADE', JSON.stringify({
        reason: decision.reason,
        direction: decision.direction?.direction,
      }));
      return { success: true, data: result };
    }

    // Execute the trade
    console.log('[TradeEngine] Executing trade...');
    const expiration = getTodayExpiration();
    const contracts = decision.positionSize?.contracts || 1;
    const stopMultiplier = 6; // 6x premium for stop loss (Layer 2 backup)

    // Execute PUT if present
    if (decision.strikes?.putStrike) {
      const putStrike = decision.strikes.putStrike;
      const premium = putStrike.bid || putStrike.premium || 0.5;
      const stopPrice = Math.round(premium * stopMultiplier * 100) / 100;

      console.log(`[TradeEngine] Placing PUT order: ${DEFAULT_SYMBOL} $${putStrike.strike}P @ $${premium}`);

      try {
        const orderResult = await placeOptionOrderWithStop({
          symbol: DEFAULT_SYMBOL,
          optionType: 'PUT',
          strike: putStrike.strike,
          expiration,
          quantity: contracts,
          limitPrice: premium,
          stopPrice,
        });

        result.execution.orders.push({
          type: 'PUT',
          strike: putStrike.strike,
          contracts,
          premium,
          orderId: orderResult.primaryOrderId,
          status: orderResult.status,
        });

        if (orderResult.primaryOrderId) {
          result.execution.executed = true;
          console.log(`[TradeEngine] PUT order placed: ${orderResult.primaryOrderId}`);
        }
      } catch (err: any) {
        console.error('[TradeEngine] PUT order failed:', err?.message);
        result.execution.orders.push({
          type: 'PUT',
          strike: putStrike.strike,
          contracts,
          premium,
          status: `failed: ${err?.message}`,
        });
      }
    }

    // Execute CALL if present
    if (decision.strikes?.callStrike) {
      const callStrike = decision.strikes.callStrike;
      const premium = callStrike.bid || callStrike.premium || 0.5;
      const stopPrice = Math.round(premium * stopMultiplier * 100) / 100;

      console.log(`[TradeEngine] Placing CALL order: ${DEFAULT_SYMBOL} $${callStrike.strike}C @ $${premium}`);

      try {
        const orderResult = await placeOptionOrderWithStop({
          symbol: DEFAULT_SYMBOL,
          optionType: 'CALL',
          strike: callStrike.strike,
          expiration,
          quantity: contracts,
          limitPrice: premium,
          stopPrice,
        });

        result.execution.orders.push({
          type: 'CALL',
          strike: callStrike.strike,
          contracts,
          premium,
          orderId: orderResult.primaryOrderId,
          status: orderResult.status,
        });

        if (orderResult.primaryOrderId) {
          result.execution.executed = true;
          console.log(`[TradeEngine] CALL order placed: ${orderResult.primaryOrderId}`);
        }
      } catch (err: any) {
        console.error('[TradeEngine] CALL order failed:', err?.message);
        result.execution.orders.push({
          type: 'CALL',
          strike: callStrike.strike,
          contracts,
          premium,
          status: `failed: ${err?.message}`,
        });
      }
    }

    // Record trade in paper_trades if orders were placed
    if (result.execution.executed) {
      const expirationDate = new Date();
      expirationDate.setHours(16, 0, 0, 0); // 4 PM ET

      const totalPremium = result.execution.orders.reduce((sum, o) => sum + o.premium * contracts * 100, 0);

      await db.insert(paperTrades).values({
        userId: 'system', // System-generated trade
        symbol: DEFAULT_SYMBOL,
        strategy: decision.direction?.direction === 'STRANGLE' ? 'strangle' :
                  decision.direction?.direction === 'PUT' ? 'put_credit_spread' : 'call_credit_spread',
        bias: decision.direction?.direction === 'PUT' ? 'bullish' :
              decision.direction?.direction === 'CALL' ? 'bearish' : 'neutral',
        contracts,
        leg1Strike: decision.strikes?.putStrike?.strike?.toString(),
        leg1Premium: decision.strikes?.putStrike?.bid?.toString() || decision.strikes?.putStrike?.premium?.toString(),
        leg1Conid: result.execution.orders.find(o => o.type === 'PUT')?.orderId,
        leg2Strike: decision.strikes?.callStrike?.strike?.toString(),
        leg2Premium: decision.strikes?.callStrike?.bid?.toString() || decision.strikes?.callStrike?.premium?.toString(),
        leg2Conid: result.execution.orders.find(o => o.type === 'CALL')?.orderId,
        entryPremiumTotal: totalPremium.toString(),
        expiration: expirationDate.toISOString().slice(0, 10),
        status: 'open',
        source: 'auto-engine',
      });

      result.summary = `Trade executed: ${decision.direction?.direction} ${contracts} contracts`;
      await logAudit('TRADE_ENGINE_EXECUTED', JSON.stringify({
        direction: decision.direction?.direction,
        contracts,
        orders: result.execution.orders,
      }));
    } else {
      result.summary = 'Order placement failed';
      result.execution.error = 'All orders failed';
      await logAudit('TRADE_ENGINE_ORDERS_FAILED', JSON.stringify(result.execution.orders));
    }

    console.log(`[TradeEngine] ${result.summary}`);
    return { success: result.execution.executed, data: result };

  } catch (error: any) {
    const errMsg = error?.message || 'Unknown error';
    console.error('[TradeEngine] Fatal error:', error);
    result.summary = `Error: ${errMsg}`;
    result.execution.error = errMsg;

    await logAudit('TRADE_ENGINE_ERROR', errMsg);
    return { success: false, error: errMsg, data: result };
  }
}

// ============================================
// Job Handler Registration
// ============================================

/**
 * Register the trade engine job handler
 */
export function initTradeEngineJob(): void {
  console.log('[TradeEngine] Initializing job handler...');

  registerJobHandler({
    id: JOB_ID,
    name: 'Trade Engine',
    description: 'Automated 5-step trading engine - runs once daily to analyze and execute trades',
    execute: executeTradeEngine,
  });

  console.log('[TradeEngine] Job handler registered');
}

/**
 * Create the job in the database if it doesn't exist
 */
export async function ensureTradeEngineJob(): Promise<void> {
  if (!db) return;

  try {
    const [existingJob] = await db.select().from(jobs).where(eq(jobs.id, JOB_ID)).limit(1);

    // Schedule: 11:00 AM ET daily on weekdays
    const desiredSchedule = '0 11 * * 1-5';

    if (!existingJob) {
      console.log('[TradeEngine] Creating job in database...');
      await db.insert(jobs).values({
        id: JOB_ID,
        name: 'Trade Engine',
        description: 'Automated 5-step trading engine. Runs at 11:00 AM ET daily to analyze market conditions and execute trades.',
        type: JOB_ID,
        schedule: desiredSchedule,
        timezone: 'America/New_York',
        enabled: true,
        config: {
          symbol: DEFAULT_SYMBOL,
          riskProfile: DEFAULT_RISK_PROFILE,
          autoExecute: true,
        },
      });
      console.log('[TradeEngine] Job created successfully');
    } else {
      console.log('[TradeEngine] Job already exists in database');
    }
  } catch (err) {
    console.warn('[TradeEngine] Could not ensure job exists:', err);
  }
}
