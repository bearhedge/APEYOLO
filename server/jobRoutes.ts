/**
 * Jobs API Routes
 *
 * Endpoints for job management, triggering, and history.
 * Cloud Scheduler hits /api/jobs/:id/trigger
 * UI hits /api/jobs/:id/run for manual triggers
 *
 * IMPORTANT: Specific routes (/history, /calendar, /snapshots) must be
 * defined BEFORE parameterized routes (/:id) to prevent route shadowing.
 */

import { Router, Request, Response } from 'express';
import {
  executeJob,
  getAllJobs,
  getJob,
  getJobHistory,
  setJobEnabled,
  seedDefaultJobs,
} from './services/jobExecutor';
import {
  getMarketCalendar,
  getMarketStatus,
  getUpcomingMarketEvents,
  getETDateString,
} from './services/marketCalendar';
import { getLatestSnapshot, getSnapshotHistory } from './services/jobs/optionChainCapture';
import { getUpcomingEconomicEvents, isFREDConfigured } from './services/fredApi';

// Unified event type for the calendar API
interface CalendarEvent {
  date: string;
  event: string;
  type: 'holiday' | 'early_close' | 'economic';
  impactLevel?: 'low' | 'medium' | 'high' | 'critical';
  time?: string;
}

const router = Router();

// ============================================
// Static Routes (MUST come before /:id routes)
// ============================================

/**
 * GET /api/jobs - List all jobs with their latest run info
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const jobs = await getAllJobs();
    res.json({ ok: true, jobs });
  } catch (error: any) {
    console.error('[JobRoutes] Error listing jobs:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/jobs/history - Get job run history
 */
