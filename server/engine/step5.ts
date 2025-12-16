/**
 * Step 5: Exit Rules
 * Defines when to exit positions
 *
 * Rules:
 * - Stop loss: 200% of premium received
 * - Take profit: None (let options expire worthless)
 * - Time-based: Close if too close to expiration with risk
 */

import { StrikeSelection } from './step3';
import { PositionSize } from './step4';
import type { StepReasoning, StepMetric } from '../../shared/types/engineLog';

export interface ExitRules {
  stopLossPrice: number;      // Price at which to exit with loss
  stopLossAmount: number;     // Dollar amount of loss that triggers exit
  takeProfitPrice: number | null;  // Price for take profit (null = let expire)
  maxHoldingTime: number;     // Maximum time to hold (in hours)
  reasoning: string;
  // Enhanced logging
  stepReasoning?: StepReasoning[];
  stepMetrics?: StepMetric[];
}

export interface PositionMonitor {
  currentPrice: number;       // Current option price
  unrealizedPnL: number;      // Current P&L
  timeToExpiry: number;       // Hours until expiration
  shouldExit: boolean;        // Whether to exit now
  exitReason?: string;        // Why we're exiting
}

/**
 * Stop loss multiplier
 * 200% means if we collected $50 premium, we exit at $100 loss (option worth $150)
 */
const STOP_LOSS_MULTIPLIER = 2.0; // 200% of premium

/**
 * Minimum stop loss values when premium is $0 (market closed)
 * These prevent having no stop loss at all
 */
const MIN_STOP_LOSS_PRICE = 0.50;     // At least $0.50 per share stop loss price
const MIN_STOP_LOSS_AMOUNT = 100;      // At least $100 total stop loss amount

/**
 * Calculate stop loss levels based on premium received
 * IMPORTANT: Now includes minimum stop loss to protect against $0 premium scenarios
 *
 * @param premiumReceived - Premium collected per contract
 * @param contracts - Number of contracts
 * @param marginRequired - Optional: margin required for position (for backup calculation)
 * @returns Stop loss price and amount
 */
