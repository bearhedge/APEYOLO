// @ts-nocheck
// TODO: Add proper null checks for broker.api
/**
 * 0DTE Position Manager
 *
 * Critical safety job that auto-closes risky 0DTE positions before market close.
 * Runs at 3:55 PM ET (5 minutes before close) to prevent assignment risk.
 *
 * Rule: If |delta| > 0.30, close the position (ITM risk)
 * Rule: If delta unavailable, check if ITM (spot crossed strike)
 *
 * This job is designed for reliability:
 * - Multiple retry attempts for IBKR connection
 * - Fallback delta calculation if IBKR delta is 0
 * - Detailed logging for audit trail
 * - Market order for guaranteed fill
 */

import { db } from '../../db';
import { paperTrades, jobs } from '@shared/schema';
import { eq, and, sql } from 'drizzle-orm';
import { getBroker } from '../../broker';
import { ensureIbkrReady, placeCloseOrderByConid } from '../../broker/ibkr';
import { registerJobHandler, type JobResult } from '../jobExecutor';
import { getETDateString, getETTimeString, getExitDeadline, isEarlyCloseDay, formatTimeForDisplay } from '../marketCalendar';
import type { Position } from '@shared/types';

// ============================================
// Types
// ============================================

interface RiskyPosition {
  tradeId: string;
  symbol: string;
  conid: string;
  qty: number;
  side: 'BUY' | 'SELL';
  delta: number;
  deltaSource: 'ibkr' | 'itm-fallback' | 'entry-fallback';
  strike: number;
  spotPrice?: number;
  isITM: boolean;
  reason: string;
}

interface CloseResult {
  symbol: string;
  conid: string;
  success: boolean;
  orderId?: string;
  error?: string;
  attempts: number;
}

interface JobResults {
  timestamp: string;
  timeET: string;
  positionsChecked: number;
  positionsAtRisk: RiskyPosition[];
  closeResults: CloseResult[];
  errors: string[];
  summary: string;
}

// ============================================
// Constants
// ============================================

const DELTA_THRESHOLD = 0.30; // Close if |delta| > 0.30
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2000;

// ============================================
// Helper Functions
// ============================================

/**
 * Sleep helper for retries
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Parse strike price from IBKR option symbol
 * Input: "ARM   251212P00135000" → 135
 */
function parseStrikeFromSymbol(symbol: string): number | null {
  const match = symbol.match(/([PC])(\d{8})$/);
  if (!match) return null;
  return parseInt(match[2]) / 1000;
}

/**
 * Determine if option is ITM based on spot vs strike
 */
function isOptionITM(optionType: 'PUT' | 'CALL', strike: number, spot: number): boolean {
  if (optionType === 'PUT') {
    return spot < strike; // PUT is ITM when spot < strike
  } else {
    return spot > strike; // CALL is ITM when spot > strike
  }
}

/**
 * Get option type from symbol
 * IBKR format: "SPY   251215C00684000" or "SPY   251215P00684000"
 * Pattern: [underlying] [YYMMDD][C/P][strike]
 */
function getOptionType(symbol: string): 'PUT' | 'CALL' | null {
  // Find the option type character after the 6-digit date (YYMMDD)
  // This avoids false matches from underlying tickers like "SPY" containing "P"
  const match = symbol.match(/\d{6}([CP])/);
  if (match) {
    return match[1] === 'P' ? 'PUT' : 'CALL';
  }
  return null;
}

/**
 * Get underlying symbol from option symbol
 */
function getUnderlying(symbol: string): string {
  const match = symbol.match(/^([A-Z]+)/);
  return match ? match[1] : symbol;
}

// ============================================
// Main Logic
// ============================================

/**
 * Execute the 0DTE position manager
 */
