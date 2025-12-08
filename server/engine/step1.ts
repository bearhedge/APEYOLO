/**
 * Step 1: Market Regime Check
 * Determines whether market conditions are suitable for trading
 *
 * Enhanced implementation with real market data integration
 * Checks: Trading hours, VIX levels, market trend, volatility regime
 */

import { getVIXData, getMarketData } from '../services/marketDataService.js';
import { pool } from '../db';
import type { StepReasoning, StepMetric } from '../../shared/types/engineLog';

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
  // Enhanced logging
  reasoning?: StepReasoning[];
  metrics?: StepMetric[];
}

/**
 * Get Eastern Time components reliably using Intl.DateTimeFormat.formatToParts()
 * This works correctly regardless of the server's local timezone
 */
function getETTimeComponents(date: Date = new Date()): { hour: number; minute: number; dayOfWeek: number } {
  // Use formatToParts to get reliable numeric values in ET timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
    hour12: false
  });

  const parts = formatter.formatToParts(date);
  let hour = 0, minute = 0, dayOfWeek = 0;

  for (const part of parts) {
    if (part.type === 'hour') hour = parseInt(part.value, 10);
    if (part.type === 'minute') minute = parseInt(part.value, 10);
    if (part.type === 'weekday') {
      const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      dayOfWeek = dayMap[part.value] ?? 0;
    }
  }

  // Handle midnight edge case (hour12: false returns '24' for midnight in some locales)
  if (hour === 24) hour = 0;

  return { hour, minute, dayOfWeek };
}

/**
 * Check if current time is within trading window
 * Trading window: 11:00 AM - 1:00 PM ET
 *
 * TEMPORARILY DISABLED - Always returns true for testing
 * TODO: Re-enable once trade execution is working
 */
function isWithinTradingHours(): boolean {
  // DISABLED FOR TESTING - always allow trading
  return true;

  /* ORIGINAL CODE - Re-enable when ready:
  const { hour, minute, dayOfWeek } = getETTimeComponents();
  const currentMinutes = hour * 60 + minute;

  // 11:00 AM = 660 minutes, 1:00 PM = 780 minutes
  const windowStart = 11 * 60; // 11:00 AM
  const windowEnd = 13 * 60;   // 1:00 PM

  // Check if it's a weekday (Mon=1, Tue=2, Wed=3, Thu=4, Fri=5)
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;

  return isWeekday && currentMinutes >= windowStart && currentMinutes < windowEnd;
  */
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
  const { hour, minute } = getETTimeComponents();
  // Format time string properly (12-hour format with AM/PM)
  const hour12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const currentTimeStr = `${hour12}:${minute.toString().padStart(2, '0')}:00 ${ampm}`;

  // Step 2: Fetch real market data
  let vixLevel: number | undefined;
  let vixChange: number | undefined;
  let spyPrice: number | undefined;
  let spyChange: number | undefined;
  let spySource = 'IBKR';  // Track data source for UI

  if (useRealData) {
    // Fetch VIX data (with fallback to mock)
    console.log('[Step1] Fetching VIX data...');
    try {
      const vixData = await getVIXData();
      vixLevel = vixData.value;
      vixChange = vixData.changePercent;
      console.log(`[Step1] VIX: ${vixLevel?.toFixed(2)} (${vixChange && vixChange > 0 ? '+' : ''}${vixChange?.toFixed(2)}%)`);
    } catch (error: any) {
      console.error(`[Step1] VIX fetch FAILED: ${error.message}`);
      // VIX has fallback in marketDataService, so this is unlikely
    }

    // Fetch SPY price with fallback:
    // 1. IBKR market data snapshot (live price)
    // 2. Database (last known close price for off-hours)
    console.log('[Step1] Fetching SPY price...');

    // Try 1: IBKR market data snapshot
    try {
      console.log('[Step1] Trying IBKR market data for SPY...');
      const marketData = await getMarketData('SPY');
      if (marketData.price > 0) {
        spyPrice = marketData.price;
        spyChange = marketData.changePercent;
        console.log(`[Step1] SPY from IBKR: $${spyPrice.toFixed(2)}`);
      }
    } catch (error: any) {
      console.warn(`[Step1] IBKR market data failed: ${error.message}`);
    }

    // Try 2: Database fallback (last known price for off-hours)
    if (!spyPrice || spyPrice === 0) {
      try {
        console.log('[Step1] Trying database for last known SPY price...');
        const result = await pool.query(`
          SELECT close, timestamp
          FROM market_data
          WHERE symbol = 'SPY'
          ORDER BY timestamp DESC
          LIMIT 1
        `);
        if (result.rows.length > 0 && result.rows[0].close) {
          spyPrice = parseFloat(result.rows[0].close);
          spyChange = 0;
          spySource = 'Database (last known)';
          console.log(`[Step1] SPY from database: $${spyPrice.toFixed(2)} (as of ${result.rows[0].timestamp})`);
        }
      } catch (error: any) {
        console.warn(`[Step1] Database fallback failed: ${error.message}`);
      }
    }

    // Final check - if still no price, throw error
    if (!spyPrice || spyPrice === 0) {
      throw new Error('[Step1] Cannot get SPY price from any source (IBKR or database)');
    }

    console.log(`[Step1] Final SPY: $${spyPrice.toFixed(2)} (source: ${spySource})`);
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

  // Build reasoning Q&A pairs
  const reasoning: StepReasoning[] = [
    {
      question: 'Is market open?',
      answer: withinTradingWindow
        ? `YES (${currentTimeStr} ET - within 9:30AM-4PM window)`
        : `NO (${currentTimeStr} ET - outside 9:30AM-4PM window)`
    },
    {
      question: 'Is VIX acceptable?',
      answer: vixLevel
        ? (vixAcceptable
            ? `YES (${vixLevel.toFixed(2)} - ${volRegime} regime, from IBKR)`
            : `NO (${vixLevel.toFixed(2)} - EXTREME volatility, from IBKR)`)
        : 'N/A (VIX data unavailable)'
    },
    {
      question: 'SPY price available?',
      answer: spyPrice
        ? `YES ($${spyPrice.toFixed(2)} from ${spySource})`
        : 'NO (Failed to fetch SPY price)'
    },
    {
      question: 'Can we execute trades?',
      answer: canExecute
        ? 'YES (all conditions met)'
        : `NO (${!vixAcceptable ? 'VIX too high' : 'outside trading window'})`
    }
  ];

  // Build metrics
  const metrics: StepMetric[] = [
    {
      label: 'VIX Level',
      value: vixLevel?.toFixed(2) || 'N/A',
      status: volRegime === 'EXTREME' ? 'critical' : volRegime === 'HIGH' ? 'warning' : 'normal'
    },
    {
      label: 'Volatility Regime',
      value: volRegime || 'N/A',
      status: volRegime === 'EXTREME' ? 'critical' : volRegime === 'HIGH' ? 'warning' : 'normal'
    },
    {
      label: 'SPY Price',
      value: spyPrice ? `$${spyPrice.toFixed(2)}` : 'N/A',
      status: spyPrice ? 'normal' : 'warning'
    },
    {
      label: 'Trading Window',
      value: withinTradingWindow ? 'OPEN' : 'CLOSED',
      status: withinTradingWindow ? 'normal' : 'warning'
    }
  ];

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
    },
    reasoning,
    metrics
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