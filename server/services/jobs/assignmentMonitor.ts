/**
 * Assignment Monitor Job
 *
 * Detects when ITM options are assigned (shares appear in account),
 * then uses LLM-assisted strategy to liquidate shares in pre-market.
 *
 * Schedule: 4:05 AM ET Monday-Friday (right after pre-market opens)
 *
 * Flow:
 * 1. Detect new stock positions that appeared from assignment
 * 2. Match to recently expired ITM options in paperTrades
 * 3. Get current pre-market quote (bid/ask)
 * 4. Use LLM to decide optimal limit price
 * 5. Place limit order with outsideRth=true
 * 6. Monitor order status, adjust price if not filling
 * 7. Update paperTrades with assignment details
 */

import { db } from '../../db';
import { paperTrades, jobs } from '@shared/schema';
import { eq, and, lt, isNull } from 'drizzle-orm';
import { getBroker } from '../../broker';
import { ensureIbkrReady, placePaperStockOrder } from '../../broker/ibkr';
import { registerJobHandler, type JobResult } from '../jobExecutor';
import { getETTimeString } from '../marketCalendar';

// IBKR position type (runtime shape from IBKR API)
interface IbkrPosition {
  id: string;
  symbol: string;
  assetType: 'stock' | 'option';
  side: 'BUY' | 'SELL';
  qty: number;
  avg: number;
  mark?: number;
  upl?: number;
  iv?: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  margin?: number;
  openedAt?: string;
  status?: string;
}

// ============================================
// Types
// ============================================

interface AssignmentDetails {
  sharesAssigned: number;
  assignmentPrice: number;  // Strike price
  liquidationOrderId?: string;
  liquidationPrice?: number;
  liquidationTime?: string;
  netAssignmentPnl?: number;
  liquidationStatus: 'pending' | 'filled' | 'partial' | 'failed';
  attempts: number;
}

interface DetectedAssignment {
  stockPosition: IbkrPosition;
  originatingTrade: {
    id: string;
    symbol: string;
    strike: number;
    contracts: number;
    expiration: Date;
    entryPremiumTotal: number;
    legType: 'PUT' | 'CALL';
  };
  expectedShares: number;
  assignmentPrice: number;
}

interface LiquidationDecision {
  limitPrice: number;
  reasoning: string;
  urgency: 'immediate' | 'wait' | 'split';
  splitQuantity?: number;
}

interface JobResults {
  timestamp: string;
  timeET: string;
  stockPositionsFound: number;
  assignmentsDetected: DetectedAssignment[];
  liquidationAttempts: {
    symbol: string;
    shares: number;
    limitPrice: number;
    orderId?: string;
    status: string;
    fillPrice?: number;
    error?: string;
  }[];
  errors: string[];
  summary: string;
}

// ============================================
// Constants
// ============================================

const MAX_LIQUIDATION_ATTEMPTS = 5;
const ORDER_CHECK_INTERVAL_MS = 30000;  // Check every 30 seconds
const MAX_WAIT_TIME_MS = 60 * 60 * 1000;  // 1 hour max wait
const PRICE_ADJUSTMENT_PERCENT = 0.001;  // Lower price by 0.1% each attempt

// ============================================
// Helper Functions
// ============================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get current quote for a symbol using broker interface
 */
async function getQuote(symbol: string): Promise<{ bid: number; ask: number; last: number } | null> {
  try {
    const broker = getBroker();
    if (!broker.api) return null;

    // Try to get positions and use mark price
    const positions = await broker.api.getPositions() as unknown as IbkrPosition[];
    const stockPos = positions.find((p) => p.symbol === symbol && p.assetType === 'stock');
    if (stockPos && stockPos.mark) {
      return {
        bid: stockPos.mark * 0.999,  // Estimate bid slightly below mark
        ask: stockPos.mark * 1.001,  // Estimate ask slightly above mark
        last: stockPos.mark,
      };
    }

    return null;
  } catch (err) {
    console.error(`[AssignmentMonitor] Failed to get quote for ${symbol}:`, err);
    return null;
  }
}

