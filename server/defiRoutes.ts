/**
 * DeFi API Routes
 *
 * Endpoints for:
 * - Attestation data generation and verification
 * - Trading mandate management and enforcement
 */

import { Router, Request, Response } from 'express';
import { generateAttestationData, getRawDetails } from './services/attestationService';
import {
  createMandate,
  getActiveMandate,
  getUserMandates,
  deactivateMandate,
  getMandateViolations,
  getUserViolations,
  getMonthlyViolationCount,
  commitMandateToSolana,
  recordViolationOnSolana,
} from './services/mandateService';
import { requireAuth } from './auth';
import type { AttestationPeriod } from '@shared/types/defi';
import type { CreateMandateRequest } from '@shared/types/mandate';
import { db } from './db';
import { paperTrades, navSnapshots, orders, optionBars } from '@shared/schema';
import { eq, and, gte, lte, desc, asc, inArray, sql, or } from 'drizzle-orm';

const router = Router();

// ============================================
// Constants
// ============================================

// Fixed baseline date for performance calculations (user's trading start date)
const BASELINE_DATE = '2025-12-16';

// ============================================
// Helper Functions
// ============================================

/**
 * Derive display status from database status and exitReason
 * Returns: 'expired' | 'stopped out' | 'exercised' | 'open'
 */
function deriveDisplayStatus(dbStatus: string, exitReason: string | null): string {
  if (dbStatus === 'open') return 'open';
  if (!exitReason) return dbStatus === 'expired' ? 'expired' : 'stopped out';

  const reason = exitReason.toLowerCase();

  // ITM/assignment → exercised
  if (reason.includes('itm') || reason.includes('assigned') || reason.includes('exercised')) {
    return 'exercised';
  }

  // Auto-closed/layer 1/layer 2/stop → stopped out
  if (reason.includes('auto-closed') || reason.includes('layer 1') ||
      reason.includes('layer 2') || reason.includes('stop')) {
    return 'stopped out';
  }

  // Expired
  if (reason.includes('expired') || dbStatus === 'expired') {
    return 'expired';
  }

  return 'stopped out';
}

// ============================================
// Performance Data Types
// ============================================

interface PeriodMetrics {
  returnPercent: number;
  pnlUsd: number;
  pnlHkd: number;
  tradeCount: number;
  winRate: number;
}

interface PerformanceData {
  mtd: PeriodMetrics;
  ytd: PeriodMetrics;
  all: PeriodMetrics;
}

// ============================================
// Performance Endpoint (Real Trade Data)
// ============================================

/**
 * GET /api/defi/performance
 *
 * Get aggregated performance metrics from actual trades.
 * Shows MTD, YTD, and ALL time periods without requiring attestation.
 */
router.get('/performance', async (_req: Request, res: Response) => {
  try {
    if (!db) {
      return res.status(500).json({
        success: false,
        error: 'Database not available',
      });
    }

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    // Define period boundaries
    const mtdStart = new Date(currentYear, currentMonth, 1);
    const ytdStart = new Date(currentYear, 0, 1);
    const allTimeStart = new Date(2020, 0, 1); // Far back enough to capture all trades

    // Helper to calculate metrics for a period
    async function getMetricsForPeriod(startDate: Date, endDate: Date): Promise<PeriodMetrics> {
      const startStr = startDate.toISOString().split('T')[0];

      // Get starting NAV for return % calculation
      // Always use fixed BASELINE_DATE for consistent return calculations
      let navStart = 0;

      // Get NAV at/before the baseline date (Dec 16, 2024)
      const [startNav] = await db!
        .select()
        .from(navSnapshots)
        .where(lte(navSnapshots.date, BASELINE_DATE))
        .orderBy(desc(navSnapshots.date))
        .limit(1);

      if (startNav) {
        navStart = parseFloat(startNav.nav as any) || 0;
      } else {
        // Fallback: use earliest NAV snapshot at or after baseline
        const [firstNav] = await db!
          .select()
          .from(navSnapshots)
          .where(gte(navSnapshots.date, BASELINE_DATE))
          .orderBy(asc(navSnapshots.date))
          .limit(1);
        navStart = firstNav ? parseFloat(firstNav.nav as any) || 0 : 0;
      }

      // Get ALL trades for this period (for counting), starting from BASELINE_DATE
      const baselineDate = new Date(BASELINE_DATE + 'T00:00:00-05:00');
      const effectiveStartDate = startDate > baselineDate ? startDate : baselineDate;
      const allTrades = await db!
        .select()
        .from(paperTrades)
        .where(and(
          gte(paperTrades.createdAt, effectiveStartDate),
          lte(paperTrades.createdAt, endDate)
        ));

      // Filter to closed/expired trades (for win rate calculation)
      const closedTrades = allTrades.filter(t => t.status === 'closed' || t.status === 'expired');

      // Get ending NAV for the period (most recent closing NAV)
      const endStr = endDate.toISOString().split('T')[0];
      const [endNav] = await db!
        .select()
        .from(navSnapshots)
        .where(and(
          lte(navSnapshots.date, endStr),
          eq(navSnapshots.snapshotType, 'closing')
        ))
        .orderBy(desc(navSnapshots.date))
        .limit(1);

      const navEnd = endNav ? parseFloat(endNav.nav as any) || 0 : 0;

      // FIX: Calculate P&L from NAV delta (more accurate than summing trade P&L)
      // NAV is stored in HKD
      const USD_TO_HKD = 7.8;
      const pnlHkd = navEnd > 0 && navStart > 0 ? navEnd - navStart : 0;
      const pnlUsd = pnlHkd / USD_TO_HKD;

      // Calculate return % = (End NAV - Start NAV) / Start NAV
      const returnPercent = navStart > 0 ? (pnlHkd / navStart) * 100 : 0;

      // Get all NAV snapshots for win rate calculation (same logic as trade log)
      const allNavSnapshots = await db!
        .select()
        .from(navSnapshots)
        .orderBy(desc(navSnapshots.date));

      // Create lookup maps for NAV by date
      const navByDateType = new Map<string, number>();
      for (const nav of allNavSnapshots) {
        const key = `${nav.date}-${nav.snapshotType}`;
        navByDateType.set(key, parseFloat(nav.nav as any) || 0);
      }

      // Win/loss stats using NAV-based P&L (same calculation as trade log)
      const tradeCount = allTrades.length;  // Total trades in period
      const closedCount = closedTrades.length;  // Closed/expired trades

      // Count wins using NAV-based P&L (consistent with trade log display)
      const winCount = closedTrades.filter(t => {
        const createdAt = new Date(t.createdAt!);
        // Use ET timezone for date matching (same as trade log)
        const dateStr = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'America/New_York',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }).format(createdAt);

        // Look up NAV for this trade's date
        const openingNav = navByDateType.get(`${dateStr}-opening`) || null;
        const closingNav = navByDateType.get(`${dateStr}-closing`) || null;
        const navChange = openingNav && closingNav ? closingNav - openingNav : null;

        // Use NAV-based P&L if available, otherwise use database P&L
        const dbPnl = parseFloat(t.realizedPnl as any) || 0;
        const navBasedPnlUSD = navChange !== null ? navChange / USD_TO_HKD : null;
        const pnl = navBasedPnlUSD !== null ? navBasedPnlUSD : dbPnl;

        return pnl > 0;
      }).length;
      const winRate = closedCount > 0 ? winCount / closedCount : 0;

      return {
        returnPercent,
        pnlUsd,
        pnlHkd,  // Add HKD value for display
        tradeCount,
        winRate,
      };
    }

    // Calculate metrics for each period
    const [mtd, ytd, all] = await Promise.all([
      getMetricsForPeriod(mtdStart, now),
      getMetricsForPeriod(ytdStart, now),
      getMetricsForPeriod(allTimeStart, now),
    ]);

    const performanceData: PerformanceData = { mtd, ytd, all };

    res.json({
      success: true,
      data: performanceData,
    });
  } catch (error: any) {
    console.error('[DefiRoutes] Error getting performance:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get performance data',
    });
  }
});

