/**
 * Step 4: Position Sizing
 * Determines how many contracts to trade based on buying power and margin requirements
 *
 * Rules:
 * - 100% buying power utilization maximum
 * - Account for portfolio margin (strangles get ~12% margin, single side ~18%)
 * - Hard limit: 5 contracts maximum
 */

import { StrikeSelection } from './step3';
import type { StepReasoning, StepMetric } from '../../shared/types/engineLog';

export type RiskProfile = 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';

export interface PositionSize {
  contracts: number;
  marginPerContract: number;
  totalMarginRequired: number;
  buyingPowerUsed: number;
  buyingPowerRemaining: number;
  reasoning: string;
  // Enhanced logging
  stepReasoning?: StepReasoning[];
  stepMetrics?: StepMetric[];
}

export interface AccountInfo {
  cashBalance: number;      // Actual cash in account
  buyingPower: number;       // Leveraged buying power (e.g., 6.66x for portfolio margin)
  currentPositions: number;  // Number of open positions
}

/**
 * Risk profile configurations
 * These determine position sizing limits and aggressiveness
 */
const RISK_PROFILES = {
  CONSERVATIVE: {
    maxContracts: 2,
    buyingPowerUtilization: 0.50, // Use 50% of available buying power
    description: 'Low risk, maximum 2 contracts, 50% BP usage'
  },
  BALANCED: {
    maxContracts: 3,
    buyingPowerUtilization: 0.70, // Use 70% of available buying power
    description: 'Moderate risk, maximum 3 contracts, 70% BP usage'
  },
  AGGRESSIVE: {
    maxContracts: 5,
    buyingPowerUtilization: 1.00, // Use 100% of available buying power
    description: 'High risk, maximum 5 contracts, 100% BP usage'
  }
};

/**
 * Calculate margin requirement per contract
 * Portfolio margin rules (simplified):
 * - Single naked option: ~18% of notional
 * - Strangle (offsetting): ~12% of notional
 * @param strikeSelection - Selected strikes from Step 3
 * @returns Margin required per contract
 */
