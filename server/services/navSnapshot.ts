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
import { navSnapshots, jobs, ibkrCredentials } from '@shared/schema';
import { eq, desc, and } from 'drizzle-orm';
import { getBrokerForUser } from '../broker';
import { ensureIbkrReady } from '../broker/ibkr';
import { registerJobHandler, type JobResult } from './jobExecutor';

type SnapshotType = 'opening' | 'closing';

// ============================================
// NAV Capture Logic
// ============================================

/**
 * Capture the current NAV for a specific user and save to database
 * @param snapshotType - 'opening' for market open, 'closing' for market close
 * @param userId - The user ID to capture NAV for
 */
async function captureNavSnapshotForUser(snapshotType: SnapshotType, userId: string): Promise<{ success: boolean; nav?: number; error?: string }> {
  try {
    // Get broker for this specific user
    const broker = await getBrokerForUser(userId);

    if (broker.status.provider !== 'ibkr' || !broker.api) {
      return { success: false, error: 'IBKR broker not available for user' };
    }

    await ensureIbkrReady();
    const account = await broker.api.getAccount();
    const nav = account?.portfolioValue || account?.netLiquidation || 0;

    if (nav <= 0) {
      return { success: false, error: 'Invalid NAV value received' };
    }

    // Get today's date in ET timezone
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); // YYYY-MM-DD

    // Check if we already have a snapshot for today with this type FOR THIS USER
    const [existing] = await db!
      .select()
      .from(navSnapshots)
      .where(and(
        eq(navSnapshots.date, today),
        eq(navSnapshots.snapshotType, snapshotType),
        eq(navSnapshots.userId, userId)
      ))
      .limit(1);

    if (existing) {
      // Update existing snapshot
      console.log(`[NavSnapshot] Updating ${snapshotType} snapshot for user ${userId} on ${today}: $${nav.toFixed(2)}`);
      await db!
        .update(navSnapshots)
        .set({ nav: nav.toString() })
        .where(eq(navSnapshots.id, existing.id));
    } else {
      // Create new snapshot WITH USER_ID
      console.log(`[NavSnapshot] Creating ${snapshotType} snapshot for user ${userId} on ${today}: $${nav.toFixed(2)}`);
      await db!.insert(navSnapshots).values({
        date: today,
        snapshotType,
        nav: nav.toString(),
        userId: userId,
      });
    }

    return { success: true, nav };
  } catch (err: any) {
    console.warn(`[NavSnapshot] Could not capture NAV for user ${userId}:`, err);
    return { success: false, error: err.message || 'Unknown error' };
  }
}

/**
 * Capture the current NAV for ALL users with active IBKR credentials
 * @param snapshotType - 'opening' for market open, 'closing' for market close
 */
export async function captureNavSnapshot(snapshotType: SnapshotType = 'closing'): Promise<JobResult> {
  console.log(`[NavSnapshot] Capturing ${snapshotType} NAV snapshot for all users...`);

  if (!db) {
    return { success: false, error: 'Database not available' };
  }

  try {
    // Find all users with active IBKR credentials
    const activeCredentials = await db
      .select({ userId: ibkrCredentials.userId })
      .from(ibkrCredentials)
      .where(eq(ibkrCredentials.status, 'active'));

    if (activeCredentials.length === 0) {
      console.log('[NavSnapshot] No users with active IBKR credentials found');
      return { success: false, error: 'No users with active IBKR credentials' };
    }

    console.log(`[NavSnapshot] Found ${activeCredentials.length} user(s) with active IBKR credentials`);

    const results: { userId: string; success: boolean; nav?: number; error?: string }[] = [];

    // Capture NAV for each user
    for (const cred of activeCredentials) {
      const result = await captureNavSnapshotForUser(snapshotType, cred.userId);
      results.push({ userId: cred.userId, ...result });
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    console.log(`[NavSnapshot] Completed: ${successCount} success, ${failCount} failed`);

    return {
      success: successCount > 0,
      data: {
        snapshotType,
        date: new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }),
        totalUsers: activeCredentials.length,
        successCount,
        failCount,
        results,
      },
    };
  } catch (error: any) {
    console.error('[NavSnapshot] Error:', error);
    return { success: false, error: error.message || 'Unknown error' };
  }
}

/**
 * Check if current time is within US market hours (9:30 AM - 4:00 PM ET)
 */
export function isMarketHours(): boolean {
  const now = new Date();
  const etFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });
  const etTime = etFormatter.format(now);
  const [hours, minutes] = etTime.split(':').map(Number);
  const totalMinutes = hours * 60 + minutes;

  // Market hours: 9:30 AM (570 min) to 4:00 PM (960 min) ET
  const marketOpen = 9 * 60 + 30;  // 9:30 AM = 570 minutes
  const marketClose = 16 * 60;      // 4:00 PM = 960 minutes

  // Also check if it's a weekday (Mon-Fri)
  const etDayFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
  });
  const dayOfWeek = etDayFormatter.format(now);
  const isWeekday = !['Sat', 'Sun'].includes(dayOfWeek);

  return isWeekday && totalMinutes >= marketOpen && totalMinutes < marketClose;
}