/**
 * GET /api/defi/current
 *
 * Get today's trade (or most recent) with live unrealized P&L if open.
 * Includes streak and market close time.
 * Public endpoint for BearHedge website display.
 */
router.get('/current', async (_req: Request, res: Response) => {
  try {
    if (!db) {
      return res.status(500).json({
        success: false,
        error: 'Database not available',
      });
    }

    const USD_TO_HKD = 7.8;

    // Get today's date in ET timezone
    const nowET = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
    const todayET = new Date(nowET);
    const todayStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date());

    // Get ALL trades from baseline for day count and streak calculation
    const baselineDate = new Date(BASELINE_DATE + 'T00:00:00-05:00');
    const allTrades = await db
      .select()
      .from(paperTrades)
      .where(gte(paperTrades.createdAt, baselineDate))
      .orderBy(asc(paperTrades.createdAt));

    // Get unique trading days with their dates for day numbering
    const tradingDaysMap = new Map<string, number>();
    let dayNumber = 0;
    for (const t of allTrades) {
      const dateStr = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(new Date(t.createdAt!));
      if (!tradingDaysMap.has(dateStr)) {
        dayNumber++;
        tradingDaysMap.set(dateStr, dayNumber);
      }
    }
    const totalDays = dayNumber;

    // Calculate streak and accumulated profit
    // User requested reset: start counting from yesterday only
    const recentTrades = [...allTrades].reverse(); // Most recent first
    const closedTrades = recentTrades.filter(t => t.status !== 'open');

    // Simple streak: just count from yesterday (Day 1)
    // For now, streak = 1 if most recent trade is profitable
    let streak = 0;
    let accumulatedProfitUSD = 0;

    // Only count the most recent trade as Day 1
    if (closedTrades.length > 0) {
      const mostRecent = closedTrades[0];
      const pnl = parseFloat(mostRecent.realizedPnl as any) || 0;
      if (pnl >= 0) {
        streak = 1;
        accumulatedProfitUSD = pnl;
      }
    }

    const accumulatedProfitHKD = accumulatedProfitUSD * USD_TO_HKD;

    // Find today's trade
    const todayTrade = recentTrades.find(t => {
      const tradeDate = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(new Date(t.createdAt!));
      return tradeDate === todayStr;
    });

    // Calculate time until market close (4:00 PM ET)
    const marketCloseET = new Date(todayET);
    marketCloseET.setHours(16, 0, 0, 0);
    const msUntilClose = marketCloseET.getTime() - todayET.getTime();
    const minutesUntilClose = Math.floor(msUntilClose / 60000);
    const hoursUntilClose = Math.floor(minutesUntilClose / 60);
    const minsRemaining = minutesUntilClose % 60;
    const marketOpen = todayET.getHours() >= 9 && todayET.getHours() < 16 && todayET.getDay() >= 1 && todayET.getDay() <= 5;

    // Day number for display (reset to 1 for fresh start)
    const todayDayNumber = 1;

    // Base response with streak and accumulated profits
    let response: any = {
      streak: streak,
      dayNumber: todayDayNumber,
      totalDays: totalDays,
      accumulatedProfitUSD: accumulatedProfitUSD,
      accumulatedProfitHKD: accumulatedProfitHKD,
      todayStr: todayStr,
      hasTrade: !!todayTrade,
      marketOpen: marketOpen,
      timeUntilClose: marketOpen && msUntilClose > 0 ? `${hoursUntilClose}h ${minsRemaining}m` : null,
    };

    // Get the most recent trade (today's or last trade)
    const trade = todayTrade || recentTrades.find(t => t.status !== 'open');

    if (!trade) {
      return res.json({ success: true, ...response, trade: null });
    }

    // Update hasTrade to true since we have a trade to show
    response.hasTrade = true;

    const createdAt = new Date(trade.createdAt!);
    const tradeDateStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(createdAt);

    // Get leg details (premiums are in USD)
    const leg1Type = trade.leg1Type; // 'PUT' or 'CALL'
    const leg1Strike = trade.leg1Strike ? parseFloat(trade.leg1Strike as any) : null;
    const leg1PremiumUSD = trade.leg1Premium ? parseFloat(trade.leg1Premium as any) : 0;

    const leg2Type = trade.leg2Type; // 'PUT' or 'CALL' or null
    const leg2Strike = trade.leg2Strike ? parseFloat(trade.leg2Strike as any) : null;
    const leg2PremiumUSD = trade.leg2Premium ? parseFloat(trade.leg2Premium as any) : 0;

    // Total premium (USD)
    const totalPremiumUSD = leg1PremiumUSD + leg2PremiumUSD;
    const totalPremiumHKD = totalPremiumUSD * USD_TO_HKD;

    // Contracts per leg (for strangle: total / 2)
    const totalContracts = trade.contracts || 1;
    const numLegs = (leg1Type ? 1 : 0) + (leg2Type ? 1 : 0);
    const contractsPerLeg = numLegs > 1 ? totalContracts / numLegs : totalContracts;

    // Build legs array
    const legs: any[] = [];
    if (leg1Type && leg1Strike) {
      legs.push({
        type: leg1Type,
        strike: leg1Strike,
        contracts: contractsPerLeg,
        premiumUSD: leg1PremiumUSD * 100 * contractsPerLeg, // Per contract premium × 100 × contracts
        premiumHKD: leg1PremiumUSD * 100 * contractsPerLeg * USD_TO_HKD,
      });
    }
    if (leg2Type && leg2Strike) {
      legs.push({
        type: leg2Type,
        strike: leg2Strike,
        contracts: contractsPerLeg,
        premiumUSD: leg2PremiumUSD * 100 * contractsPerLeg,
        premiumHKD: leg2PremiumUSD * 100 * contractsPerLeg * USD_TO_HKD,
      });
    }

    // Calculate total premium by summing leg premiums
    const calculatedTotalPremiumUSD = legs.reduce((sum, leg) => sum + leg.premiumUSD, 0);
    const calculatedTotalPremiumHKD = legs.reduce((sum, leg) => sum + leg.premiumHKD, 0);

    response.trade = {
      id: trade.id,
      date: tradeDateStr,
      symbol: trade.symbol,
      strategy: trade.strategy,
      contracts: totalContracts,
      legs: legs,
      totalPremiumUSD: calculatedTotalPremiumUSD,
      totalPremiumHKD: calculatedTotalPremiumHKD,
      entryTime: createdAt.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'America/New_York',
      }) + ' ET',
      status: trade.status,
      exitReason: trade.exitReason,
      isOpen: trade.status === 'open',
    };

    // If trade is closed, include realized P&L (realizedPnl is in USD)
    if (trade.status !== 'open') {
      const realizedPnlUSD = parseFloat(trade.realizedPnl as any) || 0;
      response.trade.realizedPnlUSD = realizedPnlUSD;
      response.trade.realizedPnlHKD = realizedPnlUSD * USD_TO_HKD;
      response.trade.exitTime = trade.closedAt ? new Date(trade.closedAt).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'America/New_York',
      }) + ' ET' : null;
    }

    // Note: Unrealized P&L from IBKR removed - this endpoint has no auth context
    // to get user-specific broker. Use authenticated endpoints for live P&L data.

    res.json({ success: true, ...response });
  } catch (error: any) {
    console.error('[DefiRoutes] Error getting current trade:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get current trade',
    });
  }
});

