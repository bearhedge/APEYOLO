# Enhanced Mandate Blockchain Tracking System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add comprehensive event tracking to the mandate system, recording all mandate-related events on Solana with a timeline UI in the MandateWindow.

**Architecture:** Events are recorded to a new `mandate_events` table with SHA256 hashes. Each event can optionally be committed to Solana using the Memo Program (same pattern as trade recording). The MandateWindow displays events in a tabbed timeline view.

**Tech Stack:** Drizzle ORM, Express.js, Solana Web3.js (Memo Program), React with TanStack Query

---

## Task 1: Add mandate_events Table to Schema

**Files:**
- Modify: `/Users/home/APE-YOLO/shared/schema.ts:730-731`

**Step 1: Add the mandate_events table definition**

Insert after line 731 (after `// ==================== END TRADING MANDATES ====================`):

```typescript
// ==================== MANDATE EVENTS (Blockchain Tracking) ====================

export const mandateEvents = pgTable("mandate_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  mandateId: varchar("mandate_id").references(() => tradingMandates.id, { onDelete: "set null" }),

  eventType: text("event_type").notNull(), // MANDATE_CREATED, MANDATE_DEACTIVATED, VIOLATION_BLOCKED, COMMITMENT_RECORDED
  eventData: jsonb("event_data").notNull(),
  eventHash: text("event_hash").notNull(), // SHA256 of event data

  previousMandateId: varchar("previous_mandate_id").references(() => tradingMandates.id, { onDelete: "set null" }),
  relatedViolationId: varchar("related_violation_id").references(() => mandateViolations.id, { onDelete: "set null" }),

  actorId: varchar("actor_id").notNull(),
  actorRole: text("actor_role").notNull().default("owner"),

  solanaSignature: text("solana_signature"),
  solanaSlot: bigint("solana_slot", { mode: "number" }),
  solanaCluster: text("solana_cluster").default("devnet"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  recordedOnChainAt: timestamp("recorded_on_chain_at"),
}, (table) => [
  index("mandate_events_user_id_idx").on(table.userId),
  index("mandate_events_mandate_id_idx").on(table.mandateId),
  index("mandate_events_type_idx").on(table.eventType),
  index("mandate_events_created_at_idx").on(table.createdAt),
]);

export const insertMandateEventSchema = createInsertSchema(mandateEvents).omit({
  id: true,
  createdAt: true,
  recordedOnChainAt: true,
  solanaSignature: true,
  solanaSlot: true,
});

export type MandateEvent = typeof mandateEvents.$inferSelect;
export type InsertMandateEvent = z.infer<typeof insertMandateEventSchema>;

// ==================== END MANDATE EVENTS ====================
```

**Step 2: Run migration to create table**

Run: `cd /Users/home/APE-YOLO && npm run db:push`
Expected: Migration applies successfully, `mandate_events` table created

**Step 3: Verify table exists**

Run: `cd /Users/home/APE-YOLO && npm run db:push 2>&1 | head -20`
Expected: No errors, schema synced

**Step 4: Commit schema changes**

```bash
git add shared/schema.ts
git commit -m "feat: add mandate_events table for blockchain tracking

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Add MandateEvent Types to Shared Types

**Files:**
- Modify: `/Users/home/APE-YOLO/shared/types/mandate.ts:124-125`

**Step 1: Add MandateEvent types at end of file**

Append after line 125:

```typescript

// ==================== MANDATE EVENTS ====================

// Event types that can be tracked
export type MandateEventType =
  | 'MANDATE_CREATED'
  | 'MANDATE_DEACTIVATED'
  | 'VIOLATION_BLOCKED'
  | 'COMMITMENT_RECORDED';

// Event data structures for each event type
export interface MandateCreatedEventData {
  mandateId: string;
  rules: MandateRules;
  rulesHash: string;
}

export interface MandateDeactivatedEventData {
  mandateId: string;
  reason?: string;
  replacedBy?: string;
}

export interface ViolationBlockedEventData {
  violationType: ViolationType;
  attemptedValue: string;
  limitValue: string;
  tradeContext?: Record<string, unknown>;
}

export interface CommitmentRecordedEventData {
  targetId: string;
  targetType: 'mandate' | 'violation';
  solanaSignature: string;
  solanaSlot: number;
}

export type MandateEventData =
  | MandateCreatedEventData
  | MandateDeactivatedEventData
  | ViolationBlockedEventData
  | CommitmentRecordedEventData;

