/**
 * Reconciliation Service
 *
 * Daily reconciliation with IBKR to ensure internal records match broker state.
 * Creates daily snapshots comparing internal calculations with IBKR reported values.
 */

import { db } from '../db';
import {
  dailySnapshots,
  reconciliationIssues,
  ledgerEntries,
  positions,
  DailySnapshot,
} from '@shared/schema';
import { eq, and, gte, lte } from 'drizzle-orm';
import { getLedgerBalance } from './accountingService';

export interface IBKRAccountState {
  cash: number;
  positionsValue: number;
  nav: number;
  realizedPnl: number;
  unrealizedPnl: number;
  rawResponse: Record<string, unknown>;
}

export interface InternalState {
  cash: number;
  positionsValue: number;
  nav: number;
  realizedPnl: number;
  unrealizedPnl: number;
}

const AUTO_RECONCILE_THRESHOLD = 1.00; // $1 variance allowed for auto-reconciliation

/**
 * Calculate internal state from ledger entries and positions
 */
export async function calculateInternalState(userId: string, date: string): Promise<InternalState> {
  if (!db) {
    throw new Error('Database not available');
  }

  // Cash from ledger
  const cash = await getLedgerBalance(userId, date);

  // Positions value from open positions (marked to market)
  const openPositions = await db
    .select()
    .from(positions)
    .where(
      and(
        eq(positions.userId, userId),
        eq(positions.status, 'open')
      )
    );

  let positionsValue = 0;
  let unrealizedPnl = 0;

  for (const pos of openPositions) {
    // currentValue is the mark-to-market value
    const currentValue = parseFloat(pos.currentValue || '0');
    const openCredit = parseFloat(pos.openCredit || '0');
    positionsValue += currentValue;
    // For credit spreads, unrealized P&L is openCredit - currentValue (if we sold for credit)
    unrealizedPnl += openCredit - currentValue;
  }

  // Realized P&L from today's entries (via ledger)
  const todayEntries = await db
    .select()
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.userId, userId),
        eq(ledgerEntries.effectiveDate, date)
      )
    );

  let realizedPnl = 0;
  for (const entry of todayEntries) {
    if (['premium_received', 'cost_to_close'].includes(entry.entryType)) {
      realizedPnl += parseFloat(entry.amount);
    }
  }

  return {
    cash,
    positionsValue,
    nav: cash + positionsValue,
    realizedPnl,
    unrealizedPnl,
  };
}

/**
 * Determine severity based on variance amount
 */
function getSeverity(variance: number): 'low' | 'medium' | 'high' {
  const absVariance = Math.abs(variance);
  if (absVariance < 10) return 'low';
  if (absVariance < 100) return 'medium';
  return 'high';
}

/**
 * Compare internal state with IBKR and create daily snapshot
 */
export async function createDailySnapshot(
  userId: string,
  date: string,
  ibkrState: IBKRAccountState
): Promise<DailySnapshot> {
  if (!db) {
    throw new Error('Database not available');
  }

  const internalState = await calculateInternalState(userId, date);

  const cashVariance = internalState.cash - ibkrState.cash;
  const navVariance = internalState.nav - ibkrState.nav;

  // Determine reconciliation status
  let reconciliationStatus: 'pending' | 'auto_reconciled' | 'discrepancy' = 'pending';

  if (Math.abs(navVariance) <= AUTO_RECONCILE_THRESHOLD) {
    reconciliationStatus = 'auto_reconciled';
  } else {
    reconciliationStatus = 'discrepancy';
  }

  // Check if snapshot already exists for this date
  const [existing] = await db
    .select()
    .from(dailySnapshots)
    .where(
      and(
        eq(dailySnapshots.userId, userId),
        eq(dailySnapshots.snapshotDate, date)
      )
    )
    .limit(1);

  let snapshot: DailySnapshot;

  if (existing) {
    // Update existing snapshot
    const [updated] = await db
      .update(dailySnapshots)
      .set({
        internalCash: internalState.cash.toFixed(2),
        internalPositionsValue: internalState.positionsValue.toFixed(2),
        internalNav: internalState.nav.toFixed(2),
        internalRealizedPnl: internalState.realizedPnl.toFixed(2),
        internalUnrealizedPnl: internalState.unrealizedPnl.toFixed(2),
        ibkrCash: ibkrState.cash.toFixed(2),
        ibkrPositionsValue: ibkrState.positionsValue.toFixed(2),
        ibkrNav: ibkrState.nav.toFixed(2),
        ibkrRealizedPnl: ibkrState.realizedPnl.toFixed(2),
        ibkrUnrealizedPnl: ibkrState.unrealizedPnl.toFixed(2),
        cashVariance: cashVariance.toFixed(2),
        navVariance: navVariance.toFixed(2),
        reconciliationStatus,
        reconciledAt: reconciliationStatus === 'auto_reconciled' ? new Date() : null,
        reconciledBy: reconciliationStatus === 'auto_reconciled' ? 'system' : null,
        ibkrRawResponse: ibkrState.rawResponse,
      })
      .where(eq(dailySnapshots.id, existing.id))
      .returning();
    snapshot = updated;
  } else {
    // Insert new snapshot
    const [inserted] = await db
      .insert(dailySnapshots)
      .values({
        userId,
        snapshotDate: date,
        internalCash: internalState.cash.toFixed(2),
        internalPositionsValue: internalState.positionsValue.toFixed(2),
        internalNav: internalState.nav.toFixed(2),
        internalRealizedPnl: internalState.realizedPnl.toFixed(2),
        internalUnrealizedPnl: internalState.unrealizedPnl.toFixed(2),
        ibkrCash: ibkrState.cash.toFixed(2),
        ibkrPositionsValue: ibkrState.positionsValue.toFixed(2),
        ibkrNav: ibkrState.nav.toFixed(2),
        ibkrRealizedPnl: ibkrState.realizedPnl.toFixed(2),
        ibkrUnrealizedPnl: ibkrState.unrealizedPnl.toFixed(2),
        cashVariance: cashVariance.toFixed(2),
        navVariance: navVariance.toFixed(2),
        reconciliationStatus,
        reconciledAt: reconciliationStatus === 'auto_reconciled' ? new Date() : null,
        reconciledBy: reconciliationStatus === 'auto_reconciled' ? 'system' : null,
        ibkrRawResponse: ibkrState.rawResponse,
      })
      .returning();
    snapshot = inserted;
  }

  // If discrepancy, create reconciliation issue
  if (reconciliationStatus === 'discrepancy') {
    await db.insert(reconciliationIssues).values({
      userId,
      snapshotId: snapshot.id,
      issueType: Math.abs(cashVariance) > Math.abs(navVariance) ? 'cash_mismatch' : 'nav_mismatch',
      severity: getSeverity(navVariance),
      internalValue: internalState.nav.toFixed(2),
      ibkrValue: ibkrState.nav.toFixed(2),
      variance: navVariance.toFixed(2),
    });
  }

  return snapshot;
}

