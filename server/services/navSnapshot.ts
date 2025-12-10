/**
 * NAV Snapshot Service
 *
 * Captures end-of-day Net Asset Value for accurate Day P&L calculation.
 * Uses marked-to-market accounting (consistent with standard fund accounting).
 *
 * Schedule: 4:15 PM ET on weekdays (after market close at 4:00 PM)
 */

import { db } from '../db';
import { navSnapshots, jobs } from '@shared/schema';
import { eq, desc } from 'drizzle-orm';
import { getBroker } from '../broker';
import { ensureIbkrReady } from '../broker/ibkr';
import { registerJobHandler, type JobResult } from './jobExecutor';

// ============================================
// NAV Capture Logic
// ============================================

/**
 * Capture the current NAV and save to database
 */
export async function captureNavSnapshot(): Promise<JobResult> {
  console.log('[NavSnapshot] Capturing NAV snapshot...');

  if (!db) {
    return { success: false, error: 'Database not available' };
  }

  try {
    // Get current NAV from IBKR
    const broker = getBroker();
    let nav = 0;

    if (broker.status.provider === 'ibkr') {
      try {
        await ensureIbkrReady();
        const account = await broker.api.getAccount();
        nav = account?.portfolioValue || account?.netLiquidation || 0;
      } catch (err) {
        console.warn('[NavSnapshot] Could not fetch IBKR account:', err);
        return { success: false, error: 'Failed to fetch IBKR account data' };
      }
    } else {
      return { success: false, error: 'IBKR broker not available' };
    }

    if (nav <= 0) {
      return { success: false, error: 'Invalid NAV value received' };
    }

    // Get today's date in ET timezone
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); // YYYY-MM-DD

    // Check if we already have a snapshot for today
    const [existing] = await db
      .select()
      .from(navSnapshots)
      .where(eq(navSnapshots.date, today))
      .limit(1);

    if (existing) {
      // Update existing snapshot
      console.log(`[NavSnapshot] Updating existing snapshot for ${today}: $${nav.toFixed(2)}`);
      await db
        .update(navSnapshots)
        .set({ nav: nav.toString() })
        .where(eq(navSnapshots.id, existing.id));
    } else {
      // Create new snapshot
      console.log(`[NavSnapshot] Creating new snapshot for ${today}: $${nav.toFixed(2)}`);
      await db.insert(navSnapshots).values({
        date: today,
        nav: nav.toString(),
      });
    }

    return {
      success: true,
      data: {
        date: today,
        nav,
        action: existing ? 'updated' : 'created',
      },
    };
  } catch (error: any) {
    console.error('[NavSnapshot] Error:', error);
    return { success: false, error: error.message || 'Unknown error' };
  }
}

/**
 * Get the most recent NAV snapshot (for Day P&L calculation)
 * @returns The previous trading day's NAV, or null if not found
 */
export async function getPreviousNavSnapshot(): Promise<{ date: string; nav: number } | null> {
  if (!db) return null;

  try {
    // Get today's date in ET timezone
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

    // Get the most recent snapshot that's NOT today
    const [snapshot] = await db
      .select()
      .from(navSnapshots)
      .where(
        // We want the most recent snapshot before today
        // Using desc order on date and taking first non-today result
        // Since we use text dates, string comparison works for YYYY-MM-DD
      )
      .orderBy(desc(navSnapshots.date))
      .limit(2); // Get 2 in case first is today

    if (!snapshot) return null;

    // If the most recent is today, we need the second one
    const [first, second] = await db
      .select()
      .from(navSnapshots)
      .orderBy(desc(navSnapshots.date))
      .limit(2);

    const previousSnapshot = first?.date === today ? second : first;

    if (!previousSnapshot) return null;

    return {
      date: previousSnapshot.date,
      nav: parseFloat(previousSnapshot.nav as any) || 0,
    };
  } catch (error) {
    console.error('[NavSnapshot] Error getting previous snapshot:', error);
    return null;
  }
}

// ============================================
// Job Handler Registration
// ============================================

/**
 * Register the NAV snapshot job handler
 */
export function initNavSnapshotJob(): void {
  console.log('[NavSnapshot] Initializing job handler...');

  registerJobHandler({
    id: 'nav-snapshot',
    name: 'NAV Snapshot',
    description: 'Capture end-of-day NAV for Day P&L calculation',
    execute: captureNavSnapshot,
  });

  console.log('[NavSnapshot] Job handler registered');
}

/**
 * Create the nav-snapshot job in the database if it doesn't exist
 */
export async function ensureNavSnapshotJob(): Promise<void> {
  if (!db) return;

  try {
    const [existingJob] = await db.select().from(jobs).where(eq(jobs.id, 'nav-snapshot')).limit(1);

    if (!existingJob) {
      console.log('[NavSnapshot] Creating nav-snapshot job in database...');
      await db.insert(jobs).values({
        id: 'nav-snapshot',
        name: 'NAV Snapshot',
        description: 'Capture end-of-day NAV for Day P&L calculation',
        type: 'nav-snapshot',
        schedule: '15 16 * * 1-5', // 4:15 PM ET on weekdays (after market close)
        timezone: 'America/New_York',
        enabled: true,
        config: {},
      });
      console.log('[NavSnapshot] Job created successfully');
    }
  } catch (err) {
    console.warn('[NavSnapshot] Could not ensure job exists:', err);
  }
}
