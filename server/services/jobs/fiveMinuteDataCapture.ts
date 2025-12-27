/**
 * 5-Minute Data Capture Scheduler
 *
 * Runs the option bar capture job every 5 minutes, aligned to clock boundaries.
 * Tracks status in continuous_job_status table for observability.
 */

import { db } from '../../db';
import { continuousJobStatus } from '@shared/schema';
import { eq, sql } from 'drizzle-orm';
import { captureOptionBars, type CaptureResult } from './optionBarCapture';
import { getMarketStatus, getETDateString } from '../marketCalendar';

// ============================================
// Constants
// ============================================

const JOB_ID = 'option-data-capture';
const CAPTURE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// ============================================
// State
// ============================================

let captureInterval: NodeJS.Timeout | null = null;
let isRunning = false;

// ============================================
// Job Status Management
// ============================================

/**
 * Update job status in database
 */
async function updateJobStatus(updates: Partial<{
  isRunning: boolean;
  lastCaptureAt: Date;
  lastCaptureResult: string;
  lastError: string | null;
  captureCountToday: number;
  completeCount: number;
  partialCount: number;
  snapshotOnlyCount: number;
  wsConnected: boolean;
  marketDay: string;
}>): Promise<void> {
  if (!db) return;

  try {
    // Upsert the status row
    await db
      .insert(continuousJobStatus)
      .values({
        id: JOB_ID,
        ...updates,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: continuousJobStatus.id,
        set: {
          ...updates,
          updatedAt: new Date(),
        },
      });
  } catch (error) {
    console.error('[5MinCapture] Failed to update job status:', error);
  }
}

/**
 * Get current job status from database
 */
async function getJobStatus(): Promise<typeof continuousJobStatus.$inferSelect | null> {
  if (!db) return null;

  try {
    const [status] = await db
      .select()
      .from(continuousJobStatus)
      .where(eq(continuousJobStatus.id, JOB_ID))
      .limit(1);
    return status || null;
  } catch (error) {
    console.error('[5MinCapture] Failed to get job status:', error);
    return null;
  }
}

/**
 * Reset daily counts if it's a new market day
 */
async function resetDailyCountsIfNeeded(): Promise<void> {
  const today = getETDateString();
  const status = await getJobStatus();

  if (!status || status.marketDay !== today) {
    console.log(`[5MinCapture] New market day ${today}, resetting counts`);
    await updateJobStatus({
      marketDay: today,
      captureCountToday: 0,
      completeCount: 0,
      partialCount: 0,
      snapshotOnlyCount: 0,
    });
  }
}

// ============================================
// Capture Execution
// ============================================

/**
 * Run a single capture cycle
 */
async function runCapture(): Promise<void> {
  const marketStatus = getMarketStatus();

  // Skip if market is closed
  if (!marketStatus.isOpen) {
    console.log(`[5MinCapture] Market closed (${marketStatus.reason}), skipping`);
    return;
  }

  // Reset daily counts if needed
  await resetDailyCountsIfNeeded();

  try {
    console.log('[5MinCapture] Starting capture...');
    const result = await captureOptionBars('SPY');

    // Update status with results
    const currentStatus = await getJobStatus();
    await updateJobStatus({
      lastCaptureAt: new Date(),
      lastCaptureResult: 'success',
      lastError: null,
      captureCountToday: (currentStatus?.captureCountToday ?? 0) + 1,
      completeCount: (currentStatus?.completeCount ?? 0) + result.completeCount,
      partialCount: (currentStatus?.partialCount ?? 0) + result.partialCount,
      snapshotOnlyCount: (currentStatus?.snapshotOnlyCount ?? 0) + result.snapshotOnlyCount,
      wsConnected: result.wsConnected,
    });

    console.log(`[5MinCapture] Capture successful: ${result.barsInserted} bars`);
  } catch (error: any) {
    console.error('[5MinCapture] Capture failed:', error.message);
    await updateJobStatus({
      lastCaptureAt: new Date(),
      lastCaptureResult: 'error',
      lastError: error.message,
    });
  }
}

// ============================================
// Scheduler Control
// ============================================

/**
 * Start the 5-minute capture scheduler
 */
export function startFiveMinuteCapture(): void {
  if (captureInterval) {
    console.log('[5MinCapture] Already running');
    return;
  }

  console.log('[5MinCapture] Starting 5-minute capture scheduler');
  isRunning = true;

  // Mark as running in database
  updateJobStatus({ isRunning: true });

  // Calculate time until next 5-minute boundary
  const now = new Date();
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();
  const msToNextInterval = ((5 - (minutes % 5)) * 60 - seconds) * 1000 - now.getMilliseconds();

  console.log(`[5MinCapture] First capture in ${Math.round(msToNextInterval / 1000)}s (aligned to 5-min boundary)`);

  // Run first capture at next boundary, then every 5 minutes
  setTimeout(() => {
    runCapture();
    captureInterval = setInterval(runCapture, CAPTURE_INTERVAL_MS);
  }, msToNextInterval);
}

/**
 * Stop the 5-minute capture scheduler
 */
export function stopFiveMinuteCapture(): void {
  if (captureInterval) {
    clearInterval(captureInterval);
    captureInterval = null;
    isRunning = false;
    console.log('[5MinCapture] Stopped');

    // Mark as not running in database
    updateJobStatus({ isRunning: false });
  }
}

/**
 * Check if the scheduler is running
 */
export function isFiveMinuteCaptureRunning(): boolean {
  return isRunning && captureInterval !== null;
}
