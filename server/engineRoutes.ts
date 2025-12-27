// @ts-nocheck
// TODO: Add proper null checks for db and broker.api
/**
 * Engine API Routes
 * Provides endpoints for the 5-step trading engine integration with IBKR
 */

import { Router } from "express";
import { TradingEngine, EngineError } from "./engine/index";
import { getBroker, getBrokerWithStatus, getBrokerForUser } from "./broker/index";
import { ensureIbkrReady, placePaperOptionOrder, placeOptionOrderWithStop, getIbkrDiagnostics } from "./broker/ibkr";
import { storage } from "./storage";
import { engineScheduler, SchedulerConfig } from "./services/engineScheduler";
import { requireAuth } from "./auth";
import { z } from "zod";
import { adaptTradingDecision } from "./engine/adapter";
import { db } from "./db";
import { paperTrades, orders } from "../shared/schema";
import { enforceMandate } from "./services/mandateService";
import type { EngineAnalyzeResponse, TradeProposal, RiskProfile } from "../shared/types/engine";

const router = Router();

// Guard Rails Configuration
export interface GuardRails {
  // Delta Limits
  maxDelta: number;
  minDelta: number;

  // Position Limits
  maxPositionsPerDay: number;
  maxContractsPerTrade: number;

  // Risk Limits
  mandatoryStopLoss: boolean;
  stopLossMultiplier: number; // Multiplier of premium received
  maxDailyLoss: number; // Percentage of account

  // Time Restrictions
  tradingWindow: {
    start: string; // HH:MM format
    end: string;   // HH:MM format
    timezone: string;
  };

  // Strategy Constraints
  allowedStrategies: string[];
  expirationDays: number[]; // Days to expiration allowed (0 for 0DTE)
}

// Default Guard Rails
const DEFAULT_GUARD_RAILS: GuardRails = {
  maxDelta: 0.35, // Aligned with step3 target range [0.25, 0.35]
  minDelta: 0.05,
  maxPositionsPerDay: 10,
  maxContractsPerTrade: 5,
  mandatoryStopLoss: true,
  stopLossMultiplier: 2.0,
  maxDailyLoss: 0.02,
  tradingWindow: {
    start: "09:30",
    end: "16:00",
    timezone: "America/New_York"
  },
  allowedStrategies: ["STRANGLE", "PUT", "CALL"],
  expirationDays: [0]
};

// Engine instance (singleton)
let engineInstance: TradingEngine | null = null;
let currentGuardRails = { ...DEFAULT_GUARD_RAILS };

// Engine timeout - increased to 180s to allow for slow IBKR option chain fetches
const ENGINE_TIMEOUT_MS = 180000;

/**
 * Create a timeout promise for wrapping async operations
 */
function createTimeoutPromise(ms: number, operation: string): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`${operation} timed out after ${ms / 1000} seconds`)), ms)
  );
}

// Supported symbols and their expiration modes
export type TradingSymbol = 'SPY' | 'ARM';
export type ExpirationMode = '0DTE' | 'WEEKLY';

// Symbol configurations
export const SYMBOL_CONFIG: Record<TradingSymbol, { name: string; expirationMode: ExpirationMode; description: string }> = {
  SPY: { name: 'SPY', expirationMode: '0DTE', description: 'S&P 500 ETF (Daily 0DTE)' },
  ARM: { name: 'ARM', expirationMode: 'WEEKLY', description: 'ARM Holdings (Weekly Friday)' },
};

// Engine configuration schema
const engineConfigSchema = z.object({
  riskProfile: z.enum(['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE']).optional(),
  underlyingSymbol: z.enum(['SPY', 'ARM']).optional().default('SPY'),
  expirationMode: z.enum(['0DTE', 'WEEKLY']).optional(), // Auto-determined from symbol if not set
  executionMode: z.enum(['manual', 'auto']).optional().default('manual'),
  guardRails: z.object({
    maxDelta: z.number().min(0).max(1).optional(),
    minDelta: z.number().min(0).max(1).optional(),
    maxPositionsPerDay: z.number().min(1).optional(),
    maxContractsPerTrade: z.number().min(1).optional(),
    stopLossMultiplier: z.number().min(1).optional(),
    maxDailyLoss: z.number().min(0).max(1).optional(),
  }).optional()
});

/**
 * Get time components reliably in a specific timezone using Intl.DateTimeFormat.formatToParts()
 * This works correctly regardless of the server's local timezone
 */
function getTimeComponentsInTimezone(
  date: Date,
  timezone: string
): { hour: number; minute: number; dayOfWeek: number } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
    hour12: false
  });

  const parts = formatter.formatToParts(date);
  let hour = 0, minute = 0, dayOfWeek = 0;

  for (const part of parts) {
    if (part.type === 'hour') hour = parseInt(part.value, 10);
    if (part.type === 'minute') minute = parseInt(part.value, 10);
    if (part.type === 'weekday') {
      const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      dayOfWeek = dayMap[part.value] ?? 0;
    }
  }

  // Handle midnight edge case (hour12: false returns '24' for midnight in some locales)
  if (hour === 24) hour = 0;

  return { hour, minute, dayOfWeek };
}

// Context types for trading window
type TradingContext = 'WEEKEND' | 'PRE_WINDOW' | 'TRADING' | 'POST_WINDOW';

interface TradingWindowResult {
  allowed: boolean;
  reason?: string;
  context: TradingContext;
  minutesRemaining?: number;
  nextSession?: string;
}

// Format time for display (e.g., "11:00 AM")
function formatTime(hour: number, minute: number): string {
  const h = hour % 12 || 12;
  const m = minute.toString().padStart(2, '0');
  const ampm = hour < 12 ? 'AM' : 'PM';
  return `${h}:${m} ${ampm}`;
}

