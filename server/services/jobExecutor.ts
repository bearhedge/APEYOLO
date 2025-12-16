/**
 * Job Executor Service
 *
 * Executes scheduled jobs triggered by Cloud Scheduler or manual UI triggers.
 * Handles idempotency, market calendar checks, and job run logging.
 */

import { db } from '../db';
import { jobs, jobRuns, type Job, type JobRun } from '@shared/schema';
import { eq, and, desc } from 'drizzle-orm';
import { isMarketOpen, getETDateString, getMarketStatus } from './marketCalendar';

// ============================================
// Types
// ============================================

export interface JobResult {
  success: boolean;
  skipped?: boolean;
  reason?: string;
  data?: any;
  error?: string;
}

export interface JobHandler {
  id: string;
  name: string;
  description: string;
  execute: () => Promise<JobResult>;
}

export type TriggerSource = 'scheduler' | 'manual';

// ============================================
// Job Handler Registry
// ============================================

const jobHandlers = new Map<string, JobHandler>();

/**
 * Register a job handler
 */
export function registerJobHandler(handler: JobHandler): void {
  console.log(`[JobExecutor] Registering handler: ${handler.id}`);
  jobHandlers.set(handler.id, handler);
}

/**
 * Get all registered handlers
 */
export function getRegisteredHandlers(): JobHandler[] {
  return Array.from(jobHandlers.values());
}

// ============================================
// Job Execution
// ============================================

/**
 * Execute a job by ID
 * Handles idempotency, market calendar, and logging
 */
export async function executeJob(
  jobId: string,
  triggeredBy: TriggerSource = 'scheduler',
  options?: { forceRun?: boolean; skipMarketCheck?: boolean }
): Promise<JobRun> {
  const startTime = Date.now();
  const marketDay = getETDateString();

  console.log(`[JobExecutor] Starting job execution: ${jobId} (triggered by: ${triggeredBy})`);

  // 1. Get job definition from database
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);

  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  if (!job.enabled && triggeredBy === 'scheduler') {
    console.log(`[JobExecutor] Job ${jobId} is disabled, skipping`);
    return createJobRun(jobId, triggeredBy, marketDay, {
      success: false,
      skipped: true,
      reason: 'Job is disabled',
    }, startTime);
  }

  // 2. Check idempotency (prevent duplicate runs on same market day)
  if (!options?.forceRun) {
    const existingRun = await db
      .select()
      .from(jobRuns)
      .where(
        and(
          eq(jobRuns.jobId, jobId),
          eq(jobRuns.marketDay, marketDay),
          eq(jobRuns.status, 'success')
        )
      )
      .limit(1);

    if (existingRun.length > 0) {
      console.log(`[JobExecutor] Job ${jobId} already ran successfully today (${marketDay})`);
      return createJobRun(jobId, triggeredBy, marketDay, {
        success: false,
        skipped: true,
        reason: `Already ran successfully today (${marketDay})`,
      }, startTime);
    }
  }

  // 3. Check market calendar (unless skipped or manual with force)
  // Also check job.config.skipMarketCheck for jobs that should run after market close (e.g., closing NAV)
  const jobConfig = (job.config as Record<string, any>) || {};
  if (!options?.skipMarketCheck && !jobConfig.skipMarketCheck && triggeredBy === 'scheduler') {
    const marketStatus = getMarketStatus();
    if (!marketStatus.isOpen) {
      console.log(`[JobExecutor] Market closed: ${marketStatus.reason}`);
      return createJobRun(jobId, triggeredBy, marketDay, {
        success: false,
        skipped: true,
        reason: `Market closed: ${marketStatus.reason}`,
      }, startTime);
    }
  }

  // 4. Get job handler
  const handler = jobHandlers.get(jobId);
  if (!handler) {
    console.error(`[JobExecutor] No handler registered for job: ${jobId}`);
    return createJobRun(jobId, triggeredBy, marketDay, {
      success: false,
      error: `No handler registered for job: ${jobId}`,
    }, startTime);
  }

  // 5. Create 'running' job run record
  const [runningRecord] = await db
    .insert(jobRuns)
    .values({
      jobId,
      status: 'running',
      triggeredBy,
      marketDay,
    })
    .returning();

  // 6. Execute the job handler
  let result: JobResult;
  try {
    console.log(`[JobExecutor] Executing handler for: ${jobId}`);
    result = await handler.execute();
    console.log(`[JobExecutor] Handler completed:`, result.success ? 'SUCCESS' : result.skipped ? 'SKIPPED' : 'FAILED');
  } catch (error: any) {
    console.error(`[JobExecutor] Handler threw error:`, error);
    result = {
      success: false,
      error: error.message || 'Unknown error',
    };
  }

  // 7. Calculate duration and determine status
  const durationMs = Date.now() - startTime;
  const status = result.success ? 'success' : result.skipped ? 'skipped' : 'failed';

  // 8. Update job run record with result
  const [updatedRun] = await db
    .update(jobRuns)
    .set({
      status,
      endedAt: new Date(),
      durationMs,
      result: result.data ? result.data : null,
      error: result.error || result.reason || null,
    })
    .where(eq(jobRuns.id, runningRecord.id))
    .returning();

  // 9. Update job's lastRunAt and lastRunStatus
  await db
    .update(jobs)
    .set({
      lastRunAt: new Date(),
      lastRunStatus: status,
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, jobId));

  console.log(`[JobExecutor] Job ${jobId} completed: ${status} (${durationMs}ms)`);

  return updatedRun;
}

