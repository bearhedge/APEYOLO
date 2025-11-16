/**
 * Step 2: Direction Selection
 * Determines whether to sell PUT, CALL, or STRANGLE (both)
 *
 * Current implementation: Default to STRANGLE for diversification
 * Future enhancements: Trend analysis, momentum indicators, market sentiment
 */

import { MarketRegime } from './step1.ts';

export type TradeDirection = 'PUT' | 'CALL' | 'STRANGLE';

export interface DirectionDecision {
  direction: TradeDirection;
  confidence: number;
  reasoning: string;
  signals?: {
    trend?: 'UP' | 'DOWN' | 'SIDEWAYS';
    momentum?: number;
    strength?: number;
  };
}

/**
 * Analyze price momentum (placeholder for future implementation)
 * @returns Momentum score between -1 (bearish) and 1 (bullish)
 */
function analyzeMomentum(): number {
  // TODO: Implement actual momentum calculation
  // - RSI
  // - MACD
  // - Rate of change
  return 0; // Neutral for now
}

/**
 * Analyze market trend (placeholder for future implementation)
 * @returns Trend direction
 */
function analyzeTrend(): 'UP' | 'DOWN' | 'SIDEWAYS' {
  // TODO: Implement actual trend analysis
  // - Moving average crossovers
  // - Price relative to key MAs
  // - Trend line analysis
  return 'SIDEWAYS';
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
 * Main function: Select trading direction based on market analysis
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

  // Analyze current market conditions
  const momentum = analyzeMomentum();
  const trend = analyzeTrend();
  const confidence = calculateConfidence(trend, momentum);

  // Decision logic (currently simplified)
  let direction: TradeDirection;
  let reasoning: string;

  // Current strategy: Default to STRANGLE for diversification
  // This reduces directional risk and works well in sideways markets
  if (trend === 'SIDEWAYS' || Math.abs(momentum) < 0.3) {
    direction = 'STRANGLE';
    reasoning = 'Sideways market or low momentum - using STRANGLE for balanced premium collection';
  }
  // Future: Add directional bias when signals are strong
  else if (trend === 'UP' && momentum > 0.5) {
    direction = 'PUT'; // Sell puts in uptrend
    reasoning = 'Strong uptrend detected - selling PUT options';
  }
  else if (trend === 'DOWN' && momentum < -0.5) {
    direction = 'CALL'; // Sell calls in downtrend
    reasoning = 'Strong downtrend detected - selling CALL options';
  }
  else {
    // Default to STRANGLE when uncertain
    direction = 'STRANGLE';
    reasoning = 'Mixed signals - using STRANGLE to capture premium from both sides';
  }

  return {
    direction,
    confidence,
    reasoning,
    signals: {
      trend,
      momentum,
      strength: Math.abs(momentum)
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