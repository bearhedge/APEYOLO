/**
 * Engine API Routes
 * Provides endpoints for the 5-step trading engine integration with IBKR
 */

import { Router } from "express";
import { TradingEngine } from "./engine/index";
import { getBroker, getBrokerWithStatus } from "./broker/index";
import { ensureIbkrReady, placePaperOptionOrder, getIbkrDiagnostics } from "./broker/ibkr";
import { storage } from "./storage";
import { engineScheduler, SchedulerConfig } from "./services/engineScheduler";
import { requireAuth } from "./auth";
import { z } from "zod";
import { adaptTradingDecision } from "./engine/adapter";
import { db } from "./db";
import { paperTrades } from "../shared/schema";
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
  maxDelta: 0.30,
  minDelta: 0.05,
  maxPositionsPerDay: 10,
  maxContractsPerTrade: 5,
  mandatoryStopLoss: true,
  stopLossMultiplier: 2.0,
  maxDailyLoss: 0.02,
  tradingWindow: {
    start: "11:00",
    end: "13:00",
    timezone: "America/New_York"
  },
  allowedStrategies: ["STRANGLE", "PUT", "CALL"],
  expirationDays: [0]
};

// Engine instance (singleton)
let engineInstance: TradingEngine | null = null;
let currentGuardRails = { ...DEFAULT_GUARD_RAILS };