export async function execute0dtePositionManager(): Promise<JobResult> {
  const now = new Date();
  const results: JobResults = {
    timestamp: now.toISOString(),
    timeET: getETTimeString(now),
    positionsChecked: 0,
    positionsAtRisk: [],
    closeResults: [],
    errors: [],
    summary: '',
  };

  console.log(`[0DTE-Manager] Starting at ${results.timeET} ET...`);

  // Time validation: Skip if we're not at the right time for today's market close
  // This handles the case where cron runs at 3:55 PM but it's an early close day (should be 12:55 PM)
  const expectedTriggerTime = getExitDeadline(now);
  const currentTimeET = results.timeET;

  // Parse times to minutes for comparison
  const [expectedHour, expectedMin] = expectedTriggerTime.split(':').map(Number);
  const [currentHour, currentMin] = currentTimeET.split(':').map(Number);
  const expectedMinutes = expectedHour * 60 + expectedMin;
  const currentMinutes = currentHour * 60 + currentMin;

  // If we're more than 10 minutes off from expected trigger time, skip
  // This allows for some scheduling variance while catching wrong-time triggers
  if (Math.abs(currentMinutes - expectedMinutes) > 10) {
    const { isEarlyClose, reason } = isEarlyCloseDay(now);
    const expectedDisplay = formatTimeForDisplay(expectedTriggerTime);
    const message = isEarlyClose
      ? `Skipped: Early close day (${reason}). Expected ${expectedDisplay}, triggered at ${currentTimeET} ET`
      : `Skipped: Wrong time. Expected ${expectedDisplay}, triggered at ${currentTimeET} ET`;

    console.log(`[0DTE-Manager] ${message}`);
    results.summary = message;
    return { success: true, data: results };
  }

  if (!db) {
    results.errors.push('Database not available');
    results.summary = 'FAILED: Database unavailable';
    return { success: false, error: 'Database not available', data: results };
  }

  try {
    // Step 1: Get today's date in ET
    const todayET = getETDateString(new Date());
    console.log(`[0DTE-Manager] Checking for 0DTE positions expiring ${todayET}`);

    // Step 2: Get all open trades expiring today (0DTE)
    const openTrades = await db
      .select()
      .from(paperTrades)
      .where(
        and(
          eq(paperTrades.status, 'open'),
          sql`DATE(${paperTrades.expiration}) = ${todayET}`
        )
      );

    if (openTrades.length === 0) {
      console.log('[0DTE-Manager] No 0DTE positions found');
      results.summary = 'No 0DTE positions to manage';
      return { success: true, data: results };
    }

    console.log(`[0DTE-Manager] Found ${openTrades.length} open 0DTE trades`);

    // Step 3: Get current positions from IBKR
    const broker = getBroker();
    let ibkrPositions: Position[] = [];
    let spotPrices: Map<string, number> = new Map();

    if (broker.status.provider === 'ibkr') {
      let retryCount = 0;
      while (retryCount < MAX_RETRY_ATTEMPTS) {
        try {
          console.log(`[0DTE-Manager] Fetching IBKR positions (attempt ${retryCount + 1}/${MAX_RETRY_ATTEMPTS})...`);
          await ensureIbkrReady();
          ibkrPositions = await broker.api.getPositions();
          console.log(`[0DTE-Manager] Got ${ibkrPositions.length} IBKR positions`);

          // Get spot prices for underlyings
          const underlyings = [...new Set(openTrades.map(t => t.symbol))];
          for (const underlying of underlyings) {
            try {
              const marketData = await broker.api.getMarketData(underlying);
              if (marketData?.price) {
                spotPrices.set(underlying, marketData.price);
                console.log(`[0DTE-Manager] ${underlying} spot price: $${marketData.price}`);
              }
            } catch (err) {
              console.warn(`[0DTE-Manager] Could not get spot price for ${underlying}:`, err);
            }
          }
          break;
        } catch (err: any) {
          retryCount++;
          const errMsg = `IBKR connection attempt ${retryCount} failed: ${err?.message || err}`;
          console.error(`[0DTE-Manager] ${errMsg}`);
          results.errors.push(errMsg);

          if (retryCount < MAX_RETRY_ATTEMPTS) {
            console.log(`[0DTE-Manager] Retrying in ${RETRY_DELAY_MS}ms...`);
            await sleep(RETRY_DELAY_MS);
          }
        }
      }

      if (ibkrPositions.length === 0) {
        results.errors.push('Could not fetch IBKR positions after all retries');
        results.summary = 'FAILED: IBKR connection unavailable';
        return { success: false, error: 'IBKR unavailable', data: results };
      }
    } else {
      results.errors.push('IBKR broker not configured');
      results.summary = 'FAILED: IBKR broker not available';
      return { success: false, error: 'IBKR not configured', data: results };
    }

    // Step 4: Match trades to positions and evaluate delta
    const riskyPositions: RiskyPosition[] = [];

    for (const trade of openTrades) {
      const tradeInfo = `${trade.symbol} ${trade.strategy} (${trade.id.slice(0, 8)})`;
      console.log(`[0DTE-Manager] Evaluating: ${tradeInfo}`);

      // Find matching IBKR positions for this trade
      const leg1Strike = trade.leg1Strike ? parseFloat(trade.leg1Strike as any) : null;
      const leg2Strike = trade.leg2Strike ? parseFloat(trade.leg2Strike as any) : null;

      for (const position of ibkrPositions) {
        const posSymbol = position.symbol || '';
        const underlying = getUnderlying(posSymbol);

        // Check if this position belongs to this trade
        if (underlying !== trade.symbol) continue;

        const posStrike = parseStrikeFromSymbol(posSymbol);
        if (!posStrike) continue;

        // Check if strike matches either leg
        const matchesLeg1 = leg1Strike && Math.abs(posStrike - leg1Strike) < 0.01;
        const matchesLeg2 = leg2Strike && Math.abs(posStrike - leg2Strike) < 0.01;

        if (!matchesLeg1 && !matchesLeg2) continue;

        results.positionsChecked++;
        console.log(`[0DTE-Manager] Matched position: ${posSymbol}, delta=${position.delta}, qty=${position.qty}`);

        // Determine delta with fallback logic
        let delta = Math.abs(position.delta || 0);
        let deltaSource: 'ibkr' | 'itm-fallback' | 'entry-fallback' = 'ibkr';
        let isITM = false;

        // If IBKR delta is 0 or unavailable, use fallback
        if (delta === 0) {
          const optionType = getOptionType(posSymbol);
          const spotPrice = spotPrices.get(underlying);

          if (optionType && spotPrice && posStrike) {
            isITM = isOptionITM(optionType, posStrike, spotPrice);
            if (isITM) {
              // ITM options have high delta (treat as risky)
              delta = 0.50; // Conservative estimate for ITM
              deltaSource = 'itm-fallback';
              console.log(`[0DTE-Manager] Delta fallback: ${posSymbol} is ITM (spot=${spotPrice}, strike=${posStrike})`);
            }
          } else {
            // Last resort: use entry delta from paper_trades
            const entryDelta = matchesLeg1
              ? Math.abs(parseFloat(trade.leg1Delta as any) || 0)
              : Math.abs(parseFloat(trade.leg2Delta as any) || 0);
            if (entryDelta > 0) {
              delta = entryDelta;
              deltaSource = 'entry-fallback';
              console.log(`[0DTE-Manager] Using entry delta: ${entryDelta}`);
            }
          }
        }

        // Check if risky (|delta| > threshold)
        if (delta > DELTA_THRESHOLD) {
          const risky: RiskyPosition = {
            tradeId: trade.id,
            symbol: posSymbol,
            conid: position.id,
            qty: Math.abs(position.qty),
            side: position.side,
            delta,
            deltaSource,
            strike: posStrike,
            spotPrice: spotPrices.get(underlying),
            isITM,
            reason: `Delta ${delta.toFixed(2)} > ${DELTA_THRESHOLD} threshold`,
          };
          riskyPositions.push(risky);
          console.log(`[0DTE-Manager] RISKY POSITION: ${posSymbol} - ${risky.reason}`);
        } else {
          console.log(`[0DTE-Manager] Position safe: ${posSymbol} delta=${delta.toFixed(2)} <= ${DELTA_THRESHOLD}`);
        }
      }
    }

    results.positionsAtRisk = riskyPositions;

    // Step 5: Close risky positions
    if (riskyPositions.length === 0) {
      console.log('[0DTE-Manager] No risky positions to close');
      results.summary = `Checked ${results.positionsChecked} positions, all safe (delta <= ${DELTA_THRESHOLD})`;
      return { success: true, data: results };
    }

    console.log(`[0DTE-Manager] Found ${riskyPositions.length} risky positions to close`);

    for (const risky of riskyPositions) {
      console.log(`[0DTE-Manager] Closing ${risky.symbol}...`);

      const closeResult: CloseResult = {
        symbol: risky.symbol,
        conid: risky.conid,
        success: false,
        attempts: 0,
      };

      // Determine order side: opposite of current position
      // If we're short (SELL), we BUY to close
      // If we're long (BUY), we SELL to close
      const closeSide = risky.side === 'SELL' ? 'BUY' : 'SELL';

      // Retry loop for order submission
      for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
        closeResult.attempts = attempt;
        try {
          console.log(`[0DTE-Manager] Submitting ${closeSide} order for ${risky.symbol} (attempt ${attempt}/${MAX_RETRY_ATTEMPTS})`);

          // Submit market order to close position
          const orderResult = await submitCloseOrder(risky.conid, risky.qty, closeSide);

          if (orderResult.success) {
            closeResult.success = true;
            closeResult.orderId = orderResult.orderId;
            console.log(`[0DTE-Manager] Order submitted successfully: ${orderResult.orderId}`);

            // Update paper_trades to mark as closing
            await db
              .update(paperTrades)
              .set({
                exitReason: `Auto-closed by 0DTE manager: ${risky.reason}`,
              })
              .where(eq(paperTrades.id, risky.tradeId));

            break;
          } else {
            closeResult.error = orderResult.error;
            console.error(`[0DTE-Manager] Order failed: ${orderResult.error}`);
          }
        } catch (err: any) {
          closeResult.error = err?.message || 'Unknown error';
          console.error(`[0DTE-Manager] Order error:`, err);
        }

        if (attempt < MAX_RETRY_ATTEMPTS) {
          console.log(`[0DTE-Manager] Retrying in ${RETRY_DELAY_MS}ms...`);
          await sleep(RETRY_DELAY_MS);
        }
      }

      results.closeResults.push(closeResult);

      if (!closeResult.success) {
        results.errors.push(`CRITICAL: Failed to close ${risky.symbol} after ${MAX_RETRY_ATTEMPTS} attempts`);
      }
    }

    // Step 6: Generate summary
    const successCount = results.closeResults.filter(r => r.success).length;
    const failCount = results.closeResults.filter(r => !r.success).length;

    if (failCount > 0) {
      results.summary = `PARTIAL: Closed ${successCount}/${riskyPositions.length} risky positions. ${failCount} FAILED - MANUAL INTERVENTION REQUIRED`;
      return { success: false, error: results.summary, data: results };
    } else if (successCount > 0) {
      results.summary = `SUCCESS: Closed ${successCount} risky position(s) with delta > ${DELTA_THRESHOLD}`;
      return { success: true, data: results };
    } else {
      results.summary = `Checked ${results.positionsChecked} positions, none required closing`;
      return { success: true, data: results };
    }
  } catch (error: any) {
    const errMsg = error?.message || 'Unknown error';
    console.error('[0DTE-Manager] Fatal error:', error);
    results.errors.push(`Fatal: ${errMsg}`);
    results.summary = `FAILED: ${errMsg}`;
    return { success: false, error: errMsg, data: results };
  }
}

