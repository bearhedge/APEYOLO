/**
 * Step 2: Direction Selection
 * Determines whether to sell PUT, CALL, or STRANGLE (both)
 *
 * Enhanced implementation with:
 * - Multiple indicator analysis (MA crossover, RSI, momentum)
 * - Transparent reasoning chain
 * - NEUTRAL handling: Sell STRANGLE with further OTM delta (0.10-0.15)
 *
 * Logic:
 * - SPY > MA_FAST && MA_FAST > MA_SLOW → BULLISH → Sell PUTs (delta 0.15-0.20)
 * - SPY < MA_FAST && MA_FAST < MA_SLOW → BEARISH → Sell CALLs (delta 0.15-0.20)
 * - Otherwise → NEUTRAL → Sell STRANGLE (delta 0.10-0.15, further OTM)
 */

import { MarketRegime } from './step1';
import { fetchHistoricalData, fetchQuote } from '../services/yahooFinanceService.js';
import {
  createReasoning,
  StepReasoning,
  formatNumber,
  formatPercent,
} from './reasoningLogger';

// =============================================================================
// Types
// =============================================================================

export type TradeDirection = 'PUT' | 'CALL' | 'STRANGLE';
export type BiasDirection = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

export interface DirectionDecision {
  direction: TradeDirection;
  bias: BiasDirection;
  confidence: number;
  reasoning: string;
  // Delta targets vary based on direction
  targetDelta: {
    min: number;
    max: number;
    ideal: number;
  };
  signals?: {
    trend?: 'UP' | 'DOWN' | 'SIDEWAYS';
    momentum?: number;
    strength?: number;
    spyPrice?: number;
    maFast?: number;
    maSlow?: number;
    rsi?: number;
    maAlignment?: string;
  };
  // NEW: Transparent reasoning chain
  stepReasoning?: StepReasoning;
}

// =============================================================================
// Constants
// =============================================================================

// MA Configuration
const MA_FAST_PERIOD = 5;   // 5-period fast MA
const MA_SLOW_PERIOD = 15;  // 15-period slow MA

// Delta Targets
// Normal directional trades: 0.15-0.20 delta
const NORMAL_DELTA_MIN = 0.15;
const NORMAL_DELTA_MAX = 0.20;
const NORMAL_DELTA_IDEAL = 0.18;

// Neutral/STRANGLE trades: 0.10-0.15 delta (further OTM for safety)
const NEUTRAL_DELTA_MIN = 0.10;
const NEUTRAL_DELTA_MAX = 0.15;
const NEUTRAL_DELTA_IDEAL = 0.12;

// RSI thresholds
const RSI_PERIOD = 14;
const RSI_OVERBOUGHT = 70;
const RSI_OVERSOLD = 30;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Calculate Simple Moving Average from price array
 */
function calculateSMA(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  return slice.reduce((sum, p) => sum + p, 0) / period;
}

/**
 * Calculate RSI (Relative Strength Index)
 */
function calculateRSI(prices: number[], period: number = RSI_PERIOD): number | null {
  if (prices.length < period + 1) return null;

  const changes: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i] - prices[i - 1]);
  }

  const recentChanges = changes.slice(-period);
  const gains = recentChanges.filter(c => c > 0);
  const losses = recentChanges.filter(c => c < 0).map(c => Math.abs(c));

  const avgGain = gains.length > 0 ? gains.reduce((a, b) => a + b, 0) / period : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / period : 0;

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

/**
 * Fetch SPY intraday data and calculate indicators
 */
