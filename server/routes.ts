import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { getBroker } from "./broker";
import { getIbkrDiagnostics, ensureIbkrReady, placePaperStockOrder, listPaperOpenOrders } from "./broker/ibkr";
import { TradingEngine } from "./engine/index.ts";
import { 
  insertTradeSchema, 
  insertPositionSchema, 
  insertRiskRulesSchema, 
  insertAuditLogSchema,
  type SpreadConfig 
} from "@shared/schema";
import { z } from "zod";
import cookieParser from "cookie-parser";
import authRoutes from "./auth.js";
import ibkrRoutes from "./ibkrRoutes.js";

export async function registerRoutes(app: Express): Promise<Server> {
  // Add cookie parser middleware
  app.use(cookieParser());

  // Register auth routes
  app.use('/api/auth', authRoutes);

  // Register IBKR strategy routes
  app.use('/api/ibkr', ibkrRoutes);

  const httpServer = createServer(app);

  // WebSocket server for live data
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  // Select broker provider (mock or ibkr)
  const broker = getBroker();
  
  wss.on('connection', (ws) => {
    console.log('Client connected to websocket');
    
    // Send initial data
    ws.send(JSON.stringify({
      type: 'connected',
      message: 'Connected to Orca Options live data feed'
    }));

    // Simulate live data updates
    const interval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'price_update',
          data: {
            SPY: 450.23 + (Math.random() - 0.5) * 2,
            TSLA: 242.15 + (Math.random() - 0.5) * 5,
            AAPL: 187.50 + (Math.random() - 0.5) * 3,
            timestamp: new Date().toISOString()
          }
        }));
      }
    }, 5000);

    ws.on('close', () => {
      clearInterval(interval);
      console.log('Client disconnected from websocket');
    });
  });

  // Account info (via provider)
  app.get('/api/account', async (req, res) => {
    try {
      if (broker.status.provider === 'ibkr') {
        await ensureIbkrReady();
      }
      const account = await broker.api.getAccount();
      res.json(account);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch account info' });
    }
  });

  // Positions (via provider)
  app.get('/api/positions', async (req, res) => {
    try {
      if (broker.status.provider === 'ibkr') {
        await ensureIbkrReady();
      }
      const positions = await broker.api.getPositions();
      res.json(positions);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch positions' });
    }
  });

  app.post('/api/positions', async (req, res) => {
    try {
      const position = insertPositionSchema.parse(req.body);
      const created = await storage.createPosition(position);
      
      await storage.createAuditLog({
        eventType: 'POSITION_OPENED',
        details: `${created.symbol} ${created.strategy} ${created.sellStrike}/${created.buyStrike}`,
        userId: 'system',
        status: 'SUCCESS'
      });
      
      res.json(created);
    } catch (error) {
      res.status(400).json({ error: 'Invalid position data' });
    }
  });

  app.post('/api/positions/:id/close', async (req, res) => {
    try {
      const { id } = req.params;
      const position = await storage.getPosition(id);
      if (!position) {
        return res.status(404).json({ error: 'Position not found' });
      }

      await storage.closePosition(id);
      
      await storage.createAuditLog({
        eventType: 'POSITION_CLOSED',
        details: `${position.symbol} ${position.strategy} closed`,
        userId: 'system',
        status: 'SUCCESS'
      });
      
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to close position' });
    }
  });

  // Option chains (via provider) — express v5 does not allow 
  // an optional param with a preceding slash; register two routes.
  const optionsChainHandler = async (req: any, res: any) => {
    try {
      const { symbol, expiration } = req.params as { symbol: string; expiration?: string };
      const chain = await broker.api.getOptionChain(symbol, expiration);
      res.json(chain);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch option chain' });
    }
  };
  app.get('/api/options/chain/:symbol', optionsChainHandler);
  app.get('/api/options/chain/:symbol/:expiration', optionsChainHandler);

  // Trades list (via provider)
  app.get('/api/trades', async (_req, res) => {
    try {
      const trades = await broker.api.getTrades();
      res.json(trades);
    } catch (_error) {
      res.status(500).json({ error: 'Failed to fetch trades' });
    }
  });

  // Trade validation and submission
  /** Archived deterministic validation endpoint for agent-driven flow
  app.post('/api/trades/validate', async (req, res) => { ... });
  */

  app.post('/api/trades/submit', async (req, res) => {
    try {
      console.log('Received trade data:', JSON.stringify(req.body, null, 2));
      
      // Transform the data to ensure correct types
      const transformedData = {
        ...req.body,
        expiration: new Date(req.body.expiration),
        sellStrike: req.body.sellStrike.toString(),
        buyStrike: req.body.buyStrike.toString(), 
        credit: req.body.credit.toString(),
        quantity: parseInt(req.body.quantity.toString())
      };
      
      console.log('Transformed data:', JSON.stringify(transformedData, null, 2));
      const trade = insertTradeSchema.parse(transformedData);

      // If using IBKR provider, place order and record locally
      if (broker.status.provider === 'ibkr') {
        const result = await broker.api.placeOrder(trade);
        if (!result.id && !(result.status || '').startsWith('submitted')) {
          return res.status(502).json({ error: 'IBKR order placement failed', result });
        }

        const created = await storage.createTrade(trade);
        await storage.createAuditLog({
          eventType: 'TRADE_SUBMIT',
          details: `${trade.symbol} ${trade.strategy} ${trade.sellStrike}/${trade.buyStrike} x${trade.quantity} [IBKR orderId=${result.id ?? 'n/a'}]`,
          userId: 'system',
          status: 'PENDING'
        });
        return res.json(created);
      }

      const created = await storage.createTrade(trade);
      
      // Simulate trade execution
      setTimeout(async () => {
        await storage.updateTradeStatus(created.id, 'filled');
        
        // Create corresponding position
        await storage.createPosition({
          symbol: trade.symbol,
          strategy: trade.strategy,
          sellStrike: trade.sellStrike,
          buyStrike: trade.buyStrike,
          expiration: trade.expiration,
          quantity: trade.quantity,
          openCredit: trade.credit,
          currentValue: trade.credit, // Will be updated with market data
          delta: ((trade.sellStrike > trade.buyStrike ? -0.20 : 0.20) * trade.quantity).toString(), // Simplified
          marginRequired: (Math.abs(parseFloat(trade.sellStrike.toString()) - parseFloat(trade.buyStrike.toString())) * 100 * trade.quantity).toString()
        });
        
        await storage.createAuditLog({
          eventType: 'TRADE_FILLED',
          details: `${trade.symbol} ${trade.strategy} ${trade.sellStrike}/${trade.buyStrike} x${trade.quantity}`,
          userId: 'system',
          status: 'SUCCESS'
        });
      }, 1000);
      
      await storage.createAuditLog({
        eventType: 'TRADE_SUBMIT',
        details: `${trade.symbol} ${trade.strategy} ${trade.sellStrike}/${trade.buyStrike} x${trade.quantity}`,
        userId: 'system',
        status: 'PENDING'
      });
      
      res.json(created);
    } catch (error) {
      res.status(400).json({ error: 'Invalid trade data' });
    }
  });

  // Broker status
  app.get('/api/broker/status', (_req, res) => {
    res.json(broker.status);
  });

  // Broker diagnostics (read-only)
  app.get('/api/broker/diag', (_req, res) => {
    const last = broker.status.provider === 'ibkr'
      ? getIbkrDiagnostics()
      : { oauth: { status: null, ts: '' }, sso: { status: null, ts: '' }, validate: { status: null, ts: '' }, init: { status: null, ts: '' } };
    res.json({ provider: broker.status.provider, env: broker.status.env, last });
  });

  // Warm the full IBKR flow and return diagnostics (JSON)
  app.get('/api/broker/warm', async (_req, res) => {
    try {
      if (broker.status.provider !== 'ibkr') {
        return res.status(400).json({ ok: false, error: 'Set BROKER_PROVIDER=ibkr' });
      }
      const diag = await ensureIbkrReady();
      return res.status(200).json({ ok: true, diag });
    } catch (err: any) {
      const diag = getIbkrDiagnostics();
      return res.status(502).json({ ok: false, error: err?.message || String(err), diag });
    }
  });

  // IBKR Status endpoint - shows connection status and configuration
  app.get('/api/ibkr/status', async (_req, res) => {
    try {
      const requiredVars = [
        'IBKR_CLIENT_ID',
        'IBKR_CLIENT_KEY_ID',
        'IBKR_PRIVATE_KEY',
        'IBKR_CREDENTIAL',
      ];
      const missing = requiredVars.filter((k) => !process.env[k]);
      const isConfigured = missing.length === 0;

      if (!isConfigured) {
        return res.json({
          configured: false,
          connected: false,
          environment: process.env.IBKR_ENV || 'paper',
          message: 'IBKR credentials not configured in environment variables',
          missing,
        });
      }

      // Get diagnostics without trying to connect
      const diag = getIbkrDiagnostics();

      // Check all 4 authentication steps
      const allStepsConnected =
        diag.oauth.status === 200 &&
        diag.sso.status === 200 &&
        diag.validate.status === 200 &&
        diag.init.status === 200;

      return res.json({
        configured: true,
        connected: allStepsConnected,
        environment: process.env.IBKR_ENV || 'paper',
        accountId: process.env.IBKR_ACCOUNT_ID || 'Not configured',
        clientId: process.env.IBKR_CLIENT_ID?.substring(0, 10) + '***', // Partially masked
        multiUserMode: process.env.ENABLE_MULTI_USER === 'true',
        diagnostics: {
          oauth: {
            status: diag.oauth.status,
            message: diag.oauth.status === 200 ? 'Connected' : diag.oauth.status === 0 ? 'Not attempted' : 'Failed',
            success: diag.oauth.status === 200
          },
          sso: {
            status: diag.sso.status,
            message: diag.sso.status === 200 ? 'Active' : diag.sso.status === 0 ? 'Not attempted' : 'Failed',
            success: diag.sso.status === 200
          },
          validate: {
            status: diag.validate.status,
            message: diag.validate.status === 200 ? 'Validated' : diag.validate.status === 0 ? 'Not attempted' : 'Failed',
            success: diag.validate.status === 200
          },
          init: {
            status: diag.init.status,
            message: diag.init.status === 200 ? 'Ready' : diag.init.status === 0 ? 'Not attempted' : 'Failed',
            success: diag.init.status === 200
          }
        }
      });
    } catch (error: any) {
      return res.status(500).json({
        configured: false,
        connected: false,
        error: error.message || 'Failed to get IBKR status'
      });
    }
  });

  // IBKR Test Connection endpoint - attempts to connect and validate
  app.post('/api/ibkr/test', async (_req, res) => {
    try {
      if (broker.status.provider !== 'ibkr') {
        return res.json({
          success: false,
          message: 'IBKR provider not configured. Set BROKER_PROVIDER=ibkr in environment variables.'
        });
      }

      // Try to ensure IBKR is ready
      const diag = await ensureIbkrReady();

      const allConnected =
        diag.oauth.status === 200 &&
        diag.sso.status === 200 &&
        diag.validate.status === 200 &&
        diag.init.status === 200;

      return res.json({
        success: allConnected,
        message: allConnected
          ? 'IBKR connection successful! Ready to trade.'
          : 'IBKR connection failed. Check diagnostics for details.',
        steps: {
          oauth: {
            status: diag.oauth.status,
            success: diag.oauth.status === 200,
            message: diag.oauth.status === 200 ? 'OAuth authenticated' : 'OAuth failed'
          },
          sso: {
            status: diag.sso.status,
            success: diag.sso.status === 200,
            message: diag.sso.status === 200 ? 'SSO session created' : 'SSO session failed'
          },
          validate: {
            status: diag.validate.status,
            success: diag.validate.status === 200,
            message: diag.validate.status === 200 ? 'Validation successful' : 'Validation failed'
          },
          init: {
            status: diag.init.status,
            success: diag.init.status === 200,
            message: diag.init.status === 200 ? 'Initialization complete' : 'Initialization failed'
          }
        }
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: 'Failed to test IBKR connection',
        error: error.message || String(error)
      });
    }
  });

  // IBKR OAuth endpoint for frontend
  app.post('/api/broker/oauth', async (_req, res) => {
    try {
      if (broker.status.provider !== 'ibkr') {
        return res.status(400).json({ ok: false, error: 'IBKR provider not configured' });
      }
      // Run OAuth flow
      const diag = await ensureIbkrReady();
      if (diag.oauth.status === 200) {
        return res.json({ ok: true, code: 200, traceId: diag.oauth.ts });
      } else {
        return res.status(502).json({ ok: false, code: diag.oauth.status || 500, error: 'OAuth failed' });
      }
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  // IBKR SSO session creation endpoint for frontend
  app.post('/api/broker/sso', async (_req, res) => {
    try {
      if (broker.status.provider !== 'ibkr') {
        return res.status(400).json({ ok: false, error: 'IBKR provider not configured' });
      }
      // Create SSO session
      const diag = await ensureIbkrReady();
      if (diag.sso.status === 200) {
        return res.json({ ok: true, code: 200, traceId: diag.sso.ts });
      } else {
        return res.status(502).json({ ok: false, code: diag.sso.status || 500, error: 'SSO creation failed' });
      }
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  // IBKR validation endpoint for frontend (optional)
  app.post('/api/broker/validate', async (_req, res) => {
    try {
      if (broker.status.provider !== 'ibkr') {
        return res.status(400).json({ ok: false, error: 'IBKR provider not configured' });
      }
      const diag = getIbkrDiagnostics();
      if (diag.validate.status === 200) {
        return res.json({ ok: true, code: 200, traceId: diag.validate.ts });
      } else {
        return res.status(502).json({ ok: false, code: diag.validate.status || 500, error: 'Validation failed' });
      }
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  // Paper stock order test endpoint (to validate OAuth/SSO/init pipeline)
  app.post('/api/broker/paper/order', async (req, res) => {
    if (broker.status.provider !== 'ibkr') {
      return res.status(400).json({ error: 'Set BROKER_PROVIDER=ibkr for paper order test' });
    }
    const schema = z.object({
      symbol: z.string().min(1),
      side: z.enum(['BUY', 'SELL']),
      quantity: z.number().int().positive(),
      orderType: z.enum(['MKT','LMT']).optional(),
      limitPrice: z.number().positive().optional(),
      tif: z.enum(['DAY','GTC']).optional(),
      outsideRth: z.boolean().optional(),
    }).refine((v) => v.orderType !== 'LMT' || typeof v.limitPrice === 'number', { message: 'limitPrice required for LMT' });
    try {
      const { symbol, side, quantity, orderType, limitPrice, tif, outsideRth } = schema.parse(req.body);
      const result = await placePaperStockOrder({ symbol, side, quantity, orderType, limitPrice, tif, outsideRth });
      if ((result.status || '').startsWith('rejected') || !result.id) {
        return res.status(502).json({ error: 'order_rejected', result });
      }
      return res.json({ ok: true, orderId: result.id, result });
    } catch (err: any) {
      return res.status(400).json({ error: err?.message || 'invalid_request' });
    }
  });

  // List open orders (paper)
  app.get('/api/broker/orders', async (_req, res) => {
    if (broker.status.provider !== 'ibkr') {
      return res.json([]);
    }
    try {
      const list = await listPaperOpenOrders();
      return res.json(Array.isArray(list) ? list : []);
    } catch {
      return res.json([]);
    }
  });

  /** Archived risk rules endpoints for SDK-driven agent iteration
  app.get('/api/rules', async (req, res) => { ... });
  app.post('/api/rules', async (req, res) => { ... });
  */

  // Trading Engine endpoints
  app.get('/api/engine/status', async (req, res) => {
    try {
      const engine = new TradingEngine({
        riskProfile: 'BALANCED',
        underlyingSymbol: 'SPY',
        underlyingPrice: 450, // Mock for now, will get from market
        mockMode: true
      });

      // Get mock account info (will use real data later)
      const accountInfo = {
        cashBalance: 100000,
        buyingPower: 666000,
        currentPositions: 0
      };

      // Run the engine to get current decision
      const decision = await engine.executeTradingDecision(accountInfo);

      res.json({
        timestamp: new Date().toISOString(),
        canTrade: decision.canTrade,
        reason: decision.reason,
        summary: decision.canTrade ? {
          direction: decision.direction?.direction,
          putStrike: decision.strikes?.putStrike?.strike,
          callStrike: decision.strikes?.callStrike?.strike,
          contracts: decision.positionSize?.contracts,
          expectedPremium: decision.strikes?.expectedPremium,
          marginRequired: decision.positionSize?.totalMarginRequired,
          stopLoss: decision.exitRules?.stopLossAmount
        } : null,
        steps: decision.audit?.map(step => ({
          name: step.name,
          passed: step.passed,
          reason: step.reason
        }))
      });
    } catch (error) {
      console.error('Engine error:', error);
      res.status(500).json({ error: 'Failed to get engine status' });
    }
  });

  app.post('/api/engine/execute', async (req, res) => {
    try {
      // This endpoint will execute the trade once we have IBKR working
      res.json({
        message: 'Trade execution not yet implemented',
        status: 'pending_ibkr_integration'
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to execute trade' });
    }
  });

  // Audit logs
  app.get('/api/logs', async (req, res) => {
    try {
      const logs = await storage.getAuditLogs();
      res.json(logs);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch audit logs' });
    }
  });

  return httpServer;
}