/**
 * Helper to create a job run record for skipped/failed jobs
 */
async function createJobRun(
  jobId: string,
  triggeredBy: TriggerSource,
  marketDay: string,
  result: JobResult,
  startTime: number
): Promise<JobRun> {
  const durationMs = Date.now() - startTime;
  const status = result.success ? 'success' : result.skipped ? 'skipped' : 'failed';

  const [jobRun] = await db
    .insert(jobRuns)
    .values({
      jobId,
      status,
      triggeredBy,
      marketDay,
      endedAt: new Date(),
      durationMs,
      result: result.data ? result.data : null,
      error: result.error || result.reason || null,
    })
    .returning();

  return jobRun;
}

// ============================================
// Job Management
// ============================================

/**
 * Get all jobs with their latest run info
 */
export async function getAllJobs(): Promise<Array<Job & { latestRun?: JobRun }>> {
  const allJobs = await db.select().from(jobs);

  // Get latest run for each job
  const jobsWithRuns = await Promise.all(
    allJobs.map(async (job) => {
      const [latestRun] = await db
        .select()
        .from(jobRuns)
        .where(eq(jobRuns.jobId, job.id))
        .orderBy(desc(jobRuns.startedAt))
        .limit(1);

      return { ...job, latestRun };
    })
  );

  return jobsWithRuns;
}

/**
 * Get job by ID
 */
export async function getJob(jobId: string): Promise<Job | null> {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  return job || null;
}

/**
 * Get job run history
 */
export async function getJobHistory(
  limit: number = 50,
  jobId?: string
): Promise<JobRun[]> {
  let query = db.select().from(jobRuns).orderBy(desc(jobRuns.startedAt)).limit(limit);

  if (jobId) {
    query = db
      .select()
      .from(jobRuns)
      .where(eq(jobRuns.jobId, jobId))
      .orderBy(desc(jobRuns.startedAt))
      .limit(limit);
  }

  return await query;
}

/**
 * Enable or disable a job
 */
export async function setJobEnabled(jobId: string, enabled: boolean): Promise<Job> {
  const [updated] = await db
    .update(jobs)
    .set({ enabled, updatedAt: new Date() })
    .where(eq(jobs.id, jobId))
    .returning();

  if (!updated) {
    throw new Error(`Job not found: ${jobId}`);
  }

  return updated;
}

/**
 * Seed default jobs if they don't exist
 * IMPORTANT: Guards against null db when DATABASE_URL is not set
 */
export async function seedDefaultJobs(): Promise<void> {
  // Guard: Skip if database is not configured
  if (!db) {
    console.log('[JobExecutor] Database not configured - skipping job seeding');
    return;
  }

  const defaultJobs: Array<{
    id: string;
    name: string;
    description: string;
    type: string;
    schedule: string;
    config: any;
  }> = [
    // market-close-options removed - using live IBKR stream instead
    {
      id: 'economic-calendar-refresh',
      name: 'Economic Calendar Refresh',
      description: 'Refresh macroeconomic events (FOMC, CPI, NFP, GDP) from FRED API',
      type: 'economic-calendar-refresh',
      schedule: '0 0 1 * *', // Midnight ET on 1st of each month
      config: { daysAhead: 90 },
    },
  ];

  for (const jobDef of defaultJobs) {
    const existing = await getJob(jobDef.id);
    if (!existing) {
      console.log(`[JobExecutor] Seeding default job: ${jobDef.id}`);
      await db.insert(jobs).values({
        id: jobDef.id,
        name: jobDef.name,
        description: jobDef.description,
        type: jobDef.type,
        schedule: jobDef.schedule,
        timezone: 'America/New_York',
        enabled: true,
        config: jobDef.config,
      });
    }
  }
}
