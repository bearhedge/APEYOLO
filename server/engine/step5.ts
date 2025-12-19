/**
 * Step 5: Exit Rules - Layered Defense System
 *
 * Three-layer defense to avoid premature exits while protecting capital:
 *
 * Layer 1: UNDERLYING PRICE STOP (Primary)
 *   - Trigger: Underlying sustains beyond (strike ± $2) for 15 minutes
 *   - Purpose: Ignores premium noise, catches real breakdowns
 *   - Example: Sold $677 PUT → Exit if SPY < $675 for 15 min
 *
 * Layer 2: WIDE PREMIUM STOP (Backup)
 *   - Trigger: Option premium hits 6x entry price
 *   - Purpose: Catches extreme moves that Layer 1 might miss
 *   - Example: Sold at $0.70 → Exit if premium hits $4.20
 *
 * Layer 3: EOD SWEEP (Final Safety Net)
 *   - Trigger: 3:55pm ET
 *   - Handled by: 0dtePositionManager.ts (already exists)
 */

import { StrikeSelection } from './step3';
import { PositionSize } from './step4';
import type { StepReasoning, StepMetric } from '../../shared/types/engineLog';

// =============================================================================
// LAYER 1: Underlying Price Stop Configuration
// =============================================================================

/**
 * Distance from strike that triggers Layer 1 monitoring
 * If underlying moves beyond (strike ± this value), timer starts
 */
const LAYER1_THRESHOLD_DOLLARS = 2.0;

/**
 * Duration (in milliseconds) that underlying must sustain beyond threshold
 * before triggering exit. 15 minutes = 900,000 ms
 */
const LAYER1_SUSTAIN_DURATION_MS = 15 * 60 * 1000; // 15 minutes

// =============================================================================
// LAYER 2: Wide Premium Stop Configuration
// =============================================================================

/**
 * Premium multiplier for Layer 2 stop
 * 6x means: if sold at $0.70, exit when premium reaches $4.20
 */
const LAYER2_PREMIUM_MULTIPLIER = 6.0;

/**
 * Minimum Layer 2 stop price when premium data is unavailable (market closed)
 */
const MIN_LAYER2_STOP_PRICE = 3.00;
const MIN_LAYER2_STOP_AMOUNT = 600;

// =============================================================================
// Interfaces
// =============================================================================

export interface ExitRules {
  // Layer 1: Underlying price stop
  layer1: {
    enabled: boolean;
    putThreshold: number | null;   // Exit if underlying < this for 15 min
    callThreshold: number | null;  // Exit if underlying > this for 15 min
    sustainDurationMs: number;     // How long price must sustain (15 min)
  };

  // Layer 2: Wide premium stop
  layer2: {
    stopLossPrice: number;        // Price at which to exit (6x entry)
    stopLossAmount: number;       // Dollar amount of loss that triggers exit
    multiplier: number;           // The multiplier used (6x)
  };

  // Legacy fields for backward compatibility
  stopLossPrice: number;          // Alias for layer2.stopLossPrice
  stopLossAmount: number;         // Alias for layer2.stopLossAmount
  takeProfitPrice: number | null; // null = let expire worthless
  maxHoldingTime: number;         // Maximum time to hold (in hours)

  reasoning: string;
  stepReasoning?: StepReasoning[];
  stepMetrics?: StepMetric[];
}

/**
 * Tracks underlying price history for Layer 1 sustained check
 */
export interface UnderlyingPriceHistory {
  price: number;
  timestamp: Date;
}

export interface PositionMonitor {
  currentOptionPrice: number;     // Current option price
  currentUnderlyingPrice: number; // Current underlying price
  unrealizedPnL: number;          // Current P&L
  timeToExpiry: number;           // Hours until expiration

  // Layer 1 status
  layer1: {
    breached: boolean;            // Is underlying currently beyond threshold?
    breachDirection: 'PUT' | 'CALL' | null;
    breachStartTime: Date | null; // When did it start breaching?
    breachDurationMs: number;     // How long has it been breaching?
    triggered: boolean;           // Has 15-min sustained check passed?
  };

  // Layer 2 status
  layer2: {
    triggered: boolean;           // Is premium >= 6x entry?
    currentMultiple: number;      // Current premium as multiple of entry
  };

  shouldExit: boolean;            // Whether to exit now
  exitReason?: string;            // Why we're exiting
  exitLayer?: 1 | 2 | 3;          // Which layer triggered the exit
}

// =============================================================================
// Layer 1: Underlying Price Stop Logic
// =============================================================================

