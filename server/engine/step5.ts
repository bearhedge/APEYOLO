/**
 * Step 5: Exit Rules
 * Defines when to exit positions
 *
 * Enhanced implementation with:
 * - Configurable stop loss multiplier (default 2x)
 * - Time-based exit rules for assignment avoidance
 * - Transparent reasoning chain
 * - Position monitoring with real-time P&L
 *
 * Rules:
 * - Stop loss: Configurable (default 200% of premium received)
 * - Take profit: None (let options expire worthless)
 * - Time-based: Close if ITM within 2 hours of expiration
 */

import { StrikeSelection } from './step3';
import { PositionSize } from './step4';
import {
  createReasoning,
  StepReasoning,
  formatNumber,
  formatCurrency,
  formatPercent,
} from './reasoningLogger';

export interface ExitRules {
  stopLossPrice: number;      // Price at which to exit with loss
  stopLossAmount: number;     // Dollar amount of loss that triggers exit
  takeProfitPrice: number | null;  // Price for take profit (null = let expire)
  maxHoldingTime: number;     // Maximum time to hold (in hours)
  stopLossMultiplier: number; // Multiplier used for stop loss
  reason: string;             // Short reason for display
  // NEW: Transparent reasoning chain
  reasoning?: StepReasoning;
}

export interface PositionMonitor {
  currentPrice: number;       // Current option price
  unrealizedPnL: number;      // Current P&L
  timeToExpiry: number;       // Hours until expiration
  shouldExit: boolean;        // Whether to exit now
  exitReason?: string;        // Why we're exiting
}

/**
 * Stop loss multiplier options
 * 200% means if we collected $50 premium, we exit at $100 loss (option worth $150)
 */
const DEFAULT_STOP_LOSS_MULTIPLIER = 2.0; // 200% of premium

// Available stop loss multiplier options for UI
export const STOP_LOSS_OPTIONS = [
  { value: 2.0, label: '2x', description: 'Conservative - exit at 200% loss' },
  { value: 3.0, label: '3x', description: 'Moderate - exit at 300% loss' },
  { value: 4.0, label: '4x', description: 'Aggressive - exit at 400% loss' },
];

// Time-based exit thresholds
const TIME_EXIT_CRITICAL_HOURS = 2;  // Close ITM positions within 2 hours of expiry
const TIME_EXIT_FINAL_HOURS = 1;     // Close any positions with value within 1 hour
const TIME_EXIT_MIN_VALUE = 0.05;    // Minimum value to trigger final hour close

/**
 * Calculate stop loss levels based on premium received
 * @param premiumReceived - Premium collected per contract (per-share price)
 * @param contracts - Number of contracts
 * @param multiplier - Stop loss multiplier (default 2.0 = 200%)
 * @returns Stop loss price and amount
 */
function calculateStopLoss(
  premiumReceived: number,
  contracts: number,
  multiplier: number = DEFAULT_STOP_LOSS_MULTIPLIER
): {
  price: number;
  amount: number;
  maxLossPerContract: number;
} {
  // Per contract calculation
  // If we received $0.50 premium and multiplier is 2x, stop at $1.50 (3x entry)
  const stopLossPrice = premiumReceived * (1 + multiplier);

  // Maximum loss per contract
  const maxLossPerContract = premiumReceived * multiplier * 100; // In dollars

  // Total position calculation
  const totalPremium = premiumReceived * contracts * 100; // Convert to dollars
  const stopLossAmount = totalPremium * multiplier; // Total loss amount that triggers exit

  return {
    price: stopLossPrice,
    amount: stopLossAmount,
    maxLossPerContract,
  };
}

/**
 * Check if position should be closed based on time to expiry
 * Close positions that are ITM close to expiration
 * @param hoursToExpiry - Hours until option expires
 * @param currentPrice - Current option price
 * @param premiumReceived - Original premium received
 * @returns Whether to close based on time
 */
