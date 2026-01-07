// @ts-nocheck
// TODO: Add proper null checks for db and broker.api
import type { Express } from "express";
import { createServer, type Server } from "http";
import WebSocket, { WebSocketServer } from "ws";
import { storage } from "./storage";
import { getBroker, getBrokerForUser, clearUserBrokerCache } from "./broker";
import { getIbkrDiagnostics, ensureIbkrReady, placePaperStockOrder, placePaperOptionOrder, listPaperOpenOrders, getIbkrCookieString, getIbkrSessionToken, resolveSymbolConid } from "./broker/ibkr";
import { IbkrWebSocketManager, initIbkrWebSocket, getIbkrWebSocketManager, destroyIbkrWebSocket, getIbkrWebSocketStatus, type MarketDataUpdate, wsManagerInstance } from "./broker/ibkrWebSocket";
import { getOptionChainStreamer, initOptionChainStreamer } from "./broker/optionChainStreamer";
import { TradingEngine } from "./engine/index.ts";
import {
  insertTradeSchema,
  insertPositionSchema,
  insertRiskRulesSchema,
  insertAuditLogSchema,
  cashFlows,
  insertCashFlowSchema,
  paperTrades,
  ibkrCredentials,
  navSnapshots,
  type SpreadConfig
} from "@shared/schema";
import { encryptPrivateKey, isValidPrivateKey, sanitizeCredentials } from "./crypto";
import { db } from "./db";
import { desc, eq, and, asc } from "drizzle-orm";
import { z } from "zod";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import authRoutes, { requireAuth } from "./auth.js";
import ibkrRoutes from "./ibkrRoutes.js";
import engineRoutes from "./engineRoutes.js";
import marketRoutes from "./marketRoutes.js";
import jobRoutes, { initializeJobsSystem } from "./jobRoutes.js";
import defiRoutes from "./defiRoutes.js";
import agentRoutes from "./agentRoutes.js";
import dataCaptureRoutes from "./routes/dataCaptureRoutes.js";
import researchRoutes from "./routes/researchRoutes.js";
import schedulerRoutes from "./routes/schedulerRoutes.js";
import publicRoutes from "./publicRoutes.js";
import indicatorRoutes from "./indicatorRoutes.js";
import replayRoutes from "./replayRoutes.js";
import ddRoutes from "./ddRoutes.js";
import cors from "cors";
import { getTodayOpeningSnapshot, getTodayClosingSnapshot, getPreviousClosingSnapshot, isMarketHours } from "./services/navSnapshot.js";
import { fetchMarketSnapshot as fetchYahooSnapshot } from "./services/yahooFinanceService.js";

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

