/**
 * Step 4: Position Sizing
 *
 * Two-Layer Framework:
 * - Layer 1 (Capacity): Max contracts = (NAV - Buffer) / Marginal_Rate
 * - Layer 2 (Kelly): Optimal contracts = Kelly% × Max_Contracts
 *
 * Risk profiles adjust the Kelly-optimal position:
 * - CONSERVATIVE: 50% of Kelly
 * - BALANCED: 100% of Kelly
 * - AGGRESSIVE: 150% of Kelly
 *
 * Also validates against margin requirements and buying power
 */

import { StrikeSelection } from './step3';
import type { StepReasoning, StepMetric } from '../../shared/types/engineLog';
import {
  calculateCapacity,
  calculateKelly,
  calculateOptimalContracts,
  DEFAULT_POSITION_CONFIG,
  type PositionSizingConfig,
} from './positionSizingConfig';

export type RiskProfile = 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';

// Max loss percentage by risk profile (kept for backward compatibility)
const MAX_LOSS_PCT: Record<RiskProfile, number> = {
  CONSERVATIVE: 0.01,  // 1% max loss
  BALANCED: 0.02,      // 2% max loss
  AGGRESSIVE: 0.03,    // 3% max loss
};

export interface PositionSize {
  // Core outputs
  contracts: number;
  optimalContracts: number;
  maxContracts: number;

  // Layer 1: Capacity
  capacity: {
    navHKD: number;
    bufferHKD: number;
    availableCapital: number;
    marginalRateHKD: number;
    maxContracts: number;
  };

  // Layer 2: Kelly
  kelly: {
    winRate: number;
    lossRate: number;
    payoffRatio: number;
    kellyPercent: number;
    creditPerContract: number;
    maxLossAtStop: number;
  };

  // Existing fields (kept for backwards compatibility)
  marginPerContract: number;
  totalMarginRequired: number;
  buyingPowerUsed: number;
  buyingPowerRemaining: number;
  maxLossPerContract: number;
  maxLossTotal: number;
  maxLossAllowed: number;
  reasoning: string;
  stepReasoning?: StepReasoning[];
  stepMetrics?: StepMetric[];
}

export interface AccountInfo {
  cashBalance: number;       // Actual cash in account
  buyingPower: number;       // Leveraged buying power (e.g., 6.66x for portfolio margin)
  netLiquidation?: number;   // Net liquidation value (total account value) - defaults to buyingPower if not provided
  currentPositions: number;  // Number of open positions
}

/**
 * Calculate margin requirement per contract (simplified portfolio margin)
 * Portfolio margin rules:
 * - Single naked option: ~18% of notional
 * - Strangle (offsetting): ~12% of notional
 */
function calculateMarginPerContract(strikeSelection: StrikeSelection): number {
  const isStrangle = strikeSelection.putStrike && strikeSelection.callStrike;
  const marginRate = isStrangle ? 0.12 : 0.18;

  let notionalValue = 0;

  if (strikeSelection.putStrike) {
    notionalValue += strikeSelection.putStrike.strike * 100;
  }
  if (strikeSelection.callStrike) {
    notionalValue += strikeSelection.callStrike.strike * 100;
  }

  // For strangles, use average since they offset
  if (isStrangle) {
    notionalValue = notionalValue / 2;
  }

  return notionalValue * marginRate;
}

/**
 * Main function: Calculate optimal position size using two-layer framework
 * @param strikeSelection - Selected strikes from Step 3
 * @param accountInfo - Current account information
 * @param riskProfile - Risk profile to use
 * @param stopMultiplier - Stop loss multiplier (default 3x)
 * @param config - Position sizing configuration
 * @returns Position sizing decision
 */