/**
 * Check if underlying price has breached the Layer 1 threshold
 */
function checkLayer1Breach(
  underlyingPrice: number,
  putStrike: number | null,
  callStrike: number | null
): { breached: boolean; direction: 'PUT' | 'CALL' | null } {
  // Check PUT side: underlying below (strike - threshold)
  if (putStrike !== null) {
    const putThreshold = putStrike - LAYER1_THRESHOLD_DOLLARS;
    if (underlyingPrice < putThreshold) {
      return { breached: true, direction: 'PUT' };
    }
  }

  // Check CALL side: underlying above (strike + threshold)
  if (callStrike !== null) {
    const callThreshold = callStrike + LAYER1_THRESHOLD_DOLLARS;
    if (underlyingPrice > callThreshold) {
      return { breached: true, direction: 'CALL' };
    }
  }

  return { breached: false, direction: null };
}

/**
 * Check Layer 1 sustained condition
 * Returns true if underlying has been beyond threshold for LAYER1_SUSTAIN_DURATION_MS
 */
function checkLayer1Triggered(
  breachStartTime: Date | null,
  currentlyBreached: boolean
): { triggered: boolean; durationMs: number } {
  if (!currentlyBreached || !breachStartTime) {
    return { triggered: false, durationMs: 0 };
  }

  const now = new Date();
  const durationMs = now.getTime() - breachStartTime.getTime();
  const triggered = durationMs >= LAYER1_SUSTAIN_DURATION_MS;

  return { triggered, durationMs };
}

// =============================================================================
// Layer 2: Wide Premium Stop Logic
// =============================================================================

/**
 * Calculate Layer 2 stop loss levels (6x premium)
 */
function calculateLayer2StopLoss(
  premiumReceived: number,
  contracts: number,
  marginRequired?: number
): { price: number; amount: number } {
  // 6x entry price
  let stopLossPrice = premiumReceived * LAYER2_PREMIUM_MULTIPLIER;

  if (stopLossPrice <= 0 || !isFinite(stopLossPrice)) {
    stopLossPrice = MIN_LAYER2_STOP_PRICE;
    console.warn(`[Step5] Premium is $0, using minimum Layer 2 stop: $${MIN_LAYER2_STOP_PRICE}`);
  }

  // Calculate loss amount when Layer 2 triggers
  // Loss = (stopPrice - entryPrice) * 100 * contracts
  const lossPerContract = (stopLossPrice - premiumReceived) * 100;
  let stopLossAmount = lossPerContract * contracts;

  if (stopLossAmount <= 0 || !isFinite(stopLossAmount)) {
    if (marginRequired && marginRequired > 0) {
      stopLossAmount = marginRequired * 0.15; // 15% of margin as backup
      console.warn(`[Step5] Using margin-based Layer 2 stop: $${stopLossAmount.toFixed(2)}`);
    } else {
      stopLossAmount = MIN_LAYER2_STOP_AMOUNT * contracts;
      console.warn(`[Step5] Using minimum Layer 2 stop amount: $${stopLossAmount.toFixed(2)}`);
    }
  }

  return {
    price: Number(stopLossPrice.toFixed(2)),
    amount: Number(stopLossAmount.toFixed(2))
  };
}

// =============================================================================
// Time-Based Exit (Part of Layer 3, handled by 0dtePositionManager)
// =============================================================================

/**
 * Check if position should be closed based on time to expiry
 * This is a backup to the scheduled EOD sweep
 */
function shouldCloseByTime(
  hoursToExpiry: number,
  currentPrice: number,
  premiumReceived: number
): boolean {
  // If less than 2 hours to expiry and option is worth more than premium received
  if (hoursToExpiry <= 2 && currentPrice > premiumReceived) {
    return true;
  }

  // If it's the last hour, close any position with significant value
  if (hoursToExpiry <= 1 && currentPrice > 0.10) {
    return true;
  }

  return false;
}

// =============================================================================
// Main Functions
// =============================================================================

/**
 * Define exit rules for a position using the Layered Defense System
 */
