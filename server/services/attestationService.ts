/**
 * Attestation Service
 *
 * Generates attestation data from NAV snapshots and trade history.
 * Data is used for on-chain attestation of trading track records.
 */

import { createHash } from 'crypto';
import { db } from '../db';
import { navSnapshots, paperTrades } from '@shared/schema';
import { eq, and, gte, lte, desc } from 'drizzle-orm';
import type { AttestationData, AttestationPeriod } from '@shared/types/defi';

// ============================================
// Period Helpers
// ============================================

/**
 * Get date range for predefined periods
 */
function getPeriodDates(period: AttestationPeriod, customStart?: string, customEnd?: string): { start: Date; end: Date } {
  const now = new Date();

  switch (period) {
    case 'last_week': {
      // Previous Monday to Sunday
      const dayOfWeek = now.getDay();
      const lastSunday = new Date(now);
      lastSunday.setDate(now.getDate() - dayOfWeek);
      lastSunday.setHours(23, 59, 59, 999);

      const lastMonday = new Date(lastSunday);
      lastMonday.setDate(lastSunday.getDate() - 6);
      lastMonday.setHours(0, 0, 0, 0);

      return { start: lastMonday, end: lastSunday };
    }

    case 'last_month': {
      // Previous calendar month
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      start.setHours(0, 0, 0, 0);

      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      end.setHours(23, 59, 59, 999);

      return { start, end };
    }

    case 'mtd': {
      // Month to date (1st of current month to yesterday)
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      start.setHours(0, 0, 0, 0);

      const end = new Date(now);
      end.setDate(end.getDate() - 1);
      end.setHours(23, 59, 59, 999);

      return { start, end };
    }

    case 'custom': {
      if (!customStart || !customEnd) {
        throw new Error('Custom period requires start and end dates');
      }
      return {
        start: new Date(customStart),
        end: new Date(customEnd),
      };
    }

    default:
      throw new Error(`Unknown period type: ${period}`);
  }
}

/**
 * Format period label for display
 */
function formatPeriodLabel(start: Date, end: Date): string {
  const startMonth = start.toLocaleDateString('en-US', { month: 'short' });
  const endMonth = end.toLocaleDateString('en-US', { month: 'short' });
  const startDay = start.getDate();
  const endDay = end.getDate();
  const year = end.getFullYear();

  if (startMonth === endMonth) {
    return `${startMonth} ${startDay}-${endDay}, ${year}`;
  }
  return `${startMonth} ${startDay} - ${endMonth} ${endDay}, ${year}`;
}

// ============================================
// Attestation Generation
// ============================================

/**
 * Generate attestation data for a period
 *
 * @param periodType - The type of period (last_week, last_month, mtd, custom)
 * @param customStart - Start date for custom period (ISO string)
 * @param customEnd - End date for custom period (ISO string)
 */
