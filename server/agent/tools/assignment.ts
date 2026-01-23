/**
 * Assignment Handler
 *
 * Detects when short options are assigned (shares appear in account),
 * gathers intelligence, decides timing for liquidation, and executes.
 */

import { v4 as uuidv4 } from 'uuid';
import { getBroker, getBrokerForUser } from '../../broker';
import { logger } from '../logger';
import { kimiClient } from '../models/kimi';

// Track last known stock positions to detect new shares
let lastKnownStockPositions: Map<string, number> = new Map();

export interface AssignmentContext {
  symbol: string;
  shares: number;
  estimatedValue: number;
  currentPrice: number;
  fridayClose: number | null;
  futuresPrice: number | null;
  futuresChange: number | null;
  extendedHoursSpread: number | null;
  isExtendedHours: boolean;
  isPreMarket: boolean;
  timeUntilOpen: number; // minutes
}

export interface AssignmentDecision {
  action: 'SELL_NOW' | 'WAIT_OPEN' | 'WAIT_CONDITION';
  reasoning: string;
  targetPrice?: number;
}

/**
 * Check for new stock assignments and handle them
 * Multi-tenant: Pass userId for user-specific broker access
 */
export async function checkForAssignments(userId?: string): Promise<void> {
  const sessionId = uuidv4();

  try {
    // Multi-tenant: Use user-specific broker when userId provided
    let broker;
    if (userId) {
      broker = await getBrokerForUser(userId);
    } else {
      // Fallback for backwards compatibility (will be deprecated)
      broker = getBroker();
      console.warn('[Assignment] checkForAssignments called without userId - using shared broker (DEPRECATED)');
    }

    if (!broker.api || !broker.status.connected) {
      logger.log({ sessionId, type: 'SLEEP', message: 'Broker not connected - skipping assignment check' });
      return;
    }

    logger.log({ sessionId, type: 'WAKE', message: 'Checking for assignments...' });

    // Get current positions
    const positions = await broker.api.getPositions();

    // Filter for stock positions (not options)
    const stockPositions = positions.filter((p: any) => {
      const secType = p.contract?.secType || p.assetClass || p.secType;
      return secType === 'STK' || secType === 'stock';
    });

    // Check for new SPY shares (assignment indicator)
    for (const pos of stockPositions) {
      const symbol = pos.contract?.symbol || pos.ticker || pos.symbol;
      const qty = Math.abs(pos.quantity || pos.position || 0);

      if (symbol !== 'SPY') continue;

      const lastKnown = lastKnownStockPositions.get(symbol) || 0;

      if (qty > lastKnown) {
        const newShares = qty - lastKnown;
        logger.log({
          sessionId,
          type: 'ACTION',
          message: `ASSIGNMENT DETECTED: +${newShares} shares ${symbol}`,
        });

        // Handle the assignment
        await handleAssignment(sessionId, symbol, newShares, pos);
      }

      // Update tracking
      lastKnownStockPositions.set(symbol, qty);
    }

    logger.log({ sessionId, type: 'SLEEP', message: 'Assignment check complete' });

  } catch (error: any) {
    logger.log({ sessionId, type: 'ERROR', message: `Assignment check failed: ${error.message}` });
  }
}

/**
 * Handle a detected assignment
 */
async function handleAssignment(
  sessionId: string,
  symbol: string,
  shares: number,
  position: any
): Promise<void> {
  logger.log({
    sessionId,
    type: 'THINK',
    message: `Gathering intelligence for ${shares} shares ${symbol}...`,
  });

  // 1. Gather context
  const context = await gatherAssignmentContext(symbol, shares, position);

  logger.log({
    sessionId,
    type: 'DATA',
    message: `${symbol}=${context.currentPrice.toFixed(2)} futures=${context.futuresPrice?.toFixed(2) || 'N/A'} spread=${context.extendedHoursSpread?.toFixed(2) || 'N/A'} extHrs=${context.isExtendedHours}`,
  });

  // 2. Ask LLM for decision
  logger.log({ sessionId, type: 'ESCALATE', message: 'Consulting Kimi for sell timing...' });

  const decision = await kimiClient.decideAssignment(context, sessionId);

  logger.log({
    sessionId,
    type: 'DECIDE',
    message: `${decision.action}: ${decision.reasoning}`,
  });

  // 3. Execute if SELL_NOW
  if (decision.action === 'SELL_NOW') {
    await executeSellStock(sessionId, symbol, shares);
  } else {
    logger.log({
      sessionId,
      type: 'OBSERVE',
      message: `Waiting - will re-check. Action: ${decision.action}`,
    });
  }
}

/**
 * Gather context for assignment decision
 * Multi-tenant: Pass userId for user-specific broker access
 */
