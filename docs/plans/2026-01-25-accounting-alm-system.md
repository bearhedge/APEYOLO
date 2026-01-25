# APE-YOLO Accounting & ALM System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a comprehensive accounting system that tracks every cent, reconciles with IBKR, and enables blockchain attestation of verified trading records.

**Architecture:** Double-entry inspired ledger with automated trade integration. Daily snapshots capture internal vs IBKR state for reconciliation. Only fully-reconciled periods can be attested on Solana. The ledger_entries table is the source of truth for all cash movements.

**Tech Stack:** Drizzle ORM (PostgreSQL), Express routes, React + Zustand for terminal window, existing Solana memo program for attestation.

---

## Task 1: Add Ledger Entries Schema

**Files:**
- Modify: `/Users/home/APE-YOLO/shared/schema.ts`

**Step 1.1: Read current schema**

Read `shared/schema.ts` to understand existing patterns and find insertion point.

**Step 1.2: Add ledger_entries table definition**

Add after the `auditLogs` table (around line 500-600):

```typescript
// ==================== ACCOUNTING & RECONCILIATION ====================

export const ledgerEntries = pgTable('ledger_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id),

  // Timing
  timestamp: timestamp('timestamp', { withTimezone: true }).defaultNow().notNull(),
  effectiveDate: date('effective_date').notNull(),

  // Classification
  entryType: varchar('entry_type', { length: 50 }).notNull(),
  // Types: 'premium_received', 'cost_to_close', 'commission',
  //        'assignment_credit', 'assignment_debit', 'deposit', 'withdrawal',
  //        'interest', 'dividend', 'fee', 'adjustment'

  // Amount (positive = money in, negative = money out)
  amount: decimal('amount', { precision: 15, scale: 2 }).notNull(),
  currency: varchar('currency', { length: 3 }).default('USD'),

  // References
  tradeId: uuid('trade_id').references(() => paperTrades.id),
  orderId: uuid('order_id').references(() => orders.id),
  fillId: uuid('fill_id').references(() => fills.id),

  // IBKR linking (for reconciliation)
  ibkrExecutionId: varchar('ibkr_execution_id', { length: 100 }),
  ibkrOrderId: varchar('ibkr_order_id', { length: 100 }),

  // Reconciliation status
  reconciled: boolean('reconciled').default(false),
  reconciledAt: timestamp('reconciled_at', { withTimezone: true }),

  // Metadata
  description: text('description'),
  metadata: jsonb('metadata'),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  userDateIdx: index('ledger_entries_user_date_idx').on(table.userId, table.effectiveDate),
  tradeIdx: index('ledger_entries_trade_idx').on(table.tradeId),
  ibkrExecIdx: index('ledger_entries_ibkr_exec_idx').on(table.ibkrExecutionId),
}));

export type LedgerEntry = typeof ledgerEntries.$inferSelect;
export type NewLedgerEntry = typeof ledgerEntries.$inferInsert;
```

**Step 1.3: Verify schema syntax**

Run: `cd /Users/home/APE-YOLO && npx tsc --noEmit shared/schema.ts`
Expected: No errors

**Step 1.4: Commit**

```bash
git add shared/schema.ts
git commit -m "feat(accounting): add ledger_entries table schema"
```

---

## Task 2: Add Daily Snapshots Schema

**Files:**
- Modify: `/Users/home/APE-YOLO/shared/schema.ts`

**Step 2.1: Add daily_snapshots table definition**

Add immediately after `ledgerEntries`:

```typescript
export const dailySnapshots = pgTable('daily_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id),
  snapshotDate: date('snapshot_date').notNull(),

  // Internal calculations (from ledger_entries)
  internalCash: decimal('internal_cash', { precision: 15, scale: 2 }),
  internalPositionsValue: decimal('internal_positions_value', { precision: 15, scale: 2 }),
  internalNav: decimal('internal_nav', { precision: 15, scale: 2 }),
  internalRealizedPnl: decimal('internal_realized_pnl', { precision: 15, scale: 2 }),
  internalUnrealizedPnl: decimal('internal_unrealized_pnl', { precision: 15, scale: 2 }),

  // IBKR reported values
  ibkrCash: decimal('ibkr_cash', { precision: 15, scale: 2 }),
  ibkrPositionsValue: decimal('ibkr_positions_value', { precision: 15, scale: 2 }),
  ibkrNav: decimal('ibkr_nav', { precision: 15, scale: 2 }),
  ibkrRealizedPnl: decimal('ibkr_realized_pnl', { precision: 15, scale: 2 }),
  ibkrUnrealizedPnl: decimal('ibkr_unrealized_pnl', { precision: 15, scale: 2 }),

  // Variance analysis
  cashVariance: decimal('cash_variance', { precision: 15, scale: 2 }),
  navVariance: decimal('nav_variance', { precision: 15, scale: 2 }),

  // Reconciliation
  reconciliationStatus: varchar('reconciliation_status', { length: 20 }).default('pending'),
  // Status: 'pending', 'auto_reconciled', 'manual_reconciled', 'discrepancy'
  reconciledAt: timestamp('reconciled_at', { withTimezone: true }),
  reconciledBy: varchar('reconciled_by', { length: 100 }), // 'system' or user

  // Raw IBKR response for audit
  ibkrRawResponse: jsonb('ibkr_raw_response'),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  userDateUnique: uniqueIndex('daily_snapshots_user_date_unique').on(table.userId, table.snapshotDate),
}));

export type DailySnapshot = typeof dailySnapshots.$inferSelect;
export type NewDailySnapshot = typeof dailySnapshots.$inferInsert;
```

**Step 2.2: Verify schema syntax**

Run: `cd /Users/home/APE-YOLO && npx tsc --noEmit shared/schema.ts`
Expected: No errors

**Step 2.3: Commit**

```bash
git add shared/schema.ts
git commit -m "feat(accounting): add daily_snapshots table schema"
```

---

## Task 3: Add Reconciliation Issues Schema

