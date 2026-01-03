// @ts-nocheck
/**
 * Position Monitor Job
 *
 * Real-time position monitoring with AUTO-CLOSE capability.
 * Runs every 5 minutes during market hours.
 *
 * Layer 1: Underlying price breaches strike ±$2 for 15+ minutes → AUTO-CLOSE
 * Layer 2: DISABLED (IBKR bracket stop handles 3x premium automatically)
 * Layer 3: EOD sweep at 3:55/12:55 PM (handled by 0dtePositionManager)
 *
 * This monitor catches Layer 1 triggers that IBKR stop orders can't detect
 * (underlying price movement vs option premium movement).
 */

import { db } from '../../db';
import { paperTrades, jobs, jobRuns, auditLogs } from '@shared/schema';
import { eq, and, sql, gte } from 'drizzle-orm';
import { getBroker } from '../../broker';
import { ensureIbkrReady, placeCloseOrderByConid } from '../../broker/ibkr';
import { registerJobHandler, type JobResult } from '../jobExecutor';
import { getETDateString, getETTimeString, isMarketOpen, isEarlyCloseDay, getMarketStatus } from '../marketCalendar';
import { monitorPosition, defineExitRules, type ExitRules, type MonitorResult } from '../../engine/step5';
import { linkTradeOutcome, normalizeExitReason } from '../rlhfService';
import type { Position } from '@shared/types';

// ============================================
// Types
// ============================================

interface MonitoredPosition {
  tradeId: string;
  symbol: string;
  conid: string;
  qty: number;
  entryPremium: number;
  currentPremium: number;
  contracts: number;
  putStrike?: number;
  callStrike?: number;
  monitorResult: MonitorResult;
}

interface MonitorSession {
  date: string;
  startTime: string;
  checksCompleted: number;
  lastCheckTime: string;
  positionsMonitored: number;
  alertsTriggered: number;
  errors: string[];
}

interface MonitorJobResult {
  timestamp: string;
  timeET: string;
  session: MonitorSession;
  positions: MonitoredPosition[];
  exitAlerts: Array<{
    tradeId: string;
    symbol: string;
    exitReason: string;
    exitLayer: 1 | 2 | 3;
    actionTaken: string;
  }>;
  summary: string;
}

// ============================================
// In-Memory Session State (aggregation)
// ============================================

// Track monitoring session state to avoid spamming job logs
const sessionState: MonitorSession = {
  date: '',
  startTime: '',
  checksCompleted: 0,
  lastCheckTime: '',
  positionsMonitored: 0,
  alertsTriggered: 0,
  errors: [],
};

// Track Layer 1 breach start times (persistent across checks)
const layer1BreachTimes: Map<string, Date> = new Map();

// ============================================
// Constants
// ============================================

const CHECK_INTERVAL_MINUTES = 5;
const LAYER1_SUSTAIN_MS = 15 * 60 * 1000; // 15 minutes

// ============================================
// Helper Functions
// ============================================

/**
 * Get or initialize the daily session
 */
function getSession(): MonitorSession {
  const today = getETDateString();

  if (sessionState.date !== today) {
    // New day - reset session
    sessionState.date = today;
    sessionState.startTime = getETTimeString(new Date());
    sessionState.checksCompleted = 0;
    sessionState.lastCheckTime = '';
    sessionState.positionsMonitored = 0;
    sessionState.alertsTriggered = 0;
    sessionState.errors = [];
    layer1BreachTimes.clear();
  }

  return sessionState;
}

/**
 * Parse strike from paper_trades leg
 */
function parseStrike(value: any): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return parseFloat(value) || null;
  return null;
}

/**
 * Parse premium from paper_trades leg
 */
function parsePremium(value: any): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return parseFloat(value) || 0;
  return 0;
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
 * Log to audit (for significant events only)
 */
async function logAudit(eventType: string, details: string, status: string = 'info'): Promise<void> {
  if (!db) return;

  try {
    await db.insert(auditLogs).values({
      eventType,
      details,
      status,
      userId: 'position-monitor',
    });
  } catch (err) {
    console.error('[PositionMonitor] Audit log error:', err);
  }
}

// ============================================
// Main Logic
// ============================================

/**
 * Execute position monitoring check
 */