// Get next trading day
function getNextTradingDay(dayOfWeek: number): string {
  if (dayOfWeek === 5) return 'Mon'; // Friday → Monday
  if (dayOfWeek === 6) return 'Mon'; // Saturday → Monday
  if (dayOfWeek === 0) return 'Mon'; // Sunday → Monday
  return 'Tomorrow';
}

// Check if we're within trading window with smart context messages
function isWithinTradingWindow(): TradingWindowResult {
  const now = new Date();
  const timezone = currentGuardRails.tradingWindow.timezone;

  // Get time components reliably in the target timezone
  const { hour: currentHour, minute: currentMinute, dayOfWeek } = getTimeComponentsInTimezone(now, timezone);

  const [startHour, startMinute] = currentGuardRails.tradingWindow.start.split(':').map(Number);
  const [endHour, endMinute] = currentGuardRails.tradingWindow.end.split(':').map(Number);

  const currentMinutes = currentHour * 60 + currentMinute;
  const startMinutes = startHour * 60 + startMinute;
  const endMinutes = endHour * 60 + endMinute;

  // Weekday check disabled for testing - allow any day
  // const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
  const startTimeStr = formatTime(startHour, startMinute);
  const endTimeStr = formatTime(endHour, endMinute);

  // Weekend check disabled for testing
  // if (!isWeekday) {
  //   const nextDay = getNextTradingDay(dayOfWeek);
  //   return {
  //     allowed: false,
  //     context: 'WEEKEND',
  //     reason: `Weekend - Next session: ${nextDay} ${startTimeStr} ET`,
  //     nextSession: `${nextDay} ${startTimeStr} ET`
  //   };
  // }

  // Before trading window
  if (currentMinutes < startMinutes) {
    const minsUntil = startMinutes - currentMinutes;
    if (minsUntil <= 60) {
      return {
        allowed: false,
        context: 'PRE_WINDOW',
        reason: `Pre-market - Trading begins in ${minsUntil} min`,
        nextSession: `Today ${startTimeStr} ET`
      };
    }
    return {
      allowed: false,
      context: 'PRE_WINDOW',
      reason: `Pre-market - Trading begins at ${startTimeStr} ET`,
      nextSession: `Today ${startTimeStr} ET`
    };
  }

  // After trading window
  if (currentMinutes >= endMinutes) {
    const nextDay = dayOfWeek === 5 ? 'Mon' : 'Tomorrow';
    return {
      allowed: false,
      context: 'POST_WINDOW',
      reason: `Session closed - Next: ${nextDay} ${startTimeStr} ET`,
      nextSession: `${nextDay} ${startTimeStr} ET`
    };
  }

  // Within trading window
  const minsRemaining = endMinutes - currentMinutes;
  let reason = `Trading active - ${minsRemaining} min remaining`;
  if (minsRemaining <= 5) {
    reason = `Last call - ${minsRemaining} min remaining`;
  } else if (minsRemaining <= 15) {
    reason = `Closing soon - ${minsRemaining} min remaining`;
  }

  return {
    allowed: true,
    context: 'TRADING',
    reason,
    minutesRemaining: minsRemaining
  };
}


// POST /api/engine/execute - Run the 5-step decision process
router.post('/execute', requireAuth, async (req, res) => {
  try {
    // Accept configurable parameters from UI
    const { riskTier, stopMultiplier } = req.body || {};

    // Get symbol from query params or body, default to SPY
    const requestedSymbol = ((req.query.symbol as string) || req.body?.symbol || 'SPY').toUpperCase() as TradingSymbol;
    const symbol = SYMBOL_CONFIG[requestedSymbol] ? requestedSymbol : 'SPY';
    const symbolConfig = SYMBOL_CONFIG[symbol];
    const expirationMode = symbolConfig.expirationMode;

    // Map riskTier to riskProfile
    const riskProfileMap: Record<string, 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE'> = {
      'conservative': 'CONSERVATIVE',
      'balanced': 'BALANCED',
      'aggressive': 'AGGRESSIVE'
    };
    const riskProfile = riskProfileMap[riskTier] || 'BALANCED';

    // Update stopLossMultiplier if provided (2, 3, or 4)
    if (stopMultiplier && [2, 3, 4].includes(stopMultiplier)) {
      currentGuardRails.stopLossMultiplier = stopMultiplier;
    }

    // Multi-tenant: Get broker for the authenticated user
    const broker = await getBrokerForUser(req.user!.id);

    // Ensure IBKR is ready if using it
    if (broker.status.provider === 'ibkr') {
      await ensureIbkrReady();
    }

    // Check trading window - but don't block analysis, just note it
    const tradingWindow = isWithinTradingWindow();

    // Get account info
    const account = await broker.api.getAccount();

    // Get current underlying price for the engine
    let underlyingPrice = symbol === 'SPY' ? 450 : 150; // Defaults
    try {
      const { getMarketData } = await import('./services/marketDataService.js');
      const marketData = await getMarketData(symbol);
      underlyingPrice = marketData.price;
    } catch (error) {
      console.error(`[Engine] Error fetching ${symbol} price:`, error);
    }

    // Create or get engine instance - recreate if symbol or risk profile changed
    const needNewInstance = !engineInstance ||
      engineInstance['config'].riskProfile !== riskProfile ||
      engineInstance['config'].underlyingSymbol !== symbol;

    if (needNewInstance) {
      engineInstance = new TradingEngine({
        riskProfile,
        underlyingSymbol: symbol,
        expirationMode,
        underlyingPrice,
        mockMode: broker.status.provider === 'mock'
      });
    } else {
      // Update underlying price
      engineInstance['config'].underlyingPrice = underlyingPrice;
    }

    // Execute the 5-step decision process with timeout protection
    const decision = await Promise.race([
      engineInstance.executeTradingDecision({
        buyingPower: account.buyingPower,
        cashBalance: account.totalCash,
        netLiquidation: account.netLiquidation,  // Use actual NAV for 2% rule, not leveraged buying power
        currentPositions: 0 // TODO: Get actual open positions count
      }),
      createTimeoutPromise(ENGINE_TIMEOUT_MS, 'Engine execution')
    ]);

    // Apply guard rails validation
    let guardRailViolations = [];

    // Check position sizing
    if (decision.positionSize && decision.positionSize.contracts > currentGuardRails.maxContractsPerTrade) {
      guardRailViolations.push(`Position size (${decision.positionSize.contracts}) exceeds max contracts per trade (${currentGuardRails.maxContractsPerTrade})`);
    }

    // Check delta limits if we have strike selection
    if (decision.strikes) {
      if (decision.strikes.putStrike && Math.abs(decision.strikes.putStrike.delta) > currentGuardRails.maxDelta) {
        guardRailViolations.push(`Put delta (${Math.abs(decision.strikes.putStrike.delta)}) exceeds max delta (${currentGuardRails.maxDelta})`);
      }
      if (decision.strikes.callStrike && Math.abs(decision.strikes.callStrike.delta) > currentGuardRails.maxDelta) {
        guardRailViolations.push(`Call delta (${Math.abs(decision.strikes.callStrike.delta)}) exceeds max delta (${currentGuardRails.maxDelta})`);
      }
    }

    // Add guard rail violations and trading window status to response
    // executionReady is only true if: decision is ready + guard rails pass + trading window open
    const canExecuteNow = decision.executionReady &&
                          guardRailViolations.length === 0 &&
                          tradingWindow.allowed;

    const response = {
      ...decision,
      guardRailViolations,
      passedGuardRails: guardRailViolations.length === 0,
      tradingWindowOpen: tradingWindow.allowed,
      tradingWindowReason: tradingWindow.reason,
      canExecuteNow, // True only if all conditions met (can be used for UI)
    };

    res.json(response);
  } catch (error) {
    console.error('[Engine] Execute error:', error);

    // Check if it's an EngineError with step context
    if (error instanceof EngineError) {
      console.error(`[Engine/execute] EngineError at Step ${error.step} (${error.stepName}): ${error.reason}`);
      return res.status(500).json({
        error: 'Failed to execute trading decision',
        failedStep: error.step,
        stepName: error.stepName,
        reason: error.reason,
        diagnostics: error.diagnostics || null,
        audit: error.audit.map(entry => ({
          step: entry.step,
          name: entry.name,
          passed: entry.passed,
          reason: entry.reason
        }))
      });
    }

    res.status(500).json({
      error: 'Failed to execute trading decision',
      reason: error instanceof Error ? error.message : 'Unknown error',
      failedStep: null
    });
  }
});

