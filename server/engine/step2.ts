/**
 * Step 2: Direction Selection
 * Determines whether to sell PUT, CALL, or STRANGLE (both)
 *
 * Uses moving average crossover strategy on intraday SPY data:
 * - 5-period MA (fast) and 15-period MA (slow) on minute bars
 * - SPY > MA_FAST && MA_FAST > MA_SLOW → BULLISH → Sell PUTs
 * - SPY < MA_FAST && MA_FAST < MA_SLOW → BEARISH → Sell CALLs
 * - Otherwise → NEUTRAL → Sell STRANGLE
 */

import { MarketRegime } from './step1.ts';
import { fetchHistoricalData, fetchQuote } from '../services/yahooFinanceService.js';

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
}

/**
 * Calculate Simple Moving Average from price array
 */
function calculateSMA(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  return slice.reduce((sum, p) => sum + p, 0) / period;
}

/**
 * Fetch SPY intraday data and calculate MAs
 */
async function getSPYWithMAs(): Promise<{
  price: number;
  maFast: number;
  maSlow: number;
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

    // Get current price (last close or fetch live quote)
    const currentPrice = closes[closes.length - 1];

    console.log(`[Step2] SPY: $${currentPrice.toFixed(2)}, MA${MA_FAST_PERIOD}: $${maFast.toFixed(2)}, MA${MA_SLOW_PERIOD}: $${maSlow.toFixed(2)}`);

    return { price: currentPrice, maFast, maSlow };
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
      reasoning: 'Using mock direction for testing'
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
      }
    };
  }

  const { price, maFast, maSlow } = spyData;

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
    }
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