async function getSPYWithIndicators(): Promise<{
  price: number;
  maFast: number;
  maSlow: number;
  rsi: number | null;
  closes: number[];
} | null> {
  try {
    // Fetch 1-day intraday data (5-min bars)
    const history = await fetchHistoricalData('SPY', '1D');

    if (!history || history.length < MA_SLOW_PERIOD) {
      console.log(`[Step2] Insufficient SPY history: ${history?.length || 0} bars (need ${MA_SLOW_PERIOD})`);
      return null;
    }

    // Extract close prices
    const closes = history.map(bar => bar.close);

    // Calculate MAs
    const maFast = calculateSMA(closes, MA_FAST_PERIOD);
    const maSlow = calculateSMA(closes, MA_SLOW_PERIOD);

    if (!maFast || !maSlow) {
      console.log('[Step2] Could not calculate MAs');
      return null;
    }

    // Calculate RSI
    const rsi = calculateRSI(closes);

    // Get current price (last close)
    const currentPrice = closes[closes.length - 1];

    console.log(`[Step2] SPY: $${currentPrice.toFixed(2)}, MA${MA_FAST_PERIOD}: $${maFast.toFixed(2)}, MA${MA_SLOW_PERIOD}: $${maSlow.toFixed(2)}, RSI: ${rsi?.toFixed(1) || 'N/A'}`);

    return { price: currentPrice, maFast, maSlow, rsi, closes };
  } catch (error) {
    console.error('[Step2] Error fetching SPY data:', error);
    return null;
  }
}

/**
 * Analyze trend based on MA crossover
 */
function analyzeMAtrend(price: number, maFast: number, maSlow: number): 'UP' | 'DOWN' | 'SIDEWAYS' {
  // Bullish: Price above fast MA AND fast MA above slow MA
  if (price > maFast && maFast > maSlow) {
    return 'UP';
  }

  // Bearish: Price below fast MA AND fast MA below slow MA
  if (price < maFast && maFast < maSlow) {
    return 'DOWN';
  }

  // Sideways/mixed signals
  return 'SIDEWAYS';
}

/**
 * Calculate momentum from MA spread
 */
function calculateMomentum(price: number, maFast: number, maSlow: number): number {
  // Calculate percentage spread between fast and slow MA
  const maSpread = ((maFast - maSlow) / maSlow) * 100;

  // Calculate price distance from fast MA
  const priceSpread = ((price - maFast) / maFast) * 100;

  // Combined momentum score: -1 to +1
  const momentum = Math.tanh((maSpread + priceSpread) / 2);

  return momentum;
}

/**
 * Get MA alignment string for reasoning
 */
function getMAAlignmentString(price: number, maFast: number, maSlow: number): string {
  const sorted = [
    { label: 'SPY', value: price },
    { label: `MA${MA_FAST_PERIOD}`, value: maFast },
    { label: `MA${MA_SLOW_PERIOD}`, value: maSlow },
  ].sort((a, b) => b.value - a.value);

  return sorted.map(s => s.label).join(' > ');
}

// =============================================================================
// Main Function
// =============================================================================

/**
 * Select trading direction based on multi-indicator analysis
 *
 * This function builds a transparent reasoning chain showing:
 * 1. SPY data fetch
 * 2. MA crossover analysis
 * 3. RSI analysis (if available)
 * 4. Momentum calculation
 * 5. Direction decision with appropriate delta targets
 *
 * @param marketRegime - Market regime from Step 1
 * @param mockDirection - Optional mock direction for testing
 * @returns Direction decision with full reasoning chain
 */
