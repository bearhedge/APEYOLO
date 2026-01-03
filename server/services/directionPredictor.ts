/**
 * Direction Prediction Service
 *
 * Analyzes historical engine runs with outcomes and suggests direction
 * (PUT, CALL, STRANGLE) based on current indicators and historical accuracy.
 *
 * This is part of the RLHF integration - it learns from past user decisions
 * and outcomes to improve future suggestions.
 */

import { db } from '../db';
import { engineRuns, directionPredictions } from '@shared/schema';
import { getIndicatorSnapshotSafe } from './indicators/ibkrFetcher';
import { IndicatorSnapshot } from './indicators/calculator';
import { eq, and, isNotNull, desc } from 'drizzle-orm';

// Types
export type DirectionType = 'PUT' | 'CALL' | 'STRANGLE' | 'NO_TRADE';

export interface DirectionPrediction {
  direction: DirectionType;
  confidence: number; // 0-100
  predictionId?: string; // ID for updating with user choice (RLHF tracking)
  reasoning: {
    indicatorSignal: string;
    indicatorConfidence: number;
    historicalAccuracy: number | null; // null if insufficient data
    matchingPatterns: number; // how many similar conditions in history
  };
}

interface HistoricalMatch {
  direction: string;
  wasWinner: boolean;
  pnl: number;
}

// Minimum number of matching patterns required to use historical data
const MIN_PATTERNS_FOR_HISTORICAL = 10;

// Weight for combining indicator and historical confidence
const INDICATOR_WEIGHT = 0.6;
const HISTORICAL_WEIGHT = 0.4;

// Confidence boost when indicator and historical agree
const AGREEMENT_BOOST = 10;

/**
 * Map volatility regime to query-friendly format
 */
function mapVolatilityRegime(regime: 'LOW' | 'NORMAL' | 'HIGH'): string {
  return regime.toLowerCase();
}

/**
 * Map trend direction to query-friendly format
 */
function mapTrendDirection(trend: 'UP' | 'DOWN' | 'SIDEWAYS'): string {
  switch (trend) {
    case 'UP': return 'bullish';
    case 'DOWN': return 'bearish';
    default: return 'neutral';
  }
}

/**
 * Map momentum signal to query-friendly format
 */
function mapMomentumSignal(momentum: 'BULLISH' | 'BEARISH' | 'NEUTRAL'): string {
  return momentum.toLowerCase();
}

/**
 * Query historical engine runs with similar market conditions
 */
async function findSimilarHistoricalRuns(
  volatilityRegime: string,
  trendDirection: string,
  momentumSignal: string
): Promise<HistoricalMatch[]> {
  if (!db) {
    console.warn('[DirectionPredictor] Database not configured');
    return [];
  }

  try {
    // Query engine runs with matching conditions that have outcomes
    const results = await db
      .select({
        direction: engineRuns.direction,
        wasWinner: engineRuns.wasWinner,
        realizedPnl: engineRuns.realizedPnl,
        indicators: engineRuns.indicators,
      })
      .from(engineRuns)
      .where(
        and(
          isNotNull(engineRuns.wasWinner),
          isNotNull(engineRuns.realizedPnl)
        )
      )
      .orderBy(desc(engineRuns.createdAt))
      .limit(500); // Look at recent 500 completed trades

    // Filter by similar market conditions
    const matches: HistoricalMatch[] = [];

    for (const run of results) {
      const indicators = run.indicators as any;
      if (!indicators) continue;

      // Check if conditions match
      const runVolatility = indicators.volatilityRegime?.toLowerCase() || 'normal';
      const runTrend = mapTrendDirection(indicators.trendDirection || 'SIDEWAYS');
      const runMomentum = indicators.momentumSignal?.toLowerCase() || 'neutral';

      // Match on volatility regime (most important for options)
      // And at least one of trend or momentum
      const volatilityMatches = runVolatility === volatilityRegime;
      const trendMatches = runTrend === trendDirection;
      const momentumMatches = runMomentum === momentumSignal;

      if (volatilityMatches && (trendMatches || momentumMatches)) {
        matches.push({
          direction: run.direction,
          wasWinner: run.wasWinner ?? false,
          pnl: run.realizedPnl ?? 0,
        });
      }
    }

    return matches;
  } catch (error) {
    console.error('[DirectionPredictor] Failed to query historical runs:', error);
    return [];
  }
}

/**
 * Calculate which direction won most often in similar historical conditions
 */