// Full event record
export interface MandateEvent {
  id: string;
  userId: string;
  mandateId?: string;
  eventType: MandateEventType;
  eventData: MandateEventData;
  eventHash: string;
  previousMandateId?: string;
  relatedViolationId?: string;
  actorId: string;
  actorRole: string;
  solanaSignature?: string;
  solanaSlot?: number;
  solanaCluster?: string;
  createdAt: string;
  recordedOnChainAt?: string;
}

// API response for event timeline
export interface MandateEventTimeline {
  events: MandateEvent[];
  totalCount: number;
  uncommittedCount: number;
}

// Event display formatting
export interface MandateEventDisplay {
  event: MandateEvent;
  icon: string;
  color: string;
  title: string;
  description: string;
  explorerUrl?: string;
}
```

**Step 2: Commit types**

```bash
git add shared/types/mandate.ts
git commit -m "feat: add MandateEvent types for timeline tracking

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Create MandateEventService

**Files:**
- Create: `/Users/home/APE-YOLO/server/services/mandateEventService.ts`

**Step 1: Create the mandate event service file**

```typescript
/**
 * Mandate Event Service
 *
 * Records all mandate-related events for audit trail and blockchain commitment.
 * Events are hashed with SHA256 and can be committed to Solana.
 */

import { createHash } from 'crypto';
import { db } from '../db';
import { mandateEvents, tradingMandates, mandateViolations } from '@shared/schema';
import { eq, and, desc, isNull } from 'drizzle-orm';
import { Connection, Keypair, Transaction, PublicKey, sendAndConfirmTransaction, clusterApiUrl, LAMPORTS_PER_SOL } from '@solana/web3.js';
import type {
  MandateEvent,
  MandateEventType,
  MandateEventData,
  MandateEventTimeline,
} from '@shared/types/mandate';

// ============================================
// Configuration
// ============================================

const CLUSTER = process.env.SOLANA_CLUSTER as 'devnet' | 'mainnet-beta' || 'devnet';
const RPC_ENDPOINT = process.env.SOLANA_RPC_URL || clusterApiUrl(CLUSTER);
const WALLET_PRIVATE_KEY = process.env.SOLANA_WALLET_PRIVATE_KEY;
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

// ============================================
// Helper Functions
// ============================================

function getConnection(): Connection {
  return new Connection(RPC_ENDPOINT, 'confirmed');
}

function getWalletKeypair(): Keypair | null {
  if (!WALLET_PRIVATE_KEY) {
    console.warn('[MandateEventService] No SOLANA_WALLET_PRIVATE_KEY configured');
    return null;
  }

  try {
    if (WALLET_PRIVATE_KEY.startsWith('[')) {
      const secretKey = Uint8Array.from(JSON.parse(WALLET_PRIVATE_KEY));
      return Keypair.fromSecretKey(secretKey);
    }

    const bs58 = require('bs58');
    const secretKey = bs58.decode(WALLET_PRIVATE_KEY);
    return Keypair.fromSecretKey(secretKey);
  } catch (error: any) {
    console.error('[MandateEventService] Failed to parse wallet private key:', error.message);
    return null;
  }
}

/**
 * Generate SHA256 hash of event data
 */
function hashEventData(eventType: MandateEventType, eventData: MandateEventData, timestamp: string): string {
  const data = JSON.stringify({
    eventType,
    eventData,
    timestamp,
  });
  return '0x' + createHash('sha256').update(data).digest('hex');
}

/**
 * Format event for database
 */
function formatEvent(dbEvent: any): MandateEvent {
  return {
    id: dbEvent.id,
    userId: dbEvent.userId,
    mandateId: dbEvent.mandateId,
    eventType: dbEvent.eventType as MandateEventType,
    eventData: dbEvent.eventData as MandateEventData,
    eventHash: dbEvent.eventHash,
    previousMandateId: dbEvent.previousMandateId,
    relatedViolationId: dbEvent.relatedViolationId,
    actorId: dbEvent.actorId,
    actorRole: dbEvent.actorRole,
    solanaSignature: dbEvent.solanaSignature,
    solanaSlot: dbEvent.solanaSlot,
    solanaCluster: dbEvent.solanaCluster,
    createdAt: dbEvent.createdAt?.toISOString() || new Date().toISOString(),
    recordedOnChainAt: dbEvent.recordedOnChainAt?.toISOString(),
  };
}

// ============================================
// Event Recording
// ============================================

interface RecordEventParams {
  userId: string;
  eventType: MandateEventType;
  eventData: MandateEventData;
  mandateId?: string;
  previousMandateId?: string;
  relatedViolationId?: string;
  actorId?: string;
  actorRole?: string;
}

/**
 * Record a mandate event
 */
export async function recordMandateEvent(params: RecordEventParams): Promise<MandateEvent> {
  if (!db) {
    throw new Error('Database not available');
  }

  const timestamp = new Date().toISOString();
  const eventHash = hashEventData(params.eventType, params.eventData, timestamp);

  const [event] = await db
    .insert(mandateEvents)
    .values({
      userId: params.userId,
      mandateId: params.mandateId,
      eventType: params.eventType,
      eventData: params.eventData,
      eventHash,
      previousMandateId: params.previousMandateId,
      relatedViolationId: params.relatedViolationId,
      actorId: params.actorId || params.userId,
      actorRole: params.actorRole || 'owner',
    })
    .returning();

  console.log(`[MandateEventService] Recorded ${params.eventType} event: ${event.id}`);

  return formatEvent(event);
}

// ============================================
// Event Queries
// ============================================

/**
 * Get event history for a user
 */
export async function getMandateEventHistory(
  userId: string,
  options?: {
    mandateId?: string;
    eventType?: MandateEventType;
    limit?: number;
    offset?: number;
  }
): Promise<MandateEventTimeline> {
  if (!db) {
    return { events: [], totalCount: 0, uncommittedCount: 0 };
  }

  const limit = options?.limit || 50;
  const offset = options?.offset || 0;

  // Build where conditions
  const conditions = [eq(mandateEvents.userId, userId)];
  if (options?.mandateId) {
    conditions.push(eq(mandateEvents.mandateId, options.mandateId));
  }
  if (options?.eventType) {
    conditions.push(eq(mandateEvents.eventType, options.eventType));
  }

  // Get events
  const events = await db
    .select()
    .from(mandateEvents)
    .where(and(...conditions))
    .orderBy(desc(mandateEvents.createdAt))
    .limit(limit)
    .offset(offset);

  // Get total count
  const allEvents = await db
    .select({ id: mandateEvents.id })
    .from(mandateEvents)
    .where(and(...conditions));

  // Get uncommitted count
  const uncommitted = await db
    .select({ id: mandateEvents.id })
    .from(mandateEvents)
    .where(and(
      eq(mandateEvents.userId, userId),
      isNull(mandateEvents.solanaSignature)
    ));

  return {
    events: events.map(formatEvent),
    totalCount: allEvents.length,
    uncommittedCount: uncommitted.length,
  };
}

/**
 * Get timeline for a specific mandate
 */
export async function getMandateTimeline(mandateId: string): Promise<MandateEvent[]> {
  if (!db) return [];

  const events = await db
    .select()
    .from(mandateEvents)
    .where(eq(mandateEvents.mandateId, mandateId))
    .orderBy(desc(mandateEvents.createdAt));

  return events.map(formatEvent);
}

/**
 * Get a single event by ID
 */
export async function getMandateEventById(eventId: string): Promise<MandateEvent | null> {
  if (!db) return null;

  const [event] = await db
    .select()
    .from(mandateEvents)
    .where(eq(mandateEvents.id, eventId))
    .limit(1);

  if (!event) return null;
  return formatEvent(event);
}

// ============================================
// Solana Recording
// ============================================

interface RecordOnSolanaResult {
  success: boolean;
  signature?: string;
  slot?: number;
  error?: string;
}

/**
 * Record an event on Solana blockchain
 */
export async function recordEventOnSolana(eventId: string): Promise<RecordOnSolanaResult> {
  try {
    if (!db) {
      return { success: false, error: 'Database not available' };
    }

    const event = await getMandateEventById(eventId);
    if (!event) {
      return { success: false, error: 'Event not found' };
    }

    if (event.solanaSignature) {
      return { success: false, error: 'Event already recorded on Solana', signature: event.solanaSignature };
    }

    const wallet = getWalletKeypair();
    if (!wallet) {
      return { success: false, error: 'Solana wallet not configured' };
    }

    // Create compact memo: APE_YOLO|MANDATE|{type}|{hash}
    const memo = `APE_YOLO|MANDATE|${event.eventType}|${event.eventHash.slice(0, 18)}`;
    const memoData = Buffer.from(memo, 'utf-8');

    const connection = getConnection();
    const transaction = new Transaction();

    transaction.add({
      keys: [{ pubkey: wallet.publicKey, isSigner: true, isWritable: true }],
      programId: MEMO_PROGRAM_ID,
      data: memoData,
    });

    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = wallet.publicKey;

    const signature = await sendAndConfirmTransaction(connection, transaction, [wallet], {
      commitment: 'confirmed',
    });

    // Get slot
    const tx = await connection.getTransaction(signature, { commitment: 'confirmed' });
    const slot = tx?.slot || 0;

    // Update event with Solana data
    await db
      .update(mandateEvents)
      .set({
        solanaSignature: signature,
        solanaSlot: slot,
        solanaCluster: CLUSTER,
        recordedOnChainAt: new Date(),
      })
      .where(eq(mandateEvents.id, eventId));

    console.log(`[MandateEventService] Event ${eventId} recorded on Solana: ${signature}`);

    return { success: true, signature, slot };
  } catch (error: any) {
    console.error('[MandateEventService] Failed to record event on Solana:', error);
    return { success: false, error: error.message || 'Failed to record on Solana' };
  }
}

/**
 * Record multiple events on Solana (batch)
 */
export async function recordEventsOnSolana(eventIds: string[]): Promise<Map<string, RecordOnSolanaResult>> {
  const results = new Map<string, RecordOnSolanaResult>();

  for (const eventId of eventIds) {
    const result = await recordEventOnSolana(eventId);
    results.set(eventId, result);

    // Rate limiting delay
    if (eventIds.indexOf(eventId) < eventIds.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  return results;
}
```

