/**
 * RLHF (Reinforcement Learning from Human Feedback) Service
 *
 * This service handles linking trade outcomes back to engine runs
 * for AI learning and performance tracking.
 *
 * When a trade closes (via stop loss, take profit, expiration, etc.),
 * we update the corresponding engine_run record with the outcome.
 */

import { db } from '../db';
import { engineRuns, directionPredictions } from '@shared/schema';
import { eq } from 'drizzle-orm';

// ============================================
// Types
// ============================================

export interface TradeOutcome {
  tradeId: string;
  realizedPnl: number;
  exitReason: string;
}

export interface LinkOutcomeResult {
  success: boolean;
  engineRunId?: string;
  message: string;
}

// ============================================
// Main Functions
// ============================================

/**
 * Link a trade outcome to its corresponding engine run.
 *
 * When a trade closes, this function:
 * 1. Finds the engine_run record with matching tradeId
 * 2. Updates it with realizedPnl, exitReason, wasWinner, and closedAt
 * 3. Also updates the associated direction_prediction if one exists
 *
 * @param tradeId - The ID of the trade that closed
 * @param pnl - The realized profit/loss in USD
 * @param exitReason - Why the trade closed (e.g., "stop_loss", "take_profit", "expiration", "manual")
 * @returns Result object with success status and message
 */
export async function linkTradeOutcome(
  tradeId: string,
  pnl: number,
  exitReason: string
): Promise<LinkOutcomeResult> {
  console.log(`[RLHF] Linking trade outcome: tradeId=${tradeId}, pnl=${pnl}, exitReason=${exitReason}`);

  if (!db) {
    console.warn('[RLHF] Database not available, skipping outcome linking');
    return {
      success: false,
      message: 'Database not available',
    };
  }

  try {
    // Step 1: Find the engine_run with this tradeId
    const [engineRun] = await db
      .select()
      .from(engineRuns)
      .where(eq(engineRuns.tradeId, tradeId))
      .limit(1);

    if (!engineRun) {
      console.log(`[RLHF] No engine_run found for tradeId=${tradeId} (trade may predate RLHF integration)`);
      return {
        success: true, // Not an error - trade just wasn't initiated via engine
        message: 'No engine_run found for this trade (may predate RLHF integration)',
      };
    }

    // Step 2: Determine if this was a winner
    const wasWinner = pnl > 0;
    const closedAt = new Date();

    // Step 3: Update the engine_run with outcome data
    await db
      .update(engineRuns)
      .set({
        realizedPnl: pnl,
        exitReason: exitReason,
        wasWinner: wasWinner,
        closedAt: closedAt,
      })
      .where(eq(engineRuns.id, engineRun.id));

    console.log(`[RLHF] Updated engine_run ${engineRun.id}: pnl=${pnl}, wasWinner=${wasWinner}, exitReason=${exitReason}`);

    // Step 4: Update associated direction_prediction if exists
    try {
      const [prediction] = await db
        .select()
        .from(directionPredictions)
        .where(eq(directionPredictions.engineRunId, engineRun.id))
        .limit(1);

      if (prediction) {
        // Determine if the user's choice was correct based on P&L
        const wasCorrect = pnl > 0;

        // Determine if override was correct (if user disagreed with AI)
        const overrideWasCorrect = prediction.wasOverride ? wasCorrect : null;

        await db
          .update(directionPredictions)
          .set({
            pnl: pnl,
            wasCorrect: wasCorrect,
            overrideWasCorrect: overrideWasCorrect,
          })
          .where(eq(directionPredictions.id, prediction.id));

        console.log(`[RLHF] Updated direction_prediction ${prediction.id}: pnl=${pnl}, wasCorrect=${wasCorrect}`);
      }
    } catch (predictionErr) {
      // Don't fail the whole operation if prediction update fails
      console.warn('[RLHF] Could not update direction_prediction:', predictionErr);
    }

    return {
      success: true,
      engineRunId: engineRun.id,
      message: `Successfully linked outcome to engine_run ${engineRun.id}`,
    };
  } catch (error: any) {
    console.error('[RLHF] Error linking trade outcome:', error);
    return {
      success: false,
      message: error.message || 'Unknown error',
    };
  }
}

/**
 * Batch link multiple trade outcomes.
 *
 * Useful for backfilling historical trades or bulk processing.
 *
 * @param outcomes - Array of trade outcomes to link
 * @returns Summary of results
 */
export async function linkTradeOutcomesBatch(
  outcomes: TradeOutcome[]
): Promise<{ success: number; failed: number; skipped: number }> {
  console.log(`[RLHF] Batch linking ${outcomes.length} trade outcomes...`);

  const results = {
    success: 0,
    failed: 0,
    skipped: 0,
  };

  for (const outcome of outcomes) {
    const result = await linkTradeOutcome(
      outcome.tradeId,
      outcome.realizedPnl,
      outcome.exitReason
    );

    if (result.success) {
      if (result.engineRunId) {
        results.success++;
      } else {
        results.skipped++;
      }
    } else {
      results.failed++;
    }
  }

  console.log(`[RLHF] Batch complete: ${results.success} success, ${results.skipped} skipped, ${results.failed} failed`);
  return results;
}

/**
 * Normalize exit reason to a standard format.
 *
 * Maps various exit reason strings to standardized values
 * for consistent RLHF training data.
 */
export function normalizeExitReason(rawReason: string | null | undefined): string {
  if (!rawReason) return 'unknown';

  const reason = rawReason.toLowerCase();

  // Stop loss variants
  if (reason.includes('stop') || reason.includes('layer 1') || reason.includes('layer 2')) {
    return 'stop_loss';
  }

  // Take profit variants
  if (reason.includes('profit') || reason.includes('target')) {
    return 'take_profit';
  }

  // Expiration variants
  if (reason.includes('expir') || reason.includes('worthless')) {
    return 'expiration';
  }

  // Manual close variants
  if (reason.includes('manual') || reason.includes('closed via')) {
    return 'manual';
  }

  // Auto-close variants
  if (reason.includes('auto-close') || reason.includes('0dte')) {
    return 'auto_close';
  }

  // Assignment/exercise variants
  if (reason.includes('assign') || reason.includes('exercis') || reason.includes('itm')) {
    return 'assignment';
  }

  // Time stop variants
  if (reason.includes('time')) {
    return 'time_stop';
  }

  // Default to the raw reason if no match
  return rawReason.substring(0, 50); // Truncate long reasons
}
