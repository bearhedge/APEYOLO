/**
 * Step 1: Market Regime Check
 * Determines whether market conditions are suitable for trading
 *
 * Enhanced implementation with:
 * - Real market data integration (VIX, SPY)
 * - Transparent reasoning chain
 * - Hard stop at VIX >= 20 (user requirement)
 *
 * Rules:
 * - VIX >= 20: HARD STOP - No trading allowed
 * - VIX < 17: LOW volatility regime
 * - VIX 17-20: NORMAL volatility regime
 * - Outside trading hours: No trading
 */

import { getMarketData, getVIXData } from '../services/marketDataService.js';
import {
  createReasoning,
  StepReasoning,
  formatNumber,
  formatPercent,
} from './reasoningLogger';

// =============================================================================
// Types
// =============================================================================

export interface MarketRegime {
  shouldTrade: boolean;
  reason: string;
  regime?: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  volatilityRegime?: VolatilityRegime;
  confidence?: number;
  metadata?: {
    currentTime?: string;
    vix?: number;
    vixChange?: number;
    volatilityRegime?: VolatilityRegime;
    spyPrice?: number;
    spyChange?: number;
    trend?: string;
  };
  // NEW: Transparent reasoning chain
  reasoning?: StepReasoning;
}

export type VolatilityRegime = 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME';

// =============================================================================
// Constants - VIX Thresholds
// =============================================================================

// HARD STOP: No trading above this level (user requirement)
const VIX_HARD_STOP_THRESHOLD = 20;

// Classification thresholds
const VIX_LOW_THRESHOLD = 17;      // Below 17 = LOW volatility (ideal for selling)
const VIX_EXTREME_THRESHOLD = 35;  // Above 35 = EXTREME (backup safety)

// Trading Window (ET timezone)
const TRADING_WINDOW_START_HOUR = 11;  // 11:00 AM ET
const TRADING_WINDOW_END_HOUR = 13;    // 1:00 PM ET

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Check if current time is within trading window
 * Trading window: 11:00 AM - 1:00 PM ET
 */
function isWithinTradingHours(): {
  isWithin: boolean;
  currentTimeEt: string;
  dayOfWeek: number;
  isWeekday: boolean;
} {
  const now = new Date();
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));

  const hour = et.getHours();
  const minute = et.getMinutes();
  const currentMinutes = hour * 60 + minute;

  const windowStart = TRADING_WINDOW_START_HOUR * 60;
  const windowEnd = TRADING_WINDOW_END_HOUR * 60;

  const dayOfWeek = et.getDay();
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;

  const isWithin = isWeekday && currentMinutes >= windowStart && currentMinutes < windowEnd;

  return {
    isWithin,
    currentTimeEt: et.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: true }),
    dayOfWeek,
    isWeekday,
  };
}

/**
 * Classify VIX into volatility regime
 */
export function getVolatilityRegime(vixLevel: number): VolatilityRegime {
  if (vixLevel >= VIX_EXTREME_THRESHOLD) return 'EXTREME';
  if (vixLevel >= VIX_HARD_STOP_THRESHOLD) return 'HIGH';  // 20-35
  if (vixLevel >= VIX_LOW_THRESHOLD) return 'NORMAL';      // 17-20
  return 'LOW';  // < 17
}

/**
 * Get regime description for reasoning
 */
function getRegimeDescription(regime: VolatilityRegime): string {
  switch (regime) {
    case 'LOW':
      return 'LOW volatility - Ideal for premium selling, options are cheap';
    case 'NORMAL':
      return 'NORMAL volatility - Acceptable for trading';
    case 'HIGH':
      return 'HIGH volatility - Too risky, premiums elevated but risk is high';
    case 'EXTREME':
      return 'EXTREME volatility - Market in crisis, no trading allowed';
  }
}

// =============================================================================
// Main Function
// =============================================================================

/**
 * Analyze market regime and determine if we should trade
 *
 * This function builds a transparent reasoning chain showing:
 * 1. Trading hours check
 * 2. VIX data fetch
 * 3. VIX threshold check (HARD STOP at 20)
 * 4. Volatility regime classification
 * 5. Final decision
 *
 * @param useRealData - Whether to use real market data (default: true)
 * @returns Market regime analysis with full reasoning chain
 */