export async function selectDirection(
  marketRegime: MarketRegime,
  mockDirection?: TradeDirection
): Promise<DirectionDecision> {
  // Initialize reasoning builder
  const reasoning = createReasoning(2, 'Direction');

  // If mock direction provided (for testing)
  if (mockDirection) {
    const finalReasoning = reasoning
      .addLogicStep('Using mock direction for testing', mockDirection)
      .build(
        `Mock direction: ${mockDirection}`,
        '🧪',
        80,
        true
      );

    return {
      direction: mockDirection,
      bias: mockDirection === 'PUT' ? 'BULLISH' : mockDirection === 'CALL' ? 'BEARISH' : 'NEUTRAL',
      confidence: 0.8,
      reasoning: 'Using mock direction for testing',
      targetDelta: {
        min: mockDirection === 'STRANGLE' ? NEUTRAL_DELTA_MIN : NORMAL_DELTA_MIN,
        max: mockDirection === 'STRANGLE' ? NEUTRAL_DELTA_MAX : NORMAL_DELTA_MAX,
        ideal: mockDirection === 'STRANGLE' ? NEUTRAL_DELTA_IDEAL : NORMAL_DELTA_IDEAL,
      },
      stepReasoning: finalReasoning,
    };
  }

  // Add market regime context
  reasoning.addInput('marketRegime', marketRegime.regime || 'N/A');
  reasoning.addInput('volatilityRegime', marketRegime.volatilityRegime || 'N/A');
  reasoning.addInput('vixLevel', marketRegime.metadata?.vix || 'N/A');

  reasoning.addLogicStep(
    `Received market regime from Step 1: ${marketRegime.regime || 'N/A'}, VIX: ${marketRegime.volatilityRegime || 'N/A'}`
  );

  // Fetch real SPY data with indicators
  reasoning.addLogicStep('Fetching SPY intraday data for MA crossover analysis');

  const spyData = await getSPYWithIndicators();

  // If we couldn't get data, default to STRANGLE with further OTM
  if (!spyData) {
    reasoning.addLogicStepWithWarning(
      'Failed to fetch SPY data',
      'Defaulting to STRANGLE strategy with conservative delta targets'
    );

    const finalReasoning = reasoning.build(
      'STRANGLE (data unavailable): Using conservative further OTM strikes',
      '⚠️',
      50,
      true
    );

    return {
      direction: 'STRANGLE',
      bias: 'NEUTRAL',
      confidence: 0.5,
      reasoning: 'Could not fetch SPY data - defaulting to STRANGLE with conservative delta',
      targetDelta: {
        min: NEUTRAL_DELTA_MIN,
        max: NEUTRAL_DELTA_MAX,
        ideal: NEUTRAL_DELTA_IDEAL,
      },
      signals: {
        trend: 'SIDEWAYS',
        momentum: 0,
        strength: 0,
      },
      stepReasoning: finalReasoning,
    };
  }

  const { price, maFast, maSlow, rsi } = spyData;

  // Add SPY data as inputs
  reasoning.addInput('spyPrice', price);
  reasoning.addInput('maFast', maFast);
  reasoning.addInput('maSlow', maSlow);
  reasoning.addInput('maFastPeriod', MA_FAST_PERIOD);
  reasoning.addInput('maSlowPeriod', MA_SLOW_PERIOD);
  if (rsi !== null) reasoning.addInput('rsi', rsi);

  reasoning.addLogicStep(
    `SPY data received: $${formatNumber(price)}`,
    `MA${MA_FAST_PERIOD}: $${formatNumber(maFast)}, MA${MA_SLOW_PERIOD}: $${formatNumber(maSlow)}`
  );

  // Analyze trend based on MA crossover
  const trend = analyzeMAtrend(price, maFast, maSlow);
  const momentum = calculateMomentum(price, maFast, maSlow);
  const maAlignment = getMAAlignmentString(price, maFast, maSlow);

  reasoning.addLogicStep(
    `MA crossover analysis: ${maAlignment}`,
    `Trend: ${trend}`
  );

  reasoning.addComputation(
    'MA Crossover',
    'price > maFast && maFast > maSlow → UP, price < maFast && maFast < maSlow → DOWN, else SIDEWAYS',
    {
      price,
      maFast,
      maSlow,
      priceAboveFast: price > maFast,
      fastAboveSlow: maFast > maSlow,
    },
    trend,
    `Trend is ${trend} based on MA alignment: ${maAlignment}`
  );

  // RSI analysis (if available)
  let rsiSignal: 'OVERBOUGHT' | 'OVERSOLD' | 'NEUTRAL' = 'NEUTRAL';
  if (rsi !== null) {
    if (rsi > RSI_OVERBOUGHT) rsiSignal = 'OVERBOUGHT';
    else if (rsi < RSI_OVERSOLD) rsiSignal = 'OVERSOLD';

    reasoning.addLogicStep(
      `RSI(${RSI_PERIOD}) = ${formatNumber(rsi, 1)}`,
      rsiSignal === 'OVERBOUGHT'
        ? 'Overbought (>70) - bearish signal'
        : rsiSignal === 'OVERSOLD'
          ? 'Oversold (<30) - bullish signal'
          : 'Neutral (30-70)'
    );

    reasoning.addComputation(
      'RSI Analysis',
      `RSI > ${RSI_OVERBOUGHT} = OVERBOUGHT, RSI < ${RSI_OVERSOLD} = OVERSOLD, else NEUTRAL`,
      {
        rsi,
        overboughtThreshold: RSI_OVERBOUGHT,
        oversoldThreshold: RSI_OVERSOLD,
      },
      rsiSignal
    );
  }

  // Momentum calculation
  reasoning.addComputation(
    'Momentum',
    'tanh((maSpread + priceSpread) / 2)',
    {
      maSpread: ((maFast - maSlow) / maSlow * 100).toFixed(2) + '%',
      priceSpread: ((price - maFast) / maFast * 100).toFixed(2) + '%',
    },
    formatNumber(momentum, 3),
    `Momentum score: ${momentum > 0.1 ? 'Bullish' : momentum < -0.1 ? 'Bearish' : 'Neutral'}`
  );

  // Decision logic based on indicators
  let direction: TradeDirection;
  let bias: BiasDirection;
  let targetDelta: { min: number; max: number; ideal: number };
  let decisionReasoning: string;

  if (trend === 'UP') {
    // Bullish: SPY > MA5 > MA15 → Sell PUTs
    direction = 'PUT';
    bias = 'BULLISH';
    targetDelta = {
      min: NORMAL_DELTA_MIN,
      max: NORMAL_DELTA_MAX,
      ideal: NORMAL_DELTA_IDEAL,
    };
    decisionReasoning = `Bullish trend detected: ${maAlignment}. Selling PUTs at delta ${NORMAL_DELTA_IDEAL}`;

    reasoning.addLogicStep(
      `Bullish alignment: ${maAlignment}`,
      'Sell PUTs (bearish options) to profit from bullish market'
    );

    // Check for RSI divergence warning
    if (rsiSignal === 'OVERBOUGHT') {
      reasoning.addWarning('RSI shows overbought - trend may reverse soon');
    }

  } else if (trend === 'DOWN') {
    // Bearish: SPY < MA5 < MA15 → Sell CALLs
    direction = 'CALL';
    bias = 'BEARISH';
    targetDelta = {
      min: NORMAL_DELTA_MIN,
      max: NORMAL_DELTA_MAX,
      ideal: NORMAL_DELTA_IDEAL,
    };
    decisionReasoning = `Bearish trend detected: ${maAlignment}. Selling CALLs at delta ${NORMAL_DELTA_IDEAL}`;

    reasoning.addLogicStep(
      `Bearish alignment: ${maAlignment}`,
      'Sell CALLs (bullish options) to profit from bearish market'
    );

    // Check for RSI divergence warning
    if (rsiSignal === 'OVERSOLD') {
      reasoning.addWarning('RSI shows oversold - trend may reverse soon');
    }

  } else {
    // Sideways/mixed → STRANGLE with FURTHER OTM (delta 0.10-0.15)
    direction = 'STRANGLE';
    bias = 'NEUTRAL';
    targetDelta = {
      min: NEUTRAL_DELTA_MIN,
      max: NEUTRAL_DELTA_MAX,
      ideal: NEUTRAL_DELTA_IDEAL,
    };
    decisionReasoning = `Mixed signals - no clear trend. Selling STRANGLE at delta ${NEUTRAL_DELTA_IDEAL} (further OTM for safety)`;

    reasoning.addLogicStep(
      `Mixed/sideways signals: ${maAlignment}`,
      'Direction unclear - selling STRANGLE (both PUT and CALL)'
    );

    reasoning.addLogicStep(
      'Using further OTM delta (0.10-0.15) for STRANGLE',
      'Reduces directional risk when market direction is unclear'
    );
  }

  // Calculate confidence
  let confidence = 0.5; // Base confidence

  // Adjust based on trend clarity
  if (trend === 'UP' || trend === 'DOWN') {
    confidence += 0.2; // Clear trend adds confidence
  }

  // Adjust based on momentum strength
  confidence += Math.abs(momentum) * 0.3;

  // RSI confirmation adds confidence
  if ((trend === 'UP' && rsiSignal !== 'OVERBOUGHT') ||
      (trend === 'DOWN' && rsiSignal !== 'OVERSOLD')) {
    confidence += 0.1; // No divergence
  } else if ((trend === 'UP' && rsiSignal === 'OVERBOUGHT') ||
             (trend === 'DOWN' && rsiSignal === 'OVERSOLD')) {
    confidence -= 0.1; // Divergence warning
  }

  confidence = Math.min(Math.max(confidence, 0), 1);

  reasoning.addComputation(
    'Confidence Calculation',
    'baseConfidence + trendClarity + momentumStrength + rsiAdjustment',
    {
      baseConfidence: 0.5,
      trendClarity: trend !== 'SIDEWAYS' ? 0.2 : 0,
      momentumStrength: (Math.abs(momentum) * 0.3).toFixed(2),
      rsiAdjustment: rsiSignal ? (
        (trend === 'UP' && rsiSignal === 'OVERBOUGHT') ||
        (trend === 'DOWN' && rsiSignal === 'OVERSOLD') ? -0.1 : 0.1
      ) : 0,
    },
    formatPercent(confidence),
    `Confidence: ${formatPercent(confidence)}`
  );

  // Build final reasoning
  const emoji = direction === 'PUT' ? '📈' : direction === 'CALL' ? '📉' : '↔️';
  const finalReasoning = reasoning.build(
    `${direction} (${bias}): ${decisionReasoning}`,
    emoji,
    confidence * 100,
    true
  );

  console.log(`[Step2] Direction: ${direction} (${bias}) - Confidence: ${formatPercent(confidence)} - Delta target: ${targetDelta.ideal}`);

  return {
    direction,
    bias,
    confidence,
    reasoning: decisionReasoning,
    targetDelta,
    signals: {
      trend,
      momentum,
      strength: Math.abs(momentum),
      spyPrice: price,
      maFast,
      maSlow,
      rsi: rsi || undefined,
      maAlignment,
    },
    stepReasoning: finalReasoning,
  };
}

