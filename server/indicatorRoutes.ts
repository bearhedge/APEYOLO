/**
 * Indicator API Routes
 *
 * Endpoints for fetching technical indicators and AI direction suggestions.
 * Used by the RLHF system to capture market context at decision time.
 */

import { Router } from 'express';
import { getIndicatorSnapshot, getIndicatorSnapshotSafe } from './services/indicators/ibkrFetcher';
import { predictDirection } from './services/directionPredictor';
import { db } from './db';
import { indicatorSnapshots } from '@shared/schema';

const router = Router();

/**
 * GET /api/indicators/:symbol
 *
 * Fetch current technical indicators for a symbol.
 * Returns computed indicators (RSI, MACD, etc.) and derived signals.
 */
router.get('/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const snapshot = await getIndicatorSnapshot(symbol.toUpperCase());

    // Save to database for historical tracking
    await db.insert(indicatorSnapshots).values({
      symbol: symbol.toUpperCase(),
      price: snapshot.price,
      sma20: snapshot.sma20,
      sma50: snapshot.sma50,
      ema9: snapshot.ema9,
      ema21: snapshot.ema21,
      rsi14: snapshot.rsi14,
      macd: snapshot.macd,
      macdSignal: snapshot.macdSignal,
      macdHistogram: snapshot.macdHistogram,
      atr14: snapshot.atr14,
      bollingerUpper: snapshot.bollingerUpper,
      bollingerLower: snapshot.bollingerLower,
      vix: snapshot.vix,
      trendDirection: snapshot.trendDirection,
      momentumSignal: snapshot.momentumSignal,
      volatilityRegime: snapshot.volatilityRegime,
    });

    res.json(snapshot);
  } catch (error) {
    console.error('Failed to fetch indicators:', error);
    res.status(500).json({ error: 'Failed to fetch indicators' });
  }
});

/**
 * GET /api/indicators/:symbol/suggestion
 *
 * Get AI direction suggestion based on current indicators.
 * Returns PUT, CALL, STRANGLE, or NO_TRADE with confidence score.
 */
router.get('/:symbol/suggestion', async (req, res) => {
  try {
    const { symbol } = req.params;
    const snapshot = await getIndicatorSnapshotSafe(symbol.toUpperCase());

    if (!snapshot) {
      res.status(503).json({ error: 'Unable to fetch market data' });
      return;
    }

    res.json({
      suggestion: snapshot.indicatorSuggestion,
      confidence: snapshot.indicatorConfidence,
      reasoning: {
        trend: snapshot.trendDirection,
        momentum: snapshot.momentumSignal,
        volatility: snapshot.volatilityRegime,
        rsi: snapshot.rsi14,
        macd: snapshot.macdHistogram > 0 ? 'bullish' : 'bearish',
        vix: snapshot.vix,
      },
    });
  } catch (error) {
    console.error('Failed to get suggestion:', error);
    res.status(500).json({ error: 'Failed to get suggestion' });
  }
});

/**
 * GET /api/indicators/:symbol/predict
 *
 * Get AI direction prediction based on current indicators and historical accuracy.
 * Uses RLHF-style learning from past user decisions and outcomes.
 *
 * Returns:
 * - direction: PUT | CALL | STRANGLE | NO_TRADE
 * - confidence: 0-100
 * - reasoning: explanation of the prediction
 */
router.get('/:symbol/predict', async (req, res) => {
  try {
    const { symbol } = req.params;
    const prediction = await predictDirection(symbol.toUpperCase());
    res.json(prediction);
  } catch (error) {
    console.error('Failed to predict direction:', error);
    res.status(500).json({ error: 'Failed to predict direction' });
  }
});

/**
 * GET /api/indicators/:symbol/full
 *
 * Get complete indicator snapshot with all data.
 * Useful for debugging and UI display.
 */
router.get('/:symbol/full', async (req, res) => {
  try {
    const { symbol } = req.params;
    const snapshot = await getIndicatorSnapshotSafe(symbol.toUpperCase());

    if (!snapshot) {
      res.status(503).json({ error: 'Unable to fetch market data' });
      return;
    }

    res.json({
      symbol: symbol.toUpperCase(),
      timestamp: new Date().toISOString(),
      price: snapshot.price,
      indicators: {
        trend: {
          sma20: snapshot.sma20,
          sma50: snapshot.sma50,
          ema9: snapshot.ema9,
          ema21: snapshot.ema21,
          direction: snapshot.trendDirection,
        },
        momentum: {
          rsi14: snapshot.rsi14,
          macd: snapshot.macd,
          macdSignal: snapshot.macdSignal,
          macdHistogram: snapshot.macdHistogram,
          signal: snapshot.momentumSignal,
        },
        volatility: {
          atr14: snapshot.atr14,
          bollingerUpper: snapshot.bollingerUpper,
          bollingerLower: snapshot.bollingerLower,
          vix: snapshot.vix,
          regime: snapshot.volatilityRegime,
        },
      },
      suggestion: {
        direction: snapshot.indicatorSuggestion,
        confidence: snapshot.indicatorConfidence,
      },
    });
  } catch (error) {
    console.error('Failed to get full snapshot:', error);
    res.status(500).json({ error: 'Failed to get full snapshot' });
  }
});

export default router;
