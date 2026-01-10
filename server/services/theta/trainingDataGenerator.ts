/**
 * Training Data Generator
 *
 * Generates RLHF training examples from Theta historical data.
 *
 * For each historical trading day:
 * 1. Captures the 11 AM snapshot (what you would have seen)
 * 2. Calculates the actual outcome by 4 PM
 * 3. Determines the optimal direction and conviction
 * 4. Computes efficiency score
 * 5. Saves to training_examples table
 */

import { db } from '../../db';
import { trainingExamples } from '@shared/schema';
import {
  fetchOptionsOHLC,
  fetchOptionsChain,
  getTradingDays,
  formatDate,
  parseDate,
  get0DTEExpiration,
  type ThetaOptionsBar,
  type Interval,
} from './thetaClient';
import { getVIX } from '../yahooFinanceService';

// ============================================
// Types
// ============================================

interface MarketSnapshot {
  timestamp: string;
  underlyingPrice: number;
  vix: number | null;
  optionsBars: ThetaOptionsBar[];
  indicators: {
    priceChange5m: number;
    priceChange15m: number;
    priceChange30m: number;
    volumeAvg: number;
    highLowRange: number;
  };
}

interface TrainingLabel {
  actualOutcome: number; // % change from snapshot to 4 PM
  intradayHigh: number;
  intradayLow: number;
  optimalDirection: 'PUT' | 'CALL' | 'STRANGLE' | 'NO_TRADE';
  conviction: 'STRONG' | 'MEDIUM' | 'WEAK';
  optimalStrike: number | null;
  theoreticalMaxPnl: number | null;
  efficiencyScore: number | null;
}

// ============================================
// Direction Logic
// ============================================

/**
 * Determine optimal direction based on actual outcome.
 *
 * For credit spreads:
 * - If market went UP: selling PUTs was optimal (sell puts in strength)
 * - If market went DOWN: selling CALLs was optimal (sell calls in weakness)
 * - If market was FLAT: STRANGLE was optimal (collect theta both ways)
 */
function determineOptimalDirection(
  outcomePercent: number,
  intradayRange: number
): { direction: 'PUT' | 'CALL' | 'STRANGLE' | 'NO_TRADE'; conviction: 'STRONG' | 'MEDIUM' | 'WEAK' } {
  const absOutcome = Math.abs(outcomePercent);

  // High volatility day - might have been better to skip
  if (intradayRange > 2.5) {
    return { direction: 'NO_TRADE', conviction: 'STRONG' };
  }

  // Determine direction based on outcome
  if (outcomePercent > 1.0) {
    // Strong up move - PUT was definitely correct
    return { direction: 'PUT', conviction: 'STRONG' };
  } else if (outcomePercent > 0.5) {
    // Moderate up move
    return { direction: 'PUT', conviction: 'MEDIUM' };
  } else if (outcomePercent > 0.2) {
    // Slight up move
    return { direction: 'PUT', conviction: 'WEAK' };
  } else if (outcomePercent < -1.0) {
    // Strong down move - CALL was definitely correct
    return { direction: 'CALL', conviction: 'STRONG' };
  } else if (outcomePercent < -0.5) {
    // Moderate down move
    return { direction: 'CALL', conviction: 'MEDIUM' };
  } else if (outcomePercent < -0.2) {
    // Slight down move
    return { direction: 'CALL', conviction: 'WEAK' };
  } else {
    // Sideways - STRANGLE was optimal
    return { direction: 'STRANGLE', conviction: absOutcome < 0.1 ? 'STRONG' : 'MEDIUM' };
  }
}

/**
 * Calculate theoretical max P&L for a 0DTE credit spread.
 * Simplified calculation assuming:
 * - 2 contracts
 * - Typical premium of $1-3 per contract
 * - Max profit = premium received if OTM at expiration
 */
function calculateTheoreticalMaxPnl(
  direction: 'PUT' | 'CALL' | 'STRANGLE' | 'NO_TRADE',
  underlyingPrice: number,
  outcomePercent: number
): number | null {
  if (direction === 'NO_TRADE') return null;

  // Assume typical 0DTE premium of ~$1.50 per contract, 2 contracts
  const typicalPremium = 1.5 * 100 * 2; // $300 total

  // If direction was correct (OTM at expiration), max profit is the premium
  const isCorrect =
    (direction === 'PUT' && outcomePercent >= 0) ||
    (direction === 'CALL' && outcomePercent <= 0) ||
    direction === 'STRANGLE';

  if (isCorrect) {
    return typicalPremium;
  } else {
    // Would have been a loser - negative P&L
    // Simplified: assume 2x premium loss on wrong direction
    return -typicalPremium * 2;
  }
}

// ============================================
// Data Fetching
// ============================================

/**
 * Get SPY underlying price from options chain.
 * We don't have direct stock access, so we infer from ATM options.
 */
