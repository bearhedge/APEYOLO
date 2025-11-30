import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { getBroker } from "./broker";
import { getIbkrDiagnostics, ensureIbkrReady, placePaperStockOrder, placePaperOptionOrder, listPaperOpenOrders, getIbkrCookieString, resolveSymbolConid } from "./broker/ibkr";
import { IbkrWebSocketManager, initIbkrWebSocket, getIbkrWebSocketManager, destroyIbkrWebSocket, type MarketDataUpdate } from "./broker/ibkrWebSocket";
import { getOptionChainStreamer, initOptionChainStreamer } from "./broker/optionChainStreamer";
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
import jwt from "jsonwebtoken";
import crypto from "crypto";
import authRoutes from "./auth.js";
import ibkrRoutes from "./ibkrRoutes.js";
import engineRoutes from "./engineRoutes.js";
import marketRoutes from "./marketRoutes.js";

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

  // Register auth routes
  app.use('/api/auth', authRoutes);

  // Register IBKR strategy routes
  app.use('/api/ibkr', ibkrRoutes);

  // Register Engine routes
  app.use('/api/engine', engineRoutes);

  // Register Market data routes
  app.use('/api/market', marketRoutes);

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

    // Simulate live data updates
    const interval = setInterval(async () => {
      if (ws.readyState === WebSocket.OPEN) {
        // Price updates
        ws.send(JSON.stringify({
          type: 'price_update',
          data: {
            SPY: 450.23 + (Math.random() - 0.5) * 2,
            TSLA: 242.15 + (Math.random() - 0.5) * 5,
            AAPL: 187.50 + (Math.random() - 0.5) * 3,
            timestamp: new Date().toISOString()
          }
        }));

        // Engine status updates (if using real data)
        if (broker.status.provider === 'ibkr') {
          try {
            const { getMarketData, getVIXData } = await import('./services/marketDataService.js');
            const spyData = await getMarketData('SPY');
            const vixData = await getVIXData();

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
          } catch (error) {
            console.error('[WebSocket] Error fetching market data:', error);
          }
        }
      }
    }, 5000);

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

  // PnL endpoint for Trades page - transforms stored trades to PnlRow format
  app.get('/api/pnl', async (_req, res) => {
    try {
      const trades = await storage.getTrades();

      // Transform trades to PnlRow format expected by frontend
      const pnlRows = trades.map(trade => {
        const credit = parseFloat(trade.credit) || 0;
        const qty = trade.quantity || 1;
        const entryPerContract = credit / (qty * 100); // Per-share entry price

        return {
          tradeId: trade.id,
          ts: trade.submittedAt?.toISOString() || new Date().toISOString(),
          symbol: trade.symbol,
          strategy: trade.strategy,
          side: 'SELL' as const, // Engine sells options for premium
          qty: qty,
          entry: entryPerContract,
          exit: trade.status === 'filled' ? entryPerContract : null, // NULL if still open
          fees: qty * 1.00, // Estimated fees per contract
          realized: trade.status === 'filled' ? credit : 0,
          run: trade.status === 'pending' ? 0 : credit, // Running P&L
          notes: `${trade.strategy} ${parseFloat(trade.sellStrike).toFixed(0)} strike - ${trade.status}`,
        };
      });

      // Sort by timestamp descending (newest first)
      pnlRows.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

      res.json(pnlRows);
    } catch (error) {
      console.error('[API] Failed to fetch PnL:', error);
      res.status(500).json({ error: 'Failed to fetch P&L data' });
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

  // Broker diagnostics - tries to establish connection for accurate status
  app.get('/api/broker/diag', async (_req, res) => {
    let last = { oauth: { status: null, ts: '' }, sso: { status: null, ts: '' }, validate: { status: null, ts: '' }, init: { status: null, ts: '' } };

    if (broker.status.provider === 'ibkr') {
      // Try to establish/verify connection first (same as Engine status)
      try {
        last = await ensureIbkrReady();
      } catch (err) {
        // Fall back to cached diagnostics
        last = getIbkrDiagnostics();
      }
    }

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

  // Test IBKR market data endpoint (no auth required - for debugging)
  app.get('/api/broker/test-market/:symbol', async (req, res) => {
    try {
      const symbol = req.params.symbol?.toUpperCase() || 'SPY';
      if (broker.status.provider !== 'ibkr') {
        return res.status(400).json({ ok: false, error: 'IBKR not configured' });
      }
      console.log(`[TEST] Calling IBKR getMarketData for ${symbol}...`);
      const data = await broker.api.getMarketData(symbol);
      console.log(`[TEST] Got ${symbol} price: $${data.price}`);
      return res.json({ ok: true, source: 'ibkr', data });
    } catch (err: any) {
      console.error(`[TEST] Error getting market data:`, err.message);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Test IBKR option chain endpoint (no auth required - for debugging)
  app.get('/api/broker/test-options/:symbol', async (req, res) => {
    try {
      const symbol = req.params.symbol?.toUpperCase() || 'SPY';
      const expiration = req.query.expiration as string | undefined;

      if (broker.status.provider !== 'ibkr') {
        return res.status(400).json({ ok: false, error: 'IBKR not configured' });
      }

      console.log(`[TEST] Calling IBKR getOptionChainWithStrikes for ${symbol}...`);
      const { getOptionChainWithStrikes } = await import('./broker/ibkr');
      const data = await getOptionChainWithStrikes(symbol, expiration);

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

      // Get cookie string for WebSocket authentication
      const cookieString = await getIbkrCookieString();
      if (!cookieString) {
        return res.status(500).json({ ok: false, error: 'Failed to get IBKR cookies' });
      }

      // Initialize WebSocket manager
      const wsManager = initIbkrWebSocket(cookieString);

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

  // Get WebSocket status
  app.get('/api/broker/ws/status', async (_req, res) => {
    try {
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

  // Start option chain streaming for a symbol (for engine strike selection)
  app.post('/api/broker/stream/start', async (req, res) => {
    try {
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

  // Stop option chain streaming for a symbol
  app.post('/api/broker/stream/stop', async (req, res) => {
    try {
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

  // Get option chain streamer status
  app.get('/api/broker/stream/status', async (_req, res) => {
    try {
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

  // Get cached option chain (what the engine sees)
  app.get('/api/broker/stream/chain/:symbol', async (req, res) => {
    try {
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

  // ============================================
  // End of Option Chain Streamer Endpoints
  // ============================================

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

      // If all steps are successful, establish the gateway for future orders
      if (allConnected) {
        console.log('[IBKR Test] All auth steps successful, establishing gateway for trading...');
        try {
          // Call the establishGateway to prepare for trading
          const broker = getBroker();
          if (broker && 'establishGateway' in broker) {
            await (broker as any).establishGateway();
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
  // Chart Historical Data API (IBKR Only)
  // ============================================
  // Import historical service
  const { fetchHistoricalBars, getRecentBars, clearHistoricalCache, getCacheStatus } = await import('./services/ibkrHistoricalService');

  // GET /api/chart/history/:symbol - Fetch historical bars from IBKR
  app.get('/api/chart/history/:symbol', async (req, res) => {
    try {
      const { symbol } = req.params;
      const timeframe = (req.query.timeframe as string) || '5m';
      const count = parseInt(req.query.count as string) || 200;
      const forceRefresh = req.query.refresh === 'true';

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

      return res.json({
        symbol,
        timeframe,
        count: bars.length,
        source: 'ibkr',
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
      console.error('[Chart] Historical data error:', error);
      return res.status(500).json({
        error: 'Failed to fetch historical data from IBKR',
        message: error.message || String(error),
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
