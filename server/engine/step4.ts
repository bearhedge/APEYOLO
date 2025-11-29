/**
 * Step 4: Position Sizing
 * Determines how many contracts to trade based on buying power and margin requirements
 *
 * Enhanced implementation with:
 * - Risk profile-based position sizing
 * - Portfolio margin calculations (strangles vs single side)
 * - Transparent reasoning chain
 * - Buying power utilization tracking
 *
 * Rules:
 * - Risk profile determines max contracts and BP utilization
 * - Portfolio margin: strangles ~12%, single side ~18%
 * - Hard limits per profile: CONSERVATIVE(2), BALANCED(3), AGGRESSIVE(5)
 */

import { StrikeSelection } from './step3';
import {
  createReasoning,
  StepReasoning,
  formatNumber,
  formatCurrency,
  formatPercent,
} from './reasoningLogger';

export type RiskProfile = 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';

export interface PositionSize {
  contracts: number;
  marginPerContract: number;
  totalMarginRequired: number;
  buyingPowerUsed: number;
  buyingPowerRemaining: number;
  reason: string;  // Short reason for display
  riskProfile: RiskProfile;
  // NEW: Transparent reasoning chain
  reasoning?: StepReasoning;
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
 *
 * This function builds a transparent reasoning chain showing:
 * 1. Risk profile selection and parameters
 * 2. Margin rate determination (strangle vs single side)
 * 3. Margin per contract calculation
 * 4. Max contracts calculation
 * 5. Buying power utilization
 *
 * @param strikeSelection - Selected strikes from Step 3
 * @param accountInfo - Current account information
 * @param riskProfile - Risk profile to use
 * @returns Position sizing decision with reasoning chain
 */
export async function calculatePositionSize(
  strikeSelection: StrikeSelection,
  accountInfo: AccountInfo,
  riskProfile: RiskProfile = 'BALANCED'
): Promise<PositionSize> {
  // Initialize reasoning builder
  const reasoning = createReasoning(4, 'Position Sizing');

  const profile = RISK_PROFILES[riskProfile];
  const isStrangle = strikeSelection.putStrike && strikeSelection.callStrike;
  const marginRate = isStrangle ? 0.12 : 0.18;

  // Step 4.1: Log inputs
  reasoning.addInput('riskProfile', riskProfile);
  reasoning.addInput('cashBalance', accountInfo.cashBalance);
  reasoning.addInput('buyingPower', accountInfo.buyingPower);
  reasoning.addInput('currentPositions', accountInfo.currentPositions);
  reasoning.addInput('isStrangle', isStrangle);
  reasoning.addInput('maxContractsFromProfile', profile.maxContracts);
  reasoning.addInput('buyingPowerUtilization', profile.buyingPowerUtilization);

  reasoning.addLogicStep(
    `Selected risk profile: ${riskProfile}`,
    profile.description
  );

  // Step 4.2: Calculate margin rate
  reasoning.addComputation(
    'Margin Rate Selection',
    isStrangle ? 'STRANGLE → 12% margin' : 'SINGLE SIDE → 18% margin',
    {
      isStrangle,
      marginRatePercent: formatPercent(marginRate),
      reason: isStrangle ? 'Offsetting positions reduce risk' : 'Single directional exposure',
    },
    formatPercent(marginRate),
    isStrangle
      ? 'Strangle positions get ~12% margin rate due to offsetting risk'
      : 'Single naked options require ~18% margin rate'
  );

  // Step 4.3: Calculate margin per contract
  const marginPerContract = calculateMarginPerContract(strikeSelection);

  let notionalValue = 0;
  if (strikeSelection.putStrike) {
    notionalValue += strikeSelection.putStrike.strike * 100;
  }
  if (strikeSelection.callStrike) {
    notionalValue += strikeSelection.callStrike.strike * 100;
  }
  if (isStrangle) {
    notionalValue = notionalValue / 2; // Average for offsetting
  }

  reasoning.addComputation(
    'Margin Per Contract',
    'notionalValue * marginRate',
    {
      putStrike: strikeSelection.putStrike?.strike || 'N/A',
      callStrike: strikeSelection.callStrike?.strike || 'N/A',
      notionalValue: formatCurrency(notionalValue),
      marginRate: formatPercent(marginRate),
    },
    marginPerContract,
    `Each contract requires ${formatCurrency(marginPerContract)} margin`
  );

  // Step 4.4: Calculate available buying power
  const availableBuyingPower = accountInfo.buyingPower * profile.buyingPowerUtilization;

  reasoning.addComputation(
    'Available Buying Power',
    'totalBuyingPower * utilizationRate',
    {
      totalBuyingPower: formatCurrency(accountInfo.buyingPower),
      utilizationRate: formatPercent(profile.buyingPowerUtilization),
    },
    availableBuyingPower,
    `Using ${formatPercent(profile.buyingPowerUtilization)} of ${formatCurrency(accountInfo.buyingPower)} = ${formatCurrency(availableBuyingPower)}`
  );

  // Step 4.5: Calculate maximum contracts
  const theoreticalMax = Math.floor(availableBuyingPower / marginPerContract);
  const maxContracts = calculateMaxContracts(
    accountInfo.buyingPower,
    marginPerContract,
    riskProfile
  );

  const limitedBy = maxContracts === profile.maxContracts ? 'risk profile limit' : 'buying power';

  reasoning.addComputation(
    'Max Contracts Calculation',
    'min(floor(availableBP / marginPerContract), profileLimit)',
    {
      theoreticalMax,
      profileLimit: profile.maxContracts,
      actualMax: maxContracts,
      limitedBy,
    },
    maxContracts,
    `Can trade ${maxContracts} contracts (limited by ${limitedBy})`
  );

  // Step 4.6: Determine final contract count
  const contracts = marginPerContract <= accountInfo.buyingPower ? Math.max(1, maxContracts) : 0;

  // Calculate totals
  const totalMarginRequired = contracts * marginPerContract;
  const buyingPowerUsed = totalMarginRequired;
  const buyingPowerRemaining = accountInfo.buyingPower - buyingPowerUsed;

  reasoning.addComputation(
    'Final Position Size',
    'contracts * marginPerContract',
    {
      contracts,
      marginPerContract: formatCurrency(marginPerContract),
      totalMarginRequired: formatCurrency(totalMarginRequired),
      buyingPowerRemaining: formatCurrency(buyingPowerRemaining),
    },
    contracts,
    contracts > 0
      ? `Trading ${contracts} contracts using ${formatCurrency(totalMarginRequired)} margin`
      : 'Insufficient buying power for any contracts'
  );

  // Check for warnings
  if (contracts === 0) {
    reasoning.addWarning('Insufficient buying power for even 1 contract');
  } else if (buyingPowerRemaining < totalMarginRequired * 0.5) {
    reasoning.addWarning(`Low remaining buying power: only ${formatCurrency(buyingPowerRemaining)} left`);
  }

  // Step 4.7: Calculate confidence
  let confidence = 0.8; // Base confidence for position sizing
  if (contracts > 0) confidence += 0.10;
  if (buyingPowerRemaining > totalMarginRequired) confidence += 0.05;
  if (limitedBy === 'risk profile limit') confidence += 0.05; // Within safe limits
  confidence = Math.min(confidence, 1);

  // Build short reason
  const reason = contracts > 0
    ? `${contracts} contracts @ ${formatCurrency(marginPerContract)}/contract | ${riskProfile} | ${formatCurrency(buyingPowerRemaining)} BP remaining`
    : `INSUFFICIENT BUYING POWER: Need ${formatCurrency(marginPerContract)}, have ${formatCurrency(accountInfo.buyingPower)}`;

  // Build final reasoning
  const decisionEmoji = contracts > 0 ? '✅' : '❌';
  const finalReasoning = reasoning.build(
    contracts > 0
      ? `POSITION SIZE: ${contracts} contracts. Margin: ${formatCurrency(totalMarginRequired)}. BP remaining: ${formatCurrency(buyingPowerRemaining)}`
      : 'CANNOT TRADE: Insufficient buying power',
    decisionEmoji,
    confidence * 100,
    contracts > 0
  );

  return {
    contracts,
    marginPerContract: Number(marginPerContract.toFixed(2)),
    totalMarginRequired: Number(totalMarginRequired.toFixed(2)),
    buyingPowerUsed: Number(buyingPowerUsed.toFixed(2)),
    buyingPowerRemaining: Number(buyingPowerRemaining.toFixed(2)),
    reason,
    riskProfile,
    reasoning: finalReasoning,
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
        reason: 'Single PUT'
      }
    },
    {
      name: 'CALL Only',
      selection: {
        callStrike: { strike: 455, expiration: new Date(), delta: 0.18, bid: 0.48, ask: 0.52 },
        expectedPremium: 50.00,
        marginRequired: 8190,
        reason: 'Single CALL'
      }
    },
    {
      name: 'STRANGLE',
      selection: {
        putStrike: { strike: 445, expiration: new Date(), delta: 0.18, bid: 0.50, ask: 0.55 },
        callStrike: { strike: 455, expiration: new Date(), delta: 0.18, bid: 0.48, ask: 0.52 },
        expectedPremium: 102.50,
        marginRequired: 5400,
        reason: 'STRANGLE (both sides)'
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