async function getUnderlyingPriceFromOptions(
  symbol: string,
  date: string,
  expiration: string
): Promise<number | null> {
  try {
    const chain = await fetchOptionsChain({
      symbol,
      expiration,
      date,
      interval: '5m',
    });

    if (chain.length === 0) return null;

    // Find the strike with highest volume (likely ATM)
    const strikeVolume = new Map<number, number>();
    for (const bar of chain) {
      const current = strikeVolume.get(bar.strike) || 0;
      strikeVolume.set(bar.strike, current + bar.volume);
    }

    let maxVolume = 0;
    let atmStrike = 0;
    for (const [strike, vol] of strikeVolume) {
      if (vol > maxVolume) {
        maxVolume = vol;
        atmStrike = strike;
      }
    }

    return atmStrike || null;
  } catch (error) {
    console.error(`Error getting underlying price for ${date}:`, error);
    return null;
  }
}

/**
 * Estimate underlying price change from options price changes.
 */
function estimatePriceChange(
  morningBars: ThetaOptionsBar[],
  afternoonBars: ThetaOptionsBar[]
): { outcomePercent: number; high: number; low: number } {
  // Find a liquid ATM call to track
  const callBars = morningBars.filter(b => b.right === 'CALL' && b.volume > 10);
  if (callBars.length === 0) {
    return { outcomePercent: 0, high: 0, low: 0 };
  }

  // Sort by volume to find most liquid
  callBars.sort((a, b) => b.volume - a.volume);
  const trackStrike = callBars[0].strike;

  // Find morning and afternoon prices for this strike
  const morningCall = morningBars.find(b => b.strike === trackStrike && b.right === 'CALL');
  const afternoonCall = afternoonBars.find(b => b.strike === trackStrike && b.right === 'CALL');

  if (!morningCall || !afternoonCall || morningCall.close === 0) {
    return { outcomePercent: 0, high: 0, low: 0 };
  }

  // Delta approximation: ATM call delta ~ 0.5
  // Price change ≈ Option price change / delta
  const optionChange = afternoonCall.close - morningCall.close;
  const estimatedUnderlyingChange = optionChange / 0.5;
  const outcomePercent = (estimatedUnderlyingChange / trackStrike) * 100;

  // Estimate high/low from option high/low
  const allHighs = morningBars.concat(afternoonBars).map(b => b.high).filter(h => h > 0);
  const allLows = morningBars.concat(afternoonBars).map(b => b.low).filter(l => l > 0);

  return {
    outcomePercent,
    high: Math.max(...allHighs) || 0,
    low: Math.min(...allLows) || 0,
  };
}

// ============================================
// Main Generator
// ============================================

/**
 * Generate training examples for a date range.
 */
export async function generateTrainingExamples(
  symbol: string,
  startDate: string,
  endDate: string,
  options: {
    snapshotTime?: string;
    batchSize?: number;
    skipExisting?: boolean;
  } = {}
): Promise<{ generated: number; skipped: number; errors: number }> {
  const snapshotTime = options.snapshotTime || '11:00:00';
  const batchSize = options.batchSize || 10;
  const skipExisting = options.skipExisting ?? true;

  const tradingDays = getTradingDays(startDate, endDate);
  console.log(`[TrainingGen] Processing ${tradingDays.length} trading days from ${startDate} to ${endDate}`);

  let generated = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < tradingDays.length; i += batchSize) {
    const batch = tradingDays.slice(i, i + batchSize);
    console.log(`[TrainingGen] Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(tradingDays.length / batchSize)}`);

    for (const date of batch) {
      try {
        // Skip if already exists
        if (skipExisting && db) {
          // TODO: Check if example exists for this date
        }

        const example = await generateSingleExample(symbol, date, snapshotTime);
        if (example) {
          if (db) {
            await db.insert(trainingExamples).values(example);
          }
          generated++;
          console.log(`[TrainingGen] Generated example for ${date}: ${example.optimalDirection} (${example.conviction})`);
        } else {
          skipped++;
        }
      } catch (error) {
        console.error(`[TrainingGen] Error processing ${date}:`, error);
        errors++;
      }
    }

    // Rate limit between batches
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log(`[TrainingGen] Complete: ${generated} generated, ${skipped} skipped, ${errors} errors`);
  return { generated, skipped, errors };
}

/**
 * Generate a single training example for a specific date.
 */