/**
 * Get today's opening NAV snapshot (for intraday Day P&L calculation)
 * @param userId - Optional user ID to filter by
 */
export async function getTodayOpeningSnapshot(userId?: string): Promise<{ date: string; nav: number } | null> {
  if (!db) return null;

  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

    const conditions = [
      eq(navSnapshots.date, today),
      eq(navSnapshots.snapshotType, 'opening')
    ];

    if (userId) {
      conditions.push(eq(navSnapshots.userId, userId));
    }

    const [snapshot] = await db
      .select()
      .from(navSnapshots)
      .where(and(...conditions))
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
 * Get today's closing NAV snapshot (for after-hours Day P&L calculation)
 * @param userId - Optional user ID to filter by
 */
export async function getTodayClosingSnapshot(userId?: string): Promise<{ date: string; nav: number } | null> {
  if (!db) return null;

  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

    const conditions = [
      eq(navSnapshots.date, today),
      eq(navSnapshots.snapshotType, 'closing')
    ];

    if (userId) {
      conditions.push(eq(navSnapshots.userId, userId));
    }

    const [snapshot] = await db
      .select()
      .from(navSnapshots)
      .where(and(...conditions))
      .limit(1);

    if (!snapshot) return null;

    return {
      date: snapshot.date,
      nav: parseFloat(snapshot.nav as any) || 0,
    };
  } catch (error) {
    console.error('[NavSnapshot] Error getting closing snapshot:', error);
    return null;
  }
}

/**
 * Get the most recent closing NAV snapshot (for after-hours Day P&L)
 * Returns the most recent closing NAV
 * @param userId - Optional user ID to filter by
 */
export async function getPreviousClosingSnapshot(userId?: string): Promise<{ date: string; nav: number } | null> {
  if (!db) return null;

  try {
    // Build query conditions
    const conditions = [eq(navSnapshots.snapshotType, 'closing')];
    if (userId) {
      conditions.push(eq(navSnapshots.userId, userId));
    }

    // Get the most recent closing snapshot
    const [snapshot] = await db
      .select()
      .from(navSnapshots)
      .where(conditions.length > 1 ? and(...conditions) : conditions[0])
      .orderBy(desc(navSnapshots.date))
      .limit(1);

    if (!snapshot) return null;

    return {
      date: snapshot.date,
      nav: parseFloat(snapshot.nav as any) || 0,
    };
  } catch (error) {
    console.error('[NavSnapshot] Error getting closing snapshot:', error);
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
 * Register the NAV snapshot job handlers (opening and closing)
 */
export function initNavSnapshotJob(): void {
  console.log('[NavSnapshot] Initializing job handlers...');

  // Opening snapshot (9:30 AM ET) - for Day P&L calculation
  registerJobHandler({
    id: 'nav-snapshot-opening',
    name: 'NAV Snapshot (Opening)',
    description: 'Capture market-open NAV for Day P&L calculation',
    execute: () => captureNavSnapshot('opening'),
  });

  // Closing snapshot (4:15 PM ET) - for daily return tracking & Sharpe ratio
  registerJobHandler({
    id: 'nav-snapshot-closing',
    name: 'NAV Snapshot (Closing)',
    description: 'Capture market-close NAV for daily returns & Sharpe ratio',
    execute: () => captureNavSnapshot('closing'),
  });

  console.log('[NavSnapshot] Job handlers registered (opening + closing)');
}

/**
 * Create the nav-snapshot jobs in the database if they don't exist
 */
export async function ensureNavSnapshotJob(): Promise<void> {
  if (!db) return;

  try {
    // Opening snapshot job (9:30 AM ET)
    const [existingOpening] = await db.select().from(jobs).where(eq(jobs.id, 'nav-snapshot-opening')).limit(1);
    if (!existingOpening) {
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

    // Closing snapshot job (4:15 PM ET) - after market close for final NAV
    const [existingClosing] = await db.select().from(jobs).where(eq(jobs.id, 'nav-snapshot-closing')).limit(1);
    if (!existingClosing) {
      console.log('[NavSnapshot] Creating nav-snapshot-closing job in database...');
      await db.insert(jobs).values({
        id: 'nav-snapshot-closing',
        name: 'NAV Snapshot (Closing)',
        description: 'Capture market-close NAV for daily returns & Sharpe ratio',
        type: 'nav-snapshot',
        schedule: '15 16 * * 1-5', // 4:15 PM ET on weekdays (after market close)
        timezone: 'America/New_York',
        enabled: true,
        config: { snapshotType: 'closing' },
      });
      console.log('[NavSnapshot] Closing snapshot job created');
    }
  } catch (err) {
    console.warn('[NavSnapshot] Could not ensure jobs exist:', err);
  }
}
