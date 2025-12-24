/**
 * Step 2: Direction Selection
 * Determines whether to sell PUT, CALL, or STRANGLE (both)
 *
 * Timeframe-adapted logic based on expiration mode:
 *
 * 0DTE (SPY daily):
 * - 5-minute bars, MA50 = ~4 hours of price action
 * - ±0.5% threshold for flat/trending day
 *
 * WEEKLY (ARM Friday):
 * - 1-hour bars, MA50 = ~50 hours (~6 trading days)
 * - ±3.0% threshold (conservative, defaults to strangle)
 *
 * Decision Logic:
 * - All 3 bars > MA + exceeds threshold → BULLISH → Sell PUTs
 * - All 3 bars < MA + exceeds threshold → BEARISH → Sell CALLs
 * - Within threshold or mixed bars → NEUTRAL → Sell STRANGLE
 */

import { MarketRegime } from './step1.ts';
import { fetchIbkrHistoricalData, resolveSymbolConid, type IbkrHistoricalBar, type IbkrHistoricalResponse } from '../broker/ibkr.js';
import type { StepReasoning, StepMetric } from '../../shared/types/engineLog';

export type TradeDirection = 'PUT' | 'CALL' | 'STRANGLE';
export type ExpirationMode = '0DTE' | 'WEEKLY';

// =============================================================================
// Timeframe Configuration by Expiration Mode
// =============================================================================

interface TimeframeConfig {
  barSize: '5mins' | '30mins' | '1hour';
  maPeriod: number;
  flatThresholdPct: number;
  confirmationBars: number;
  dataPeriod: string;  // IBKR period parameter
}

const TIMEFRAME_CONFIG: Record<ExpirationMode, TimeframeConfig> = {
  '0DTE': {
    barSize: '5mins',
    maPeriod: 50,           // ~4 hours of price action
    flatThresholdPct: 0.5,  // ±0.5% = flat day → STRANGLE
    confirmationBars: 3,
    dataPeriod: '1d',       // 1 day of 5-min bars
  },
  'WEEKLY': {
    barSize: '1hour',       // 1-hour bars for weekly options
    maPeriod: 50,           // ~50 hours (~6 trading days)
    flatThresholdPct: 3.0,  // ±3.0% = neutral → STRANGLE (conservative)
    confirmationBars: 3,
    dataPeriod: '1w',       // 1 week of 1-hour bars
  },
};

