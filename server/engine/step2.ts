/**
 * Step 2: Direction Selection
 * Determines whether to sell PUT, CALL, or STRANGLE (both)
 *
 * Uses moving average crossover strategy on IBKR 5-minute SPY bars:
 * - 5-bar MA (fast) = 25 minutes of price action
 * - 15-bar MA (slow) = 75 minutes of price action
 * - SPY > MA_FAST && MA_FAST > MA_SLOW → BULLISH → Sell PUTs
 * - SPY < MA_FAST && MA_FAST < MA_SLOW → BEARISH → Sell CALLs
 * - Otherwise → NEUTRAL → Sell STRANGLE
 */

import { MarketRegime } from './step1.ts';
import { fetchIbkrHistoricalData, type IbkrHistoricalBar, type IbkrHistoricalResponse } from '../broker/ibkr.js';
import type { StepReasoning, StepMetric } from '../../shared/types/engineLog';

export type TradeDirection = 'PUT' | 'CALL' | 'STRANGLE';

// MA Configuration (can be made configurable via guard rails)
const MA_FAST_PERIOD = 5;   // 5-period fast MA
const MA_SLOW_PERIOD = 15;  // 15-period slow MA

export interface DirectionDecision {
  direction: TradeDirection;
  confidence: number;
  reasoning: string;
  signals?: {
    trend?: 'UP' | 'DOWN' | 'SIDEWAYS';
    momentum?: number;
    strength?: number;
    spyPrice?: number;
    maFast?: number;
    maSlow?: number;
  };
  // Enhanced logging
  stepReasoning?: StepReasoning[];
  stepMetrics?: StepMetric[];
}

/**
 * Calculate Simple Moving Average from price array
 */
function calculateSMA(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  return slice.reduce((sum, p) => sum + p, 0) / period;
}

// SPY conid for IBKR
const SPY_CONID = 756733;

/**
 * Fetch SPY 5-minute bars from IBKR and calculate MAs
 */