/**
 * GET /api/defi/trades
 *
 * Get all trades for the trade log table.
 * Returns one row per trade with full details including NAV and validation.
 */
router.get('/trades', async (req: Request, res: Response) => {
  try {
    if (!db) {
      return res.status(500).json({
        success: false,
        error: 'Database not available',
      });
    }

    const limit = parseInt(req.query.limit as string) || 100;

    // Get all trades from BASELINE_DATE onwards (both open and closed), most recent first
    const baselineDate = new Date(BASELINE_DATE + 'T00:00:00-05:00'); // ET timezone
    const trades = await db
      .select()
      .from(paperTrades)
      .where(gte(paperTrades.createdAt, baselineDate))
      .orderBy(desc(paperTrades.createdAt))
      .limit(limit);

    // Collect all IBKR order IDs from trades to look up fill times
    const allOrderIds: string[] = [];
    for (const trade of trades) {
      const orderIds = trade.ibkrOrderIds as string[] | null;
      if (orderIds?.length) {
        allOrderIds.push(...orderIds);
      }
    }

    // Query orders table for fill times
    const orderFillTimes = new Map<string, Date>();
    if (allOrderIds.length > 0) {
      const orderRecords = await db
        .select({ ibkrOrderId: orders.ibkrOrderId, filledAt: orders.filledAt })
        .from(orders)
        .where(inArray(orders.ibkrOrderId, allOrderIds));

      for (const order of orderRecords) {
        if (order.ibkrOrderId && order.filledAt) {
          orderFillTimes.set(order.ibkrOrderId, new Date(order.filledAt));
        }
      }
    }

    // Get all NAV snapshots for lookup
    const navData = await db
      .select()
      .from(navSnapshots)
      .orderBy(desc(navSnapshots.date));

    // Create lookup maps for NAV by date
    const navByDateType = new Map<string, number>();
    for (const nav of navData) {
      const key = `${nav.date}-${nav.snapshotType}`;
      navByDateType.set(key, parseFloat(nav.nav as any) || 0);
    }

    // Get current NAV for return % calculation
    const currentNav = navData.length > 0 ? parseFloat(navData[0].nav as any) || 100000 : 100000;

    // Helper to format time in ET timezone
    const formatTimeET = (date: Date | null): string | null => {
      if (!date) return null;
      return date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'America/New_York',
      }) + ' ET';
    };

    // Transform to trade log format
    const tradeLog = trades.map(t => {
      const dbPnl = parseFloat(t.realizedPnl as any) || 0;
      const createdAt = new Date(t.createdAt!);

      // Use ET timezone for date matching (NAV snapshots are in ET)
      const dateStr = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(createdAt);

      // Look up NAV for this trade's date
      const openingNav = navByDateType.get(`${dateStr}-opening`) || null;
      // Only show closing NAV for closed/expired trades (not for open trades)
      const closingNav = t.status !== 'open'
        ? (navByDateType.get(`${dateStr}-closing`) || null)
        : null;
      const navChange = openingNav && closingNav ? closingNav - openingNav : null;
      const dailyReturnPct = openingNav && navChange !== null ? (navChange / openingNav) * 100 : null;

      // FIX: For closed/expired trades, use NAV delta as P&L (more accurate than IBKR assumption)
      // NAV is stored in HKD, so navChange is already in HKD
      // Convert to USD for consistency with other P&L values
      const USD_TO_HKD = 7.8;
      const navBasedPnlUSD = navChange !== null ? navChange / USD_TO_HKD : null;

      // Use NAV-based P&L for closed/expired trades when available, otherwise use database value
      const pnl = (t.status !== 'open' && navBasedPnlUSD !== null) ? navBasedPnlUSD : dbPnl;

      // FIX: Use entry NAV for return % calculation (not current NAV)
      const entryNav = openingNav || currentNav;
      const returnPercent = entryNav > 0 ? (pnl / entryNav) * 100 : 0;

      // Calculate holding time in minutes using actual IBKR fill times
      // - Stopped out: Use actual exit fill time from IBKR orders table
      // - Expired/Exercised: Use 4:00 PM ET (market close) on the trade date
      // - Holding time should be ~100-300 minutes max (a few hours)
      const ibkrOrderIds = t.ibkrOrderIds as string[] | null;
      let entryFillTime: Date | null = null;
      let exitFillTime: Date | null = null;

      // Get entry fill time from orders table
      if (ibkrOrderIds?.length) {
        entryFillTime = orderFillTimes.get(ibkrOrderIds[0]) || null;
        // For stopped out trades, get exit fill time from orders
        if (ibkrOrderIds.length > 1) {
          exitFillTime = orderFillTimes.get(ibkrOrderIds[1]) || null;
        }
      }

      // For expired/exercised trades, use 4:00 PM ET as exit time
      const derivedStatus = deriveDisplayStatus(t.status, t.exitReason);
      if (derivedStatus === 'expired' || derivedStatus === 'exercised') {
        // Use market close (4:00 PM ET) on the trade's EXPIRATION date (not closedAt!)
        // closedAt is when the batch process ran, expiration is the actual option expiry
        const exitDate = t.expiration ? new Date(t.expiration) : (t.closedAt ? new Date(t.closedAt) : createdAt);
        const exitDateStr = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'America/New_York',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }).format(exitDate);
        // 4:00 PM ET = 16:00 in ET timezone
        exitFillTime = new Date(`${exitDateStr}T16:00:00-05:00`);
      }

      // Calculate holdingMinutes
      // - For orders with fill times: use actual fill times
      // - For expired trades: use createdAt as entry, 4PM ET on expiration as exit
      let holdingMinutes: number | null = null;

      // Use actual entry fill time if available, otherwise use createdAt
      const effectiveEntryTime = entryFillTime || createdAt;

      if (effectiveEntryTime && exitFillTime) {
        holdingMinutes = Math.max(0, Math.round((exitFillTime.getTime() - effectiveEntryTime.getTime()) / (1000 * 60)));
      }
      // Otherwise holdingMinutes stays null - will show "—" in UI

      // Determine trade outcome (based on actual P&L)
      const outcome: 'win' | 'loss' | 'breakeven' | 'open' =
        t.status === 'open' ? 'open'
        : pnl > 0 ? 'win'
        : pnl < 0 ? 'loss'
        : 'breakeven';

      // Get contract count and leg details
      // contracts = total option contracts (e.g., 4 contracts for a 2-strangle position = 2 puts + 2 calls)
      const totalContracts = t.contracts || 1;
      const putStrike = t.leg1Type === 'PUT' ? parseFloat(t.leg1Strike as any) : (t.leg2Type === 'PUT' ? parseFloat(t.leg2Strike as any) : null);
      const callStrike = t.leg2Type === 'CALL' ? parseFloat(t.leg2Strike as any) : (t.leg1Type === 'CALL' ? parseFloat(t.leg1Strike as any) : null);
      const numLegs = (putStrike ? 1 : 0) + (callStrike ? 1 : 0);
      // For notional, divide by legs to get per-side contracts
      const contractsPerSide = numLegs > 1 ? totalContracts / numLegs : totalContracts;

      // Calculate notional value in HKD: strike × 100 × contractsPerSide × 7.8
      // For a strangle, show total notional (put + call sides)
      const putNotionalHKD = putStrike ? putStrike * 100 * contractsPerSide * USD_TO_HKD : 0;
      const callNotionalHKD = callStrike ? callStrike * 100 * contractsPerSide * USD_TO_HKD : 0;
      const totalNotionalHKD = putNotionalHKD + callNotionalHKD;

      // Determine exit time:
      // - For expired trades: use "4:00 PM ET" (market close)
      // - For closed trades: use actual closedAt time
      // - For open trades: null
      let exitTime: string | null = null;
      if (t.status === 'expired') {
        exitTime = '4:00 PM ET';  // Market close time for expired options
      } else if (t.status === 'closed' && t.closedAt) {
        exitTime = formatTimeET(new Date(t.closedAt));
      }

      // Determine strategy display name
      const leg1 = t.leg1Type as string;
      const leg2 = t.leg2Type as string | null;
      let strategyDisplay = 'Unknown';
      if (leg1 === 'PUT' && leg2 === 'CALL') {
        strategyDisplay = 'Strangle';
      } else if (leg1 === 'CALL' && leg2 === 'PUT') {
        strategyDisplay = 'Strangle';
      } else if (leg1 === 'PUT' && !leg2) {
        strategyDisplay = 'Short Put';
      } else if (leg1 === 'CALL' && !leg2) {
        strategyDisplay = 'Short Call';
      } else if (t.strategy) {
        strategyDisplay = t.strategy.charAt(0).toUpperCase() + t.strategy.slice(1).toLowerCase();
      }

      return {
        id: t.id,
        date: dateStr,
        dateFormatted: createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        symbol: t.symbol,
        strategy: strategyDisplay,
        // Contract and leg details
        contracts: totalContracts,
        putStrike,
        callStrike,
        leg1Premium: t.leg1Premium ? parseFloat(t.leg1Premium as any) : null,
        leg2Premium: t.leg2Premium ? parseFloat(t.leg2Premium as any) : null,
        // Entry/exit premiums and times (in HKD)
        entryPremium: t.entryPremiumTotal ? parseFloat(t.entryPremiumTotal as any) * USD_TO_HKD : null,
        exitPremium: t.exitPrice ? parseFloat(t.exitPrice as any) * USD_TO_HKD : (t.status === 'expired' || t.status === 'closed' ? 0 : null),
        entryTime: formatTimeET(createdAt),
        exitTime,
        // Status, outcome and P&L (in HKD)
        status: deriveDisplayStatus(t.status, t.exitReason),
        outcome,
        exitReason: t.exitReason,
        realizedPnl: pnl * USD_TO_HKD,
        realizedPnlUSD: pnl,
        returnPercent,
        // Holding time in minutes and entry NAV used for return calculation
        holdingMinutes,
        entryNav,
        // NAV data for this trade's date (already HKD in database)
        openingNav,
        closingNav,
        navChange,
        dailyReturnPct,
        // Notional values (in HKD)
        putNotionalHKD,
        callNotionalHKD,
        totalNotionalHKD,
        // Premium clarity
        premiumReceived: t.entryPremiumTotal ? parseFloat(t.entryPremiumTotal as any) : null,
        costToClose: t.exitPrice ? parseFloat(t.exitPrice as any) : null,
        // Validation data
        spotPriceAtClose: t.spotPriceAtClose ? parseFloat(t.spotPriceAtClose as any) : null,
        validationStatus: t.validationStatus || 'pending',
        // Full trade data for validation modal
        marginRequired: t.marginRequired ? parseFloat(t.marginRequired as any) * USD_TO_HKD : null,
        maxLoss: t.maxLoss ? parseFloat(t.maxLoss as any) * USD_TO_HKD : null,
        entrySpy: t.entrySpyPrice ? parseFloat(t.entrySpyPrice as any) : null,
        // Commission breakdown (USD)
        entryCommission: t.entryCommission ?? null,
        exitCommission: t.exitCommission ?? null,
        totalCommissions: t.totalCommissions ?? null,
        grossPnl: t.grossPnl ?? null,
        netPnl: t.netPnl ?? null,
        // Stop loss data
        stopLossPrice: t.stopLossPrice ? parseFloat(t.stopLossPrice as any) : null,
        stopLossMultiplier: t.stopLossMultiplier ? parseFloat(t.stopLossMultiplier as any) : null,
        // Solana on-chain recording
        solanaSignature: t.solanaSignature || null,
      };
    });

    res.json({
      success: true,
      trades: tradeLog,
      count: tradeLog.length,
    });
  } catch (error: any) {
    console.error('[DefiRoutes] Error getting trades:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get trades',
    });
  }
});