// Engine configuration schema
const engineConfigSchema = z.object({
  riskProfile: z.enum(['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE']).optional(),
  underlyingSymbol: z.string().optional().default('SPY'),
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

// Check if we're within trading window
function isWithinTradingWindow(): { allowed: boolean; reason?: string } {
  const now = new Date();
  const nyTime = new Intl.DateTimeFormat('en-US', {
    timeZone: currentGuardRails.tradingWindow.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(now);

  const [currentHour, currentMinute] = nyTime.split(':').map(Number);
  const [startHour, startMinute] = currentGuardRails.tradingWindow.start.split(':').map(Number);
  const [endHour, endMinute] = currentGuardRails.tradingWindow.end.split(':').map(Number);

  const currentMinutes = currentHour * 60 + currentMinute;
  const startMinutes = startHour * 60 + startMinute;
  const endMinutes = endHour * 60 + endMinute;

  // Check if it's a weekday (Mon-Fri)
  const dayOfWeek = new Date(now.toLocaleString("en-US", { timeZone: currentGuardRails.tradingWindow.timezone })).getDay();
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;

  console.log(`[TradingWindow] nyTime=${nyTime}, current=${currentMinutes}, start=${startMinutes}, end=${endMinutes}, dayOfWeek=${dayOfWeek}, isWeekday=${isWeekday}`);

  if (!isWeekday) {
    return {
      allowed: false,
      reason: `Trading only allowed on weekdays (Mon-Fri)`
    };
  }

  if (currentMinutes < startMinutes || currentMinutes >= endMinutes) {
    return {
      allowed: false,
      reason: `Trading only allowed between ${currentGuardRails.tradingWindow.start} and ${currentGuardRails.tradingWindow.end} ${currentGuardRails.tradingWindow.timezone}`
    };
  }

  return { allowed: true };
}


// POST /api/engine/execute - Run the 5-step decision process
router.post('/execute', requireAuth, async (req, res) => {
  try {
    // Accept configurable parameters from UI
    const { riskTier, stopMultiplier } = req.body || {};

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

    const broker = getBroker();

    // Ensure IBKR is ready if using it
    if (broker.status.provider === 'ibkr') {
      await ensureIbkrReady();
    }

    // Check trading window - but don't block analysis, just note it
    const tradingWindow = isWithinTradingWindow();

    // Get account info
    const account = await broker.api.getAccount();

    // Get current SPY price for the engine
    let spyPrice = 450; // Default
    try {
      const { getMarketData } = await import('./services/marketDataService.js');
      const spyData = await getMarketData('SPY');
      spyPrice = spyData.price;
    } catch (error) {
      console.error('[Engine] Error fetching SPY price:', error);
    }

    // Create or get engine instance
    if (!engineInstance || engineInstance['config'].riskProfile !== riskProfile) {
      engineInstance = new TradingEngine({
        riskProfile,
        underlyingSymbol: 'SPY',
        underlyingPrice: spyPrice,
        mockMode: broker.status.provider === 'mock'
      });
    } else {
      // Update underlying price
      engineInstance['config'].underlyingPrice = spyPrice;
    }

    // Execute the 5-step decision process
    const decision = await engineInstance.executeTradingDecision({
      buyingPower: account.buyingPower,
      cashBalance: account.totalCash,
      totalValue: account.netLiquidation,
      openPositions: 0 // TODO: Get actual open positions count
    });

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
    res.status(500).json({ error: 'Failed to execute trading decision' });
  }
});

// GET /api/engine/analyze - Run analysis and return standardized response
// This is the NEW endpoint that returns the EngineAnalyzeResponse format
router.get('/analyze', requireAuth, async (req, res) => {
  try {
    const { riskTier = 'balanced', stopMultiplier = '3' } = req.query;

    // Map riskTier to riskProfile
    const riskProfileMap: Record<string, RiskProfile> = {
      'conservative': 'CONSERVATIVE',
      'balanced': 'BALANCED',
      'aggressive': 'AGGRESSIVE'
    };
    const riskProfile = riskProfileMap[riskTier as string] || 'BALANCED';
    const stopMult = parseInt(stopMultiplier as string, 10) || 3;

    const broker = getBroker();

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

    // Get current SPY price for the engine
    let spyPrice = 450;
    try {
      const { getMarketData } = await import('./services/marketDataService.js');
      const spyData = await getMarketData('SPY');
      spyPrice = spyData.price;
    } catch (error) {
      console.error('[Engine/analyze] Error fetching SPY price:', error);
    }

    // Create or get engine instance
    if (!engineInstance || engineInstance['config'].riskProfile !== riskProfile) {
      engineInstance = new TradingEngine({
        riskProfile,
        underlyingSymbol: 'SPY',
        underlyingPrice: spyPrice,
        mockMode: broker.status.provider === 'mock'
      });
    } else {
      engineInstance['config'].underlyingPrice = spyPrice;
    }

    // Execute the 5-step decision process
    const decision = await engineInstance.executeTradingDecision({
      buyingPower: account.buyingPower,
      cashBalance: account.totalCash,
      totalValue: account.netLiquidation,
      openPositions: 0
    });

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
        tradingWindowOpen: tradingWindow.allowed
      }
    );

    res.json(response);
  } catch (error) {
    console.error('[Engine/analyze] Error:', error);
    res.status(500).json({ error: 'Failed to run analysis' });
  }
});

// POST /api/engine/execute-paper - Execute paper trade and record to database
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

    const broker = getBroker();
    const ibkrOrderIds: string[] = [];

    // Place orders with IBKR if connected
    if (broker.status.provider === 'ibkr') {
      try {
        await ensureIbkrReady();

        const today = new Date();
        const expiration = today.toISOString().slice(0, 10).replace(/-/g, '');

        for (const leg of tradeProposal.legs) {
          const orderResult = await placePaperOptionOrder({
            symbol: tradeProposal.symbol,
            optionType: leg.optionType,
            strike: leg.strike,
            expiration,
            side: 'SELL',
            quantity: tradeProposal.contracts,
            orderType: 'LMT',
            limitPrice: leg.premium,
          });

          if (orderResult.id) {
            ibkrOrderIds.push(orderResult.id);
          }

          console.log(`[Engine/execute-paper] ${leg.optionType} order placed:`, orderResult);
        }
      } catch (orderErr) {
        console.error('[Engine/execute-paper] IBKR order error:', orderErr);
      }
    }

    // Insert paper trade record into database
    const expirationDate = new Date();
    expirationDate.setHours(16, 0, 0, 0);

    const leg1 = tradeProposal.legs[0];
    const leg2 = tradeProposal.legs[1];

    const [paperTrade] = await db.insert(paperTrades).values({
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
      stopLossMultiplier: tradeProposal.context.riskProfile === 'CONSERVATIVE' ? '2' : '3',
      timeStopEt: tradeProposal.timeStop,

      entryVix: tradeProposal.context.vix?.toString() ?? null,
      entryVixRegime: tradeProposal.context.vixRegime ?? null,
      entrySpyPrice: tradeProposal.context.spyPrice?.toString() ?? null,
      riskProfile: tradeProposal.context.riskProfile,

      status: 'open',
      ibkrOrderIds: ibkrOrderIds.length > 0 ? ibkrOrderIds : null,
      userId: (req as any).user?.userId ?? null,
      fullProposal: tradeProposal,
    }).returning();

    // Create audit log
    try {
      await storage.createAuditLog({
        action: 'PAPER_TRADE_EXECUTED',
        details: JSON.stringify({
          tradeId: paperTrade.id,
          proposalId: tradeProposal.proposalId,
          strategy: tradeProposal.strategy,
          contracts: tradeProposal.contracts,
          ibkrOrderIds,
        }),
        userId: (req as any).user?.userId || 'system',
      });
    } catch (auditErr) {
      console.error('[Engine/execute-paper] Failed to create audit log:', auditErr);
    }

    res.json({
      success: true,
      tradeId: paperTrade.id,
      message: broker.status.provider === 'ibkr' && ibkrOrderIds.length > 0
        ? `Paper trade recorded with ${ibkrOrderIds.length} IBKR order(s)`
        : 'Paper trade recorded (simulation mode)',
      ibkrOrderIds: ibkrOrderIds.length > 0 ? ibkrOrderIds : undefined,
    });
  } catch (error) {
    console.error('[Engine/execute-paper] Error:', error);
    res.status(500).json({ error: 'Failed to execute paper trade' });
  }
});

