/**
 * Mandate Service
 *
 * Manages trading mandates and enforces trading rules.
 * Mandates are permanent once created - cannot be modified, only replaced.
 */

import { createHash } from 'crypto';
import { db } from '../db';
import { tradingMandates, mandateViolations, navSnapshots } from '@shared/schema';
import { eq, and, desc, gte } from 'drizzle-orm';
import type {
  Mandate,
  MandateRules,
  Violation,
  ViolationType,
  EnforcementResult,
  CreateMandateRequest,
  MandateValidation,
} from '@shared/types/mandate';

// ============================================
// Mandate CRUD Operations
// ============================================

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

  return formatMandate(mandate);
}

/**
 * Get the active mandate for a user
 */
export async function getActiveMandate(userId: string): Promise<Mandate | null> {
  if (!db) return null;

  const [mandate] = await db
    .select()
    .from(tradingMandates)
    .where(and(
      eq(tradingMandates.userId, userId),
      eq(tradingMandates.isActive, true)
    ))
    .orderBy(desc(tradingMandates.createdAt))
    .limit(1);

  if (!mandate) return null;

  return formatMandate(mandate);
}

/**
 * Get all mandates for a user (including inactive)
 */
export async function getUserMandates(userId: string): Promise<Mandate[]> {
  if (!db) return [];

  const mandates = await db
    .select()
    .from(tradingMandates)
    .where(eq(tradingMandates.userId, userId))
    .orderBy(desc(tradingMandates.createdAt));

  return mandates.map(formatMandate);
}

/**
 * Deactivate a mandate (cannot delete - kept for audit trail)
 */
export async function deactivateMandate(mandateId: string, userId: string): Promise<void> {
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
}

// ============================================
// Trade Enforcement
// ============================================

interface TradeToValidate {
  symbol: string;
  side: 'BUY' | 'SELL';
  delta?: number;
  contracts?: number;
  expiration?: Date;
}

/**
 * Validate a trade against the user's active mandate
 * Returns enforcement result indicating if trade is allowed
 */
export async function enforceMandate(
  userId: string,
  trade: TradeToValidate
): Promise<EnforcementResult> {
  const mandate = await getActiveMandate(userId);

  // No mandate = no restrictions
  if (!mandate) {
    return { allowed: true };
  }

  // Check 1: Symbol
  if (!mandate.allowedSymbols.includes(trade.symbol)) {
    await recordViolation(mandate.id, userId, {
      type: 'symbol',
      attempted: trade.symbol,
      limit: mandate.allowedSymbols.join(','),
      tradeDetails: trade,
    });
    return {
      allowed: false,
      reason: `Symbol "${trade.symbol}" is not permitted. Allowed: ${mandate.allowedSymbols.join(', ')}`,
      violation: {
        type: 'symbol',
        attempted: trade.symbol,
        limit: mandate.allowedSymbols.join(','),
      },
    };
  }

  // Check 2: Strategy (must be SELL for credit strategies)
  if (trade.side !== mandate.strategyType) {
    await recordViolation(mandate.id, userId, {
      type: 'strategy',
      attempted: trade.side,
      limit: mandate.strategyType,
      tradeDetails: trade,
    });
    return {
      allowed: false,
      reason: `Only ${mandate.strategyType} strategies are permitted`,
      violation: {
        type: 'strategy',
        attempted: trade.side,
        limit: mandate.strategyType,
      },
    };
  }

  // Check 3: Delta range
  if (trade.delta !== undefined) {
    if (trade.delta < mandate.minDelta || trade.delta > mandate.maxDelta) {
      await recordViolation(mandate.id, userId, {
        type: 'delta',
        attempted: trade.delta.toString(),
        limit: `${mandate.minDelta}-${mandate.maxDelta}`,
        tradeDetails: trade,
      });
      return {
        allowed: false,
        reason: `Delta ${trade.delta.toFixed(2)} is outside allowed range (${mandate.minDelta}-${mandate.maxDelta})`,
        violation: {
          type: 'delta',
          attempted: trade.delta.toString(),
          limit: `${mandate.minDelta}-${mandate.maxDelta}`,
        },
      };
    }
  }

  // Check 4: Daily loss circuit breaker
  const dailyLossCheck = await checkDailyLossLimit(userId, mandate);
  if (!dailyLossCheck.allowed) {
    await recordViolation(mandate.id, userId, {
      type: 'daily_loss',
      attempted: dailyLossCheck.currentLoss?.toString() || 'unknown',
      limit: `${mandate.maxDailyLossPercent * 100}%`,
      tradeDetails: trade,
    });
    return {
      allowed: false,
      reason: `Daily loss limit (${mandate.maxDailyLossPercent * 100}%) has been reached. Trading suspended for the day.`,
      violation: {
        type: 'daily_loss',
        attempted: dailyLossCheck.currentLoss?.toString() || 'unknown',
        limit: `${mandate.maxDailyLossPercent * 100}%`,
      },
    };
  }

  return { allowed: true };
}

