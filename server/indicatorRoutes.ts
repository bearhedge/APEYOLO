// @ts-nocheck
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
import { indicatorSnapshots, directionPredictions, userSettings } from '@shared/schema';
import { eq, sql, isNotNull, and } from 'drizzle-orm';
import { requireAuth } from './auth';

const router = Router();

/**
 * GET /api/indicators/accuracy
 *
 * Get AI direction prediction accuracy statistics.
 * Used for the RLHF "earned autonomy" feature - AI unlocks auto-run at 80% accuracy.
 *
 * Returns:
 * - totalPredictions: number of closed trades with wasCorrect result
 * - correctPredictions: number where wasCorrect = true
 * - accuracy: overall accuracy percentage (0-100)
 * - last50Accuracy: accuracy of last 50 predictions (for auto-run threshold)
 * - overrideStats: stats when user overrode AI (agreedWithAi = false)
 * - agreementStats: stats when user followed AI (agreedWithAi = true)
 * - autoRunEligible: true if last50Accuracy >= 80
 */
router.get('/accuracy', async (req, res) => {
  try {
    // Query all predictions where wasCorrect is not null (closed trades)
    const allPredictions = await db
      .select({
        id: directionPredictions.id,
        wasCorrect: directionPredictions.wasCorrect,
        agreedWithAi: directionPredictions.agreedWithAi,
        wasOverride: directionPredictions.wasOverride,
        overrideWasCorrect: directionPredictions.overrideWasCorrect,
        createdAt: directionPredictions.createdAt,
      })
      .from(directionPredictions)
      .where(isNotNull(directionPredictions.wasCorrect))
      .orderBy(sql`${directionPredictions.createdAt} DESC`);

    const totalPredictions = allPredictions.length;
    const correctPredictions = allPredictions.filter(p => p.wasCorrect === true).length;
    const accuracy = totalPredictions > 0 ? (correctPredictions / totalPredictions) * 100 : 0;

    // Calculate last 50 accuracy for auto-run threshold
    const last50 = allPredictions.slice(0, 50);
    const last50Correct = last50.filter(p => p.wasCorrect === true).length;
    const last50Accuracy = last50.length > 0 ? (last50Correct / last50.length) * 100 : null;

    // Override stats: when user disagreed with AI (agreedWithAi = false)
    const overridePredictions = allPredictions.filter(p => p.agreedWithAi === false);
    const overrideCount = overridePredictions.length;
    const overrideCorrectCount = overridePredictions.filter(p => p.wasCorrect === true).length;
    const overrideAccuracy = overrideCount > 0 ? (overrideCorrectCount / overrideCount) * 100 : null;

    // Agreement stats: when user followed AI (agreedWithAi = true)
    const agreedPredictions = allPredictions.filter(p => p.agreedWithAi === true);
    const agreedCount = agreedPredictions.length;
    const agreedCorrectCount = agreedPredictions.filter(p => p.wasCorrect === true).length;
    const agreedAccuracy = agreedCount > 0 ? (agreedCorrectCount / agreedCount) * 100 : null;

    // Auto-run eligibility: need at least 50 predictions and 80%+ accuracy
    const autoRunEligible = last50.length >= 50 && last50Accuracy !== null && last50Accuracy >= 80;

    res.json({
      totalPredictions,
      correctPredictions,
      accuracy: Math.round(accuracy * 100) / 100, // Round to 2 decimal places
      last50Accuracy: last50Accuracy !== null ? Math.round(last50Accuracy * 100) / 100 : null,
      overrideStats: {
        overrideCount,
        overrideCorrectCount,
        overrideAccuracy: overrideAccuracy !== null ? Math.round(overrideAccuracy * 100) / 100 : null,
      },
      agreementStats: {
        agreedCount,
        agreedCorrectCount,
        agreedAccuracy: agreedAccuracy !== null ? Math.round(agreedAccuracy * 100) / 100 : null,
      },
      autoRunEligible,
    });
  } catch (error) {
    console.error('Failed to get accuracy stats:', error);
    res.status(500).json({ error: 'Failed to get accuracy stats' });
  }
});

/**
 * PATCH /api/indicators/predictions/:id
 *
 * Update a direction prediction with the user's actual choice.
 * Used for RLHF tracking - captures when user agrees/disagrees with AI.
 * Note: Route is /predictions/:id since this router is mounted at /api/indicators
 *
 * Body:
 * - userChoice: PUT | CALL | STRANGLE | NO_TRADE
 * - agreedWithAi: boolean (optional, calculated if not provided)
 */
