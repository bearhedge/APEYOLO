/**
 * Step 2: Direction Selection
 * Determines whether to sell PUT, CALL, or STRANGLE (both)
 *
 * Uses MA50 on IBKR 5-minute SPY bars (live data):
 * - MA50 = 50 bars × 5 min = ~4 hours of price action
 * - Check last 3 bars vs MA50 for trend confirmation
 * - All 3 bars > MA50 → BULLISH → Sell PUTs
 * - All 3 bars < MA50 → BEARISH → Sell CALLs
 * - Mixed signals → NEUTRAL → Sell STRANGLE
 */

import { MarketRegime } from './step1.ts';
import { fetchIbkrHistoricalData, type IbkrHistoricalBar, type IbkrHistoricalResponse } from '../broker/ibkr.js';
import type { StepReasoning, StepMetric } from '../../shared/types/engineLog';

export type TradeDirection = 'PUT' | 'CALL' | 'STRANGLE';

// MA Configuration
const MA_PERIOD = 50;  // 50-period MA on 5-min bars = ~4 hours of price action
const CONFIRMATION_BARS = 3;  // Check last 3 bars for trend confirmation
const TREND_THRESHOLD_PCT = 0.5;  // 0.5% threshold for directional trades (flat days → STRANGLE)

export interface DirectionDecision {
  direction: TradeDirection;
  confidence: number;
  reasoning: string;
  signals?: {
    trend?: 'UP' | 'DOWN' | 'SIDEWAYS';
    momentum?: number;
    strength?: number;
    spyPrice?: number;
    ma50?: number;
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
 * Fetch SPY 5-minute bars from IBKR and calculate MA50
 */
async function getSPYWithMA50(): Promise<{
  currentPrice: number;
  ma50: number;
  lastBars: number[];  // Last 3 bar closes for trend confirmation
  totalBars: number;
} | null> {
  try {
    // Fetch 1-day of 5-minute bars from IBKR (should give us 78 bars for a full trading day)
    console.log('[Step2] Fetching SPY 5-minute bars from IBKR...');
    const response: IbkrHistoricalResponse = await fetchIbkrHistoricalData(SPY_CONID, {
      period: '1d',
      bar: '5mins',
      outsideRth: false,  // Only regular trading hours
    });

    const bars = response.data;
    if (!bars || bars.length < MA_PERIOD) {
      console.log(`[Step2] Insufficient IBKR SPY history: ${bars?.length || 0} bars (need ${MA_PERIOD})`);
      return null;
    }

    // Extract close prices from IBKR bars
    const closes = bars.map(bar => bar.c);

    // Calculate MA50
    const ma50 = calculateSMA(closes, MA_PERIOD);
    if (!ma50) {
      console.log('[Step2] Could not calculate MA50 from IBKR data');
      return null;
    }

    // Get last 3 bar closes for trend confirmation
    const lastBars = closes.slice(-CONFIRMATION_BARS);
    const currentPrice = closes[closes.length - 1];

    console.log(`[Step2] IBKR Data: ${bars.length} bars, SPY: $${currentPrice.toFixed(2)}, MA50: $${ma50.toFixed(2)}`);
    console.log(`[Step2] Last ${CONFIRMATION_BARS} bars: [${lastBars.map(p => `$${p.toFixed(2)}`).join(', ')}]`);

    return { currentPrice, ma50, lastBars, totalBars: bars.length };
  } catch (error) {
    console.error('[Step2] Error fetching IBKR SPY data:', error);
    return null;
  }
}

/**
 * Analyze trend by checking if last 3 bars are consistently above/below MA50
 * @param lastBars - Last 3 bar close prices
 * @param ma50 - 50-period moving average
 * @returns Trend direction
 */
function analyzeTrend(lastBars: number[], ma50: number): 'UP' | 'DOWN' | 'SIDEWAYS' {
  const aboveCount = lastBars.filter(price => price > ma50).length;
  const belowCount = lastBars.filter(price => price < ma50).length;

  console.log(`[Step2] Trend analysis: ${aboveCount} bars above MA50, ${belowCount} bars below MA50`);

  // All 3 bars above MA50 → clear uptrend
  if (aboveCount === CONFIRMATION_BARS) {
    return 'UP';
  }

  // All 3 bars below MA50 → clear downtrend
  if (belowCount === CONFIRMATION_BARS) {
    return 'DOWN';
  }

  // Mixed signals → sideways/uncertain
  return 'SIDEWAYS';
}

/**
 * Calculate momentum based on how far last bar is from MA50
 * @param currentPrice - Current price
 * @param ma50 - 50-period moving average
 * @returns Momentum score -1 to +1
 */
function calculateMomentum(currentPrice: number, ma50: number): number {
  // Calculate percentage distance from MA50
  const pctDiff = ((currentPrice - ma50) / ma50) * 100;

  // Clamp to -1 to +1 range using tanh
  return Math.tanh(pctDiff / 2);
}

/**
 * Calculate directional confidence based on trend and momentum
 * @param trend - Market trend
 * @param lastBars - Last 3 bar prices
 * @param ma50 - MA50 value
 * @returns Confidence score 0-1
 */
function calculateConfidence(trend: 'UP' | 'DOWN' | 'SIDEWAYS', lastBars: number[], ma50: number): number {
  // Base confidence
  let confidence = 0.5;

  // Clear trend adds confidence
  if (trend === 'UP' || trend === 'DOWN') {
    confidence += 0.25;

    // Check how consistently bars are on one side of MA50
    const distances = lastBars.map(p => Math.abs((p - ma50) / ma50));
    const avgDistance = distances.reduce((a, b) => a + b, 0) / distances.length;

    // Greater distance from MA50 = more confidence (up to 0.25 more)
    confidence += Math.min(avgDistance * 10, 0.25);
  }

  return Math.min(confidence, 1.0);
}

/**
 * Main function: Select trading direction based on MA50 strategy
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

  // Fetch real SPY data with MA50
  const spyData = await getSPYWithMA50();

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

  const { currentPrice, ma50, lastBars, totalBars } = spyData;

  // Analyze trend based on last 3 bars vs MA50
  const trend = analyzeTrend(lastBars, ma50);
  const momentum = calculateMomentum(currentPrice, ma50);
  const confidence = calculateConfidence(trend, lastBars, ma50);

  // Calculate percentage distance from MA50
  const pctFromMA50 = ((currentPrice - ma50) / ma50) * 100;
  const absPctFromMA50 = Math.abs(pctFromMA50);
  const thresholdDollar = (TREND_THRESHOLD_PCT / 100) * ma50;

  console.log(`[Step2] Price distance from MA50: ${pctFromMA50.toFixed(3)}% ($${(currentPrice - ma50).toFixed(2)}), threshold: ±${TREND_THRESHOLD_PCT}% ($${thresholdDollar.toFixed(2)})`);

  // Decision logic:
  // 1. If within ±0.5% of MA50 → FLAT DAY → STRANGLE (regardless of bar confirmation)
  // 2. Only go directional if BOTH: trend confirmed AND >0.5% from MA50
  let direction: TradeDirection;
  let reasoning: string;

  const barsStr = lastBars.map(p => `$${p.toFixed(2)}`).join(', ');

  // FLAT DAY: SPY within ±0.5% of MA50 → default to STRANGLE
  if (absPctFromMA50 < TREND_THRESHOLD_PCT) {
    direction = 'STRANGLE';
    reasoning = `Flat day: SPY ${pctFromMA50 >= 0 ? '+' : ''}${pctFromMA50.toFixed(2)}% from MA50 (within ±${TREND_THRESHOLD_PCT}% threshold) - Using STRANGLE`;
    console.log(`[Step2] FLAT DAY detected: ${pctFromMA50.toFixed(2)}% < ±${TREND_THRESHOLD_PCT}% threshold → STRANGLE`);
  }
  // TRENDING DAY: >0.5% from MA50, now check bar confirmation
  else if (trend === 'UP' && pctFromMA50 > TREND_THRESHOLD_PCT) {
    // Bullish: All 3 bars above MA50 AND >0.5% above → Sell PUTs
    direction = 'PUT';
    reasoning = `Bullish trending: SPY +${pctFromMA50.toFixed(2)}% above MA50 & all ${CONFIRMATION_BARS} bars confirm - Selling PUTs`;
  }
  else if (trend === 'DOWN' && pctFromMA50 < -TREND_THRESHOLD_PCT) {
    // Bearish: All 3 bars below MA50 AND >0.5% below → Sell CALLs
    direction = 'CALL';
    reasoning = `Bearish trending: SPY ${pctFromMA50.toFixed(2)}% below MA50 & all ${CONFIRMATION_BARS} bars confirm - Selling CALLs`;
  }
  else {
    // Mixed signals OR bars don't confirm → STRANGLE
    direction = 'STRANGLE';
    if (trend === 'SIDEWAYS') {
      reasoning = `Mixed bars: [${barsStr}] around MA50 ($${ma50.toFixed(2)}) - Using STRANGLE`;
    } else {
      // Trend exists but doesn't match price direction (unusual)
      reasoning = `Unconfirmed trend: bars show ${trend} but price ${pctFromMA50.toFixed(2)}% from MA50 - Using STRANGLE for safety`;
    }
  }

  console.log(`[Step2] Direction: ${direction} (${trend}) - Confidence: ${(confidence * 100).toFixed(0)}%`);

  // Build enhanced reasoning Q&A
  const priceDiff = currentPrice - ma50;
  const priceDiffStr = priceDiff >= 0 ? `+$${priceDiff.toFixed(2)}` : `-$${Math.abs(priceDiff).toFixed(2)}`;
  const pctStr = pctFromMA50 >= 0 ? `+${pctFromMA50.toFixed(2)}%` : `${pctFromMA50.toFixed(2)}%`;
  const strengthLabel = Math.abs(momentum) > 0.3 ? 'STRONG' : Math.abs(momentum) > 0.15 ? 'MODERATE' : 'WEAK';
  const isFlatDay = absPctFromMA50 < TREND_THRESHOLD_PCT;

  const stepReasoning: StepReasoning[] = [
    {
      question: 'Is today a flat or trending day?',
      answer: isFlatDay
        ? `FLAT (${pctStr} from MA50, within ±${TREND_THRESHOLD_PCT}% threshold)`
        : `TRENDING (${pctStr} from MA50, exceeds ±${TREND_THRESHOLD_PCT}% threshold)`
    },
    {
      question: 'What is bar confirmation?',
      answer: trend === 'UP'
        ? `BULLISH (all ${CONFIRMATION_BARS} bars > MA50)`
        : trend === 'DOWN'
          ? `BEARISH (all ${CONFIRMATION_BARS} bars < MA50)`
          : `MIXED (bars split around MA50)`
    },
    {
      question: 'What strategy?',
      answer: direction === 'PUT'
        ? 'SELL PUT (bullish trending - profit if SPY stays above strike)'
        : direction === 'CALL'
          ? 'SELL CALL (bearish trending - profit if SPY stays below strike)'
          : isFlatDay
            ? 'SELL STRANGLE (flat day - hedge both directions)'
            : 'SELL STRANGLE (unconfirmed trend - hedge both directions)'
    }
  ];

  // Build enhanced metrics
  const stepMetrics: StepMetric[] = [
    {
      label: 'Day Type',
      value: isFlatDay ? 'FLAT' : 'TRENDING',
      status: isFlatDay ? 'warning' : 'normal'
    },
    {
      label: 'Distance %',
      value: pctStr,
      status: isFlatDay ? 'warning' : 'normal'
    },
    {
      label: 'MA50',
      value: `$${ma50.toFixed(2)}`,
      status: 'normal'
    },
    {
      label: 'SPY Price',
      value: `$${currentPrice.toFixed(2)}`,
      status: 'normal'
    },
    {
      label: 'Bars',
      value: trend === 'UP' ? 'All above' : trend === 'DOWN' ? 'All below' : 'Mixed',
      status: trend === 'SIDEWAYS' ? 'warning' : 'normal'
    },
    {
      label: 'Data Source',
      value: `IBKR (${totalBars} bars)`,
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
      spyPrice: currentPrice,
      ma50
    },
    stepReasoning,
    stepMetrics
  };
}

/**
 * Test function to validate Step 2 logic
 */
export async function testStep2(): Promise<void> {
  console.log('Testing Step 2: Direction Selection (MA50 Strategy)\n');

  // Mock market regime (assuming we can trade)
  const mockRegime: MarketRegime = {
    shouldTrade: true,
    withinTradingWindow: true,
    canExecute: true,
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