/**
 * Submit a market order to close a position
 * Uses the placeCloseOrderByConid helper from ibkr.ts
 */
async function submitCloseOrder(
  conid: string,
  quantity: number,
  side: 'BUY' | 'SELL'
): Promise<{ success: boolean; orderId?: string; error?: string }> {
  console.log(`[0DTE-Manager] Submitting close order: conid=${conid}, qty=${quantity}, side=${side}`);
  return placeCloseOrderByConid(parseInt(conid), quantity, side);
}

// ============================================
// Job Handler Registration
// ============================================

/**
 * Register the 0DTE position manager job handler
 */
export function init0dtePositionManagerJob(): void {
  console.log('[0DTE-Manager] Initializing job handler...');

  registerJobHandler({
    id: '0dte-position-manager',
    name: '0DTE Position Manager',
    description: 'Auto-close risky 0DTE positions (delta > 0.30) before market close',
    execute: execute0dtePositionManager,
  });

  console.log('[0DTE-Manager] Job handler registered');
}

/**
 * Create the jobs in the database if they don't exist
 * Creates two schedules:
 * - Normal days: 3:55 PM ET
 * - Early close days: 12:55 PM ET (time validation will skip the 3:55 PM run)
 */
export async function ensure0dtePositionManagerJob(): Promise<void> {
  if (!db) return;

  try {
    // Check for normal schedule (3:55 PM)
    const [existingJob] = await db.select().from(jobs).where(eq(jobs.id, '0dte-position-manager')).limit(1);

    if (!existingJob) {
      console.log('[0DTE-Manager] Creating normal schedule job (3:55 PM ET)...');
      await db.insert(jobs).values({
        id: '0dte-position-manager',
        name: '0DTE Position Manager',
        description: 'Auto-close risky 0DTE positions (delta > 0.30) before market close at 3:55 PM ET',
        type: '0dte-position-manager',
        schedule: '55 15 * * 1-5', // 3:55 PM ET on weekdays
        timezone: 'America/New_York',
        enabled: true,
        config: {
          deltaThreshold: DELTA_THRESHOLD,
          maxRetries: MAX_RETRY_ATTEMPTS,
        },
      });
      console.log('[0DTE-Manager] Normal schedule job created');
    }

    // Check for early close schedule (12:55 PM)
    const [existingEarlyJob] = await db.select().from(jobs).where(eq(jobs.id, '0dte-position-manager-early')).limit(1);

    if (!existingEarlyJob) {
      console.log('[0DTE-Manager] Creating early close schedule job (12:55 PM ET)...');
      await db.insert(jobs).values({
        id: '0dte-position-manager-early',
        name: '0DTE Position Manager (Early Close)',
        description: 'Auto-close risky 0DTE positions (delta > 0.30) at 12:55 PM ET on early close days (Christmas Eve, day after Thanksgiving, etc.)',
        type: '0dte-position-manager',
        schedule: '55 12 * * 1-5', // 12:55 PM ET on weekdays
        timezone: 'America/New_York',
        enabled: true,
        config: {
          deltaThreshold: DELTA_THRESHOLD,
          maxRetries: MAX_RETRY_ATTEMPTS,
          earlyCloseSchedule: true,
        },
      });
      console.log('[0DTE-Manager] Early close schedule job created');
    }
  } catch (err) {
    console.warn('[0DTE-Manager] Could not ensure jobs exist:', err);
  }
}