/**
 * POST /api/defi/generate-attestation
 *
 * Generate attestation data for a period.
 * Returns NAV, P&L, trade metrics, and details hash.
 */
router.post('/generate-attestation', async (req: Request, res: Response) => {
  try {
    const { periodType, customStart, customEnd } = req.body as {
      periodType: AttestationPeriod;
      customStart?: string;
      customEnd?: string;
    };

    if (!periodType) {
      return res.status(400).json({
        success: false,
        error: 'periodType is required',
      });
    }

    // Validate period type
    const validPeriods: AttestationPeriod[] = ['last_week', 'last_month', 'mtd', 'custom'];
    if (!validPeriods.includes(periodType)) {
      return res.status(400).json({
        success: false,
        error: `Invalid periodType. Must be one of: ${validPeriods.join(', ')}`,
      });
    }

    // Validate custom dates if custom period
    if (periodType === 'custom') {
      if (!customStart || !customEnd) {
        return res.status(400).json({
          success: false,
          error: 'customStart and customEnd are required for custom period',
        });
      }

      // Validate date format
      const startDate = new Date(customStart);
      const endDate = new Date(customEnd);
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return res.status(400).json({
          success: false,
          error: 'Invalid date format. Use ISO 8601 format (YYYY-MM-DD)',
        });
      }

      if (startDate >= endDate) {
        return res.status(400).json({
          success: false,
          error: 'customStart must be before customEnd',
        });
      }
    }

    const data = await generateAttestationData(periodType, customStart, customEnd);

    res.json({
      success: true,
      data,
    });
  } catch (error: any) {
    console.error('[DefiRoutes] Error generating attestation:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to generate attestation data',
    });
  }
});