export async function registerRoutes(app: Express): Promise<Server> {
  // Add cookie parser middleware
  app.use(cookieParser());

  // Debug middleware for auth routes
  app.use('/api/auth', (req, res, next) => {
    console.log('[ROUTES] Auth route hit:', req.method, req.path);
    next();
  });

  // Register auth routes
  console.log('[ROUTES] Registering auth routes, authRoutes type:', typeof authRoutes);
  app.use('/api/auth', authRoutes);

  // Register IBKR strategy routes
  app.use('/api/ibkr', ibkrRoutes);

  // Register Engine routes
  app.use('/api/engine', engineRoutes);

  // Register Market data routes
  app.use('/api/market', marketRoutes);

  // Register Jobs routes
  app.use('/api/jobs', jobRoutes);

  // Register DeFi routes
  // CORS for defi routes (needed for bearhedge.com track widget)
  const defiCorsOptions = {
    origin: ['https://bearhedge.com', 'http://localhost:3000', 'http://localhost:5173'],
    methods: ['GET', 'POST'],
    credentials: false,
  };
  app.use('/api/defi', cors(defiCorsOptions), defiRoutes);

  // Register Agent routes (LLM chat)
  app.use('/api/agent', agentRoutes);

  // Register Data Capture routes (DD research terminal)
  app.use('/api/data-capture', dataCaptureRoutes);

  // Register Research routes (DD research terminal)
  app.use('/api/research', researchRoutes);

  // Register Cloud Scheduler routes (autonomous trading)
  app.use('/api/cron', schedulerRoutes);

  // Register Indicator routes (RLHF market context)
  app.use('/api/indicators', indicatorRoutes);

  // Register Replay routes (historical data for replay trainer)
  app.use('/api/replay', replayRoutes);

  // Register DD routes (training decisions and research observations)
  app.use('/api/dd', ddRoutes);

  // Register Public API routes (for bearhedge.com - no auth required)
  // CORS enabled for bearhedge.com and localhost development
  const publicCorsOptions = {
    origin: ['https://bearhedge.com', 'http://localhost:3000', 'http://localhost:5173'],
    methods: ['GET'],
    credentials: false,
  };
  app.use('/api/public', cors(publicCorsOptions), publicRoutes);

  // ==================== IBKR CREDENTIALS SETTINGS (Multi-Tenant) ====================

  // GET /api/settings/ibkr - Get user's IBKR credentials status (not the secrets)
  app.get('/api/settings/ibkr', requireAuth, async (req, res) => {
    try {
      const userId = req.user!.id;
      console.log(`[Settings] GET /api/settings/ibkr for userId=${userId}`);
      if (!db) {
        console.log(`[Settings] Database not available!`);
        return res.status(503).json({ error: 'Database not available' });
      }

      // Debug: list all credentials in table
      const allCreds = await db.select({
        id: ibkrCredentials.id,
        userId: ibkrCredentials.userId,
        clientIdPrefix: sql<string>`LEFT(${ibkrCredentials.clientId}, 8)`,
        status: ibkrCredentials.status
      }).from(ibkrCredentials).limit(10);
      console.log(`[Settings] All credentials in DB:`, JSON.stringify(allCreds));

      const creds = await db.select().from(ibkrCredentials)
        .where(eq(ibkrCredentials.userId, userId))
        .limit(1);

      console.log(`[Settings] Found ${creds.length} credentials for userId=${userId}`);

      if (creds.length === 0) {
        return res.json({
          configured: false,
          message: 'No IBKR credentials configured'
        });
      }

      const cred = creds[0];
      return res.json({
        configured: true,
        clientId: cred.clientId.substring(0, 8) + '****', // Partially masked
        clientKeyId: cred.clientKeyId.substring(0, 8) + '****',
        credential: cred.credential, // Username is not secret
        accountId: cred.accountId || null,
        allowedIp: cred.allowedIp || null,
        environment: cred.environment,
        status: cred.status,
        lastConnectedAt: cred.lastConnectedAt,
        errorMessage: cred.errorMessage,
        createdAt: cred.createdAt,
        updatedAt: cred.updatedAt
      });
    } catch (error) {
      console.error('[Settings] Get IBKR credentials error:', error);
      res.status(500).json({ error: 'Failed to get IBKR credentials' });
    }
  });

  // POST /api/settings/ibkr - Save user's IBKR credentials
  app.post('/api/settings/ibkr', requireAuth, async (req, res) => {
    try {
      const userId = req.user!.id;
      if (!db) {
        return res.status(503).json({ error: 'Database not available' });
      }

      const { clientId, clientKeyId, privateKey, credential, accountId, allowedIp, environment } = req.body;

      // Validate required fields
      if (!clientId || !clientKeyId || !privateKey || !credential) {
        return res.status(400).json({
          error: 'Missing required fields',
          required: ['clientId', 'clientKeyId', 'privateKey', 'credential']
        });
      }

      // Validate private key format
      if (!isValidPrivateKey(privateKey)) {
        return res.status(400).json({
          error: 'Invalid private key format',
          hint: 'Private key must be PEM-formatted (BEGIN PRIVATE KEY or BEGIN RSA PRIVATE KEY)'
        });
      }

      // Validate environment
      if (environment && !['paper', 'live'].includes(environment)) {
        return res.status(400).json({
          error: 'Invalid environment',
          valid: ['paper', 'live']
        });
      }

      // Encrypt the private key
      const encryptedPrivateKey = encryptPrivateKey(privateKey);

      // Check if credentials already exist for this user
      const existing = await db.select().from(ibkrCredentials)
        .where(eq(ibkrCredentials.userId, userId))
        .limit(1);

      if (existing.length > 0) {
        // Update existing credentials
        await db.update(ibkrCredentials)
          .set({
            clientId,
            clientKeyId,
            privateKeyEncrypted: encryptedPrivateKey,
            credential,
            accountId: accountId || null,
            allowedIp: allowedIp || null,
            environment: environment || 'paper',
            status: 'inactive', // Reset status until tested
            errorMessage: null,
            updatedAt: new Date()
          })
          .where(eq(ibkrCredentials.userId, userId));

        // Clear the broker cache so next request uses new credentials
        clearUserBrokerCache(userId);

        console.log(`[Settings] Updated IBKR credentials for user ${userId}`);
        return res.json({
          success: true,
          message: 'IBKR credentials updated',
          status: 'inactive'
        });
      } else {
        // Insert new credentials
        await db.insert(ibkrCredentials).values({
          userId,
          clientId,
          clientKeyId,
          privateKeyEncrypted: encryptedPrivateKey,
          credential,
          accountId: accountId || null,
          allowedIp: allowedIp || null,
          environment: environment || 'paper',
          status: 'inactive'
        });

        console.log(`[Settings] Created IBKR credentials for user ${userId}`);
        return res.json({
          success: true,
          message: 'IBKR credentials saved',
          status: 'inactive'
        });
      }
    } catch (error) {
      console.error('[Settings] Save IBKR credentials error:', error);
      res.status(500).json({ error: 'Failed to save IBKR credentials' });
    }
  });

  // DELETE /api/settings/ibkr - Remove user's IBKR credentials
  app.delete('/api/settings/ibkr', requireAuth, async (req, res) => {
    try {
      const userId = req.user!.id;
      if (!db) {
        return res.status(503).json({ error: 'Database not available' });
      }

      await db.delete(ibkrCredentials)
        .where(eq(ibkrCredentials.userId, userId));

      // Clear the broker cache
      clearUserBrokerCache(userId);

      console.log(`[Settings] Deleted IBKR credentials for user ${userId}`);
      return res.json({
        success: true,
        message: 'IBKR credentials deleted'
      });
    } catch (error) {
      console.error('[Settings] Delete IBKR credentials error:', error);
      res.status(500).json({ error: 'Failed to delete IBKR credentials' });
    }
  });

  // POST /api/settings/ibkr/test - Test user's IBKR credentials
  app.post('/api/settings/ibkr/test', requireAuth, async (req, res) => {
    try {
      const userId = req.user!.id;
      if (!db) {
        return res.status(503).json({ error: 'Database not available' });
      }

      // Import getBrokerForUser dynamically to avoid circular imports
      const { getBrokerForUser } = await import('./broker/index.js');

      // Get broker for this user (will load and use their credentials)
      // Use allowInactive: true to test credentials that haven't been activated yet
      const broker = await getBrokerForUser(userId, { allowInactive: true });

      // If we got here, credentials were loaded successfully
      if (broker.status.provider !== 'ibkr') {
        return res.json({
          success: false,
          message: 'Using mock broker - no IBKR credentials configured or credentials are invalid',
          status: 'inactive'
        });
      }

      // Try to get account info as a test
      try {
        const account = await broker.api.getAccount();

        // Update credential status to active
        await db.update(ibkrCredentials)
          .set({
            status: 'active',
            lastConnectedAt: new Date(),
            errorMessage: null,
            updatedAt: new Date()
          })
          .where(eq(ibkrCredentials.userId, userId));

        return res.json({
          success: true,
          message: 'IBKR connection successful',
          status: 'active',
          connected: broker.status.connected,
          environment: broker.status.env,
          account: {
            accountId: account.accountId,
            netValue: account.netValue
          }
        });
      } catch (accountError) {
        // Update credential status to error
        const errorMsg = accountError instanceof Error ? accountError.message : 'Connection test failed';
        await db.update(ibkrCredentials)
          .set({
            status: 'error',
            errorMessage: errorMsg,
            updatedAt: new Date()
          })
          .where(eq(ibkrCredentials.userId, userId));

        return res.json({
          success: false,
          message: `IBKR connection test failed: ${errorMsg}`,
          status: 'error'
        });
      }
    } catch (error) {
      console.error('[Settings] Test IBKR credentials error:', error);
      res.status(500).json({ error: 'Failed to test IBKR credentials' });
    }
  });

  // POST /api/settings/ibkr/activate - Activate credentials (mark as active after successful connection)
  app.post('/api/settings/ibkr/activate', requireAuth, async (req, res) => {
    try {
      const userId = req.user!.id;
      if (!db) {
        return res.status(503).json({ error: 'Database not available' });
      }

      await db.update(ibkrCredentials)
        .set({
          status: 'active',
          lastConnectedAt: new Date(),
          errorMessage: null,
          updatedAt: new Date()
        })
        .where(eq(ibkrCredentials.userId, userId));

      // Clear broker cache to force reload with active credentials
      clearUserBrokerCache(userId);

      return res.json({
        success: true,
        message: 'IBKR credentials activated',
        status: 'active'
      });
    } catch (error) {
      console.error('[Settings] Activate IBKR credentials error:', error);
      res.status(500).json({ error: 'Failed to activate IBKR credentials' });
    }
  });

  // Initialize jobs system (register handlers, seed default jobs)
  await initializeJobsSystem();

  const httpServer = createServer(app);

  // WebSocket server for live data
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  // Select broker provider (mock or ibkr)
  const broker = getBroker();

  // Store WebSocket clients for broadcasting
  const wsClients = new Set<WebSocket>();

  // Export broadcast function for option chain updates (accessible from optionChainStreamer)
  (global as any).broadcastOptionChainUpdate = (message: object) => {
    const json = JSON.stringify(message);
    wsClients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(json);
      }
    });
  };

  wss.on('connection', (ws) => {
    console.log('Client connected to websocket');
    wsClients.add(ws);

    // Send initial data
    ws.send(JSON.stringify({
      type: 'connected',
      message: 'Connected to Orca Options live data feed'
    }));

    // Send initial engine status
    ws.send(JSON.stringify({
      type: 'engine_status',
      data: {
        brokerConnected: broker.status.status === 'Connected',
        brokerProvider: broker.status.provider,
        timestamp: new Date().toISOString()
      }
    }));

    // Real-time data updates (ONLY when IBKR is connected - NO fake data)
    const interval = setInterval(async () => {
      if (ws.readyState === WebSocket.OPEN) {
        // Only send real market data when IBKR is connected
        if (broker.status.provider === 'ibkr') {
          try {
            const { getMarketData, getVIXData } = await import('./services/marketDataService.js');
            const spyData = await getMarketData('SPY');
            const vixData = await getVIXData();

            // Send real price update (replacing the fake data)
            ws.send(JSON.stringify({
              type: 'price_update',
              data: {
                SPY: spyData.price,
                timestamp: new Date().toISOString()
              }
            }));

            ws.send(JSON.stringify({
              type: 'engine_market_data',
              data: {
                spy: {
                  price: spyData.price,
                  change: spyData.changePercent
                },
                vix: {
                  value: vixData.value,
                  change: vixData.changePercent
                },
                timestamp: new Date().toISOString()
              }
            }));

            // Chart price update for real-time current price line
            // Only send if we have a valid price (>0)
            if (spyData.price > 0) {
              ws.send(JSON.stringify({
                type: 'chart_price_update',
                data: {
                  symbol: 'SPY',
                  price: spyData.price,
                  change: spyData.change || 0,
                  changePct: spyData.changePercent || 0,
                  timestamp: Date.now()
                }
              }));
            }
          } catch (error) {
            console.error('[WebSocket] Error fetching market data:', error);
            // Send error status so frontend knows data is unavailable
            ws.send(JSON.stringify({
              type: 'market_data_error',
              error: 'Failed to fetch market data',
              timestamp: new Date().toISOString()
            }));
          }
        } else {
          // No IBKR - send status message instead of fake data
          ws.send(JSON.stringify({
            type: 'market_data_unavailable',
            message: 'IBKR not connected - no real-time data available',
            timestamp: new Date().toISOString()
          }));
        }
      }
    }, 1000); // 1 second interval for live chart updates

    ws.on('close', () => {
      clearInterval(interval);
      wsClients.delete(ws);
      console.log('Client disconnected from websocket');
    });
  });

  // Export broadcast function for engine updates
  (global as any).broadcastEngineUpdate = (data: any) => {
    const message = JSON.stringify({
      type: 'engine_update',
      data,
      timestamp: new Date().toISOString()
    });

    wsClients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  };

  // Account info (via provider) - SECURED: requires auth + user's own IBKR credentials
  app.get('/api/account', requireAuth, async (req, res) => {
    try {
      // Get broker for this specific user (no fallback to shared broker)
      const userBroker = await getBrokerForUser(req.user!.id);

      // Security: if user has no IBKR credentials, return 403
      if (!userBroker.api) {
        return res.status(403).json({
          error: 'No IBKR credentials configured',
          message: 'Please configure your IBKR credentials in Settings'
        });
      }

      if (userBroker.status.provider === 'ibkr') {
        console.log('[API] /api/account: Ensuring IBKR ready...');
        await ensureIbkrReady();
        console.log('[API] /api/account: IBKR ready, fetching account...');
      }
      const account = await userBroker.api.getAccount();
      console.log('[API] /api/account: Success, portfolioValue=', account?.portfolioValue, 'netLiq=', account?.netLiquidation);

      // Calculate Day P&L:
      // - During market hours: currentNav - openingNav
      // - After market close: closingNav - openingNav (final day's P&L)
      // - Fallback: use IBKR's dayPnL
      const currentNav = account?.portfolioValue || 0;
      const userId = req.user!.id;
      let dayPnL = account?.dayPnL || 0; // Default to IBKR's value

      try {
        const openingSnapshot = await getTodayOpeningSnapshot(userId);
        const closingSnapshot = await getTodayClosingSnapshot(userId);

        if (closingSnapshot && openingSnapshot) {
          // After market close: use closing - opening (final day's P&L)
          dayPnL = closingSnapshot.nav - openingSnapshot.nav;
          console.log(`[API] Day P&L (after close): ${closingSnapshot.nav} - ${openingSnapshot.nav} = ${dayPnL}`);
        } else if (openingSnapshot) {
          // During market hours: use current - opening
          dayPnL = currentNav - openingSnapshot.nav;
          console.log(`[API] Day P&L (market open): ${currentNav} - ${openingSnapshot.nav} = ${dayPnL}`);
        } else {
          // No snapshots today - keep IBKR's dayPnL
          console.log(`[API] Day P&L using IBKR value (no snapshots): ${dayPnL}`);
        }
      } catch (err) {
        console.error('[API] Day P&L error:', err);
      }

      // Build response with explicit dayPnL override
      const response = { ...account, dayPnL };
      res.json(response);
    } catch (error: any) {
      console.error('[API] /api/account: FAILED -', error?.message || error);
      const isRetryableError = error?.message?.includes('Gateway') ||
                               error?.message?.includes('authenticated') ||
                               error?.message?.includes('unavailable');
      res.status(isRetryableError ? 503 : 500).json({
        error: isRetryableError ? 'IBKR connection temporarily unavailable' : 'Failed to fetch account info',
        message: error?.message,
        retryable: isRetryableError
      });
    }
  });

  // Positions (via provider) - SECURED: requires auth + user's own IBKR credentials
  app.get('/api/positions', requireAuth, async (req, res) => {
    try {
      // Get broker for this specific user (no fallback to shared broker)
      const userBroker = await getBrokerForUser(req.user!.id);

      // Security: if user has no IBKR credentials, return 403
      if (!userBroker.api) {
        return res.status(403).json({
          error: 'No IBKR credentials configured',
          message: 'Please configure your IBKR credentials in Settings'
        });
      }

      if (userBroker.status.provider === 'ibkr') {
        await ensureIbkrReady();
      }
      const positions = await userBroker.api.getPositions();
      res.json(positions);
    } catch (error: any) {
      console.error('[API] /api/positions: FAILED -', error?.message || error);
      const isRetryableError = error?.message?.includes('Gateway') ||
                               error?.message?.includes('authenticated') ||
                               error?.message?.includes('unavailable');
      res.status(isRetryableError ? 503 : 500).json({
        error: isRetryableError ? 'IBKR connection temporarily unavailable' : 'Failed to fetch positions',
        message: error?.message,
        retryable: isRetryableError
      });
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

  // Paper trades - open positions with stop loss info (filtered by userId)
  app.get('/api/paper-trades/open', requireAuth, async (req, res) => {
    try {
      if (!db) {
        return res.json([]);
      }
      const userId = req.user!.id;
      const openTrades = await db.select().from(paperTrades)
        .where(and(
          eq(paperTrades.status, 'open'),
          eq(paperTrades.userId, userId)
        ))
        .orderBy(desc(paperTrades.createdAt));
      res.json(openTrades);
    } catch (error: any) {
      console.error('[API] /api/paper-trades/open: FAILED -', error?.message || error);
      res.status(500).json({ error: 'Failed to fetch paper trades' });
    }
  });

  // Option chains (via provider) — express v5 does not allow
  // an optional param with a preceding slash; register two routes.
  // SECURED: requires auth + user's own IBKR credentials
  const optionsChainHandler = async (req: any, res: any) => {
    try {
      // Get broker for this specific user (no fallback to shared broker)
      const userBroker = await getBrokerForUser(req.user!.id);

      // Security: if user has no IBKR credentials, return 403
      if (!userBroker.api) {
        return res.status(403).json({
          error: 'No IBKR credentials configured',
          message: 'Please configure your IBKR credentials in Settings'
        });
      }

      const { symbol, expiration } = req.params as { symbol: string; expiration?: string };
      const chain = await userBroker.api.getOptionChain(symbol, expiration);
      res.json(chain);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch option chain' });
    }
  };
  app.get('/api/options/chain/:symbol', requireAuth, optionsChainHandler);
  app.get('/api/options/chain/:symbol/:expiration', requireAuth, optionsChainHandler);

  // Trades list (via provider) - SECURED: requires auth + user's own IBKR credentials
  app.get('/api/trades', requireAuth, async (req, res) => {
    try {
      // Get broker for this specific user (no fallback to shared broker)
      const userBroker = await getBrokerForUser(req.user!.id);

      // Security: if user has no IBKR credentials, return 403
      if (!userBroker.api) {
        return res.status(403).json({
          error: 'No IBKR credentials configured',
          message: 'Please configure your IBKR credentials in Settings'
        });
      }

      const trades = await userBroker.api.getTrades();
      res.json(trades);
    } catch (_error) {
      res.status(500).json({ error: 'Failed to fetch trades' });
    }
  });

  // PnL endpoint for Trades page - merges engine trades, local DB trades, and IBKR executions
  app.get('/api/pnl', requireAuth, async (req, res) => {
    const userId = req.user!.id;
    console.log(`[API][/api/pnl] Request received for user ${userId}`);
    try {
      // Get engine trades from database (real executed trades) - filtered by userId
      let engineTradeRows: any[] = [];
      if (db) {
        try {
          const dbEngineTrades = await db.select().from(paperTrades)
            .where(eq(paperTrades.userId, userId))
            .orderBy(desc(paperTrades.createdAt));
          console.log(`[API][/api/pnl] Engine trades: ${dbEngineTrades.length}`);

          engineTradeRows = dbEngineTrades.map(pt => {
            const entryPremium = parseFloat(pt.entryPremiumTotal as any) || 0;
            const contracts = pt.contracts || 1;
            const realizedPnl = pt.realizedPnl ? parseFloat(pt.realizedPnl as any) : null;

            // Format strategy display: "STRANGLE: PUT $130 + CALL $145"
            let strategyDisplay = pt.strategy;
            if (pt.leg1Type && pt.leg1Strike) {
              strategyDisplay = `${pt.leg1Type} $${parseFloat(pt.leg1Strike as any).toFixed(0)}`;
              if (pt.leg2Type && pt.leg2Strike) {
                strategyDisplay += ` + ${pt.leg2Type} $${parseFloat(pt.leg2Strike as any).toFixed(0)}`;
              }
            }

            return {
              tradeId: pt.id,
              ts: pt.createdAt?.toISOString() || new Date().toISOString(),
              symbol: pt.symbol,
              strategy: strategyDisplay,
              side: 'SELL' as const,
              qty: contracts,
              entry: entryPremium / (contracts * 100), // Per-contract premium
              exit: pt.exitPrice ? parseFloat(pt.exitPrice as any) : null,
              fees: contracts * 2.00, // Estimate $2/contract for options
              realized: realizedPnl !== null ? realizedPnl : (pt.status === 'open' ? 0 : entryPremium),
              run: pt.status === 'open' ? entryPremium : (realizedPnl || 0),
              notes: `${pt.strategy} | ${pt.expirationLabel} | ${pt.status.toUpperCase()}`,
              // Extended info
              ibkrOrderIds: pt.ibkrOrderIds,
              status: pt.status,
              bias: pt.bias,
              expiration: pt.expiration,
            };
          });
        } catch (err) {
          console.warn('[API][/api/pnl] Could not fetch engine trades:', err);
        }
      }

      // Get trades from local DB (legacy trades table)
      const localTrades = await storage.getTrades();
      console.log(`[API][/api/pnl] Local DB trades: ${localTrades.length}`);

      // Also try to get live trades from IBKR
      let ibkrTrades: any[] = [];
      if (broker.status.provider === 'ibkr') {
        console.log('[API][/api/pnl] Fetching IBKR trades...');
        try {
          await ensureIbkrReady();
          ibkrTrades = await broker.api.getTrades();
          console.log(`[API][/api/pnl] IBKR trades fetched: ${ibkrTrades.length}`);
        } catch (err) {
          console.warn('[API][/api/pnl] Could not fetch IBKR trades:', err);
        }
      } else {
        console.log(`[API][/api/pnl] Provider is ${broker.status.provider}, skipping IBKR trades`);
      }

      // Transform local trades to PnlRow format
      const localRows = localTrades.map(trade => {
        const credit = parseFloat(trade.credit) || 0;
        const qty = trade.quantity || 1;
        const entryPerContract = credit / (qty * 100);

        return {
          tradeId: trade.id,
          ts: trade.submittedAt?.toISOString() || new Date().toISOString(),
          symbol: trade.symbol,
          strategy: trade.strategy,
          side: 'SELL' as const,
          qty: qty,
          entry: entryPerContract,
          exit: trade.status === 'filled' ? entryPerContract : null,
          fees: qty * 1.00,
          realized: trade.status === 'filled' ? credit : 0,
          run: trade.status === 'pending' ? 0 : credit,
          notes: `${trade.strategy} ${parseFloat(trade.sellStrike).toFixed(0)} strike - ${trade.status}`,
        };
      });

      // Transform IBKR trades to PnlRow format
      const ibkrRows = ibkrTrades.map(trade => {
        const price = trade.entryFillPrice || parseFloat(trade.credit) || 0;
        const qty = trade.quantity || 1;
        const side = trade.symbol?.includes('P') ? 'PUT' : trade.symbol?.includes('C') ? 'CALL' : trade.strategy;

        return {
          tradeId: trade.id,
          ts: trade.submittedAt?.toISOString?.() || trade.submittedAt || new Date().toISOString(),
          symbol: trade.symbol,
          strategy: side,
          side: (qty < 0 ? 'SELL' : 'BUY') as 'BUY' | 'SELL',
          qty: Math.abs(qty),
          entry: price,
          exit: price, // Executions are filled
          fees: trade.entryCommission || 0,
          realized: trade.netPnl || (price * Math.abs(qty) * 100),
          run: trade.netPnl || 0,
          notes: `IBKR execution`,
        };
      });

      // Merge: engine trades first (primary), then local, then IBKR
      // Deduplicate by tradeId
      const allRows = [...engineTradeRows, ...localRows, ...ibkrRows];
      const seenIds = new Set<string>();
      const uniqueRows = allRows.filter(row => {
        if (seenIds.has(row.tradeId)) return false;
        seenIds.add(row.tradeId);
        return true;
      });

      // Sort by timestamp descending (newest first)
      uniqueRows.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

      res.json(uniqueRows);
    } catch (error) {
      console.error('[API] Failed to fetch PnL:', error);
      res.status(500).json({ error: 'Failed to fetch P&L data' });
    }
  });

  // ==================== CASH FLOWS ====================

  // Get all cash flows (deposits/withdrawals) - filtered by userId
  app.get('/api/cashflows', requireAuth, async (req, res) => {
    try {
      if (!db) {
        return res.json([]);
      }
      const userId = req.user!.id;
      const flows = await db.select().from(cashFlows)
        .where(eq(cashFlows.userId, userId))
        .orderBy(desc(cashFlows.date));
      // Convert decimal to number for frontend
      const result = flows.map(f => ({
        ...f,
        amount: parseFloat(String(f.amount)) || 0,
      }));
      res.json(result);
    } catch (error) {
      console.error('[API] Failed to fetch cash flows:', error);
      res.json([]); // Return empty array on error for graceful degradation
    }
  });

  // Add a new cash flow - attached to user
  app.post('/api/cashflows', requireAuth, async (req, res) => {
    try {
      if (!db) {
        return res.status(503).json({ error: 'Database not configured' });
      }

      const userId = req.user!.id;
      const validation = insertCashFlowSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: 'Invalid cash flow data', details: validation.error.errors });
      }

      const [created] = await db.insert(cashFlows).values({
        date: validation.data.date,
        type: validation.data.type,
        amount: String(validation.data.amount),
        description: validation.data.description,
        userId: userId,
      }).returning();

      res.json({
        ...created,
        amount: parseFloat(String(created.amount)) || 0,
      });
    } catch (error) {
      console.error('[API] Failed to create cash flow:', error);
      res.status(500).json({ error: 'Failed to create cash flow' });
    }
  });

  // ==================== END CASH FLOWS ====================

  // ==================== NAV HISTORY ====================

  // Get NAV history with daily balances - for Track Record Daily Balance tab
  app.get('/api/nav-history', requireAuth, async (req, res) => {
    try {
      if (!db) {
        return res.json({ dailyBalances: [], summary: null });
      }
      const userId = req.user!.id;

      // Fetch all nav snapshots for user, ordered by date ascending
      const snapshots = await db.select().from(navSnapshots)
        .where(eq(navSnapshots.userId, userId))
        .orderBy(asc(navSnapshots.date));

      // Fetch cash flows for adjustment
      const flows = await db.select().from(cashFlows)
        .where(eq(cashFlows.userId, userId));

      // Calculate net cash flows (deposits - withdrawals)
      let totalDeposits = 0;
      let totalWithdrawals = 0;
      flows.forEach(f => {
        const amount = parseFloat(String(f.amount)) || 0;
        if (f.type === 'deposit') totalDeposits += amount;
        else totalWithdrawals += amount;
      });
      const netCashFlows = totalDeposits - totalWithdrawals;

      // Group snapshots by date
      const byDate = new Map<string, { opening?: number; closing?: number }>();
      snapshots.forEach(s => {
        const date = s.date;
        if (!byDate.has(date)) byDate.set(date, {});
        const entry = byDate.get(date)!;
        const nav = parseFloat(String(s.nav)) || 0;
        if (s.snapshotType === 'opening') entry.opening = nav;
        else if (s.snapshotType === 'closing') entry.closing = nav;
      });

      // Build daily balances array
      const dailyBalances: Array<{
        date: string;
        openingNav: number | null;
        closingNav: number | null;
        dailyPnl: number | null;
        cumulativePnl: number;
      }> = [];

      let startingNav: number | null = null;
      let bestDay = { date: '', pnl: -Infinity };
      let worstDay = { date: '', pnl: Infinity };

      // Sort dates ascending
      const sortedDates = Array.from(byDate.keys()).sort();

      sortedDates.forEach(date => {
        const entry = byDate.get(date)!;
        const openingNav = entry.opening ?? null;
        const closingNav = entry.closing ?? null;

        // Track starting NAV (first opening we see)
        if (startingNav === null && openingNav !== null) {
          startingNav = openingNav;
        }

        // Calculate daily P&L (closing - opening for that day)
        let dailyPnl: number | null = null;
        if (openingNav !== null && closingNav !== null) {
          dailyPnl = closingNav - openingNav;
          // Track best/worst days
          if (dailyPnl > bestDay.pnl) bestDay = { date, pnl: dailyPnl };
          if (dailyPnl < worstDay.pnl) worstDay = { date, pnl: dailyPnl };
        }

        // Calculate cumulative P&L (current NAV - starting NAV - net cash flows)
        const currentNav = closingNav ?? openingNav ?? 0;
        const cumulativePnl = startingNav !== null
          ? currentNav - startingNav - netCashFlows
          : 0;

        dailyBalances.push({
          date,
          openingNav,
          closingNav,
          dailyPnl,
          cumulativePnl,
        });
      });

      // Build summary
      const tradingDays = dailyBalances.filter(d => d.dailyPnl !== null).length;
      const latestBalance = dailyBalances[dailyBalances.length - 1];
      const cumulativePnl = latestBalance?.cumulativePnl ?? 0;
      const totalDailyPnl = dailyBalances.reduce((sum, d) => sum + (d.dailyPnl ?? 0), 0);
      const avgDailyPnl = tradingDays > 0 ? totalDailyPnl / tradingDays : 0;

      res.json({
        dailyBalances: dailyBalances.reverse(), // Most recent first
        summary: {
          cumulativePnl,
          tradingDays,
          bestDay: bestDay.pnl !== -Infinity ? bestDay : null,
          worstDay: worstDay.pnl !== Infinity ? worstDay : null,
          avgDailyPnl,
          netCashFlows,
          startingNav,
        }
      });
    } catch (error) {
      console.error('[API] Failed to fetch nav history:', error);
      res.json({ dailyBalances: [], summary: null });
    }
  });

  // ==================== END NAV HISTORY ====================

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

  // Broker status - SECURED: requires auth, returns user-specific status
  app.get('/api/broker/status', requireAuth, async (req, res) => {
    const userBroker = await getBrokerForUser(req.user!.id);
    res.json(userBroker.status);
  });

  // Broker diagnostics - SECURED: requires auth + user's own IBKR credentials
  app.get('/api/broker/diag', requireAuth, async (req, res) => {
    const userBroker = await getBrokerForUser(req.user!.id);
    let last = { oauth: { status: null, ts: '' }, sso: { status: null, ts: '' }, validate: { status: null, ts: '' }, init: { status: null, ts: '' } };

    if (userBroker.status.provider === 'ibkr' && userBroker.api) {
      // Try to establish/verify connection first (same as Engine status)
      try {
        last = await ensureIbkrReady();
      } catch (err) {
        // Fall back to cached diagnostics
        last = getIbkrDiagnostics();
      }
    }

    res.json({ provider: userBroker.status.provider, env: userBroker.status.env, last });
  });

  // Warm the full IBKR flow and return diagnostics (JSON) - SECURED
  app.get('/api/broker/warm', requireAuth, async (req, res) => {
    try {
      const userBroker = await getBrokerForUser(req.user!.id);
      if (userBroker.status.provider !== 'ibkr' || !userBroker.api) {
        return res.status(400).json({ ok: false, error: 'No IBKR credentials configured' });
      }
      const diag = await ensureIbkrReady();
      return res.status(200).json({ ok: true, diag });
    } catch (err: any) {
      const diag = getIbkrDiagnostics();
      return res.status(502).json({ ok: false, error: err?.message || String(err), diag });
    }
  });

  // Test IBKR market data endpoint - SECURED: requires auth + user's own IBKR credentials
  app.get('/api/broker/test-market/:symbol', requireAuth, async (req, res) => {
    try {
      const userBroker = await getBrokerForUser(req.user!.id);
      const symbol = req.params.symbol?.toUpperCase() || 'SPY';
      if (userBroker.status.provider !== 'ibkr' || !userBroker.api) {
        return res.status(400).json({ ok: false, error: 'No IBKR credentials configured' });
      }
      console.log(`[TEST] Calling IBKR getMarketData for ${symbol}...`);
      const data = await userBroker.api.getMarketData(symbol);
      console.log(`[TEST] Got ${symbol} price: $${data.price}`);
      return res.json({ ok: true, source: 'ibkr', data });
    } catch (err: any) {
      console.error(`[TEST] Error getting market data:`, err.message);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Test IBKR option chain endpoint - SECURED: requires auth + user's own IBKR credentials
  app.get('/api/broker/test-options/:symbol', requireAuth, async (req, res) => {
    try {
      const userBroker = await getBrokerForUser(req.user!.id);
      const symbol = req.params.symbol?.toUpperCase() || 'SPY';
      const expiration = req.query.expiration as string | undefined;

      if (userBroker.status.provider !== 'ibkr' || !userBroker.api) {
        return res.status(400).json({ ok: false, error: 'No IBKR credentials configured' });
      }

      console.log(`[TEST] Calling IBKR getOptionChainWithStrikes for ${symbol}...`);
      const { getOptionChainWithStrikes } = await import('./broker/ibkr');

      // Add 30-second timeout to prevent hanging
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Option chain request timed out after 30 seconds')), 30000)
      );
      const data = await Promise.race([
        getOptionChainWithStrikes(symbol, expiration),
        timeoutPromise,
      ]) as Awaited<ReturnType<typeof getOptionChainWithStrikes>>;

      console.log(`[TEST] Got ${symbol} option chain: ${data.puts.length} puts, ${data.calls.length} calls, underlying: $${data.underlyingPrice}, VIX: ${data.vix}`);

      return res.json({
        ok: true,
        source: 'ibkr',
        underlyingPrice: data.underlyingPrice,
        vix: data.vix,
        expectedMove: data.expectedMove,
        strikeRange: {
          low: data.strikeRangeLow,
          high: data.strikeRangeHigh,
          description: `2σ range based on VIX=${data.vix}`
        },
        expiration: expiration || 'next trading day',
        puts: data.puts,
        calls: data.calls,
        isHistorical: data.isHistorical || false,
        summary: {
          putCount: data.puts.length,
          callCount: data.calls.length,
          putStrikeRange: data.puts.length > 0 ? `$${data.puts[0].strike} - $${data.puts[data.puts.length - 1].strike}` : 'N/A',
          callStrikeRange: data.calls.length > 0 ? `$${data.calls[0].strike} - $${data.calls[data.calls.length - 1].strike}` : 'N/A',
          hasGreeks: data.puts.some(p => p.delta !== undefined && p.gamma !== undefined),
          hasOpenInterest: data.puts.some(p => p.openInterest !== undefined),
          hasIV: data.puts.some(p => p.iv !== undefined),
        }
      });
    } catch (err: any) {
      console.error(`[TEST] Error getting option chain:`, err.message);

      // Return static fallback for SPY when IBKR times out (common during off-hours)
      const reqSymbol = req.params.symbol?.toUpperCase() || 'SPY';
      if (reqSymbol === 'SPY' && err.message?.includes('timed out')) {
        console.log(`[TEST] Returning static fallback option chain for SPY`);
        const underlyingPrice = 600; // Approximate SPY price
        const strikes = [585, 590, 595, 600, 605, 610, 615];

        const generateOptions = (strike: number, isCall: boolean) => ({
          strike,
          conid: 0, // Static placeholder
          bid: Math.max(0.05, isCall
            ? Math.max(0.05, underlyingPrice - strike) * 0.1
            : Math.max(0.05, strike - underlyingPrice) * 0.1),
          ask: Math.max(0.10, isCall
            ? Math.max(0.10, underlyingPrice - strike) * 0.12
            : Math.max(0.10, strike - underlyingPrice) * 0.12),
          last: 0,
          delta: isCall
            ? Math.max(0.05, Math.min(0.95, 0.5 + (underlyingPrice - strike) / 50))
            : Math.min(-0.05, Math.max(-0.95, -0.5 + (underlyingPrice - strike) / 50)),
          gamma: 0.02,
          theta: -0.05,
          iv: 0.18,
          openInterest: Math.floor(Math.random() * 10000) + 1000,
          volume: 0,
        });

        return res.json({
          ok: true,
          source: 'static-fallback',
          underlyingPrice,
          vix: 14,
          expectedMove: 8,
          strikeRange: { low: 585, high: 615, description: 'Static fallback range' },
          expiration: 'next trading day',
          puts: strikes.map(s => generateOptions(s, false)),
          calls: strikes.map(s => generateOptions(s, true)),
          isHistorical: true,
          isStaticFallback: true,
          summary: {
            putCount: strikes.length,
            callCount: strikes.length,
            putStrikeRange: `$${strikes[0]} - $${strikes[strikes.length - 1]}`,
            callStrikeRange: `$${strikes[0]} - $${strikes[strikes.length - 1]}`,
            hasGreeks: true,
            hasOpenInterest: true,
            hasIV: true,
          }
        });
      }

      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ============================================
  // IBKR WebSocket Streaming Endpoints
  // ============================================

  // Start IBKR WebSocket streaming connection
  app.post('/api/broker/ws/start', async (_req, res) => {
    try {
      if (broker.status.provider !== 'ibkr') {
        return res.status(400).json({ ok: false, error: 'IBKR not configured' });
      }

      // Ensure IBKR is ready first
      await ensureIbkrReady();

      // Get cookie string and session token for WebSocket authentication
      const cookieString = await getIbkrCookieString();
      if (!cookieString) {
        return res.status(500).json({ ok: false, error: 'Failed to get IBKR cookies' });
      }

      // Get session token for WebSocket authentication (required for IBKR Web API)
      const sessionToken = await getIbkrSessionToken();
      console.log(`[IbkrWS] Got session token: ${sessionToken ? 'yes' : 'no'}`);

      // Initialize WebSocket manager with both cookies and session token
      const wsManager = initIbkrWebSocket(cookieString, sessionToken);

      // Set up callback to broadcast updates to client WebSockets
      wsManager.onUpdate((update: MarketDataUpdate) => {
        const message = JSON.stringify({
          type: 'ibkr_market_data',
          data: update,
          timestamp: new Date().toISOString()
        });

        wsClients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(message);
          }
        });
      });

      // Connect to IBKR WebSocket
      await wsManager.connect();

      console.log('[IbkrWS] WebSocket streaming started');
      return res.json({ ok: true, message: 'IBKR WebSocket streaming started' });
    } catch (err: any) {
      console.error('[IbkrWS] Error starting WebSocket:', err.message);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Stop IBKR WebSocket streaming
  app.post('/api/broker/ws/stop', async (_req, res) => {
    try {
      destroyIbkrWebSocket();
      console.log('[IbkrWS] WebSocket streaming stopped');
      return res.json({ ok: true, message: 'IBKR WebSocket streaming stopped' });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Subscribe to a symbol for streaming
  app.post('/api/broker/ws/subscribe', async (req, res) => {
    try {
      const { symbol, type = 'stock' } = req.body;
      if (!symbol) {
        return res.status(400).json({ ok: false, error: 'Symbol required' });
      }

      const wsManager = getIbkrWebSocketManager();
      if (!wsManager || !wsManager.connected) {
        return res.status(400).json({ ok: false, error: 'WebSocket not connected. Call POST /api/broker/ws/start first' });
      }

      // Resolve symbol to conid
      const conid = await resolveSymbolConid(symbol.toUpperCase());
      if (!conid) {
        return res.status(404).json({ ok: false, error: `Could not resolve conid for symbol: ${symbol}` });
      }

      // Subscribe
      wsManager.subscribe(conid, { symbol: symbol.toUpperCase(), type: type as 'stock' | 'option' });

      console.log(`[IbkrWS] Subscribed to ${symbol} (conid: ${conid})`);
      return res.json({ ok: true, symbol: symbol.toUpperCase(), conid, message: 'Subscribed to streaming' });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Subscribe to multiple option conids for a symbol
  app.post('/api/broker/ws/subscribe-options', async (req, res) => {
    try {
      const { symbol, conids } = req.body;
      if (!symbol || !conids || !Array.isArray(conids)) {
        return res.status(400).json({ ok: false, error: 'Symbol and conids array required' });
      }

      const wsManager = getIbkrWebSocketManager();
      if (!wsManager || !wsManager.connected) {
        return res.status(400).json({ ok: false, error: 'WebSocket not connected. Call POST /api/broker/ws/start first' });
      }

      // Subscribe to each option conid
      for (const conid of conids) {
        wsManager.subscribe(conid, { symbol: symbol.toUpperCase(), type: 'option' });
      }

      console.log(`[IbkrWS] Subscribed to ${conids.length} option contracts for ${symbol}`);
      return res.json({ ok: true, symbol: symbol.toUpperCase(), subscribedCount: conids.length, message: 'Subscribed to option streaming' });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Unsubscribe from a symbol
  app.delete('/api/broker/ws/subscribe/:symbol', async (req, res) => {
    try {
      const symbol = req.params.symbol?.toUpperCase();
      if (!symbol) {
        return res.status(400).json({ ok: false, error: 'Symbol required' });
      }

      const wsManager = getIbkrWebSocketManager();
      if (!wsManager) {
        return res.status(400).json({ ok: false, error: 'WebSocket not initialized' });
      }

      // Resolve symbol to conid
      const conid = await resolveSymbolConid(symbol);
      if (conid) {
        wsManager.unsubscribe(conid);
        console.log(`[IbkrWS] Unsubscribed from ${symbol} (conid: ${conid})`);
      }

      return res.json({ ok: true, symbol, message: 'Unsubscribed from streaming' });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // SECURED: Get WebSocket status (requires authentication)
  app.get('/api/broker/ws/status', requireAuth, async (req, res) => {
    try {
      // Check if user has IBKR credentials
      const userBroker = await getBrokerForUser(req.user!.id);
      if (!userBroker.api || userBroker.status.provider === 'none') {
        return res.json({
          ok: true,
          initialized: false,
          connected: false,
          subscriptions: [],
          message: 'No IBKR credentials configured for your account'
        });
      }

      const wsManager = getIbkrWebSocketManager();
      if (!wsManager) {
        return res.json({
          ok: true,
          initialized: false,
          connected: false,
          subscriptions: [],
          message: 'WebSocket manager not initialized'
        });
      }

      const subscriptions: Array<{ conid: number; symbol?: string; type: string }> = [];
      wsManager.getSubscriptions().forEach((sub, conid) => {
        subscriptions.push({ conid, symbol: sub.symbol, type: sub.type });
      });

      return res.json({
        ok: true,
        initialized: true,
        connected: wsManager.connected,
        subscriptions,
        subscriptionCount: subscriptions.length
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ============================================
  // End of IBKR WebSocket Streaming Endpoints
  // ============================================

  // ============================================
  // Option Chain Streamer Endpoints (for Engine)
  // ============================================

  // SECURED: Start option chain streaming for a symbol (for engine strike selection)
  app.post('/api/broker/stream/start', requireAuth, async (req, res) => {
    try {
      // Check if user has IBKR credentials
      const userBroker = await getBrokerForUser(req.user!.id);
      if (!userBroker.api || userBroker.status.provider === 'none') {
        return res.status(403).json({
          ok: false,
          error: 'No IBKR credentials configured for your account'
        });
      }

      const { symbol = 'SPY' } = req.body || {};
      console.log(`[API] Starting option chain streaming for ${symbol}`);

      const streamer = getOptionChainStreamer();
      await streamer.startStreaming(symbol);

      const status = streamer.getStatus();
      return res.json({
        ok: true,
        message: `Option chain streaming started for ${symbol}`,
        status
      });
    } catch (err: any) {
      console.error('[API] Failed to start option chain streaming:', err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // SECURED: Stop option chain streaming for a symbol
  app.post('/api/broker/stream/stop', requireAuth, async (req, res) => {
    try {
      // Check if user has IBKR credentials
      const userBroker = await getBrokerForUser(req.user!.id);
      if (!userBroker.api || userBroker.status.provider === 'none') {
        return res.status(403).json({
          ok: false,
          error: 'No IBKR credentials configured for your account'
        });
      }

      const { symbol } = req.body || {};

      const streamer = getOptionChainStreamer();

      if (symbol) {
        streamer.stopStreaming(symbol);
        return res.json({
          ok: true,
          message: `Option chain streaming stopped for ${symbol}`,
          status: streamer.getStatus()
        });
      } else {
        streamer.stopAll();
        return res.json({
          ok: true,
          message: 'All option chain streaming stopped',
          status: streamer.getStatus()
        });
      }
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // SECURED: Get option chain streamer status
  app.get('/api/broker/stream/status', requireAuth, async (req, res) => {
    try {
      // Check if user has IBKR credentials
      const userBroker = await getBrokerForUser(req.user!.id);
      if (!userBroker.api || userBroker.status.provider === 'none') {
        return res.json({
          ok: true,
          streaming: false,
          symbols: [],
          message: 'No IBKR credentials configured for your account'
        });
      }

      const streamer = getOptionChainStreamer();
      const status = streamer.getStatus();

      return res.json({
        ok: true,
        ...status
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // SECURED: Get cached option chain (what the engine sees)
  app.get('/api/broker/stream/chain/:symbol', requireAuth, async (req, res) => {
    try {
      // Check if user has IBKR credentials
      const userBroker = await getBrokerForUser(req.user!.id);
      if (!userBroker.api || userBroker.status.provider === 'none') {
        return res.status(403).json({
          ok: false,
          error: 'No IBKR credentials configured for your account'
        });
      }

      const { symbol } = req.params;
      const streamer = getOptionChainStreamer();
      const chain = streamer.getOptionChain(symbol);

      if (!chain) {
        return res.json({
          ok: true,
          cached: false,
          message: `No cached option chain for ${symbol}. Start streaming first or cache is stale.`
        });
      }

      return res.json({
        ok: true,
        cached: true,
        chain: {
          symbol: chain.symbol,
          underlyingPrice: chain.underlyingPrice,
          vix: chain.vix,
          expectedMove: chain.expectedMove,
          strikeRange: `$${chain.strikeRangeLow} - $${chain.strikeRangeHigh}`,
          dataSource: chain.dataSource,
          lastUpdate: chain.lastUpdate,
          putsCount: chain.puts.length,
          callsCount: chain.calls.length,
          puts: chain.puts.map(p => ({
            strike: p.strike,
            bid: p.bid,
            ask: p.ask,
            delta: p.delta,
            lastUpdate: p.lastUpdate
          })),
          calls: chain.calls.map(c => ({
            strike: c.strike,
            bid: c.bid,
            ask: c.ask,
            delta: c.delta,
            lastUpdate: c.lastUpdate
          }))
        }
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Schedule auto-start at market open
  app.post('/api/broker/stream/schedule', async (req, res) => {
    try {
      const { symbol = 'SPY' } = req.body || {};
      console.log(`[API] Scheduling option chain streaming for ${symbol} at market open`);

      const streamer = getOptionChainStreamer();
      streamer.scheduleMarketOpenStart(symbol);

      return res.json({
        ok: true,
        message: `Option chain streaming scheduled for ${symbol} at next market open (9:30 AM ET)`,
        status: streamer.getStatus()
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Simple market snapshot - gets SPY/VIX with hybrid data sources
  // Primary: IBKR WebSocket during market hours
  // Fallback: Yahoo Finance for extended hours or when IBKR unavailable
  app.get('/api/broker/stream/snapshot', requireAuth, async (req, res) => {
    try {
      // Determine market state
      const now = new Date();
      const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const hours = et.getHours();
      const minutes = et.getMinutes();
      const day = et.getDay();
      const totalMinutes = hours * 60 + minutes;

      // Market hours: 9:30 AM - 4:00 PM ET (Mon-Fri)
      const marketOpen = 9 * 60 + 30;
      const marketClose = 16 * 60;
      // Extended hours: 4:00 AM - 8:00 PM ET
      const extendedOpen = 4 * 60;
      const extendedClose = 20 * 60;

      let marketState: 'PRE' | 'REGULAR' | 'POST' | 'CLOSED';
      if (day === 0 || day === 6) {
        marketState = 'CLOSED';
      } else if (totalMinutes >= marketOpen && totalMinutes < marketClose) {
        marketState = 'REGULAR';
      } else if (totalMinutes >= extendedOpen && totalMinutes < marketOpen) {
        marketState = 'PRE';
      } else if (totalMinutes >= marketClose && totalMinutes < extendedClose) {
        marketState = 'POST';
      } else {
        marketState = 'CLOSED';
      }

      // Try IBKR WebSocket first during market hours
      if (marketState === 'REGULAR') {
        const wsManager = getIbkrWebSocketManager();
        if (wsManager?.connected) {
          const SPY_CONID = 756733;
          const VIX_CONID = 13455763;
          const spyData = wsManager.getCachedMarketData(SPY_CONID);
          const vixData = wsManager.getCachedMarketData(VIX_CONID);

          if (spyData?.last && spyData.last > 0) {
            return res.json({
              ok: true,
              available: true,
              source: 'ibkr',
              marketState,
              snapshot: {
                spyPrice: spyData.last,
                spyChange: 0, // IBKR WebSocket doesn't provide change
                spyChangePct: 0,
                vix: vixData?.last || 0,
                vixChange: 0,
                vixChangePct: 0,
                timestamp: new Date().toISOString()
              }
            });
          }
        }
      }

      // Fall back to Yahoo Finance for extended hours or when IBKR unavailable
      if (marketState !== 'CLOSED') {
        try {
          const yahoo = await fetchYahooSnapshot();
          return res.json({
            ok: true,
            available: true,
            source: 'yahoo',
            marketState,
            snapshot: {
              spyPrice: yahoo.spy.price,
              spyChange: yahoo.spy.change,
              spyChangePct: yahoo.spy.changePercent,
              vix: yahoo.vix.current,
              vixChange: yahoo.vix.change,
              vixChangePct: yahoo.vix.changePercent,
              timestamp: yahoo.timestamp.toISOString()
            }
          });
        } catch (yahooErr) {
          console.error('[Snapshot] Yahoo Finance fallback failed:', yahooErr);
        }
      }

      // Market closed - no data available
      return res.json({
        ok: true,
        available: false,
        source: 'none',
        marketState,
        message: marketState === 'CLOSED' ? 'Market is closed' : 'No data source available'
      });

    } catch (err: any) {
      console.error('[Snapshot] Error:', err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ============================================
  // End of Option Chain Streamer Endpoints
  // ============================================

  // IBKR Status endpoint - shows connection status and configuration
  // SECURED: Returns user-specific IBKR status (not global server config)
  app.get('/api/ibkr/status', requireAuth, async (req, res) => {
    try {
      const userId = req.user!.id;
      console.log(`[IBKR Status] Checking credentials for user: ${userId}`);

      // Get broker for this specific user (no fallback to shared broker)
      const userBroker = await getBrokerForUser(userId);

      // If user has no IBKR credentials configured, return unconfigured status
      if (!userBroker.api || userBroker.status.provider === 'none') {
        console.log(`[IBKR Status] User ${userId} has no credentials: provider=${userBroker.status.provider}`);
        return res.json({
          configured: false,
          connected: false,
          environment: 'paper',
          multiUserMode: true,  // Always show multi-user mode is enabled
          message: 'No IBKR credentials configured for your account. Configure them in the Settings page.'
        });
      }

      // User has credentials - get their connection status
      const diag = getIbkrDiagnostics();

      // Check all 4 authentication steps
      const allStepsConnected =
        diag.oauth.status === 200 &&
        diag.sso.status === 200 &&
        diag.validate.status === 200 &&
        diag.init.status === 200;

      // Get user's credential info from database (masked)
      let accountId = 'Configured';
      let clientId = 'Configured';
      if (db) {
        const creds = await db.select().from(ibkrCredentials)
          .where(eq(ibkrCredentials.userId, req.user!.id))
          .limit(1);
        if (creds.length > 0) {
          accountId = creds[0].accountId || 'Not set';
          clientId = creds[0].clientId.substring(0, 10) + '***';
        }
      }

      return res.json({
        configured: true,
        connected: allStepsConnected,
        environment: userBroker.status.env,
        accountId,
        clientId,
        multiUserMode: true, // Always true in multi-tenant mode
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
          },
          // WebSocket status for real-time data streaming
          websocket: (() => {
            const wsStatus = getIbkrWebSocketStatus();
            if (!wsStatus) {
              return {
                status: 0,
                message: 'Not initialized',
                success: false,
                connected: false,
                authenticated: false,
                subscriptions: 0
              };
            }
            return {
              status: wsStatus.connected && wsStatus.authenticated ? 200 : (wsStatus.connected ? 100 : 0),
              message: wsStatus.connected && wsStatus.authenticated
                ? `Streaming (${wsStatus.subscriptions} subs)`
                : wsStatus.connected
                  ? 'Connected (authenticating...)'
                  : 'Disconnected',
              success: wsStatus.connected && wsStatus.authenticated,
              connected: wsStatus.connected,
              authenticated: wsStatus.authenticated,
              subscriptions: wsStatus.subscriptions
            };
          })()
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

  // SECURED: IBKR Test Connection endpoint - attempts to connect and validate for user
  app.post('/api/ibkr/test', requireAuth, async (req, res) => {
    try {
      // Get broker for this specific user (no fallback to shared broker)
      const userBroker = await getBrokerForUser(req.user!.id);

      // If user has no IBKR credentials configured, return error
      if (!userBroker.api || userBroker.status.provider === 'none') {
        return res.json({
          success: false,
          message: 'No IBKR credentials configured for your account. Configure them in the Settings page.'
        });
      }

      // Try to ensure IBKR is ready (uses global connection for now)
      // TODO: In the future, each user should have their own connection
      const diag = await ensureIbkrReady();

      const allConnected =
        diag.oauth.status === 200 &&
        diag.sso.status === 200 &&
        diag.validate.status === 200 &&
        diag.init.status === 200;

      // If all steps are successful, establish the gateway for future orders
      if (allConnected) {
        console.log('[IBKR Test] All auth steps successful, establishing gateway for trading...');
        try {
          // Call the establishGateway to prepare for trading
          if (userBroker.api && 'establishGateway' in userBroker.api) {
            await (userBroker.api as any).establishGateway();
            console.log('[IBKR Test] Gateway established successfully');
          }
        } catch (err) {
          console.error('[IBKR Test] Failed to establish gateway:', err);
        }
      }

      return res.json({
        success: allConnected,
        message: allConnected
          ? 'IBKR connected successfully! You can now place orders using the Test Order button.'
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

  // IBKR Test Order endpoint - places a test order for 1 SPY share
  app.post('/api/ibkr/test-order', async (req, res) => {
    try {
      if (broker.status.provider !== 'ibkr') {
        return res.status(400).json({
          success: false,
          message: 'IBKR provider not configured'
        });
      }

      // Get the IBKR client
      const ibkrClient = broker.api as any;

      // Ensure we're connected
      await ensureIbkrReady();

      // Get order details from request body or use defaults
      const {
        symbol = 'SPY',
        side = 'BUY',
        quantity = 1,
        orderType = 'MKT'
      } = req.body;

      // Place the stock order
      const result = await ibkrClient.placeStockOrder(
        symbol,
        side,
        quantity,
        { orderType, tif: 'DAY', outsideRth: false }
      );

      // Log to audit trail
      await storage.createAuditLog({
        eventType: 'IBKR_TEST_ORDER',
        details: `${side} ${quantity} ${symbol} @ ${orderType}`,
        userId: 'test',
        status: result.status === 'submitted' ? 'SUCCESS' : 'FAILED'
      });

      return res.json({
        success: result.status === 'submitted',
        message: result.status === 'submitted'
          ? `Test order placed: ${side} ${quantity} ${symbol}`
          : `Order failed: ${result.status}`,
        orderId: result.id,
        status: result.status,
        details: result.raw
      });
    } catch (error: any) {
      console.error('[IBKR][TestOrder] Error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to place test order',
        error: error.message || String(error)
      });
    }
  });

  // IBKR Clear All Orders endpoint
  app.post('/api/ibkr/clear-orders', async (req, res) => {
    console.log('[IBKR][ClearOrders] Request to clear all open orders');

    try {
      // Ensure user is authenticated
      const session = await getSessionFromRequest(req);
      if (!session) {
        return res.status(401).json({
          success: false,
          message: 'Not authenticated'
        });
      }

      // Check IBKR configuration
      if (broker.status.provider !== 'ibkr') {
        return res.status(400).json({
          success: false,
          message: 'IBKR broker not configured'
        });
      }

      // Import the clear orders function
      const { clearAllPaperOrders } = await import('./broker/ibkr');

      // Clear all open orders
      const result = await clearAllPaperOrders();

      // Log to audit trail
      await storage.createAuditLog({
        eventType: 'IBKR_CLEAR_ORDERS',
        details: `Cleared ${result.cleared} open order(s)`,
        userId: session.userId || 'unknown',
        status: result.success ? 'SUCCESS' : 'PARTIAL'
      });

      return res.json(result);
    } catch (error: any) {
      console.error('[IBKR][ClearOrders] Error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to clear orders',
        cleared: 0,
        errors: [error.message || String(error)]
      });
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
      return res.status(400).json({
        error: 'Set BROKER_PROVIDER=ibkr for paper order test',
        success: false,
        message: 'IBKR provider not configured'
      });
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

      // Ensure IBKR is ready before placing order
      await ensureIbkrReady();

      const result = await placePaperStockOrder({ symbol, side, quantity, orderType, limitPrice, tif, outsideRth });

      // Check if order was rejected or failed
      if ((result.status || '').startsWith('rejected')) {
        console.error('[IBKR] Order rejected:', result);
        return res.status(502).json({
          success: false,
          error: 'Order rejected by IBKR',
          message: `Order rejected: ${result.status}`,
          details: result.raw,
          result
        });
      }

      // Check if we got a valid order ID
      if (!result.id) {
        console.warn('[IBKR] Order placed but no ID returned:', result);
        // Still return success if status is "submitted" but warn about missing ID
        if (result.status === 'submitted') {
          return res.json({
            success: true,
            warning: 'Order submitted but ID not returned',
            message: 'Order submitted (ID pending)',
            orderId: null,
            result
          });
        } else {
          return res.status(502).json({
            success: false,
            error: 'Order failed',
            message: 'Failed to place order - no order ID received',
            details: result.raw,
            result
          });
        }
      }

      // Success with order ID
      return res.json({
        success: true,
        orderId: result.id,
        message: `Order ${result.id} submitted successfully`,
        result
      });
    } catch (err: any) {
      console.error('[IBKR] Order placement error:', err);
      // Check for specific IBKR errors
      if (err?.message?.includes('Gateway connection failed')) {
        return res.status(503).json({
          success: false,
          error: 'Gateway not connected',
          message: 'IBKR gateway connection failed - please reconnect',
          details: err?.message
        });
      }
      if (err?.message?.includes('not initialized')) {
        return res.status(503).json({
          success: false,
          error: 'IBKR not initialized',
          message: 'IBKR client not initialized - please check configuration',
          details: err?.message
        });
      }
      return res.status(400).json({
        success: false,
        error: err?.message || 'invalid_request',
        message: `Order failed: ${err?.message || 'Invalid request'}`,
        details: err?.stack
      });
    }
  });

  // SECURED: List open orders (paper)
  app.get('/api/broker/orders', requireAuth, async (req, res) => {
    // Check if user has IBKR credentials
    const userBroker = await getBrokerForUser(req.user!.id);
    if (!userBroker.api || userBroker.status.provider === 'none') {
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

  // SECURED: Trading Engine endpoints
  app.get('/api/engine/status', requireAuth, async (req, res) => {
    try {
      // Check if user has IBKR credentials
      const userBroker = await getBrokerForUser(req.user!.id);
      if (!userBroker.api || userBroker.status.provider === 'none') {
        return res.json({
          timestamp: new Date().toISOString(),
          canTrade: false,
          reason: 'No IBKR credentials configured for your account',
          summary: null,
          steps: []
        });
      }

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

  // Audit logs
  app.get('/api/logs', async (req, res) => {
    try {
      const logs = await storage.getAuditLogs();
      res.json(logs);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch audit logs' });
    }
  });

  // ============================================
  // Chart Historical Data API (Database + IBKR)
  // ============================================
  // Import historical service and market hours utility
  const { fetchHistoricalBars, getRecentBars, clearHistoricalCache, getCacheStatus } = await import('./services/ibkrHistoricalService');
  const { getMarketStatus } = await import('./utils/marketHours');

  // Import database-backed ingestion service
  const {
    ingestHistoricalData,
    ingestIncrementalData,
    getIngestionProgress,
    getAllIngestionProgress,
    getStorageStats,
    clearStoredData,
  } = await import('./services/historicalDataIngestion');
  type BarInterval = '1m' | '5m' | '15m' | '1h' | '1D' | '1W' | '1M';

  // Import database and schema for chart queries
  const { db: chartDb } = await import('./db');
  const { marketData: chartMarketData } = await import('@shared/schema');
  const { eq, and, gte, asc, desc, sql } = await import('drizzle-orm');

  // ============================================
  // Database-Backed Chart Data API (Fast, Reliable)
  // ============================================

  // Time range to lookback period mapping
  const RANGE_TO_MS: Record<string, number> = {
    '1D': 1 * 24 * 60 * 60 * 1000,
    '5D': 5 * 24 * 60 * 60 * 1000,
    '1M': 30 * 24 * 60 * 60 * 1000,
    '3M': 90 * 24 * 60 * 60 * 1000,
    '6M': 180 * 24 * 60 * 60 * 1000,
    'YTD': 0, // Special case: calculated from Jan 1
    '1Y': 365 * 24 * 60 * 60 * 1000,
    '5Y': 5 * 365 * 24 * 60 * 60 * 1000,
    'MAX': 20 * 365 * 24 * 60 * 60 * 1000, // 20 years
  };

  // Default interval for each range
  const RANGE_DEFAULT_INTERVAL: Record<string, string> = {
    '1D': '1m',
    '5D': '5m',
    '1M': '1h',
    '3M': '1D',
    '6M': '1D',
    'YTD': '1D',
    '1Y': '1D',
    '5Y': '1W',
    'MAX': '1M',
  };

  // GET /api/chart/data/:symbol - Fetch chart data from DATABASE (fast, reliable)
  // Query params:
  //   range: 1D, 5D, 1M, 3M, 6M, YTD, 1Y, 5Y, MAX
  //   interval: 1m, 5m, 15m, 1h, 1D, 1W, 1M
  //   rth: true (default) - Regular Trading Hours only (9:30 AM - 4:00 PM ET)
  //        false - Include extended hours (pre-market, after-hours)
  app.get('/api/chart/data/:symbol', async (req, res) => {
    const { symbol } = req.params;
    const range = (req.query.range as string) || '1D';
    const interval = (req.query.interval as string) || RANGE_DEFAULT_INTERVAL[range] || '5m';
    // RTH filter: default true (show only regular trading hours)
    const rthOnly = req.query.rth !== 'false';

    try {
      if (!chartDb) {
        return res.status(503).json({
          error: 'Database not configured',
          message: 'DATABASE_URL environment variable not set',
        });
      }

      // Calculate start time based on range
      let startTime: Date;
      if (range === 'YTD') {
        const now = new Date();
        startTime = new Date(now.getFullYear(), 0, 1); // Jan 1 of current year
      } else {
        const lookbackMs = RANGE_TO_MS[range] || RANGE_TO_MS['1D'];
        startTime = new Date(Date.now() - lookbackMs);
      }

      console.log(`[Chart DB] Fetching ${symbol} ${interval} bars from ${startTime.toISOString()} (range=${range}, rth=${rthOnly})`);

      // Determine if RTH filter should be applied (only for intraday intervals)
      const intradayIntervals = ['1m', '5m', '15m', '1h'];
      const shouldFilterRth = rthOnly && intradayIntervals.includes(interval);

      // Build WHERE conditions
      const conditions = [
        eq(chartMarketData.symbol, symbol.toUpperCase()),
        eq(chartMarketData.interval, interval),
        gte(chartMarketData.timestamp, startTime),
      ];

      // Add RTH filter: 9:30 AM - 4:00 PM ET (regular trading hours)
      // Using UTC hours adjusted for ET (-5 hours, or -4 during DST)
      // For simplicity, filter to 14:30 - 21:00 UTC (9:30 AM - 4:00 PM ET in standard time)
      // This is a rough approximation; proper timezone handling would use AT TIME ZONE
      if (shouldFilterRth) {
        conditions.push(
          sql`(
            (EXTRACT(hour FROM ${chartMarketData.timestamp}) = 14 AND EXTRACT(minute FROM ${chartMarketData.timestamp}) >= 30)
            OR (EXTRACT(hour FROM ${chartMarketData.timestamp}) >= 15 AND EXTRACT(hour FROM ${chartMarketData.timestamp}) < 21)
          )`
        );
      }

      // Query database
      const bars = await chartDb
        .select()
        .from(chartMarketData)
        .where(and(...conditions))
        .orderBy(asc(chartMarketData.timestamp));

      // Get market status
      const marketStatus = getMarketStatus();

      // Format response
      return res.json({
        symbol: symbol.toUpperCase(),
        range,
        interval,
        rthOnly,  // Include RTH filter status in response
        count: bars.length,
        source: 'database',
        cached: false,
        marketStatus,
        bars: bars.map(bar => ({
          time: Math.floor(bar.timestamp.getTime() / 1000), // Unix timestamp in seconds
          open: parseFloat(bar.open),
          high: parseFloat(bar.high),
          low: parseFloat(bar.low),
          close: parseFloat(bar.close),
          volume: bar.volume || 0,
        })),
      });
    } catch (error: any) {
      console.error('[Chart DB] Error fetching data:', error.message);
      return res.status(500).json({
        error: 'Failed to fetch chart data from database',
        message: error.message,
        symbol,
        range,
        interval,
      });
    }
  });

  // GET /api/chart/stats - Get storage statistics
  app.get('/api/chart/stats', async (req, res) => {
    try {
      const symbol = req.query.symbol as string | undefined;
      const stats = await getStorageStats(symbol);
      return res.json({
        success: true,
        ...stats,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // ============================================
  // Admin Ingestion API (Trigger historical data fetch)
  // ============================================

  // POST /api/admin/ingest/:symbol - Trigger ingestion for a symbol
  app.post('/api/admin/ingest/:symbol', async (req, res) => {
    const { symbol } = req.params;
    const intervals = (req.body.intervals as BarInterval[]) || ['1m', '5m', '15m', '1h', '1D'];

    try {
      // Start ingestion asynchronously
      console.log(`[Admin] Starting ingestion for ${symbol} with intervals: ${intervals.join(', ')}`);

      // Don't await - let it run in background
      ingestHistoricalData(symbol.toUpperCase(), intervals)
        .then(results => {
          console.log(`[Admin] Ingestion completed for ${symbol}:`, results);
        })
        .catch(err => {
          console.error(`[Admin] Ingestion failed for ${symbol}:`, err);
        });

      return res.json({
        success: true,
        message: `Ingestion started for ${symbol}`,
        symbol: symbol.toUpperCase(),
        intervals,
        statusUrl: `/api/admin/ingest/status/${symbol}`,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // GET /api/admin/ingest/status - Get all ingestion progress
  app.get('/api/admin/ingest/status', async (_req, res) => {
    try {
      const allProgress = getAllIngestionProgress();
      return res.json({
        success: true,
        activeIngestions: allProgress.length,
        ingestions: allProgress,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // GET /api/admin/ingest/status/:symbol - Get ingestion progress for a symbol
  app.get('/api/admin/ingest/status/:symbol', async (req, res) => {
    try {
      const { symbol } = req.params;
      const progress = getIngestionProgress(symbol.toUpperCase());

      if (!progress) {
        return res.json({
          success: true,
          found: false,
          message: `No active or recent ingestion for ${symbol}`,
        });
      }

      return res.json({
        success: true,
        found: true,
        ...progress,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // DELETE /api/admin/data/:symbol - Clear stored data for a symbol
  app.delete('/api/admin/data/:symbol', async (req, res) => {
    try {
      const { symbol } = req.params;
      const interval = req.query.interval as string | undefined;

      const deletedCount = await clearStoredData(symbol.toUpperCase(), interval as BarInterval);

      return res.json({
        success: true,
        deletedCount,
        message: `Deleted ${deletedCount} bars for ${symbol}${interval ? ` (${interval})` : ''}`,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // GET /api/chart/history/:symbol - Fetch historical bars from IBKR
  app.get('/api/chart/history/:symbol', async (req, res) => {
    // Extract params outside try block so they're available in catch
    const { symbol } = req.params;
    const timeframe = (req.query.timeframe as string) || '5m';
    const count = parseInt(req.query.count as string) || 200;
    const forceRefresh = req.query.refresh === 'true';

    try {
      // Validate timeframe
      const validTimeframes = ['1m', '5m', '15m', '1h', '1D'];
      if (!validTimeframes.includes(timeframe)) {
        return res.status(400).json({
          error: `Invalid timeframe. Must be one of: ${validTimeframes.join(', ')}`,
          validTimeframes,
        });
      }

      console.log(`[Chart] Fetching ${symbol} ${timeframe} bars (count=${count}, refresh=${forceRefresh})`);

      // Check if IBKR is configured
      if (broker.status.provider !== 'ibkr') {
        return res.status(503).json({
          error: 'IBKR broker not configured. Chart requires live IBKR data.',
          provider: broker.status.provider,
        });
      }

      // Fetch bars from IBKR
      const bars = await getRecentBars(symbol, timeframe as any, count);

      // Get current market status
      const marketStatus = getMarketStatus();

      return res.json({
        symbol,
        timeframe,
        count: bars.length,
        source: 'ibkr',
        marketStatus,
        bars: bars.map(bar => ({
          time: bar.time,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          volume: bar.volume,
        })),
      });
    } catch (error: any) {
      console.error('[Chart] Historical data error:', error.message);

      // Return appropriate status code based on error type
      const isTimeout = error.message?.includes('timeout');
      const statusCode = isTimeout ? 504 : 500;

      return res.status(statusCode).json({
        error: isTimeout
          ? 'IBKR data temporarily unavailable. Please try again in a few seconds.'
          : 'Failed to fetch historical data from IBKR',
        message: error.message || String(error),
        symbol,
        timeframe,
        marketStatus: getMarketStatus(),
      });
    }
  });

  // POST /api/chart/cache/clear - Clear historical data cache
  app.post('/api/chart/cache/clear', async (req, res) => {
    try {
      const { symbol } = req.body;
      clearHistoricalCache(symbol);
      return res.json({
        success: true,
        message: symbol ? `Cache cleared for ${symbol}` : 'All cache cleared',
      });
    } catch (error: any) {
      return res.status(500).json({
        error: 'Failed to clear cache',
        message: error.message,
      });
    }
  });

  // GET /api/chart/cache/status - Get cache status
  app.get('/api/chart/cache/status', async (_req, res) => {
    try {
      const status = getCacheStatus();
      return res.json(status);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  // GET /api/chart/bounds/:symbol - Get engine-selected strikes for chart overlay
  // Returns the trading engine's selected PUT/CALL strikes as chart bounds
  app.get('/api/chart/bounds/:symbol', async (req, res) => {
    try {
      const { symbol } = req.params;

      // Import step3 selectStrikes function
      const { selectStrikes } = await import('./engine/step3.js');

      // Get current underlying price from IBKR
      let underlyingPrice = 0;
      try {
        const marketData = await broker.api.getMarketData(symbol);
        underlyingPrice = marketData?.price || 0;
      } catch (err) {
        console.warn('[Chart Bounds] Could not fetch market data, using default:', err);
      }

      // If we couldn't get a live price, try from recent historical bars
      if (underlyingPrice === 0) {
        try {
          const recentBars = getRecentBars(symbol, 1);
          if (recentBars && recentBars.length > 0) {
            underlyingPrice = recentBars[0].close;
          }
        } catch (err) {
          console.warn('[Chart Bounds] Could not get recent bars:', err);
        }
      }

      // Get strikes for STRANGLE (both PUT and CALL)
      const selection = await selectStrikes('STRANGLE', underlyingPrice, symbol);

      // Format response
      const response = {
        symbol,
        underlyingPrice,
        putStrike: selection.putStrike ? {
          strike: selection.putStrike.strike,
          delta: selection.putStrike.delta,
          premium: (selection.putStrike.bid + selection.putStrike.ask) / 2,
          bid: selection.putStrike.bid,
          ask: selection.putStrike.ask,
        } : null,
        callStrike: selection.callStrike ? {
          strike: selection.callStrike.strike,
          delta: selection.callStrike.delta,
          premium: (selection.callStrike.bid + selection.callStrike.ask) / 2,
          bid: selection.callStrike.bid,
          ask: selection.callStrike.ask,
        } : null,
        winZone: selection.putStrike && selection.callStrike ? {
          low: selection.putStrike.strike,
          high: selection.callStrike.strike,
          width: selection.callStrike.strike - selection.putStrike.strike,
        } : null,
        expectedPremium: selection.expectedPremium,
        marginRequired: selection.marginRequired,
        reasoning: selection.reasoning,
        timestamp: new Date().toISOString(),
        source: 'engine',
        expiration: '0DTE',
      };

      return res.json(response);
    } catch (error: any) {
      console.error('[Chart Bounds] Error:', error);
      return res.status(500).json({
        error: 'Failed to fetch chart bounds',
        message: error.message || String(error),
      });
    }
  });

  // ============================================
  // Auto-schedule Option Chain Streaming at Market Open
  // ============================================
  // Initialize the option chain streamer and schedule it to auto-start
  // at 9:30 AM ET on trading days. This ensures the engine has fresh
  // option data when the trading window opens at 11:00 AM ET.
  try {
    console.log('[Server] Scheduling option chain streamer for market open (9:30 AM ET)');
    initOptionChainStreamer({ autoSchedule: true, symbol: 'SPY' });
  } catch (err) {
    console.error('[Server] Failed to initialize option chain streamer:', err);
  }

  return httpServer;
}
