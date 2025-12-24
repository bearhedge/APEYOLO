// @ts-nocheck
/**
 * Position Monitor Job
 *
 * Real-time position monitoring using the 3-Layer Defense System.
 * Runs every 5 minutes during market hours to check exit conditions.
 *
 * Layer 1: Underlying price breaches strike for 15+ minutes
 * Layer 2: Premium reaches 6x entry (stop loss)
 * Layer 3: EOD sweep at 3:55 PM ET
 *
 * Aggregation: Instead of spamming the jobs page, we aggregate
 * monitoring checks into a single daily session and only create
 * detailed log entries when:
 * - Exit condition triggered
 * - Error occurred
 * - Position closed
 */

import { db } from '../../db';
import { paperTrades, jobs, jobRuns, auditLogs } from '@shared/schema';
import { eq, and, sql, gte } from 'drizzle-orm';
import { getBroker } from '../../broker';
import { ensureIbkrReady } from '../../broker/ibkr';
import { registerJobHandler, type JobResult } from '../jobExecutor';
import { getETDateString, getETTimeString, isMarketOpen, isEarlyCloseDay, getMarketStatus } from '../marketCalendar';
import { monitorPosition, defineExitRules, type ExitRules, type MonitorResult } from '../../engine/step5';
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
 * Log to audit (for significant events only)
 */
async function logAudit(action: string, details: string): Promise<void> {
  if (!db) return;

  try {
    await db.insert(auditLogs).values({
      action,
      details,
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

        // Check if exit triggered
        if (monitorResult.shouldExit) {
          console.log(`[PositionMonitor] EXIT TRIGGERED: ${underlying} - ${monitorResult.exitReason}`);

          session.alertsTriggered++;

          const alert = {
            tradeId: trade.id,
            symbol: underlying,
            exitReason: monitorResult.exitReason || 'Unknown',
            exitLayer: monitorResult.exitLayer || 1,
            actionTaken: 'ALERT - Manual close required',
          };
          results.exitAlerts.push(alert);

          // Log significant event
          await logAudit('POSITION_MONITOR_EXIT_ALERT', JSON.stringify({
            tradeId: trade.id,
            symbol: underlying,
            exitReason: monitorResult.exitReason,
            exitLayer: monitorResult.exitLayer,
            underlyingPrice,
            currentPremium,
            entryPremium,
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

    if (!existingJob) {
      console.log('[PositionMonitor] Creating job in database...');
      await db.insert(jobs).values({
        id: 'position-monitor',
        name: 'Position Monitor',
        description: 'Real-time position monitoring with 3-Layer Defense. Runs every 5 minutes during market hours.',
        type: 'position-monitor',
        schedule: '*/5 9-16 * * 1-5', // Every 5 min, 9am-4pm ET, weekdays
        timezone: 'America/New_York',
        enabled: true,
        config: {
          intervalMinutes: CHECK_INTERVAL_MINUTES,
          layer1SustainMs: LAYER1_SUSTAIN_MS,
          aggregateLogs: true, // Only log significant events
        },
      });
      console.log('[PositionMonitor] Job created successfully');
    }
  } catch (err) {
    console.warn('[PositionMonitor] Could not ensure job exists:', err);
  }
}