export async function executePositionMonitor(): Promise<JobResult> {
  const session = getSession();
  const results: MonitorJobResult = {
    timestamp: new Date().toISOString(),
    timeET: getETTimeString(new Date()),
    session,
    positions: [],
    exitAlerts: [],
    summary: '',
  };

  console.log(`[PositionMonitor] Check #${session.checksCompleted + 1} at ${results.timeET} ET`);

  // Check if market is open (only monitor during market hours)
  if (!isMarketOpen()) {
    const marketStatus = getMarketStatus();
    const { isEarlyClose, reason: earlyCloseReason } = isEarlyCloseDay();
    const earlyCloseNote = isEarlyClose ? ` (${earlyCloseReason})` : '';

    console.log(`[PositionMonitor] ${marketStatus.reason}${earlyCloseNote}, skipping`);
    results.summary = `${marketStatus.reason}${earlyCloseNote} - skipped`;

    // Don't count this as a check or create a job run
    return {
      success: true,
      skipped: true,
      reason: marketStatus.reason + earlyCloseNote,
      data: results
    };
  }

  if (!db) {
    session.errors.push('Database not available');
    return { success: false, error: 'Database not available', data: results };
  }

  try {
    // Get all open trades
    const openTrades = await db
      .select()
      .from(paperTrades)
      .where(eq(paperTrades.status, 'open'));

    if (openTrades.length === 0) {
      session.checksCompleted++;
      session.lastCheckTime = results.timeET;
      results.summary = 'No open positions to monitor';
      console.log('[PositionMonitor] No open positions');
      // Return success but don't create a detailed job run
      return { success: true, data: results };
    }

    console.log(`[PositionMonitor] Monitoring ${openTrades.length} open positions`);

    // Get broker data
    const broker = getBroker();
    if (broker.status.provider !== 'ibkr' || !broker.api) {
      session.errors.push('IBKR not connected');
      return { success: false, error: 'IBKR not connected', data: results };
    }

    await ensureIbkrReady();

    // Get current positions and market data
    const ibkrPositions = await broker.api.getPositions();
    const spotPrices: Map<string, number> = new Map();

    // Fetch spot prices for all underlyings
    const underlyings = [...new Set(openTrades.map(t => t.symbol))];
    for (const underlying of underlyings) {
      try {
        const marketData = await broker.api.getMarketData(underlying);
        if (marketData?.price) {
          spotPrices.set(underlying, marketData.price);
        }
      } catch (err) {
        console.warn(`[PositionMonitor] Could not get price for ${underlying}`);
      }
    }

    // Monitor each open trade
    for (const trade of openTrades) {
      try {
        const underlying = trade.symbol;
        const underlyingPrice = spotPrices.get(underlying) || 0;

        if (!underlyingPrice) {
          console.warn(`[PositionMonitor] No price for ${underlying}, skipping`);
          continue;
        }

        // Parse trade data
        const putStrike = parseStrike(trade.leg1Strike);
        const callStrike = parseStrike(trade.leg2Strike);
        const leg1Premium = parsePremium(trade.leg1Premium);
        const leg2Premium = parsePremium(trade.leg2Premium);
        const contracts = trade.contracts || 1;
        const entryPremium = (leg1Premium + leg2Premium);

        // Find matching IBKR positions for current prices
        let currentPremium = entryPremium; // Default to entry if we can't find current

        // Try to get current option prices from IBKR positions
        for (const pos of ibkrPositions) {
          if (pos.symbol?.includes(underlying)) {
            // Use average cost as proxy for current price
            if (pos.averageCost) {
              currentPremium = Math.abs(pos.averageCost) / 100;
            }
          }
        }

        // Build exit rules for this position
        const mockStrikeSelection = {
          putStrike: putStrike ? { strike: putStrike } : undefined,
          callStrike: callStrike ? { strike: callStrike } : undefined,
          expectedPremium: entryPremium * 100 * contracts,
        };

        const mockPositionSize = {
          contracts,
          totalMarginRequired: 0,
        };

        const exitRules = await defineExitRules(mockStrikeSelection as any, mockPositionSize as any);

        // Check for Layer 1 breach tracking
        const tradeKey = `${trade.id}`;
        let layer1BreachStart = layer1BreachTimes.get(tradeKey) || null;

        // Determine if currently breaching Layer 1
        const breachingPut = putStrike && underlyingPrice < putStrike;
        const breachingCall = callStrike && underlyingPrice > callStrike;
        const currentlyBreaching = breachingPut || breachingCall;

        if (currentlyBreaching && !layer1BreachStart) {
          // Just started breaching
          layer1BreachStart = new Date();
          layer1BreachTimes.set(tradeKey, layer1BreachStart);
          console.log(`[PositionMonitor] ${underlying}: Layer 1 breach started`);
        } else if (!currentlyBreaching && layer1BreachStart) {
          // Stopped breaching - reset timer
          layer1BreachTimes.delete(tradeKey);
          layer1BreachStart = null;
          console.log(`[PositionMonitor] ${underlying}: Layer 1 breach cleared`);
        }

        // Call the monitoring function
        const monitorResult = monitorPosition(
          {
            premiumReceived: entryPremium,
            contracts,
            marginRequired: 0,
            putStrike: putStrike || undefined,
            callStrike: callStrike || undefined,
          },
          exitRules,
          currentPremium,
          underlyingPrice,
          layer1BreachStart
        );

        // Record the position
        const monitored: MonitoredPosition = {
          tradeId: trade.id,
          symbol: underlying,
          conid: trade.leg1Conid || '',
          qty: contracts,
          entryPremium,
          currentPremium,
          contracts,
          putStrike: putStrike || undefined,
          callStrike: callStrike || undefined,
          monitorResult,
        };
        results.positions.push(monitored);

        // Check if exit triggered - AUTO-CLOSE position
        if (monitorResult.shouldExit) {
          console.log(`[PositionMonitor] EXIT TRIGGERED: ${underlying} - ${monitorResult.exitReason}`);

          session.alertsTriggered++;
          let actionTaken = 'FAILED';
          let closeSuccess = false;

          // Find matching IBKR positions and close them
          for (const pos of ibkrPositions) {
            if (!pos.symbol?.includes(underlying)) continue;

            // Check if position matches our trade's strikes
            const posSymbol = pos.symbol || '';
            const posStrike = parseStrikeFromSymbol(posSymbol);
            if (!posStrike) continue;

            const matchesLeg1 = putStrike && Math.abs(posStrike - putStrike) < 0.01;
            const matchesLeg2 = callStrike && Math.abs(posStrike - callStrike) < 0.01;
            if (!matchesLeg1 && !matchesLeg2) continue;

            // Determine close side (opposite of position side)
            const closeSide = pos.side === 'SELL' ? 'BUY' : 'SELL';
            const posConid = pos.id || trade.leg1Conid || '';
            const qty = Math.abs(pos.qty || contracts);

            console.log(`[PositionMonitor] Submitting close order: ${posSymbol} ${closeSide} ${qty}`);

            try {
              const orderResult = await placeCloseOrderByConid(parseInt(posConid), qty, closeSide);
              if (orderResult.success) {
                closeSuccess = true;
                actionTaken = `AUTO-CLOSED via ${closeSide} order (ID: ${orderResult.orderId})`;
                console.log(`[PositionMonitor] Close order submitted: ${orderResult.orderId}`);
              } else {
                console.error(`[PositionMonitor] Close order failed: ${orderResult.error}`);
                actionTaken = `CLOSE FAILED: ${orderResult.error}`;
              }
            } catch (closeErr: any) {
              console.error(`[PositionMonitor] Close order error:`, closeErr);
              actionTaken = `CLOSE ERROR: ${closeErr?.message}`;
            }
          }

          // Update paper_trades if we closed successfully
          if (closeSuccess && db) {
            try {
              // Calculate P&L (entry premium - current premium)
              const pnl = (entryPremium - currentPremium) * contracts * 100;
              const exitReasonText = `Auto-closed by position monitor: ${monitorResult.exitReason}`;

              await db.update(paperTrades)
                .set({
                  exitReason: exitReasonText,
                  status: 'closed',
                  realizedPnl: pnl.toString(),
                  closedAt: new Date(),
                })
                .where(eq(paperTrades.id, trade.id));

              // Link outcome to engine_run for RLHF
              await linkTradeOutcome(trade.id, pnl, normalizeExitReason(exitReasonText));
            } catch (updateErr) {
              console.error(`[PositionMonitor] Failed to update trade status:`, updateErr);
            }
          }

          const alert = {
            tradeId: trade.id,
            symbol: underlying,
            exitReason: monitorResult.exitReason || 'Unknown',
            exitLayer: monitorResult.exitLayer || 1,
            actionTaken,
          };
          results.exitAlerts.push(alert);

          // Log significant event
          await logAudit('POSITION_MONITOR_AUTO_CLOSE', JSON.stringify({
            tradeId: trade.id,
            symbol: underlying,
            exitReason: monitorResult.exitReason,
            exitLayer: monitorResult.exitLayer,
            underlyingPrice,
            currentPremium,
            entryPremium,
            actionTaken,
            success: closeSuccess,
          }));
        }

      } catch (err: any) {
        const errorMsg = `Error monitoring ${trade.symbol}: ${err?.message}`;
        console.error(`[PositionMonitor] ${errorMsg}`);
        session.errors.push(errorMsg);
      }
    }

    // Update session stats
    session.checksCompleted++;
    session.lastCheckTime = results.timeET;
    session.positionsMonitored = results.positions.length;

    // Generate summary
    if (results.exitAlerts.length > 0) {
      results.summary = `⚠️ ${results.exitAlerts.length} EXIT ALERT(s): ${results.exitAlerts.map(a => `${a.symbol} (L${a.exitLayer})`).join(', ')}`;
    } else {
      results.summary = `✅ ${results.positions.length} positions monitored, all OK (check #${session.checksCompleted})`;
    }

    console.log(`[PositionMonitor] ${results.summary}`);

    // Only return detailed data if there are alerts or errors
    const hasSignificantEvent = results.exitAlerts.length > 0 || session.errors.length > 0;

    return {
      success: session.errors.length === 0,
      // Skip creating job run for routine checks (aggregation)
      skipped: !hasSignificantEvent,
      reason: hasSignificantEvent ? undefined : 'Routine check - aggregated',
      data: results,
    };

  } catch (error: any) {
    const errMsg = error?.message || 'Unknown error';
    console.error('[PositionMonitor] Fatal error:', error);
    session.errors.push(`Fatal: ${errMsg}`);
    results.summary = `FAILED: ${errMsg}`;

    await logAudit('POSITION_MONITOR_ERROR', errMsg);

    return { success: false, error: errMsg, data: results };
  }
}

