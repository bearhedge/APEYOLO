/**
 * NAV Snapshot Service
 *
 * Captures NAV snapshots for accurate Day P&L calculation:
 * - Opening snapshot at 9:30 AM ET (market open)
 * - Closing snapshot at 4:15 PM ET (after market close)
 *
 * Day P&L Logic:
 * - During market hours: Current NAV - Opening NAV (today's change)
 * - After market hours: Current NAV - Closing NAV (final day's P&L)
 */

import { db } from '../db';
import { navSnapshots, jobs } from '@shared/schema';
import { eq, desc, and } from 'drizzle-orm';
import { getBroker } from '../broker';
import { ensureIbkrReady } from '../broker/ibkr';
import { registerJobHandler, type JobResult } from './jobExecutor';

type SnapshotType = 'opening' | 'closing';

// ============================================
// NAV Capture Logic
// ============================================

/**
 * Capture the current NAV and save to database
 * @param snapshotType - 'opening' for market open, 'closing' for market close
 */
export async function captureNavSnapshot(snapshotType: SnapshotType = 'closing'): Promise<JobResult> {
  console.log(`[NavSnapshot] Capturing ${snapshotType} NAV snapshot...`);

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

    // Check if we already have a snapshot for today with this type
    const [existing] = await db
      .select()
      .from(navSnapshots)
      .where(and(
        eq(navSnapshots.date, today),
        eq(navSnapshots.snapshotType, snapshotType)
      ))
      .limit(1);

    if (existing) {
      // Update existing snapshot
      console.log(`[NavSnapshot] Updating existing ${snapshotType} snapshot for ${today}: $${nav.toFixed(2)}`);
      await db
        .update(navSnapshots)
        .set({ nav: nav.toString() })
        .where(eq(navSnapshots.id, existing.id));
    } else {
      // Create new snapshot
      console.log(`[NavSnapshot] Creating new ${snapshotType} snapshot for ${today}: $${nav.toFixed(2)}`);
      await db.insert(navSnapshots).values({
        date: today,
        snapshotType,
        nav: nav.toString(),
      });
    }

    return {
      success: true,
      data: {
        date: today,
        snapshotType,
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
 * Get today's opening NAV snapshot (for intraday Day P&L calculation)
 */
export async function getTodayOpeningSnapshot(): Promise<{ date: string; nav: number } | null> {
  if (!db) return null;

  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

    const [snapshot] = await db
      .select()
      .from(navSnapshots)
      .where(and(
        eq(navSnapshots.date, today),
        eq(navSnapshots.snapshotType, 'opening')
      ))
      .limit(1);

    if (!snapshot) return null;

    return {
      date: snapshot.date,
      nav: parseFloat(snapshot.nav as any) || 0,
    };
  } catch (error) {
    console.error('[NavSnapshot] Error getting opening snapshot:', error);
    return null;
  }
}

/**
 * Get the most recent closing NAV snapshot (for after-hours Day P&L)
 * Returns yesterday's closing NAV, or most recent available
 */
export async function getPreviousClosingSnapshot(): Promise<{ date: string; nav: number } | null> {
  if (!db) return null;

  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

    // Get the most recent closing snapshot that's NOT today
    const closingSnapshots = await db
      .select()
      .from(navSnapshots)
      .where(eq(navSnapshots.snapshotType, 'closing'))
      .orderBy(desc(navSnapshots.date))
      .limit(2);

    // Find the first one that's not today
    const previousSnapshot = closingSnapshots.find(s => s.date !== today) || closingSnapshots[0];

    if (!previousSnapshot) return null;

    return {
      date: previousSnapshot.date,
      nav: parseFloat(previousSnapshot.nav as any) || 0,
    };
  } catch (error) {
    console.error('[NavSnapshot] Error getting previous closing snapshot:', error);
    return null;
  }
}

/**
 * Get the most recent NAV snapshot (backwards compatibility)
 * @returns The previous trading day's NAV, or null if not found
 */
export async function getPreviousNavSnapshot(): Promise<{ date: string; nav: number } | null> {
  return getPreviousClosingSnapshot();
}

// ============================================
// Job Handler Registration
// ============================================

/**
 * Register the NAV snapshot job handler (opening only)
 */
export function initNavSnapshotJob(): void {
  console.log('[NavSnapshot] Initializing job handler...');

  // Opening snapshot (9:30 AM ET) - for Day P&L calculation
  registerJobHandler({
    id: 'nav-snapshot-opening',
    name: 'NAV Snapshot (Opening)',
    description: 'Capture market-open NAV for Day P&L calculation',
    execute: () => captureNavSnapshot('opening'),
  });

  console.log('[NavSnapshot] Job handler registered');
}

/**
 * Create the nav-snapshot-opening job in the database if it doesn't exist
 */
export async function ensureNavSnapshotJob(): Promise<void> {
  if (!db) return;

  try {
    const [existing] = await db.select().from(jobs).where(eq(jobs.id, 'nav-snapshot-opening')).limit(1);
    if (!existing) {
      console.log('[NavSnapshot] Creating nav-snapshot-opening job in database...');
      await db.insert(jobs).values({
        id: 'nav-snapshot-opening',
        name: 'NAV Snapshot (Opening)',
        description: 'Capture market-open NAV for Day P&L calculation',
        type: 'nav-snapshot',
        schedule: '30 9 * * 1-5', // 9:30 AM ET on weekdays (market open)
        timezone: 'America/New_York',
        enabled: true,
        config: { snapshotType: 'opening' },
      });
      console.log('[NavSnapshot] Opening snapshot job created');
    }
  } catch (err) {
    console.warn('[NavSnapshot] Could not ensure job exists:', err);
  }
}
