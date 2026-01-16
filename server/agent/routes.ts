import { Router, Request, Response } from 'express';
import { db } from '../db';
import { agentLogs, agentObservations } from '@shared/schema';
import { desc, eq } from 'drizzle-orm';
import {
  agentEvents,
  getSchedulerStatus,
  triggerManualWakeUp,
  startAutonomousAgent,
  stopAutonomousAgent,
} from './index';

const router = Router();

/**
 * SSE endpoint for live agent logs
 * GET /api/agent/logs/stream
 */
router.get('/logs/stream', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`);

  // Listen for log events
  const onLog = (entry: any) => {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  };

  agentEvents.on('log', onLog);

  // Heartbeat every 30 seconds
  const heartbeat = setInterval(() => {
    res.write(`: heartbeat\n\n`);
  }, 30000);

  // Cleanup on disconnect
  req.on('close', () => {
    agentEvents.off('log', onLog);
    clearInterval(heartbeat);
  });
});

/**
 * Get recent logs
 * GET /api/agent/logs?limit=50&sessionId=xxx
 */
router.get('/logs', async (req: Request, res: Response) => {
  if (!db) {
    return res.status(503).json({ error: 'Database not available' });
  }

  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const sessionId = req.query.sessionId as string;

  try {
    const logs = sessionId
      ? await db
          .select()
          .from(agentLogs)
          .where(eq(agentLogs.sessionId, sessionId))
          .orderBy(desc(agentLogs.timestamp))
          .limit(limit)
      : await db
          .select()
          .from(agentLogs)
          .orderBy(desc(agentLogs.timestamp))
          .limit(limit);

    res.json(logs);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get recent observations
 * GET /api/agent/observations?limit=20
 */
router.get('/observations', async (req: Request, res: Response) => {
  if (!db) {
    return res.status(503).json({ error: 'Database not available' });
  }

  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

  try {
    const observations = await db
      .select()
      .from(agentObservations)
      .orderBy(desc(agentObservations.timestamp))
      .limit(limit);

    res.json(observations);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get scheduler status
 * GET /api/agent/status
 */
router.get('/status', (_req: Request, res: Response) => {
  const status = getSchedulerStatus();
  res.json(status);
});

/**
 * Manually trigger a wake-up (for testing)
 * POST /api/agent/wake
 */
router.post('/wake', async (_req: Request, res: Response) => {
  try {
    await triggerManualWakeUp();
    res.json({ success: true, message: 'Wake-up triggered' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Start the scheduler
 * POST /api/agent/start
 */
router.post('/start', (_req: Request, res: Response) => {
  try {
    startAutonomousAgent();
    res.json({ success: true, message: 'Scheduler started' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Stop the scheduler
 * POST /api/agent/stop
 */
router.post('/stop', (_req: Request, res: Response) => {
  try {
    stopAutonomousAgent();
    res.json({ success: true, message: 'Scheduler stopped' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