export async function defineExitRules(
  strikeSelection: StrikeSelection,
  positionSize: PositionSize
): Promise<ExitRules> {
  const premiumPerContract = strikeSelection.expectedPremium / 100; // Convert to per-share

  // Layer 1: Calculate thresholds
  const putStrike = strikeSelection.putStrike?.strike ?? null;
  const callStrike = strikeSelection.callStrike?.strike ?? null;

  const layer1 = {
    enabled: true,
    putThreshold: putStrike !== null ? putStrike - LAYER1_THRESHOLD_DOLLARS : null,
    callThreshold: callStrike !== null ? callStrike + LAYER1_THRESHOLD_DOLLARS : null,
    sustainDurationMs: LAYER1_SUSTAIN_DURATION_MS
  };

  // Layer 2: Calculate wide premium stop
  const layer2Stop = calculateLayer2StopLoss(
    premiumPerContract,
    positionSize.contracts,
    strikeSelection.marginRequired
  );

  const layer2 = {
    stopLossPrice: layer2Stop.price,
    stopLossAmount: layer2Stop.amount,
    multiplier: LAYER2_PREMIUM_MULTIPLIER
  };

  // Build reasoning
  const hasPremiumData = strikeSelection.expectedPremium > 0;
  let reasoning = `LAYERED DEFENSE: `;

  // Layer 1 reasoning
  reasoning += `L1 (Primary): Exit if underlying `;
  if (layer1.putThreshold !== null) {
    reasoning += `< $${layer1.putThreshold.toFixed(0)} `;
  }
  if (layer1.putThreshold !== null && layer1.callThreshold !== null) {
    reasoning += `or `;
  }
  if (layer1.callThreshold !== null) {
    reasoning += `> $${layer1.callThreshold.toFixed(0)} `;
  }
  reasoning += `for 15 min. `;

  // Layer 2 reasoning
  reasoning += `L2 (Backup): Exit if premium hits $${layer2.stopLossPrice.toFixed(2)} (6x entry). `;

  // Layer 3 note
  reasoning += `L3: EOD sweep at 3:55pm ET.`;

  if (!hasPremiumData) {
    reasoning = `⚠️ Premium is $0 (market may be closed). ` + reasoning;
  }

  // Build enhanced reasoning Q&A
  const stepReasoning: StepReasoning[] = [
    {
      question: 'Layer 1: Underlying price stop?',
      answer: layer1.putThreshold !== null || layer1.callThreshold !== null
        ? `Exit if underlying sustains beyond ±$${LAYER1_THRESHOLD_DOLLARS} from strike for 15 min`
        : 'Not applicable (no strikes selected)'
    },
    {
      question: 'Layer 1 thresholds?',
      answer: `PUT: ${layer1.putThreshold !== null ? `<$${layer1.putThreshold.toFixed(0)}` : 'N/A'}, ` +
              `CALL: ${layer1.callThreshold !== null ? `>$${layer1.callThreshold.toFixed(0)}` : 'N/A'}`
    },
    {
      question: 'Layer 2: Wide premium stop?',
      answer: `Exit if option premium reaches $${layer2.stopLossPrice.toFixed(2)} (${LAYER2_PREMIUM_MULTIPLIER}x entry)`
    },
    {
      question: 'Layer 2 max loss?',
      answer: `$${layer2.stopLossAmount.toFixed(2)} total`
    },
    {
      question: 'Layer 3: EOD sweep?',
      answer: '3:55pm ET - close ITM or high-delta positions'
    },
    {
      question: 'Take profit strategy?',
      answer: 'Let expire worthless (collect full premium)'
    }
  ];

  // Build enhanced metrics
  const stepMetrics: StepMetric[] = [
    {
      label: 'L1: PUT Threshold',
      value: layer1.putThreshold !== null ? `<$${layer1.putThreshold.toFixed(0)}` : 'N/A',
      status: 'normal'
    },
    {
      label: 'L1: CALL Threshold',
      value: layer1.callThreshold !== null ? `>$${layer1.callThreshold.toFixed(0)}` : 'N/A',
      status: 'normal'
    },
    {
      label: 'L1: Sustain Time',
      value: '15 min',
      status: 'normal'
    },
    {
      label: 'L2: Stop Price',
      value: `$${layer2.stopLossPrice.toFixed(2)}`,
      status: 'normal'
    },
    {
      label: 'L2: Max Loss',
      value: `$${layer2.stopLossAmount.toFixed(2)}`,
      status: layer2.stopLossAmount > 1000 ? 'warning' : 'normal'
    },
    {
      label: 'L3: EOD Sweep',
      value: '3:55pm ET',
      status: 'normal'
    },
    {
      label: 'Premium Data',
      value: hasPremiumData ? 'Available' : 'Unavailable',
      status: hasPremiumData ? 'normal' : 'warning'
    }
  ];

  return {
    layer1,
    layer2,
    // Legacy compatibility
    stopLossPrice: layer2.stopLossPrice,
    stopLossAmount: layer2.stopLossAmount,
    takeProfitPrice: null,
    maxHoldingTime: 24,
    reasoning,
    stepReasoning,
    stepMetrics
  };
}