/**
 * GET /api/defi/raw-details/:hash
 *
 * Fetch raw details for verification of a hash.
 */
router.get('/raw-details/:hash', async (req: Request, res: Response) => {
  try {
    const { hash } = req.params;

    if (!hash || !hash.startsWith('0x')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid hash format. Must start with 0x',
      });
    }

    const details = await getRawDetails(hash);

    if (!details) {
      return res.status(404).json({
        success: false,
        error: 'Raw details not found for this hash',
      });
    }

    res.json({
      success: true,
      data: details,
    });
  } catch (error: any) {
    console.error('[DefiRoutes] Error fetching raw details:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch raw details',
    });
  }
});

/**
 * GET /api/defi/periods
 *
 * Get available period options with their date ranges.
 */
router.get('/periods', async (_req: Request, res: Response) => {
  try {
    const now = new Date();

    // Calculate period dates
    const dayOfWeek = now.getDay();
    const lastSunday = new Date(now);
    lastSunday.setDate(now.getDate() - dayOfWeek);
    const lastMonday = new Date(lastSunday);
    lastMonday.setDate(lastSunday.getDate() - 6);

    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

    const mtdStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const mtdEnd = new Date(now);
    mtdEnd.setDate(mtdEnd.getDate() - 1);

    res.json({
      success: true,
      periods: [
        {
          type: 'last_week',
          label: 'Last Week',
          start: lastMonday.toISOString().split('T')[0],
          end: lastSunday.toISOString().split('T')[0],
        },
        {
          type: 'last_month',
          label: 'Last Month',
          start: lastMonthStart.toISOString().split('T')[0],
          end: lastMonthEnd.toISOString().split('T')[0],
        },
        {
          type: 'mtd',
          label: 'Month to Date',
          start: mtdStart.toISOString().split('T')[0],
          end: mtdEnd.toISOString().split('T')[0],
        },
        {
          type: 'custom',
          label: 'Custom Range',
          start: null,
          end: null,
        },
      ],
    });
  } catch (error: any) {
    console.error('[DefiRoutes] Error getting periods:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get periods',
    });
  }
});