// GET /api/engine/analyze - Run analysis and return standardized response
// This is the NEW endpoint that returns the EngineAnalyzeResponse format
router.get('/analyze', requireAuth, async (req, res) => {
  try {
    const { riskTier = 'balanced', stopMultiplier = '3', strategy } = req.query;

    // Get symbol from query params, default to SPY
    const requestedSymbol = ((req.query.symbol as string) || 'SPY').toUpperCase() as TradingSymbol;
    const symbol = SYMBOL_CONFIG[requestedSymbol] ? requestedSymbol : 'SPY';
    const symbolConfig = SYMBOL_CONFIG[symbol];
    const expirationMode = symbolConfig.expirationMode;

    // Parse strategy preference (PUT-only, CALL-only, or strangle)
    const strategyPreference = strategy as 'strangle' | 'put-only' | 'call-only' | undefined;

    // Map riskTier to riskProfile
    const riskProfileMap: Record<string, RiskProfile> = {
      'conservative': 'CONSERVATIVE',
      'balanced': 'BALANCED',
      'aggressive': 'AGGRESSIVE'
    };
    const riskProfile = riskProfileMap[riskTier as string] || 'BALANCED';
    const stopMult = parseInt(stopMultiplier as string, 10) || 3;

    // Multi-tenant: Get broker for the authenticated user
    // Falls back to shared broker if no per-user credentials exist
    let broker = await getBrokerForUser(req.user!.id);

    // Fallback to shared broker if per-user broker not available
    if (!broker.api) {
      console.log('[Engine/analyze] No per-user broker, falling back to shared broker');
      broker = getBroker();
    }

    // Check if we have a valid broker API
    if (!broker.api) {
      return res.status(503).json({
        error: 'Broker not connected',
        reason: 'No IBKR connection available. Please check broker configuration.',
        failedStep: null
      });
    }

    // Ensure IBKR is ready if using it
    if (broker.status.provider === 'ibkr') {
      try {
        await ensureIbkrReady();
      } catch (err) {
        console.log('[Engine/analyze] IBKR ensureIbkrReady error:', err instanceof Error ? err.message : err);
      }
    }

    // Check trading window
    const tradingWindow = isWithinTradingWindow();

    // Get account info
    const account = await broker.api.getAccount();

    // Get current underlying price for the engine
    let underlyingPrice = symbol === 'SPY' ? 450 : 150; // Defaults by symbol
    try {
      const { getMarketData } = await import('./services/marketDataService.js');
      const marketData = await getMarketData(symbol);
      underlyingPrice = marketData.price;
    } catch (error) {
      console.error(`[Engine/analyze] Error fetching ${symbol} price:`, error);
    }

    // Create or get engine instance - recreate if symbol, risk profile, or strategy changed
    const needNewInstance = !engineInstance ||
      engineInstance['config'].riskProfile !== riskProfile ||
      engineInstance['config'].underlyingSymbol !== symbol ||
      engineInstance['config'].forcedStrategy !== strategyPreference;

    if (needNewInstance) {
      engineInstance = new TradingEngine({
        riskProfile,
        underlyingSymbol: symbol,
        expirationMode,
        underlyingPrice,
        mockMode: broker.status.provider === 'mock',
        forcedStrategy: strategyPreference,  // Pass strategy preference
      });
    } else {
      engineInstance['config'].underlyingPrice = underlyingPrice;
    }

    // Execute the 5-step decision process with timeout protection
    const decision = await Promise.race([
      engineInstance.executeTradingDecision({
        buyingPower: account.buyingPower,
        cashBalance: account.totalCash,
        netLiquidation: account.netLiquidation,  // Use actual NAV for 2% rule, not leveraged buying power
        currentPositions: 0
      }),
      createTimeoutPromise(ENGINE_TIMEOUT_MS, 'Engine analysis')
    ]);

    // Apply guard rails validation
    const guardRailViolations: string[] = [];

    if (decision.positionSize && decision.positionSize.contracts > currentGuardRails.maxContractsPerTrade) {
      guardRailViolations.push(`Position size (${decision.positionSize.contracts}) exceeds max contracts per trade (${currentGuardRails.maxContractsPerTrade})`);
    }

    if (decision.strikes) {
      if (decision.strikes.putStrike && Math.abs(decision.strikes.putStrike.delta) > currentGuardRails.maxDelta) {
        guardRailViolations.push(`Put delta (${Math.abs(decision.strikes.putStrike.delta)}) exceeds max delta (${currentGuardRails.maxDelta})`);
      }
      if (decision.strikes.callStrike && Math.abs(decision.strikes.callStrike.delta) > currentGuardRails.maxDelta) {
        guardRailViolations.push(`Call delta (${Math.abs(decision.strikes.callStrike.delta)}) exceeds max delta (${currentGuardRails.maxDelta})`);
      }
    }

    // Transform to standardized response using adapter
    const response: EngineAnalyzeResponse = adaptTradingDecision(
      decision,
      {
        buyingPower: account.buyingPower,
        cashBalance: account.totalCash,
        totalValue: account.netLiquidation
      },
      {
        riskProfile,
        stopMultiplier: stopMult,
        guardRailViolations,
        tradingWindowOpen: tradingWindow.allowed,
        symbol,
        expirationMode,
      }
    );

    res.json(response);
  } catch (error) {
    console.error('[Engine/analyze] Error:', error);

    // Check if it's an EngineError with step context
    if (error instanceof EngineError) {
      console.error(`[Engine/analyze] EngineError at Step ${error.step} (${error.stepName}): ${error.reason}`);
      console.log(`[Engine/analyze] Returning partial enhancedLog: ${error.enhancedLog ? 'yes' : 'no'}`);
      return res.status(500).json({
        error: 'Engine analysis failed',
        failedStep: error.step,
        stepName: error.stepName,
        reason: error.reason,
        diagnostics: error.diagnostics || null,
        // Include partial enhancedLog so UI can display completed steps + failure
        enhancedLog: error.enhancedLog || null,
        audit: error.audit.map(entry => ({
          step: entry.step,
          name: entry.name,
          passed: entry.passed,
          reason: entry.reason
        }))
      });
    }

    // Generic error - detect "Service Unavailable" type errors
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const isServiceUnavailable = errorMessage.includes('Service Unavailable') ||
                                  errorMessage.includes('503') ||
                                  errorMessage.includes('ECONNREFUSED') ||
                                  errorMessage.includes('timeout');

    res.status(500).json({
      error: 'Failed to run analysis',
      reason: isServiceUnavailable
        ? 'IBKR service temporarily unavailable - please retry in a moment'
        : errorMessage,
      failedStep: null,
      retryable: isServiceUnavailable
    });
  }
});

