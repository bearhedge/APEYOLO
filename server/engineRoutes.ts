/**
 * Engine API Routes
 * Provides endpoints for the 5-step trading engine integration with IBKR
 */

import { Router } from "express";
import { TradingEngine } from "./engine/index.js";
import { getBroker } from "./broker/index.js";
import { ensureIbkrReady } from "./broker/ibkr.js";
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
    start: "12:00",
    end: "14:00",
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
    const broker = getBroker();
    const tradingWindow = isWithinTradingWindow();

    res.json({
      engineActive: engineInstance !== null,
      brokerConnected: broker.status.status === 'Connected',
      brokerProvider: broker.status.provider,
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
    if (!engineInstance) {
      engineInstance = new TradingEngine({
        riskProfile: 'BALANCED',
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

    // TODO: Implement actual order placement via IBKR
    // For now, return a mock response
    const orders = [];

    if (decision.strikes?.putStrike && decision.positionSize?.contracts > 0) {
      orders.push({
        symbol: 'SPY',
        optionType: 'PUT',
        strike: decision.strikes.putStrike.strike,
        expiry: '0DTE',
        quantity: decision.positionSize.contracts,
        action: 'SELL',
        orderType: 'LIMIT',
        limitPrice: decision.strikes.putStrike.expectedPremium,
        stopLoss: decision.exitRules?.stopLoss,
        status: 'PENDING'
      });
    }

    if (decision.strikes?.callStrike && decision.positionSize?.contracts > 0) {
      orders.push({
        symbol: 'SPY',
        optionType: 'CALL',
        strike: decision.strikes.callStrike.strike,
        expiry: '0DTE',
        quantity: decision.positionSize.contracts,
        action: 'SELL',
        orderType: 'LIMIT',
        limitPrice: decision.strikes.callStrike.expectedPremium,
        stopLoss: decision.exitRules?.stopLoss,
        status: 'PENDING'
      });
    }

    res.json({
      success: true,
      orders,
      message: broker.status.provider === 'mock' ? 'Mock orders created' : 'Orders submitted to IBKR'
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

export default router;