function shouldCloseByTime(
  hoursToExpiry: number,
  currentPrice: number,
  premiumReceived: number
): boolean {
  // If less than 2 hours to expiry and option is worth more than premium received
  // This prevents assignment risk
  if (hoursToExpiry <= 2 && currentPrice > premiumReceived) {
    return true;
  }

  // If it's the last trading hour, close any position with value
  if (hoursToExpiry <= 1 && currentPrice > 0.05) {
    return true;
  }

  return false;
}

/**
 * Main function: Define exit rules for a position
 *
 * This function builds a transparent reasoning chain showing:
 * 1. Premium calculation
 * 2. Stop loss multiplier selection
 * 3. Stop loss price and amount calculation
 * 4. Time-based exit rules
 *
 * @param strikeSelection - Selected strikes from Step 3
 * @param positionSize - Position size from Step 4
 * @param stopLossMultiplier - Stop loss multiplier (default 2.0 = 200%)
 * @returns Exit rules for the position with reasoning chain
 */
export async function defineExitRules(
  strikeSelection: StrikeSelection,
  positionSize: PositionSize,
  stopLossMultiplier: number = DEFAULT_STOP_LOSS_MULTIPLIER
): Promise<ExitRules> {
  // Initialize reasoning builder
  const reasoning = createReasoning(5, 'Exit Rules');

  // Step 5.1: Log inputs
  const premiumPerContract = strikeSelection.expectedPremium / 100; // Convert to per-share price
  const isStrangle = strikeSelection.putStrike && strikeSelection.callStrike;

  reasoning.addInput('expectedPremium', strikeSelection.expectedPremium);
  reasoning.addInput('premiumPerShare', premiumPerContract);
  reasoning.addInput('contracts', positionSize.contracts);
  reasoning.addInput('stopLossMultiplier', stopLossMultiplier);
  reasoning.addInput('isStrangle', isStrangle);

  reasoning.addLogicStep(
    `Premium received: ${formatCurrency(strikeSelection.expectedPremium)} total (${formatCurrency(premiumPerContract)} per share)`,
    `Position: ${positionSize.contracts} contracts`
  );

  // Step 5.2: Determine stop loss multiplier
  const multiplierLabel = STOP_LOSS_OPTIONS.find(o => o.value === stopLossMultiplier)?.label || `${stopLossMultiplier}x`;
  const multiplierDesc = STOP_LOSS_OPTIONS.find(o => o.value === stopLossMultiplier)?.description || `Exit at ${stopLossMultiplier * 100}% loss`;

  reasoning.addLogicStep(
    `Stop loss multiplier: ${multiplierLabel}`,
    multiplierDesc
  );

  reasoning.addComputation(
    'Stop Loss Multiplier Selection',
    `multiplier = ${stopLossMultiplier}`,
    {
      multiplier: stopLossMultiplier,
      multiplierPercent: formatPercent(stopLossMultiplier),
      description: multiplierDesc,
    },
    `${stopLossMultiplier}x`,
    `Exit when loss reaches ${formatPercent(stopLossMultiplier)} of premium collected`
  );

  // Step 5.3: Calculate stop loss levels
  const stopLoss = calculateStopLoss(premiumPerContract, positionSize.contracts, stopLossMultiplier);

  reasoning.addComputation(
    'Stop Loss Price Calculation',
    'stopLossPrice = premiumPerShare × (1 + multiplier)',
    {
      premiumPerShare: formatCurrency(premiumPerContract),
      multiplier: stopLossMultiplier,
      entryPrice: formatCurrency(premiumPerContract),
    },
    stopLoss.price,
    `Exit if option price reaches ${formatCurrency(stopLoss.price)} per share`
  );

  reasoning.addComputation(
    'Max Loss Amount Calculation',
    'maxLoss = premium × multiplier × contracts × 100',
    {
      premiumPerShare: formatCurrency(premiumPerContract),
      multiplier: stopLossMultiplier,
      contracts: positionSize.contracts,
      maxLossPerContract: formatCurrency(stopLoss.maxLossPerContract),
    },
    stopLoss.amount,
    `Maximum loss before exit: ${formatCurrency(stopLoss.amount)}`
  );

  // Step 5.4: Time-based exit rules
  reasoning.addLogicStep(
    `Time-based exit rules for 0DTE options`,
    `Close ITM positions within ${TIME_EXIT_CRITICAL_HOURS} hours of expiry to avoid assignment`
  );

  reasoning.addComputation(
    'Time-Based Exit Thresholds',
    'ITM close = timeToExpiry < criticalHours AND price > entry',
    {
      criticalHours: TIME_EXIT_CRITICAL_HOURS,
      finalHours: TIME_EXIT_FINAL_HOURS,
      minValueForClose: formatCurrency(TIME_EXIT_MIN_VALUE),
    },
    true,
    `Close if ITM within ${TIME_EXIT_CRITICAL_HOURS}h or any value within ${TIME_EXIT_FINAL_HOURS}h of expiry`
  );

  // Step 5.5: Take profit strategy
  reasoning.addLogicStep(
    'Take profit strategy: Let options expire worthless',
    'Maximum profit achieved when options have zero value at expiration'
  );

  // Calculate confidence
  let confidence = 0.85; // Base confidence for exit rules
  if (stopLossMultiplier >= 2.0 && stopLossMultiplier <= 3.0) confidence += 0.10; // Reasonable multiplier
  if (positionSize.contracts > 0) confidence += 0.05;
  confidence = Math.min(confidence, 1);

  // Build short reason
  const reason = `Stop: ${formatCurrency(stopLoss.price)}/share (${multiplierLabel}) | Max loss: ${formatCurrency(stopLoss.amount)} | Expire worthless`;

  // Build final reasoning
  const finalReasoning = reasoning.build(
    `EXIT RULES SET: Stop at ${formatCurrency(stopLoss.price)}/share (${multiplierLabel}). Max loss: ${formatCurrency(stopLoss.amount)}. Let expire for max profit.`,
    '✅',
    confidence * 100,
    true
  );

  return {
    stopLossPrice: Number(stopLoss.price.toFixed(2)),
    stopLossAmount: Number(stopLoss.amount.toFixed(2)),
    takeProfitPrice: null, // Let expire
    maxHoldingTime: 24, // Maximum 24 hours for 0DTE
    stopLossMultiplier,
    reason,
    reasoning: finalReasoning,
  };
}

