/**
 * Accounting Attestation Service
 *
 * Generates hashes, prepares attestation data, and submits verified trading periods
 * to Solana blockchain for immutable proof.
 */

import { createHash } from 'crypto';
import { Connection, PublicKey, Keypair, Transaction, sendAndConfirmTransaction, clusterApiUrl } from '@solana/web3.js';
import { db } from '../db';
import {
  attestationPeriods,
  dailySnapshots,
  paperTrades,
  AttestationPeriod,
} from '@shared/schema';
import { eq, and, gte, lte } from 'drizzle-orm';
import { isPeriodReconciled } from './reconciliationService';

// ============================================
// Configuration
// ============================================

const CLUSTER = process.env.SOLANA_CLUSTER as 'devnet' | 'mainnet-beta' || 'devnet';
const RPC_ENDPOINT = process.env.SOLANA_RPC_URL || clusterApiUrl(CLUSTER);
const WALLET_PRIVATE_KEY = process.env.SOLANA_WALLET_PRIVATE_KEY;
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

// ============================================
// Helpers
// ============================================

/**
 * Generate SHA-256 hash of data
 */
function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Get Solana connection
 */
function getConnection(): Connection {
  return new Connection(RPC_ENDPOINT, 'confirmed');
}

/**
 * Get wallet keypair from environment
 */
function getWalletKeypair(): Keypair | null {
  if (!WALLET_PRIVATE_KEY) {
    console.warn('[AccountingAttestation] No SOLANA_WALLET_PRIVATE_KEY configured');
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
    console.error('[AccountingAttestation] Failed to parse wallet private key:', error.message);
    return null;
  }
}

// ============================================
// Hash Generation
// ============================================

/**
 * Generate hash of all trades in a period
 */
async function generateTradesHash(userId: string, startDate: string, endDate: string): Promise<string> {
  if (!db) throw new Error('Database not available');

  const trades = await db
    .select()
    .from(paperTrades)
    .where(
      and(
        eq(paperTrades.userId, userId),
        gte(paperTrades.createdAt, new Date(startDate)),
        lte(paperTrades.createdAt, new Date(endDate + 'T23:59:59Z'))
      )
    )
    .orderBy(paperTrades.createdAt);

  const tradeData = trades.map(t => ({
    id: t.id,
    symbol: t.symbol,
    strategy: t.strategy,
    leg1Strike: t.leg1Strike,
    leg2Strike: t.leg2Strike,
    entryPremiumTotal: t.entryPremiumTotal,
    realizedPnl: t.realizedPnl,
    status: t.status,
    createdAt: t.createdAt?.toISOString(),
    closedAt: t.closedAt?.toISOString(),
  }));

  return sha256(JSON.stringify(tradeData));
}

/**
 * Generate hash of all daily snapshots in a period
 */
