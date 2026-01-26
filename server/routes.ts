// @ts-nocheck
// TODO: Add proper null checks for db and broker.api
import type { Express } from "express";
import { createServer, type Server } from "http";
import WebSocket, { WebSocketServer } from "ws";
import { storage } from "./storage";
import { getBrokerForUser, clearUserBrokerCache } from "./broker";
import { getIbkrDiagnostics, getDiagnosticsFromClient, ensureIbkrReady, ensureClientReady, placePaperStockOrder, placePaperOptionOrder, listPaperOpenOrders, getIbkrCookieString, getIbkrSessionToken, getCookieStringFromClient, getSessionTokenFromClient, resolveSymbolConid } from "./broker/ibkr";
import { IbkrWebSocketManager, initIbkrWebSocket, getIbkrWebSocketManager, destroyIbkrWebSocket, getIbkrWebSocketStatus, getIbkrWebSocketDetailedStatus, type MarketDataUpdate, wsManagerInstance } from "./broker/ibkrWebSocket";
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
  apiKeys,
  navSnapshots,
  type SpreadConfig
} from "@shared/schema";
import { encryptPrivateKey, isValidPrivateKey, sanitizeCredentials } from "./crypto";
import { db } from "./db";
import { desc, eq, and, asc, sql } from "drizzle-orm";
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
import apeAgentRoutes from "./agent/routes.js";
import dataCaptureRoutes from "./routes/dataCaptureRoutes.js";
import researchRoutes from "./routes/researchRoutes.js";
import schedulerRoutes from "./routes/schedulerRoutes.js";
import publicRoutes from "./publicRoutes.js";
import indicatorRoutes from "./indicatorRoutes.js";
import replayRoutes from "./replayRoutes.js";
import ddRoutes from "./ddRoutes.js";
import accountingRoutes from "./accountingRoutes.js";
import { initRelayWebSocket, hasRelayConnection, getRelayStatus, sendTradeSignal } from "./routes/relayRoutes";
import cors from "cors";
import { getTodayOpeningSnapshot, getTodayClosingSnapshot, getPreviousClosingSnapshot, isMarketHours } from "./services/navSnapshot.js";
// Yahoo Finance removed - using IBKR historical data instead
import { getMarketStatus } from "./services/marketCalendar.js";
import { fetchHistoricalBars } from "./services/ibkrHistoricalService.js";
import {
  setPreviousClose,
  needsPreviousClose,
  calculateChangePercent,
  calculateChange,
  calculateIVRank,
  getMetrics,
  getVWAP,
} from "./services/marketMetrics.js";
import { getSPYVWAP, getCachedVWAP } from "./services/yahooVwapService.js";

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

  // Register APE Agent routes (autonomous trading agent)
  app.use('/api/ape-agent', apeAgentRoutes);

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

  // Register Accounting routes (ledger, reconciliation, attestation)
  app.use('/api/accounting', accountingRoutes);

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

  // GET /api/settings/connection-mode - Get current connection mode (OAuth vs TWS/Gateway)
  // This is in-memory only - no database storage
  app.get('/api/settings/connection-mode', requireAuth, (req, res) => {
    try {
      const { getConnectionMode } = require('./services/marketDataAutoStart');
      const mode = getConnectionMode();
      console.log(`[Settings] GET connection-mode: ${mode}`);
      return res.json({ mode });
    } catch (error) {
      console.error('[Settings] Get connection mode error:', error);
      res.status(500).json({ error: 'Failed to get connection mode' });
    }
  });

  // PUT /api/settings/connection-mode - Set connection mode (OAuth vs TWS/Gateway)
  // When switching to 'relay', disconnects OAuth WebSocket so user can use local TWS
  app.put('/api/settings/connection-mode', requireAuth, (req, res) => {
    try {
      const { mode } = req.body;
      if (mode !== 'oauth' && mode !== 'relay') {
        return res.status(400).json({ error: 'Invalid mode. Must be "oauth" or "relay"' });
      }

      const { setConnectionMode, getConnectionMode } = require('./services/marketDataAutoStart');
      setConnectionMode(mode);
      console.log(`[Settings] PUT connection-mode: ${mode}`);

      return res.json({
        success: true,
        mode: getConnectionMode(),
        message: mode === 'relay'
          ? 'Switched to TWS/Gateway mode. OAuth WebSocket disconnected.'
          : 'Switched to OAuth mode. Will reconnect within 30 seconds.'
      });
    } catch (error) {
      console.error('[Settings] Set connection mode error:', error);
      res.status(500).json({ error: 'Failed to set connection mode' });
    }
  });

  // POST /api/settings/force-reconnect - Force IBKR OAuth reconnection without clearing session
  // Use this when auth diagnostics show 0 but credentials are valid
  app.post('/api/settings/force-reconnect', requireAuth, async (req, res) => {
    try {
      const { getConnectionMode, startWebSocketStream } = require('./services/marketDataAutoStart');
      const currentMode = getConnectionMode();

      if (currentMode !== 'oauth') {
        return res.status(400).json({
          error: 'Force reconnect only works in OAuth mode',
          currentMode
        });
      }

      console.log('[Settings] Force reconnect requested - starting WebSocket stream...');
      await startWebSocketStream();

      return res.json({
        success: true,
        message: 'OAuth WebSocket reconnection initiated'
      });
    } catch (error: any) {
      console.error('[Settings] Force reconnect error:', error);
      res.status(500).json({
        error: 'Failed to reconnect',
        details: error.message
      });
    }
  });

  // ==================== API KEYS FOR TWS RELAY ====================

  // GET /api/settings/api-keys - List user's API keys (masked)
  app.get('/api/settings/api-keys', requireAuth, async (req, res) => {
    try {
      const userId = req.user!.id;
      if (!db) {
        return res.status(503).json({ error: 'Database not available' });
      }

      const keys = await db.select({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: sql<string>`LEFT(${apiKeys.key}, 8)`,
        lastUsedAt: apiKeys.lastUsedAt,
        createdAt: apiKeys.createdAt,
      }).from(apiKeys)
        .where(eq(apiKeys.userId, userId))
        .orderBy(desc(apiKeys.createdAt));

      return res.json({
        keys: keys.map(k => ({
          id: k.id,
          name: k.name,
          keyPreview: k.keyPrefix + '****',
          lastUsedAt: k.lastUsedAt,
          createdAt: k.createdAt,
        }))
      });
    } catch (error) {
      console.error('[Settings] List API keys error:', error);
      res.status(500).json({ error: 'Failed to list API keys' });
    }
  });

  // POST /api/settings/api-keys - Generate new API key (returns full key once)
  app.post('/api/settings/api-keys', requireAuth, async (req, res) => {
    try {
      const userId = req.user!.id;
      if (!db) {
        return res.status(503).json({ error: 'Database not available' });
      }

      const { name } = req.body;

      // Generate a secure random API key (48 bytes = 64 chars base64url)
      const key = crypto.randomBytes(48).toString('base64url');

      const [inserted] = await db.insert(apiKeys).values({
        userId,
        key,
        name: name || 'TWS Relay Key',
      }).returning({
        id: apiKeys.id,
        name: apiKeys.name,
        createdAt: apiKeys.createdAt,
      });

      console.log(`[Settings] Created API key for user ${userId}`);

      // Return the full key - this is the only time it's shown
      return res.json({
        success: true,
        key, // Full key shown once
        id: inserted.id,
        name: inserted.name,
        createdAt: inserted.createdAt,
        message: 'API key created. Save this key - it will not be shown again.'
      });
    } catch (error) {
      console.error('[Settings] Create API key error:', error);
      res.status(500).json({ error: 'Failed to create API key' });
    }
  });

  // DELETE /api/settings/api-keys/:id - Revoke an API key
  app.delete('/api/settings/api-keys/:id', requireAuth, async (req, res) => {
    try {
      const userId = req.user!.id;
      const keyId = req.params.id;
      if (!db) {
        return res.status(503).json({ error: 'Database not available' });
      }

      // Only delete if the key belongs to this user
      const result = await db.delete(apiKeys)
        .where(and(
          eq(apiKeys.id, keyId),
          eq(apiKeys.userId, userId)
        ))
        .returning({ id: apiKeys.id });

      if (result.length === 0) {
        return res.status(404).json({ error: 'API key not found' });
      }

      console.log(`[Settings] Deleted API key ${keyId} for user ${userId}`);
      return res.json({
        success: true,
        message: 'API key revoked'
      });
    } catch (error) {
      console.error('[Settings] Delete API key error:', error);
      res.status(500).json({ error: 'Failed to delete API key' });
    }
  });

  // GET /api/settings/relay-status - Check if relay is connected for this user
  app.get('/api/settings/relay-status', requireAuth, async (req, res) => {
    try {
      const userId = req.user!.id;
      const status = getRelayStatus(userId);
      return res.json(status);
    } catch (error) {
      console.error('[Settings] Get relay status error:', error);
      res.status(500).json({ error: 'Failed to get relay status' });
    }
  });

  // ==================== END API KEYS ====================

  // Initialize jobs system (register handlers, seed default jobs)
  await initializeJobsSystem();

  const httpServer = createServer(app);

  // Initialize TWS Relay Socket.IO server at /relay
  initRelayWebSocket(httpServer);

  // WebSocket server for live data
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

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
      message: 'Connected to APE YOLO live data feed'
    }));

    // Note: Broker status is user-specific. Use authenticated /api/ibkr/status endpoint instead.
    ws.send(JSON.stringify({
      type: 'engine_status',
      data: {
        brokerConnected: false,  // User should check via authenticated API
        brokerProvider: 'pending',
        timestamp: new Date().toISOString()
      }
    }));

    // Handle incoming messages (ping/pong for keepalive)
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        }
      } catch (err) {
        // Ignore parse errors for non-JSON messages
      }
    });

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
      // Get broker for this specific user (no fallback to shared credentials)
      const userBroker = await getBrokerForUser(req.user!.id);

      // If user has no IBKR credentials, return error (no fallback to env credentials)
      if (!userBroker.api || userBroker.status.provider === 'none') {
        return res.status(403).json({
          error: 'No IBKR credentials configured',
          message: 'Please configure your IBKR credentials in Settings'
        });
      }

      if (userBroker.status.provider === 'ibkr') {
        console.log('[API] /api/account: Ensuring IBKR ready...');
        await ensureClientReady(userBroker.api);
        console.log('[API] /api/account: IBKR ready, fetching account...');
      }
      const account = await userBroker.api!.getAccount();
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
      // Get broker for this specific user (no fallback to shared credentials)
      const userBroker = await getBrokerForUser(req.user!.id);

      // If user has no IBKR credentials, return error (no fallback to env credentials)
      if (!userBroker.api || userBroker.status.provider === 'none') {
        return res.status(403).json({
          error: 'No IBKR credentials configured',
          message: 'Please configure your IBKR credentials in Settings'
        });
      }

      if (userBroker.status.provider === 'ibkr') {
        await ensureClientReady(userBroker.api);
      }
      const positions = await userBroker.api!.getPositions();
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

      // Get trades from local DB (legacy trades table) - filtered by userId
      const localTrades = await storage.getTrades(userId);
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
        last = await ensureClientReady(userBroker.api);
      } catch (err) {
        // Fall back to cached diagnostics from user's provider
        last = getDiagnosticsFromClient(userBroker.api);
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
      const diag = await ensureClientReady(userBroker.api);
      return res.status(200).json({ ok: true, diag });
    } catch (err: any) {
      const userBroker = await getBrokerForUser(req.user!.id);
      const diag = getDiagnosticsFromClient(userBroker.api);
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

      // Auto-subscribe to SPY and VIX for real-time streaming
      const SPY_CONID = 756733;
      const VIX_CONID = 13455763;
      console.log('[IbkrWS] Auto-subscribing to SPY and VIX...');
      wsManager.subscribe(SPY_CONID, { symbol: 'SPY', type: 'stock' });
      wsManager.subscribe(VIX_CONID, { symbol: 'VIX', type: 'stock' });

      console.log('[IbkrWS] WebSocket streaming started with SPY/VIX subscriptions');
      return res.json({ ok: true, message: 'IBKR WebSocket streaming started', subscriptions: ['SPY', 'VIX'] });
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

  // Lightweight market status check (no auth required for speed)
  app.get('/api/market/status', (_req, res) => {
    try {
      const status = getMarketStatus();
      // Determine market state including overnight session
      let marketState: 'REGULAR' | 'OVERNIGHT' | 'CLOSED' = 'CLOSED';
      if (status.isOpen) {
        marketState = 'REGULAR';
      } else if (status.isOvernight) {
        marketState = 'OVERNIGHT';
      }
      return res.json({
        ok: true,
        isOpen: status.isOpen,
        isOvernight: status.isOvernight || false,
        marketState,
        currentTimeET: status.currentTimeET,
        reason: status.reason,
      });
    } catch (err: any) {
      console.warn('[Market Status] Error checking status:', err?.message || err);
      return res.json({
        ok: true,
        isOpen: false,
        marketState: 'CLOSED',
        currentTimeET: new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York' }),
        reason: 'Error checking market status',
      });
    }
  });

  // Debug: Compare WebSocket vs REST API prices
  // WARNING: Each call to this endpoint costs $0.01 (snapshot API)
  app.get('/api/broker/debug/price-compare', requireAuth, async (req, res) => {
    const SPY_CONID = 756733;
    console.warn('[COST WARNING] /api/broker/debug/price-compare called - costs $0.01 per snapshot');
    try {
      const wsManager = getIbkrWebSocketManager();
      const wsData = wsManager?.getCachedMarketData(SPY_CONID);

      // Fetch directly from IBKR REST API (snapshot - costs $0.01!)
      const broker = await getBrokerForUser(req.user!.id, db);
      if (!broker?.api) {
        return res.json({ ok: false, message: 'IBKR not connected' });
      }

      // Use internal IBKR client to make snapshot call
      const client = broker.api as any;
      let restPrice = null;
      let restBid = null;
      let restAsk = null;

      try {
        // Direct snapshot API call - field 31=last, 84=bid, 86=ask
        // WARNING: This costs $0.01!
        const snapshotRes = await client.http.get(`/v1/api/iserver/marketdata/snapshot?conids=${SPY_CONID}&fields=31,84,86`);
        if (snapshotRes.data && Array.isArray(snapshotRes.data) && snapshotRes.data[0]) {
          const snap = snapshotRes.data[0];
          restPrice = parseFloat(snap['31']) || null;
          restBid = parseFloat(snap['84']) || null;
          restAsk = parseFloat(snap['86']) || null;
        }
        console.log(`[DEBUG] REST API snapshot: ${JSON.stringify(snapshotRes.data)}`);
      } catch (snapErr: any) {
        console.error('[DEBUG] Snapshot API error:', snapErr.message);
      }

      return res.json({
        ok: true,
        websocket: wsData ? {
          last: wsData.last,
          bid: wsData.bid,
          ask: wsData.ask,
          timestamp: wsData.timestamp
        } : null,
        restApi: {
          last: restPrice,
          bid: restBid,
          ask: restAsk
        },
        difference: wsData && restPrice ? {
          lastDiff: restPrice - wsData.last,
          note: 'Positive = REST higher than WebSocket'
        } : null
      });
    } catch (err: any) {
      console.error('[DEBUG] Price compare error:', err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Force WebSocket reconnect (debug)
  app.post('/api/broker/ws/reconnect', requireAuth, async (req, res) => {
    try {
      const wsManager = getIbkrWebSocketManager();
      if (wsManager) {
        console.log('[WS-RECONNECT] Forcing WebSocket reconnect...');
        wsManager.disconnect();

        // Get fresh cookies and session (multi-tenant)
        const userBroker = await getBrokerForUser(req.user!.id);
        const cookieString = await getCookieStringFromClient(userBroker?.api || null);
        const sessionToken = await getSessionTokenFromClient(userBroker?.api || null);

        if (cookieString) {
          const newWs = initIbkrWebSocket(cookieString, sessionToken);
          await newWs.connect();
          // Resubscribe to SPY and VIX
          newWs.subscribe(756733, { symbol: 'SPY', type: 'stock' });
          newWs.subscribe(13455763, { symbol: 'VIX', type: 'stock' });
          console.log('[WS-RECONNECT] WebSocket reconnected and resubscribed');
          return res.json({ ok: true, message: 'WebSocket reconnected' });
        } else {
          return res.json({ ok: false, message: 'No IBKR cookies available' });
        }
      }
      return res.json({ ok: false, message: 'No WebSocket manager' });
    } catch (err: any) {
      console.error('[WS-RECONNECT] Error:', err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Comprehensive debug endpoint for diagnosing WebSocket price issues
  // WARNING: This endpoint makes a snapshot API call that costs $0.01
  app.get('/api/broker/debug/ws-auth', requireAuth, async (req, res) => {
    const SPY_CONID = 756733;
    console.warn('[COST WARNING] /api/broker/debug/ws-auth called - includes $0.01 snapshot for comparison');

    try {
      const wsManager = getIbkrWebSocketManager();

      // Get detailed WebSocket status
      const wsStatus = wsManager?.getDetailedStatus?.() || {
        connected: wsManager?.connected || false,
        authenticated: false,
        hasSessionToken: false,
        subscriptions: 0,
        lastDataReceived: null,
        subscriptionError: null,
      };

      // Get cached SPY data
      const spyCache = wsManager?.getCachedMarketData(SPY_CONID);

      // Get user's broker for multi-tenant support
      const userBroker = await getBrokerForUser(req.user!.id, db);

      // Try to get current session token status (multi-tenant)
      let currentSessionTokenStatus = 'unknown';
      try {
        const sessionToken = await getSessionTokenFromClient(userBroker?.api || null);
        currentSessionTokenStatus = sessionToken ? `present (${sessionToken.substring(0, 8)}...)` : 'NULL - THIS IS THE PROBLEM';
      } catch (e) {
        currentSessionTokenStatus = 'error fetching';
      }

      // Try REST API snapshot for comparison
      let restApiPrice = null;
      let restApiBid = null;
      let restApiAsk = null;
      try {
        if (userBroker?.api) {
          const client = userBroker.api as any;
          const snapshotRes = await client.http.get(`/v1/api/iserver/marketdata/snapshot?conids=${SPY_CONID}&fields=31,84,86`);
          if (snapshotRes.data && Array.isArray(snapshotRes.data) && snapshotRes.data[0]) {
            const snap = snapshotRes.data[0];
            restApiPrice = parseFloat(snap['31']) || null;
            restApiBid = parseFloat(snap['84']) || null;
            restApiAsk = parseFloat(snap['86']) || null;
          }
        }
      } catch (e) {
        // Ignore REST API errors
      }

      // Calculate differences
      const priceDiff = spyCache?.last && restApiPrice ? restApiPrice - spyCache.last : null;

      // Diagnosis
      const diagnosis: string[] = [];
      if (!wsStatus.connected) {
        diagnosis.push('CRITICAL: WebSocket not connected');
      }
      if (!wsStatus.hasSessionToken) {
        diagnosis.push('CRITICAL: No session token - IBKR may be sending delayed data instead of real-time');
      }
      if (!wsStatus.authenticated) {
        diagnosis.push('WARNING: WebSocket not authenticated - authentication may have failed');
      }
      if (wsStatus.subscriptionError) {
        diagnosis.push(`ERROR: Subscription error - ${wsStatus.subscriptionError}`);
      }
      if (priceDiff && Math.abs(priceDiff) > 0.5) {
        diagnosis.push(`PRICE DISCREPANCY: REST API shows $${restApiPrice?.toFixed(2)}, WebSocket shows $${spyCache?.last?.toFixed(2)} (diff: $${priceDiff.toFixed(2)})`);
      }
      if (diagnosis.length === 0) {
        diagnosis.push('All checks passed - WebSocket appears healthy');
      }

      return res.json({
        ok: true,
        diagnosis,
        websocketStatus: wsStatus,
        currentSessionToken: currentSessionTokenStatus,
        cachedSPY: spyCache ? {
          last: spyCache.last,
          bid: spyCache.bid,
          ask: spyCache.ask,
          timestamp: spyCache.timestamp
        } : null,
        restApiSPY: {
          last: restApiPrice,
          bid: restApiBid,
          ask: restApiAsk
        },
        priceDifference: priceDiff
      });
    } catch (err: any) {
      console.error('[DEBUG] WS auth check error:', err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // FREE debug endpoint - shows WebSocket state without making any API calls
  // Use this to diagnose why SPY/VIX show $0.0
  app.get('/api/debug/ws-state', requireAuth, async (req, res) => {
    const SPY_CONID = 756733;
    const VIX_CONID = 13455763;

    try {
      const wsManager = getIbkrWebSocketManager();

      if (!wsManager) {
        return res.json({
          ok: false,
          error: 'WebSocket manager not initialized',
          connected: false,
          authenticated: false,
          subscriptions: [],
          cache: {}
        });
      }

      // Get detailed status
      const status = wsManager.getDetailedStatus();

      // Get subscription list
      const subscriptions = wsManager.getSubscriptions();
      const subscriptionList: number[] = [];
      for (const [conid] of subscriptions) {
        subscriptionList.push(conid);
      }

      // Get cache data for SPY and VIX
      const spyCache = wsManager.getCachedMarketData(SPY_CONID);
      const vixCache = wsManager.getCachedMarketData(VIX_CONID);

      // Build cache object with enhanced diagnostic info
      const cache: Record<string, any> = {};
      if (spyCache) {
        const ageMs = spyCache.timestamp ? Date.now() - spyCache.timestamp.getTime() : null;
        cache[SPY_CONID] = {
          symbol: 'SPY',
          last: spyCache.last,
          bid: spyCache.bid,
          ask: spyCache.ask,
          dayHigh: spyCache.dayHigh,
          dayLow: spyCache.dayLow,
          openPrice: spyCache.openPrice,
          previousClose: spyCache.previousClose,
          timestamp: spyCache.timestamp?.toISOString(),
          ageMs,
          source: spyCache.last > 0 ? 'websocket' : 'none'
        };
      }
      if (vixCache) {
        const ageMs = vixCache.timestamp ? Date.now() - vixCache.timestamp.getTime() : null;
        cache[VIX_CONID] = {
          symbol: 'VIX',
          last: vixCache.last,
          bid: vixCache.bid,
          ask: vixCache.ask,
          openPrice: vixCache.openPrice,
          previousClose: vixCache.previousClose,
          timestamp: vixCache.timestamp?.toISOString(),
          ageMs,
          source: vixCache.last > 0 ? 'websocket' : 'none'
        };
      }

      // Build subscription details with symbols
      const subscriptionDetails: Record<number, { symbol?: string; type?: string }> = {};
      for (const [conid, sub] of subscriptions) {
        subscriptionDetails[conid] = {
          symbol: sub.symbol,
          type: sub.type
        };
      }

      // Diagnosis
      const issues: string[] = [];
      if (!status.connected) issues.push('WebSocket not connected');
      if (!status.authenticated) issues.push('WebSocket not authenticated');
      if (!status.hasSessionToken) issues.push('No session token');
      if (status.subscriptionError) issues.push(`Subscription error: ${status.subscriptionError}`);
      if (subscriptionList.length === 0) issues.push('No active subscriptions');
      if (!subscriptionList.includes(SPY_CONID)) issues.push('SPY (756733) not subscribed');
      if (!subscriptionList.includes(VIX_CONID)) issues.push('VIX (13455763) not subscribed');
      if (!spyCache) issues.push('SPY not in cache');
      else if (spyCache.last === 0) issues.push('SPY cached price is $0');
      if (!vixCache) issues.push('VIX not in cache');
      else if (vixCache.last === 0) issues.push('VIX cached price is $0');

      // Determine data freshness
      const dataAgeMs = status.lastDataReceived ? Date.now() - new Date(status.lastDataReceived).getTime() : null;
      const isDataFresh = dataAgeMs !== null && dataAgeMs < 60000; // Fresh if < 60 seconds

      return res.json({
        ok: issues.length === 0,
        issues,
        connected: status.connected,
        authenticated: status.authenticated,
        hasSessionToken: status.hasSessionToken,
        subscriptions: subscriptionList,
        subscriptionDetails,
        subscriptionCount: subscriptionList.length,
        subscriptionError: status.subscriptionError,
        lastDataReceived: status.lastDataReceived,
        dataAgeMs,
        isDataFresh,
        cache,
        // Quick summary for debugging
        summary: {
          spy: spyCache?.last ? `$${spyCache.last.toFixed(2)}` : 'N/A',
          vix: vixCache?.last ? `$${vixCache.last.toFixed(2)}` : 'N/A',
          status: !status.connected ? 'DISCONNECTED' :
                  !status.authenticated ? 'NOT_AUTHENTICATED' :
                  status.subscriptionError ? 'SUBSCRIPTION_ERROR' :
                  !isDataFresh ? 'STALE_DATA' : 'OK'
        }
      });
    } catch (err: any) {
      console.error('[DEBUG] ws-state error:', err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Live market snapshot - gets SPY/VIX from WebSocket cache (FREE)
  // HTTP Snapshot removed - was costing $0.01-$0.03 per call
  app.get('/api/broker/stream/snapshot', requireAuth, async (req, res) => {
    const SPY_CONID = 756733;
    const VIX_CONID = 13455763;

    try {
      // Get market status
      let marketState: 'PRE' | 'REGULAR' | 'POST' | 'OVERNIGHT' | 'CLOSED' = 'CLOSED';
      try {
        const status = getMarketStatus();
        if (status?.isOpen) {
          marketState = 'REGULAR';
        } else if (status?.isOvernight) {
          marketState = 'OVERNIGHT';
        } else if (status?.reason?.startsWith('Pre-market')) {
          marketState = 'PRE';
        } else if (status?.reason?.startsWith('After hours')) {
          marketState = 'POST';
        }
      } catch (e) {
        console.log('[Snapshot] Market status check failed, defaulting to CLOSED');
      }

      // ============================================================
      // WEBSOCKET-ONLY: Zero snapshot costs (covered by OPRA subscription)
      // HTTP Snapshot API REMOVED - was costing $0.01-$0.03 per call
      // ============================================================
      let spyData: { last: number; bid: number | null; ask: number | null; timestamp: Date } | null = null;
      let vixData: { last: number; bid: number | null; ask: number | null; timestamp: Date } | null = null;

      const wsManager = getIbkrWebSocketManager();
      if (wsManager?.connected) {
        const wsSpy = wsManager.getCachedMarketData(SPY_CONID);
        const wsVix = wsManager.getCachedMarketData(VIX_CONID);
        if (wsSpy?.last) {
          spyData = { last: wsSpy.last, bid: wsSpy.bid, ask: wsSpy.ask, timestamp: wsSpy.timestamp };
        }
        if (wsVix?.last) {
          vixData = { last: wsVix.last, bid: wsVix.bid, ask: wsVix.ask, timestamp: wsVix.timestamp };
        }
      }

      if (!spyData?.last || spyData.last <= 0) {
        console.warn('[Snapshot] No live SPY data');
        return res.json({
          ok: true,
          available: false,
          source: 'none',
          marketState,
          message: 'No live SPY data available'
        });
      }

      const spyPrice = spyData.last;
      const spyBid = spyData.bid || null;
      const spyAsk = spyData.ask || null;
      const vixPrice = vixData?.last || 0;
      const timestamp = spyData.timestamp;
      const dataAge = wsManager?.getDataAge() || 0;

      console.log(`[Snapshot] LIVE: SPY=$${spyPrice} (bid=${spyBid}, ask=${spyAsk}), VIX=${vixPrice}, age=${dataAge}ms`);

      // Fetch previous close once per session (needed for change % calculation)
      if (needsPreviousClose()) {
        console.log('[Snapshot] Previous close needed, fetching daily bars...');
        try {
          const spyDailyBars = await fetchHistoricalBars('SPY', '1D', { outsideRth: true });
          const vixDailyBars = await fetchHistoricalBars('^VIX', '1D', { outsideRth: true });
          console.log(`[Snapshot] Fetched ${spyDailyBars.length} SPY bars, ${vixDailyBars.length} VIX bars`);
          if (spyDailyBars.length >= 2 && vixDailyBars.length >= 2) {
            // SPY: use [length-2] because [length-1] may be today's incomplete bar
            const spyPrevClose = spyDailyBars[spyDailyBars.length - 2].close;
            // VIX: IBKR data is delayed, use [length-1] to match Yahoo Finance
            const vixPrevClose = vixDailyBars[vixDailyBars.length - 1].close;
            setPreviousClose(spyPrevClose, vixPrevClose);
            console.log(`[Snapshot] Previous close SET: SPY=$${spyPrevClose.toFixed(2)}, VIX=${vixPrevClose.toFixed(2)}`);
          } else {
            console.warn(`[Snapshot] Not enough bars: SPY=${spyDailyBars.length}, VIX=${vixDailyBars.length}`);
          }
        } catch (dailyErr: any) {
          console.error('[Snapshot] Daily bars fetch FAILED:', dailyErr.message);
        }
      }

      const metrics = getMetrics();
      const spyChangePct = calculateChangePercent(spyPrice, metrics.spyPrevClose);
      const spyChange = calculateChange(spyPrice, metrics.spyPrevClose);
      const vixChangePct = calculateChangePercent(vixPrice, metrics.vixPrevClose);
      const vixChange = calculateChange(vixPrice, metrics.vixPrevClose);
      const ivRank = calculateIVRank(vixPrice);
      const vwap = getVWAP();

      // Debug: Log the actual values being returned
      console.log(`[Snapshot] RESPONSE: spyPrice=${spyPrice}, spyPrevClose=${metrics.spyPrevClose}, spyChangePct=${spyChangePct.toFixed(2)}%`);

      return res.json({
        ok: true,
        available: true,
        source: 'ibkr',
        marketState,
        snapshot: {
          spyPrice,
          spyChange,
          spyChangePct,
          spyBid,
          spyAsk,
          spyPrevClose: metrics.spyPrevClose,
          dayHigh: spyData.dayHigh || 0,  // ✅ Real IBKR data (not fake ±0.5%)
          dayLow: spyData.dayLow || 0,    // ✅ Real IBKR data (not fake ±0.5%)
          openPrice: spyData.openPrice,   // ✅ Real open price
          vix: vixPrice,
          vixChange,
          vixChangePct,
          vwap: vwap || spyPrice,
          ivRank,
          timestamp: timestamp.toISOString()
        }
      });

    } catch (err: any) {
      console.error('[Snapshot] Error:', err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ============================================
  // REAL-TIME SSE STREAMING ENDPOINT
  // Mode: 'websocket' = Low latency push (~50ms), may differ from TWS
  // Mode: 'http' (default) = Consolidated NBBO polling (1s), matches TWS
  // ============================================
  app.get('/api/broker/stream/live', requireAuth, async (req, res) => {
    const mode = (req.query.mode as string) || 'http';
    console.log(`[SSE] Client connected for live streaming (mode: ${mode})`);

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    res.flushHeaders();

    // Send initial connection message
    res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`);

    // Ensure previous close is set for change % calculation
    if (needsPreviousClose()) {
      console.log('[SSE] Previous close not set, fetching from daily bars...');
      try {
        const spyDailyBars = await fetchHistoricalBars('SPY', '1D', { outsideRth: true, forceRefresh: true });
        const vixDailyBars = await fetchHistoricalBars('^VIX', '1D', { outsideRth: true, forceRefresh: true });

        console.log(`[SSE] Got ${spyDailyBars.length} SPY bars, ${vixDailyBars.length} VIX bars`);

        if (spyDailyBars.length >= 2 && vixDailyBars.length >= 2) {
          // Log bar dates to understand data structure
          const lastSpyBar = spyDailyBars[spyDailyBars.length - 1];
          const prevSpyBar = spyDailyBars[spyDailyBars.length - 2];
          const lastVixBar = vixDailyBars[vixDailyBars.length - 1];
          const prevVixBar = vixDailyBars[vixDailyBars.length - 2];

          console.log(`[SSE] SPY bars: last=${new Date(lastSpyBar.time * 1000).toLocaleDateString()} close=$${lastSpyBar.close.toFixed(2)}, prev=${new Date(prevSpyBar.time * 1000).toLocaleDateString()} close=$${prevSpyBar.close.toFixed(2)}`);
          console.log(`[SSE] VIX bars: last=${new Date(lastVixBar.time * 1000).toLocaleDateString()} close=$${lastVixBar.close.toFixed(2)}, prev=${new Date(prevVixBar.time * 1000).toLocaleDateString()} close=$${prevVixBar.close.toFixed(2)}`);

          // For SPY: use [length-2] because [length-1] may be today's incomplete bar
          const spyPrevClose = prevSpyBar.close;

          // For VIX: IBKR's VIX data may be delayed by 1 day
          // Use [length-1] as previous close since VIX doesn't have "today's" bar
          // This matches Yahoo Finance's change % calculation
          const vixPrevClose = lastVixBar.close;

          setPreviousClose(spyPrevClose, vixPrevClose, true); // Force set
          console.log(`[SSE] Previous close SET: SPY=$${spyPrevClose.toFixed(2)} (${new Date(prevSpyBar.time * 1000).toLocaleDateString()}), VIX=${vixPrevClose.toFixed(2)} (${new Date(lastVixBar.time * 1000).toLocaleDateString()})`);
        } else {
          console.warn(`[SSE] Not enough bars: SPY=${spyDailyBars.length}, VIX=${vixDailyBars.length}`);
        }
      } catch (err: any) {
        console.error('[SSE] Failed to fetch previous close:', err.message, err.stack);
      }
    } else {
      const metrics = getMetrics();
      console.log(`[SSE] Previous close already set: SPY=$${metrics.spyPrevClose?.toFixed(2)}, VIX=${metrics.vixPrevClose?.toFixed(2)}`);
    }

    const SPY_CONID = 756733;
    const VIX_CONID = 13455763;

    // Get broker client for HTTP snapshot calls
    let brokerClient: any = null;
    try {
      const broker = await getBrokerForUser(req.user!.id);
      if (broker?.api) {
        brokerClient = broker.api as any;
      }
    } catch (err: any) {
      console.warn('[SSE] Failed to get broker client:', err.message);
    }

    if (!brokerClient) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'IBKR not connected' })}\n\n`);
      console.log('[SSE] No broker client, ending stream');
      res.end();
      return;
    }

    let updateCount = 0;
    let lastSpyPrice = 0;
    let lastVixPrice = 0;
    let isClientConnected = true;
    let isRequestInFlight = false;  // Prevent concurrent requests

    // Track day high/low from WebSocket prices (reset daily at market open)
    let dayHigh = 0;
    let dayLow = Infinity;
    let lastResetDate: string | null = null;

    // Reset day high/low at midnight
    const checkDayReset = () => {
      const today = new Date().toISOString().split('T')[0];
      if (lastResetDate !== today) {
        dayHigh = 0;
        dayLow = Infinity;
        lastResetDate = today;
        console.log('[SSE] Day high/low reset for new trading day');
      }
    };

    // Fetch initial VWAP from Yahoo Finance (free, ~15min delayed)
    console.log('[SSE] Fetching initial VWAP...');
    getSPYVWAP().catch(err => {
      console.warn('[SSE] Initial VWAP fetch failed:', err.message);
    });

    // Update VWAP every 1 minute (Yahoo Finance free tier)
    const vwapUpdateInterval = setInterval(() => {
      if (!isClientConnected) {
        clearInterval(vwapUpdateInterval);
        return;
      }
      getSPYVWAP().catch(err => {
        console.warn('[SSE] VWAP update failed:', err.message);
      });
    }, 1 * 60 * 1000); // 1 minute

    // Polling interval based on mode:
    // - websocket: 250ms (low latency from cache)
    // - http: 1000ms (consolidated NBBO, needs network call)
    const pollIntervalMs = mode === 'websocket' ? 250 : 1000;

    // Poll for prices
    const pollInterval = setInterval(async () => {
      if (!isClientConnected) {
        clearInterval(pollInterval);
        return;
      }

      // Skip if previous request still pending (prevents pileup)
      if (isRequestInFlight) {
        return;
      }

      isRequestInFlight = true;

      let spyPrice = 0, spyBid: number | null = null, spyAsk: number | null = null;
      let vixPrice = 0;
      let dataSource = 'none';

      // ============================================================
      // WEBSOCKET-ONLY MODE: Zero snapshot costs (covered by OPRA subscription)
      // HTTP snapshot mode REMOVED - was costing $0.02/second ($72/hour!)
      // ============================================================
      const wsManager = getIbkrWebSocketManager();
      if (wsManager?.connected) {
        const wsSpy = wsManager.getCachedMarketData(SPY_CONID);
        const wsVix = wsManager.getCachedMarketData(VIX_CONID);
        if (wsSpy?.last && wsSpy.last > 0) {
          spyPrice = wsSpy.last;
          spyBid = wsSpy.bid ?? null;
          spyAsk = wsSpy.ask ?? null;
          dataSource = 'ws';
        }
        if (wsVix?.last) {
          vixPrice = wsVix.last;
        }
      }

      // NO SNAPSHOT FALLBACK - WebSocket streaming is free with OPRA subscription
      // Snapshot API costs $0.01-$0.03 per call, which adds up quickly at 1/second polling
      if (spyPrice <= 0) {
        console.warn(`[SSE][COST-SAVED] WebSocket has no SPY data - NOT falling back to costly snapshot API`);
        dataSource = 'ws-no-data';
      }

      // Send updates if we have data
      try {
        if (spyPrice > 0) {
          // SPY update
          if (spyPrice !== lastSpyPrice) {
            lastSpyPrice = spyPrice;
            updateCount++;

            // Check if we need to reset day high/low (new trading day)
            checkDayReset();

            // Update day high/low from observed prices
            if (spyPrice > dayHigh) dayHigh = spyPrice;
            if (spyPrice < dayLow) dayLow = spyPrice;

            const marketStatus = getMarketStatus();
            const marketState = marketStatus?.isOpen ? 'REGULAR' : 'CLOSED';
            const metrics = getMetrics();
            const changePct = calculateChangePercent(spyPrice, metrics.spyPrevClose);

            // DEBUG: Log what we're sending
            if (updateCount <= 3) {
              console.log(`[SSE] SPY update #${updateCount}: price=$${spyPrice.toFixed(2)}, prevClose=${metrics.spyPrevClose?.toFixed(2) ?? 'NULL'}, changePct=${changePct.toFixed(2)}%, dayHigh=${dayHigh.toFixed(2)}, dayLow=${dayLow === Infinity ? 'N/A' : dayLow.toFixed(2)}`);
            }

            const spyEvent = {
              type: 'price',
              symbol: 'SPY',
              conid: SPY_CONID,
              last: spyPrice,
              bid: spyBid,
              ask: spyAsk,
              changePct,
              prevClose: metrics.spyPrevClose,
              ivRank: null,
              marketState,
              // VWAP from Yahoo Finance (updated every 1 minute, ~15min delayed)
              vwap: getCachedVWAP(),
              // Real day high/low tracked from WebSocket prices (FREE!)
              dayHigh: dayHigh > 0 ? dayHigh : null,
              dayLow: dayLow < Infinity ? dayLow : null,
              timestamp: new Date().toISOString(),
              updateNumber: updateCount,
              source: dataSource
            };

            if (updateCount % 10 === 1) {
              console.log(`[SSE] SPY: $${spyPrice.toFixed(2)} (${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%) via ${dataSource}`);
            }
            res.write(`data: ${JSON.stringify(spyEvent)}\n\n`);
          }

          // VIX update
          if (vixPrice > 0 && vixPrice !== lastVixPrice) {
            lastVixPrice = vixPrice;
            const metrics = getMetrics();
            const vixEvent = {
              type: 'price',
              symbol: 'VIX',
              conid: VIX_CONID,
              last: vixPrice,
              bid: null,
              ask: null,
              changePct: calculateChangePercent(vixPrice, metrics.vixPrevClose),
              prevClose: metrics.vixPrevClose,
              ivRank: calculateIVRank(vixPrice),
              marketState: getMarketStatus()?.isOpen ? 'REGULAR' : 'CLOSED',
              vwap: null,
              timestamp: new Date().toISOString(),
              updateNumber: updateCount,
              source: dataSource
            };
            res.write(`data: ${JSON.stringify(vixEvent)}\n\n`);
          }
        }
      } catch (writeErr: any) {
        console.warn('[SSE] Write error:', writeErr.message);
      } finally {
        isRequestInFlight = false;
      }
    }, pollIntervalMs); // Poll interval based on mode

    // Send heartbeat every 15 seconds to keep connection alive
    const heartbeatInterval = setInterval(() => {
      if (isClientConnected) {
        res.write(`data: ${JSON.stringify({ type: 'heartbeat', timestamp: new Date().toISOString() })}\n\n`);
      }
    }, 15000);

    // Clean up on client disconnect
    req.on('close', () => {
      console.log(`[SSE] Client disconnected after ${updateCount} updates`);
      isClientConnected = false;
      clearInterval(pollInterval);
      clearInterval(heartbeatInterval);
      clearInterval(vwapUpdateInterval);
    });
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

      // If user has no IBKR credentials in database, check for env var configuration
      if (!userBroker.api || userBroker.status.provider === 'none') {
        // Check if global broker is configured via environment variables
        const envConfigured = !!(process.env.IBKR_CLIENT_ID && process.env.IBKR_PRIVATE_KEY);

        if (envConfigured) {
          console.log(`[IBKR Status] User ${userId} using env var credentials`);
          // Use the global broker for status
          const diag = getIbkrDiagnostics();

          // If WebSocket is authenticated, HTTP auth definitely succeeded
          // (WebSocket requires valid HTTP session cookies from OAuth flow)
          const wsStatus = getIbkrWebSocketStatus();
          const wsAuthenticated = wsStatus?.authenticated === true;

          // Use effective status: if WS authenticated, all HTTP steps succeeded
          const effectiveOAuthStatus = wsAuthenticated ? 200 : diag.oauth.status;
          const effectiveSSOStatus = wsAuthenticated ? 200 : diag.sso.status;
          const effectiveValidateStatus = wsAuthenticated ? 200 : diag.validate.status;
          const effectiveInitStatus = wsAuthenticated ? 200 : diag.init.status;

          // Check for real data flow (non-zero SPY price)
          const wsDetailedStatusForCheck = getIbkrWebSocketDetailedStatus();
          const hasRealDataFlow = wsDetailedStatusForCheck?.hasRealData === true;

          const allStepsConnected =
            effectiveOAuthStatus === 200 &&
            effectiveSSOStatus === 200 &&
            effectiveValidateStatus === 200 &&
            effectiveInitStatus === 200 &&
            hasRealDataFlow; // NEW: require real data, not just auth

          // Get connection mode for relay detection
          const { getConnectionMode } = require('./services/marketDataAutoStart');
          const currentMode = getConnectionMode();

          // In relay mode, OAuth is not connected (WebSocket is intentionally disconnected)
          const isConnected = currentMode === 'relay' ? false : allStepsConnected;

          return res.json({
            configured: true,
            connected: isConnected,
            connectionMode: getConnectionMode(), // 'oauth' | 'relay'
            environment: (process.env.IBKR_ENV as string) || 'live',
            accountId: process.env.IBKR_ACCOUNT_ID || 'Configured',
            clientId: (process.env.IBKR_CLIENT_ID || '').substring(0, 10) + '***',
            multiUserMode: true, // Multi-user mode enabled
            diagnostics: {
              oauth: {
                status: effectiveOAuthStatus,
                message: effectiveOAuthStatus === 200 ? 'Connected' : effectiveOAuthStatus === 0 ? 'Not attempted' : 'Failed',
                success: effectiveOAuthStatus === 200
              },
              sso: {
                status: effectiveSSOStatus,
                message: effectiveSSOStatus === 200 ? 'Active' : effectiveSSOStatus === 0 ? 'Not attempted' : 'Failed',
                success: effectiveSSOStatus === 200
              },
              validate: {
                status: effectiveValidateStatus,
                message: effectiveValidateStatus === 200 ? 'Validated' : effectiveValidateStatus === 0 ? 'Not attempted' : 'Failed',
                success: effectiveValidateStatus === 200
              },
              init: {
                status: effectiveInitStatus,
                message: effectiveInitStatus === 200 ? 'Ready' : effectiveInitStatus === 0 ? 'Not attempted' : 'Failed',
                success: effectiveInitStatus === 200
              },
              websocket: (() => {
                const wsDetailedStatus = getIbkrWebSocketDetailedStatus();
                if (!wsDetailedStatus) {
                  return { status: 0, message: 'Not initialized', success: false, connected: false, authenticated: false, subscriptions: 0 };
                }

                // Check for subscription errors first
                if (wsDetailedStatus.subscriptionError) {
                  return {
                    status: 0,
                    message: `Error: ${wsDetailedStatus.subscriptionError}`,
                    success: false,
                    connected: wsDetailedStatus.connected,
                    authenticated: wsDetailedStatus.authenticated,
                    subscriptions: wsDetailedStatus.subscriptions,
                  };
                }

                // Real success = authenticated AND has non-zero SPY data
                if (wsDetailedStatus.authenticated && wsDetailedStatus.hasRealData) {
                  return {
                    status: 200,
                    message: `Streaming SPY $${wsDetailedStatus.spyPrice?.toFixed(2)}`,
                    success: true,
                    connected: true,
                    authenticated: true,
                    subscriptions: wsDetailedStatus.subscriptions,
                  };
                }

                // Authenticated but no data yet
                if (wsDetailedStatus.authenticated && !wsDetailedStatus.hasRealData) {
                  return {
                    status: 1, // In progress
                    message: 'Authenticated (waiting for data)',
                    success: false,
                    connected: true,
                    authenticated: true,
                    subscriptions: wsDetailedStatus.subscriptions,
                  };
                }

                // Connected but not authenticated
                if (wsDetailedStatus.connected) {
                  return {
                    status: 1,
                    message: 'Connected (authenticating...)',
                    success: false,
                    connected: true,
                    authenticated: false,
                    subscriptions: 0,
                  };
                }

                return { status: 0, message: 'Disconnected', success: false, connected: false, authenticated: false, subscriptions: 0 };
              })()
            }
          });
        }

        console.log(`[IBKR Status] User ${userId} has no credentials: provider=${userBroker.status.provider}`);
        // Get connection mode even for unconfigured users
        const { getConnectionMode: getMode } = require('./services/marketDataAutoStart');
        return res.json({
          configured: false,
          connected: false,
          connectionMode: getMode(), // 'oauth' | 'relay'
          environment: 'paper',
          multiUserMode: true,  // Always show multi-user mode is enabled
          message: 'No IBKR credentials configured for your account. Configure them in the Settings page.'
        });
      }

      // User has credentials - get their connection status from the per-user client
      const diag = getDiagnosticsFromClient(userBroker.api);

      // If WebSocket is authenticated, HTTP auth definitely succeeded
      // (WebSocket requires valid HTTP session cookies from OAuth flow)
      const wsStatusForUser = getIbkrWebSocketStatus();
      const wsAuthenticatedForUser = wsStatusForUser?.authenticated === true;

      // Use effective status: if WS authenticated, all HTTP steps succeeded
      const effectiveOAuthStatusUser = wsAuthenticatedForUser ? 200 : diag.oauth.status;
      const effectiveSSOStatusUser = wsAuthenticatedForUser ? 200 : diag.sso.status;
      const effectiveValidateStatusUser = wsAuthenticatedForUser ? 200 : diag.validate.status;
      const effectiveInitStatusUser = wsAuthenticatedForUser ? 200 : diag.init.status;

      // Check for real data flow (non-zero SPY price)
      const wsDetailedStatusForUserCheck = getIbkrWebSocketDetailedStatus();
      const hasRealDataFlowForUser = wsDetailedStatusForUserCheck?.hasRealData === true;

      // Check all 4 authentication steps + real data flow
      const allStepsConnected =
        effectiveOAuthStatusUser === 200 &&
        effectiveSSOStatusUser === 200 &&
        effectiveValidateStatusUser === 200 &&
        effectiveInitStatusUser === 200 &&
        hasRealDataFlowForUser; // NEW: require real data, not just auth

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

      // Get connection mode for relay detection
      const { getConnectionMode: getConnMode } = require('./services/marketDataAutoStart');
      const currentConnMode = getConnMode();

      // In relay mode, OAuth is not connected (WebSocket is intentionally disconnected)
      const isConnected = currentConnMode === 'relay' ? false : allStepsConnected;

      return res.json({
        configured: true,
        connected: isConnected,
        connectionMode: currentConnMode, // 'oauth' | 'relay'
        environment: userBroker.status.env,
        accountId,
        clientId,
        multiUserMode: true, // Always true in multi-tenant mode
        diagnostics: {
          oauth: {
            status: effectiveOAuthStatusUser,
            message: effectiveOAuthStatusUser === 200 ? 'Connected' : effectiveOAuthStatusUser === 0 ? 'Not attempted' : 'Failed',
            success: effectiveOAuthStatusUser === 200
          },
          sso: {
            status: effectiveSSOStatusUser,
            message: effectiveSSOStatusUser === 200 ? 'Active' : effectiveSSOStatusUser === 0 ? 'Not attempted' : 'Failed',
            success: effectiveSSOStatusUser === 200
          },
          validate: {
            status: effectiveValidateStatusUser,
            message: effectiveValidateStatusUser === 200 ? 'Validated' : effectiveValidateStatusUser === 0 ? 'Not attempted' : 'Failed',
            success: effectiveValidateStatusUser === 200
          },
          init: {
            status: effectiveInitStatusUser,
            message: effectiveInitStatusUser === 200 ? 'Ready' : effectiveInitStatusUser === 0 ? 'Not attempted' : 'Failed',
            success: effectiveInitStatusUser === 200
          },
          // WebSocket status for real-time data streaming
          websocket: (() => {
            const wsDetailedStatusUser = getIbkrWebSocketDetailedStatus();
            if (!wsDetailedStatusUser) {
              return { status: 0, message: 'Not initialized', success: false, connected: false, authenticated: false, subscriptions: 0 };
            }

            // Check for subscription errors first
            if (wsDetailedStatusUser.subscriptionError) {
              return {
                status: 0,
                message: `Error: ${wsDetailedStatusUser.subscriptionError}`,
                success: false,
                connected: wsDetailedStatusUser.connected,
                authenticated: wsDetailedStatusUser.authenticated,
                subscriptions: wsDetailedStatusUser.subscriptions,
              };
            }

            // Real success = authenticated AND has non-zero SPY data
            if (wsDetailedStatusUser.authenticated && wsDetailedStatusUser.hasRealData) {
              return {
                status: 200,
                message: `Streaming SPY $${wsDetailedStatusUser.spyPrice?.toFixed(2)}`,
                success: true,
                connected: true,
                authenticated: true,
                subscriptions: wsDetailedStatusUser.subscriptions,
              };
            }

            // Authenticated but no data yet
            if (wsDetailedStatusUser.authenticated && !wsDetailedStatusUser.hasRealData) {
              return {
                status: 1, // In progress
                message: 'Authenticated (waiting for data)',
                success: false,
                connected: true,
                authenticated: true,
                subscriptions: wsDetailedStatusUser.subscriptions,
              };
            }

            // Connected but not authenticated
            if (wsDetailedStatusUser.connected) {
              return {
                status: 1,
                message: 'Connected (authenticating...)',
                success: false,
                connected: true,
                authenticated: false,
                subscriptions: 0,
              };
            }

            return { status: 0, message: 'Disconnected', success: false, connected: false, authenticated: false, subscriptions: 0 };
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

      // Ensure the user's IBKR client is ready (multi-tenant: each user has their own connection)
      const diag = await ensureClientReady(userBroker.api);

      const allConnected =
        diag.oauth.status === 200 &&
        diag.sso.status === 200 &&
        diag.validate.status === 200 &&
        diag.init.status === 200;

      // If all steps are successful, establish the gateway for future orders AND start WebSocket
      if (allConnected) {
        console.log('[IBKR Test] All auth steps successful, establishing gateway for trading...');
        try {
          // Call the establishGateway to prepare for trading
          if (userBroker.api && 'establishGateway' in userBroker.api) {
            await (userBroker.api as any).establishGateway();
            console.log('[IBKR Test] Gateway established successfully');
          }

          // Initialize WebSocket for real-time data streaming (multi-tenant)
          const cookieString = await getCookieStringFromClient(userBroker.api);
          const sessionToken = await getSessionTokenFromClient(userBroker.api);
          if (cookieString) {
            console.log('[IBKR Test] Starting WebSocket for real-time data...');
            const wsManager = initIbkrWebSocket(cookieString, sessionToken);
            await wsManager.connect();
            // Subscribe to SPY and VIX
            wsManager.subscribe(756733, { symbol: 'SPY', type: 'stock' }); // SPY
            wsManager.subscribe(13455763, { symbol: 'VIX', type: 'stock' }); // VIX
            console.log('[IBKR Test] WebSocket connected and subscribed to SPY/VIX');
          }
        } catch (err) {
          console.error('[IBKR Test] Failed to establish gateway or WebSocket:', err);
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

  // Force OAuth reconnect without clearing session - useful for recovery
  app.post('/api/ibkr/force-reconnect', requireAuth, async (req, res) => {
    try {
      const { autoStartMarketDataStream, getConnectionMode } = require('./services/marketDataAutoStart');
      const mode = getConnectionMode();

      if (mode !== 'oauth') {
        return res.json({
          success: false,
          message: 'Cannot force reconnect in relay mode. Switch to OAuth mode first.'
        });
      }

      console.log('[Force Reconnect] Triggering OAuth reconnection flow...');

      // Run the auto-start flow which handles credentials and WebSocket properly
      await autoStartMarketDataStream();

      // Get updated status
      const wsStatus = getIbkrWebSocketStatus();
      const diag = getIbkrDiagnostics();

      return res.json({
        success: true,
        message: 'OAuth reconnection triggered successfully',
        diagnostics: {
          oauth: { status: diag.oauth.status, success: diag.oauth.status === 200 },
          sso: { status: diag.sso.status, success: diag.sso.status === 200 },
          validate: { status: diag.validate.status, success: diag.validate.status === 200 },
          init: { status: diag.init.status, success: diag.init.status === 200 },
          websocket: {
            connected: wsStatus?.connected || false,
            authenticated: wsStatus?.authenticated || false,
            subscriptions: wsStatus?.subscriptions || 0
          }
        }
      });
    } catch (error: any) {
      console.error('[Force Reconnect] Error:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Force reconnect failed',
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

  // Audit logs - requires authentication and filters by user
  app.get('/api/logs', requireAuth, async (req, res) => {
    try {
      const userId = req.user!.id;
      const logs = await storage.getAuditLogs(userId);
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
  // Public IBKR Market Data Endpoint (for Bear Hedge)
  // ============================================
  // Returns real-time SPY and VIX from IBKR WebSocket (no auth required, local only)
  app.get('/api/ibkr/live-quotes', async (_req, res) => {
    try {
      const SPY_CONID = 756733;
      const VIX_CONID = 13455763;

      const wsManager = getIbkrWebSocketManager();
      const spyData = wsManager?.getCachedMarketData(SPY_CONID);
      const vixData = wsManager?.getCachedMarketData(VIX_CONID);

      // Allow CORS from localhost:3000 (Bear Hedge)
      res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3000');

      res.json({
        spy: spyData ? {
          price: spyData.last,
          bid: spyData.bid,
          ask: spyData.ask,
          prevClose: spyData.previousClose,
          timestamp: spyData.timestamp
        } : null,
        vix: vixData ? {
          price: vixData.last,
          bid: vixData.bid,
          ask: vixData.ask,
          prevClose: vixData.previousClose,
          timestamp: vixData.timestamp
        } : null,
        source: 'ibkr-websocket'
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ============================================
  // Auto-schedule Option Chain Streaming at Market Open
  // ============================================
  // Initialize the option chain streamer and schedule it to auto-start
  // at 9:30 AM ET on trading days. This ensures the engine has fresh
  // option data for the capture job. Uses WebSocket streaming (free with sub).
  try {
    console.log('[Server] Initializing option chain streamer for IBKR auto-start...');
    initOptionChainStreamer({ autoSchedule: true, symbol: 'SPY' });
    console.log('[Server] Option chain streamer will auto-start when IBKR authenticates during market hours');
  } catch (err) {
    console.error('[Server] Failed to initialize option chain streamer:', err);
  }

  // ============================================
  // Initialize Previous Close Values (for change % calculations)
  // ============================================
  // Previous close will be fetched from IBKR daily bars on first snapshot request
  // No defaults set here - this ensures we always get real values
  console.log('[Server] Previous close will be fetched from IBKR on first request');

  return httpServer;
}