// POST /api/engine/execute-trade - Execute LIVE trade with bracket orders (SELL + STOP)
router.post('/execute-paper', requireAuth, async (req, res) => {
  try {
    const { tradeProposal } = req.body as { tradeProposal: TradeProposal };

    if (!tradeProposal || !tradeProposal.proposalId) {
      return res.status(400).json({ error: 'Invalid trade proposal' });
    }

    // Check trading window
    const tradingWindow = isWithinTradingWindow();
    if (!tradingWindow.allowed) {
      return res.status(403).json({
        error: 'Execution not allowed outside trading window',
        reason: tradingWindow.reason,
        tradingWindowOpen: false
      });
    }

    // ================================================
    // MANDATE ENFORCEMENT - Hard block if violated
    // ================================================
    const userId = req.user!.id;

    // Get average delta from trade legs for enforcement check
    const avgDelta = tradeProposal.legs.reduce((sum, leg) => sum + Math.abs(leg.delta), 0) / tradeProposal.legs.length;

    // Determine trade side (SELL for credit strategies)
    const tradeSide: 'SELL' | 'BUY' = tradeProposal.legs[0]?.premium > 0 ? 'SELL' : 'BUY';

    // Enforce mandate rules
    const mandateCheck = await enforceMandate(userId, {
      symbol: tradeProposal.symbol,
      side: tradeSide,
      delta: avgDelta,
      contracts: tradeProposal.contracts,
    });

    if (!mandateCheck.allowed) {
      console.log(`[Engine/execute] MANDATE VIOLATION: ${mandateCheck.reason}`);
      return res.status(403).json({
        error: 'Trade blocked by mandate',
        reason: mandateCheck.reason,
        violation: mandateCheck.violation,
        mandateEnforced: true,
      });
    }
    // ================================================

    // Multi-tenant: Get broker for the authenticated user
    const broker = await getBrokerForUser(userId);
    const ibkrOrderIds: string[] = [];

    // Place BRACKET orders with IBKR for LIVE trading
    if (broker.status.provider === 'ibkr') {
      try {
        await ensureIbkrReady();

        // Use expiration date from trade proposal (e.g., "2024-12-13" for Friday weekly)
        // Convert from YYYY-MM-DD to YYYYMMDD format for IBKR
        const expiration = tradeProposal.expirationDate.replace(/-/g, '');
        console.log(`[Engine/execute] Using expiration date: ${tradeProposal.expirationDate} → ${expiration}`);

        // Calculate per-leg stop prices (3x each leg's individual premium)
        // FIX: Previously used portfolio-level stopLossPrice for all legs (bug: both got same 2.22)
        // Now each leg gets its own stop based on its own premium

        for (const leg of tradeProposal.legs) {
          // Per-leg stop: 3x this leg's premium (e.g., PUT $0.70 → stop $2.10)
          const STOP_MULTIPLIER = 3; // 3x premium (same as step5.ts: 1 + STOP_LOSS_MULTIPLIER)
          // Round to nearest cent (0.01) to conform to IBKR minimum price variation
          const legStopPrice = Math.round(leg.premium * STOP_MULTIPLIER * 100) / 100;

          // Use bid price for SELL orders (faster fills) or fall back to mid price
          // Round to nearest cent to conform to IBKR minimum price variation
          const sellPrice = Math.round((leg.bid || leg.premium) * 100) / 100;

          const orderResult = await placeOptionOrderWithStop({
            symbol: tradeProposal.symbol,
            optionType: leg.optionType,
            strike: leg.strike,
            expiration,
            quantity: tradeProposal.contracts,
            limitPrice: sellPrice,
            stopPrice: legStopPrice,
          });

          if (orderResult.primaryOrderId) {
            ibkrOrderIds.push(orderResult.primaryOrderId);
          }
          if (orderResult.stopOrderId) {
            ibkrOrderIds.push(orderResult.stopOrderId);
          }

          // Check if order was rejected - include IBKR error message if available
          if (orderResult.status.startsWith('rejected')) {
            const ibkrError = orderResult.error || orderResult.status;
            throw new Error(`IBKR order rejected: ${ibkrError}`);
          }

          console.log(`[Engine/execute] ${leg.optionType} BRACKET order: SELL @ $${sellPrice}, STOP @ $${legStopPrice}`, orderResult);

          // Create order records in orders table to track fill times
          const now = new Date();
          const optionSymbol = `${tradeProposal.symbol} ${leg.optionType} ${leg.strike}`;

          if (orderResult.primaryOrderId && db) {
            try {
              await db.insert(orders).values({
                userId,
                ibkrOrderId: orderResult.primaryOrderId,
                symbol: optionSymbol,
                side: 'SELL',
                quantity: tradeProposal.contracts,
                orderType: 'LMT',
                limitPrice: sellPrice.toString(),
                status: 'filled',
                filledAt: now, // Record fill time for holding calculation
              });
              console.log(`[Engine/execute] Created order record for primary order ${orderResult.primaryOrderId}`);
            } catch (dbErr) {
              console.warn(`[Engine/execute] Could not create order record:`, dbErr);
            }
          }

          if (orderResult.stopOrderId && db) {
            try {
              await db.insert(orders).values({
                userId,
                ibkrOrderId: orderResult.stopOrderId,
                symbol: optionSymbol,
                side: 'BUY', // Stop order is a BUY to close
                quantity: tradeProposal.contracts,
                orderType: 'STP',
                limitPrice: legStopPrice.toString(),
                status: 'pending', // Stop order is pending until triggered
              });
              console.log(`[Engine/execute] Created order record for stop order ${orderResult.stopOrderId}`);
            } catch (dbErr) {
              console.warn(`[Engine/execute] Could not create order record:`, dbErr);
            }
          }
        }
      } catch (orderErr: any) {
        console.error('[Engine/execute] IBKR bracket order error:', orderErr);
        // Re-throw to let the caller know the order failed
        throw new Error(`IBKR order failed: ${orderErr.message || orderErr}`);
      }
    }

    // Insert trade record into database
    // Use expiration from proposal (Friday for weekly options)
    const expirationDate = new Date(tradeProposal.expirationDate);
    expirationDate.setHours(16, 0, 0, 0);

    const leg1 = tradeProposal.legs[0];
    const leg2 = tradeProposal.legs[1];

    let engineTradeId: string | null = null;
    let dbInsertError: string | null = null;

    // Try to insert trade record - but don't fail the whole request if DB insert fails
    // IBKR orders have already been placed successfully at this point
    try {
      const [engineTrade] = await db.insert(paperTrades).values({
        proposalId: tradeProposal.proposalId,
        symbol: tradeProposal.symbol,
        strategy: tradeProposal.strategy,
        bias: tradeProposal.bias,
        expiration: expirationDate,
        expirationLabel: tradeProposal.expiration,
        contracts: tradeProposal.contracts,

        leg1Type: leg1.optionType,
        leg1Strike: leg1.strike.toString(),
        leg1Delta: leg1.delta.toString(),
        leg1Premium: leg1.premium.toString(),

        leg2Type: leg2?.optionType ?? null,
        leg2Strike: leg2?.strike?.toString() ?? null,
        leg2Delta: leg2?.delta?.toString() ?? null,
        leg2Premium: leg2?.premium?.toString() ?? null,

        entryPremiumTotal: tradeProposal.entryPremiumTotal.toString(),
        marginRequired: tradeProposal.marginRequired.toString(),
        maxLoss: tradeProposal.maxLoss.toString(),

        stopLossPrice: tradeProposal.stopLossPrice.toString(),
        stopLossMultiplier: '3.5', // 3.5x stop multiplier
        timeStopEt: tradeProposal.timeStop,

        entryVix: tradeProposal.context.vix?.toString() ?? null,
        entryVixRegime: tradeProposal.context.vixRegime ?? null,
        entrySpyPrice: tradeProposal.context.spyPrice?.toString() ?? null,
        riskProfile: tradeProposal.context.riskProfile,

        status: 'open',
        ibkrOrderIds: ibkrOrderIds.length > 0 ? ibkrOrderIds : null,
        userId: req.user?.id ?? null, // Multi-tenant: attach user ID from auth
        fullProposal: tradeProposal,
      }).returning();

      engineTradeId = engineTrade.id;
    } catch (dbErr: any) {
      console.error('[Engine/execute] Failed to insert trade record:', dbErr);
      dbInsertError = dbErr.message || 'Database insert failed';
      // Don't throw - IBKR orders succeeded, we should still report success
    }

    // Create audit log
    try {
      await storage.createAuditLog({
        action: 'ENGINE_TRADE_EXECUTED',
        details: JSON.stringify({
          tradeId: engineTradeId,
          proposalId: tradeProposal.proposalId,
          strategy: tradeProposal.strategy,
          contracts: tradeProposal.contracts,
          ibkrOrderIds,
          dbInsertError,
        }),
        userId: req.user?.id || 'system',
      });
    } catch (auditErr) {
      console.error('[Engine/execute] Failed to create audit log:', auditErr);
    }

    // Return success if IBKR orders were placed (even if DB insert failed)
    res.json({
      success: ibkrOrderIds.length > 0 || engineTradeId !== null,
      tradeId: engineTradeId,
      message: broker.status.provider === 'ibkr' && ibkrOrderIds.length > 0
        ? `LIVE bracket orders submitted: ${ibkrOrderIds.length} order(s) (SELL + STOP)`
        : 'Trade recorded (simulation mode - IBKR not connected)',
      ibkrOrderIds: ibkrOrderIds.length > 0 ? ibkrOrderIds : undefined,
      warning: dbInsertError ? `Trade executed but database record failed: ${dbInsertError}` : undefined,
    });
  } catch (error: any) {
    console.error('[Engine/execute] Error:', error);

    // Extract meaningful error message
    const errorMessage = error?.message || 'Unknown error';
    const isIbkrError = errorMessage.includes('IBKR');

    res.status(500).json({
      error: 'Failed to execute trade',
      reason: errorMessage,
      orderStatus: 'error',
      statusReason: isIbkrError
        ? `IBKR broker error: ${errorMessage}`
        : `Execution error: ${errorMessage}`,
    });
  }
});

