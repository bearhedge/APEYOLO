/**
 * Accounting Service
 *
 * Core accounting logic for tracking every financial event.
 * The ledger_entries table is the source of truth for all cash movements.
 */

import { db } from '../db';
import { ledgerEntries, LedgerEntry } from '@shared/schema';
import { eq, and, gte, lte, sum, asc } from 'drizzle-orm';

export type LedgerEntryType =
  | 'premium_received'
  | 'cost_to_close'
  | 'commission'
  | 'assignment_credit'
  | 'assignment_debit'
  | 'deposit'
  | 'withdrawal'
  | 'interest'
  | 'dividend'
  | 'fee'
  | 'adjustment';

export interface CreateLedgerEntryParams {
  userId: string;
  effectiveDate: string; // YYYY-MM-DD
  entryType: LedgerEntryType;
  amount: string; // decimal string
  tradeId?: string;
  orderId?: string;
  fillId?: string;
  ibkrExecutionId?: string;
  ibkrOrderId?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Create a ledger entry for any financial event
 */
export async function createLedgerEntry(params: CreateLedgerEntryParams): Promise<LedgerEntry> {
  if (!db) {
    throw new Error('Database not available');
  }

  const [entry] = await db.insert(ledgerEntries).values({
    userId: params.userId,
    effectiveDate: params.effectiveDate,
    entryType: params.entryType,
    amount: params.amount,
    tradeId: params.tradeId,
    orderId: params.orderId,
    fillId: params.fillId,
    ibkrExecutionId: params.ibkrExecutionId,
    ibkrOrderId: params.ibkrOrderId,
    description: params.description,
    metadata: params.metadata,
  }).returning();

  return entry;
}

/**
 * Get cash balance from ledger entries up to a given date
 */
export async function getLedgerBalance(userId: string, asOfDate: string): Promise<number> {
  if (!db) {
    throw new Error('Database not available');
  }

  const result = await db
    .select({
      total: sum(ledgerEntries.amount),
    })
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.userId, userId),
        lte(ledgerEntries.effectiveDate, asOfDate)
      )
    );

  return parseFloat(result[0]?.total || '0');
}

/**
 * Get ledger entries for a date range
 */
export async function getLedgerEntriesForPeriod(
  userId: string,
  startDate: string,
  endDate: string
): Promise<LedgerEntry[]> {
  if (!db) {
    throw new Error('Database not available');
  }

  return db
    .select()
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.userId, userId),
        gte(ledgerEntries.effectiveDate, startDate),
        lte(ledgerEntries.effectiveDate, endDate)
      )
    )
    .orderBy(asc(ledgerEntries.timestamp));
}

/**
 * Get running balance with entries (for ledger view)
 */
export async function getLedgerWithRunningBalance(
  userId: string,
  startDate: string,
  endDate: string
): Promise<Array<LedgerEntry & { runningBalance: number }>> {
  const entries = await getLedgerEntriesForPeriod(userId, startDate, endDate);

  // Get starting balance (sum of all entries before startDate)
  const dayBefore = new Date(startDate);
  dayBefore.setDate(dayBefore.getDate() - 1);
  const startingBalance = await getLedgerBalance(userId, dayBefore.toISOString().split('T')[0]);

  let runningBalance = startingBalance;
  return entries.map(entry => {
    runningBalance += parseFloat(entry.amount);
    return { ...entry, runningBalance };
  });
}

/**
 * Get daily P&L summary
 */
export async function getDailyPnl(userId: string, date: string): Promise<{
  premiumReceived: number;
  costToClose: number;
  commissions: number;
  netPnl: number;
}> {
  if (!db) {
    throw new Error('Database not available');
  }

  const entries = await db
    .select()
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.userId, userId),
        eq(ledgerEntries.effectiveDate, date)
      )
    );

  const result = {
    premiumReceived: 0,
    costToClose: 0,
    commissions: 0,
    netPnl: 0,
  };

  for (const entry of entries) {
    const amount = parseFloat(entry.amount);
    switch (entry.entryType) {
      case 'premium_received':
        result.premiumReceived += amount;
        break;
      case 'cost_to_close':
        result.costToClose += Math.abs(amount);
        break;
      case 'commission':
        result.commissions += Math.abs(amount);
        break;
    }
    result.netPnl += amount;
  }

  return result;
}