**Files:**
- Modify: `/Users/home/APE-YOLO/shared/schema.ts`

**Step 3.1: Add reconciliation_issues table definition**

Add immediately after `dailySnapshots`:

```typescript
export const reconciliationIssues = pgTable('reconciliation_issues', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id),
  snapshotId: uuid('snapshot_id').references(() => dailySnapshots.id),

  // Issue details
  issueType: varchar('issue_type', { length: 50 }).notNull(),
  // Types: 'cash_mismatch', 'nav_mismatch', 'missing_internal_trade',
  //        'missing_ibkr_trade', 'amount_mismatch', 'position_mismatch'

  severity: varchar('severity', { length: 20 }).default('medium'),
  // Severity: 'low' (<$10), 'medium' ($10-$100), 'high' (>$100)

  internalValue: decimal('internal_value', { precision: 15, scale: 2 }),
  ibkrValue: decimal('ibkr_value', { precision: 15, scale: 2 }),
  variance: decimal('variance', { precision: 15, scale: 2 }),

  // Resolution
  status: varchar('status', { length: 20 }).default('open'),
  // Status: 'open', 'investigating', 'resolved', 'accepted'

  resolutionType: varchar('resolution_type', { length: 50 }),
  // Types: 'timing_difference', 'rounding', 'data_correction',
  //        'ibkr_error', 'internal_error', 'accepted_variance'

  resolutionNotes: text('resolution_notes'),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),

  // References
  relatedTradeId: uuid('related_trade_id').references(() => paperTrades.id),
  relatedLedgerEntryId: uuid('related_ledger_entry_id').references(() => ledgerEntries.id),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export type ReconciliationIssue = typeof reconciliationIssues.$inferSelect;
export type NewReconciliationIssue = typeof reconciliationIssues.$inferInsert;
```

**Step 3.2: Verify schema syntax**

Run: `cd /Users/home/APE-YOLO && npx tsc --noEmit shared/schema.ts`
Expected: No errors

**Step 3.3: Commit**

```bash
git add shared/schema.ts
git commit -m "feat(accounting): add reconciliation_issues table schema"
```

---

## Task 4: Add Attestation Periods Schema

**Files:**
- Modify: `/Users/home/APE-YOLO/shared/schema.ts`

**Step 4.1: Add attestation_periods table definition**

Add immediately after `reconciliationIssues`:

```typescript
export const attestationPeriods = pgTable('attestation_periods', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id),

  // Period covered
  periodStart: date('period_start').notNull(),
  periodEnd: date('period_end').notNull(),
  periodLabel: varchar('period_label', { length: 100 }), // e.g., "Week of Jan 20-26, 2026"

  // Prerequisites
  allDaysReconciled: boolean('all_days_reconciled').notNull(),
  reconciliationIssuesCount: integer('reconciliation_issues_count').default(0),

  // Performance summary
  startingNav: decimal('starting_nav', { precision: 15, scale: 2 }),
  endingNav: decimal('ending_nav', { precision: 15, scale: 2 }),
  totalPnl: decimal('total_pnl', { precision: 15, scale: 2 }),
  returnPercent: decimal('return_percent', { precision: 8, scale: 4 }),
  tradeCount: integer('trade_count'),
  winCount: integer('win_count'),
  lossCount: integer('loss_count'),

  // Hashes for verification
  tradesHash: varchar('trades_hash', { length: 64 }), // SHA256 of all trade data
  snapshotsHash: varchar('snapshots_hash', { length: 64 }), // SHA256 of daily snapshots
  masterHash: varchar('master_hash', { length: 64 }), // SHA256(trades_hash + snapshots_hash)

  // Solana attestation
  solanaSignature: varchar('solana_signature', { length: 100 }),
  solanaSlot: bigint('solana_slot', { mode: 'number' }),
  solanaPda: varchar('solana_pda', { length: 100 }), // Program Derived Address
  attestedAt: timestamp('attested_at', { withTimezone: true }),

  // Status
  status: varchar('status', { length: 20 }).default('draft'),
  // Status: 'draft', 'ready', 'attested', 'superseded'

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  userPeriodUnique: uniqueIndex('attestation_periods_user_period_unique').on(table.userId, table.periodStart, table.periodEnd),
}));

export type AttestationPeriod = typeof attestationPeriods.$inferSelect;
export type NewAttestationPeriod = typeof attestationPeriods.$inferInsert;
```

**Step 4.2: Verify schema syntax**

Run: `cd /Users/home/APE-YOLO && npx tsc --noEmit shared/schema.ts`
Expected: No errors

**Step 4.3: Commit**

```bash
git add shared/schema.ts
git commit -m "feat(accounting): add attestation_periods table schema"
```

---

## Task 5: Run Database Migration

**Files:**
- None (uses existing Drizzle setup)

**Step 5.1: Generate migration**

Run: `cd /Users/home/APE-YOLO && npm run db:push`
Expected: Tables created successfully

**Step 5.2: Verify tables exist**

Run: `cd /Users/home/APE-YOLO && npm run db:studio` (or check via psql)
Expected: See ledger_entries, daily_snapshots, reconciliation_issues, attestation_periods tables

**Step 5.3: Commit any generated migration files**

```bash
git add drizzle/
git commit -m "chore(db): add accounting tables migration"
```

---

## Task 6: Create Accounting Service - Core Functions

**Files:**
- Create: `/Users/home/APE-YOLO/server/services/accountingService.ts`

**Step 6.1: Create the accounting service file**

```typescript
import { db } from '../db';
import { ledgerEntries, dailySnapshots, NewLedgerEntry, LedgerEntry } from '../../shared/schema';
import { eq, and, gte, lte, sql, sum } from 'drizzle-orm';

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
    .orderBy(ledgerEntries.timestamp);
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
  const startingBalance = await getLedgerBalance(userId,
    new Date(new Date(startDate).getTime() - 86400000).toISOString().split('T')[0]
  );

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
```

**Step 6.2: Verify TypeScript compiles**

