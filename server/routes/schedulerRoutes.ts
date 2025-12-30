/**
 * Cloud Scheduler Routes
 *
 * Endpoints for Google Cloud Scheduler to trigger autonomous trading.
 * These endpoints use OIDC authentication instead of user JWT.
 */

import { Router, Request, Response } from 'express';
import { requireCloudSchedulerOrDev } from '../middleware/cloudSchedulerAuth';
import { engineScheduler } from '../services/engineScheduler';
import { isMarketOpen, getMarketStatus, getETDateString } from '../services/marketCalendar';

const router = Router();

/**
 * POST /api/cron/trading/start
 *
 * Called by Cloud Scheduler at 11 AM ET to start autonomous trading.
 * Starts the engine scheduler which runs every 5 minutes.
 */
router.post('/trading/start', requireCloudSchedulerOrDev, async (req: Request, res: Response) => {
  const timestamp = new Date().toISOString();
  console.log(`[Cron] /trading/start called at ${timestamp}`);

  try {
    // Check if market is open today
    const now = new Date();
    const marketStatus = getMarketStatus(now);

    if (!isMarketOpen(now)) {
      console.log(`[Cron] Market closed: ${marketStatus.reason}`);
      res.json({
        success: true,
        started: false,
        reason: marketStatus.reason,
        timestamp,
      });
      return;
    }

    // Start the engine scheduler
    const status = engineScheduler.getStatus();

    if (status.isRunning) {
      console.log('[Cron] Engine scheduler already running');
      res.json({
        success: true,
        started: false,
        reason: 'Already running',
        status,
        timestamp,
      });
      return;
    }

    // Start scheduler with config for single daily trade
    engineScheduler.start({
      enabled: true,
      intervalMinutes: 5,
      tradingWindowStart: 11, // 11 AM ET
      tradingWindowEnd: 13,   // 1 PM ET
      maxTradesPerDay: 1,     // Single trade per day
      autoExecute: true,
      symbol: 'SPY',
    });

    console.log('[Cron] Engine scheduler started for autonomous trading');

    res.json({
      success: true,
      started: true,
      reason: 'Scheduler started',
      status: engineScheduler.getStatus(),
      timestamp,
    });
  } catch (error: any) {
    console.error('[Cron] Error starting trading:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp,
    });
  }
});

/**
 * POST /api/cron/trading/stop
 *
 * Called by Cloud Scheduler at 4 PM ET to stop autonomous trading.
 */
router.post('/trading/stop', requireCloudSchedulerOrDev, async (req: Request, res: Response) => {
  const timestamp = new Date().toISOString();
  console.log(`[Cron] /trading/stop called at ${timestamp}`);

  try {
    const status = engineScheduler.getStatus();

    if (!status.isRunning) {
      console.log('[Cron] Engine scheduler not running');
      res.json({
        success: true,
        stopped: false,
        reason: 'Not running',
        timestamp,
      });
      return;
    }

    // Stop the scheduler
    engineScheduler.stop();
    console.log('[Cron] Engine scheduler stopped');

    res.json({
      success: true,
      stopped: true,
      summary: {
        tradesToday: status.tradesToday,
        cyclesRun: status.cyclesRun,
        lastCycleAt: status.lastCycleAt,
      },
      timestamp,
    });
  } catch (error: any) {
    console.error('[Cron] Error stopping trading:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp,
    });
  }
});

/**
 * POST /api/cron/positions/close
 *
 * Called by Cloud Scheduler at 3:55 PM ET to close risky positions.
 * Triggers the 0DTE position manager.
 */
router.post('/positions/close', requireCloudSchedulerOrDev, async (req: Request, res: Response) => {
  const timestamp = new Date().toISOString();
  console.log(`[Cron] /positions/close called at ${timestamp}`);

  try {
    // Import dynamically to avoid circular deps
    const { run0dtePositionManager } = await import('../services/jobs/0dtePositionManager');

    const result = await run0dtePositionManager();

    res.json({
      success: true,
      result,
      timestamp,
    });
  } catch (error: any) {
    console.error('[Cron] Error closing positions:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp,
    });
  }
});

/**
 * GET /api/cron/status
 *
 * Get current status of autonomous trading.
 * Can be used by Cloud Scheduler health checks or Jobs page.
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const status = engineScheduler.getStatus();
    const marketStatus = getMarketStatus();
    const dateStr = getETDateString();

    res.json({
      success: true,
      scheduler: status,
      market: marketStatus,
      date: dateStr,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