/**
 * Test function to validate Step 2 logic
 */
export async function testStep2(): Promise<void> {
  console.log('Testing Step 2: Direction Selection\n');

  // Mock market regime (assuming we can trade)
  const mockRegime: MarketRegime = {
    shouldTrade: true,
    reason: 'Market conditions favorable',
    regime: 'NEUTRAL',
    volatilityRegime: 'LOW',
    metadata: {
      vix: 15.5,
    },
  };

  // Test 1: Default behavior with real data
  const defaultDecision = await selectDirection(mockRegime);
  console.log('Default Direction Decision:');
  console.log(JSON.stringify(defaultDecision, null, 2));

  if (defaultDecision.stepReasoning) {
    console.log('\n=== REASONING CHAIN ===\n');
    console.log(`Step: ${defaultDecision.stepReasoning.step} - ${defaultDecision.stepReasoning.name}`);
    console.log(`Decision: ${defaultDecision.stepReasoning.decisionEmoji} ${defaultDecision.stepReasoning.decision}`);
    console.log(`Confidence: ${defaultDecision.stepReasoning.confidence}%`);

    console.log('\nLogic Steps:');
    for (const step of defaultDecision.stepReasoning.logic) {
      console.log(`  ${step.index}. ${step.action} => ${step.result || ''}`);
    }

    console.log('\nDelta Targets:');
    console.log(`  Min: ${defaultDecision.targetDelta.min}`);
    console.log(`  Max: ${defaultDecision.targetDelta.max}`);
    console.log(`  Ideal: ${defaultDecision.targetDelta.ideal}`);
  }
}