**Step 2: Verify file was created**

Run: `ls -la /Users/home/APE-YOLO/server/services/mandateEventService.ts`
Expected: File exists

**Step 3: Commit new service**

```bash
git add server/services/mandateEventService.ts
git commit -m "feat: add mandateEventService for blockchain event tracking

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Integrate Event Recording into MandateService

**Files:**
- Modify: `/Users/home/APE-YOLO/server/services/mandateService.ts:1-70`

**Step 1: Add import for event service**

After line 8, add:

```typescript
import { recordMandateEvent } from './mandateEventService';
import type { MandateCreatedEventData, MandateDeactivatedEventData, ViolationBlockedEventData } from '@shared/types/mandate';
```

**Step 2: Update createMandate to record event**

Replace the `createMandate` function (lines 30-69) with:

```typescript
/**
 * Create a new trading mandate
 * Once created, mandates are locked and cannot be modified
 */
export async function createMandate(
  userId: string,
  request: CreateMandateRequest
): Promise<Mandate> {
  if (!db) {
    throw new Error('Database not available');
  }

  // Check if user already has an active mandate
  const existingMandate = await getActiveMandate(userId);
  if (existingMandate) {
    throw new Error('User already has an active mandate. Mandates cannot be modified - deactivate the existing one first.');
  }

  // Generate hash of mandate rules for on-chain commitment
  const rulesHash = generateMandateHash(request);

  const [mandate] = await db
    .insert(tradingMandates)
    .values({
      userId,
      allowedSymbols: request.allowedSymbols,
      strategyType: request.strategyType,
      minDelta: request.minDelta.toString(),
      maxDelta: request.maxDelta.toString(),
      maxDailyLossPercent: request.maxDailyLossPercent.toString(),
      noOvernightPositions: request.noOvernightPositions,
      exitDeadline: request.exitDeadline,
      tradingWindowStart: request.tradingWindowStart,
      tradingWindowEnd: request.tradingWindowEnd,
      isActive: true,
      isLocked: true,
      onChainHash: `0x${rulesHash}`,
    })
    .returning();

  console.log(`[MandateService] Created mandate ${mandate.id} for user ${userId}`);

  // Record MANDATE_CREATED event
  const eventData: MandateCreatedEventData = {
    mandateId: mandate.id,
    rules: {
      allowedSymbols: request.allowedSymbols,
      strategyType: request.strategyType,
      minDelta: request.minDelta,
      maxDelta: request.maxDelta,
      maxDailyLossPercent: request.maxDailyLossPercent,
      noOvernightPositions: request.noOvernightPositions,
      exitDeadline: request.exitDeadline,
      tradingWindowStart: request.tradingWindowStart,
      tradingWindowEnd: request.tradingWindowEnd,
    },
    rulesHash: `0x${rulesHash}`,
  };

  await recordMandateEvent({
    userId,
    eventType: 'MANDATE_CREATED',
    eventData,
    mandateId: mandate.id,
  });

  return formatMandate(mandate);
}
```

**Step 3: Update deactivateMandate to record event**

Replace the `deactivateMandate` function (lines 109-124) with:

```typescript
/**
 * Deactivate a mandate (cannot delete - kept for audit trail)
 */