/**
 * Monitor a position using the Layered Defense System
 *
 * @param position - Current position details
 * @param exitRules - Exit rules from defineExitRules
 * @param currentOptionPrice - Current price of the option
 * @param currentUnderlyingPrice - Current price of the underlying (e.g., SPY)
 * @param layer1BreachStartTime - When Layer 1 breach started (null if not breaching)
 */
export function monitorPosition(
  position: {
    premiumReceived: number;
    contracts: number;
    entryTime: Date;
    expirationTime: Date;
    putStrike?: number;
    callStrike?: number;
  },
  exitRules: ExitRules,
  currentOptionPrice: number,
  currentUnderlyingPrice: number,
  layer1BreachStartTime: Date | null = null
): PositionMonitor {
  // Calculate current P&L
  const entryPrice = position.premiumReceived / 100;
  const pnlPerContract = (entryPrice - currentOptionPrice) * 100;
  const unrealizedPnL = pnlPerContract * position.contracts;

  // Calculate time to expiry
  const now = new Date();
  const hoursToExpiry = (position.expirationTime.getTime() - now.getTime()) / (1000 * 60 * 60);

  // Initialize monitoring result
  let shouldExit = false;
  let exitReason = '';
  let exitLayer: 1 | 2 | 3 | undefined = undefined;

  // =========================================================================
  // LAYER 1: Underlying Price Stop Check
  // =========================================================================
  const layer1Breach = checkLayer1Breach(
    currentUnderlyingPrice,
    position.putStrike ?? null,
    position.callStrike ?? null
  );

  const layer1Status = checkLayer1Triggered(
    layer1BreachStartTime,
    layer1Breach.breached
  );

  const layer1Result = {
    breached: layer1Breach.breached,
    breachDirection: layer1Breach.direction,
    breachStartTime: layer1Breach.breached ? (layer1BreachStartTime ?? now) : null,
    breachDurationMs: layer1Status.durationMs,
    triggered: layer1Status.triggered
  };

  if (layer1Status.triggered) {
    shouldExit = true;
    const thresholdPrice = layer1Breach.direction === 'PUT'
      ? exitRules.layer1.putThreshold
      : exitRules.layer1.callThreshold;
    const durationMin = Math.floor(layer1Status.durationMs / 60000);
    exitReason = `LAYER 1: Underlying at $${currentUnderlyingPrice.toFixed(2)} ` +
                 `(${layer1Breach.direction === 'PUT' ? 'below' : 'above'} $${thresholdPrice?.toFixed(0)}) ` +
                 `for ${durationMin}+ minutes`;
    exitLayer = 1;
  }

  // =========================================================================
  // LAYER 2: Wide Premium Stop Check
  // =========================================================================
  const currentMultiple = entryPrice > 0 ? currentOptionPrice / entryPrice : 0;
  const layer2Triggered = currentOptionPrice >= exitRules.layer2.stopLossPrice;

  const layer2Result = {
    triggered: layer2Triggered,
    currentMultiple: Number(currentMultiple.toFixed(2))
  };

  // Layer 2 only triggers if Layer 1 hasn't already
  if (!shouldExit && layer2Triggered) {
    shouldExit = true;
    exitReason = `LAYER 2: Premium at $${currentOptionPrice.toFixed(2)} ` +
                 `(${currentMultiple.toFixed(1)}x entry) >= $${exitRules.layer2.stopLossPrice.toFixed(2)} (6x stop)`;
    exitLayer = 2;
  }

  // =========================================================================
  // TIME-BASED CHECK (Part of Layer 3)
  // =========================================================================
  if (!shouldExit && shouldCloseByTime(hoursToExpiry, currentOptionPrice, entryPrice)) {
    shouldExit = true;
    exitReason = `TIME-BASED: ${hoursToExpiry.toFixed(1)} hours to expiry with option at $${currentOptionPrice.toFixed(2)}`;
    exitLayer = 3;
  }

  return {
    currentOptionPrice,
    currentUnderlyingPrice,
    unrealizedPnL: Number(unrealizedPnL.toFixed(2)),
    timeToExpiry: Number(hoursToExpiry.toFixed(1)),
    layer1: layer1Result,
    layer2: layer2Result,
    shouldExit,
    exitReason,
    exitLayer
  };
}

/**
 * Test function to validate Step 5 Layered Defense logic
 */