/**
 * Mark ledger entries as reconciled
 */
export async function markEntriesReconciled(
  entryIds: string[]
): Promise<void> {
  if (!db) {
    throw new Error('Database not available');
  }

  for (const id of entryIds) {
    await db
      .update(ledgerEntries)
      .set({
        reconciled: true,
        reconciledAt: new Date(),
      })
      .where(eq(ledgerEntries.id, id));
  }
}

/**
 * Get unreconciled entries for a user
 */
export async function getUnreconciledEntries(userId: string): Promise<LedgerEntry[]> {
  if (!db) {
    throw new Error('Database not available');
  }

  return db
    .select()
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.userId, userId),
        eq(ledgerEntries.reconciled, false)
      )
    )
    .orderBy(asc(ledgerEntries.timestamp));
}

// ==================== TRADE EVENT HELPERS ====================

/**
 * Record ledger entries when a trade is opened
 * Creates premium_received and commission entries
 */
export async function recordTradeOpen(params: {
  userId: string;
  tradeId: string;
  premium: number;
  commission?: number;
  symbol: string;
  strike?: string;
}): Promise<void> {
  if (!db) {
    console.warn('[Accounting] Database not available - skipping ledger entry');
    return;
  }

  const today = new Date().toISOString().split('T')[0];

  try {
    // Record premium received (positive)
    if (params.premium > 0) {
      await createLedgerEntry({
        userId: params.userId,
        effectiveDate: today,
        entryType: 'premium_received',
        amount: params.premium.toFixed(2),
        tradeId: params.tradeId,
        description: `Premium received for ${params.symbol}${params.strike ? ' ' + params.strike : ''}`,
      });
    }

    // Record commission (negative)
    if (params.commission && params.commission > 0) {
      await createLedgerEntry({
        userId: params.userId,
        effectiveDate: today,
        entryType: 'commission',
        amount: (-params.commission).toFixed(2),
        tradeId: params.tradeId,
        description: `Entry commission for ${params.symbol} trade`,
      });
    }

    console.log(`[Accounting] Recorded trade open entries for trade ${params.tradeId}`);
  } catch (error: any) {
    console.error('[Accounting] Failed to record trade open entries:', error.message);
    // Don't throw - we don't want to block trade execution
  }
}

/**
 * Record ledger entries when a trade is closed
 * Creates cost_to_close and exit commission entries
 */
export async function recordTradeClose(params: {
  userId: string;
  tradeId: string;
  exitPrice: number;
  exitCommission?: number;
  symbol: string;
  contracts?: number;
}): Promise<void> {
  if (!db) {
    console.warn('[Accounting] Database not available - skipping ledger entry');
    return;
  }

  const today = new Date().toISOString().split('T')[0];

  try {
    // Record cost to close (negative) - only if there was a cost
    if (params.exitPrice > 0) {
      // For options, exit price is per contract, need to multiply by contracts and 100
      const totalCost = params.exitPrice * (params.contracts || 1) * 100;
      await createLedgerEntry({
        userId: params.userId,
        effectiveDate: today,
        entryType: 'cost_to_close',
        amount: (-totalCost).toFixed(2),
        tradeId: params.tradeId,
        description: `Cost to close ${params.symbol} position`,
      });
    }

    // Record exit commission (negative)
    if (params.exitCommission && params.exitCommission > 0) {
      await createLedgerEntry({
        userId: params.userId,
        effectiveDate: today,
        entryType: 'commission',
        amount: (-params.exitCommission).toFixed(2),
        tradeId: params.tradeId,
        description: `Exit commission for ${params.symbol} trade`,
      });
    }

    console.log(`[Accounting] Recorded trade close entries for trade ${params.tradeId}`);
  } catch (error: any) {
    console.error('[Accounting] Failed to record trade close entries:', error.message);
    // Don't throw - we don't want to block trade processing
  }
}
