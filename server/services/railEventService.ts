/**
 * Rail Event Service
 *
 * Records all rail-related events for audit trail and blockchain commitment.
 * Events are hashed with SHA256 and can be committed to Solana.
 */

import { createHash } from 'crypto';
import { db } from '../db';
import { railEvents } from '@shared/schema';
import { eq, and, desc, isNull } from 'drizzle-orm';
import { Connection, Keypair, Transaction, PublicKey, sendAndConfirmTransaction, clusterApiUrl } from '@solana/web3.js';
import type {
  RailEvent,
  RailEventType,
  RailEventData,
  RailEventTimeline,
} from '@shared/types/rails';

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
    console.warn('[RailEventService] No SOLANA_WALLET_PRIVATE_KEY configured');
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
    console.error('[RailEventService] Failed to parse wallet private key:', error.message);
    return null;
  }
}

/**
 * Generate SHA256 hash of event data
 */
function hashEventData(eventType: RailEventType, eventData: RailEventData, timestamp: string): string {
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
function formatEvent(dbEvent: any): RailEvent {
  return {
    id: dbEvent.id,
    userId: dbEvent.userId,
    railId: dbEvent.railId,
    eventType: dbEvent.eventType as RailEventType,
    eventData: dbEvent.eventData as RailEventData,
    eventHash: dbEvent.eventHash,
    previousRailId: dbEvent.previousRailId,
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
  eventType: RailEventType;
  eventData: RailEventData;
  railId?: string;
  previousRailId?: string;
  relatedViolationId?: string;
  actorId?: string;
  actorRole?: string;
}

/**
 * Record a rail event
 */
export async function recordRailEvent(params: RecordEventParams): Promise<RailEvent> {
  if (!db) {
    throw new Error('Database not available');
  }

  const timestamp = new Date().toISOString();
  const eventHash = hashEventData(params.eventType, params.eventData, timestamp);

  const [event] = await db
    .insert(railEvents)
    .values({
      userId: params.userId,
      railId: params.railId,
      eventType: params.eventType,
      eventData: params.eventData,
      eventHash,
      previousRailId: params.previousRailId,
      relatedViolationId: params.relatedViolationId,
      actorId: params.actorId || params.userId,
      actorRole: params.actorRole || 'owner',
    })
    .returning();

  console.log(`[RailEventService] Recorded ${params.eventType} event: ${event.id}`);

  return formatEvent(event);
}

// ============================================
// Event Queries
// ============================================

/**
 * Get event history for a user
 */
export async function getRailEventHistory(
  userId: string,
  options?: {
    railId?: string;
    eventType?: RailEventType;
    limit?: number;
    offset?: number;
  }
): Promise<RailEventTimeline> {
  if (!db) {
    return { events: [], totalCount: 0, uncommittedCount: 0 };
  }

  const limit = options?.limit || 50;
  const offset = options?.offset || 0;

  // Build where conditions
  const conditions = [eq(railEvents.userId, userId)];
  if (options?.railId) {
    conditions.push(eq(railEvents.railId, options.railId));
  }
  if (options?.eventType) {
    conditions.push(eq(railEvents.eventType, options.eventType));
  }

  // Get events
  const events = await db
    .select()
    .from(railEvents)
    .where(and(...conditions))
    .orderBy(desc(railEvents.createdAt))
    .limit(limit)
    .offset(offset);

  // Get total count
  const allEvents = await db
    .select({ id: railEvents.id })
    .from(railEvents)
    .where(and(...conditions));

  // Get uncommitted count
  const uncommitted = await db
    .select({ id: railEvents.id })
    .from(railEvents)
    .where(and(
      eq(railEvents.userId, userId),
      isNull(railEvents.solanaSignature)
    ));

  return {
    events: events.map(formatEvent),
    totalCount: allEvents.length,
    uncommittedCount: uncommitted.length,
  };
}

/**
 * Get timeline for a specific rail
 */
export async function getRailTimeline(railId: string): Promise<RailEvent[]> {
  if (!db) return [];

  const events = await db
    .select()
    .from(railEvents)
    .where(eq(railEvents.railId, railId))
    .orderBy(desc(railEvents.createdAt));

  return events.map(formatEvent);
}

/**
 * Get a single event by ID
 */
export async function getRailEventById(eventId: string): Promise<RailEvent | null> {
  if (!db) return null;

  const [event] = await db
    .select()
    .from(railEvents)
    .where(eq(railEvents.id, eventId))
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

    const event = await getRailEventById(eventId);
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

    // Create compact memo: APE_YOLO|RAIL|{type}|{hash}
    const memo = `APE_YOLO|RAIL|${event.eventType}|${event.eventHash.slice(0, 18)}`;
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
      .update(railEvents)
      .set({
        solanaSignature: signature,
        solanaSlot: slot,
        solanaCluster: CLUSTER,
        recordedOnChainAt: new Date(),
      })
      .where(eq(railEvents.id, eventId));

    console.log(`[RailEventService] Event ${eventId} recorded on Solana: ${signature}`);

    return { success: true, signature, slot };
  } catch (error: any) {
    console.error('[RailEventService] Failed to record event on Solana:', error);
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