/**
 * LLM-assisted decision for optimal liquidation price
 * For now, uses a simple heuristic. Can be enhanced with actual LLM call.
 */
async function getLiquidationDecision(
  symbol: string,
  shares: number,
  assignmentPrice: number,
  quote: { bid: number; ask: number; last: number },
  attemptNumber: number
): Promise<LiquidationDecision> {
  const spread = quote.ask - quote.bid;
  const spreadPercent = spread / quote.bid;
  const currentLoss = (quote.bid - assignmentPrice) * shares;

  console.log(`[AssignmentMonitor][LLM] Analyzing liquidation for ${symbol}:`);
  console.log(`  - Shares: ${shares}, Assignment price: $${assignmentPrice}`);
  console.log(`  - Bid: $${quote.bid.toFixed(2)}, Ask: $${quote.ask.toFixed(2)}, Spread: ${(spreadPercent * 100).toFixed(2)}%`);
  console.log(`  - Current potential loss: $${currentLoss.toFixed(2)}`);
  console.log(`  - Attempt #${attemptNumber}`);

  // Decision logic (can be replaced with actual LLM call)
  let limitPrice: number;
  let reasoning: string;
  const urgency: 'immediate' | 'wait' | 'split' = 'immediate';

  if (attemptNumber === 1) {
    // First attempt: try at bid price
    limitPrice = quote.bid;
    reasoning = 'First attempt: placing at current bid price for best execution';
  } else if (attemptNumber === 2) {
    // Second attempt: slightly below bid
    limitPrice = quote.bid * (1 - PRICE_ADJUSTMENT_PERCENT);
    reasoning = 'Second attempt: reducing price 0.1% below bid';
  } else if (attemptNumber === 3) {
    // Third attempt: more aggressive
    limitPrice = quote.bid * (1 - PRICE_ADJUSTMENT_PERCENT * 2);
    reasoning = 'Third attempt: reducing price 0.2% below bid';
  } else {
    // Later attempts: more aggressive price reduction
    const reduction = PRICE_ADJUSTMENT_PERCENT * attemptNumber;
    limitPrice = quote.bid * (1 - reduction);
    reasoning = `Attempt ${attemptNumber}: reducing price ${(reduction * 100).toFixed(1)}% below bid`;
  }

  // If spread is very wide (>0.5%), be more aggressive
  if (spreadPercent > 0.005) {
    limitPrice = Math.min(limitPrice, quote.bid * 0.998);
    reasoning += '. Wide spread detected - being aggressive';
  }

  // Round to 2 decimal places
  limitPrice = Math.round(limitPrice * 100) / 100;

  return {
    limitPrice,
    reasoning,
    urgency,
  };
}

/**
 * Check if an order has been filled using broker interface
 */
async function checkOrderFilled(orderId: string): Promise<{ filled: boolean; fillPrice?: number; partialQty?: number }> {
  try {
    const broker = getBroker();
    if (!broker.api) return { filled: false };

    // Try to get open orders - if our order isn't there, it's filled or cancelled
    const openOrders = await (broker.api as any).getOpenOrders?.();
    if (!openOrders) return { filled: false };

    const order = openOrders.find((o: any) => o.id === orderId);

    if (!order) {
      // Order not in open orders = likely filled or cancelled
      return { filled: true };
    }

    const status = (order.status || '').toLowerCase();
    if (status.includes('filled')) {
      return { filled: true, fillPrice: order.fillPrice };
    }
    if (status.includes('partial')) {
      return { filled: false, partialQty: order.filledQuantity };
    }

    return { filled: false };
  } catch (err) {
    console.error(`[AssignmentMonitor] Error checking order ${orderId}:`, err);
    return { filled: false };
  }
}

/**
 * Cancel an order using broker interface
 */
async function cancelOrderById(orderId: string): Promise<boolean> {
  try {
    const broker = getBroker();
    if (!broker.api) return false;

    const result = await (broker.api as any).cancelOrder?.(orderId);
    return result?.success ?? false;
  } catch (err) {
    console.error(`[AssignmentMonitor] Error cancelling order ${orderId}:`, err);
    return false;
  }
}

// ============================================
// Core Detection Logic
// ============================================

