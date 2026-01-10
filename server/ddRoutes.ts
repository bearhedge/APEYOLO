/**
 * DD Routes - Training and Research data persistence
 *
 * Handles saving training decisions and research observations
 * from the DD page's Train and Research modes.
 */

import { Router, Request, Response } from 'express';
import { db } from './db';
import { trainDecisions, observations } from '../shared/schema';

const router = Router();

/**
 * POST /api/dd/train-decisions
 * Save a training decision from Train mode
 */
router.post('/train-decisions', async (req: Request, res: Response) => {
  try {
    const {
      symbol,
      date,
      windowNumber,
      direction,
      reasoning,
      spotPriceAtDecision,
    } = req.body;

    // Validate required fields
    if (!symbol || !date || !windowNumber || !direction) {
      res.status(400).json({ error: 'Missing required fields: symbol, date, windowNumber, direction' });
      return;
    }

    // Validate windowNumber
    if (![1, 2, 3].includes(windowNumber)) {
      res.status(400).json({ error: 'windowNumber must be 1, 2, or 3' });
      return;
    }

    // Validate direction
    const validDirections = ['PUT', 'CALL', 'STRANGLE', 'NO_TRADE'];
    if (!validDirections.includes(direction)) {
      res.status(400).json({ error: `direction must be one of: ${validDirections.join(', ')}` });
      return;
    }

    // Get user ID from session if available (optional for now)
    const userId = (req as any).user?.id || null;

    // Insert decision
    const [inserted] = await db.insert(trainDecisions).values({
      userId,
      symbol: symbol.toUpperCase(),
      date,
      windowNumber,
      direction,
      reasoning: reasoning || null,
      spotPriceAtDecision: spotPriceAtDecision || null,
    }).returning();

    console.log(`[DD] Saved train decision: ${symbol} ${date} window${windowNumber} -> ${direction}`);

    res.json({
      success: true,
      decision: inserted,
    });
  } catch (error) {
    console.error('[DD] Failed to save train decision:', error);
    res.status(500).json({ error: 'Failed to save train decision' });
  }
});

/**
 * POST /api/dd/observations
 * Save a research observation from Research mode
 */
router.post('/observations', async (req: Request, res: Response) => {
  try {
    const {
      symbol,
      date,
      timestamp,
      direction,
      confidence,
      notes,
    } = req.body;

    // Validate required fields
    if (!symbol || !date || !timestamp || !direction || !confidence) {
      res.status(400).json({ error: 'Missing required fields: symbol, date, timestamp, direction, confidence' });
      return;
    }

    // Validate direction
    const validDirections = ['PUT', 'CALL', 'STRANGLE', 'WAIT', 'NO_TRADE'];
    if (!validDirections.includes(direction)) {
      res.status(400).json({ error: `direction must be one of: ${validDirections.join(', ')}` });
      return;
    }

    // Validate confidence
    const validConfidences = ['low', 'medium', 'high'];
    if (!validConfidences.includes(confidence)) {
      res.status(400).json({ error: `confidence must be one of: ${validConfidences.join(', ')}` });
      return;
    }

    // Get user ID from session if available (optional for now)
    const userId = (req as any).user?.id || null;

    // Insert observation
    const [inserted] = await db.insert(observations).values({
      userId,
      symbol: symbol.toUpperCase(),
      date,
      timestamp,
      direction,
      confidence,
      notes: notes || null,
    }).returning();

    console.log(`[DD] Saved observation: ${symbol} ${date} ${timestamp} -> ${direction} (${confidence})`);

    res.json({
      success: true,
      observation: inserted,
    });
  } catch (error) {
    console.error('[DD] Failed to save observation:', error);
    res.status(500).json({ error: 'Failed to save observation' });
  }
});

/**
 * GET /api/dd/train-decisions/:date
 * Get all training decisions for a specific date
 */
router.get('/train-decisions/:date', async (req: Request, res: Response) => {
  try {
    const { date } = req.params;
    const userId = (req as any).user?.id || null;

    const decisions = await db.query.trainDecisions.findMany({
      where: (t, { eq, and }) => and(
        eq(t.date, date),
        userId ? eq(t.userId, userId) : undefined
      ),
      orderBy: (t, { asc }) => [asc(t.windowNumber)],
    });

    res.json({ decisions });
  } catch (error) {
    console.error('[DD] Failed to get train decisions:', error);
    res.status(500).json({ error: 'Failed to get train decisions' });
  }
});

/**
 * GET /api/dd/observations/:date
 * Get all observations for a specific date
 */
router.get('/observations/:date', async (req: Request, res: Response) => {
  try {
    const { date } = req.params;
    const userId = (req as any).user?.id || null;

    const obs = await db.query.observations.findMany({
      where: (t, { eq, and }) => and(
        eq(t.date, date),
        userId ? eq(t.userId, userId) : undefined
      ),
      orderBy: (t, { asc }) => [asc(t.timestamp)],
    });

    res.json({ observations: obs });
  } catch (error) {
    console.error('[DD] Failed to get observations:', error);
    res.status(500).json({ error: 'Failed to get observations' });
  }
});

export default router;