export async function analyzeMarketRegime(useRealData: boolean = true): Promise<MarketRegime> {
  // Initialize reasoning builder
  const reasoning = createReasoning(1, 'Market Regime');

  // Step 1.1: Check trading hours
  const tradingHours = isWithinTradingHours();

  reasoning.addInput('currentTimeEt', tradingHours.currentTimeEt);
  reasoning.addInput('dayOfWeek', tradingHours.dayOfWeek);
  reasoning.addInput('tradingWindowStart', `${TRADING_WINDOW_START_HOUR}:00 AM ET`);
  reasoning.addInput('tradingWindowEnd', `${TRADING_WINDOW_END_HOUR}:00 PM ET`);

  reasoning.addLogicStep(
    `Checking trading hours: Current time is ${tradingHours.currentTimeEt}`,
    tradingHours.isWithin ? 'Within trading window' : 'Outside trading window'
  );

  reasoning.addComputation(
    'Trading Hours Check',
    'isWeekday AND currentTime >= windowStart AND currentTime < windowEnd',
    {
      isWeekday: tradingHours.isWeekday,
      currentTimeEt: tradingHours.currentTimeEt,
      windowStart: `${TRADING_WINDOW_START_HOUR}:00 AM`,
      windowEnd: `${TRADING_WINDOW_END_HOUR}:00 PM`,
    },
    tradingHours.isWithin,
    tradingHours.isWithin
      ? 'Market is open for trading'
      : `Trading only allowed between ${TRADING_WINDOW_START_HOUR}:00 AM and ${TRADING_WINDOW_END_HOUR}:00 PM ET on weekdays`
  );

  // Early exit if outside trading hours
  if (!tradingHours.isWithin) {
    const finalReasoning = reasoning.build(
      `CANNOT TRADE: Outside trading window. Current time: ${tradingHours.currentTimeEt}`,
      '🚫',
      0,
      false
    );

    return {
      shouldTrade: false,
      reason: `Outside trading window. Current time: ${tradingHours.currentTimeEt} ET. Trading window: ${TRADING_WINDOW_START_HOUR}:00 AM - ${TRADING_WINDOW_END_HOUR}:00 PM ET`,
      metadata: {
        currentTime: tradingHours.currentTimeEt,
      },
      reasoning: finalReasoning,
    };
  }

  // Step 1.2: Fetch market data
  let vixLevel: number | undefined;
  let vixChange: number | undefined;
  let spyPrice: number | undefined;
  let spyChange: number | undefined;

  if (useRealData) {
    reasoning.addLogicStep('Fetching real-time market data from Yahoo Finance');

    try {
      // Fetch VIX data
      const vixData = await getVIXData();
      vixLevel = vixData.value;
      vixChange = vixData.changePercent;

      reasoning.addInput('vixValue', vixLevel);
      reasoning.addInput('vixChangePct', vixChange);
      reasoning.addLogicStep(
        `Fetched VIX data: ${formatNumber(vixLevel)} (${vixChange >= 0 ? '+' : ''}${formatPercent(vixChange / 100)})`,
        'VIX data received successfully'
      );

      // Fetch SPY data
      const spyData = await getMarketData('SPY');
      spyPrice = spyData.price;
      spyChange = spyData.changePercent;

      reasoning.addInput('spyPrice', spyPrice);
      reasoning.addInput('spyChangePct', spyChange);
      reasoning.addLogicStep(
        `Fetched SPY data: $${formatNumber(spyPrice)} (${spyChange >= 0 ? '+' : ''}${formatPercent(spyChange / 100)})`,
        'SPY data received successfully'
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      reasoning.addLogicStepWithWarning(
        'Failed to fetch market data',
        `Error: ${errorMessage} - Continuing with caution`
      );
      console.error('[Step1] Error fetching market data:', error);
    }
  } else {
    reasoning.addLogicStep('Using mock data (real data disabled)');
  }

  // Step 1.3: Check VIX threshold (HARD STOP at 20)
  if (vixLevel !== undefined) {
    reasoning.addInput('vixHardStopThreshold', VIX_HARD_STOP_THRESHOLD);

    reasoning.addComputation(
      'VIX Hard Stop Check',
      'VIX < hardStopThreshold',
      {
        VIX: vixLevel,
        hardStopThreshold: VIX_HARD_STOP_THRESHOLD,
      },
      vixLevel < VIX_HARD_STOP_THRESHOLD,
      vixLevel < VIX_HARD_STOP_THRESHOLD
        ? `VIX ${formatNumber(vixLevel)} is below hard stop threshold of ${VIX_HARD_STOP_THRESHOLD}`
        : `VIX ${formatNumber(vixLevel)} is AT OR ABOVE hard stop threshold of ${VIX_HARD_STOP_THRESHOLD} - NO TRADING`
    );

    // HARD STOP: VIX >= 20
    if (vixLevel >= VIX_HARD_STOP_THRESHOLD) {
      const volRegime = getVolatilityRegime(vixLevel);

      reasoning.addLogicStep(
        `VIX ${formatNumber(vixLevel)} >= ${VIX_HARD_STOP_THRESHOLD} HARD STOP TRIGGERED`,
        'Trading is NOT allowed when VIX is elevated'
      );

      const finalReasoning = reasoning.build(
        `HARD STOP: VIX at ${formatNumber(vixLevel)} exceeds threshold of ${VIX_HARD_STOP_THRESHOLD}. No trading allowed.`,
        '🛑',
        0,
        false
      );

      return {
        shouldTrade: false,
        reason: `HARD STOP: VIX level ${formatNumber(vixLevel)} >= ${VIX_HARD_STOP_THRESHOLD}. Trading disabled in elevated volatility.`,
        volatilityRegime: volRegime,
        metadata: {
          currentTime: tradingHours.currentTimeEt,
          vix: vixLevel,
          vixChange,
          volatilityRegime: volRegime,
          spyPrice,
          spyChange,
        },
        reasoning: finalReasoning,
      };
    }
  }

  // Step 1.4: Classify volatility regime
  const volRegime = vixLevel ? getVolatilityRegime(vixLevel) : undefined;

  if (volRegime) {
    reasoning.addLogicStep(
      `Classifying volatility regime based on VIX ${formatNumber(vixLevel!)}`,
      getRegimeDescription(volRegime)
    );

    reasoning.addComputation(
      'Volatility Regime Classification',
      'VIX < 17 = LOW, 17-20 = NORMAL',
      {
        VIX: vixLevel!,
        lowThreshold: VIX_LOW_THRESHOLD,
        hardStopThreshold: VIX_HARD_STOP_THRESHOLD,
      },
      volRegime,
      `Current regime: ${volRegime}`
    );
  }

  // Step 1.5: Analyze trend based on SPY movement
  const trend =
    spyChange !== undefined
      ? spyChange > 1
        ? 'BULLISH'
        : spyChange < -1
          ? 'BEARISH'
          : 'NEUTRAL'
      : 'NEUTRAL';

  reasoning.addLogicStep(
    `Analyzing SPY trend from daily change: ${spyChange !== undefined ? formatPercent(spyChange / 100) : 'N/A'}`,
    `Trend classification: ${trend}`
  );

  // Step 1.6: Calculate confidence
  let confidence = 0.7; // Base confidence

  // Adjust based on VIX level
  if (vixLevel) {
    if (vixLevel < 17) {
      confidence += 0.15; // LOW volatility is ideal
      reasoning.addLogicStep(
        'VIX in LOW zone (<17) - ideal for premium selling',
        '+15% confidence'
      );
    } else if (vixLevel >= 17 && vixLevel < 20) {
      confidence += 0.05; // NORMAL is acceptable
      reasoning.addLogicStep(
        'VIX in NORMAL zone (17-20) - acceptable for trading',
        '+5% confidence'
      );
    }
  }

  // Adjust based on trend strength
  if (Math.abs(spyChange || 0) > 2) {
    confidence -= 0.1;
    reasoning.addWarning(`Strong SPY movement (${formatPercent((spyChange || 0) / 100)}) may indicate increased risk`);
  }

  // Clamp confidence
  confidence = Math.min(Math.max(confidence, 0), 1);

  reasoning.addComputation(
    'Confidence Calculation',
    'baseConfidence + vixAdjustment + trendAdjustment',
    {
      baseConfidence: 0.7,
      vixAdjustment: vixLevel && vixLevel < 17 ? 0.15 : vixLevel && vixLevel < 20 ? 0.05 : 0,
      trendAdjustment: Math.abs(spyChange || 0) > 2 ? -0.1 : 0,
    },
    confidence,
    `Final confidence: ${formatPercent(confidence)}`
  );

  // Build final reasoning
  const finalReasoning = reasoning.build(
    `CAN TRADE: VIX at ${formatNumber(vixLevel || 0)} (${volRegime || 'N/A'}), SPY trend ${trend}`,
    '✅',
    confidence * 100,
    true
  );

  // All checks passed
  return {
    shouldTrade: true,
    reason: `Market conditions favorable. VIX: ${volRegime || 'N/A'} (${vixLevel !== undefined ? formatNumber(vixLevel) : 'N/A'})`,
    regime: trend,
    volatilityRegime: volRegime,
    confidence,
    metadata: {
      currentTime: tradingHours.currentTimeEt,
      vix: vixLevel,
      vixChange,
      volatilityRegime: volRegime,
      spyPrice,
      spyChange,
      trend,
    },
    reasoning: finalReasoning,
  };
}

/**
 * Test function to validate Step 1 logic
 */
export async function testStep1(): Promise<void> {
  console.log('Testing Step 1: Market Regime Check\n');

  // Test 1: Current market conditions
  const currentRegime = await analyzeMarketRegime();
  console.log('Current Market Regime:');
  console.log(JSON.stringify(currentRegime, null, 2));

  if (currentRegime.reasoning) {
    console.log('\n=== REASONING CHAIN ===\n');
    console.log(`Step: ${currentRegime.reasoning.step} - ${currentRegime.reasoning.name}`);
    console.log(`Decision: ${currentRegime.reasoning.decisionEmoji} ${currentRegime.reasoning.decision}`);
    console.log(`Confidence: ${currentRegime.reasoning.confidence}%`);
    console.log(`Can Proceed: ${currentRegime.reasoning.canProceed}`);
    console.log('\nLogic Steps:');
    for (const step of currentRegime.reasoning.logic) {
      console.log(`  ${step.index}. ${step.action} => ${step.result || ''}`);
    }
    console.log('\nComputations:');
    for (const comp of currentRegime.reasoning.computations) {
      console.log(`  - ${comp.name}: ${comp.formula}`);
      console.log(`    Result: ${comp.result}`);
    }
  }
}