async function generateSnapshotsHash(userId: string, startDate: string, endDate: string): Promise<string> {
  if (!db) throw new Error('Database not available');

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

// ============================================
// Performance Calculation
// ============================================

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
  if (!db) throw new Error('Database not available');

  // Get starting and ending NAV from snapshots
  const [startSnapshot] = await db
    .select()
    .from(dailySnapshots)
    .where(
      and(
        eq(dailySnapshots.userId, userId),
        eq(dailySnapshots.snapshotDate, startDate)
      )
    )
    .limit(1);

  const [endSnapshot] = await db
    .select()
    .from(dailySnapshots)
    .where(
      and(
        eq(dailySnapshots.userId, userId),
        eq(dailySnapshots.snapshotDate, endDate)
      )
    )
    .limit(1);

  const startingNav = parseFloat(startSnapshot?.internalNav || '0');
  const endingNav = parseFloat(endSnapshot?.internalNav || '0');

  // Get closed trades in period
  const trades = await db
    .select()
    .from(paperTrades)
    .where(
      and(
        eq(paperTrades.userId, userId),
        eq(paperTrades.status, 'closed'),
        gte(paperTrades.closedAt, new Date(startDate)),
        lte(paperTrades.closedAt, new Date(endDate + 'T23:59:59Z'))
      )
    );

  const tradeCount = trades.length;
  const winCount = trades.filter(t => parseFloat(t.realizedPnl || '0') > 0).length;
  const lossCount = trades.filter(t => parseFloat(t.realizedPnl || '0') < 0).length;
  const totalPnl = trades.reduce((sum, t) => sum + parseFloat(t.realizedPnl || '0'), 0);

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

// ============================================
// Attestation Functions
// ============================================

/**
 * Prepare attestation data for a period (does not submit to Solana yet)
 */
export async function prepareAttestation(
  userId: string,
  startDate: string,
  endDate: string,
  periodLabel?: string
): Promise<AttestationPeriod> {
  if (!db) throw new Error('Database not available');

  // Check prerequisite: all days must be reconciled
  const allReconciled = await isPeriodReconciled(userId, startDate, endDate);

  if (!allReconciled) {
    throw new Error('Cannot prepare attestation: not all trading days are reconciled');
  }

  // Generate hashes
  const tradesHash = await generateTradesHash(userId, startDate, endDate);
  const snapshotsHash = await generateSnapshotsHash(userId, startDate, endDate);
  const masterHash = sha256(tradesHash + snapshotsHash);

  // Calculate performance
  const performance = await calculatePerformance(userId, startDate, endDate);

  // Count any unresolved discrepancies in period
  const discrepancySnapshots = await db
    .select()
    .from(dailySnapshots)
    .where(
      and(
        eq(dailySnapshots.userId, userId),
        eq(dailySnapshots.reconciliationStatus, 'discrepancy'),
        gte(dailySnapshots.snapshotDate, startDate),
        lte(dailySnapshots.snapshotDate, endDate)
      )
    );

  // Check if attestation already exists
  const [existing] = await db
    .select()
    .from(attestationPeriods)
    .where(
      and(
        eq(attestationPeriods.userId, userId),
        eq(attestationPeriods.periodStart, startDate),
        eq(attestationPeriods.periodEnd, endDate)
      )
    )
    .limit(1);

  let attestation: AttestationPeriod;

  if (existing) {
    // Update existing attestation
    const [updated] = await db
      .update(attestationPeriods)
      .set({
        periodLabel: periodLabel || `${startDate} to ${endDate}`,
        allDaysReconciled: allReconciled,
        reconciliationIssuesCount: discrepancySnapshots.length,
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
      .where(eq(attestationPeriods.id, existing.id))
      .returning();
    attestation = updated;
  } else {
    // Create new attestation record
    const [inserted] = await db
      .insert(attestationPeriods)
      .values({
        userId,
        periodStart: startDate,
        periodEnd: endDate,
        periodLabel: periodLabel || `${startDate} to ${endDate}`,
        allDaysReconciled: allReconciled,
        reconciliationIssuesCount: discrepancySnapshots.length,
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
      .returning();
    attestation = inserted;
  }

  return attestation;
}

/**
 * Submit attestation to Solana
 */
export async function submitAttestation(attestationId: string): Promise<{
  signature: string;
  slot: number;
}> {
  if (!db) throw new Error('Database not available');

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

  // Get wallet
  const wallet = getWalletKeypair();
  if (!wallet) {
    throw new Error('Solana wallet not configured');
  }

  // Create attestation memo
  const memoData = {
    type: 'APE-YOLO-ATTESTATION',
    version: '1.0',
    period: `${attestation.periodStart} to ${attestation.periodEnd}`,
    nav: { start: attestation.startingNav, end: attestation.endingNav },
    pnl: attestation.totalPnl,
    return: `${attestation.returnPercent}%`,
    trades: { total: attestation.tradeCount, wins: attestation.winCount, losses: attestation.lossCount },
    hash: attestation.masterHash,
    timestamp: new Date().toISOString(),
  };

  // Create compact memo for on-chain storage
  const compactMemo = `APE_YOLO|ATTEST|${attestation.periodStart}|${attestation.periodEnd}|${attestation.masterHash?.slice(0, 16)}|${attestation.returnPercent}%|${attestation.tradeCount}t`;
  const memoBuffer = Buffer.from(compactMemo, 'utf-8');

  // Build and send transaction
  const connection = getConnection();
  const transaction = new Transaction();

  transaction.add({
    keys: [{ pubkey: wallet.publicKey, isSigner: true, isWritable: true }],
    programId: MEMO_PROGRAM_ID,
    data: memoBuffer,
  });

  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = wallet.publicKey;

  const signature = await sendAndConfirmTransaction(connection, transaction, [wallet], {
    commitment: 'confirmed',
  });

  // Get slot for the transaction
  const txInfo = await connection.getTransaction(signature, { commitment: 'confirmed' });
  const slot = txInfo?.slot || 0;

  console.log(`[AccountingAttestation] Period ${attestation.periodStart} to ${attestation.periodEnd} attested: ${signature}`);

  // Update attestation record
  await db
    .update(attestationPeriods)
    .set({
      solanaSignature: signature,
      solanaSlot: slot,
      attestedAt: new Date(),
      status: 'attested',
    })
    .where(eq(attestationPeriods.id, attestationId));

  return { signature, slot };
}

/**
 * Get attestation history for a user
 */
export async function getAttestations(userId: string): Promise<AttestationPeriod[]> {
  if (!db) throw new Error('Database not available');

  return db
    .select()
    .from(attestationPeriods)
    .where(eq(attestationPeriods.userId, userId))
    .orderBy(attestationPeriods.periodStart);
}

/**
 * Get a single attestation by ID
 */
export async function getAttestationById(attestationId: string): Promise<AttestationPeriod | null> {
  if (!db) throw new Error('Database not available');

  const [attestation] = await db
    .select()
    .from(attestationPeriods)
    .where(eq(attestationPeriods.id, attestationId))
    .limit(1);

  return attestation || null;
}

/**
 * Verify an attestation hash matches the current data
 */
export async function verifyAttestation(attestationId: string): Promise<{
  valid: boolean;
  currentHash: string;
  storedHash: string;
}> {
  if (!db) throw new Error('Database not available');

  const attestation = await getAttestationById(attestationId);
  if (!attestation) {
    throw new Error('Attestation not found');
  }

  // Regenerate hashes from current data
  const tradesHash = await generateTradesHash(
    attestation.userId!,
    attestation.periodStart,
    attestation.periodEnd
  );
  const snapshotsHash = await generateSnapshotsHash(
    attestation.userId!,
    attestation.periodStart,
    attestation.periodEnd
  );
  const currentHash = sha256(tradesHash + snapshotsHash);

  return {
    valid: currentHash === attestation.masterHash,
    currentHash,
    storedHash: attestation.masterHash || '',
  };
}