export async function deactivateMandate(mandateId: string, userId: string, reason?: string): Promise<void> {
  if (!db) {
    throw new Error('Database not available');
  }

  await db
    .update(tradingMandates)
    .set({ isActive: false })
    .where(and(
      eq(tradingMandates.id, mandateId),
      eq(tradingMandates.userId, userId)
    ));

  console.log(`[MandateService] Deactivated mandate ${mandateId}`);

  // Record MANDATE_DEACTIVATED event
  const eventData: MandateDeactivatedEventData = {
    mandateId,
    reason: reason || 'User deactivated mandate',
  };

  await recordMandateEvent({
    userId,
    eventType: 'MANDATE_DEACTIVATED',
    eventData,
    mandateId,
  });
}
```

**Step 4: Update recordViolation to record event**

In the `recordViolation` function, after line 394 (after inserting into mandateViolations), add:

```typescript
  // Record VIOLATION_BLOCKED event
  const violationEventData: ViolationBlockedEventData = {
    violationType: params.type,
    attemptedValue: params.attempted,
    limitValue: params.limit,
    tradeContext: params.tradeDetails as Record<string, unknown>,
  };

  await recordMandateEvent({
    userId,
    eventType: 'VIOLATION_BLOCKED',
    eventData: violationEventData,
    mandateId,
    relatedViolationId: violation.id,
  });
