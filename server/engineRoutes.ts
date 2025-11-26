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
import { z } from "zod";
import crypto from "crypto";
import jwt from "jsonwebtoken";

const router = Router();

// Helper function to get session from request
async function getSessionFromRequest(req: any) {
  try {
    const token = req.cookies?.auth_token;
    if (!token) return null;

    const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded;
  } catch (error) {
    console.error('[Auth] Token verification failed:', error);
    return null;
  }
}

// Auth middleware
async function requireAuth(req: any, res: any, next: any) {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.user = session;
  next();
}

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

  if (currentMinutes < startMinutes || currentMinutes > endMinutes) {
    return {
      allowed: false,
      reason: `Trading only allowed between ${currentGuardRails.tradingWindow.start} and ${currentGuardRails.tradingWindow.end} ${currentGuardRails.tradingWindow.timezone}`
    };
  }

  return { allowed: true };
}

// GET /api/engine/status - Get current engine status
router.get('/status', requireAuth, async (req, res) => {
  try {
    let brokerConnected = false;
    let brokerProvider = 'mock';

    // Check if IBKR is configured
    const ibkrConfigured = !!(process.env.IBKR_CLIENT_ID && process.env.IBKR_PRIVATE_KEY);

    if (ibkrConfigured) {
      brokerProvider = 'ibkr';

      // Try to establish/verify IBKR connection (same as Settings page)
      try {
        const diagnostics = await ensureIbkrReady();
        brokerConnected = diagnostics.oauth.status === 200 &&
                          diagnostics.sso.status === 200 &&
                          diagnostics.validate.status === 200 &&
                          diagnostics.init.status === 200;
        console.log('[Engine] IBKR connected via ensureIbkrReady:', brokerConnected);
      } catch (err) {
        // ensureIbkrReady failed, check cached diagnostics
        const diagnostics = getIbkrDiagnostics();
        brokerConnected = diagnostics.oauth.status === 200 &&
                          diagnostics.sso.status === 200 &&
                          diagnostics.validate.status === 200 &&
                          diagnostics.init.status === 200;
        console.log('[Engine] IBKR status from cache:', brokerConnected, 'error:', (err as Error).message);
      }
    } else {
      // Mock mode
      brokerConnected = true;
      brokerProvider = 'mock';
    }

    const tradingWindow = isWithinTradingWindow();

    res.json({
      engineActive: engineInstance !== null,
      brokerConnected,
      brokerProvider,
      tradingWindowOpen: tradingWindow.allowed,
      tradingWindowReason: tradingWindow.reason,
      guardRails: currentGuardRails,
      currentTime: new Date().toISOString(),
      nyTime: new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        dateStyle: 'short',
        timeStyle: 'medium'
      }).format(new Date())
    });
  } catch (error) {
    console.error('[Engine] Status error:', error);
    res.status(500).json({ error: 'Failed to get engine status' });
  }
});

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

    // Check trading window
    const tradingWindow = isWithinTradingWindow();
    if (!tradingWindow.allowed) {
      return res.status(403).json({
        error: 'Trading not allowed',
        reason: tradingWindow.reason
      });
    }

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

    // Add guard rail violations to response
    const response = {
      ...decision,
      guardRailViolations,
      passedGuardRails: guardRailViolations.length === 0
    };

    res.json(response);
  } catch (error) {
    console.error('[Engine] Execute error:', error);
    res.status(500).json({ error: 'Failed to execute trading decision' });
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