// POST /api/engine/execute-trade - Execute the recommended trade
router.post('/execute-trade', requireAuth, async (req, res) => {
  try {
    // Multi-tenant: Get broker for the authenticated user
    const broker = await getBrokerForUser(req.user!.id);

    // Parse request body
    const { decision, autoApprove } = req.body;

    if (!decision || !decision.executionReady) {
      return res.status(400).json({ error: 'Invalid or incomplete trading decision' });
    }

    // Check trading window - actual execution requires being within window
    const tradingWindow = isWithinTradingWindow();
    if (!tradingWindow.allowed) {
      return res.status(403).json({
        error: 'Execution not allowed outside trading window',
        reason: tradingWindow.reason,
        tradingWindowOpen: false
      });
    }

    // Check guard rails
    if (decision.guardRailViolations && decision.guardRailViolations.length > 0) {
      if (!autoApprove) {
        return res.status(403).json({
          error: 'Guard rail violations detected',
          violations: decision.guardRailViolations
        });
      }
    }

    // ================================================
    // MANDATE ENFORCEMENT - Hard block if violated
    // ================================================
    // Determine symbol and delta from decision
    const symbol = decision.underlyingSymbol || 'SPY';
    const putDelta = decision.strikes?.putStrike?.delta ? Math.abs(decision.strikes.putStrike.delta) : 0;
    const callDelta = decision.strikes?.callStrike?.delta ? Math.abs(decision.strikes.callStrike.delta) : 0;
    const avgDelta = (putDelta + callDelta) / (putDelta && callDelta ? 2 : 1);

    const mandateCheck = await enforceMandate(req.user!.id, {
      symbol,
      side: 'SELL', // This endpoint is for selling options (credit strategies)
      delta: avgDelta,
      contracts: decision.positionSize?.contracts || 0,
    });

    if (!mandateCheck.allowed) {
      console.log(`[Engine/execute-trade] MANDATE VIOLATION: ${mandateCheck.reason}`);
      return res.status(403).json({
        error: 'Trade blocked by mandate',
        reason: mandateCheck.reason,
        violation: mandateCheck.violation,
        mandateEnforced: true,
      });
    }
    // ================================================

    // Ensure IBKR is ready
    if (broker.status.provider === 'ibkr') {
      await ensureIbkrReady();
    }

    const orders: Array<{
      symbol: string;
      optionType: 'PUT' | 'CALL';
      strike: number;
      expiry: string;
      quantity: number;
      action: string;
      orderType: string;
      limitPrice: number;
      stopLoss?: number;
      status: string;
      orderId?: string;
      ibkrStatus?: string;
    }> = [];
    const savedTrades: Array<any> = [];

    // Get today's expiration date in YYYYMMDD format for 0DTE
    const today = new Date();
    const expiration = today.toISOString().slice(0, 10).replace(/-/g, '');
    const expirationDate = new Date(today.setHours(16, 0, 0, 0)); // 4 PM ET close

    // Execute PUT order if present (with stop loss for LIVE trading)
    if (decision.strikes?.putStrike && decision.positionSize?.contracts > 0) {
      const putStrike = decision.strikes.putStrike;
      const contracts = decision.positionSize.contracts;
      const premium = putStrike.expectedPremium || putStrike.bid || 0.5;
      // Stop loss: default 3.5x premium if not specified
      const stopPrice = decision.exitRules?.stopLoss || (premium * 3.5);

      let orderResult: { primaryOrderId?: string; stopOrderId?: string; status: string } = { status: 'mock' };

      // Place bracket order (SELL + STOP) with IBKR for LIVE trading
      if (broker.status.provider === 'ibkr') {
        try {
          orderResult = await placeOptionOrderWithStop({
            symbol: 'SPY',
            optionType: 'PUT',
            strike: putStrike.strike,
            expiration,
            quantity: contracts,
            limitPrice: premium,
            stopPrice: stopPrice,
          });
          console.log(`[Engine] PUT bracket order placed: SELL @ $${premium}, STOP @ $${stopPrice}`, JSON.stringify(orderResult));
        } catch (orderErr) {
          console.error('[Engine] PUT bracket order failed:', orderErr);
          orderResult = { status: 'failed' };
        }
      }

      orders.push({
        symbol: 'SPY',
        optionType: 'PUT',
        strike: putStrike.strike,
        expiry: '0DTE',
        quantity: contracts,
        action: 'SELL',
        orderType: 'LIMIT',
        limitPrice: premium,
        stopLoss: stopPrice,
        status: orderResult.status === 'submitted' ? 'SUBMITTED' : 'PENDING',
        orderId: orderResult.primaryOrderId,
        ibkrStatus: orderResult.status,
      });

      // Save trade to database
      try {
        const trade = await storage.createTrade({
          symbol: 'SPY',
          strategy: 'PUT',
          sellStrike: putStrike.strike.toString(),
          buyStrike: putStrike.strike.toString(), // Same for naked options
          expiration: expirationDate,
          quantity: contracts,
          credit: (premium * contracts * 100).toString(), // Total credit in dollars
          status: orderResult.primaryOrderId ? 'pending' : 'mock',
        });
        savedTrades.push(trade);
        console.log(`[Engine] PUT trade saved: ${trade.id}`);
      } catch (dbErr) {
        console.error('[Engine] Failed to save PUT trade:', dbErr);
      }
    }

    // Execute CALL order if present (with stop loss for LIVE trading)
    if (decision.strikes?.callStrike && decision.positionSize?.contracts > 0) {
      const callStrike = decision.strikes.callStrike;
      const contracts = decision.positionSize.contracts;
      const premium = callStrike.expectedPremium || callStrike.bid || 0.5;
      // Stop loss: default 3.5x premium if not specified
      const stopPrice = decision.exitRules?.stopLoss || (premium * 3.5);

      let orderResult: { primaryOrderId?: string; stopOrderId?: string; status: string } = { status: 'mock' };

      // Place bracket order (SELL + STOP) with IBKR for LIVE trading
      if (broker.status.provider === 'ibkr') {
        try {
          orderResult = await placeOptionOrderWithStop({
            symbol: 'SPY',
            optionType: 'CALL',
            strike: callStrike.strike,
            expiration,
            quantity: contracts,
            limitPrice: premium,
            stopPrice: stopPrice,
          });
          console.log(`[Engine] CALL bracket order placed: SELL @ $${premium}, STOP @ $${stopPrice}`, JSON.stringify(orderResult));
        } catch (orderErr) {
          console.error('[Engine] CALL bracket order failed:', orderErr);
          orderResult = { status: 'failed' };
        }
      }

      orders.push({
        symbol: 'SPY',
        optionType: 'CALL',
        strike: callStrike.strike,
        expiry: '0DTE',
        quantity: contracts,
        action: 'SELL',
        orderType: 'LIMIT',
        limitPrice: premium,
        stopLoss: stopPrice,
        status: orderResult.status === 'submitted' ? 'SUBMITTED' : 'PENDING',
        orderId: orderResult.primaryOrderId,
        ibkrStatus: orderResult.status,
      });

      // Save trade to database
      try {
        const trade = await storage.createTrade({
          symbol: 'SPY',
          strategy: 'CALL',
          sellStrike: callStrike.strike.toString(),
          buyStrike: callStrike.strike.toString(), // Same for naked options
          expiration: expirationDate,
          quantity: contracts,
          credit: (premium * contracts * 100).toString(), // Total credit in dollars
          status: orderResult.primaryOrderId ? 'pending' : 'mock',
        });
        savedTrades.push(trade);
        console.log(`[Engine] CALL trade saved: ${trade.id}`);
      } catch (dbErr) {
        console.error('[Engine] Failed to save CALL trade:', dbErr);
      }
    }

    // Create audit log for the execution
    try {
      await storage.createAuditLog({
        action: 'TRADE_EXECUTED',
        details: JSON.stringify({
          direction: decision.direction,
          contracts: decision.positionSize?.contracts,
          orders: orders.map(o => ({ optionType: o.optionType, strike: o.strike, orderId: o.orderId, status: o.ibkrStatus })),
          autoApprove,
        }),
        userId: req.user?.id || 'system',
      });
    } catch (auditErr) {
      console.error('[Engine] Failed to create audit log:', auditErr);
    }

    res.json({
      success: true,
      orders,
      savedTrades: savedTrades.map(t => ({ id: t.id, symbol: t.symbol, strategy: t.strategy })),
      message: broker.status.provider === 'ibkr'
        ? `${orders.length} bracket order(s) submitted to IBKR LIVE account (SELL + STOP)`
        : 'Mock orders created (IBKR not connected)',
    });
  } catch (error) {
    console.error('[Engine] Execute trade error:', error);
    res.status(500).json({ error: 'Failed to execute trade' });
  }
});