```

**Step 5: Run TypeScript compiler to verify**

Run: `cd /Users/home/APE-YOLO && npx tsc --noEmit -p server/tsconfig.json 2>&1 | head -30`
Expected: No errors related to mandateService.ts

**Step 6: Commit integration**

```bash
git add server/services/mandateService.ts
git commit -m "feat: integrate event recording into mandate operations

- Record MANDATE_CREATED event on createMandate
- Record MANDATE_DEACTIVATED event on deactivateMandate
- Record VIOLATION_BLOCKED event on recordViolation

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Add API Endpoints for Events

**Files:**
- Modify: `/Users/home/APE-YOLO/server/defiRoutes.ts:19-22`

**Step 1: Add imports for event service**

After line 22 (after the mandateService imports), add:

```typescript
import {
  getMandateEventHistory,
  getMandateTimeline,
  recordEventOnSolana,
  recordEventsOnSolana,
} from './services/mandateEventService';
```

**Step 2: Add event endpoints**

After line 1176 (after the `/violation/:id/record` endpoint), add:

```typescript

// ============================================
// Mandate Event Endpoints
// ============================================

/**
 * GET /api/defi/mandate/events
 *
 * Get event history for the authenticated user.
 * Supports filtering by mandateId, eventType.
 */
router.get('/mandate/events', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const mandateId = req.query.mandateId as string | undefined;
    const eventType = req.query.eventType as string | undefined;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    const timeline = await getMandateEventHistory(userId, {
      mandateId,
      eventType: eventType as any,
      limit,
      offset,
    });

    res.json({
      success: true,
      ...timeline,
    });
  } catch (error: any) {
    console.error('[DefiRoutes] Error getting mandate events:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get mandate events',
    });
  }
});

/**
 * GET /api/defi/mandate/:id/timeline
 *
 * Get full event timeline for a specific mandate.
 */
router.get('/mandate/:id/timeline', requireAuth, async (req: Request, res: Response) => {
  try {
    const mandateId = req.params.id;

    if (!mandateId) {
      return res.status(400).json({
        success: false,
        error: 'Mandate ID is required',
      });
    }

    const events = await getMandateTimeline(mandateId);

    res.json({
      success: true,
      events,
      count: events.length,
    });
  } catch (error: any) {
    console.error('[DefiRoutes] Error getting mandate timeline:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get mandate timeline',
    });
  }
});

/**
 * POST /api/defi/mandate/events/:id/commit
 *
 * Commit a single event to Solana blockchain.
 */
router.post('/mandate/events/:id/commit', requireAuth, async (req: Request, res: Response) => {
  try {
    const eventId = req.params.id;

    if (!eventId) {
      return res.status(400).json({
        success: false,
        error: 'Event ID is required',
      });
    }

    const result = await recordEventOnSolana(eventId);

    if (result.success) {
      res.json({
        success: true,
        signature: result.signature,
        slot: result.slot,
        explorerUrl: `https://explorer.solana.com/tx/${result.signature}?cluster=${process.env.SOLANA_CLUSTER || 'devnet'}`,
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error,
        signature: result.signature,
      });
    }
  } catch (error: any) {
    console.error('[DefiRoutes] Error committing event to Solana:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to commit event to Solana',
    });
  }
});

/**
 * POST /api/defi/mandate/events/commit-batch
 *
 * Commit multiple events to Solana blockchain.
 */