function calculateMarginPerContract(strikeSelection: StrikeSelection): number {
  const isStrangle = strikeSelection.putStrike && strikeSelection.callStrike;
  const marginRate = isStrangle ? 0.12 : 0.18;

  let notionalValue = 0;

  // Calculate based on strike prices
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
 * Calculate maximum contracts based on buying power
 * @param buyingPower - Available buying power
 * @param marginPerContract - Margin required per contract
 * @param riskProfile - Risk profile to apply
 * @returns Maximum number of contracts
 */
function calculateMaxContracts(
  buyingPower: number,
  marginPerContract: number,
  riskProfile: RiskProfile
): number {
  const profile = RISK_PROFILES[riskProfile];

  // Apply buying power utilization limit
  const availableBuyingPower = buyingPower * profile.buyingPowerUtilization;

  // Calculate theoretical maximum
  const theoreticalMax = Math.floor(availableBuyingPower / marginPerContract);

  // Apply hard limit from risk profile
  return Math.min(theoreticalMax, profile.maxContracts);
}

/**
 * Main function: Calculate optimal position size
 * @param strikeSelection - Selected strikes from Step 3
 * @param accountInfo - Current account information
 * @param riskProfile - Risk profile to use
 * @returns Position sizing decision
 */
export async function calculatePositionSize(
  strikeSelection: StrikeSelection,
  accountInfo: AccountInfo,
  riskProfile: RiskProfile = 'BALANCED'
): Promise<PositionSize> {
  // Calculate margin per contract
  const marginPerContract = calculateMarginPerContract(strikeSelection);

  // Calculate maximum contracts
  const maxContracts = calculateMaxContracts(
    accountInfo.buyingPower,
    marginPerContract,
    riskProfile
  );

  // Ensure we have at least 1 contract if we have enough margin
  const contracts = marginPerContract <= accountInfo.buyingPower ? Math.max(1, maxContracts) : 0;

  // Calculate totals
  const totalMarginRequired = contracts * marginPerContract;
  const buyingPowerUsed = totalMarginRequired;
  const buyingPowerRemaining = accountInfo.buyingPower - buyingPowerUsed;

  // Build reasoning
  const profile = RISK_PROFILES[riskProfile];
  const isStrangle = strikeSelection.putStrike && strikeSelection.callStrike;
  const marginRate = isStrangle ? 12 : 18;

  let reasoning = `Risk Profile: ${riskProfile} (${profile.description}). `;
  reasoning += `Margin rate: ${marginRate}% (${isStrangle ? 'strangle offset' : 'single naked option'}). `;
  reasoning += `Margin per contract: $${marginPerContract.toFixed(2)}. `;
  reasoning += `Buying power available: $${accountInfo.buyingPower.toFixed(2)} at ${(profile.buyingPowerUtilization * 100)}% utilization. `;
  reasoning += `Max contracts: ${maxContracts} (limited by ${maxContracts === profile.maxContracts ? 'risk profile' : 'buying power'}). `;

  if (contracts === 0) {
    reasoning += 'WARNING: Insufficient buying power for even 1 contract.';
  }

  // Build enhanced reasoning Q&A
  const utilizationPct = (profile.buyingPowerUtilization * 100).toFixed(0);
  const usedPct = ((buyingPowerUsed / accountInfo.buyingPower) * 100).toFixed(1);
  const limitedBy = maxContracts === profile.maxContracts ? 'risk profile limit' : 'available buying power';

  const stepReasoning: StepReasoning[] = [
    {
      question: 'What risk profile?',
      answer: `${riskProfile} (max ${profile.maxContracts} contracts, ${utilizationPct}% BP)`
    },
    {
      question: 'Margin calculation?',
      answer: `${marginRate}% of $${(strikeSelection.putStrike?.strike || strikeSelection.callStrike?.strike || 0) * 100} notional = $${marginPerContract.toFixed(0)}/contract`
    },
    {
      question: 'How many contracts?',
      answer: contracts > 0
        ? `${contracts} contracts (limited by ${limitedBy})`
        : 'ZERO - insufficient buying power'
    },
    {
      question: 'Buying power usage?',
      answer: `$${buyingPowerUsed.toFixed(0)} of $${accountInfo.buyingPower.toFixed(0)} (${usedPct}%)`
    }
  ];

  // Build enhanced metrics
  const stepMetrics: StepMetric[] = [
    {
      label: 'Contracts',
      value: contracts,
      status: contracts > 0 ? 'normal' : 'critical'
    },
    {
      label: 'Margin/Contract',
      value: `$${marginPerContract.toFixed(0)}`,
      status: 'normal'
    },
    {
      label: 'Total Margin',
      value: `$${totalMarginRequired.toFixed(0)}`,
      status: 'normal'
    },
    {
      label: 'BP Used',
      value: `${usedPct}%`,
      status: parseFloat(usedPct) > 80 ? 'warning' : 'normal'
    },
    {
      label: 'BP Remaining',
      value: `$${buyingPowerRemaining.toFixed(0)}`,
      status: buyingPowerRemaining < marginPerContract ? 'warning' : 'normal'
    },
    {
      label: 'Risk Profile',
      value: riskProfile,
      status: riskProfile === 'AGGRESSIVE' ? 'warning' : 'normal'
    }
  ];

  return {
    contracts,
    marginPerContract: Number(marginPerContract.toFixed(2)),
    totalMarginRequired: Number(totalMarginRequired.toFixed(2)),
    buyingPowerUsed: Number(buyingPowerUsed.toFixed(2)),
    buyingPowerRemaining: Number(buyingPowerRemaining.toFixed(2)),
    reasoning,
    stepReasoning,
    stepMetrics
  };
}

/**
 * Test function to validate Step 4 logic
 */
export async function testStep4(): Promise<void> {
  console.log('Testing Step 4: Position Sizing\n');

  // Mock account info (based on user's example: $100K cash, $666K buying power)
  const accountInfo: AccountInfo = {
    cashBalance: 100000,
    buyingPower: 666000,
    currentPositions: 0
  };

  console.log('Account Information:');
  console.log(`  Cash Balance: $${accountInfo.cashBalance.toLocaleString()}`);
  console.log(`  Buying Power: $${accountInfo.buyingPower.toLocaleString()}`);
  console.log(`  Leverage: ${(accountInfo.buyingPower / accountInfo.cashBalance).toFixed(2)}x\n`);

  // Mock strike selections
  const scenarios = [
    {
      name: 'PUT Only',
      selection: {
        putStrike: { strike: 445, expiration: new Date(), delta: 0.18, bid: 0.50, ask: 0.55 },
        expectedPremium: 52.50,
        marginRequired: 8010,
        reasoning: 'Single PUT'
      }
    },
    {
      name: 'CALL Only',
      selection: {
        callStrike: { strike: 455, expiration: new Date(), delta: 0.18, bid: 0.48, ask: 0.52 },
        expectedPremium: 50.00,
        marginRequired: 8190,
        reasoning: 'Single CALL'
      }
    },
    {
      name: 'STRANGLE',
      selection: {
        putStrike: { strike: 445, expiration: new Date(), delta: 0.18, bid: 0.50, ask: 0.55 },
        callStrike: { strike: 455, expiration: new Date(), delta: 0.18, bid: 0.48, ask: 0.52 },
        expectedPremium: 102.50,
        marginRequired: 5400,
        reasoning: 'STRANGLE (both sides)'
      }
    }
  ];

  const riskProfiles: RiskProfile[] = ['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE'];

  for (const scenario of scenarios) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Scenario: ${scenario.name}`);
    console.log(`${'='.repeat(60)}\n`);

    for (const profile of riskProfiles) {
      const sizing = await calculatePositionSize(
        scenario.selection as StrikeSelection,
        accountInfo,
        profile
      );

      console.log(`${profile}:`);
      console.log(`  Contracts: ${sizing.contracts}`);
      console.log(`  Margin/Contract: $${sizing.marginPerContract.toLocaleString()}`);
      console.log(`  Total Margin: $${sizing.totalMarginRequired.toLocaleString()}`);
      console.log(`  BP Remaining: $${sizing.buyingPowerRemaining.toLocaleString()}`);
      console.log('');
    }
  }

  // Test edge case: Insufficient buying power
  console.log(`\n${'='.repeat(60)}`);
  console.log('Edge Case: Insufficient Buying Power');
  console.log(`${'='.repeat(60)}\n`);

  const poorAccount: AccountInfo = {
    cashBalance: 1000,
    buyingPower: 2000,
    currentPositions: 0
  };

  const sizing = await calculatePositionSize(
    scenarios[2].selection as StrikeSelection,
    poorAccount,
    'AGGRESSIVE'
  );

  console.log(`Result: ${sizing.contracts} contracts`);
  console.log(`Reasoning: ${sizing.reasoning}`);
}

// Test function can be called from a separate test file