/**
 * Get snapshots for a date range
 */
export async function getSnapshots(
  userId: string,
  startDate: string,
  endDate: string
): Promise<DailySnapshot[]> {
  if (!db) {
    throw new Error('Database not available');
  }

  return db
    .select()
    .from(dailySnapshots)
    .where(
      and(
        eq(dailySnapshots.userId, userId),
        gte(dailySnapshots.snapshotDate, startDate),
        lte(dailySnapshots.snapshotDate, endDate)
      )
    )
    .orderBy(dailySnapshots.snapshotDate);
}

/**
 * Get a single snapshot by date
 */
export async function getSnapshotByDate(
  userId: string,
  date: string
): Promise<DailySnapshot | null> {
  if (!db) {
    throw new Error('Database not available');
  }

  const [snapshot] = await db
    .select()
    .from(dailySnapshots)
    .where(
      and(
        eq(dailySnapshots.userId, userId),
        eq(dailySnapshots.snapshotDate, date)
      )
    )
    .limit(1);

  return snapshot || null;
}

/**
 * Manually reconcile a snapshot
 */
export async function manuallyReconcileSnapshot(
  snapshotId: string,
  reconciledBy: string
): Promise<void> {
  if (!db) {
    throw new Error('Database not available');
  }

  await db
    .update(dailySnapshots)
    .set({
      reconciliationStatus: 'manual_reconciled',
      reconciledAt: new Date(),
      reconciledBy,
    })
    .where(eq(dailySnapshots.id, snapshotId));
}

/**
 * Resolve a reconciliation issue
 */
export async function resolveIssue(
  issueId: string,
  resolutionType: string,
  resolutionNotes: string
): Promise<void> {
  if (!db) {
    throw new Error('Database not available');
  }

  await db
    .update(reconciliationIssues)
    .set({
      status: 'resolved',
      resolutionType,
      resolutionNotes,
      resolvedAt: new Date(),
    })
    .where(eq(reconciliationIssues.id, issueId));
}

/**
 * Get open reconciliation issues for a user
 */
export async function getOpenIssues(userId: string): Promise<any[]> {
  if (!db) {
    throw new Error('Database not available');
  }

  return db
    .select()
    .from(reconciliationIssues)
    .where(
      and(
        eq(reconciliationIssues.userId, userId),
        eq(reconciliationIssues.status, 'open')
      )
    )
    .orderBy(reconciliationIssues.createdAt);
}

/**
 * Check if a period is fully reconciled
 */
export async function isPeriodReconciled(
  userId: string,
  startDate: string,
  endDate: string
): Promise<boolean> {
  const snapshots = await getSnapshots(userId, startDate, endDate);

  // Build set of dates we have snapshots for
  const snapshotDates = new Set(snapshots.map(s => s.snapshotDate));

  // Check all trading days have snapshots and are reconciled
  const start = new Date(startDate);
  const end = new Date(endDate);

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dayOfWeek = d.getDay();
    // Skip weekends (0 = Sunday, 6 = Saturday)
    if (dayOfWeek === 0 || dayOfWeek === 6) continue;

    const dateStr = d.toISOString().split('T')[0];
    const snapshot = snapshots.find(s => s.snapshotDate === dateStr);

    if (!snapshot) return false;
    if (!['auto_reconciled', 'manual_reconciled'].includes(snapshot.reconciliationStatus || '')) {
      return false;
    }
  }

  return true;
}