export async function generateAttestationData(
  periodType: AttestationPeriod,
  customStart?: string,
  customEnd?: string
): Promise<AttestationData> {
  if (!db) {
    throw new Error('Database not available');
  }

  // Get period dates
  const { start, end } = getPeriodDates(periodType, customStart, customEnd);
  const startStr = start.toISOString().split('T')[0]; // YYYY-MM-DD
  const endStr = end.toISOString().split('T')[0];

  console.log(`[AttestationService] Generating attestation for ${startStr} to ${endStr}`);

  // Get NAV snapshots for the period
  const snapshots = await db
    .select()
    .from(navSnapshots)
    .where(and(
      gte(navSnapshots.date, startStr),
      lte(navSnapshots.date, endStr)
    ))
    .orderBy(navSnapshots.date);

  // Find opening NAV (first closing snapshot before/at start, or first opening snapshot)
  const openingSnapshots = await db
    .select()
    .from(navSnapshots)
    .where(lte(navSnapshots.date, startStr))
    .orderBy(desc(navSnapshots.date))
    .limit(5);

  // Find closing NAV (last closing snapshot in period)
  const closingSnapshots = await db
    .select()
    .from(navSnapshots)
    .where(and(
      lte(navSnapshots.date, endStr),
      eq(navSnapshots.snapshotType, 'closing')
    ))
    .orderBy(desc(navSnapshots.date))
    .limit(1);

  // Get NAV values (fallback to 0 if no snapshots)
  const navStart = openingSnapshots.length > 0
    ? parseFloat(openingSnapshots[0].nav as any) || 0
    : 0;
  const navEnd = closingSnapshots.length > 0
    ? parseFloat(closingSnapshots[0].nav as any) || 0
    : navStart;

  // Calculate return
  const returnPercent = navStart > 0 ? ((navEnd - navStart) / navStart) * 100 : 0;
  const returnBps = Math.round(returnPercent * 100); // Convert to basis points
  const pnlUsd = navEnd - navStart;

  // Get trades for the period from paperTrades
  const trades = await db
    .select()
    .from(paperTrades)
    .where(and(
      gte(paperTrades.createdAt, start),
      lte(paperTrades.createdAt, end)
    ));

  // Calculate trade metrics
  const tradeCount = trades.length;
  const winCount = trades.filter(t => {
    const realized = parseFloat(t.realizedPnl as any) || 0;
    return realized > 0;
  }).length;
  const lossCount = trades.filter(t => {
    const realized = parseFloat(t.realizedPnl as any) || 0;
    return realized < 0;
  }).length;
  const winRate = tradeCount > 0 ? (winCount / tradeCount) * 100 : 0;

  // Calculate exposure metrics
  // Implied notional = sum of (contracts * strike * 100) for options
  // Real turnover = sum of premiums collected
  let impliedNotional = 0;
  let realTurnover = 0;

  for (const trade of trades) {
    const contracts = trade.contracts || 0;
    const entryPremium = parseFloat(trade.entryPremiumTotal as any) || 0;

    // Calculate implied notional from strikes
    const leg1Strike = parseFloat(trade.leg1Strike as any) || 0;
    const leg2Strike = parseFloat(trade.leg2Strike as any) || 0;

    if (leg1Strike > 0) {
      impliedNotional += Math.abs(contracts) * leg1Strike * 100;
    }
    if (leg2Strike > 0) {
      impliedNotional += Math.abs(contracts) * leg2Strike * 100;
    }

    // Real turnover = premium collected
    realTurnover += entryPremium;
  }

  // Create detailed trade data for hashing
  const detailsObject = {
    period: { start: startStr, end: endStr },
    nav: { start: navStart, end: navEnd },
    trades: trades.map(t => ({
      id: t.id,
      symbol: t.symbol,
      contracts: t.contracts,
      strategy: t.strategy,
      entryPremium: t.entryPremiumTotal,
      exitPrice: t.exitPrice,
      realizedPnl: t.realizedPnl,
      status: t.status,
    })),
  };

  // Generate SHA256 hash of detailed data
  const detailsJson = JSON.stringify(detailsObject, null, 0);
  const detailsHash = createHash('sha256').update(detailsJson).digest('hex');

  const attestationData: AttestationData = {
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    periodLabel: formatPeriodLabel(start, end),
    navStart,
    navEnd,
    returnBps,
    returnPercent,
    pnlUsd,
    tradeCount,
    winCount,
    lossCount,
    winRate,
    impliedNotional,
    realTurnover,
    detailsHash: `0x${detailsHash}`,
  };

  console.log('[AttestationService] Generated attestation:', {
    period: attestationData.periodLabel,
    navStart,
    navEnd,
    returnPercent: returnPercent.toFixed(2) + '%',
    trades: tradeCount,
  });

  return attestationData;
}

/**
 * Get raw details for a given hash (for verification)
 */
export async function getRawDetails(hash: string): Promise<object | null> {
  // This would require storing the raw details somewhere
  // For now, return null - can be implemented later with a details cache
  console.log(`[AttestationService] Raw details requested for hash: ${hash}`);
  return null;
}