async function getSPYWithMAs(): Promise<{
  price: number;
  maFast: number;
  maSlow: number;
  bars: number;
} | null> {
  try {
    // Fetch 1-day of 5-minute bars from IBKR
    console.log('[Step2] Fetching SPY 5-minute bars from IBKR...');
    const response: IbkrHistoricalResponse = await fetchIbkrHistoricalData(SPY_CONID, {
      period: '1d',
      bar: '5mins',
      outsideRth: false,  // Only regular trading hours
    });

    const bars = response.data;
    if (!bars || bars.length < MA_SLOW_PERIOD) {
      console.log(`[Step2] Insufficient IBKR SPY history: ${bars?.length || 0} bars (need ${MA_SLOW_PERIOD})`);
      return null;
    }

    // Extract close prices from IBKR bars
    const closes = bars.map(bar => bar.c);

    // Calculate MAs on 5-minute bars
    // MA5 = average of last 5 bars = 25 minutes of price action
    // MA15 = average of last 15 bars = 75 minutes of price action
    const maFast = calculateSMA(closes, MA_FAST_PERIOD);
    const maSlow = calculateSMA(closes, MA_SLOW_PERIOD);

    if (!maFast || !maSlow) {
      console.log('[Step2] Could not calculate MAs from IBKR data');
      return null;
    }

    // Current price is the most recent close
    const currentPrice = closes[closes.length - 1];

    console.log(`[Step2] IBKR Data: ${bars.length} bars, SPY: $${currentPrice.toFixed(2)}, MA${MA_FAST_PERIOD}: $${maFast.toFixed(2)}, MA${MA_SLOW_PERIOD}: $${maSlow.toFixed(2)}`);

    return { price: currentPrice, maFast, maSlow, bars: bars.length };
  } catch (error) {
    console.error('[Step2] Error fetching IBKR SPY data:', error);
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
 * Calculate directional confidence based on signals
 * @param trend - Market trend
 * @param momentum - Momentum score
 * @returns Confidence score 0-1
 */
function calculateConfidence(trend: 'UP' | 'DOWN' | 'SIDEWAYS', momentum: number): number {
  // Base confidence
  let confidence = 0.5;

  // Adjust based on trend clarity
  if (trend === 'UP' || trend === 'DOWN') {
    confidence += 0.2; // Clear trend adds confidence
  }

  // Adjust based on momentum strength
  confidence += Math.abs(momentum) * 0.3; // Strong momentum adds up to 0.3

  return Math.min(confidence, 1.0);
}

/**
 * Main function: Select trading direction based on MA crossover strategy
 * @param marketRegime - Market regime from Step 1
 * @param mockDirection - Optional mock direction for testing
 * @returns Direction decision with reasoning
 */
export async function selectDirection(
  marketRegime: MarketRegime,
  mockDirection?: TradeDirection
): Promise<DirectionDecision> {
  // If mock direction provided (for testing)
  if (mockDirection) {
    return {
      direction: mockDirection,
      confidence: 0.8,
      reasoning: 'Using mock direction for testing',
      stepReasoning: [
        { question: 'Data source?', answer: 'MOCK (testing mode)' },
        { question: 'What strategy?', answer: `SELL ${mockDirection}` }
      ],
      stepMetrics: [
        { label: 'Mode', value: 'Testing', status: 'warning' },
        { label: 'Confidence', value: '80%', status: 'normal' }
      ]
    };
  }

  // Fetch real SPY data with MAs
  const spyData = await getSPYWithMAs();

  // If we couldn't get MA data, default to STRANGLE
  if (!spyData) {
    return {
      direction: 'STRANGLE',
      confidence: 0.5,
      reasoning: 'Could not fetch SPY data - defaulting to STRANGLE for safety',
      signals: {
        trend: 'SIDEWAYS',
        momentum: 0,
        strength: 0
      },
      stepReasoning: [
        { question: 'SPY data available?', answer: 'NO (fetch failed or insufficient bars)' },
        { question: 'What strategy?', answer: 'SELL STRANGLE (safe default for unknown trend)' },
        { question: 'Why STRANGLE?', answer: 'Neutral strategy profits from time decay regardless of direction' }
      ],
      stepMetrics: [
        { label: 'Data Status', value: 'UNAVAILABLE', status: 'critical' },
        { label: 'Confidence', value: '50%', status: 'warning' },
        { label: 'Fallback', value: 'Active', status: 'warning' }
      ]
    };
  }

  const { price, maFast, maSlow, bars } = spyData;

  // Analyze trend based on MA crossover
  const trend = analyzeMAtrend(price, maFast, maSlow);
  const momentum = calculateMomentum(price, maFast, maSlow);
  const confidence = calculateConfidence(trend, momentum);

  // Decision logic based on MA crossover
  let direction: TradeDirection;
  let reasoning: string;

  if (trend === 'UP') {
    // Bullish: SPY > MA5 > MA15 → Sell PUTs (bullish strategy)
    direction = 'PUT';
    reasoning = `Bullish trend: SPY ($${price.toFixed(2)}) > MA${MA_FAST_PERIOD} ($${maFast.toFixed(2)}) > MA${MA_SLOW_PERIOD} ($${maSlow.toFixed(2)}) - Selling PUTs`;
  }
  else if (trend === 'DOWN') {
    // Bearish: SPY < MA5 < MA15 → Sell CALLs (bearish strategy)
    direction = 'CALL';
    reasoning = `Bearish trend: SPY ($${price.toFixed(2)}) < MA${MA_FAST_PERIOD} ($${maFast.toFixed(2)}) < MA${MA_SLOW_PERIOD} ($${maSlow.toFixed(2)}) - Selling CALLs`;
  }
  else {
    // Sideways/mixed → STRANGLE (neutral strategy)
    direction = 'STRANGLE';
    reasoning = `Mixed signals: SPY ($${price.toFixed(2)}), MA${MA_FAST_PERIOD} ($${maFast.toFixed(2)}), MA${MA_SLOW_PERIOD} ($${maSlow.toFixed(2)}) - Using STRANGLE`;
  }

  console.log(`[Step2] Direction: ${direction} (${trend}) - Confidence: ${(confidence * 100).toFixed(0)}%`);

  // Build enhanced reasoning Q&A
  const maDiff = maFast - maSlow;
  const maDiffStr = maDiff >= 0 ? `+$${maDiff.toFixed(2)}` : `-$${Math.abs(maDiff).toFixed(2)}`;
  const strengthLabel = Math.abs(momentum) > 0.3 ? 'STRONG' : Math.abs(momentum) > 0.15 ? 'MODERATE' : 'WEAK';

  const stepReasoning: StepReasoning[] = [
    {
      question: 'What is market trend?',
      answer: trend === 'UP'
        ? `BULLISH (MA${MA_FAST_PERIOD} > MA${MA_SLOW_PERIOD})`
        : trend === 'DOWN'
          ? `BEARISH (MA${MA_FAST_PERIOD} < MA${MA_SLOW_PERIOD})`
          : 'SIDEWAYS (mixed signals)'
    },
    {
      question: 'How strong is the trend?',
      answer: `${strengthLabel} (${maDiffStr} MA difference)`
    },
    {
      question: 'What strategy?',
      answer: direction === 'PUT'
        ? 'SELL PUT (bullish - profit if SPY stays above strike)'
        : direction === 'CALL'
          ? 'SELL CALL (bearish - profit if SPY stays below strike)'
          : 'SELL STRANGLE (neutral - profit from time decay)'
    }
  ];

  // Build enhanced metrics
  const stepMetrics: StepMetric[] = [
    {
      label: `MA${MA_FAST_PERIOD} (Fast)`,
      value: `$${maFast.toFixed(2)}`,
      status: 'normal'
    },
    {
      label: `MA${MA_SLOW_PERIOD} (Slow)`,
      value: `$${maSlow.toFixed(2)}`,
      status: 'normal'
    },
    {
      label: 'SPY Price',
      value: `$${price.toFixed(2)}`,
      status: 'normal'
    },
    {
      label: 'Momentum',
      value: `${(momentum * 100).toFixed(1)}%`,
      status: Math.abs(momentum) > 0.3 ? 'normal' : Math.abs(momentum) > 0.15 ? 'normal' : 'warning'
    },
    {
      label: 'Confidence',
      value: `${(confidence * 100).toFixed(0)}%`,
      status: confidence >= 0.7 ? 'normal' : confidence >= 0.5 ? 'warning' : 'critical'
    },
    {
      label: 'Data Source',
      value: `IBKR 5-min (${bars} bars)`,
      status: 'normal'
    }
  ];

  return {
    direction,
    confidence,
    reasoning,
    signals: {
      trend,
      momentum,
      strength: Math.abs(momentum),
      spyPrice: price,
      maFast,
      maSlow
    },
    stepReasoning,
    stepMetrics
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
    regime: 'NEUTRAL'
  };

  // Test 1: Default behavior
  const defaultDecision = await selectDirection(mockRegime);
  console.log('Default Direction Decision:');
  console.log(JSON.stringify(defaultDecision, null, 2));

  // Test 2: Test each direction
  console.log('\nTesting mock directions:');
  const directions: TradeDirection[] = ['PUT', 'CALL', 'STRANGLE'];

  for (const dir of directions) {
    const decision = await selectDirection(mockRegime, dir);
    console.log(`${dir}: Confidence ${(decision.confidence * 100).toFixed(0)}% - ${decision.reasoning}`);
  }
}

// Test function can be called from a separate test file