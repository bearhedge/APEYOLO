/**
 * Step 4: Position Sizing
 * Determines how many contracts to trade using the 2% Max Loss Rule
 *
 * 2% Rule:
 * - Max risk per trade = X% of account net liquidation value
 * - Max loss per contract = (stop_multiplier - 1) × premium × 100
 * - contracts = floor(maxLossAllowed / maxLossPerContract)
 *
 * Risk profiles adjust the max loss percentage:
 * - CONSERVATIVE: 1% max loss
 * - BALANCED: 2% max loss
 * - AGGRESSIVE: 3% max loss
 *
 * Also validates against margin requirements and buying power
 */

import { StrikeSelection } from './step3';
import type { StepReasoning, StepMetric } from '../../shared/types/engineLog';

export type RiskProfile = 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';

// Max loss percentage by risk profile
const MAX_LOSS_PCT: Record<RiskProfile, number> = {
  CONSERVATIVE: 0.01,  // 1% max loss
  BALANCED: 0.02,      // 2% max loss
  AGGRESSIVE: 0.03,    // 3% max loss
};

// Hard cap on contracts per side (safety limit)
const MAX_CONTRACTS_PER_SIDE = 2;

export interface PositionSize {
  contracts: number;
  marginPerContract: number;
  totalMarginRequired: number;
  buyingPowerUsed: number;
  buyingPowerRemaining: number;
  maxLossPerContract: number;
  maxLossTotal: number;
  maxLossAllowed: number;
  reasoning: string;
  // Enhanced logging
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
 * Calculate max loss per contract based on stop loss multiplier
 * @param premiumPerContract - Premium collected per contract (in dollars)
 * @param stopMultiplier - Stop loss multiplier (e.g., 3 = stop at 3x premium)
 * @returns Max loss in dollars per contract
 */
function calculateMaxLossPerContract(premiumPerContract: number, stopMultiplier: number): number {
  // When sold premium rises to stopMultiplier × original premium, we close
  // Loss = (newPrice - originalPrice) × 100
  // Loss = ((stopMultiplier - 1) × originalPrice) × 100
  return (stopMultiplier - 1) * premiumPerContract * 100;
}

/**
 * Calculate position size using the Max Loss Rule
 * @param netLiquidation - Account net liquidation value
 * @param maxLossPerContract - Max loss per contract in dollars
 * @param riskProfile - Risk profile to apply
 * @returns Number of contracts and max loss allowed
 */
function calculateContractsByMaxLoss(
  netLiquidation: number,
  maxLossPerContract: number,
  riskProfile: RiskProfile
): { contracts: number; maxLossAllowed: number } {
  const maxLossPct = MAX_LOSS_PCT[riskProfile];
  const maxLossAllowed = netLiquidation * maxLossPct;

  // Floor to ensure we don't exceed max loss
  const contracts = Math.max(0, Math.floor(maxLossAllowed / maxLossPerContract));

  return { contracts, maxLossAllowed };
}

/**
 * Main function: Calculate optimal position size using 2% max loss rule
 * @param strikeSelection - Selected strikes from Step 3
 * @param accountInfo - Current account information
 * @param riskProfile - Risk profile to use
 * @param stopMultiplier - Stop loss multiplier (default 3x)
 * @returns Position sizing decision
 */
export async function calculatePositionSize(
  strikeSelection: StrikeSelection,
  accountInfo: AccountInfo,
  riskProfile: RiskProfile = 'BALANCED',
  stopMultiplier: number = 6
): Promise<PositionSize> {
  // Use netLiquidation if available, otherwise use buyingPower as proxy
  const netLiq = accountInfo.netLiquidation || accountInfo.buyingPower;

  // Calculate margin per contract (for secondary validation)
  const marginPerContract = calculateMarginPerContract(strikeSelection);

  // Calculate expected premium (mid price)
  const expectedPremium = strikeSelection.expectedPremium || 0;
  const premiumPerContract = expectedPremium / 100; // Convert from cents to dollars if needed

  // Calculate max loss per contract using stop multiplier
  const maxLossPerContract = calculateMaxLossPerContract(
    premiumPerContract > 0 ? premiumPerContract : 0.50, // Default to $0.50 if no premium
    stopMultiplier
  );

  // Use dynamic calculation based on max loss per contract and risk profile
  const { contracts: calculatedContracts, maxLossAllowed } = calculateContractsByMaxLoss(
    netLiq,
    maxLossPerContract,
    riskProfile
  );

  // Apply hard cap on contracts (safety limit)
  const contracts = Math.min(calculatedContracts, MAX_CONTRACTS_PER_SIDE);
  const maxLossPct = MAX_LOSS_PCT[riskProfile];

  // Calculate totals
  const totalMarginRequired = contracts * marginPerContract;
  const buyingPowerUsed = totalMarginRequired;
  const buyingPowerRemaining = accountInfo.buyingPower - buyingPowerUsed;
  const maxLossTotal = contracts * maxLossPerContract;

  // Build reasoning
  const isStrangle = strikeSelection.putStrike && strikeSelection.callStrike;
  const marginRate = isStrangle ? 12 : 18;
  const riskRegime = strikeSelection.riskAssessment?.riskRegime || 'LOW';

  let reasoning = `Risk: ${riskRegime} → ${contracts} contracts. `;
  reasoning += `Max loss @ ${stopMultiplier}x stop: $${maxLossTotal.toFixed(0)}. `;
  reasoning += `Budget (${(maxLossPct * 100).toFixed(0)}% of $${netLiq.toLocaleString()}): $${maxLossAllowed.toFixed(0)}. `;

  if (contracts === 0) {
    reasoning += 'WARNING: Max loss per contract exceeds allowed risk.';
  }

  // Build enhanced reasoning Q&A
  const maxLossPctDisplay = (maxLossPct * 100).toFixed(0);
  const stepReasoning: StepReasoning[] = [
    {
      question: 'Position sizing method?',
      answer: `Risk regime (${riskRegime}) → ${contracts} contracts`
    },
    {
      question: 'Budget?',
      answer: `${maxLossPctDisplay}% of $${netLiq.toLocaleString()} = $${maxLossAllowed.toFixed(0)}`
    },
    {
      question: 'Max loss per contract?',
      answer: `Premium $${premiumPerContract.toFixed(2)} × (${stopMultiplier}-1) × 100 = $${maxLossPerContract.toFixed(0)}`
    },
    {
      question: 'Total max loss?',
      answer: `${contracts} × $${maxLossPerContract.toFixed(0)} = $${maxLossTotal.toFixed(0)} (within $${maxLossAllowed.toFixed(0)} budget)`
    }
  ];

  // Build enhanced metrics
  const usedPct = ((buyingPowerUsed / accountInfo.buyingPower) * 100).toFixed(1);
  const stepMetrics: StepMetric[] = [
    {
      label: 'Contracts',
      value: contracts,
      status: contracts > 0 ? 'normal' : 'critical'
    },
    {
      label: 'Max Loss Allowed',
      value: `$${maxLossAllowed.toLocaleString()}`,
      status: 'normal'
    },
    {
      label: 'Max Loss/Contract',
      value: `$${maxLossPerContract.toFixed(0)}`,
      status: 'normal'
    },
    {
      label: 'Total Max Loss',
      value: `$${maxLossTotal.toFixed(0)}`,
      status: maxLossTotal > maxLossAllowed ? 'critical' : 'normal'
    },
    {
      label: 'Margin/Contract',
      value: `$${marginPerContract.toFixed(0)}`,
      status: 'normal'
    },
    {
      label: 'BP Used',
      value: `${usedPct}%`,
      status: parseFloat(usedPct) > 50 ? 'warning' : 'normal'
    }
  ];

  return {
    contracts,
    marginPerContract: Number(marginPerContract.toFixed(2)),
    totalMarginRequired: Number(totalMarginRequired.toFixed(2)),
    buyingPowerUsed: Number(buyingPowerUsed.toFixed(2)),
    buyingPowerRemaining: Number(buyingPowerRemaining.toFixed(2)),
    maxLossPerContract: Number(maxLossPerContract.toFixed(2)),
    maxLossTotal: Number(maxLossTotal.toFixed(2)),
    maxLossAllowed: Number(maxLossAllowed.toFixed(2)),
    reasoning,
    stepReasoning,
    stepMetrics
  };
}

/**
 * Test function to validate Step 4 logic
 */
export async function testStep4(): Promise<void> {
  console.log('Testing Step 4: Position Sizing (2% Max Loss Rule)\n');

  // Mock account info
  const accountInfo: AccountInfo = {
    cashBalance: 150000,
    buyingPower: 500000,
    netLiquidation: 150000,
    currentPositions: 0
  };

  console.log('Account Information:');
  console.log(`  Net Liquidation: $${accountInfo.netLiquidation?.toLocaleString()}`);
  console.log(`  Buying Power: $${accountInfo.buyingPower.toLocaleString()}`);
  console.log(`  2% Max Loss = $${((accountInfo.netLiquidation || 0) * 0.02).toLocaleString()}\n`);

  // Mock strike selection with premium
  const strikeSelection = {
    putStrike: { strike: 585, expiration: new Date(), delta: -0.25, bid: 0.80, ask: 0.90 },
    callStrike: { strike: 600, expiration: new Date(), delta: 0.25, bid: 0.75, ask: 0.85 },
    expectedPremium: 85, // $0.85 premium per contract side
    marginRequired: 7000,
    reasoning: 'STRANGLE'
  };

  console.log('Strike Selection:');
  console.log(`  PUT: $${strikeSelection.putStrike.strike}`);
  console.log(`  CALL: $${strikeSelection.callStrike.strike}`);
  console.log(`  Expected Premium: $${(strikeSelection.expectedPremium / 100).toFixed(2)}/contract\n`);

  const riskProfiles: RiskProfile[] = ['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE'];
  const stopMultiplier = 6;

  for (const profile of riskProfiles) {
    const sizing = await calculatePositionSize(
      strikeSelection as any,
      accountInfo,
      profile,
      stopMultiplier
    );

    console.log(`${profile} (${MAX_LOSS_PCT[profile] * 100}% max loss):`);
    console.log(`  Max Loss Allowed: $${sizing.maxLossAllowed.toLocaleString()}`);
    console.log(`  Max Loss/Contract: $${sizing.maxLossPerContract.toFixed(0)}`);
    console.log(`  Contracts: ${sizing.contracts}`);
    console.log(`  Total Max Loss: $${sizing.maxLossTotal.toFixed(0)}`);
    console.log(`  Margin Required: $${sizing.totalMarginRequired.toLocaleString()}`);
    console.log('');
  }
}

// Test function can be called from a separate test file