// ============================================
// Trading Mandate Endpoints
// ============================================

/**
 * POST /api/defi/mandate
 *
 * Create a new trading mandate for the authenticated user.
 * Mandates are locked forever once created - cannot be modified.
 */
router.post('/mandate', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const request = req.body as CreateMandateRequest;

    // Validate required fields
    if (!request.allowedSymbols || !Array.isArray(request.allowedSymbols) || request.allowedSymbols.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'allowedSymbols is required and must be a non-empty array',
      });
    }

    if (!request.strategyType || !['SELL', 'BUY'].includes(request.strategyType)) {
      return res.status(400).json({
        success: false,
        error: 'strategyType is required and must be "SELL" or "BUY"',
      });
    }

    if (typeof request.minDelta !== 'number' || typeof request.maxDelta !== 'number') {
      return res.status(400).json({
        success: false,
        error: 'minDelta and maxDelta are required numbers',
      });
    }

    if (request.minDelta < 0 || request.maxDelta > 1 || request.minDelta > request.maxDelta) {
      return res.status(400).json({
        success: false,
        error: 'Delta range must be between 0-1 with minDelta <= maxDelta',
      });
    }

    if (typeof request.maxDailyLossPercent !== 'number' || request.maxDailyLossPercent <= 0) {
      return res.status(400).json({
        success: false,
        error: 'maxDailyLossPercent is required and must be positive',
      });
    }

    if (typeof request.noOvernightPositions !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'noOvernightPositions is required and must be a boolean',
      });
    }

    const mandate = await createMandate(userId, request);

    res.json({
      success: true,
      mandate,
    });
  } catch (error: any) {
    console.error('[DefiRoutes] Error creating mandate:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create mandate',
    });
  }
});

/**
 * GET /api/defi/mandate
 *
 * Get the active mandate for the authenticated user.
 */
router.get('/mandate', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const mandate = await getActiveMandate(userId);

    if (!mandate) {
      return res.json({
        success: true,
        mandate: null,
        violations: [],
        violationCount: 0,
        monthlyViolations: 0,
      });
    }

    // Get violations and counts
    const violations = await getMandateViolations(mandate.id, 10);
    const allViolations = await getMandateViolations(mandate.id, 1000);
    const monthlyViolations = await getMonthlyViolationCount(mandate.id);

    res.json({
      success: true,
      mandate,
      violations,
      violationCount: allViolations.length,
      monthlyViolations,
    });
  } catch (error: any) {
    console.error('[DefiRoutes] Error getting mandate:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get mandate',
    });
  }
});

/**
 * GET /api/defi/mandate/history
 *
 * Get all mandates (including inactive) for the authenticated user.
 */
router.get('/mandate/history', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const mandates = await getUserMandates(userId);

    res.json({
      success: true,
      mandates,
    });
  } catch (error: any) {
    console.error('[DefiRoutes] Error getting mandate history:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get mandate history',
    });
  }
});

/**
 * GET /api/defi/mandate/violations
 *
 * Get all violations for the authenticated user.
 */
router.get('/mandate/violations', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const limit = parseInt(req.query.limit as string) || 100;
    const violations = await getUserViolations(userId, limit);

    res.json({
      success: true,
      violations,
    });
  } catch (error: any) {
    console.error('[DefiRoutes] Error getting violations:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get violations',
    });
  }
});

/**
 * DELETE /api/defi/mandate/:id
 *
 * Deactivate a mandate. Mandates cannot be deleted (kept for audit trail).
 */
router.delete('/mandate/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const mandateId = req.params.id;

    if (!mandateId) {
      return res.status(400).json({
        success: false,
        error: 'Mandate ID is required',
      });
    }

    await deactivateMandate(mandateId, userId);

    res.json({
      success: true,
      message: 'Mandate deactivated successfully',
    });
  } catch (error: any) {
    console.error('[DefiRoutes] Error deactivating mandate:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to deactivate mandate',
    });
  }
});

/**
 * POST /api/defi/mandate/:id/commit
 *
 * Commit a mandate hash to Solana for on-chain proof.
 */
router.post('/mandate/:id/commit', requireAuth, async (req: Request, res: Response) => {
  try {
    const mandateId = req.params.id;

    if (!mandateId) {
      return res.status(400).json({
        success: false,
        error: 'Mandate ID is required',
      });
    }

    const result = await commitMandateToSolana(mandateId);

    res.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    console.error('[DefiRoutes] Error committing mandate to Solana:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to commit mandate to Solana',
    });
  }
});

/**
 * POST /api/defi/violation/:id/record
 *
 * Record a violation on Solana for on-chain proof.
 */
