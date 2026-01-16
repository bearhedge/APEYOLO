import * as cron from 'node-cron';
import { agent } from './autonomous';

let scheduledTask: ReturnType<typeof cron.schedule> | null = null;
let isStarted = false;

/**
 * Start the autonomous agent scheduler.
 * Runs every 15 minutes during market hours (9:30 AM - 4:00 PM ET, weekdays).
 */
export function startAutonomousAgent(): void {
  if (isStarted) {
    console.log('[Agent] Scheduler already running');
    return;
  }

  // Every 15 minutes during market hours (9-16 ET, weekdays)
  // Cron: minute hour day-of-month month day-of-week
  // */15 9-15 * * 1-5 = every 15 min, hours 9-15, Mon-Fri
  scheduledTask = cron.schedule('*/15 9-15 * * 1-5', async () => {
    console.log('[Agent] Scheduled wake-up triggered');
    try {
      await agent.wakeUp();
    } catch (error: any) {
      console.error('[Agent] Scheduled wake-up failed:', error.message);
    }
  }, {
    timezone: 'America/New_York',
  });

  isStarted = true;
  console.log('[Agent] Scheduler started - runs every 15 min, 9:00-15:45 ET, Mon-Fri');
}

/**
 * Stop the autonomous agent scheduler.
 */
export function stopAutonomousAgent(): void {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    isStarted = false;
    console.log('[Agent] Scheduler stopped');
  }
}

/**
 * Check if the scheduler is running.
 */
export function isSchedulerRunning(): boolean {
  return isStarted;
}

/**
 * Manually trigger a wake-up (for testing).
 */
export async function triggerManualWakeUp(): Promise<void> {
  console.log('[Agent] Manual wake-up triggered');
  await agent.wakeUp();
}

/**
 * Get scheduler status.
 */
export function getSchedulerStatus(): {
  isRunning: boolean;
  nextRun: string | null;
  timezone: string;
} {
  if (!isStarted || !scheduledTask) {
    return {
      isRunning: false,
      nextRun: null,
      timezone: 'America/New_York',
    };
  }

  // Calculate next run time
  const now = new Date();
  const etNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const hour = etNow.getHours();
  const minute = etNow.getMinutes();
  const day = etNow.getDay();

  // Check if within market hours
  const isMarketHours = hour >= 9 && hour < 16 && day >= 1 && day <= 5;

  let nextRun: string | null = null;
  if (isMarketHours) {
    // Next 15-minute interval
    const nextMinute = Math.ceil(minute / 15) * 15;
    if (nextMinute >= 60) {
      nextRun = `${(hour + 1).toString().padStart(2, '0')}:00 ET`;
    } else {
      nextRun = `${hour.toString().padStart(2, '0')}:${nextMinute.toString().padStart(2, '0')} ET`;
    }
  } else {
    nextRun = 'Next market open (9:00 ET)';
  }

  return {
    isRunning: true,
    nextRun,
    timezone: 'America/New_York',
  };
}