/**
 * Detect assignments by correlating stock positions with expired ITM options
 */
async function detectAssignments(): Promise<DetectedAssignment[]> {
  console.log('[AssignmentMonitor] Detecting assignments...');

  const detected: DetectedAssignment[] = [];

  try {
    // 1. Get current positions from IBKR
    await ensureIbkrReady();
    const broker = getBroker();
    if (!broker.api) {
      console.error('[AssignmentMonitor] No broker available');
      return [];
    }

    const positions = await broker.api.getPositions() as unknown as IbkrPosition[];
    const stockPositions = positions.filter((p) => p.assetType === 'stock' && p.qty > 0);

    console.log(`[AssignmentMonitor] Found ${stockPositions.length} stock positions`);

    if (stockPositions.length === 0) {
      return [];
    }

    // 2. Get recently expired ITM options from paperTrades
    if (!db) {
      console.error('[AssignmentMonitor] Database not available');
      return [];
    }

    const expiredTrades = await db.select()
      .from(paperTrades)
      .where(
        and(
          lt(paperTrades.expiration, new Date()),  // Expired
          eq(paperTrades.status, 'expired'),  // Status is expired (not already marked as exercised)
          isNull(paperTrades.assignmentDetails)  // Not already processed for assignment
        )
      );

    console.log(`[AssignmentMonitor] Found ${expiredTrades.length} recently expired trades to check`);

    // 3. Match stock positions to expired options
    for (const stockPos of stockPositions) {
      const symbol = stockPos.symbol.toUpperCase();

      // Find matching expired option
      for (const trade of expiredTrades) {
        if (trade.symbol.toUpperCase() !== symbol) continue;

        // Check if option was ITM at expiration
        const spotAtClose = trade.spotPriceAtClose ? parseFloat(String(trade.spotPriceAtClose)) : null;
        const leg1Strike = parseFloat(String(trade.leg1Strike));
        const leg1Type = trade.leg1Type as 'PUT' | 'CALL';

        let wasITM = false;
        if (spotAtClose) {
          if (leg1Type === 'PUT') {
            wasITM = spotAtClose < leg1Strike;  // PUT is ITM when spot < strike
          } else {
            wasITM = spotAtClose > leg1Strike;  // CALL is ITM when spot > strike
          }
        }

        if (!wasITM) {
          console.log(`[AssignmentMonitor] Trade ${trade.id} was OTM at expiration, skipping`);
          continue;
        }

        // Check if share count matches
        const expectedShares = trade.contracts * 100;
        if (stockPos.qty !== expectedShares) {
          console.log(`[AssignmentMonitor] Share count mismatch: position has ${stockPos.qty}, expected ${expectedShares}`);
          continue;
        }

        // Match found!
        console.log(`[AssignmentMonitor] ASSIGNMENT DETECTED: ${symbol} ${expectedShares} shares from ${leg1Type} @ $${leg1Strike}`);

        detected.push({
          stockPosition: stockPos,
          originatingTrade: {
            id: trade.id,
            symbol: trade.symbol,
            strike: leg1Strike,
            contracts: trade.contracts,
            expiration: trade.expiration,
            entryPremiumTotal: parseFloat(String(trade.entryPremiumTotal)),
            legType: leg1Type,
          },
          expectedShares,
          assignmentPrice: leg1Strike,
        });
      }
    }

    return detected;
  } catch (err) {
    console.error('[AssignmentMonitor] Error detecting assignments:', err);
    return [];
  }
}

// ============================================
// Core Liquidation Logic
// ============================================

/**
 * Attempt to liquidate assigned shares with monitoring loop
 */