async function gatherAssignmentContext(
  symbol: string,
  shares: number,
  position: any,
  userId?: string
): Promise<AssignmentContext> {
  // Multi-tenant: Use user-specific broker when userId provided
  let broker;
  if (userId) {
    broker = await getBrokerForUser(userId);
  } else {
    // Fallback for backwards compatibility (will be deprecated)
    broker = getBroker();
    console.warn('[Assignment] gatherAssignmentContext called without userId - using shared broker (DEPRECATED)');
  }

  // Get current market data
  let currentPrice = position.marketValue / shares || 0;
  let bidAskSpread: number | null = null;

  try {
    if (broker.api) {
      const marketData = await broker.api.getMarketData(symbol);
      currentPrice = marketData.price || currentPrice;
      if (marketData.bid && marketData.ask) {
        bidAskSpread = marketData.ask - marketData.bid;
      }
    }
  } catch (e) {
    // Use position data as fallback
  }

  // Calculate time context
  const now = new Date();
  const etNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const hour = etNow.getHours();
  const minute = etNow.getMinutes();
  const dayOfWeek = etNow.getDay();

  // Extended hours: 4-8 PM or 4-9:30 AM
  const isAfterHours = hour >= 16 && hour < 20;
  const isPreMarket = hour >= 4 && (hour < 9 || (hour === 9 && minute < 30));
  const isExtendedHours = isAfterHours || isPreMarket;

  // Minutes until regular market open (9:30 AM ET)
  let timeUntilOpen = 0;
  if (hour < 9 || (hour === 9 && minute < 30)) {
    timeUntilOpen = (9 - hour) * 60 + (30 - minute);
  } else if (hour >= 16) {
    // After market close - next open is tomorrow (or Monday if weekend)
    const hoursUntilMidnight = 24 - hour;
    timeUntilOpen = hoursUntilMidnight * 60 + 9 * 60 + 30 - minute;
    if (dayOfWeek === 5) timeUntilOpen += 48 * 60; // Friday -> Monday
    if (dayOfWeek === 6) timeUntilOpen += 24 * 60; // Saturday -> Monday
  }

  // TODO: Add futures data source
  // For now, use current price as proxy
  const futuresPrice = currentPrice;
  const futuresChange = 0;

  // TODO: Get Friday close from historical data
  const fridayClose = currentPrice;

  return {
    symbol,
    shares,
    estimatedValue: shares * currentPrice,
    currentPrice,
    fridayClose,
    futuresPrice,
    futuresChange,
    extendedHoursSpread: bidAskSpread,
    isExtendedHours,
    isPreMarket,
    timeUntilOpen,
  };
}

/**
 * Execute stock sale
 * Multi-tenant: Pass userId for user-specific broker access
 */
async function executeSellStock(
  sessionId: string,
  symbol: string,
  shares: number,
  userId?: string
): Promise<void> {
  logger.log({
    sessionId,
    type: 'TOOL',
    message: `sell_stock | ${symbol} ${shares} shares MKT outsideRth=true`,
  });

  try {
    // Multi-tenant: Use user-specific broker when userId provided
    let broker;
    if (userId) {
      broker = await getBrokerForUser(userId);
    } else {
      // Fallback for backwards compatibility (will be deprecated)
      broker = getBroker();
      console.warn('[Assignment] executeSellStock called without userId - using shared broker (DEPRECATED)');
    }

    if (!broker.api) {
      throw new Error('Broker not connected');
    }

    // Place market order with extended hours enabled
    const result = await broker.api.placeStockOrder(symbol, 'SELL', shares, {
      orderType: 'MKT',
      tif: 'DAY',
      outsideRth: true,
    });

    if (result.status === 'submitted' || result.status === 'filled' || result.id) {
      logger.log({
        sessionId,
        type: 'ACTION',
        message: `SOLD ${shares} ${symbol} | orderId=${result.id || 'pending'} status=${result.status}`,
      });
    } else {
      logger.log({
        sessionId,
        type: 'ERROR',
        message: `Sell order rejected: ${result.status}`,
      });
    }

  } catch (error: any) {
    logger.log({
      sessionId,
      type: 'ERROR',
      message: `Failed to sell stock: ${error.message}`,
    });
  }
}

/**
 * Reset tracking (for testing)
 */
export function resetAssignmentTracking(): void {
  lastKnownStockPositions.clear();
}

/**
 * Initialize tracking with current positions
 * Multi-tenant: Pass userId for user-specific broker access
 */
export async function initializeAssignmentTracking(userId?: string): Promise<void> {
  try {
    // Multi-tenant: Use user-specific broker when userId provided
    let broker;
    if (userId) {
      broker = await getBrokerForUser(userId);
    } else {
      // Fallback for backwards compatibility (will be deprecated)
      broker = getBroker();
      console.warn('[Assignment] initializeAssignmentTracking called without userId - using shared broker (DEPRECATED)');
    }

    if (!broker.api) return;

    const positions = await broker.api.getPositions();
    const stockPositions = positions.filter((p: any) => {
      const secType = p.contract?.secType || p.assetClass || p.secType;
      return secType === 'STK' || secType === 'stock';
    });

    for (const pos of stockPositions) {
      const symbol = pos.contract?.symbol || pos.ticker || pos.symbol;
      const qty = Math.abs(pos.quantity || pos.position || 0);
      lastKnownStockPositions.set(symbol, qty);
    }

    console.log('[Assignment] Initialized tracking with', lastKnownStockPositions.size, 'stock positions');
  } catch (error: any) {
    console.error('[Assignment] Failed to initialize tracking:', error.message);
  }
}
