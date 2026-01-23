/**
 * Solana Trade Recorder Service
 *
 * Records closed trades on Solana blockchain for immutable public record.
 * Each trade is recorded with full details: timestamp, symbol, strategy,
 * strikes, premiums, P&L, contracts, exit reason.
 */

import { Connection, PublicKey, Keypair, Transaction, SystemProgram, sendAndConfirmTransaction, clusterApiUrl, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { createHash } from 'crypto';
import { db } from '../db';
import { paperTrades } from '@shared/schema';
import { eq } from 'drizzle-orm';

// ============================================
// Configuration
// ============================================

// Solana cluster to use (devnet for testing, mainnet-beta for production)
const CLUSTER = process.env.SOLANA_CLUSTER as 'devnet' | 'mainnet-beta' || 'devnet';
const RPC_ENDPOINT = process.env.SOLANA_RPC_URL || clusterApiUrl(CLUSTER);

// Wallet private key (base58 encoded or JSON array)
const WALLET_PRIVATE_KEY = process.env.SOLANA_WALLET_PRIVATE_KEY;

// Memo program ID (standard Solana memo program)
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

// ============================================
// Types
// ============================================

export interface TradeRecord {
  id: string;
  timestamp: string;
  symbol: string;
  strategy: string;
  putStrike?: number;
  callStrike?: number;
  contracts: number;
  entryPremium: number;
  exitPremium: number;
  realizedPnl: number;
  exitReason: string;
}

export interface RecordResult {
  success: boolean;
  signature?: string;
  error?: string;
  tradeHash?: string;
}

// ============================================
// Service Implementation
// ============================================

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
    console.warn('[SolanaTradeRecorder] No SOLANA_WALLET_PRIVATE_KEY configured');
    return null;
  }

  try {
    // Try parsing as JSON array first
    if (WALLET_PRIVATE_KEY.startsWith('[')) {
      const secretKey = Uint8Array.from(JSON.parse(WALLET_PRIVATE_KEY));
      return Keypair.fromSecretKey(secretKey);
    }

    // Try base58 encoded
    const bs58 = require('bs58');
    const secretKey = bs58.decode(WALLET_PRIVATE_KEY);
    return Keypair.fromSecretKey(secretKey);
  } catch (error: any) {
    console.error('[SolanaTradeRecorder] Failed to parse wallet private key:', error.message);
    return null;
  }
}

/**
 * Create a deterministic hash of trade data for verification
 */
function hashTradeData(trade: TradeRecord): string {
  const data = JSON.stringify({
    id: trade.id,
    timestamp: trade.timestamp,
    symbol: trade.symbol,
    strategy: trade.strategy,
    putStrike: trade.putStrike,
    callStrike: trade.callStrike,
    contracts: trade.contracts,
    entryPremium: trade.entryPremium,
    exitPremium: trade.exitPremium,
    realizedPnl: trade.realizedPnl,
    exitReason: trade.exitReason,
  });
  return '0x' + createHash('sha256').update(data).digest('hex');
}

/**
 * Create memo instruction with trade data
 * Memo format: APE_YOLO|TRADE|{tradeId}|{hash}|{pnl}|{exit}
 */
function createTradeMemoProgramData(trade: TradeRecord, hash: string): Buffer {
  // Keep memo compact to stay within limits
  const pnlStr = trade.realizedPnl >= 0 ? `+${trade.realizedPnl.toFixed(2)}` : trade.realizedPnl.toFixed(2);
  const memo = `APE_YOLO|TRADE|${trade.id.slice(0, 8)}|${hash.slice(0, 18)}|${pnlStr}|${trade.exitReason.slice(0, 20)}`;
  return Buffer.from(memo, 'utf-8');
}

/**
 * Record a closed trade on Solana
 */