async function liquidateAssignment(
  assignment: DetectedAssignment,
  results: JobResults
): Promise<void> {
  const { stockPosition, originatingTrade, assignmentPrice } = assignment;
  const symbol = stockPosition.symbol;
  const shares = stockPosition.qty;

  console.log(`[AssignmentMonitor] Starting liquidation for ${shares} shares of ${symbol}`);

  let attempt = 0;
  let orderId: string | undefined;
  let filled = false;
  let fillPrice: number | undefined;

  const startTime = Date.now();

  while (!filled && attempt < MAX_LIQUIDATION_ATTEMPTS && (Date.now() - startTime) < MAX_WAIT_TIME_MS) {
    attempt++;

    // Get current quote
    const quote = await getQuote(symbol);
    if (!quote || quote.bid <= 0) {
      console.error(`[AssignmentMonitor] Cannot get valid quote for ${symbol}, waiting...`);
      await sleep(ORDER_CHECK_INTERVAL_MS);
      continue;
    }

    // Get LLM decision for limit price
    const decision = await getLiquidationDecision(symbol, shares, assignmentPrice, quote, attempt);
    console.log(`[AssignmentMonitor] LLM Decision: limit=$${decision.limitPrice}, reason="${decision.reasoning}"`);

    // Cancel previous order if exists
    if (orderId) {
      console.log(`[AssignmentMonitor] Cancelling previous order ${orderId}...`);
      await cancelOrderById(orderId);
      await sleep(2000);  // Wait for cancellation
    }

    // Place new limit order using placePaperStockOrder
    try {
      const orderResult = await placePaperStockOrder({
        symbol,
        side: 'SELL',
        quantity: shares,
        orderType: 'LMT',
        limitPrice: decision.limitPrice,
        outsideRth: true,  // Enable pre-market trading
        tif: 'DAY',
      });

      if (orderResult?.id) {
        orderId = orderResult.id;
        console.log(`[AssignmentMonitor] Order placed: ${orderId} @ $${decision.limitPrice}`);

        results.liquidationAttempts.push({
          symbol,
          shares,
          limitPrice: decision.limitPrice,
          orderId,
          status: 'submitted',
        });
      } else {
        console.error(`[AssignmentMonitor] Order placement failed:`, orderResult);
        results.liquidationAttempts.push({
          symbol,
          shares,
          limitPrice: decision.limitPrice,
          status: 'failed',
          error: 'No order ID returned',
        });
        continue;
      }
    } catch (err) {
      console.error(`[AssignmentMonitor] Order placement error:`, err);
      results.errors.push(`Order error: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    // Monitor order status
    console.log(`[AssignmentMonitor] Monitoring order ${orderId}...`);
    const checkStartTime = Date.now();
    const checkDuration = Math.min(ORDER_CHECK_INTERVAL_MS * 3, MAX_WAIT_TIME_MS - (Date.now() - startTime));

    while ((Date.now() - checkStartTime) < checkDuration) {
      await sleep(10000);  // Check every 10 seconds

      const orderStatus = await checkOrderFilled(orderId);
      if (orderStatus.filled) {
        filled = true;
        fillPrice = orderStatus.fillPrice || decision.limitPrice;
        console.log(`[AssignmentMonitor] ORDER FILLED! Price: $${fillPrice}`);
        break;
      }

      if (orderStatus.partialQty) {
        console.log(`[AssignmentMonitor] Partial fill: ${orderStatus.partialQty} shares`);
      }
    }

    if (!filled) {
      console.log(`[AssignmentMonitor] Order not filled after ${Math.round((Date.now() - checkStartTime) / 1000)}s, adjusting price...`);
    }
  }

  // Update results
  const lastAttempt = results.liquidationAttempts[results.liquidationAttempts.length - 1];
  if (lastAttempt) {
    lastAttempt.status = filled ? 'filled' : 'pending';
    lastAttempt.fillPrice = fillPrice;
  }

  // Update paperTrades with assignment details
  const assignmentDetails: AssignmentDetails = {
    sharesAssigned: shares,
    assignmentPrice,
    liquidationOrderId: orderId,
    liquidationPrice: fillPrice,
    liquidationTime: filled ? new Date().toISOString() : undefined,
    netAssignmentPnl: fillPrice ? (fillPrice - assignmentPrice) * shares : undefined,
    liquidationStatus: filled ? 'filled' : 'pending',
    attempts: attempt,
  };

  if (!db) {
    results.errors.push('Database not available for update');
    return;
  }

  try {
    await db.update(paperTrades)
      .set({
        status: 'exercised',
        exitReason: 'assignment',
        assignmentDetails: assignmentDetails as unknown as Record<string, unknown>,
        closedAt: filled ? new Date() : null,
      })
      .where(eq(paperTrades.id, originatingTrade.id));

    console.log(`[AssignmentMonitor] Updated trade ${originatingTrade.id} with assignment details`);
  } catch (err) {
    console.error(`[AssignmentMonitor] Failed to update trade:`, err);
    results.errors.push(`DB update error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ============================================
// Main Job Execution
// ============================================

export async function executeAssignmentMonitor(): Promise<JobResult> {
  const now = new Date();
  const results: JobResults = {
    timestamp: now.toISOString(),
    timeET: getETTimeString(now),
    stockPositionsFound: 0,
    assignmentsDetected: [],
    liquidationAttempts: [],
    errors: [],
    summary: '',
  };

  console.log(`[AssignmentMonitor] Starting at ${results.timeET} ET...`);

  try {
    // 1. Detect assignments
    const assignments = await detectAssignments();
    results.assignmentsDetected = assignments;

    if (assignments.length === 0) {
      results.summary = 'No assignments detected';
      console.log('[AssignmentMonitor] No assignments detected. Job complete.');
      return {
        success: true,
        reason: results.summary,
        data: results,
      };
    }

    console.log(`[AssignmentMonitor] Detected ${assignments.length} assignment(s)`);

    // 2. Liquidate each assignment
    for (const assignment of assignments) {
      await liquidateAssignment(assignment, results);
    }

    // 3. Generate summary
    const filledCount = results.liquidationAttempts.filter(a => a.status === 'filled').length;
    const pendingCount = results.liquidationAttempts.filter(a => a.status === 'pending').length;
    const failedCount = results.liquidationAttempts.filter(a => a.status === 'failed').length;

    results.summary = `Processed ${assignments.length} assignment(s): ${filledCount} filled, ${pendingCount} pending, ${failedCount} failed`;
    console.log(`[AssignmentMonitor] ${results.summary}`);

    return {
      success: results.errors.length === 0,
      reason: results.summary,
      data: results,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[AssignmentMonitor] Fatal error:', errorMsg);
    results.errors.push(errorMsg);
    results.summary = `Job failed: ${errorMsg}`;

    return {
      success: false,
      reason: results.summary,
      error: errorMsg,
      data: results,
    };
  }
}

// ============================================
// Job Registration
// ============================================

/**
 * Initialize the job handler (registers with jobExecutor)
 */
export function initAssignmentMonitorJob(): void {
  console.log('[AssignmentMonitor] Initializing job handler...');

  registerJobHandler({
    id: 'assignment-monitor',
    name: 'Assignment Monitor',
    description: 'Detects option assignments and auto-liquidates shares in pre-market',
    execute: executeAssignmentMonitor,
  });

  console.log('[AssignmentMonitor] Job handler registered');
}

/**
 * Create the job in the database if it doesn't exist
 * Schedule: 4:05 AM ET Monday-Friday (right after pre-market opens)
 */
export async function ensureAssignmentMonitorJob(): Promise<void> {
  if (!db) return;

  try {
    const [existingJob] = await db.select().from(jobs).where(eq(jobs.id, 'assignment-monitor')).limit(1);

    if (!existingJob) {
      console.log('[AssignmentMonitor] Creating job in database (4:05 AM ET)...');
      await db.insert(jobs).values({
        id: 'assignment-monitor',
        name: 'Assignment Monitor',
        description: 'Detects option assignments and auto-liquidates shares in pre-market at 4:05 AM ET',
        type: 'assignment-monitor',
        schedule: '5 4 * * 1-5',  // 4:05 AM ET on weekdays
        timezone: 'America/New_York',
        enabled: true,
        config: {
          maxAttempts: MAX_LIQUIDATION_ATTEMPTS,
          checkIntervalMs: ORDER_CHECK_INTERVAL_MS,
        },
      });
      console.log('[AssignmentMonitor] Job created in database');
    } else {
      console.log('[AssignmentMonitor] Job already exists in database');
    }
  } catch (err) {
    console.error('[AssignmentMonitor] Error ensuring job exists:', err);
  }
}