async function generateSingleExample(
  symbol: string,
  date: string,
  snapshotTime: string
): Promise<typeof trainingExamples.$inferInsert | null> {
  // Get the 0DTE expiration for this date
  const expiration = get0DTEExpiration(date);

  // Fetch full day options data
  const allBars = await fetchOptionsChain({
    symbol,
    expiration,
    date,
    interval: '5m',
  });

  if (allBars.length === 0) {
    console.log(`[TrainingGen] No data for ${date}`);
    return null;
  }

  // Group bars by strike and time
  const barsByStrike = new Map<number, ThetaOptionsBar[]>();
  for (const bar of allBars) {
    const existing = barsByStrike.get(bar.strike) || [];
    existing.push(bar);
    barsByStrike.set(bar.strike, existing);
  }

  // Find ATM strike by looking for options with prices around $2-5
  // ATM 0DTE options typically have this premium range
  let bestStrike = 0;
  let bestScore = 0;

  for (const [strike, bars] of barsByStrike) {
    const callBars = bars.filter(b => b.right === 'CALL');
    if (callBars.length === 0) continue;

    // Find average price for this strike
    const validPrices = callBars.map(b => b.close).filter(p => p > 0);
    if (validPrices.length === 0) continue;
    const avgPrice = validPrices.reduce((a, b) => a + b, 0) / validPrices.length;

    // Score based on how close to $3 (typical ATM 0DTE price)
    // and volume (liquidity)
    const priceScore = Math.max(0, 1 - Math.abs(avgPrice - 3) / 5);
    const totalVol = callBars.reduce((sum, b) => sum + b.volume, 0);
    const volScore = Math.min(1, totalVol / 5000); // Normalize volume
    const score = priceScore * 0.7 + volScore * 0.3;

    if (score > bestScore) {
      bestScore = score;
      bestStrike = strike;
    }
  }

  if (bestStrike === 0) {
    console.log(`[TrainingGen] No suitable ATM strike for ${date}`);
    return null;
  }

  // Get bars for this strike, sorted by time
  const strikeBars = barsByStrike.get(bestStrike) || [];
  const callBars = strikeBars.filter(b => b.right === 'CALL').sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  if (callBars.length < 10) {
    console.log(`[TrainingGen] Insufficient bars for ${date}`);
    return null;
  }

  // Find 11 AM bar and 3:55 PM bar
  const snapshotHour = parseInt(snapshotTime.split(':')[0]);
  const morningBar = callBars.find(bar => {
    const barHour = new Date(bar.timestamp).getHours();
    return barHour === snapshotHour;
  });

  const closeBar = callBars.find(bar => {
    const barTime = new Date(bar.timestamp);
    return barTime.getHours() === 15 && barTime.getMinutes() >= 50;
  }) || callBars[callBars.length - 1];

  if (!morningBar || !closeBar) {
    console.log(`[TrainingGen] Missing morning or close bar for ${date}`);
    return null;
  }

  // Calculate price change using options prices
  // ATM call delta ≈ 0.5, so underlying change ≈ 2 * option change
  const optionPriceChange = closeBar.close - morningBar.open;
  const estimatedUnderlyingChange = optionPriceChange * 2;
  const outcomePercent = (estimatedUnderlyingChange / bestStrike) * 100;

  // Find intraday high and low from all bars
  const allHighs = callBars.map(b => b.high).filter(h => h > 0);
  const allLows = callBars.map(b => b.low).filter(l => l > 0);
  const intradayHigh = Math.max(...allHighs);
  const intradayLow = Math.min(...allLows);
  const intradayRange = ((intradayHigh - intradayLow) / morningBar.open) * 100;

  // The underlying price is approximately the strike (ATM assumption)
  const underlyingPrice = bestStrike;

  // Determine optimal direction based on actual outcome
  const { direction, conviction } = determineOptimalDirection(outcomePercent, intradayRange);

  // Calculate theoretical max P&L
  const theoreticalMaxPnl = calculateTheoreticalMaxPnl(direction, underlyingPrice, outcomePercent);

  // Get VIX (fallback to Yahoo if needed)
  let vix: number | null = null;
  try {
    const vixData = await getVIX();
    vix = vixData?.current || null;
  } catch {
    vix = null;
  }

  // Get all unique strikes for the snapshot
  const allStrikes = [...new Set(allBars.map(b => b.strike))].sort((a, b) => a - b);

  // Build the snapshot object with morning data
  const morningBars = allBars.filter(bar => {
    const barHour = new Date(bar.timestamp).getHours();
    return barHour <= snapshotHour + 1;
  });

  const snapshot = {
    bars: morningBars.slice(0, 100), // Include morning bars
    strikes: allStrikes.slice(0, 30),
    timestamp: snapshotTime,
    trackedStrike: bestStrike,
    morningPrice: morningBar.open,
    closePrice: closeBar.close,
  };

  console.log(`[TrainingGen] ${date}: morning=${morningBar.open.toFixed(2)}, close=${closeBar.close.toFixed(2)}, change=${outcomePercent.toFixed(2)}%`);

  return {
    date: parseDate(date),
    snapshotTime,
    snapshot,
    underlyingPrice,
    vix,
    actualOutcome: outcomePercent,
    intradayHigh,
    intradayLow,
    optimalDirection: direction,
    conviction,
    optimalStrike: bestStrike,
    theoreticalMaxPnl,
    efficiencyScore: direction === 'NO_TRADE' ? null : 0.5, // Placeholder, will refine
    source: 'theta',
  };
}

/**
 * Quick test function
 */
export async function testGenerator(): Promise<void> {
  console.log('[TrainingGen] Testing with a single date...');

  const example = await generateSingleExample('SPY', '20241202', '11:00:00');
  if (example) {
    console.log('[TrainingGen] Generated example:');
    console.log('  Date:', example.date);
    console.log('  Underlying:', example.underlyingPrice);
    console.log('  Outcome:', example.actualOutcome?.toFixed(2), '%');
    console.log('  Direction:', example.optimalDirection);
    console.log('  Conviction:', example.conviction);
  } else {
    console.log('[TrainingGen] No example generated');
  }
}