export async function recordTradeOnSolana(tradeId: string): Promise<RecordResult> {
  try {
    if (!db) {
      return { success: false, error: 'Database not available' };
    }

    // Get trade from database
    const [trade] = await db
      .select()
      .from(paperTrades)
      .where(eq(paperTrades.id, tradeId))
      .limit(1);

    if (!trade) {
      return { success: false, error: 'Trade not found' };
    }

    if (trade.status === 'open') {
      return { success: false, error: 'Cannot record open trade - trade must be closed first' };
    }

    if (trade.solanaSignature) {
      return { success: false, error: 'Trade already recorded on Solana', signature: trade.solanaSignature };
    }

    // Get wallet keypair
    const wallet = getWalletKeypair();
    if (!wallet) {
      return { success: false, error: 'Solana wallet not configured' };
    }

    // Prepare trade record
    const leg1Type = trade.leg1Type as string;
    const leg2Type = trade.leg2Type as string | null;
    const putStrike = leg1Type === 'PUT' ? parseFloat(trade.leg1Strike as string) : (leg2Type === 'PUT' ? parseFloat(trade.leg2Strike as any) : undefined);
    const callStrike = leg1Type === 'CALL' ? parseFloat(trade.leg1Strike as string) : (leg2Type === 'CALL' ? parseFloat(trade.leg2Strike as any) : undefined);

    const tradeRecord: TradeRecord = {
      id: trade.id,
      timestamp: trade.closedAt?.toISOString() || trade.createdAt?.toISOString() || new Date().toISOString(),
      symbol: trade.symbol,
      strategy: trade.strategy,
      putStrike,
      callStrike,
      contracts: trade.contracts || 1,
      entryPremium: trade.entryPremiumTotal ? parseFloat(trade.entryPremiumTotal as any) : 0,
      exitPremium: trade.exitPrice ? parseFloat(trade.exitPrice as any) : 0,
      realizedPnl: trade.realizedPnl ? parseFloat(trade.realizedPnl as any) : 0,
      exitReason: trade.exitReason || 'unknown',
    };

    // Create hash and memo
    const tradeHash = hashTradeData(tradeRecord);
    const memoData = createTradeMemoProgramData(tradeRecord, tradeHash);

    // Build transaction
    const connection = getConnection();
    const transaction = new Transaction();

    // Add memo instruction
    transaction.add({
      keys: [{ pubkey: wallet.publicKey, isSigner: true, isWritable: true }],
      programId: MEMO_PROGRAM_ID,
      data: memoData,
    });

    // Get recent blockhash
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = wallet.publicKey;

    // Sign and send transaction
    const signature = await sendAndConfirmTransaction(connection, transaction, [wallet], {
      commitment: 'confirmed',
    });

    console.log(`[SolanaTradeRecorder] Trade ${tradeId} recorded on Solana: ${signature}`);

    // Update trade with signature
    await db
      .update(paperTrades)
      .set({ solanaSignature: signature })
      .where(eq(paperTrades.id, tradeId));

    return {
      success: true,
      signature,
      tradeHash,
    };
  } catch (error: any) {
    console.error('[SolanaTradeRecorder] Failed to record trade:', error);
    return {
      success: false,
      error: error.message || 'Failed to record trade on Solana',
    };
  }
}

/**
 * Record multiple trades on Solana (batch)
 */
export async function recordTradesOnSolana(tradeIds: string[]): Promise<Map<string, RecordResult>> {
  const results = new Map<string, RecordResult>();

  for (const tradeId of tradeIds) {
    const result = await recordTradeOnSolana(tradeId);
    results.set(tradeId, result);

    // Small delay between transactions to avoid rate limiting
    if (tradeIds.indexOf(tradeId) < tradeIds.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  return results;
}

/**
 * Get unrecorded closed trades (for batch recording)
 */
export async function getUnrecordedTrades(limit: number = 100): Promise<string[]> {
  if (!db) return [];

  const unrecorded = await db
    .select({ id: paperTrades.id })
    .from(paperTrades)
    .where(
      eq(paperTrades.solanaSignature, '') // No signature yet
    )
    .limit(limit);

  // Also check for null signatures
  const unrecordedNull = await db
    .select({ id: paperTrades.id })
    .from(paperTrades)
    .where(
      eq(paperTrades.status, 'closed')
    )
    .limit(limit);

  // Filter to only include closed/expired trades without signatures
  const allIds = new Set([...unrecorded.map(t => t.id), ...unrecordedNull.map(t => t.id)]);
  return Array.from(allIds);
}

/**
 * Check wallet balance
 */
export async function getWalletBalance(): Promise<{ balance: number; address: string } | null> {
  const wallet = getWalletKeypair();
  if (!wallet) return null;

  const connection = getConnection();
  const balance = await connection.getBalance(wallet.publicKey);

  return {
    balance: balance / LAMPORTS_PER_SOL,
    address: wallet.publicKey.toBase58(),
  };
}