// POST /api/engine/execute-trade - Execute the recommended trade
router.post('/execute-trade', requireAuth, async (req, res) => {
  try {
    const broker = getBroker();

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

    // Execute PUT order if present
    if (decision.strikes?.putStrike && decision.positionSize?.contracts > 0) {
      const putStrike = decision.strikes.putStrike;
      const contracts = decision.positionSize.contracts;
      const premium = putStrike.expectedPremium || putStrike.bid || 0.5;

      let orderResult = { id: undefined as string | undefined, status: 'mock' };

      // Place real order if using IBKR
      if (broker.status.provider === 'ibkr') {
        try {
          orderResult = await placePaperOptionOrder({
            symbol: 'SPY',
            optionType: 'PUT',
            strike: putStrike.strike,
            expiration,
            side: 'SELL',
            quantity: contracts,
            orderType: 'LMT',
            limitPrice: premium,
          });
          console.log(`[Engine] PUT order placed: ${JSON.stringify(orderResult)}`);
        } catch (orderErr) {
          console.error('[Engine] PUT order failed:', orderErr);
          orderResult = { id: undefined, status: 'failed' };
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
        stopLoss: decision.exitRules?.stopLoss,
        status: orderResult.status === 'submitted' || orderResult.status === 'filled' ? 'SUBMITTED' : 'PENDING',
        orderId: orderResult.id,
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
          status: orderResult.id ? 'pending' : 'mock',
        });
        savedTrades.push(trade);
        console.log(`[Engine] PUT trade saved: ${trade.id}`);
      } catch (dbErr) {
        console.error('[Engine] Failed to save PUT trade:', dbErr);
      }
    }

    // Execute CALL order if present
    if (decision.strikes?.callStrike && decision.positionSize?.contracts > 0) {
      const callStrike = decision.strikes.callStrike;
      const contracts = decision.positionSize.contracts;
      const premium = callStrike.expectedPremium || callStrike.bid || 0.5;

      let orderResult = { id: undefined as string | undefined, status: 'mock' };

      // Place real order if using IBKR
      if (broker.status.provider === 'ibkr') {
        try {
          orderResult = await placePaperOptionOrder({
            symbol: 'SPY',
            optionType: 'CALL',
            strike: callStrike.strike,
            expiration,
            side: 'SELL',
            quantity: contracts,
            orderType: 'LMT',
            limitPrice: premium,
          });
          console.log(`[Engine] CALL order placed: ${JSON.stringify(orderResult)}`);
        } catch (orderErr) {
          console.error('[Engine] CALL order failed:', orderErr);
          orderResult = { id: undefined, status: 'failed' };
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
        stopLoss: decision.exitRules?.stopLoss,
        status: orderResult.status === 'submitted' || orderResult.status === 'filled' ? 'SUBMITTED' : 'PENDING',
        orderId: orderResult.id,
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
          status: orderResult.id ? 'pending' : 'mock',
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
        userId: (req as any).user?.userId || 'system',
      });
    } catch (auditErr) {
      console.error('[Engine] Failed to create audit log:', auditErr);
    }

    res.json({
      success: true,
      orders,
      savedTrades: savedTrades.map(t => ({ id: t.id, symbol: t.symbol, strategy: t.strategy })),
      message: broker.status.provider === 'ibkr'
        ? `${orders.length} order(s) submitted to IBKR paper account`
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

    // Recreate engine with new config
    engineInstance = new TradingEngine({
      riskProfile: config.riskProfile || 'BALANCED',
      underlyingSymbol: config.underlyingSymbol || 'SPY',
      mockMode: getBroker().status.provider === 'mock'
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

export default router;