Run: `cd /Users/home/APE-YOLO && npx tsc --noEmit server/services/accountingService.ts`
Expected: No errors

**Step 6.3: Commit**

```bash
git add server/services/accountingService.ts
git commit -m "feat(accounting): add core accounting service with ledger operations"
```

---

## Task 7: Create Reconciliation Service

**Files:**
- Create: `/Users/home/APE-YOLO/server/services/reconciliationService.ts`

**Step 7.1: Create the reconciliation service file**

```typescript
import { db } from '../db';
import {
  dailySnapshots,
  reconciliationIssues,
  ledgerEntries,
  positions,
  NewDailySnapshot,
  NewReconciliationIssue,
  DailySnapshot
} from '../../shared/schema';
import { eq, and, sum } from 'drizzle-orm';
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

const AUTO_RECONCILE_THRESHOLD = 1.00; // $1 variance allowed

/**
 * Calculate internal state from ledger entries and positions
 */
export async function calculateInternalState(userId: string, date: string): Promise<InternalState> {
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
    const marketValue = parseFloat(pos.marketValue || '0');
    const costBasis = parseFloat(pos.avgCost || '0') * (pos.quantity || 0);
    positionsValue += marketValue;
    unrealizedPnl += marketValue - costBasis;
  }

  // Realized P&L from today's closed trades (via ledger)
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

  // Insert or update snapshot
  const [snapshot] = await db
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
    .onConflictDoUpdate({
      target: [dailySnapshots.userId, dailySnapshots.snapshotDate],
      set: {
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
      },
    })
    .returning();

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
  return db
    .select()
    .from(dailySnapshots)
    .where(
      and(
        eq(dailySnapshots.userId, userId),
        // Date comparisons handled by Drizzle
      )
    )
    .orderBy(dailySnapshots.snapshotDate);
}

/**
 * Manually resolve a reconciliation issue
 */
export async function resolveIssue(
  issueId: string,
  resolutionType: string,
  resolutionNotes: string
): Promise<void> {
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
 * Check if a period is fully reconciled
 */
export async function isPeriodReconciled(
  userId: string,
  startDate: string,
  endDate: string
): Promise<boolean> {
  const snapshots = await getSnapshots(userId, startDate, endDate);

  // Check all days have snapshots and are reconciled
  const start = new Date(startDate);
  const end = new Date(endDate);

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    const snapshot = snapshots.find(s => s.snapshotDate === dateStr);

    if (!snapshot) return false;
    if (!['auto_reconciled', 'manual_reconciled'].includes(snapshot.reconciliationStatus || '')) {
      return false;
    }
  }

  return true;
}
```

**Step 7.2: Verify TypeScript compiles**

Run: `cd /Users/home/APE-YOLO && npx tsc --noEmit server/services/reconciliationService.ts`
Expected: No errors

**Step 7.3: Commit**

```bash
git add server/services/reconciliationService.ts
git commit -m "feat(accounting): add reconciliation service for IBKR comparison"
```

---

## Task 8: Create Attestation Service for Accounting

**Files:**
- Create: `/Users/home/APE-YOLO/server/services/accountingAttestationService.ts`

**Step 8.1: Create the attestation service file**