router.post('/violation/:id/record', requireAuth, async (req: Request, res: Response) => {
  try {
    const violationId = req.params.id;

    if (!violationId) {
      return res.status(400).json({
        success: false,
        error: 'Violation ID is required',
      });
    }

    const result = await recordViolationOnSolana(violationId);

    res.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    console.error('[DefiRoutes] Error recording violation on Solana:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to record violation on Solana',
    });
  }
});

// ============================================
// Trade Data Backfill Endpoints
// ============================================

import { backfillClosedTrades, backfillSingleTrade, fixExpiredTrades } from './services/backfillTrades';

/**
 * POST /api/defi/backfill-trades
 *
 * Backfill closed trades with actual IBKR execution data.
 * Corrects P&L calculations for trades that were closed with estimated values.
 */
router.post('/backfill-trades', requireAuth, async (_req: Request, res: Response) => {
  try {
    const result = await backfillClosedTrades();

    res.json({
      success: result.success,
      data: {
        processed: result.processed,
        updated: result.updated,
        skipped: result.skipped,
        errors: result.errors,
      },
    });
  } catch (error: any) {
    console.error('[DefiRoutes] Error backfilling trades:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to backfill trades',
    });
  }
});

/**
 * POST /api/defi/fix-expired-trades
 *
 * Fix expired trades that have null/0 realizedPnl.
 * For expired options, the full premium is kept (they expired worthless).
 */
router.post('/fix-expired-trades', requireAuth, async (_req: Request, res: Response) => {
  try {
    const result = await fixExpiredTrades();

    res.json({
      success: result.success,
      data: {
        processed: result.processed,
        updated: result.updated,
        skipped: result.skipped,
        errors: result.errors,
      },
    });
  } catch (error: any) {
    console.error('[DefiRoutes] Error fixing expired trades:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fix expired trades',
    });
  }
});

/**
 * POST /api/defi/backfill-trade/:id
 *
 * Backfill a single trade by ID.
 */
router.post('/backfill-trade/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const tradeId = req.params.id;

    if (!tradeId) {
      return res.status(400).json({
        success: false,
        error: 'Trade ID is required',
      });
    }

    const result = await backfillSingleTrade(tradeId);

    res.json({
      success: result.success,
      message: result.message,
    });
  } catch (error: any) {
    console.error('[DefiRoutes] Error backfilling single trade:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to backfill trade',
    });
  }
});

// ============================================
// Solana Trade Recording Endpoints
// ============================================

import { recordTradeOnSolana, recordTradesOnSolana, getWalletBalance } from './services/solanaTradeRecorder';

/**
 * POST /api/defi/record-trade/:id
 *
 * Record a single closed trade on Solana blockchain.
 * Returns the transaction signature if successful.
 */
router.post('/record-trade/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const tradeId = req.params.id;

    if (!tradeId) {
      return res.status(400).json({
        success: false,
        error: 'Trade ID is required',
      });
    }

    const result = await recordTradeOnSolana(tradeId);

    if (result.success) {
      res.json({
        success: true,
        signature: result.signature,
        tradeHash: result.tradeHash,
        explorerUrl: `https://explorer.solana.com/tx/${result.signature}?cluster=${process.env.SOLANA_CLUSTER || 'devnet'}`,
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error,
        signature: result.signature, // May exist if already recorded
      });
    }
  } catch (error: any) {
    console.error('[DefiRoutes] Error recording trade on Solana:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to record trade on Solana',
    });
  }
});

/**
 * POST /api/defi/record-trades
 *
 * Record multiple closed trades on Solana blockchain.
 * Accepts array of trade IDs.
 */
router.post('/record-trades', requireAuth, async (req: Request, res: Response) => {
  try {
    const { tradeIds } = req.body as { tradeIds: string[] };

    if (!tradeIds || !Array.isArray(tradeIds) || tradeIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'tradeIds array is required',
      });
    }

    if (tradeIds.length > 10) {
      return res.status(400).json({
        success: false,
        error: 'Maximum 10 trades can be recorded at once',
      });
    }

    const results = await recordTradesOnSolana(tradeIds);

    const response: any = {
      success: true,
      results: {},
      successCount: 0,
      failureCount: 0,
    };

    for (const [id, result] of results) {
      response.results[id] = result;
      if (result.success) {
        response.successCount++;
      } else {
        response.failureCount++;
      }
    }

    res.json(response);
  } catch (error: any) {
    console.error('[DefiRoutes] Error recording trades on Solana:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to record trades on Solana',
    });
  }
});

/**
 * GET /api/defi/solana-wallet
 *
 * Get Solana wallet information (balance, address).
 */
router.get('/solana-wallet', requireAuth, async (_req: Request, res: Response) => {
  try {
    const walletInfo = await getWalletBalance();

    if (!walletInfo) {
      return res.json({
        success: true,
        configured: false,
        message: 'Solana wallet not configured',
      });
    }

    res.json({
      success: true,
      configured: true,
      address: walletInfo.address,
      balance: walletInfo.balance,
      cluster: process.env.SOLANA_CLUSTER || 'devnet',
    });
  } catch (error: any) {
    console.error('[DefiRoutes] Error getting Solana wallet info:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get wallet info',
    });
  }
});

// ============================================
// Option Candle Data Endpoint
// ============================================

/**
 * GET /api/defi/candles/:date
 *
 * Get 5-minute OHLC candle data for a specific trade date.
 * Returns PUT and CALL candles for the traded strikes.
 *
 * URL params:
 *   :date - Trade date in YYYY-MM-DD format
 *
 * Query params (optional):
 *   putStrike - Override put strike (defaults to trade's put strike)
 *   callStrike - Override call strike (defaults to trade's call strike)
 *
 * Response:
 *   {
 *     success: true,
 *     date: "2026-01-08",
 *     trade: { putStrike, callStrike, strategy, contracts },
 *     putCandles: [{ time, open, high, low, close, bid, ask, delta }],
 *     callCandles: [{ time, open, high, low, close, bid, ask, delta }],
 *     underlyingCandles: [{ time, price }]
 *   }
 */