/**
 * Check if the user has exceeded their daily loss limit
 */
async function checkDailyLossLimit(
  userId: string,
  mandate: Mandate
): Promise<{ allowed: boolean; currentLoss?: number }> {
  if (!db) return { allowed: true };

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

  // Get today's opening NAV
  const [openingSnapshot] = await db
    .select()
    .from(navSnapshots)
    .where(and(
      eq(navSnapshots.userId, userId),
      eq(navSnapshots.date, today),
      eq(navSnapshots.snapshotType, 'opening')
    ))
    .limit(1);

  if (!openingSnapshot) {
    // No opening snapshot = can't calculate loss, allow trading
    return { allowed: true };
  }

  // Get most recent closing snapshot
  const [closingSnapshot] = await db
    .select()
    .from(navSnapshots)
    .where(eq(navSnapshots.userId, userId))
    .orderBy(desc(navSnapshots.date))
    .limit(1);

  if (!closingSnapshot) {
    return { allowed: true };
  }

  const openingNav = parseFloat(openingSnapshot.nav as any) || 0;
  const currentNav = parseFloat(closingSnapshot.nav as any) || 0;

  if (openingNav <= 0) {
    return { allowed: true };
  }

  const lossPercent = (openingNav - currentNav) / openingNav;

  // If loss exceeds limit, block trading
  if (lossPercent >= mandate.maxDailyLossPercent) {
    return {
      allowed: false,
      currentLoss: lossPercent,
    };
  }

  return { allowed: true };
}

// ============================================
// Violation Recording
// ============================================

interface RecordViolationParams {
  type: ViolationType;
  attempted: string;
  limit: string;
  tradeDetails?: unknown;
}

/**
 * Record a mandate violation in the database
 */
export async function recordViolation(
  mandateId: string,
  userId: string,
  params: RecordViolationParams
): Promise<Violation> {
  if (!db) {
    throw new Error('Database not available');
  }

  // Generate hash for on-chain recording
  const violationData = {
    mandateId,
    userId,
    type: params.type,
    attempted: params.attempted,
    limit: params.limit,
    timestamp: new Date().toISOString(),
  };
  const violationHash = createHash('sha256')
    .update(JSON.stringify(violationData))
    .digest('hex');

  const [violation] = await db
    .insert(mandateViolations)
    .values({
      userId,
      mandateId,
      violationType: params.type,
      attemptedValue: params.attempted,
      limitValue: params.limit,
      actionTaken: 'blocked',
      tradeDetails: params.tradeDetails as any,
      onChainHash: `0x${violationHash}`,
    })
    .returning();

  console.log(`[MandateService] Recorded violation: ${params.type} for user ${userId}`);

  return formatViolation(violation);
}

/**
 * Get violations for a mandate
 */
export async function getMandateViolations(
  mandateId: string,
  limit = 100
): Promise<Violation[]> {
  if (!db) return [];

  const violations = await db
    .select()
    .from(mandateViolations)
    .where(eq(mandateViolations.mandateId, mandateId))
    .orderBy(desc(mandateViolations.createdAt))
    .limit(limit);

  return violations.map(formatViolation);
}

/**
 * Get all violations for a user
 */