/**
 * Get current session status (for UI display)
 */
export function getMonitorSessionStatus(): MonitorSession & { layer1Breaches: string[] } {
  const session = getSession();
  return {
    ...session,
    layer1Breaches: Array.from(layer1BreachTimes.keys()),
  };
}

// ============================================
// Job Handler Registration
// ============================================

/**
 * Register the position monitor job handler
 */
export function initPositionMonitorJob(): void {
  console.log('[PositionMonitor] Initializing job handler...');

  registerJobHandler({
    id: 'position-monitor',
    name: 'Position Monitor',
    description: 'Real-time position monitoring using 3-Layer Defense System (runs every 5 min)',
    execute: executePositionMonitor,
  });

  console.log('[PositionMonitor] Job handler registered');
}

/**
 * Create the job in the database if it doesn't exist
 */
export async function ensurePositionMonitorJob(): Promise<void> {
  if (!db) return;

  try {
    const [existingJob] = await db.select().from(jobs).where(eq(jobs.id, 'position-monitor')).limit(1);

    const desiredSchedule = '*/5 9-16 * * 1-5'; // Every 5 min, 9am-4pm ET, weekdays

    if (!existingJob) {
      console.log('[PositionMonitor] Creating job in database...');
      await db.insert(jobs).values({
        id: 'position-monitor',
        name: 'Position Monitor',
        description: 'Real-time position monitoring with 3-Layer Defense. Runs every 5 minutes during market hours.',
        type: 'position-monitor',
        schedule: desiredSchedule,
        timezone: 'America/New_York',
        enabled: true,
        config: {
          intervalMinutes: CHECK_INTERVAL_MINUTES,
          layer1SustainMs: LAYER1_SUSTAIN_MS,
          aggregateLogs: true,
          skipMarketCheck: true,  // Allow job to run after market close for status updates
        },
      });
      console.log('[PositionMonitor] Job created successfully');
    } else {
      // Update config to ensure skipMarketCheck is enabled
      const currentConfig = existingJob.config as Record<string, any> || {};
      if (!currentConfig.skipMarketCheck) {
        console.log('[PositionMonitor] Updating job config with skipMarketCheck: true');
        await db.update(jobs).set({
          config: { ...currentConfig, skipMarketCheck: true }
        }).where(eq(jobs.id, 'position-monitor'));
        console.log('[PositionMonitor] Job config updated successfully');
      }
    }
  } catch (err) {
    console.warn('[PositionMonitor] Could not ensure job exists:', err);
  }
}