export async function testStep5(): Promise<void> {
  console.log('Testing Step 5: Layered Defense System\n');
  console.log('='.repeat(70));

  // Mock data
  const mockStrikeSelection: StrikeSelection = {
    putStrike: { strike: 677, expiration: new Date(), delta: -0.12, bid: 0.65, ask: 0.75 },
    callStrike: { strike: 682, expiration: new Date(), delta: 0.12, bid: 0.60, ask: 0.70 },
    expectedPremium: 70, // $0.70 per contract
    marginRequired: 8000,
    reasoning: 'Test STRANGLE position'
  };

  const mockPositionSize: PositionSize = {
    contracts: 2,
    marginPerContract: 4000,
    totalMarginRequired: 8000,
    buyingPowerUsed: 8000,
    buyingPowerRemaining: 142000,
    maxLossPerContract: 175,
    maxLossTotal: 350,
    maxLossAllowed: 3000,
    reasoning: 'Test sizing'
  };

  // Define exit rules
  const exitRules = await defineExitRules(mockStrikeSelection, mockPositionSize);

  console.log('\nEXIT RULES (Layered Defense):');
  console.log('-'.repeat(50));
  console.log(`Layer 1 (Underlying Price Stop):`);
  console.log(`  PUT threshold: < $${exitRules.layer1.putThreshold?.toFixed(0)} for 15 min`);
  console.log(`  CALL threshold: > $${exitRules.layer1.callThreshold?.toFixed(0)} for 15 min`);
  console.log(`Layer 2 (Wide Premium Stop):`);
  console.log(`  Stop price: $${exitRules.layer2.stopLossPrice} (6x entry)`);
  console.log(`  Max loss: $${exitRules.layer2.stopLossAmount}`);
  console.log(`Layer 3: EOD sweep at 3:55pm ET`);
  console.log(`\nReasoning: ${exitRules.reasoning}`);

  // Test position scenarios
  const position = {
    premiumReceived: 70, // $0.70
    contracts: 2,
    entryTime: new Date(),
    expirationTime: new Date(Date.now() + 6 * 60 * 60 * 1000),
    putStrike: 677,
    callStrike: 682
  };

  console.log('\n\nSCENARIO TESTING:');
  console.log('='.repeat(70));

  const scenarios = [
    {
      name: 'Normal - No breach',
      underlying: 679.50,
      optionPrice: 0.50,
      breachStart: null
    },
    {
      name: 'Temporary dip (old system would exit)',
      underlying: 674.50, // Below $675 threshold
      optionPrice: 2.10,  // 3x (old stop would trigger)
      breachStart: new Date(Date.now() - 5 * 60 * 1000) // Only 5 min
    },
    {
      name: 'Layer 1 TRIGGERED - 15 min sustained',
      underlying: 674.50,
      optionPrice: 1.80,
      breachStart: new Date(Date.now() - 16 * 60 * 1000) // 16 min
    },
    {
      name: 'Layer 2 TRIGGERED - 6x premium',
      underlying: 676.00, // Not breaching Layer 1
      optionPrice: 4.50,  // Above 6x ($4.20)
      breachStart: null
    },
    {
      name: 'Profitable - Let expire',
      underlying: 679.00,
      optionPrice: 0.15,
      breachStart: null
    }
  ];

  for (const scenario of scenarios) {
    const monitor = monitorPosition(
      position,
      exitRules,
      scenario.optionPrice,
      scenario.underlying,
      scenario.breachStart
    );

    console.log(`\n${scenario.name}:`);
    console.log(`  Underlying: $${scenario.underlying.toFixed(2)}`);
    console.log(`  Option Price: $${scenario.optionPrice.toFixed(2)} (${monitor.layer2.currentMultiple}x entry)`);
    console.log(`  Layer 1: ${monitor.layer1.breached ? `BREACHING (${Math.floor(monitor.layer1.breachDurationMs/60000)}min)` : 'OK'}`);
    console.log(`  Layer 2: ${monitor.layer2.triggered ? 'TRIGGERED' : 'OK'}`);
    console.log(`  Action: ${monitor.shouldExit ? `⚠️ EXIT (Layer ${monitor.exitLayer})` : '✅ HOLD'}`);
    if (monitor.exitReason) {
      console.log(`  Reason: ${monitor.exitReason}`);
    }
    console.log(`  P&L: $${monitor.unrealizedPnL.toFixed(2)}`);
  }

  console.log('\n' + '='.repeat(70));
  console.log('KEY INSIGHT: Scenario 2 (Temporary dip) - old 3x stop would exit,');
  console.log('but new system HOLDS because Layer 1 hasn\'t sustained for 15 min.');
  console.log('='.repeat(70));
}