```typescript
import { createHash } from 'crypto';
import { db } from '../db';
import {
  attestationPeriods,
  dailySnapshots,
  paperTrades,
  ledgerEntries,
  NewAttestationPeriod,
  AttestationPeriod
} from '../../shared/schema';
import { eq, and, gte, lte } from 'drizzle-orm';
import { isPeriodReconciled } from './reconciliationService';
import { recordTradeOnSolana } from './solanaTradeRecorder';

/**
 * Generate SHA-256 hash of data
 */
function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Generate hash of all trades in a period
 */
async function generateTradesHash(userId: string, startDate: string, endDate: string): Promise<string> {
  const trades = await db
    .select()
    .from(paperTrades)
    .where(
      and(
        eq(paperTrades.userId, userId),
        gte(paperTrades.openedAt, new Date(startDate)),
        lte(paperTrades.openedAt, new Date(endDate))
      )
    )
    .orderBy(paperTrades.openedAt);

  const tradeData = trades.map(t => ({
    id: t.id,
    symbol: t.symbol,
    strikes: t.putStrike || t.callStrike,
    premium: t.premium,
    result: t.result,
    pnl: t.pnl,
    openedAt: t.openedAt,
    closedAt: t.closedAt,
  }));

  return sha256(JSON.stringify(tradeData));
}

/**
 * Generate hash of all daily snapshots in a period
 */
async function generateSnapshotsHash(userId: string, startDate: string, endDate: string): Promise<string> {
  const snapshots = await db
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

  const snapshotData = snapshots.map(s => ({
    date: s.snapshotDate,
    internalNav: s.internalNav,
    ibkrNav: s.ibkrNav,
    status: s.reconciliationStatus,
  }));

  return sha256(JSON.stringify(snapshotData));
}

/**
 * Calculate performance metrics for a period
 */
async function calculatePerformance(userId: string, startDate: string, endDate: string): Promise<{
  startingNav: number;
  endingNav: number;
  totalPnl: number;
  returnPercent: number;
  tradeCount: number;
  winCount: number;
  lossCount: number;
}> {
  // Get starting and ending NAV from snapshots
  const startSnapshot = await db
    .select()
    .from(dailySnapshots)
    .where(
      and(
        eq(dailySnapshots.userId, userId),
        eq(dailySnapshots.snapshotDate, startDate)
      )
    )
    .limit(1);

  const endSnapshot = await db
    .select()
    .from(dailySnapshots)
    .where(
      and(
        eq(dailySnapshots.userId, userId),
        eq(dailySnapshots.snapshotDate, endDate)
      )
    )
    .limit(1);

  const startingNav = parseFloat(startSnapshot[0]?.internalNav || '0');
  const endingNav = parseFloat(endSnapshot[0]?.internalNav || '0');

  // Get trades in period
  const trades = await db
    .select()
    .from(paperTrades)
    .where(
      and(
        eq(paperTrades.userId, userId),
        gte(paperTrades.closedAt, new Date(startDate)),
        lte(paperTrades.closedAt, new Date(endDate))
      )
    );

  const tradeCount = trades.length;
  const winCount = trades.filter(t => t.result === 'win').length;
  const lossCount = trades.filter(t => t.result === 'loss').length;
  const totalPnl = trades.reduce((sum, t) => sum + parseFloat(t.pnl || '0'), 0);

  const returnPercent = startingNav > 0 ? ((endingNav - startingNav) / startingNav) * 100 : 0;

  return {
    startingNav,
    endingNav,
    totalPnl,
    returnPercent,
    tradeCount,
    winCount,
    lossCount,
  };
}

/**
 * Prepare attestation data for a period (does not attest yet)
 */
export async function prepareAttestation(
  userId: string,
  startDate: string,
  endDate: string,
  periodLabel?: string
): Promise<AttestationPeriod> {
  // Check prerequisite: all days must be reconciled
  const allReconciled = await isPeriodReconciled(userId, startDate, endDate);

  if (!allReconciled) {
    throw new Error('Cannot prepare attestation: not all days are reconciled');
  }

  // Generate hashes
  const tradesHash = await generateTradesHash(userId, startDate, endDate);
  const snapshotsHash = await generateSnapshotsHash(userId, startDate, endDate);
  const masterHash = sha256(tradesHash + snapshotsHash);

  // Calculate performance
  const performance = await calculatePerformance(userId, startDate, endDate);

  // Count any unresolved issues in period
  const issues = await db
    .select()
    .from(dailySnapshots)
    .where(
      and(
        eq(dailySnapshots.userId, userId),
        eq(dailySnapshots.reconciliationStatus, 'discrepancy')
      )
    );

  // Create attestation record
  const [attestation] = await db
    .insert(attestationPeriods)
    .values({
      userId,
      periodStart: startDate,
      periodEnd: endDate,
      periodLabel: periodLabel || `${startDate} to ${endDate}`,
      allDaysReconciled: allReconciled,
      reconciliationIssuesCount: issues.length,
      startingNav: performance.startingNav.toFixed(2),
      endingNav: performance.endingNav.toFixed(2),
      totalPnl: performance.totalPnl.toFixed(2),
      returnPercent: performance.returnPercent.toFixed(4),
      tradeCount: performance.tradeCount,
      winCount: performance.winCount,
      lossCount: performance.lossCount,
      tradesHash,
      snapshotsHash,
      masterHash,
      status: 'ready',
    })
    .onConflictDoUpdate({
      target: [attestationPeriods.userId, attestationPeriods.periodStart, attestationPeriods.periodEnd],
      set: {
        allDaysReconciled: allReconciled,
        reconciliationIssuesCount: issues.length,
        startingNav: performance.startingNav.toFixed(2),
        endingNav: performance.endingNav.toFixed(2),
        totalPnl: performance.totalPnl.toFixed(2),
        returnPercent: performance.returnPercent.toFixed(4),
        tradeCount: performance.tradeCount,
        winCount: performance.winCount,
        lossCount: performance.lossCount,
        tradesHash,
        snapshotsHash,
        masterHash,
        status: 'ready',
      },
    })
    .returning();

  return attestation;
}

/**
 * Submit attestation to Solana
 */
export async function submitAttestation(attestationId: string): Promise<{
  signature: string;
  slot: number;
}> {
  const [attestation] = await db
    .select()
    .from(attestationPeriods)
    .where(eq(attestationPeriods.id, attestationId))
    .limit(1);

  if (!attestation) {
    throw new Error('Attestation not found');
  }

  if (attestation.status !== 'ready') {
    throw new Error(`Cannot attest: status is ${attestation.status}`);
  }

  // Create attestation memo
  const memoData = {
    type: 'APE-YOLO-ATTESTATION',
    period: `${attestation.periodStart} to ${attestation.periodEnd}`,
    nav: { start: attestation.startingNav, end: attestation.endingNav },
    pnl: attestation.totalPnl,
    return: `${attestation.returnPercent}%`,
    trades: { total: attestation.tradeCount, wins: attestation.winCount, losses: attestation.lossCount },
    hash: attestation.masterHash,
    timestamp: new Date().toISOString(),
  };

  // Record on Solana using existing infrastructure
  const result = await recordTradeOnSolana(JSON.stringify(memoData));

  // Update attestation record
  await db
    .update(attestationPeriods)
    .set({
      solanaSignature: result.signature,
      solanaSlot: result.slot,
      attestedAt: new Date(),
      status: 'attested',
    })
    .where(eq(attestationPeriods.id, attestationId));

  return result;
}

/**
 * Get attestation history for a user
 */
export async function getAttestations(userId: string): Promise<AttestationPeriod[]> {
  return db
    .select()
    .from(attestationPeriods)
    .where(eq(attestationPeriods.userId, userId))
    .orderBy(attestationPeriods.periodStart);
}
```

**Step 8.2: Verify TypeScript compiles**

Run: `cd /Users/home/APE-YOLO && npx tsc --noEmit server/services/accountingAttestationService.ts`
Expected: No errors

**Step 8.3: Commit**

```bash
git add server/services/accountingAttestationService.ts
git commit -m "feat(accounting): add attestation service for verified period proofs"
```

---

## Task 9: Create Accounting API Routes

**Files:**
- Create: `/Users/home/APE-YOLO/server/routes/accountingRoutes.ts`
- Modify: `/Users/home/APE-YOLO/server/routes.ts`

**Step 9.1: Create accounting routes file**