function calculateHistoricalWinRates(matches: HistoricalMatch[]): {
  bestDirection: DirectionType | null;
  accuracy: number;
  byDirection: Record<string, { wins: number; total: number; winRate: number }>;
} {
  if (matches.length === 0) {
    return { bestDirection: null, accuracy: 0, byDirection: {} };
  }

  const byDirection: Record<string, { wins: number; total: number; winRate: number }> = {};

  for (const match of matches) {
    if (!byDirection[match.direction]) {
      byDirection[match.direction] = { wins: 0, total: 0, winRate: 0 };
    }
    byDirection[match.direction].total++;
    if (match.wasWinner) {
      byDirection[match.direction].wins++;
    }
  }

  // Calculate win rates
  for (const dir of Object.keys(byDirection)) {
    byDirection[dir].winRate = byDirection[dir].wins / byDirection[dir].total;
  }

  // Find best performing direction
  let bestDirection: DirectionType | null = null;
  let bestWinRate = 0;

  for (const [dir, stats] of Object.entries(byDirection)) {
    // Only consider directions with meaningful sample size (at least 3)
    if (stats.total >= 3 && stats.winRate > bestWinRate) {
      bestWinRate = stats.winRate;
      bestDirection = dir as DirectionType;
    }
  }

  return {
    bestDirection,
    accuracy: bestWinRate * 100,
    byDirection,
  };
}

/**
 * Save prediction to database for tracking
 */
async function savePrediction(
  indicatorSnapshot: IndicatorSnapshot & { vix: number },
  prediction: DirectionPrediction
): Promise<string | null> {
  if (!db) {
    console.warn('[DirectionPredictor] Database not configured, skipping save');
    return null;
  }

  try {
    const [result] = await db.insert(directionPredictions).values({
      indicatorSignal: indicatorSnapshot.indicatorSuggestion,
      indicatorConfidence: indicatorSnapshot.indicatorConfidence,
      indicatorReasoning: {
        trend: indicatorSnapshot.trendDirection,
        momentum: indicatorSnapshot.momentumSignal,
        volatility: indicatorSnapshot.volatilityRegime,
        rsi: indicatorSnapshot.rsi14,
        macd: indicatorSnapshot.macdHistogram > 0 ? 'bullish' : 'bearish',
        vix: indicatorSnapshot.vix,
      },
      aiSuggestion: prediction.direction,
      aiConfidence: prediction.confidence / 100, // Store as 0-1
      userChoice: '', // Will be filled when user picks
    }).returning({ id: directionPredictions.id });

    console.log(`[DirectionPredictor] Saved prediction ${result.id}`);
    return result.id;
  } catch (error) {
    console.error('[DirectionPredictor] Failed to save prediction:', error);
    return null;
  }
}

/**
 * Main prediction function
 *
 * 1. Gets current indicator snapshot for the symbol
 * 2. Queries historical engine runs with similar conditions
 * 3. Calculates which direction won most often
 * 4. Combines with indicator's suggestion
 * 5. Returns prediction with confidence
 */
export async function predictDirection(symbol: string): Promise<DirectionPrediction> {
  console.log(`[DirectionPredictor] Predicting direction for ${symbol}`);

  // Step 1: Get current indicator snapshot
  const snapshot = await getIndicatorSnapshotSafe(symbol.toUpperCase());

  if (!snapshot) {
    console.warn(`[DirectionPredictor] No indicator data for ${symbol}, using defaults`);
    return {
      direction: 'NO_TRADE',
      confidence: 0,
      reasoning: {
        indicatorSignal: 'NO_TRADE',
        indicatorConfidence: 0,
        historicalAccuracy: null,
        matchingPatterns: 0,
      },
    };
  }

  // Step 2: Map conditions for historical query
  const volatilityRegime = mapVolatilityRegime(snapshot.volatilityRegime);
  const trendDirection = mapTrendDirection(snapshot.trendDirection);
  const momentumSignal = mapMomentumSignal(snapshot.momentumSignal);

  console.log(`[DirectionPredictor] Market conditions: volatility=${volatilityRegime}, trend=${trendDirection}, momentum=${momentumSignal}`);

  // Step 3: Find similar historical patterns
  const historicalMatches = await findSimilarHistoricalRuns(
    volatilityRegime,
    trendDirection,
    momentumSignal
  );

  console.log(`[DirectionPredictor] Found ${historicalMatches.length} similar historical patterns`);

  // Step 4: Calculate historical win rates
  const historicalData = calculateHistoricalWinRates(historicalMatches);

  // Step 5: Combine indicator suggestion with historical data
  let finalDirection: DirectionType = snapshot.indicatorSuggestion;
  let finalConfidence: number = snapshot.indicatorConfidence * 100;
  let historicalAccuracy: number | null = null;

  if (historicalMatches.length >= MIN_PATTERNS_FOR_HISTORICAL && historicalData.bestDirection) {
    historicalAccuracy = historicalData.accuracy;

    // Weighted combination of indicator and historical confidence
    const indicatorConfidenceNormalized = snapshot.indicatorConfidence * 100;

    // If historical data strongly suggests a different direction, consider it
    if (historicalData.bestDirection === snapshot.indicatorSuggestion) {
      // Agreement: boost confidence
      finalConfidence = Math.min(100,
        indicatorConfidenceNormalized * INDICATOR_WEIGHT +
        historicalAccuracy * HISTORICAL_WEIGHT +
        AGREEMENT_BOOST
      );
      console.log(`[DirectionPredictor] Indicator and history agree on ${finalDirection}, boosting confidence to ${finalConfidence.toFixed(1)}%`);
    } else if (historicalAccuracy > 70 && historicalData.byDirection[historicalData.bestDirection]?.total >= 5) {
      // Strong historical signal disagrees with indicator
      // Use historical direction if it's significantly better
      if (historicalAccuracy - indicatorConfidenceNormalized > 20) {
        finalDirection = historicalData.bestDirection;
        finalConfidence = historicalAccuracy * 0.8; // Reduce slightly due to disagreement
        console.log(`[DirectionPredictor] Historical data (${historicalAccuracy.toFixed(1)}%) overrides indicator (${indicatorConfidenceNormalized.toFixed(1)}%), using ${finalDirection}`);
      } else {
        // Mixed signals: reduce confidence
        finalConfidence = (indicatorConfidenceNormalized + historicalAccuracy) / 2 * 0.8;
        console.log(`[DirectionPredictor] Mixed signals, reducing confidence to ${finalConfidence.toFixed(1)}%`);
      }
    } else {
      // Historical data not strong enough to override
      finalConfidence = indicatorConfidenceNormalized * INDICATOR_WEIGHT +
        (historicalAccuracy || 50) * HISTORICAL_WEIGHT;
    }
  } else {
    console.log(`[DirectionPredictor] Insufficient historical data (${historicalMatches.length} patterns), using indicator only`);
  }

  const prediction: DirectionPrediction = {
    direction: finalDirection,
    confidence: Math.round(finalConfidence),
    reasoning: {
      indicatorSignal: snapshot.indicatorSuggestion,
      indicatorConfidence: Math.round(snapshot.indicatorConfidence * 100),
      historicalAccuracy,
      matchingPatterns: historicalMatches.length,
    },
  };

  // Step 6: Save prediction for tracking and get ID
  const predictionId = await savePrediction(snapshot, prediction);
  if (predictionId) {
    prediction.predictionId = predictionId;
  }

  console.log(`[DirectionPredictor] Final prediction: ${prediction.direction} (${prediction.confidence}% confidence), ID: ${predictionId || 'not saved'}`);
  return prediction;
}

