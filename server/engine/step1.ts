/**
 * Step 1: Market Regime Check
 * Determines whether market conditions are suitable for trading
 *
 * Current implementation: Simple trading hours check
 * Future enhancements: VIX levels, market trend, volatility regime
 */

export interface MarketRegime {
  shouldTrade: boolean;
  reason: string;
  regime?: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence?: number;
  metadata?: {
    currentTime?: string;
    vix?: number;
    trend?: string;
  };
}

/**
 * Check if current time is within trading window
 * Trading window: 12:00 PM - 2:00 PM EST
 */
function isWithinTradingHours(): boolean {
  const now = new Date();
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));

  const hour = et.getHours();
  const minute = et.getMinutes();
  const currentMinutes = hour * 60 + minute;

  // 12:00 PM = 720 minutes, 2:00 PM = 840 minutes
  const windowStart = 12 * 60; // 12:00 PM
  const windowEnd = 14 * 60;   // 2:00 PM

  // Check if it's a weekday
  const dayOfWeek = et.getDay();
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;

  return isWeekday && currentMinutes >= windowStart && currentMinutes < windowEnd;
}

/**
 * Future: Check VIX levels for market volatility regime
 * @param vixLevel - Current VIX level
 * @returns Whether VIX is in acceptable range
 */
function isVixAcceptable(vixLevel?: number): boolean {
  if (!vixLevel) return true; // If no VIX data, don't block trading

  // VIX thresholds (can be configured)
  const MIN_VIX = 10;  // Too low volatility, premiums might be too cheap
  const MAX_VIX = 35;  // Too high volatility, too risky

  return vixLevel >= MIN_VIX && vixLevel <= MAX_VIX;
}

/**
 * Future: Analyze market trend
 * @returns Market trend direction
 */
function analyzeTrend(): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
  // TODO: Implement trend analysis
  // - Moving averages
  // - Price momentum
  // - Market breadth
  return 'NEUTRAL';
}

/**
 * Main function: Analyze market regime and determine if we should trade
 * @param mockVix - Optional mock VIX value for testing
 * @returns Market regime analysis with trade decision
 */
export async function analyzeMarketRegime(mockVix?: number): Promise<MarketRegime> {
  // Step 1: Check trading hours
  if (!isWithinTradingHours()) {
    const now = new Date();
    const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
    return {
      shouldTrade: false,
      reason: `Outside trading window. Current time: ${et.toLocaleTimeString('en-US', { timeZone: 'America/New_York' })} ET. Trading window: 12:00 PM - 2:00 PM ET`,
      metadata: {
        currentTime: et.toLocaleTimeString('en-US', { timeZone: 'America/New_York' })
      }
    };
  }

  // Step 2: Check VIX (if available)
  const vixLevel = mockVix; // In production, fetch from market data
  if (!isVixAcceptable(vixLevel)) {
    return {
      shouldTrade: false,
      reason: `VIX level ${vixLevel} outside acceptable range (10-35)`,
      metadata: {
        vix: vixLevel
      }
    };
  }

  // Step 3: Analyze trend (future enhancement)
  const trend = analyzeTrend();

  // All checks passed
  return {
    shouldTrade: true,
    reason: 'Market conditions favorable for trading',
    regime: trend,
    confidence: 0.7, // Baseline confidence, will improve with more indicators
    metadata: {
      currentTime: new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York' }),
      vix: vixLevel,
      trend: trend
    }
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

  // Test 2: With mock VIX values
  console.log('\nTesting with different VIX levels:');

  const vixTests = [5, 15, 25, 40];
  for (const vix of vixTests) {
    const regime = await analyzeMarketRegime(vix);
    console.log(`VIX ${vix}: ${regime.shouldTrade ? '✅ TRADE' : '❌ NO TRADE'} - ${regime.reason}`);
  }
}

// Test function can be called from a separate test file