// GET /api/engine/config - Get engine configuration
router.get('/config', requireAuth, async (req, res) => {
  try {
    res.json({
      riskProfile: engineInstance?.['config']?.riskProfile || 'BALANCED',
      underlyingSymbol: engineInstance?.['config']?.underlyingSymbol || 'SPY',
      executionMode: 'manual',
      guardRails: currentGuardRails
    });
  } catch (error) {
    console.error('[Engine] Get config error:', error);
    res.status(500).json({ error: 'Failed to get engine configuration' });
  }
});

// PUT /api/engine/config - Update engine configuration
router.put('/config', requireAuth, async (req, res) => {
  try {
    const config = engineConfigSchema.parse(req.body);

    // Update guard rails if provided
    if (config.guardRails) {
      currentGuardRails = {
        ...currentGuardRails,
        ...config.guardRails
      };
    }

    // Multi-tenant: Get broker for the authenticated user
    const broker = await getBrokerForUser(req.user!.id);

    // Recreate engine with new config
    engineInstance = new TradingEngine({
      riskProfile: config.riskProfile || 'BALANCED',
      underlyingSymbol: config.underlyingSymbol || 'SPY',
      mockMode: broker.status.provider === 'mock'
    });

    res.json({
      success: true,
      config: {
        riskProfile: config.riskProfile,
        underlyingSymbol: config.underlyingSymbol,
        executionMode: config.executionMode,
        guardRails: currentGuardRails
      }
    });
  } catch (error) {
    console.error('[Engine] Update config error:', error);
    res.status(400).json({ error: 'Invalid configuration' });
  }
});