router.get('/history', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const jobId = req.query.jobId as string | undefined;

    const history = await getJobHistory(limit, jobId);
    res.json({ ok: true, history });
  } catch (error: any) {
    console.error('[JobRoutes] Error getting history:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/jobs/calendar - Get market calendar and status
 *
 * Returns market status, market holidays/early close days, and economic events
 * merged into a unified upcomingEvents array sorted by date.
 */
router.get('/calendar', async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const now = new Date();

    const marketStatus = getMarketStatus(now);
    const calendar = getMarketCalendar(now, days);

    // Get market events (holidays, early close days)
    const marketEvents = getUpcomingMarketEvents(60);

    // Convert market events to unified format
    const unifiedMarketEvents: CalendarEvent[] = marketEvents.map((event) => ({
      date: event.date,
      event: event.event,
      type: event.type,
    }));

    // Get economic events from database (if FRED is configured)
    let economicEvents: CalendarEvent[] = [];
    try {
      const dbEconomicEvents = await getUpcomingEconomicEvents(60);
      economicEvents = dbEconomicEvents.map((event) => ({
        date: event.eventDate,
        event: event.eventName,
        type: 'economic' as const,
        impactLevel: event.impactLevel as 'low' | 'medium' | 'high' | 'critical',
        time: event.eventTime || undefined,
      }));
    } catch (err) {
      // If database query fails, continue without economic events
      console.warn('[JobRoutes] Could not fetch economic events:', err);
    }

    // Merge and sort all events by date
    const upcomingEvents = [...unifiedMarketEvents, ...economicEvents].sort(
      (a, b) => a.date.localeCompare(b.date)
    );

    res.json({
      ok: true,
      today: getETDateString(now),
      marketStatus,
      upcomingEvents,
      calendar,
      fredConfigured: isFREDConfigured(),
    });
  } catch (error: any) {
    console.error('[JobRoutes] Error getting calendar:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/jobs/snapshots/:symbol - Get option chain snapshots for a symbol
 */
router.get('/snapshots/:symbol', async (req: Request, res: Response) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const days = parseInt(req.query.days as string) || 30;

    const snapshots = await getSnapshotHistory(symbol, days);
    res.json({ ok: true, symbol, count: snapshots.length, snapshots });
  } catch (error: any) {
    console.error('[JobRoutes] Error getting snapshots:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/jobs/snapshots/:symbol/latest - Get the latest snapshot
 */
router.get('/snapshots/:symbol/latest', async (req: Request, res: Response) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const snapshot = await getLatestSnapshot(symbol);

    if (!snapshot) {
      return res.status(404).json({ ok: false, error: `No snapshot found for ${symbol}` });
    }

    res.json({ ok: true, snapshot });
  } catch (error: any) {
    console.error('[JobRoutes] Error getting latest snapshot:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ============================================
// Parameterized Routes (MUST come after static routes)
// ============================================

/**
 * GET /api/jobs/:id - Get single job details
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const job = await getJob(req.params.id);
    if (!job) {
      return res.status(404).json({ ok: false, error: 'Job not found' });
    }
    res.json({ ok: true, job });
  } catch (error: any) {
    console.error('[JobRoutes] Error getting job:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * PUT /api/jobs/:id - Update job (enable/disable)
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ ok: false, error: 'enabled must be a boolean' });
    }

    const job = await setJobEnabled(req.params.id, enabled);
    res.json({ ok: true, job });
  } catch (error: any) {
    console.error('[JobRoutes] Error updating job:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * POST /api/jobs/:id/trigger - Cloud Scheduler endpoint
 * This is called by Google Cloud Scheduler at scheduled times
 */
router.post('/:id/trigger', async (req: Request, res: Response) => {
  const jobId = req.params.id;
  console.log(`[JobRoutes] Cloud Scheduler trigger for job: ${jobId}`);

  try {
    const jobRun = await executeJob(jobId, 'scheduler');
    res.json({
      ok: true,
      jobRun: {
        id: jobRun.id,
        status: jobRun.status,
        durationMs: jobRun.durationMs,
        error: jobRun.error,
      },
    });
  } catch (error: any) {
    console.error('[JobRoutes] Trigger error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * POST /api/jobs/:id/run - Manual trigger from UI
 * Allows forcing a run even if already ran today
 */
router.post('/:id/run', async (req: Request, res: Response) => {
  const jobId = req.params.id;
  const { forceRun, skipMarketCheck } = req.body;

  console.log(`[JobRoutes] Manual trigger for job: ${jobId} (force=${forceRun}, skipMarket=${skipMarketCheck})`);

  try {
    const jobRun = await executeJob(jobId, 'manual', {
      forceRun: !!forceRun,
      skipMarketCheck: !!skipMarketCheck,
    });
    res.json({
      ok: true,
      jobRun: {
        id: jobRun.id,
        status: jobRun.status,
        durationMs: jobRun.durationMs,
        result: jobRun.result,
        error: jobRun.error,
      },
    });
  } catch (error: any) {
    console.error('[JobRoutes] Manual run error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ============================================
// Initialization
// ============================================

/**
 * Initialize jobs system on server startup
 */
export async function initializeJobsSystem(): Promise<void> {
  console.log('[JobRoutes] Initializing jobs system...');

  // Register job handlers
  const { initializeOptionChainCaptureJob } = await import('./services/jobs/optionChainCapture');
  initializeOptionChainCaptureJob();

  const { initializeEconomicCalendarRefreshJob } = await import('./services/jobs/economicCalendarRefresh');
  initializeEconomicCalendarRefreshJob();

  // Initialize trade monitor job
  const { initTradeMonitorJob, ensureTradeMonitorJob } = await import('./services/tradeMonitor');
  initTradeMonitorJob();
  await ensureTradeMonitorJob();

  // Initialize NAV snapshot job
  const { initNavSnapshotJob, ensureNavSnapshotJob } = await import('./services/navSnapshot');
  initNavSnapshotJob();
  await ensureNavSnapshotJob();

  // Seed default jobs in database
  await seedDefaultJobs();

  console.log('[JobRoutes] Jobs system initialized');
}

export default router;
