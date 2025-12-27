/**
 * Data Capture Status API Routes
 *
 * Provides endpoints for monitoring the 5-minute data capture job.
 */

import { Router } from 'express';
import { db } from '../db';
import { continuousJobStatus, optionBars } from '@shared/schema';
import { eq, sql, desc } from 'drizzle-orm';
import { getOptionChainStreamer } from '../broker/optionChainStreamer';
import { isFiveMinuteCaptureRunning } from '../services/jobs/fiveMinuteDataCapture';
import { getETDateString } from '../services/marketCalendar';

const router = Router();

// ============================================
// GET /api/data-capture/status
// Returns current status of continuous data capture job
// ============================================

router.get('/status', async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({ ok: false, error: 'Database not initialized' });
    }

    // Get job status from database
    const [status] = await db
      .select()
      .from(continuousJobStatus)
      .where(eq(continuousJobStatus.id, 'option-data-capture'))
      .limit(1);

    // Get streaming status
    const streamer = getOptionChainStreamer();
    const wsStatus = streamer.getStatus();

    res.json({
      ok: true,
      status: status || null,
      streaming: {
        wsConnected: wsStatus.wsConnected,
        isStreaming: wsStatus.isStreaming,
        subscriptionCount: wsStatus.subscriptionCount,
        symbols: wsStatus.symbols,
      },
      schedulerRunning: isFiveMinuteCaptureRunning(),
    });
  } catch (error: any) {
    console.error('[DataCaptureAPI] Status error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ============================================
// GET /api/data-capture/history
// Returns capture history for a specific day
// Query params: ?date=YYYY-MM-DD (defaults to today)
// ============================================

router.get('/history', async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({ ok: false, error: 'Database not initialized' });
    }

    const date = (req.query.date as string) || getETDateString();

    // Get capture summary by interval
    const captures = await db
      .select({
        intervalStart: optionBars.intervalStart,
        dataQuality: optionBars.dataQuality,
        count: sql<number>`cast(count(*) as integer)`,
      })
      .from(optionBars)
      .where(sql`DATE(${optionBars.intervalStart}) = ${date}`)
      .groupBy(optionBars.intervalStart, optionBars.dataQuality)
      .orderBy(desc(optionBars.intervalStart));

    // Transform to grouped by interval
    const byInterval = new Map<string, { complete: number; partial: number; snapshotOnly: number }>();
    for (const c of captures) {
      const key = c.intervalStart.toISOString();
      if (!byInterval.has(key)) {
        byInterval.set(key, { complete: 0, partial: 0, snapshotOnly: 0 });
      }
      const entry = byInterval.get(key)!;
      if (c.dataQuality === 'complete') entry.complete = c.count;
      else if (c.dataQuality === 'partial') entry.partial = c.count;
      else if (c.dataQuality === 'snapshot_only') entry.snapshotOnly = c.count;
    }

    const history = Array.from(byInterval.entries()).map(([intervalStart, counts]) => ({
      intervalStart,
      ...counts,
      total: counts.complete + counts.partial + counts.snapshotOnly,
    }));

    res.json({
      ok: true,
      date,
      captureCount: history.length,
      history,
    });
  } catch (error: any) {
    console.error('[DataCaptureAPI] History error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ============================================
// GET /api/data-capture/stats
// Returns aggregate statistics for data collection
// Query params: ?days=7 (defaults to 7 days)
// ============================================

router.get('/stats', async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({ ok: false, error: 'Database not initialized' });
    }

    const days = parseInt(req.query.days as string) || 7;

    // Get total bar count
    const [totalResult] = await db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(optionBars);

    // Get counts by data quality
    const qualityCounts = await db
      .select({
        dataQuality: optionBars.dataQuality,
        count: sql<number>`cast(count(*) as integer)`,
      })
      .from(optionBars)
      .groupBy(optionBars.dataQuality);

    // Get capture counts by day (last N days)
    const dailyCounts = await db
      .select({
        date: sql<string>`DATE(${optionBars.intervalStart})`,
        count: sql<number>`cast(count(*) as integer)`,
      })
      .from(optionBars)
      .where(sql`${optionBars.intervalStart} >= NOW() - INTERVAL '${days} days'`)
      .groupBy(sql`DATE(${optionBars.intervalStart})`)
      .orderBy(desc(sql`DATE(${optionBars.intervalStart})`));

    const qualityBreakdown: Record<string, number> = {};
    for (const q of qualityCounts) {
      qualityBreakdown[q.dataQuality] = q.count;
    }

    res.json({
      ok: true,
      stats: {
        totalBars: totalResult?.count || 0,
        qualityBreakdown,
        dailyCounts: dailyCounts.map(d => ({ date: d.date, count: d.count })),
      },
    });
  } catch (error: any) {
    console.error('[DataCaptureAPI] Stats error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

export default router;
