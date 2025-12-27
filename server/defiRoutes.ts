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
import { paperTrades, navSnapshots, orders } from '@shared/schema';
import { eq, and, gte, lte, desc, asc, inArray } from 'drizzle-orm';

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
      const trades = allTrades.filter(t => t.status === 'closed' || t.status === 'expired');

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

      // Win/loss stats (from closed/expired trades only)
      const tradeCount = allTrades.length;  // Total trades in period
      const closedCount = trades.length;     // Closed/expired trades
      // Count wins based on trade's database P&L (or could use NAV change per trade)
      const winCount = trades.filter(t => {
        const realized = parseFloat(t.realizedPnl as any) || 0;
        return realized > 0;
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
        // Use market close (4:00 PM ET) on the trade's expiration date or closed date
        const exitDate = t.closedAt ? new Date(t.closedAt) : createdAt;
        const exitDateStr = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'America/New_York',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }).format(exitDate);
        // 4:00 PM ET = 16:00 in ET timezone
        exitFillTime = new Date(`${exitDateStr}T16:00:00-05:00`);
      }

      // Fallback to database timestamps if no fill times available
      const effectiveEntryTime = entryFillTime || createdAt;
      const effectiveExitTime = exitFillTime || (t.closedAt ? new Date(t.closedAt) : null);

      const holdingMinutes = effectiveExitTime
        ? Math.max(0, Math.round((effectiveExitTime.getTime() - effectiveEntryTime.getTime()) / (1000 * 60)))
        : null;

      // Determine trade outcome (based on actual P&L)
      const outcome: 'win' | 'loss' | 'breakeven' | 'open' =
        t.status === 'open' ? 'open'
        : pnl > 0 ? 'win'
        : pnl < 0 ? 'loss'
        : 'breakeven';

      // Get contract count and leg details
      // contracts = per-side contracts, totalContracts = contracts × number of legs
      const contractsPerSide = t.contracts || 1;
      const putStrike = t.leg1Type === 'PUT' ? parseFloat(t.leg1Strike as any) : (t.leg2Type === 'PUT' ? parseFloat(t.leg2Strike as any) : null);
      const callStrike = t.leg2Type === 'CALL' ? parseFloat(t.leg2Strike as any) : (t.leg1Type === 'CALL' ? parseFloat(t.leg1Strike as any) : null);
      // For strangles (PUT + CALL), total = contracts × 2; for single leg = contracts × 1
      const numLegs = (putStrike ? 1 : 0) + (callStrike ? 1 : 0);
      const totalContracts = contractsPerSide * (numLegs || 1);

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

export default router;