/**
 * Monitor a position and determine if it should be exited
 * @param position - Current position details
 * @param exitRules - Exit rules for the position
 * @param currentOptionPrice - Current price of the option
 * @returns Monitoring result with exit decision
 */
export function monitorPosition(
  position: {
    premiumReceived: number;
    contracts: number;
    entryTime: Date;
    expirationTime: Date;
  },
  exitRules: ExitRules,
  currentOptionPrice: number
): PositionMonitor {
  // Calculate current P&L
  const entryPrice = position.premiumReceived / 100; // Convert to per-share
  const pnlPerContract = (entryPrice - currentOptionPrice) * 100; // Profit if option worth less
  const unrealizedPnL = pnlPerContract * position.contracts;

  // Calculate time to expiry
  const now = new Date();
  const hoursToExpiry = (position.expirationTime.getTime() - now.getTime()) / (1000 * 60 * 60);

  // Check exit conditions
  let shouldExit = false;
  let exitReason = '';

  // Check stop loss
  if (currentOptionPrice >= exitRules.stopLossPrice) {
    shouldExit = true;
    exitReason = `Stop loss triggered: Option at $${currentOptionPrice.toFixed(2)} exceeds stop at $${exitRules.stopLossPrice.toFixed(2)}`;
  }
  // Check time-based exit
  else if (shouldCloseByTime(hoursToExpiry, currentOptionPrice, entryPrice)) {
    shouldExit = true;
    exitReason = `Time-based exit: ${hoursToExpiry.toFixed(1)} hours to expiry with option at $${currentOptionPrice.toFixed(2)}`;
  }

  return {
    currentPrice: currentOptionPrice,
    unrealizedPnL: Number(unrealizedPnL.toFixed(2)),
    timeToExpiry: Number(hoursToExpiry.toFixed(1)),
    shouldExit,
    exitReason
  };
}