export interface DirectionDecision {
  direction: TradeDirection;
  confidence: number;
  reasoning: string;
  signals?: {
    trend?: 'UP' | 'DOWN' | 'SIDEWAYS';
    momentum?: number;
    strength?: number;
    symbolPrice?: number;
    ma?: number;
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

/**
 * Fetch historical bars for any symbol using timeframe config
 * @param symbol - Trading symbol (SPY, ARM, etc.)
 * @param config - Timeframe configuration
 */
async function getSymbolWithMA(
  symbol: string,
  config: TimeframeConfig
): Promise<{
  currentPrice: number;
  ma: number;
  lastBars: number[];
  totalBars: number;
} | null> {
  try {
    // Resolve the conid for this symbol
    const conid = await resolveSymbolConid(symbol);
    if (!conid) {
      console.log(`[Step2] Could not resolve conid for ${symbol}`);
      return null;
    }

    console.log(`[Step2] Fetching ${symbol} ${config.barSize} bars from IBKR (conid=${conid})...`);
    const response: IbkrHistoricalResponse = await fetchIbkrHistoricalData(conid, {
      period: config.dataPeriod,
      bar: config.barSize,
      outsideRth: false,  // Only regular trading hours
    });

    const bars = response.data;
    if (!bars || bars.length < config.maPeriod) {
      console.log(`[Step2] Insufficient IBKR ${symbol} history: ${bars?.length || 0} bars (need ${config.maPeriod})`);
      return null;
    }

    // Extract close prices from IBKR bars
    const closes = bars.map(bar => bar.c);

    // Calculate MA
    const ma = calculateSMA(closes, config.maPeriod);
    if (!ma) {
      console.log(`[Step2] Could not calculate MA${config.maPeriod} from IBKR data`);
      return null;
    }

    // Get last N bar closes for trend confirmation
    const lastBars = closes.slice(-config.confirmationBars);
    const currentPrice = closes[closes.length - 1];

    console.log(`[Step2] IBKR Data: ${bars.length} ${config.barSize} bars, ${symbol}: $${currentPrice.toFixed(2)}, MA${config.maPeriod}: $${ma.toFixed(2)}`);
    console.log(`[Step2] Last ${config.confirmationBars} bars: [${lastBars.map(p => `$${p.toFixed(2)}`).join(', ')}]`);

    return { currentPrice, ma, lastBars, totalBars: bars.length };
  } catch (error) {
    console.error(`[Step2] Error fetching IBKR ${symbol} data:`, error);
    return null;
  }
}

/**
 * Analyze trend by checking if last N bars are consistently above/below MA
 * @param lastBars - Last N bar close prices
 * @param ma - Moving average value
 * @param confirmationBars - Number of bars required for confirmation
 * @returns Trend direction
 */
function analyzeTrend(lastBars: number[], ma: number, confirmationBars: number): 'UP' | 'DOWN' | 'SIDEWAYS' {
  const aboveCount = lastBars.filter(price => price > ma).length;
  const belowCount = lastBars.filter(price => price < ma).length;

  console.log(`[Step2] Trend analysis: ${aboveCount} bars above MA, ${belowCount} bars below MA`);

  // All bars above MA → clear uptrend
  if (aboveCount === confirmationBars) {
    return 'UP';
  }

  // All bars below MA → clear downtrend
  if (belowCount === confirmationBars) {
    return 'DOWN';
  }

  // Mixed signals → sideways/uncertain
  return 'SIDEWAYS';
}

/**
 * Calculate momentum based on how far last bar is from MA
 * @param currentPrice - Current price
 * @param ma - Moving average value
 * @returns Momentum score -1 to +1
 */
function calculateMomentum(currentPrice: number, ma: number): number {
  // Calculate percentage distance from MA
  const pctDiff = ((currentPrice - ma) / ma) * 100;

  // Clamp to -1 to +1 range using tanh
  return Math.tanh(pctDiff / 2);
}

/**
 * Calculate directional confidence based on trend and momentum
 * @param trend - Market trend
 * @param lastBars - Last N bar prices
 * @param ma - Moving average value
 * @returns Confidence score 0-1
 */
function calculateConfidence(trend: 'UP' | 'DOWN' | 'SIDEWAYS', lastBars: number[], ma: number): number {
  // Base confidence
  let confidence = 0.5;

  // Clear trend adds confidence
  if (trend === 'UP' || trend === 'DOWN') {
    confidence += 0.25;

    // Check how consistently bars are on one side of MA
    const distances = lastBars.map(p => Math.abs((p - ma) / ma));
    const avgDistance = distances.reduce((a, b) => a + b, 0) / distances.length;

    // Greater distance from MA = more confidence (up to 0.25 more)
    confidence += Math.min(avgDistance * 10, 0.25);
  }

  return Math.min(confidence, 1.0);
}

/**
 * Strategy preference for single-leg trades
 */
export type StrategyPreference = 'strangle' | 'put-only' | 'call-only';

/**
 * Main function: Select trading direction based on MA strategy
 * Timeframe-adapted for different expiration modes (0DTE vs WEEKLY)
 *
 * @param marketRegime - Market regime from Step 1
 * @param symbol - Trading symbol (SPY, ARM, etc.)
 * @param expirationMode - Expiration mode (0DTE or WEEKLY)
 * @param mockDirection - Optional mock direction for testing
 * @param forcedStrategy - Optional strategy override (put-only, call-only, or strangle)
 * @returns Direction decision with reasoning
 */
export async function selectDirection(
  marketRegime: MarketRegime,
  symbol: string = 'SPY',
  expirationMode: ExpirationMode = '0DTE',
  mockDirection?: TradeDirection,
  forcedStrategy?: StrategyPreference
): Promise<DirectionDecision> {
  // Get timeframe configuration based on expiration mode
  const config = TIMEFRAME_CONFIG[expirationMode];
  const { maPeriod, flatThresholdPct, confirmationBars, barSize } = config;

  console.log(`[Step2] Using ${expirationMode} config: ${barSize} bars, MA${maPeriod}, ±${flatThresholdPct}% threshold`);

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

  // If forced strategy provided (user override)
  if (forcedStrategy && forcedStrategy !== 'strangle') {
    const direction: TradeDirection = forcedStrategy === 'put-only' ? 'PUT' : 'CALL';
    const directionLabel = direction === 'PUT' ? 'Bullish (sell PUT)' : 'Bearish (sell CALL)';
    console.log(`[Step2] Using FORCED strategy: ${forcedStrategy} → ${direction}`);
    return {
      direction,
      confidence: 0.85, // High confidence since user explicitly chose
      reasoning: `User selected ${forcedStrategy} strategy - Selling ${direction} only`,
      signals: {
        trend: direction === 'PUT' ? 'UP' : 'DOWN', // Implied bias from strategy choice
        momentum: 0,
        strength: 0,
      },
      stepReasoning: [
        { question: 'Strategy source?', answer: `USER OVERRIDE (${forcedStrategy})` },
        { question: 'What strategy?', answer: `SELL ${direction} (${directionLabel})` },
        { question: 'Why this direction?', answer: 'User explicitly selected single-leg strategy based on market view' }
      ],
      stepMetrics: [
        { label: 'Mode', value: 'User Override', status: 'normal' },
        { label: 'Strategy', value: forcedStrategy.toUpperCase(), status: 'normal' },
        { label: 'Direction', value: direction, status: 'normal' },
        { label: 'Confidence', value: '85%', status: 'normal' }
      ]
    };
  }

  // Fetch symbol data with appropriate MA based on config
  const symbolData = await getSymbolWithMA(symbol, config);

  // If we couldn't get MA data, default to STRANGLE
  if (!symbolData) {
    return {
      direction: 'STRANGLE',
      confidence: 0.5,
      reasoning: `Could not fetch ${symbol} data - defaulting to STRANGLE for safety`,
      signals: {
        trend: 'SIDEWAYS',
        momentum: 0,
        strength: 0
      },
      stepReasoning: [
        { question: `${symbol} data available?`, answer: 'NO (fetch failed or insufficient bars)' },
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

  const { currentPrice, ma, lastBars, totalBars } = symbolData;

  // Analyze trend based on last N bars vs MA
  const trend = analyzeTrend(lastBars, ma, confirmationBars);
  const momentum = calculateMomentum(currentPrice, ma);
  const confidence = calculateConfidence(trend, lastBars, ma);

  // Calculate percentage distance from MA
  const pctFromMA = ((currentPrice - ma) / ma) * 100;
  const absPctFromMA = Math.abs(pctFromMA);
  const thresholdDollar = (flatThresholdPct / 100) * ma;

  console.log(`[Step2] ${symbol} distance from MA${maPeriod}: ${pctFromMA.toFixed(3)}% ($${(currentPrice - ma).toFixed(2)}), threshold: ±${flatThresholdPct}% ($${thresholdDollar.toFixed(2)})`);

  // Decision logic:
  // 1. If within threshold of MA → NEUTRAL → STRANGLE (regardless of bar confirmation)
  // 2. Only go directional if BOTH: trend confirmed AND exceeds threshold
  let direction: TradeDirection;
  let reasoning: string;

  const barsStr = lastBars.map(p => `$${p.toFixed(2)}`).join(', ');

  // NEUTRAL: Within threshold of MA → default to STRANGLE
  if (absPctFromMA < flatThresholdPct) {
    direction = 'STRANGLE';
    reasoning = `Neutral: ${symbol} ${pctFromMA >= 0 ? '+' : ''}${pctFromMA.toFixed(2)}% from MA${maPeriod} (within ±${flatThresholdPct}% threshold) - Using STRANGLE`;
    console.log(`[Step2] NEUTRAL detected: ${pctFromMA.toFixed(2)}% < ±${flatThresholdPct}% threshold → STRANGLE`);
  }
  // TRENDING: Exceeds threshold, check bar confirmation
  else if (trend === 'UP' && pctFromMA > flatThresholdPct) {
    // Bullish: All bars above MA AND exceeds threshold → Sell PUTs
    direction = 'PUT';
    reasoning = `Bullish trending: ${symbol} +${pctFromMA.toFixed(2)}% above MA${maPeriod} & all ${confirmationBars} bars confirm - Selling PUTs`;
  }
  else if (trend === 'DOWN' && pctFromMA < -flatThresholdPct) {
    // Bearish: All bars below MA AND exceeds threshold → Sell CALLs
    direction = 'CALL';
    reasoning = `Bearish trending: ${symbol} ${pctFromMA.toFixed(2)}% below MA${maPeriod} & all ${confirmationBars} bars confirm - Selling CALLs`;
  }
  else {
    // Mixed signals OR bars don't confirm → STRANGLE
    direction = 'STRANGLE';
    if (trend === 'SIDEWAYS') {
      reasoning = `Mixed bars: [${barsStr}] around MA${maPeriod} ($${ma.toFixed(2)}) - Using STRANGLE`;
    } else {
      // Trend exists but doesn't match price direction (unusual)
      reasoning = `Unconfirmed trend: bars show ${trend} but price ${pctFromMA.toFixed(2)}% from MA${maPeriod} - Using STRANGLE for safety`;
    }
  }

  console.log(`[Step2] Direction: ${direction} (${trend}) - Confidence: ${(confidence * 100).toFixed(0)}%`);

  // Build enhanced reasoning Q&A
  const priceDiff = currentPrice - ma;
  const priceDiffStr = priceDiff >= 0 ? `+$${priceDiff.toFixed(2)}` : `-$${Math.abs(priceDiff).toFixed(2)}`;
  const pctStr = pctFromMA >= 0 ? `+${pctFromMA.toFixed(2)}%` : `${pctFromMA.toFixed(2)}%`;
  const strengthLabel = Math.abs(momentum) > 0.3 ? 'STRONG' : Math.abs(momentum) > 0.15 ? 'MODERATE' : 'WEAK';
  const isNeutral = absPctFromMA < flatThresholdPct;

  const stepReasoning: StepReasoning[] = [
    {
      question: `Is ${symbol} neutral or trending?`,
      answer: isNeutral
        ? `NEUTRAL (${pctStr} from MA${maPeriod}, within ±${flatThresholdPct}% threshold)`
        : `TRENDING (${pctStr} from MA${maPeriod}, exceeds ±${flatThresholdPct}% threshold)`
    },
    {
      question: 'What is bar confirmation?',
      answer: trend === 'UP'
        ? `BULLISH (all ${confirmationBars} bars > MA${maPeriod})`
        : trend === 'DOWN'
          ? `BEARISH (all ${confirmationBars} bars < MA${maPeriod})`
          : `MIXED (bars split around MA${maPeriod})`
    },
    {
      question: 'What strategy?',
      answer: direction === 'PUT'
        ? `SELL PUT (bullish trending - profit if ${symbol} stays above strike)`
        : direction === 'CALL'
          ? `SELL CALL (bearish trending - profit if ${symbol} stays below strike)`
          : isNeutral
            ? `SELL STRANGLE (neutral ${expirationMode === 'WEEKLY' ? 'week' : 'day'} - hedge both directions)`
            : 'SELL STRANGLE (unconfirmed trend - hedge both directions)'
    }
  ];

  // Build enhanced metrics
  const stepMetrics: StepMetric[] = [
    {
      label: 'Mode',
      value: expirationMode,
      status: 'normal'
    },
    {
      label: 'Day Type',
      value: isNeutral ? 'NEUTRAL' : 'TRENDING',
      status: isNeutral ? 'warning' : 'normal'
    },
    {
      label: 'Distance %',
      value: pctStr,
      status: isNeutral ? 'warning' : 'normal'
    },
    {
      label: `MA${maPeriod}`,
      value: `$${ma.toFixed(2)}`,
      status: 'normal'
    },
    {
      label: `${symbol} Price`,
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
      value: `IBKR (${totalBars} ${barSize} bars)`,
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
      symbolPrice: currentPrice,
      ma
    },
    stepReasoning,
    stepMetrics
  };
}

/**
 * Test function to validate Step 2 logic
 */
export async function testStep2(): Promise<void> {
  console.log('Testing Step 2: Direction Selection (Timeframe-Adapted MA Strategy)\n');

  // Mock market regime (assuming we can trade)
  const mockRegime: MarketRegime = {
    shouldTrade: true,
    withinTradingWindow: true,
    canExecute: true,
    reason: 'Market conditions favorable',
    regime: 'NEUTRAL'
  };

  // Test 1: SPY 0DTE (default)
  console.log('=== Testing SPY 0DTE (5-min bars, ±0.5% threshold) ===');
  const spyDecision = await selectDirection(mockRegime, 'SPY', '0DTE');
  console.log('SPY 0DTE Decision:');
  console.log(JSON.stringify(spyDecision, null, 2));

  // Test 2: ARM WEEKLY
  console.log('\n=== Testing ARM WEEKLY (1-hour bars, ±3.0% threshold) ===');
  const armDecision = await selectDirection(mockRegime, 'ARM', 'WEEKLY');
  console.log('ARM WEEKLY Decision:');
  console.log(JSON.stringify(armDecision, null, 2));

  // Test 3: Test each mock direction
  console.log('\nTesting mock directions:');
  const directions: TradeDirection[] = ['PUT', 'CALL', 'STRANGLE'];

  for (const dir of directions) {
    const decision = await selectDirection(mockRegime, 'SPY', '0DTE', dir);
    console.log(`${dir}: Confidence ${(decision.confidence * 100).toFixed(0)}% - ${decision.reasoning}`);
  }
}

// Test function can be called from a separate test file