router.patch('/predictions/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { userChoice, agreedWithAi } = req.body;

    if (!userChoice) {
      res.status(400).json({ error: 'userChoice is required' });
      return;
    }

    // First, get the existing prediction to compare with AI suggestion
    const existing = await db
      .select({
        aiSuggestion: directionPredictions.aiSuggestion,
        indicatorSignal: directionPredictions.indicatorSignal,
      })
      .from(directionPredictions)
      .where(eq(directionPredictions.id, id))
      .limit(1);

    if (existing.length === 0) {
      res.status(404).json({ error: 'Prediction not found' });
      return;
    }

    const prediction = existing[0];

    // Calculate agreement flags
    const agreedWithAiFinal = agreedWithAi ?? (userChoice === prediction.aiSuggestion);
    const agreedWithIndicators = userChoice === prediction.indicatorSignal;

    // Update the prediction
    await db
      .update(directionPredictions)
      .set({
        userChoice,
        agreedWithAi: agreedWithAiFinal,
        agreedWithIndicators,
      })
      .where(eq(directionPredictions.id, id));

    console.log(`[IndicatorRoutes] Updated prediction ${id}: userChoice=${userChoice}, agreedWithAi=${agreedWithAiFinal}, agreedWithIndicators=${agreedWithIndicators}`);

    res.json({
      success: true,
      updated: {
        id,
        userChoice,
        agreedWithAi: agreedWithAiFinal,
        agreedWithIndicators,
      },
    });
  } catch (error) {
    console.error('Failed to update prediction:', error);
    res.status(500).json({ error: 'Failed to update prediction' });
  }
});

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

/**
 * GET /api/indicators/auto-run-status
 *
 * Get the auto-run status for the authenticated user.
 * Returns eligibility (based on accuracy), user preference, and active status.
 *
 * Returns:
 * - eligible: boolean - true if last 50 accuracy >= 80%
 * - enabled: boolean - user's preference setting
 * - active: boolean - true if eligible AND enabled
 */
router.get('/auto-run-status', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Get accuracy stats to determine eligibility
    const allPredictions = await db
      .select({
        wasCorrect: directionPredictions.wasCorrect,
        createdAt: directionPredictions.createdAt,
      })
      .from(directionPredictions)
      .where(isNotNull(directionPredictions.wasCorrect))
      .orderBy(sql`${directionPredictions.createdAt} DESC`);

    // Calculate last 50 accuracy for auto-run threshold
    const last50 = allPredictions.slice(0, 50);
    const last50Correct = last50.filter(p => p.wasCorrect === true).length;
    const last50Accuracy = last50.length > 0 ? (last50Correct / last50.length) * 100 : null;

    // Auto-run eligibility: need at least 50 predictions and 80%+ accuracy
    const eligible = last50.length >= 50 && last50Accuracy !== null && last50Accuracy >= 80;

    // Get user's auto-run preference
    const settings = await db
      .select({ autoRunEnabled: userSettings.autoRunEnabled })
      .from(userSettings)
      .where(eq(userSettings.userId, userId))
      .limit(1);

    const enabled = settings.length > 0 ? settings[0].autoRunEnabled : false;

    // Active only if both eligible and enabled
    const active = eligible && enabled;

    res.json({
      eligible,
      enabled,
      active,
      accuracy: last50Accuracy !== null ? Math.round(last50Accuracy * 100) / 100 : null,
      predictionsCount: last50.length,
    });
  } catch (error) {
    console.error('Failed to get auto-run status:', error);
    res.status(500).json({ error: 'Failed to get auto-run status' });
  }
});

/**
 * POST /api/indicators/auto-run
 *
 * Toggle auto-run setting for the authenticated user.
 * Only works if the user is eligible (accuracy >= 80% over last 50 trades).
 *
 * Body:
 * - enabled: boolean
 */
router.post('/auto-run', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled must be a boolean' });
      return;
    }

    // If trying to enable, verify eligibility first
    if (enabled) {
      const allPredictions = await db
        .select({
          wasCorrect: directionPredictions.wasCorrect,
          createdAt: directionPredictions.createdAt,
        })
        .from(directionPredictions)
        .where(isNotNull(directionPredictions.wasCorrect))
        .orderBy(sql`${directionPredictions.createdAt} DESC`);

      const last50 = allPredictions.slice(0, 50);
      const last50Correct = last50.filter(p => p.wasCorrect === true).length;
      const last50Accuracy = last50.length > 0 ? (last50Correct / last50.length) * 100 : null;

      const eligible = last50.length >= 50 && last50Accuracy !== null && last50Accuracy >= 80;

      if (!eligible) {
        res.status(403).json({
          error: 'Not eligible for auto-run',
          message: 'Auto-run requires 80% accuracy over the last 50 predictions',
          accuracy: last50Accuracy,
          predictionsCount: last50.length,
        });
        return;
      }
    }

    // Check if settings exist for user
    const existingSettings = await db
      .select({ id: userSettings.id })
      .from(userSettings)
      .where(eq(userSettings.userId, userId))
      .limit(1);

    if (existingSettings.length > 0) {
      // Update existing settings
      await db
        .update(userSettings)
        .set({
          autoRunEnabled: enabled,
          updatedAt: new Date(),
        })
        .where(eq(userSettings.userId, userId));
    } else {
      // Create new settings record
      await db.insert(userSettings).values({
        userId,
        autoRunEnabled: enabled,
      });
    }

    console.log(`[IndicatorRoutes] Auto-run ${enabled ? 'enabled' : 'disabled'} for user ${userId}`);

    res.json({
      success: true,
      enabled,
      message: enabled ? 'Auto-run enabled. AI will automatically select direction.' : 'Auto-run disabled.',
    });
  } catch (error) {
    console.error('Failed to update auto-run setting:', error);
    res.status(500).json({ error: 'Failed to update auto-run setting' });
  }
});

export default router;