router.get('/candles/:date', async (req: Request, res: Response) => {
  try {
    if (!db) {
      return res.status(500).json({
        success: false,
        error: 'Database not available',
      });
    }

    const dateStr = req.params.date;

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid date format. Use YYYY-MM-DD',
      });
    }

    // Get query param overrides if provided
    const overridePutStrike = req.query.putStrike ? parseFloat(req.query.putStrike as string) : null;
    const overrideCallStrike = req.query.callStrike ? parseFloat(req.query.callStrike as string) : null;

    // Find trade for this date
    const dateStart = new Date(`${dateStr}T00:00:00-05:00`); // ET timezone
    const dateEnd = new Date(`${dateStr}T23:59:59-05:00`);

    const [trade] = await db
      .select()
      .from(paperTrades)
      .where(and(
        gte(paperTrades.createdAt, dateStart),
        lte(paperTrades.createdAt, dateEnd)
      ))
      .limit(1);

    // Determine strikes to query
    let putStrike: number | null = overridePutStrike;
    let callStrike: number | null = overrideCallStrike;
    let tradeInfo: any = null;

    if (trade) {
      // Extract strikes from trade legs
      const leg1Type = trade.leg1Type;
      const leg2Type = trade.leg2Type;
      const leg1Strike = trade.leg1Strike ? parseFloat(trade.leg1Strike as any) : null;
      const leg2Strike = trade.leg2Strike ? parseFloat(trade.leg2Strike as any) : null;

      if (!putStrike) {
        putStrike = leg1Type === 'PUT' ? leg1Strike : (leg2Type === 'PUT' ? leg2Strike : null);
      }
      if (!callStrike) {
        callStrike = leg1Type === 'CALL' ? leg1Strike : (leg2Type === 'CALL' ? leg2Strike : null);
      }

      tradeInfo = {
        id: trade.id,
        symbol: trade.symbol,
        strategy: trade.strategy,
        putStrike,
        callStrike,
        contracts: trade.contracts,
        status: trade.status,
        entryTime: trade.createdAt,
      };
    }

    // If no strikes found, return empty
    if (!putStrike && !callStrike) {
      return res.json({
        success: true,
        date: dateStr,
        trade: tradeInfo,
        putCandles: [],
        callCandles: [],
        underlyingCandles: [],
        message: 'No trade found for this date or strikes not specified',
      });
    }

    // Convert date to expiry format YYYYMMDD
    const expiry = dateStr.replace(/-/g, '');

    // Build strike condition using proper drizzle or() syntax
    let strikeCondition;
    if (putStrike && callStrike) {
      // Both strikes: PUT OR CALL
      strikeCondition = or(
        and(eq(optionBars.strike, String(putStrike)), eq(optionBars.optionType, 'PUT')),
        and(eq(optionBars.strike, String(callStrike)), eq(optionBars.optionType, 'CALL'))
      );
    } else if (putStrike) {
      strikeCondition = and(eq(optionBars.strike, String(putStrike)), eq(optionBars.optionType, 'PUT'));
    } else if (callStrike) {
      strikeCondition = and(eq(optionBars.strike, String(callStrike)), eq(optionBars.optionType, 'CALL'));
    }

    // Fetch option bars for the date and strikes
    // Use date range instead of DATE() function for better compatibility
    const dayStart = new Date(`${dateStr}T00:00:00Z`);
    const dayEnd = new Date(`${dateStr}T23:59:59Z`);

    const bars = await db
      .select()
      .from(optionBars)
      .where(and(
        eq(optionBars.symbol, 'SPY'),
        eq(optionBars.expiry, expiry),
        gte(optionBars.intervalStart, dayStart),
        lte(optionBars.intervalStart, dayEnd),
        strikeCondition
      ))
      .orderBy(asc(optionBars.intervalStart));

    // Separate into PUT and CALL candles
    const putCandles: any[] = [];
    const callCandles: any[] = [];
    const underlyingPrices = new Map<string, number>();

    for (const bar of bars) {
      const candle = {
        time: bar.intervalStart,
        timeFormatted: new Date(bar.intervalStart).toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          timeZone: 'America/New_York',
        }),
        open: bar.open ? parseFloat(bar.open) : null,
        high: bar.high ? parseFloat(bar.high) : null,
        low: bar.low ? parseFloat(bar.low) : null,
        close: bar.close ? parseFloat(bar.close) : null,
        bid: bar.bidClose ? parseFloat(bar.bidClose) : null,
        ask: bar.askClose ? parseFloat(bar.askClose) : null,
        delta: bar.delta ? parseFloat(bar.delta) : null,
        iv: bar.iv ? parseFloat(bar.iv) : null,
        dataQuality: bar.dataQuality,
      };

      if (bar.optionType === 'PUT') {
        putCandles.push(candle);
      } else if (bar.optionType === 'CALL') {
        callCandles.push(candle);
      }

      // Track underlying price
      if (bar.underlyingPrice) {
        underlyingPrices.set(bar.intervalStart.toISOString(), parseFloat(bar.underlyingPrice));
      }
    }

    // Build underlying candles array
    const underlyingCandles = Array.from(underlyingPrices.entries())
      .sort(([a], [b]) => new Date(a).getTime() - new Date(b).getTime())
      .map(([time, price]) => ({
        time: new Date(time),
        timeFormatted: new Date(time).toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          timeZone: 'America/New_York',
        }),
        price,
      }));

    res.json({
      success: true,
      date: dateStr,
      trade: tradeInfo,
      putStrike,
      callStrike,
      putCandles,
      callCandles,
      underlyingCandles,
      barCount: {
        put: putCandles.length,
        call: callCandles.length,
        underlying: underlyingCandles.length,
      },
    });
  } catch (error: any) {
    console.error('[DefiRoutes] Error getting candles:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get candle data',
    });
  }
});

export default router;