function calculateStopLoss(premiumReceived: number, contracts: number, marginRequired?: number): {
  price: number;
  amount: number;
} {
  // Per contract calculation - with minimum floor
  let stopLossPrice = premiumReceived * (1 + STOP_LOSS_MULTIPLIER);
  if (stopLossPrice <= 0 || !isFinite(stopLossPrice)) {
    stopLossPrice = MIN_STOP_LOSS_PRICE;
    console.warn(`[Step5] Premium is $0, using minimum stop loss price: $${MIN_STOP_LOSS_PRICE}`);
  }

  // Total position calculation - with minimum floor
  const totalPremium = premiumReceived * contracts * 100; // Convert to dollars
  let stopLossAmount = totalPremium * STOP_LOSS_MULTIPLIER; // Loss amount that triggers exit

  // If premium-based stop loss is zero, use margin-based or minimum
  if (stopLossAmount <= 0 || !isFinite(stopLossAmount)) {
    if (marginRequired && marginRequired > 0) {
      // Use 10% of margin as stop loss when no premium data
      stopLossAmount = marginRequired * 0.10;
      console.warn(`[Step5] Premium is $0, using margin-based stop loss: $${stopLossAmount.toFixed(2)} (10% of margin)`);
    } else {
      // Fallback to absolute minimum
      stopLossAmount = MIN_STOP_LOSS_AMOUNT * contracts;
      console.warn(`[Step5] Premium is $0, using minimum stop loss amount: $${stopLossAmount.toFixed(2)}`);
    }
  }

  return {
    price: stopLossPrice,
    amount: stopLossAmount
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
 * @param strikeSelection - Selected strikes from Step 3
 * @param positionSize - Position size from Step 4
 * @returns Exit rules for the position
 */
export async function defineExitRules(
  strikeSelection: StrikeSelection,
  positionSize: PositionSize
): Promise<ExitRules> {
  // Calculate premium per contract (average if strangle)
  const premiumPerContract = strikeSelection.expectedPremium / 100; // Convert to per-share price

  // Calculate stop loss levels (pass margin for backup calculation when premium is $0)
  const stopLoss = calculateStopLoss(
    premiumPerContract,
    positionSize.contracts,
    strikeSelection.marginRequired
  );

  // Build reasoning
  let reasoning = `Stop loss set at ${STOP_LOSS_MULTIPLIER * 100}% of premium. `;
  const hasPremiumData = strikeSelection.expectedPremium > 0;
  if (!hasPremiumData) {
    reasoning = `Premium is $0 (market may be closed). Using minimum stop loss. `;
  }
  reasoning += `Premium collected: $${strikeSelection.expectedPremium} per contract. `;
  reasoning += `Stop loss triggers if option price reaches $${stopLoss.price.toFixed(2)} `;
  reasoning += `(total loss of $${stopLoss.amount.toFixed(2)}). `;
  reasoning += `No take profit - options ideally expire worthless. `;
  reasoning += `Will close if ITM near expiration to avoid assignment.`;

  // Build enhanced reasoning Q&A
  const stopLossMultiplierPct = (STOP_LOSS_MULTIPLIER * 100).toFixed(0);
  const maxLossPerContract = stopLoss.amount / positionSize.contracts;

  const stepReasoning: StepReasoning[] = [
    {
      question: 'What is the stop loss rule?',
      answer: `${stopLossMultiplierPct}% of premium received (option tripling in value)`
    },
    {
      question: 'When do we exit?',
      answer: `If option price reaches $${stopLoss.price.toFixed(2)} per share`
    },
    {
      question: 'Maximum loss?',
      answer: `$${stopLoss.amount.toFixed(2)} total ($${maxLossPerContract.toFixed(2)}/contract)`
    },
    {
      question: 'Take profit strategy?',
      answer: 'Let expire worthless (collect full premium)'
    },
    {
      question: 'Time-based exit?',
      answer: 'Close if ITM within 2 hours of expiry to avoid assignment'
    }
  ];

  // Build enhanced metrics
  const stepMetrics: StepMetric[] = [
    {
      label: 'Stop Loss Price',
      value: `$${stopLoss.price.toFixed(2)}`,
      status: 'normal'
    },
    {
      label: 'Max Loss Total',
      value: `$${stopLoss.amount.toFixed(2)}`,
      status: stopLoss.amount > 500 ? 'warning' : 'normal'
    },
    {
      label: 'Max Loss/Contract',
      value: `$${maxLossPerContract.toFixed(2)}`,
      status: 'normal'
    },
    {
      label: 'Take Profit',
      value: 'Let Expire',
      status: 'normal'
    },
    {
      label: 'Max Hold Time',
      value: '24 hours',
      status: 'normal'
    },
    {
      label: 'Premium Data',
      value: hasPremiumData ? 'Available' : 'Unavailable',
      status: hasPremiumData ? 'normal' : 'warning'
    }
  ];

  return {
    stopLossPrice: Number(stopLoss.price.toFixed(2)),
    stopLossAmount: Number(stopLoss.amount.toFixed(2)),
    takeProfitPrice: null, // Let expire
    maxHoldingTime: 24, // Maximum 24 hours for 0DTE
    reasoning,
    stepReasoning,
    stepMetrics
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
 */
export async function testStep5(): Promise<void> {
  console.log('Testing Step 5: Exit Rules\n');

  // Mock data
  const mockStrikeSelection: StrikeSelection = {
    putStrike: { strike: 445, expiration: new Date(), delta: 0.18, bid: 0.50, ask: 0.55 },
    expectedPremium: 52.50,
    marginRequired: 8010,
    reasoning: 'Test position'
  };

  const mockPositionSize: PositionSize = {
    contracts: 2,
    marginPerContract: 8010,
    totalMarginRequired: 16020,
    buyingPowerUsed: 16020,
    buyingPowerRemaining: 649980,
    maxLossPerContract: 50,
    maxLossTotal: 100,
    maxLossAllowed: 200,
    reasoning: 'Test sizing'
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
    contracts: 2,
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