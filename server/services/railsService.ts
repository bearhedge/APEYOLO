/**
 * Rails Service
 *
 * Manages DeFi Rails and enforces trading rules.
 * Rails are permanent once created - cannot be modified, only replaced.
 */

import { createHash } from 'crypto';
import { db } from '../db';
import { defiRails, railViolations, navSnapshots } from '@shared/schema';
import { eq, and, desc, gte } from 'drizzle-orm';
import type {
  Rail,
  RailRules,
  Violation,
  ViolationType,
  EnforcementResult,
  CreateRailRequest,
  RailCreatedEventData,
  RailDeactivatedEventData,
  ViolationBlockedEventData,
} from '@shared/types/rails';
import { recordRailEvent } from './railEventService';

// ============================================
// Rail CRUD Operations
// ============================================

/**
 * Create a new DeFi Rail
 * Once created, rails are locked and cannot be modified
 */
export async function createRail(
  userId: string,
  request: CreateRailRequest
): Promise<Rail> {
  if (!db) {
    throw new Error('Database not available');
  }

  // Check if user already has an active rail
  const existingRail = await getActiveRail(userId);
  if (existingRail) {
    throw new Error('User already has an active rail. Rails cannot be modified - deactivate the existing one first.');
  }

  // Generate hash of rail rules for on-chain commitment
  const rulesHash = generateRailHash(request);

  const [rail] = await db
    .insert(defiRails)
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

  console.log(`[RailsService] Created rail ${rail.id} for user ${userId}`);

  // Record RAIL_CREATED event
  const eventData: RailCreatedEventData = {
    railId: rail.id,
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

  await recordRailEvent({
    userId,
    eventType: 'RAIL_CREATED',
    eventData,
    railId: rail.id,
  });

  return formatRail(rail);
}

/**
 * Get the active rail for a user
 */
export async function getActiveRail(userId: string): Promise<Rail | null> {
  if (!db) return null;

  const [rail] = await db
    .select()
    .from(defiRails)
    .where(and(
      eq(defiRails.userId, userId),
      eq(defiRails.isActive, true)
    ))
    .orderBy(desc(defiRails.createdAt))
    .limit(1);

  if (!rail) return null;

  return formatRail(rail);
}

/**
 * Get all rails for a user (including inactive)
 */
export async function getUserRails(userId: string): Promise<Rail[]> {
  if (!db) return [];

  const rails = await db
    .select()
    .from(defiRails)
    .where(eq(defiRails.userId, userId))
    .orderBy(desc(defiRails.createdAt));

  return rails.map(formatRail);
}

/**
 * Deactivate a rail (cannot delete - kept for audit trail)
 */
export async function deactivateRail(railId: string, userId: string, reason?: string): Promise<void> {
  if (!db) {
    throw new Error('Database not available');
  }

  await db
    .update(defiRails)
    .set({ isActive: false })
    .where(and(
      eq(defiRails.id, railId),
      eq(defiRails.userId, userId)
    ));

  console.log(`[RailsService] Deactivated rail ${railId}`);

  // Record RAIL_DEACTIVATED event
  const eventData: RailDeactivatedEventData = {
    railId,
    reason: reason || 'User deactivated rail',
  };

  await recordRailEvent({
    userId,
    eventType: 'RAIL_DEACTIVATED',
    eventData,
    railId,
  });
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
 * Validate a trade against the user's active rail
 * Returns enforcement result indicating if trade is allowed
 */
export async function enforceRail(
  userId: string,
  trade: TradeToValidate
): Promise<EnforcementResult> {
  const rail = await getActiveRail(userId);

  // No rail = no restrictions
  if (!rail) {
    return { allowed: true };
  }

  // Check 1: Symbol
  if (!rail.allowedSymbols.includes(trade.symbol)) {
    await recordViolation(rail.id, userId, {
      type: 'symbol',
      attempted: trade.symbol,
      limit: rail.allowedSymbols.join(','),
      tradeDetails: trade,
    });
    return {
      allowed: false,
      reason: `Symbol "${trade.symbol}" is not permitted. Allowed: ${rail.allowedSymbols.join(', ')}`,
      violation: {
        type: 'symbol',
        attempted: trade.symbol,
        limit: rail.allowedSymbols.join(','),
      },
    };
  }

  // Check 2: Strategy (must be SELL for credit strategies)
  if (trade.side !== rail.strategyType) {
    await recordViolation(rail.id, userId, {
      type: 'strategy',
      attempted: trade.side,
      limit: rail.strategyType,
      tradeDetails: trade,
    });
    return {
      allowed: false,
      reason: `Only ${rail.strategyType} strategies are permitted`,
      violation: {
        type: 'strategy',
        attempted: trade.side,
        limit: rail.strategyType,
      },
    };
  }

  // Check 3: Delta range
  if (trade.delta !== undefined) {
    if (trade.delta < rail.minDelta || trade.delta > rail.maxDelta) {
      await recordViolation(rail.id, userId, {
        type: 'delta',
        attempted: trade.delta.toString(),
        limit: `${rail.minDelta}-${rail.maxDelta}`,
        tradeDetails: trade,
      });
      return {
        allowed: false,
        reason: `Delta ${trade.delta.toFixed(2)} is outside allowed range (${rail.minDelta}-${rail.maxDelta})`,
        violation: {
          type: 'delta',
          attempted: trade.delta.toString(),
          limit: `${rail.minDelta}-${rail.maxDelta}`,
        },
      };
    }
  }

  // Check 4: Daily loss circuit breaker
  const dailyLossCheck = await checkDailyLossLimit(userId, rail);
  if (!dailyLossCheck.allowed) {
    await recordViolation(rail.id, userId, {
      type: 'daily_loss',
      attempted: dailyLossCheck.currentLoss?.toString() || 'unknown',
      limit: `${rail.maxDailyLossPercent * 100}%`,
      tradeDetails: trade,
    });
    return {
      allowed: false,
      reason: `Daily loss limit (${rail.maxDailyLossPercent * 100}%) has been reached. Trading suspended for the day.`,
      violation: {
        type: 'daily_loss',
        attempted: dailyLossCheck.currentLoss?.toString() || 'unknown',
        limit: `${rail.maxDailyLossPercent * 100}%`,
      },
    };
  }

  // Check 5: Trading time window (after 12 AM HKT)
  if (rail.tradingWindowStart) {
    const timeCheck = checkTradingWindow(rail.tradingWindowStart);
    if (!timeCheck.allowed) {
      return {
        allowed: false,
        reason: timeCheck.reason || 'Outside trading window',
      };
    }
  }

  return { allowed: true };
}

/**
 * Check if current time is within trading window
 * Trading allowed AFTER the start time (HKT)
 */
function checkTradingWindow(windowStart: string): { allowed: boolean; reason?: string } {
  const now = new Date();

  // Get current time in Hong Kong
  const hktTime = now.toLocaleString('en-US', {
    timeZone: 'Asia/Hong_Kong',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  // Parse times to minutes for comparison
  const parseTimeToMinutes = (timeStr: string): number => {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
  };

  const currentMinutes = parseTimeToMinutes(hktTime);
  const startMinutes = parseTimeToMinutes(windowStart);

  // Trading allowed if current time is AFTER start time
  // Example: windowStart = "00:00" (midnight), currentMinutes >= 0 is always true
  // This allows trading after midnight HKT
  if (currentMinutes < startMinutes) {
    return {
      allowed: false,
      reason: `Trading only allowed after ${windowStart} HKT (current: ${hktTime} HKT)`,
    };
  }

  return { allowed: true };
}

/**
 * Check if the user has exceeded their daily loss limit
 */
async function checkDailyLossLimit(
  userId: string,
  rail: Rail
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
  if (lossPercent >= rail.maxDailyLossPercent) {
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
 * Record a rail violation in the database
 */
export async function recordViolation(
  railId: string,
  userId: string,
  params: RecordViolationParams
): Promise<Violation> {
  if (!db) {
    throw new Error('Database not available');
  }

  // Generate hash for on-chain recording
  const violationData = {
    railId,
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
    .insert(railViolations)
    .values({
      userId,
      railId,
      violationType: params.type,
      attemptedValue: params.attempted,
      limitValue: params.limit,
      actionTaken: 'blocked',
      tradeDetails: params.tradeDetails as any,
      onChainHash: `0x${violationHash}`,
    })
    .returning();

  console.log(`[RailsService] Recorded violation: ${params.type} for user ${userId}`);

  // Record VIOLATION_BLOCKED event
  const violationEventData: ViolationBlockedEventData = {
    violationType: params.type,
    attemptedValue: params.attempted,
    limitValue: params.limit,
    tradeContext: params.tradeDetails as Record<string, unknown>,
  };

  await recordRailEvent({
    userId,
    eventType: 'VIOLATION_BLOCKED',
    eventData: violationEventData,
    railId,
    relatedViolationId: violation.id,
  });

  return formatViolation(violation);
}

/**
 * Get violations for a rail
 */
export async function getRailViolations(
  railId: string,
  limit = 100
): Promise<Violation[]> {
  if (!db) return [];

  const violations = await db
    .select()
    .from(railViolations)
    .where(eq(railViolations.railId, railId))
    .orderBy(desc(railViolations.createdAt))
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
    .from(railViolations)
    .where(eq(railViolations.userId, userId))
    .orderBy(desc(railViolations.createdAt))
    .limit(limit);

  return violations.map(formatViolation);
}

/**
 * Get violation count for this month
 */
export async function getMonthlyViolationCount(railId: string): Promise<number> {
  if (!db) return 0;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const violations = await db
    .select()
    .from(railViolations)
    .where(and(
      eq(railViolations.railId, railId),
      gte(railViolations.createdAt, monthStart)
    ));

  return violations.length;
}

// ============================================
// Solana Integration (Stubs)
// ============================================

/**
 * Commit rail hash to Solana
 * Returns transaction signature
 */
export async function commitRailToSolana(railId: string): Promise<{
  signature: string;
  slot: number;
}> {
  // TODO: Implement actual Solana transaction
  // For now, return mock data
  console.log(`[RailsService] Would commit rail ${railId} to Solana`);

  return {
    signature: 'mock_signature_' + railId,
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
  console.log(`[RailsService] Would record violation ${violationId} on Solana`);

  return {
    signature: 'mock_signature_' + violationId,
    slot: Date.now(),
  };
}

// ============================================
// Helper Functions
// ============================================

/**
 * Generate SHA256 hash of rail rules
 */
function generateRailHash(rules: RailRules): string {
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
 * Format database rail to API response
 */
function formatRail(dbRail: any): Rail {
  return {
    id: dbRail.id,
    userId: dbRail.userId,
    allowedSymbols: dbRail.allowedSymbols as string[],
    strategyType: dbRail.strategyType as 'SELL' | 'BUY',
    minDelta: parseFloat(dbRail.minDelta) || 0,
    maxDelta: parseFloat(dbRail.maxDelta) || 0,
    maxDailyLossPercent: parseFloat(dbRail.maxDailyLossPercent) || 0,
    noOvernightPositions: dbRail.noOvernightPositions,
    exitDeadline: dbRail.exitDeadline,
    tradingWindowStart: dbRail.tradingWindowStart,
    tradingWindowEnd: dbRail.tradingWindowEnd,
    isActive: dbRail.isActive,
    isLocked: dbRail.isLocked,
    onChainHash: dbRail.onChainHash,
    solanaSignature: dbRail.solanaSignature,
    solanaSlot: dbRail.solanaSlot,
    createdAt: dbRail.createdAt?.toISOString() || new Date().toISOString(),
  };
}

/**
 * Format database violation to API response
 */
function formatViolation(dbViolation: any): Violation {
  return {
    id: dbViolation.id,
    userId: dbViolation.userId,
    railId: dbViolation.railId,
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