export async function calculatePositionSize(
  strikeSelection: StrikeSelection,
  accountInfo: AccountInfo,
  riskProfile: RiskProfile = 'BALANCED',
  stopMultiplier: number = 3,
  config: PositionSizingConfig = DEFAULT_POSITION_CONFIG
): Promise<PositionSize> {
  // Get NAV in HKD (convert from USD if needed)
  const navUSD = accountInfo.netLiquidation || accountInfo.buyingPower;
  const navHKD = navUSD * config.fxRate;

  // Calculate average delta from selected strikes
  const putDelta = Math.abs(strikeSelection.putStrike?.delta ?? 0);
  const callDelta = Math.abs(strikeSelection.callStrike?.delta ?? 0);
  const avgDelta = strikeSelection.putStrike && strikeSelection.callStrike
    ? (putDelta + callDelta) / 2
    : putDelta || callDelta;

  // Calculate credit per contract
  const putBid = strikeSelection.putStrike?.bid ?? 0;
  const callBid = strikeSelection.callStrike?.bid ?? 0;
  const creditPerShare = putBid + callBid;
  const creditPerContract = creditPerShare * 100;

  // Use new two-layer calculation
  const sizing = calculateOptimalContracts(
    navHKD,
    avgDelta,
    creditPerContract,
    { ...config, stopMultiplier }
  );

  // Apply risk profile adjustment
  const profileMultipliers: Record<RiskProfile, number> = {
    CONSERVATIVE: 0.5,
    BALANCED: 1.0,
    AGGRESSIVE: 1.5,
  };
  const profiledContracts = Math.floor(sizing.optimalContracts * profileMultipliers[riskProfile]);
  const contracts = Math.min(profiledContracts, sizing.maxContracts);

  // Calculate margin values for backward compatibility
  const marginPerContract = calculateMarginPerContract(strikeSelection);
  const totalMarginRequired = contracts * marginPerContract;
  const buyingPowerUsed = totalMarginRequired;
  const buyingPowerRemaining = accountInfo.buyingPower - buyingPowerUsed;
  const maxLossPerContract = sizing.maxLossAtStop;
  const maxLossTotal = contracts * maxLossPerContract;
  const maxLossAllowed = navUSD * MAX_LOSS_PCT[riskProfile];

  // Build reasoning
  const reasoning = `Capacity: ${sizing.maxContracts} max | Kelly: ${(sizing.kellyPercent * 100).toFixed(0)}% → ${sizing.kellyContracts} | Final: ${contracts} contracts`;

  // Build enhanced step reasoning
  const stepReasoning: StepReasoning[] = [
    {
      question: 'Layer 1: How many contracts can I afford?',
      answer: `NAV ${navHKD.toLocaleString()} HKD - 50K buffer = ${sizing.availableCapital.toLocaleString()} HKD → ${sizing.maxContracts} contracts (@ 33K each)`
    },
    {
      question: 'Layer 2: What does Kelly say?',
      answer: `Win ${(sizing.winRate * 100).toFixed(0)}% - Loss ${((1-sizing.winRate) * 100).toFixed(0)}% ÷ Payoff ${sizing.payoffRatio.toFixed(2)} = ${(sizing.kellyPercent * 100).toFixed(0)}% of bankroll`
    },
    {
      question: 'Combined: How many contracts?',
      answer: `${(sizing.kellyPercent * 100).toFixed(0)}% × ${sizing.maxContracts} = ${sizing.kellyContracts} Kelly contracts → ${contracts} final (${riskProfile})`
    }
  ];

  const stepMetrics: StepMetric[] = [
    { label: 'Max Contracts', value: sizing.maxContracts, status: 'normal' },
    { label: 'Kelly %', value: `${(sizing.kellyPercent * 100).toFixed(0)}%`, status: 'normal' },
    { label: 'Win Rate', value: `${(sizing.winRate * 100).toFixed(0)}%`, status: sizing.winRate >= 0.8 ? 'normal' : 'normal' },
    { label: 'Optimal', value: sizing.optimalContracts, status: 'normal' },
    { label: 'Final', value: contracts, status: contracts > 0 ? 'normal' : 'critical' },
    { label: 'Max Loss', value: `$${maxLossTotal.toFixed(0)}`, status: maxLossTotal > maxLossAllowed ? 'warning' : 'normal' },
  ];

  return {
    contracts,
    optimalContracts: sizing.optimalContracts,
    maxContracts: sizing.maxContracts,
    capacity: {
      navHKD,
      bufferHKD: config.bufferHKD,
      availableCapital: sizing.availableCapital,
      marginalRateHKD: config.marginalRateHKD,
      maxContracts: sizing.maxContracts,
    },
    kelly: {
      winRate: sizing.winRate,
      lossRate: 1 - sizing.winRate,
      payoffRatio: sizing.payoffRatio,
      kellyPercent: sizing.kellyPercent,
      creditPerContract,
      maxLossAtStop: sizing.maxLossAtStop,
    },
    marginPerContract: Number(marginPerContract.toFixed(2)),
    totalMarginRequired: Number(totalMarginRequired.toFixed(2)),
    buyingPowerUsed: Number(buyingPowerUsed.toFixed(2)),
    buyingPowerRemaining: Number(buyingPowerRemaining.toFixed(2)),
    maxLossPerContract: Number(maxLossPerContract.toFixed(2)),
    maxLossTotal: Number(maxLossTotal.toFixed(2)),
    maxLossAllowed: Number(maxLossAllowed.toFixed(2)),
    reasoning,
    stepReasoning,
    stepMetrics,
  };
}