// ============================================
// Scheduler Control Endpoints
// ============================================

// GET /api/engine/scheduler/status - Get scheduler status
router.get('/scheduler/status', requireAuth, async (_req, res) => {
  try {
    const status = engineScheduler.getStatus();
    res.json(status);
  } catch (error) {
    console.error('[Engine] Scheduler status error:', error);
    res.status(500).json({ error: 'Failed to get scheduler status' });
  }
});

// POST /api/engine/scheduler/start - Start the scheduler
router.post('/scheduler/start', requireAuth, async (_req, res) => {
  try {
    const result = engineScheduler.start();
    res.json(result);
  } catch (error) {
    console.error('[Engine] Scheduler start error:', error);
    res.status(500).json({ error: 'Failed to start scheduler' });
  }
});

// POST /api/engine/scheduler/stop - Stop the scheduler
router.post('/scheduler/stop', requireAuth, async (_req, res) => {
  try {
    const result = engineScheduler.stop();
    res.json(result);
  } catch (error) {
    console.error('[Engine] Scheduler stop error:', error);
    res.status(500).json({ error: 'Failed to stop scheduler' });
  }
});

// PUT /api/engine/scheduler/config - Update scheduler configuration
const schedulerConfigSchema = z.object({
  enabled: z.boolean().optional(),
  intervalMinutes: z.number().min(1).max(10).optional(),
  tradingWindowStart: z.number().min(9).max(16).optional(),
  tradingWindowEnd: z.number().min(10).max(17).optional(),
  maxTradesPerDay: z.number().min(1).max(10).optional(),
  autoExecute: z.boolean().optional(),
  symbol: z.string().optional(),
});