router.post('/mandate/events/commit-batch', requireAuth, async (req: Request, res: Response) => {
  try {
    const { eventIds } = req.body as { eventIds: string[] };

    if (!eventIds || !Array.isArray(eventIds) || eventIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'eventIds array is required',
      });
    }

    if (eventIds.length > 10) {
      return res.status(400).json({
        success: false,
        error: 'Maximum 10 events can be committed at once',
      });
    }

    const results = await recordEventsOnSolana(eventIds);

    const response: any = {
      success: true,
      results: {},
      successCount: 0,
      failureCount: 0,
    };

    for (const [id, result] of results) {
      response.results[id] = result;
      if (result.success) {
        response.successCount++;
      } else {
        response.failureCount++;
      }
    }

    res.json(response);
  } catch (error: any) {
    console.error('[DefiRoutes] Error committing events to Solana:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to commit events to Solana',
    });
  }
});
```

**Step 3: Run TypeScript compiler to verify**

Run: `cd /Users/home/APE-YOLO && npx tsc --noEmit -p server/tsconfig.json 2>&1 | head -30`
Expected: No errors

**Step 4: Commit API endpoints**

```bash
git add server/defiRoutes.ts
git commit -m "feat: add API endpoints for mandate event tracking

- GET /mandate/events - event history with filters
- GET /mandate/:id/timeline - full mandate timeline
- POST /mandate/events/:id/commit - commit single event
- POST /mandate/events/commit-batch - batch commit

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Update MandateWindow with Tabbed Timeline UI

**Files:**
- Modify: `/Users/home/APE-YOLO/client/src/components/terminal/windows/MandateWindow.tsx`

**Step 1: Add new imports and interfaces**

Replace lines 1-39 with:

```typescript
/**
 * MandateWindow - Trading mandate display and management with event timeline
 *
 * Full functionality: View, create, edit, commit to Solana, view event history.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Shield, Lock, ExternalLink, Loader2, Edit3, Save, X, Plus, Clock, AlertTriangle, CheckCircle, FileText, History } from 'lucide-react';

interface Mandate {
  id: string;
  allowedSymbols: string[];
  strategyType: string;
  minDelta: number;
  maxDelta: number;
  maxDailyLossPercent: number;
  noOvernightPositions: boolean;
  requireStopLoss: boolean;
  maxStopLossMultiplier?: number;
  tradingWindowStart?: string;
  tradingWindowEnd?: string;
  exitDeadline?: string;
  solanaSignature?: string;
  isActive: boolean;
}

interface MandateEvent {
  id: string;
  eventType: string;
  eventData: any;
  eventHash: string;
  solanaSignature?: string;
  solanaSlot?: number;
  createdAt: string;
  recordedOnChainAt?: string;
}

interface MandateFormData {
  allowedSymbols: string;
  strategyType: string;
  minDelta: string;
  maxDelta: string;
  maxDailyLossPercent: string;
  noOvernightPositions: boolean;
  requireStopLoss: boolean;
  maxStopLossMultiplier: string;
  tradingWindowStart: string;
  exitDeadline: string;
}

type TabType = 'rules' | 'history';
```

**Step 2: Add event history query and tab state**

After line 57 (after `const [error, setError] = useState...`), add:

```typescript
  const [activeTab, setActiveTab] = useState<TabType>('rules');

  const { data: eventData, isLoading: eventsLoading } = useQuery<{
    events: MandateEvent[];
    totalCount: number;
    uncommittedCount: number;
  }>({
    queryKey: ['mandateEvents'],
    queryFn: async () => {
      const res = await fetch('/api/defi/mandate/events', { credentials: 'include' });
      if (!res.ok) return { events: [], totalCount: 0, uncommittedCount: 0 };
      const data = await res.json();
      return data;
    },
  });

  // Commit event mutation
  const commitEventMutation = useMutation({
    mutationFn: async (eventId: string) => {
      const res = await fetch(`/api/defi/mandate/events/${eventId}/commit`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to commit event');
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mandateEvents'] });
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });
```

**Step 3: Add TabButton and EventRow components**

Before the `MandateWindow` export (after the existing helper components), add:

```typescript
function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '8px 16px',
        background: active ? 'rgba(74, 222, 128, 0.2)' : 'transparent',
        border: 'none',
        borderBottom: active ? '2px solid #4ade80' : '2px solid transparent',
        color: active ? '#4ade80' : '#888',
        fontSize: 12,
        cursor: 'pointer',
        fontFamily: 'inherit',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      {children}
    </button>
  );
}

function EventRow({
  event,
  onCommit,
  isCommitting,
}: {
  event: MandateEvent;
  onCommit: (id: string) => void;
  isCommitting: boolean;
}) {
  const getEventIcon = (type: string) => {
    switch (type) {
      case 'MANDATE_CREATED':
        return <FileText style={{ width: 14, height: 14, color: '#4ade80' }} />;
      case 'MANDATE_DEACTIVATED':
        return <X style={{ width: 14, height: 14, color: '#f59e0b' }} />;
      case 'VIOLATION_BLOCKED':
        return <AlertTriangle style={{ width: 14, height: 14, color: '#ef4444' }} />;
      case 'COMMITMENT_RECORDED':
        return <Lock style={{ width: 14, height: 14, color: '#3b82f6' }} />;
      default:
        return <Clock style={{ width: 14, height: 14, color: '#888' }} />;
    }
  };

  const getEventTitle = (type: string) => {
    switch (type) {
      case 'MANDATE_CREATED':
        return 'Mandate Created';
      case 'MANDATE_DEACTIVATED':
        return 'Mandate Deactivated';
      case 'VIOLATION_BLOCKED':
        return 'Violation Blocked';
      case 'COMMITMENT_RECORDED':
        return 'Committed to Chain';
      default:
        return type;
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      padding: '8px 0',
      borderBottom: '1px solid #222',
      gap: 12,
    }}>
      {getEventIcon(event.eventType)}
      <div style={{ flex: 1 }}>
        <div style={{ color: '#fff', fontSize: 12 }}>{getEventTitle(event.eventType)}</div>
        <div style={{ color: '#666', fontSize: 10 }}>{formatDate(event.createdAt)}</div>
      </div>
      {event.solanaSignature ? (
        <a
          href={`https://explorer.solana.com/tx/${event.solanaSignature}?cluster=devnet`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#3b82f6', display: 'flex', alignItems: 'center', gap: 4, fontSize: 10 }}
        >
          <CheckCircle style={{ width: 12, height: 12 }} />
          Verified
          <ExternalLink style={{ width: 10, height: 10 }} />
        </a>
      ) : (
        <button
          onClick={() => onCommit(event.id)}
          disabled={isCommitting}
          style={{
            padding: '4px 8px',
            background: 'rgba(59, 130, 246, 0.2)',
            border: '1px solid rgba(59, 130, 246, 0.5)',
            color: '#3b82f6',
            fontSize: 10,
            cursor: isCommitting ? 'not-allowed' : 'pointer',
            opacity: isCommitting ? 0.5 : 1,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          {isCommitting ? <Loader2 style={{ width: 10, height: 10, animation: 'spin 1s linear infinite' }} /> : <Lock style={{ width: 10, height: 10 }} />}
          Commit
        </button>
      )}
    </div>
  );
}
```

**Step 4: Update the display mode to include tabs**

In the display mode section (starting around line 309), replace the return statement with:

```typescript
  // Display mode - Tabbed interface
  return (
    <div style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
      {/* Tab Navigation */}
      <div style={{ display: 'flex', borderBottom: '1px solid #333', marginBottom: 12 }}>
        <TabButton active={activeTab === 'rules'} onClick={() => setActiveTab('rules')}>
          <Shield style={{ width: 12, height: 12 }} />
          Rules
        </TabButton>
        <TabButton active={activeTab === 'history'} onClick={() => setActiveTab('history')}>
          <History style={{ width: 12, height: 12 }} />
          History
          {eventData?.uncommittedCount ? (
            <span style={{
              background: '#f59e0b',
              color: '#000',
              padding: '1px 6px',
              borderRadius: 10,
              fontSize: 10,
              fontWeight: 600,
            }}>
              {eventData.uncommittedCount}
            </span>
          ) : null}
        </TabButton>
      </div>

      {/* Rules Tab */}
      {activeTab === 'rules' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <p style={{ color: '#4ade80', margin: 0 }}>
              TRADING MANDATE
            </p>
            {!mandate.solanaSignature && (
              <button onClick={startEditing} style={editButtonStyle}>
                <Edit3 style={{ width: 12, height: 12 }} />
              </button>
            )}
          </div>

          {/* Green bordered table */}
          <table style={{
            width: '100%',
            borderCollapse: 'collapse',
            border: '1px solid #4ade80',
            fontSize: 12,
            marginBottom: 16,
          }}>
            <tbody>
              <TableRow label="Symbols" value={mandate.allowedSymbols.join(', ')} />
              <TableRow label="Strategy" value={mandate.strategyType || 'Credit Spreads'} />
              <TableRow label="Delta Range" value={`${(mandate.minDelta ?? 0.10).toFixed(2)} – ${(mandate.maxDelta ?? 0.35).toFixed(2)}`} />
              <TableRow label="Daily Max Loss" value={`${((mandate.maxDailyLossPercent ?? 0.02) * 100).toFixed(0)}%`} />
              <TableRow label="Entry Window" value="After 11:00am ET (12:00am HKT)" />
              <TableRow label="Exit By" value="3:59pm ET (4:59am HKT)" />
              <TableRow label="Stop Loss" value="Yes" highlight />
              <TableRow label="Overnight" value="No" warn />
            </tbody>
          </table>

          {/* Blockchain Status */}
          <div style={{ borderTop: '1px solid #333', paddingTop: 12 }}>
            <Row
              label="On-Chain"
              value={
                mandate.solanaSignature ? (
                  <a
                    href={`https://explorer.solana.com/tx/${mandate.solanaSignature}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: '#3b82f6', display: 'flex', alignItems: 'center', gap: 4 }}
                  >
                    <Lock style={{ width: 12, height: 12 }} />
                    Verified
                    <ExternalLink style={{ width: 12, height: 12 }} />
                  </a>
                ) : (
                  <span style={{ color: '#f59e0b' }}>NOT COMMITTED</span>
                )
              }
            />

            {/* Commit Button */}
            {!mandate.solanaSignature && (
              <ActionButton
                onClick={() => commitMutation.mutate()}
                disabled={commitMutation.isPending}
                primary
                style={{ width: '100%', marginTop: 12 }}
              >
                {commitMutation.isPending ? (
                  <>
                    <Loader2 style={iconSpin} />
                    Committing...
                  </>
                ) : (
                  <>
                    <Lock style={iconStyle} />
                    Commit to Blockchain
                  </>
                )}
              </ActionButton>
            )}
          </div>
        </>
      )}

      {/* History Tab */}
      {activeTab === 'history' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <p style={{ color: '#87ceeb', margin: 0 }}>EVENT HISTORY</p>
            <span style={{ color: '#666', fontSize: 10 }}>
              {eventData?.totalCount || 0} events
            </span>
          </div>

          {eventsLoading ? (
            <p style={{ color: '#666', fontSize: 12 }}>Loading events...</p>
          ) : eventData?.events.length === 0 ? (
            <p style={{ color: '#666', fontSize: 12 }}>No events recorded yet.</p>
          ) : (
            <div style={{ maxHeight: 300, overflowY: 'auto' }}>
              {eventData?.events.map((event) => (
                <EventRow
                  key={event.id}
                  event={event}
                  onCommit={(id) => commitEventMutation.mutate(id)}
                  isCommitting={commitEventMutation.isPending}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {error && (
        <p style={{ color: '#ef4444', fontSize: 11, marginTop: 8 }}>&gt; ERROR: {error}</p>
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
```

**Step 5: Run TypeScript compiler to verify**

Run: `cd /Users/home/APE-YOLO && npx tsc --noEmit 2>&1 | grep -i "MandateWindow" | head -10`
Expected: No errors

**Step 6: Commit UI changes**

```bash
git add client/src/components/terminal/windows/MandateWindow.tsx
git commit -m "feat: add tabbed timeline UI to MandateWindow

- Rules tab: existing mandate display
- History tab: event timeline with commit buttons
- Uncommitted event badge
- Individual event commit to Solana

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 7: Test and Verify

**Files:**
- None (verification only)

**Step 1: Start the dev server**

Run: `cd /Users/home/APE-YOLO && npm run dev`
Expected: Server starts without errors

**Step 2: Verify database migration**

Run: `cd /Users/home/APE-YOLO && npm run db:push`
Expected: Schema synced successfully

**Step 3: Test create mandate (manual)**

Open browser: `http://localhost:5173/terminal`
- Navigate to Mandate window
- Create a new mandate if none exists
- Verify event appears in History tab

**Step 4: Test violation event (manual)**

If you have a way to trigger a violation:
- Attempt a trade that violates mandate rules
- Verify VIOLATION_BLOCKED event appears in History tab

**Step 5: Test Solana commit (manual)**

- Click "Commit" button on an uncommitted event
- Verify signature appears and event shows "Verified" with Explorer link

**Step 6: Final commit**

```bash
git add -A
git commit -m "feat: complete mandate blockchain tracking system

- mandate_events table for full audit trail
- Event recording on mandate create/deactivate/violation
- API endpoints for event history and Solana commit
- Tabbed MandateWindow with Rules and History views
- Individual and batch Solana commitment

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Verification Checklist

1. **Database**: `mandate_events` table created with correct schema
2. **Events**: Creating a mandate records `MANDATE_CREATED` event
3. **Events**: Deactivating a mandate records `MANDATE_DEACTIVATED` event
4. **Events**: Blocked violations record `VIOLATION_BLOCKED` event
5. **API**: GET `/api/defi/mandate/events` returns event history
6. **API**: GET `/api/defi/mandate/:id/timeline` returns mandate timeline
7. **API**: POST `/api/defi/mandate/events/:id/commit` commits event to Solana
8. **UI**: MandateWindow shows Rules and History tabs
9. **UI**: History tab shows events with timestamps
10. **UI**: Uncommitted events have "Commit" button
11. **UI**: Committed events show "Verified" with Explorer link
