/**
 * Mandate Event Service
 *
 * Records all mandate-related events for audit trail and blockchain commitment.
 * Events are hashed with SHA256 and can be committed to Solana.
 */

import { createHash } from 'crypto';
import { db } from '../db';
import { mandateEvents } from '@shared/schema';
import { eq, and, desc, isNull } from 'drizzle-orm';
import { Connection, Keypair, Transaction, PublicKey, sendAndConfirmTransaction, clusterApiUrl } from '@solana/web3.js';
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
