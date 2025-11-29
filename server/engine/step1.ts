/**
 * Step 1: Market Regime Check
 * Determines whether market conditions are suitable for trading
 *
 * Enhanced implementation with real market data integration
 * Checks: Trading hours, VIX levels, market trend, volatility regime
 */

import { getMarketData, getVIXData } from '../services/marketDataService.js';

export interface MarketRegime {
  shouldTrade: boolean;
  withinTradingWindow: boolean;  // Separate flag for trading hours
  canExecute: boolean;           // Combined: shouldTrade && withinTradingWindow
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
}

/**
 * Check if current time is within trading window
 * Trading window: 11:00 AM - 1:00 PM ET
 */
function isWithinTradingHours(): boolean {
  const now = new Date();
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));

  const hour = et.getHours();
  const minute = et.getMinutes();
  const currentMinutes = hour * 60 + minute;

  // 11:00 AM = 660 minutes, 1:00 PM = 780 minutes
  const windowStart = 11 * 60; // 11:00 AM
  const windowEnd = 13 * 60;   // 1:00 PM

  // Check if it's a weekday
  const dayOfWeek = et.getDay();
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;

  return isWeekday && currentMinutes >= windowStart && currentMinutes < windowEnd;
}

// VIX Threshold Constants (FIXED per trading strategy)
const VIX_LOW_THRESHOLD = 17;      // Below 17 = LOW volatility
const VIX_HIGH_THRESHOLD = 20;     // Above 20 = HIGH volatility
const VIX_EXTREME_THRESHOLD = 35;  // Above 35 = EXTREME (no trading)

export type VolatilityRegime = 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME';

/**
 * Classify VIX into volatility regime
 * @param vixLevel - Current VIX level
 * @returns Volatility regime classification
 */
export function getVolatilityRegime(vixLevel: number): VolatilityRegime {
  if (vixLevel >= VIX_EXTREME_THRESHOLD) return 'EXTREME';
  if (vixLevel > VIX_HIGH_THRESHOLD) return 'HIGH';
  if (vixLevel < VIX_LOW_THRESHOLD) return 'LOW';
  return 'NORMAL'; // 17-20
}

/**
 * Check VIX levels for market volatility regime
 * @param vixLevel - Current VIX level
 * @returns Whether VIX is in acceptable range for trading
 */
function isVixAcceptable(vixLevel?: number): boolean {
  if (!vixLevel) return true; // If no VIX data, don't block trading

  // Block trading only in EXTREME volatility (VIX > 35)
  const regime = getVolatilityRegime(vixLevel);
  return regime !== 'EXTREME';
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
 * @param useRealData - Whether to use real market data (default: true)
 * @returns Market regime analysis with trade decision
 */
export async function analyzeMarketRegime(useRealData: boolean = true): Promise<MarketRegime> {
  // Step 1: Check trading hours (but DON'T return early - continue for analysis)
  const withinTradingWindow = isWithinTradingHours();
  const now = new Date();
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const currentTimeStr = et.toLocaleTimeString('en-US', { timeZone: 'America/New_York' });

  // Step 2: Fetch real market data
  let vixLevel: number | undefined;
  let vixChange: number | undefined;
  let spyPrice: number | undefined;
  let spyChange: number | undefined;

  if (useRealData) {
    try {
      // Fetch VIX data
      const vixData = await getVIXData();
      vixLevel = vixData.value;
      vixChange = vixData.changePercent;

      // Fetch SPY data
      const spyData = await getMarketData('SPY');
      spyPrice = spyData.price;
      spyChange = spyData.changePercent;
    } catch (error) {
      console.error('[Step1] Error fetching market data:', error);
      // Continue with undefined values, don't block trading on data fetch error
    }
  }

  // Step 3: Check VIX (if available) - determine if market conditions allow trading
  const volRegime = vixLevel ? getVolatilityRegime(vixLevel) : undefined;
  const vixAcceptable = isVixAcceptable(vixLevel);

  // Step 4: Analyze trend based on SPY movement
  const trend = spyChange !== undefined
    ? spyChange > 1 ? 'BULLISH'
    : spyChange < -1 ? 'BEARISH'
    : 'NEUTRAL'
    : analyzeTrend();

  // Calculate confidence based on market conditions
  let confidence = 0.7; // Base confidence

  // Adjust confidence based on VIX level
  if (vixLevel) {
    if (vixLevel >= 15 && vixLevel <= 25) {
      confidence += 0.1; // Ideal VIX range for selling options
    }
    if (vixLevel < 15) {
      confidence -= 0.1; // Low volatility, lower premiums
    }
  }

  // Adjust confidence based on trend clarity
  if (Math.abs(spyChange || 0) > 2) {
    confidence -= 0.1; // Strong trend might mean higher risk
  }

  // Determine trading status
  const shouldTrade = vixAcceptable;  // Based on market conditions only (VIX)
  const canExecute = shouldTrade && withinTradingWindow;  // Combined check

  // Build reason message
  let reason: string;
  if (!vixAcceptable) {
    reason = `VIX level ${vixLevel?.toFixed(2)} is EXTREME (>35). Analysis complete but too risky to trade.`;
  } else if (!withinTradingWindow) {
    reason = `Analysis complete. Outside trading window (${currentTimeStr} ET). Ready to execute when market opens.`;
  } else {
    reason = `Market conditions favorable. VIX: ${volRegime || 'N/A'} (${vixLevel?.toFixed(2) || 'N/A'})`;
  }

  return {
    shouldTrade,
    withinTradingWindow,
    canExecute,
    reason,
    regime: trend,
    volatilityRegime: volRegime,
    confidence: Math.min(Math.max(confidence, 0), 1),
    metadata: {
      currentTime: currentTimeStr,
      vix: vixLevel,
      vixChange,
      volatilityRegime: volRegime,
      spyPrice,
      spyChange,
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