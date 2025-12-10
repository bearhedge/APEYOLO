/**
 * Solana Utilities
 *
 * Constants, helpers, and configuration for Solana integration.
 */

import { Connection, clusterApiUrl, PublicKey } from '@solana/web3.js';
import type { SolanaCluster, OnChainAttestation, ProfileSummary, AttestationData } from '@shared/types/defi';

// ============================================
// Constants
// ============================================

// Program ID (to be deployed - placeholder for now)
export const ATTESTATION_PROGRAM_ID = new PublicKey(
  '11111111111111111111111111111111' // Placeholder - will be updated after deployment
);

// Cluster configuration
export const DEFAULT_CLUSTER: SolanaCluster = 'devnet';

// RPC endpoints
export const RPC_ENDPOINTS: Record<SolanaCluster, string> = {
  'devnet': clusterApiUrl('devnet'),
  'mainnet-beta': clusterApiUrl('mainnet-beta'),
};

// ============================================
// Connection Factory
// ============================================

/**
 * Create a Solana connection for the specified cluster
 */
export function createConnection(cluster: SolanaCluster = DEFAULT_CLUSTER): Connection {
  return new Connection(RPC_ENDPOINTS[cluster], 'confirmed');
}

// ============================================
// Address Helpers
// ============================================

/**
 * Truncate a public key for display
 * e.g., "8F3a...7b2c"
 */
export function truncateAddress(address: string | PublicKey, chars: number = 4): string {
  const str = typeof address === 'string' ? address : address.toBase58();
  if (str.length <= chars * 2 + 3) return str;
  return `${str.slice(0, chars)}...${str.slice(-chars)}`;
}

/**
 * Get Solana explorer URL for a transaction or address
 */
export function getExplorerUrl(
  value: string,
  type: 'tx' | 'address' | 'account' = 'tx',
  cluster: SolanaCluster = DEFAULT_CLUSTER
): string {
  const base = 'https://explorer.solana.com';
  const clusterParam = cluster === 'mainnet-beta' ? '' : `?cluster=${cluster}`;
  return `${base}/${type}/${value}${clusterParam}`;
}

// ============================================
// Profile Computation
// ============================================

/**
 * Compute profile summary from attestations
 * All calculations done client-side from on-chain data
 */
export function computeProfileSummary(attestations: OnChainAttestation[]): ProfileSummary {
  if (attestations.length === 0) {
    return {
      totalReturn: 0,
      winRate: 0,
      sharpeRatio: 0,
      maxDrawdown: 0,
      verifiedPeriods: 0,
      totalTrades: 0,
      cumulativeNotional: 0,
      cumulativeTurnover: 0,
      firstAttestation: null,
      lastAttestation: null,
    };
  }

  // Sort by period start
  const sorted = [...attestations].sort(
    (a, b) => new Date(a.data.periodStart).getTime() - new Date(b.data.periodStart).getTime()
  );

  // Aggregate metrics
  let totalTrades = 0;
  let totalWins = 0;
  let cumulativeNotional = 0;
  let cumulativeTurnover = 0;

  // For Sharpe ratio calculation
  const returns: number[] = [];
  let cumulativeReturn = 1;
  let maxCumulativeReturn = 1;
  let maxDrawdown = 0;

  for (const attestation of sorted) {
    const { data } = attestation;

    // Accumulate counts
    totalTrades += data.tradeCount;
    totalWins += data.winCount;
    cumulativeNotional += data.impliedNotional;
    cumulativeTurnover += data.realTurnover;

    // Track returns
    const periodReturn = data.returnPercent / 100; // Convert to decimal
    returns.push(periodReturn);

    // Update cumulative return
    cumulativeReturn *= (1 + periodReturn);

    // Track max drawdown
    if (cumulativeReturn > maxCumulativeReturn) {
      maxCumulativeReturn = cumulativeReturn;
    }
    const drawdown = (maxCumulativeReturn - cumulativeReturn) / maxCumulativeReturn;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  // Calculate total return percentage
  const totalReturn = (cumulativeReturn - 1) * 100;

  // Calculate win rate
  const winRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0;

  // Calculate Sharpe ratio (simplified - assumes risk-free rate of 0)
  // Using weekly returns annualized
  let sharpeRatio = 0;
  if (returns.length > 1) {
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    if (stdDev > 0) {
      // Annualize assuming weekly periods (52 periods/year)
      sharpeRatio = (avgReturn / stdDev) * Math.sqrt(52);
    }
  }

  return {
    totalReturn,
    winRate,
    sharpeRatio,
    maxDrawdown: maxDrawdown * 100, // Convert to percentage
    verifiedPeriods: attestations.length,
    totalTrades,
    cumulativeNotional,
    cumulativeTurnover,
    firstAttestation: sorted[0].data.periodStart,
    lastAttestation: sorted[sorted.length - 1].data.periodEnd,
  };
}

// ============================================
// Period Helpers
// ============================================

/**
 * Get the date range for "last week" (previous Mon-Sun)
 */
export function getLastWeekRange(): { start: Date; end: Date } {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 = Sunday

  // Get last Sunday
  const lastSunday = new Date(now);
  lastSunday.setDate(now.getDate() - dayOfWeek);
  lastSunday.setHours(23, 59, 59, 999);

  // Get last Monday (6 days before last Sunday)
  const lastMonday = new Date(lastSunday);
  lastMonday.setDate(lastSunday.getDate() - 6);
  lastMonday.setHours(0, 0, 0, 0);

  return { start: lastMonday, end: lastSunday };
}

/**
 * Get the date range for "last month" (previous calendar month)
 */
export function getLastMonthRange(): { start: Date; end: Date } {
  const now = new Date();

  // First day of last month
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  start.setHours(0, 0, 0, 0);

  // Last day of last month
  const end = new Date(now.getFullYear(), now.getMonth(), 0);
  end.setHours(23, 59, 59, 999);

  return { start, end };
}

/**
 * Get the date range for "month to date"
 */
export function getMTDRange(): { start: Date; end: Date } {
  const now = new Date();

  // First day of current month
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  start.setHours(0, 0, 0, 0);

  // Yesterday (or today if after market close)
  const end = new Date(now);
  end.setDate(end.getDate() - 1);
  end.setHours(23, 59, 59, 999);

  return { start, end };
}

/**
 * Format date range for display
 * e.g., "Dec 1-7, 2025"
 */
export function formatPeriodLabel(start: Date, end: Date): string {
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
// Formatting Helpers
// ============================================

/**
 * Format currency for display
 */
export function formatUSD(value: number, compact: boolean = false): string {
  if (compact && Math.abs(value) >= 1000) {
    return `$${(value / 1000).toFixed(0)}K`;
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Format percentage for display
 */
export function formatPercent(value: number, includeSign: boolean = false): string {
  const sign = includeSign && value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

/**
 * Format basis points for display
 */
export function formatBps(bps: number): string {
  return `${bps >= 0 ? '+' : ''}${bps}bps`;
}