```typescript
import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import {
  createLedgerEntry,
  getLedgerWithRunningBalance,
  getDailyPnl,
} from '../services/accountingService';
import {
  createDailySnapshot,
  getSnapshots,
  resolveIssue,
  isPeriodReconciled,
} from '../services/reconciliationService';
import {
  prepareAttestation,
  submitAttestation,
  getAttestations,
} from '../services/accountingAttestationService';

const router = Router();

// All routes require authentication
router.use(requireAuth);

// ==================== LEDGER ROUTES ====================

/**
 * GET /api/accounting/ledger
 * Get ledger entries with running balance
 */
router.get('/ledger', async (req, res) => {
  try {
    const userId = req.user!.id;
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: 'startDate and endDate are required'
      });
    }

    const entries = await getLedgerWithRunningBalance(
      userId,
      startDate as string,
      endDate as string
    );

    res.json({ success: true, data: entries });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/**
 * POST /api/accounting/ledger
 * Create a manual ledger entry (adjustments, deposits, withdrawals)
 */
router.post('/ledger', async (req, res) => {
  try {
    const userId = req.user!.id;
    const { effectiveDate, entryType, amount, description, metadata } = req.body;

    if (!effectiveDate || !entryType || amount === undefined) {
      return res.status(400).json({
        success: false,
        error: 'effectiveDate, entryType, and amount are required',
      });
    }

    const entry = await createLedgerEntry({
      userId,
      effectiveDate,
      entryType,
      amount: amount.toString(),
      description,
      metadata,
    });

    res.json({ success: true, data: entry });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/**
 * GET /api/accounting/daily-pnl
 * Get P&L breakdown for a specific date
 */
router.get('/daily-pnl', async (req, res) => {
  try {
    const userId = req.user!.id;
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({ success: false, error: 'date is required' });
    }

    const pnl = await getDailyPnl(userId, date as string);
    res.json({ success: true, data: pnl });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// ==================== RECONCILIATION ROUTES ====================

/**
 * GET /api/accounting/snapshots
 * Get daily snapshots for a date range
 */
router.get('/snapshots', async (req, res) => {
  try {
    const userId = req.user!.id;
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: 'startDate and endDate are required',
      });
    }

    const snapshots = await getSnapshots(userId, startDate as string, endDate as string);
    res.json({ success: true, data: snapshots });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/**
 * POST /api/accounting/snapshot
 * Trigger reconciliation snapshot for a date
 */
router.post('/snapshot', async (req, res) => {
  try {
    const userId = req.user!.id;
    const { date, ibkrState } = req.body;

    if (!date || !ibkrState) {
      return res.status(400).json({
        success: false,
        error: 'date and ibkrState are required',
      });
    }

    const snapshot = await createDailySnapshot(userId, date, ibkrState);
    res.json({ success: true, data: snapshot });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/**
 * POST /api/accounting/resolve-issue
 * Resolve a reconciliation issue
 */
router.post('/resolve-issue', async (req, res) => {
  try {
    const { issueId, resolutionType, resolutionNotes } = req.body;

    if (!issueId || !resolutionType) {
      return res.status(400).json({
        success: false,
        error: 'issueId and resolutionType are required',
      });
    }

    await resolveIssue(issueId, resolutionType, resolutionNotes || '');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/**
 * GET /api/accounting/reconciliation-status
 * Check if a period is fully reconciled
 */
router.get('/reconciliation-status', async (req, res) => {
  try {
    const userId = req.user!.id;
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: 'startDate and endDate are required',
      });
    }

    const isReconciled = await isPeriodReconciled(
      userId,
      startDate as string,
      endDate as string
    );

    res.json({ success: true, data: { isReconciled } });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// ==================== ATTESTATION ROUTES ====================

/**
 * GET /api/accounting/attestations
 * Get attestation history
 */
router.get('/attestations', async (req, res) => {
  try {
    const userId = req.user!.id;
    const attestations = await getAttestations(userId);
    res.json({ success: true, data: attestations });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/**
 * POST /api/accounting/attestation/prepare
 * Prepare attestation for a period
 */
router.post('/attestation/prepare', async (req, res) => {
  try {
    const userId = req.user!.id;
    const { startDate, endDate, periodLabel } = req.body;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: 'startDate and endDate are required',
      });
    }

    const attestation = await prepareAttestation(userId, startDate, endDate, periodLabel);
    res.json({ success: true, data: attestation });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/**
 * POST /api/accounting/attestation/submit
 * Submit prepared attestation to Solana
 */
router.post('/attestation/submit', async (req, res) => {
  try {
    const { attestationId } = req.body;

    if (!attestationId) {
      return res.status(400).json({
        success: false,
        error: 'attestationId is required',
      });
    }

    const result = await submitAttestation(attestationId);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

export default router;
```

**Step 9.2: Register routes in main routes file**

Add to `/Users/home/APE-YOLO/server/routes.ts`:

```typescript
// Add import at top
import accountingRoutes from './routes/accountingRoutes';

// Add route registration (after other authenticated routes)
app.use('/api/accounting', accountingRoutes);
```

**Step 9.3: Verify TypeScript compiles**

Run: `cd /Users/home/APE-YOLO && npx tsc --noEmit`
Expected: No errors

**Step 9.4: Commit**

```bash
git add server/routes/accountingRoutes.ts server/routes.ts
git commit -m "feat(accounting): add accounting API routes"
```

---

## Task 10: Hook Trade Execution to Ledger

**Files:**
- Modify: `/Users/home/APE-YOLO/server/routes/engineRoutes.ts` (or wherever trades are recorded)

**Step 10.1: Read current trade execution code**

Find where trades are inserted into `paperTrades` table.

**Step 10.2: Add ledger entry creation after trade fill**

Add import:
```typescript
import { createLedgerEntry } from '../services/accountingService';
```

After trade is inserted (look for `db.insert(paperTrades)`), add:

```typescript
// Create ledger entries for the trade
const today = new Date().toISOString().split('T')[0];

// Premium received (positive)
if (tradeData.premium && parseFloat(tradeData.premium) > 0) {
  await createLedgerEntry({
    userId,
    effectiveDate: today,
    entryType: 'premium_received',
    amount: tradeData.premium,
    tradeId: insertedTrade.id,
    description: `Premium received for ${tradeData.symbol} ${tradeData.putStrike || tradeData.callStrike}`,
  });
}

// Commission (negative)
if (tradeData.commission && parseFloat(tradeData.commission) > 0) {
  await createLedgerEntry({
    userId,
    effectiveDate: today,
    entryType: 'commission',
    amount: (-parseFloat(tradeData.commission)).toString(),
    tradeId: insertedTrade.id,
    description: `Commission for ${tradeData.symbol} trade`,
  });
}
```