/**
 * Test function to validate Step 4 logic with two-layer framework
 */
export async function testStep4(): Promise<void> {
  console.log('Testing Step 4: Position Sizing (Two-Layer Framework)\n');

  // Mock account info
  const accountInfo: AccountInfo = {
    cashBalance: 150000,
    buyingPower: 500000,
    netLiquidation: 150000,
    currentPositions: 0
  };

  console.log('Account Information:');
  console.log(`  Net Liquidation: $${accountInfo.netLiquidation?.toLocaleString()}`);
  console.log(`  NAV in HKD: ${((accountInfo.netLiquidation || 0) * 7.8).toLocaleString()} HKD`);
  console.log(`  Buying Power: $${accountInfo.buyingPower.toLocaleString()}\n`);

  // Mock strike selection with premium
  const strikeSelection = {
    putStrike: { strike: 585, expiration: new Date(), delta: -0.15, bid: 0.80, ask: 0.90 },
    callStrike: { strike: 600, expiration: new Date(), delta: 0.15, bid: 0.75, ask: 0.85 },
    expectedPremium: 155, // Combined premium
    marginRequired: 7000,
    reasoning: 'STRANGLE'
  };

  console.log('Strike Selection:');
  console.log(`  PUT: $${strikeSelection.putStrike.strike} (delta: ${strikeSelection.putStrike.delta})`);
  console.log(`  CALL: $${strikeSelection.callStrike.strike} (delta: ${strikeSelection.callStrike.delta})`);
  console.log(`  Avg Delta: 0.15`);
  console.log(`  Premium: $${(strikeSelection.putStrike.bid + strikeSelection.callStrike.bid).toFixed(2)}/share\n`);

  const riskProfiles: RiskProfile[] = ['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE'];
  const stopMultiplier = 3;

  for (const profile of riskProfiles) {
    const sizing = await calculatePositionSize(
      strikeSelection as any,
      accountInfo,
      profile,
      stopMultiplier
    );

    console.log(`${profile}:`);
    console.log(`  Capacity: ${sizing.capacity.maxContracts} max contracts`);
    console.log(`  Kelly: ${(sizing.kelly.kellyPercent * 100).toFixed(0)}% → ${sizing.optimalContracts} optimal`);
    console.log(`  Final: ${sizing.contracts} contracts`);
    console.log(`  Win Rate: ${(sizing.kelly.winRate * 100).toFixed(0)}%`);
    console.log(`  Max Loss: $${sizing.maxLossTotal.toFixed(0)}`);
    console.log('');
  }
}

// Test function can be called from a separate test file
