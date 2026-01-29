/**
 * Position Sizing Configuration
 *
 * Two-Layer Framework:
 * - Layer 1 (Capacity): Max contracts based on margin
 * - Layer 2 (Kelly): Optimal contracts based on edge
 */

export interface PositionSizingConfig {
  bufferHKD: number;        // Base NAV cushion (default 50K)
  marginalRateHKD: number;  // Per-contract margin requirement (default 33K)
  fxRate: number;           // USD to HKD conversion rate (default 7.8)
  stopMultiplier: number;   // Default stop level (default 3)
}

export const DEFAULT_POSITION_CONFIG: PositionSizingConfig = {
  bufferHKD: 50000,
  marginalRateHKD: 33000,
  fxRate: 7.8,
  stopMultiplier: 3,
};

/**
 * Layer 1: Calculate maximum contracts based on margin capacity
 *
 * Formula: Max_Contracts = floor((NAV - Buffer) / Marginal_Rate)
 *
 * @param navHKD - Net Asset Value in HKD
 * @param config - Position sizing configuration
 * @returns Maximum contracts allowed by margin
 */
export function calculateCapacity(
  navHKD: number,
  config: PositionSizingConfig = DEFAULT_POSITION_CONFIG
): { maxContracts: number; availableCapital: number } {
  const availableCapital = Math.max(0, navHKD - config.bufferHKD);
  const maxContracts = Math.floor(availableCapital / config.marginalRateHKD);

  return { maxContracts, availableCapital };
}

/**
 * Layer 2: Calculate Kelly-optimal contracts
 *
 * Formula: Kelly% = Win_Rate - (Loss_Rate / Payoff_Ratio)
 * Where:
 *   Win_Rate = 1 - Delta
 *   Loss_Rate = Delta
 *   Payoff_Ratio = Credit / Max_Loss_At_Stop
 *
 * @param avgDelta - Average delta of the position (e.g., 0.15)
 * @param creditPerContract - Premium collected per contract in USD
 * @param stopMultiplier - Stop loss multiplier (e.g., 3 = 3x premium)
 * @returns Kelly percentage and derived values
 */
export function calculateKelly(
  avgDelta: number,
  creditPerContract: number,
  stopMultiplier: number = 3
): {
  kellyPercent: number;
  winRate: number;
  lossRate: number;
  payoffRatio: number;
  maxLossAtStop: number;
} {
  const winRate = 1 - avgDelta;
  const lossRate = avgDelta;

  // Max loss at stop = premium × (stopMultiplier - 1)
  // We collect credit, but must buy back at stopMultiplier × credit
  const maxLossAtStop = creditPerContract * (stopMultiplier - 1);

  // Payoff ratio = credit / max loss at stop
  const payoffRatio = maxLossAtStop > 0 ? creditPerContract / maxLossAtStop : 0;

  // Kelly = W - (L / R)
  const kellyPercent = Math.max(0, winRate - (lossRate / payoffRatio));

  return { kellyPercent, winRate, lossRate, payoffRatio, maxLossAtStop };
}

/**
 * Combined: Calculate optimal contracts using both layers
 *
 * Formula: Optimal_Contracts = floor(Kelly% × Max_Contracts)
 */
export function calculateOptimalContracts(
  navHKD: number,
  avgDelta: number,
  creditPerContract: number,
  config: PositionSizingConfig = DEFAULT_POSITION_CONFIG
): {
  optimalContracts: number;
  kellyContracts: number;
  maxContracts: number;
  kellyPercent: number;
  winRate: number;
  payoffRatio: number;
  availableCapital: number;
  maxLossAtStop: number;
} {
  const { maxContracts, availableCapital } = calculateCapacity(navHKD, config);
  const { kellyPercent, winRate, payoffRatio, maxLossAtStop } = calculateKelly(
    avgDelta,
    creditPerContract,
    config.stopMultiplier
  );

  const kellyContracts = Math.floor(kellyPercent * maxContracts);
  // Recommend the Kelly-optimal number but cap at max
  const optimalContracts = Math.min(kellyContracts, maxContracts);

  return {
    optimalContracts,
    kellyContracts,
    maxContracts,
    kellyPercent,
    winRate,
    payoffRatio,
    availableCapital,
    maxLossAtStop,
  };
}