export async function getUserViolations(
  userId: string,
  limit = 100
): Promise<Violation[]> {
  if (!db) return [];

  const violations = await db
    .select()
    .from(mandateViolations)
    .where(eq(mandateViolations.userId, userId))
    .orderBy(desc(mandateViolations.createdAt))
    .limit(limit);

  return violations.map(formatViolation);
}

/**
 * Get violation count for this month
 */
export async function getMonthlyViolationCount(mandateId: string): Promise<number> {
  if (!db) return 0;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const violations = await db
    .select()
    .from(mandateViolations)
    .where(and(
      eq(mandateViolations.mandateId, mandateId),
      gte(mandateViolations.createdAt, monthStart)
    ));

  return violations.length;
}

// ============================================
// Solana Integration (Stubs)
// ============================================

/**
 * Commit mandate hash to Solana
 * Returns transaction signature
 */
export async function commitMandateToSolana(mandateId: string): Promise<{
  signature: string;
  slot: number;
}> {
  // TODO: Implement actual Solana transaction
  // For now, return mock data
  console.log(`[MandateService] Would commit mandate ${mandateId} to Solana`);

  return {
    signature: 'mock_signature_' + mandateId,
    slot: Date.now(),
  };
}

/**
 * Record violation on Solana
 * Returns transaction signature
 */
export async function recordViolationOnSolana(violationId: string): Promise<{
  signature: string;
  slot: number;
}> {
  // TODO: Implement actual Solana transaction
  // For now, return mock data
  console.log(`[MandateService] Would record violation ${violationId} on Solana`);

  return {
    signature: 'mock_signature_' + violationId,
    slot: Date.now(),
  };
}

// ============================================
// Helper Functions
// ============================================

/**
 * Generate SHA256 hash of mandate rules
 */
function generateMandateHash(rules: MandateRules): string {
  const rulesObject = {
    allowedSymbols: rules.allowedSymbols.sort(), // Sort for consistency
    strategyType: rules.strategyType,
    minDelta: rules.minDelta,
    maxDelta: rules.maxDelta,
    maxDailyLossPercent: rules.maxDailyLossPercent,
    noOvernightPositions: rules.noOvernightPositions,
    exitDeadline: rules.exitDeadline,
  };

  return createHash('sha256')
    .update(JSON.stringify(rulesObject))
    .digest('hex');
}

/**
 * Format database mandate to API response
 */
function formatMandate(dbMandate: any): Mandate {
  return {
    id: dbMandate.id,
    userId: dbMandate.userId,
    allowedSymbols: dbMandate.allowedSymbols as string[],
    strategyType: dbMandate.strategyType as 'SELL' | 'BUY',
    minDelta: parseFloat(dbMandate.minDelta) || 0,
    maxDelta: parseFloat(dbMandate.maxDelta) || 0,
    maxDailyLossPercent: parseFloat(dbMandate.maxDailyLossPercent) || 0,
    noOvernightPositions: dbMandate.noOvernightPositions,
    exitDeadline: dbMandate.exitDeadline,
    tradingWindowStart: dbMandate.tradingWindowStart,
    tradingWindowEnd: dbMandate.tradingWindowEnd,
    isActive: dbMandate.isActive,
    isLocked: dbMandate.isLocked,
    onChainHash: dbMandate.onChainHash,
    solanaSignature: dbMandate.solanaSignature,
    solanaSlot: dbMandate.solanaSlot,
    createdAt: dbMandate.createdAt?.toISOString() || new Date().toISOString(),
  };
}

/**
 * Format database violation to API response
 */
function formatViolation(dbViolation: any): Violation {
  return {
    id: dbViolation.id,
    userId: dbViolation.userId,
    mandateId: dbViolation.mandateId,
    violationType: dbViolation.violationType as ViolationType,
    attemptedValue: dbViolation.attemptedValue,
    limitValue: dbViolation.limitValue,
    actionTaken: dbViolation.actionTaken as 'blocked' | 'warning',
    tradeDetails: dbViolation.tradeDetails,
    onChainHash: dbViolation.onChainHash,
    solanaSignature: dbViolation.solanaSignature,
    solanaSlot: dbViolation.solanaSlot,
    createdAt: dbViolation.createdAt?.toISOString() || new Date().toISOString(),
  };
}