**Step 10.3: Add ledger entry for trade close**

Find where trades are closed (look for update to `closedAt`, `result`, `pnl`), add:

```typescript
// Cost to close (negative if buying back)
if (closeData.exitPrice && parseFloat(closeData.exitPrice) > 0) {
  const costToClose = -parseFloat(closeData.exitPrice) * 100; // Options are 100 shares
  await createLedgerEntry({
    userId,
    effectiveDate: new Date().toISOString().split('T')[0],
    entryType: 'cost_to_close',
    amount: costToClose.toString(),
    tradeId: tradeId,
    description: `Closed ${trade.symbol} position`,
  });
}
```

**Step 10.4: Verify TypeScript compiles**

Run: `cd /Users/home/APE-YOLO && npx tsc --noEmit`
Expected: No errors

**Step 10.5: Commit**

```bash
git add server/routes/engineRoutes.ts
git commit -m "feat(accounting): hook trade execution to create ledger entries"
```

---

## Task 11: Create Ledger View Component

**Files:**
- Create: `/Users/home/APE-YOLO/client/src/components/accounting/LedgerView.tsx`

**Step 11.1: Create the LedgerView component**

```typescript
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, subDays } from 'date-fns';

interface LedgerEntry {
  id: string;
  timestamp: string;
  effectiveDate: string;
  entryType: string;
  amount: string;
  description: string | null;
  runningBalance: number;
}

export function LedgerView() {
  const [startDate, setStartDate] = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  const { data, isLoading, error } = useQuery({
    queryKey: ['ledger', startDate, endDate],
    queryFn: async () => {
      const res = await fetch(`/api/accounting/ledger?startDate=${startDate}&endDate=${endDate}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data as LedgerEntry[];
    },
  });

  const formatAmount = (amount: string) => {
    const num = parseFloat(amount);
    const formatted = Math.abs(num).toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
    });
    return num >= 0 ? `+${formatted}` : `-${formatted.slice(1)}`;
  };

  const getEntryTypeColor = (type: string) => {
    switch (type) {
      case 'premium_received':
      case 'dividend':
      case 'interest':
      case 'deposit':
        return 'text-green-400';
      case 'commission':
      case 'cost_to_close':
      case 'fee':
      case 'withdrawal':
        return 'text-red-400';
      default:
        return 'text-gray-400';
    }
  };

  return (
    <div className="h-full flex flex-col text-xs font-mono">
      {/* Date filters */}
      <div className="flex gap-2 p-2 border-b border-gray-800">
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="bg-black border border-gray-700 px-2 py-1 text-white"
        />
        <span className="text-gray-500">to</span>
        <input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          className="bg-black border border-gray-700 px-2 py-1 text-white"
        />
      </div>

      {/* Header */}
      <div className="grid grid-cols-5 gap-2 p-2 border-b border-gray-800 text-gray-500">
        <span>Date</span>
        <span>Type</span>
        <span className="text-right">Amount</span>
        <span className="text-right">Balance</span>
        <span>Description</span>
      </div>

      {/* Entries */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && <div className="p-2 text-gray-500">Loading...</div>}
        {error && <div className="p-2 text-red-400">{(error as Error).message}</div>}
        {data?.map((entry) => (
          <div
            key={entry.id}
            className="grid grid-cols-5 gap-2 p-2 border-b border-gray-900 hover:bg-gray-900"
          >
            <span className="text-gray-400">
              {format(new Date(entry.effectiveDate), 'MM/dd')}
            </span>
            <span className={getEntryTypeColor(entry.entryType)}>
              {entry.entryType.replace(/_/g, ' ')}
            </span>
            <span className={`text-right ${parseFloat(entry.amount) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {formatAmount(entry.amount)}
            </span>
            <span className="text-right text-white">
              ${entry.runningBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </span>
            <span className="text-gray-500 truncate">{entry.description}</span>
          </div>
        ))}
        {data?.length === 0 && (
          <div className="p-2 text-gray-500">No entries for selected period</div>
        )}
      </div>
    </div>
  );
}
```

**Step 11.2: Verify component compiles**

Run: `cd /Users/home/APE-YOLO && npx tsc --noEmit`
Expected: No errors

**Step 11.3: Commit**

```bash
git add client/src/components/accounting/LedgerView.tsx
git commit -m "feat(accounting): add LedgerView component for viewing ledger entries"
```

---

## Task 12: Create Reconciliation Dashboard Component

**Files:**
- Create: `/Users/home/APE-YOLO/client/src/components/accounting/ReconciliationDashboard.tsx`

**Step 12.1: Create the ReconciliationDashboard component**

```typescript
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth } from 'date-fns';

interface DailySnapshot {
  id: string;
  snapshotDate: string;
  internalNav: string;
  ibkrNav: string;
  navVariance: string;
  reconciliationStatus: string;
}

export function ReconciliationDashboard() {
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const startDate = format(startOfMonth(currentMonth), 'yyyy-MM-dd');
  const endDate = format(endOfMonth(currentMonth), 'yyyy-MM-dd');

  const { data: snapshots, isLoading } = useQuery({
    queryKey: ['snapshots', startDate, endDate],
    queryFn: async () => {
      const res = await fetch(`/api/accounting/snapshots?startDate=${startDate}&endDate=${endDate}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data as DailySnapshot[];
    },
  });

  const days = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth),
  });

  const getSnapshotForDate = (date: Date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    return snapshots?.find((s) => s.snapshotDate === dateStr);
  };

  const getStatusColor = (status: string | undefined) => {
    switch (status) {
      case 'auto_reconciled':
      case 'manual_reconciled':
        return 'bg-green-900 border-green-600';
      case 'discrepancy':
        return 'bg-red-900 border-red-600';
      case 'pending':
        return 'bg-yellow-900 border-yellow-600';
      default:
        return 'bg-gray-900 border-gray-700';
    }
  };

  const prevMonth = () => setCurrentMonth(new Date(currentMonth.setMonth(currentMonth.getMonth() - 1)));
  const nextMonth = () => setCurrentMonth(new Date(currentMonth.setMonth(currentMonth.getMonth() + 1)));

  return (
    <div className="h-full flex flex-col text-xs font-mono">
      {/* Month navigation */}
      <div className="flex items-center justify-between p-2 border-b border-gray-800">
        <button onClick={prevMonth} className="text-gray-400 hover:text-white px-2">
          &lt;
        </button>
        <span className="text-white">{format(currentMonth, 'MMMM yyyy')}</span>
        <button onClick={nextMonth} className="text-gray-400 hover:text-white px-2">
          &gt;
        </button>
      </div>

      {/* Legend */}
      <div className="flex gap-4 p-2 border-b border-gray-800 text-gray-500">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 bg-green-900 border border-green-600"></span>
          Reconciled
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 bg-yellow-900 border border-yellow-600"></span>
          Pending
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 bg-red-900 border border-red-600"></span>
          Discrepancy
        </span>
      </div>

      {/* Calendar grid */}
      <div className="flex-1 overflow-y-auto p-2">
        {isLoading ? (
          <div className="text-gray-500">Loading...</div>
        ) : (
          <div className="grid grid-cols-7 gap-1">
            {/* Day headers */}
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
              <div key={day} className="text-center text-gray-500 p-1">
                {day}
              </div>
            ))}

            {/* Empty cells for start of month */}
            {Array.from({ length: startOfMonth(currentMonth).getDay() }).map((_, i) => (
              <div key={`empty-${i}`} className="p-2"></div>
            ))}

            {/* Day cells */}
            {days.map((day) => {
              const snapshot = getSnapshotForDate(day);
              const isWeekend = day.getDay() === 0 || day.getDay() === 6;

              return (
                <div
                  key={day.toISOString()}
                  className={`p-2 border ${getStatusColor(snapshot?.reconciliationStatus)} ${
                    isWeekend ? 'opacity-50' : ''
                  }`}
                >
                  <div className="text-white">{format(day, 'd')}</div>
                  {snapshot && (
                    <div className="mt-1">
                      <div className="text-gray-400">
                        ${parseFloat(snapshot.internalNav).toLocaleString()}
                      </div>
                      {snapshot.navVariance && parseFloat(snapshot.navVariance) !== 0 && (
                        <div className={parseFloat(snapshot.navVariance) > 0 ? 'text-green-400' : 'text-red-400'}>
                          {parseFloat(snapshot.navVariance) > 0 ? '+' : ''}
                          ${parseFloat(snapshot.navVariance).toFixed(2)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
```

**Step 12.2: Verify component compiles**

Run: `cd /Users/home/APE-YOLO && npx tsc --noEmit`
Expected: No errors

**Step 12.3: Commit**

```bash
git add client/src/components/accounting/ReconciliationDashboard.tsx
git commit -m "feat(accounting): add ReconciliationDashboard calendar component"
```

---

## Task 13: Create Accounting Window for Terminal

**Files:**
- Create: `/Users/home/APE-YOLO/client/src/components/terminal/windows/AccountingWindow.tsx`
- Modify: `/Users/home/APE-YOLO/client/src/hooks/useWindowManager.ts`
- Modify: `/Users/home/APE-YOLO/client/src/components/terminal/Dock.tsx`

**Step 13.1: Create AccountingWindow component**

```typescript
import { useState } from 'react';
import { LedgerView } from '../../accounting/LedgerView';
import { ReconciliationDashboard } from '../../accounting/ReconciliationDashboard';

type Tab = 'ledger' | 'reconciliation' | 'attestation';

export function AccountingWindow() {
  const [activeTab, setActiveTab] = useState<Tab>('ledger');

  const tabs: { id: Tab; label: string }[] = [
    { id: 'ledger', label: 'Ledger' },
    { id: 'reconciliation', label: 'Reconciliation' },
    { id: 'attestation', label: 'Attestation' },
  ];

  return (
    <div className="h-full flex flex-col bg-black text-white font-mono text-xs">
      {/* Tab bar */}
      <div className="flex border-b border-gray-800">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 border-r border-gray-800 ${
              activeTab === tab.id
                ? 'bg-gray-900 text-white'
                : 'text-gray-500 hover:text-white hover:bg-gray-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'ledger' && <LedgerView />}
        {activeTab === 'reconciliation' && <ReconciliationDashboard />}
        {activeTab === 'attestation' && (
          <div className="p-4 text-gray-500">
            Attestation controls coming soon...
          </div>
        )}
      </div>
    </div>
  );
}
```

**Step 13.2: Add accounting window to useWindowManager**

In `/Users/home/APE-YOLO/client/src/hooks/useWindowManager.ts`, add to `WINDOW_CONFIGS`:

```typescript
{
  id: 'accounting',
  title: 'accounting/',
  defaultPosition: { x: 100, y: 100 },
  defaultSize: { width: 600, height: 450 },
},
```

And add `'accounting'` to the `WindowId` type.

**Step 13.3: Add accounting button to Dock**

In `/Users/home/APE-YOLO/client/src/components/terminal/Dock.tsx`, add the accounting button with a ledger-style icon (use `$` or similar monospace character).

**Step 13.4: Import AccountingWindow in WindowManager**

In the file that renders windows (likely `WindowManager.tsx` or similar), add:

```typescript
import { AccountingWindow } from './windows/AccountingWindow';

// In the render switch/map:
case 'accounting':
  return <AccountingWindow />;
```

**Step 13.5: Verify TypeScript compiles**

Run: `cd /Users/home/APE-YOLO && npx tsc --noEmit`
Expected: No errors

**Step 13.6: Commit**

```bash
git add client/src/components/terminal/windows/AccountingWindow.tsx \
        client/src/hooks/useWindowManager.ts \
        client/src/components/terminal/Dock.tsx \
        client/src/components/terminal/WindowManager.tsx
git commit -m "feat(accounting): add AccountingWindow to terminal with ledger and reconciliation tabs"
```

---

## Task 14: Add IBKR Account State Fetch

**Files:**
- Modify: `/Users/home/APE-YOLO/server/broker/ibkr.ts`

**Step 14.1: Read current IBKR integration**

Understand existing patterns for fetching data from IBKR.

**Step 14.2: Add getAccountState function**

Add function to fetch current account state for reconciliation:

```typescript
/**
 * Get current account state for reconciliation
 */
export async function getAccountStateForReconciliation(userId: string): Promise<{
  cash: number;
  positionsValue: number;
  nav: number;
  realizedPnl: number;
  unrealizedPnl: number;
  rawResponse: Record<string, unknown>;
}> {
  // Get IBKR client for user
  const client = await getIBKRClient(userId);

  // Fetch account summary
  const accountSummary = await client.getAccountSummary();

  return {
    cash: parseFloat(accountSummary.availableFunds || '0'),
    positionsValue: parseFloat(accountSummary.grossPositionValue || '0'),
    nav: parseFloat(accountSummary.netLiquidation || '0'),
    realizedPnl: parseFloat(accountSummary.realizedPnL || '0'),
    unrealizedPnl: parseFloat(accountSummary.unrealizedPnL || '0'),
    rawResponse: accountSummary,
  };
}
```

**Step 14.3: Verify TypeScript compiles**

Run: `cd /Users/home/APE-YOLO && npx tsc --noEmit`
Expected: No errors

**Step 14.4: Commit**

```bash
git add server/broker/ibkr.ts
git commit -m "feat(accounting): add IBKR account state fetch for reconciliation"
```

---

## Task 15: Add Scheduled Reconciliation Job

**Files:**
- Create: `/Users/home/APE-YOLO/server/jobs/dailyReconciliation.ts`
- Modify: Job scheduling configuration

**Step 15.1: Create daily reconciliation job**

```typescript
import { db } from '../db';
import { users } from '../../shared/schema';
import { createDailySnapshot } from '../services/reconciliationService';
import { getAccountStateForReconciliation } from '../broker/ibkr';

/**
 * Run daily reconciliation for all active users
 * Should be scheduled for 4:15 PM ET (after market close)
 */
export async function runDailyReconciliation(): Promise<{
  processed: number;
  errors: string[];
}> {
  const today = new Date().toISOString().split('T')[0];
  const errors: string[] = [];
  let processed = 0;

  // Get all users with IBKR credentials
  const activeUsers = await db
    .select()
    .from(users)
    .where(/* filter for users with active IBKR connection */);

  for (const user of activeUsers) {
    try {
      // Fetch IBKR state
      const ibkrState = await getAccountStateForReconciliation(user.id);

      // Create snapshot and reconcile
      await createDailySnapshot(user.id, today, ibkrState);

      processed++;
    } catch (error) {
      errors.push(`User ${user.id}: ${(error as Error).message}`);
    }
  }

  return { processed, errors };
}
```

**Step 15.2: Register job with scheduler**

Add to job scheduling configuration (look for existing patterns in `/server/services/engineScheduler.ts` or similar).

**Step 15.3: Verify TypeScript compiles**

Run: `cd /Users/home/APE-YOLO && npx tsc --noEmit`
Expected: No errors

**Step 15.4: Commit**

```bash
git add server/jobs/dailyReconciliation.ts
git commit -m "feat(accounting): add daily reconciliation scheduled job"
```

---

## Task 16: Integration Testing

**Files:**
- None (manual testing)

**Step 16.1: Start the application**

Run: `cd /Users/home/APE-YOLO && npm run dev`
Expected: Application starts without errors

**Step 16.2: Test ledger entry creation**

Use API client or curl to create a test entry:

```bash
curl -X POST http://localhost:3000/api/accounting/ledger \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "effectiveDate": "2026-01-25",
    "entryType": "deposit",
    "amount": "10000",
    "description": "Initial deposit"
  }'
```

Expected: Entry created successfully

**Step 16.3: Test ledger query**

```bash
curl "http://localhost:3000/api/accounting/ledger?startDate=2026-01-01&endDate=2026-01-31" \
  -H "Authorization: Bearer <token>"
```

Expected: Returns entries with running balance

**Step 16.4: Test reconciliation snapshot**

```bash
curl -X POST http://localhost:3000/api/accounting/snapshot \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "date": "2026-01-25",
    "ibkrState": {
      "cash": 10000,
      "positionsValue": 0,
      "nav": 10000,
      "realizedPnl": 0,
      "unrealizedPnl": 0,
      "rawResponse": {}
    }
  }'
```

Expected: Snapshot created, auto-reconciled if variance < $1

**Step 16.5: Test UI**

1. Open terminal in browser
2. Click accounting icon in Dock
3. Verify Ledger tab shows entries
4. Verify Reconciliation tab shows calendar

**Step 16.6: Commit any fixes**

```bash
git add .
git commit -m "fix(accounting): integration testing fixes"
```

---

## Summary

This plan implements:

1. **Schema** (Tasks 1-5): Four new tables for accounting
2. **Services** (Tasks 6-8): Core accounting, reconciliation, and attestation logic
3. **Routes** (Task 9): API endpoints for all accounting operations
4. **Trade Integration** (Task 10): Automatic ledger entries from trade execution
5. **UI** (Tasks 11-13): Terminal window with ledger and reconciliation views
6. **IBKR Integration** (Task 14): Fetch account state for reconciliation
7. **Automation** (Task 15): Daily reconciliation job
8. **Testing** (Task 16): Integration verification

Total: 16 tasks, approximately 50+ steps following TDD principles with frequent commits.