/**
 * Get prediction without saving (for preview/testing)
 */
export async function predictDirectionPreview(symbol: string): Promise<DirectionPrediction> {
  // Same logic as predictDirection but without saving
  const snapshot = await getIndicatorSnapshotSafe(symbol.toUpperCase());

  if (!snapshot) {
    return {
      direction: 'NO_TRADE',
      confidence: 0,
      reasoning: {
        indicatorSignal: 'NO_TRADE',
        indicatorConfidence: 0,
        historicalAccuracy: null,
        matchingPatterns: 0,
      },
    };
  }

  const volatilityRegime = mapVolatilityRegime(snapshot.volatilityRegime);
  const trendDirection = mapTrendDirection(snapshot.trendDirection);
  const momentumSignal = mapMomentumSignal(snapshot.momentumSignal);

  const historicalMatches = await findSimilarHistoricalRuns(
    volatilityRegime,
    trendDirection,
    momentumSignal
  );

  const historicalData = calculateHistoricalWinRates(historicalMatches);

  let finalDirection: DirectionType = snapshot.indicatorSuggestion;
  let finalConfidence: number = snapshot.indicatorConfidence * 100;
  let historicalAccuracy: number | null = null;

  if (historicalMatches.length >= MIN_PATTERNS_FOR_HISTORICAL && historicalData.bestDirection) {
    historicalAccuracy = historicalData.accuracy;
    const indicatorConfidenceNormalized = snapshot.indicatorConfidence * 100;

    if (historicalData.bestDirection === snapshot.indicatorSuggestion) {
      finalConfidence = Math.min(100,
        indicatorConfidenceNormalized * INDICATOR_WEIGHT +
        historicalAccuracy * HISTORICAL_WEIGHT +
        AGREEMENT_BOOST
      );
    } else if (historicalAccuracy > 70 && historicalData.byDirection[historicalData.bestDirection]?.total >= 5) {
      if (historicalAccuracy - indicatorConfidenceNormalized > 20) {
        finalDirection = historicalData.bestDirection;
        finalConfidence = historicalAccuracy * 0.8;
      } else {
        finalConfidence = (indicatorConfidenceNormalized + historicalAccuracy) / 2 * 0.8;
      }
    } else {
      finalConfidence = indicatorConfidenceNormalized * INDICATOR_WEIGHT +
        (historicalAccuracy || 50) * HISTORICAL_WEIGHT;
    }
  }

  return {
    direction: finalDirection,
    confidence: Math.round(finalConfidence),
    reasoning: {
      indicatorSignal: snapshot.indicatorSuggestion,
      indicatorConfidence: Math.round(snapshot.indicatorConfidence * 100),
      historicalAccuracy,
      matchingPatterns: historicalMatches.length,
    },
  };
}