router.put('/scheduler/config', requireAuth, async (req, res) => {
  try {
    const config = schedulerConfigSchema.parse(req.body);
    const updatedConfig = engineScheduler.updateConfig(config as Partial<SchedulerConfig>);
    res.json({ success: true, config: updatedConfig });
  } catch (error) {
    console.error('[Engine] Scheduler config error:', error);
    res.status(400).json({ error: 'Invalid scheduler configuration' });
  }
});

// POST /api/engine/scheduler/run-once - Manually trigger a single analysis run
router.post('/scheduler/run-once', requireAuth, async (_req, res) => {
  try {
    const decision = await engineScheduler.runOnce();
    res.json({ success: true, decision });
  } catch (error) {
    console.error('[Engine] Scheduler run-once error:', error);
    res.status(500).json({ error: 'Failed to run analysis' });
  }
});

// GET /api/engine/test-strikes - Simple test endpoint: ATM ± range for given expiration
router.get('/test-strikes', requireAuth, async (req, res) => {
  try {
    const symbol = (req.query.symbol as string) || 'SPY';
    const expiration = (req.query.exp as string) || new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const range = parseInt(req.query.range as string) || 5;

    console.log(`[Engine/test-strikes] ${symbol} exp=${expiration} range=±${range}`);

    await ensureIbkrReady();
    // Multi-tenant: Get broker for the authenticated user
    const broker = await getBrokerForUser(req.user!.id);

    // Get underlying price
    const marketData = await broker.api.getMarketData(symbol);
    const underlyingPrice = marketData.price || marketData.last || 0;
    const atmStrike = Math.round(underlyingPrice);

    console.log(`[Engine/test-strikes] Underlying: $${underlyingPrice}, ATM: $${atmStrike}`);

    // Get option chain
    const chain = await broker.api.getOptionChain(symbol, expiration);

    // Filter to ATM ± range
    const strikes: number[] = [];
    for (let i = -range; i <= range; i++) {
      strikes.push(atmStrike + i);
    }

    const puts: any[] = [];
    const calls: any[] = [];

    for (const strike of strikes) {
      const put = chain.puts?.find((p: any) => Math.abs(p.strike - strike) < 0.5);
      const call = chain.calls?.find((c: any) => Math.abs(c.strike - strike) < 0.5);

      if (put) {
        puts.push({
          strike: put.strike,
          bid: put.bid ?? 0,
          ask: put.ask ?? 0,
          last: put.last ?? 0,
          delta: put.delta ?? 0,
          iv: put.iv ?? 0,
        });
      }

      if (call) {
        calls.push({
          strike: call.strike,
          bid: call.bid ?? 0,
          ask: call.ask ?? 0,
          last: call.last ?? 0,
          delta: call.delta ?? 0,
          iv: call.iv ?? 0,
        });
      }
    }

    res.json({
      symbol,
      expiration,
      underlyingPrice,
      atmStrike,
      range,
      strikesRequested: strikes,
      puts,
      calls,
      summary: {
        putsFound: puts.length,
        callsFound: calls.length,
        totalInChain: {
          puts: chain.puts?.length || 0,
          calls: chain.calls?.length || 0,
        }
      }
    });
  } catch (error) {
    console.error('[Engine/test-strikes] Error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

export default router;