/**
 * Test function to validate Step 5 logic
 * Note: This uses mock data for testing - production uses real IBKR data
 */
export async function testStep5(): Promise<void> {
  console.log('Testing Step 5: Exit Rules\n');

  // Mock data for testing only - production uses real IBKR data
  const mockStrikeSelection: StrikeSelection = {
    putStrike: { strike: 670, expiration: new Date(), delta: 0.15, bid: 0.80, ask: 0.85 },
    expectedPremium: 82.50,
    marginRequired: 8040,
    reason: 'Test position'
  };

  const mockPositionSize: PositionSize = {
    contracts: 3,
    marginPerContract: 8040,
    totalMarginRequired: 24120,
    buyingPowerUsed: 24120,
    buyingPowerRemaining: 641880,
    reason: 'Test sizing',
    riskProfile: 'BALANCED',
  };

  // Define exit rules
  const exitRules = await defineExitRules(mockStrikeSelection, mockPositionSize);

  console.log('Exit Rules:');
  console.log(`  Stop Loss Price: $${exitRules.stopLossPrice} per share`);
  console.log(`  Stop Loss Amount: $${exitRules.stopLossAmount} total loss`);
  console.log(`  Take Profit: ${exitRules.takeProfitPrice || 'None (let expire)'}`);
  console.log(`  Max Holding Time: ${exitRules.maxHoldingTime} hours`);
  console.log(`\nReasoning: ${exitRules.reasoning}\n`);

  // Test position monitoring with different scenarios
  const position = {
    premiumReceived: 52.50,
    contracts: 3,
    entryTime: new Date(),
    expirationTime: new Date(Date.now() + 6 * 60 * 60 * 1000) // 6 hours from now
  };

  console.log('\nPosition Monitoring Scenarios:');
  console.log('='.repeat(60));

  const scenarios = [
    { price: 0.20, description: 'Profitable - Option losing value' },
    { price: 0.525, description: 'Breakeven - Option at entry price' },
    { price: 1.00, description: 'Small loss - Below stop loss' },
    { price: 1.58, description: 'At stop loss threshold' },
    { price: 2.00, description: 'Beyond stop loss - Should exit' }
  ];

  for (const scenario of scenarios) {
    const monitor = monitorPosition(position, exitRules, scenario.price);

    console.log(`\n${scenario.description}:`);
    console.log(`  Current Price: $${scenario.price}`);
    console.log(`  Unrealized P&L: $${monitor.unrealizedPnL}`);
    console.log(`  Time to Expiry: ${monitor.timeToExpiry} hours`);
    console.log(`  Should Exit: ${monitor.shouldExit ? '⚠️ YES' : '✅ NO'}`);
    if (monitor.exitReason) {
      console.log(`  Exit Reason: ${monitor.exitReason}`);
    }
  }

  // Test time-based exit
  console.log('\n\nTime-Based Exit Test:');
  console.log('='.repeat(60));

  const nearExpiryPosition = {
    ...position,
    expirationTime: new Date(Date.now() + 1.5 * 60 * 60 * 1000) // 1.5 hours from now
  };

  const timeMonitor = monitorPosition(nearExpiryPosition, exitRules, 0.60);
  console.log(`\nNear expiry with ITM option:`);
  console.log(`  Time to Expiry: ${timeMonitor.timeToExpiry} hours`);
  console.log(`  Current Price: $0.60 (above entry of $0.525)`);
  console.log(`  Should Exit: ${timeMonitor.shouldExit ? '⚠️ YES' : '✅ NO'}`);
  if (timeMonitor.exitReason) {
    console.log(`  Exit Reason: ${timeMonitor.exitReason}`);
  }
}

// Test function can be called from a separate test file