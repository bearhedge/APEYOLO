/**
 * Market Data Auto-Start Service
 *
 * Automatically starts IBKR WebSocket streaming for SPY and VIX
 * on server startup. This ensures real-time market data is available
 * immediately without requiring manual initialization.
 *
 * Includes retry logic and periodic health checks to ensure
 * WebSocket stays connected.
 */

import { db } from '../db';
import { ibkrCredentials, latestPrices } from '@shared/schema';
import { initIbkrWebSocket, getIbkrWebSocketManager } from '../broker/ibkrWebSocket';
import { ensureIbkrReady, getIbkrCookieString, getIbkrSessionToken, clearIbkrSession } from '../broker/ibkr';
import { getBroker } from '../broker';

// Conids for key symbols
const SPY_CONID = 756733;
const VIX_CONID = 13455763;

// Retry configuration
const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY_MS = 5000; // 5 seconds
const HEALTH_CHECK_INTERVAL_MS = 30000; // 30 seconds

let healthCheckInterval: NodeJS.Timeout | null = null;
let isStarting = false;

// Connection mode: 'oauth' = use cloud OAuth, 'relay' = use local TWS/Gateway
// This is in-memory only - no database changes needed
let connectionMode: 'oauth' | 'relay' = 'oauth';

/**
 * Get the current connection mode
 */
export function getConnectionMode(): 'oauth' | 'relay' {
  return connectionMode;
}

/**
 * Set the connection mode and handle WebSocket state accordingly
 * When switching to relay mode, disconnect OAuth WebSocket so user can use local TWS
 */
export function setConnectionMode(mode: 'oauth' | 'relay'): void {
  const previousMode = connectionMode;
  connectionMode = mode;
  console.log(`[MarketDataAutoStart] Connection mode changed: ${previousMode} -> ${mode}`);

  if (mode === 'relay') {
    // Fully disconnect OAuth - clear session and disconnect WebSocket
    console.log('[MarketDataAutoStart] Clearing OAuth session for TWS/Gateway mode...');
    clearIbkrSession();

    const wsManager = getIbkrWebSocketManager();
    if (wsManager?.connected) {
      console.log('[MarketDataAutoStart] Disconnecting OAuth WebSocket for relay mode...');
      wsManager.disconnect();
    }
  } else if (mode === 'oauth' && previousMode !== 'oauth') {
    // Only clear when actually SWITCHING from relay to oauth, not when already in oauth mode
    // This prevents unnecessary session clearing that resets auth diagnostics to 0
    console.log('[MarketDataAutoStart] Clearing cached IBKR session for fresh auth (switching from relay)...');
    clearIbkrSession();

    // Immediately try to reconnect WebSocket when switching back to OAuth
    const wsManager = getIbkrWebSocketManager();
    if (!wsManager?.connected) {
      console.log('[MarketDataAutoStart] Reconnecting OAuth WebSocket immediately...');
      // Run async reconnection (don't await - let it happen in background)
      startWebSocketStream().then(() => {
        console.log('[MarketDataAutoStart] OAuth WebSocket reconnected successfully');
      }).catch((err) => {
        console.error('[MarketDataAutoStart] Failed to reconnect OAuth WebSocket:', err.message);
      });
    }
  }
}

/**
 * Auto-start WebSocket streaming for market data
 * Called on server startup - includes retry logic
 */
export async function autoStartMarketDataStream(): Promise<void> {
  console.log('[MarketDataAutoStart] Attempting to auto-start WebSocket streaming...');

  // Try to start with retries
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await startWebSocketStream();
      console.log(`[MarketDataAutoStart] Successfully started on attempt ${attempt}`);

      // Start health check to keep WebSocket alive
      startHealthCheck();
      return;
    } catch (err: any) {
      lastError = err;
      console.error(`[MarketDataAutoStart] Attempt ${attempt}/${MAX_RETRIES} failed:`, err.message);

      if (attempt < MAX_RETRIES) {
        const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        console.log(`[MarketDataAutoStart] Retrying in ${delay / 1000}s...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  console.error('[MarketDataAutoStart] All retry attempts failed. WebSocket will start on next request or health check.');

  // Start health check anyway - it will keep trying
  startHealthCheck();
}

/**
 * Core function to start WebSocket streaming
 * Exported for manual reconnection via API endpoint
 */
export async function startWebSocketStream(): Promise<void> {
  if (isStarting) {
    throw new Error('Already starting');
  }
  isStarting = true;

  try {
    // Check if we have IBKR credentials (either in database or env vars)
    let hasCredentials = false;

    // First check environment variables
    const envConfigured = !!(process.env.IBKR_CLIENT_ID && process.env.IBKR_PRIVATE_KEY);
    if (envConfigured) {
      console.log('[MarketDataAutoStart] Using IBKR credentials from environment variables');
      hasCredentials = true;
    }

    // Also check database if available
    if (!hasCredentials && db) {
      const [creds] = await db.select({
        userId: ibkrCredentials.userId,
      })
        .from(ibkrCredentials)
        .limit(1);

      if (creds) {
        console.log('[MarketDataAutoStart] Using IBKR credentials from database');
        hasCredentials = true;
      }
    }

    if (!hasCredentials) {
      throw new Error('No IBKR credentials found (checked env vars and database)');
    }

    console.log('[MarketDataAutoStart] Found IBKR credentials, initializing...');

    // Create the IBKR provider singleton first (fixes initialization order bug)
    // getBroker() creates activeClient which ensureIbkrReady() depends on
    getBroker();

    // Ensure IBKR client is ready (this will restore tokens from database)
    await ensureIbkrReady();

    // Get credentials for WebSocket
    const cookieString = await getIbkrCookieString();
    const sessionToken = await getIbkrSessionToken();

    if (!cookieString) {
      throw new Error('No cookie string available after ensureIbkrReady');
    }

    console.log('[MarketDataAutoStart] Starting WebSocket with cookies...');

    // Initialize WebSocket
    const wsManager = initIbkrWebSocket(cookieString, sessionToken);

    // Restore last known prices from database BEFORE connecting
    // This ensures cache has data even if WebSocket takes time to stream
    try {
      if (!db) throw new Error('Database not available');
      const storedPrices = await db.select().from(latestPrices);
      for (const p of storedPrices) {
        if (p.conid && Number(p.price) > 0) {
          wsManager.seedCache(p.conid, {
            last: Number(p.price),
            bid: Number(p.bid) || 0,
            ask: Number(p.ask) || 0,
            symbol: p.symbol
          });
        }
      }
      console.log(`[MarketDataAutoStart] Restored ${storedPrices.length} prices from database`);
    } catch (dbErr: any) {
      console.warn('[MarketDataAutoStart] Failed to restore prices from database:', dbErr.message);
    }

    // Set up credential refresh callback for reconnections
    // CRITICAL: Must force refresh to get fresh OAuth + SSO tokens when WebSocket auth fails
    wsManager.setCredentialRefreshCallback(async () => {
      console.log('[MarketDataAutoStart] Refreshing credentials for WebSocket reconnection (forcing full refresh)...');
      try {
        // Force refresh = true to clear cached tokens and get fresh ones from IBKR
        await ensureIbkrReady(true);
        const newCookieString = await getIbkrCookieString();
        const newSessionToken = await getIbkrSessionToken();
        console.log(`[MarketDataAutoStart] Credentials refreshed: cookies=${!!newCookieString} (len=${newCookieString?.length || 0}), session=${!!newSessionToken}`);
        return {
          cookieString: newCookieString || '',
          sessionToken: newSessionToken,
        };
      } catch (err: any) {
        console.error('[MarketDataAutoStart] Failed to refresh credentials:', err.message);
        return { cookieString: cookieString || '', sessionToken: null };
      }
    });

    // Connect to IBKR
    await wsManager.connect();
    console.log('[MarketDataAutoStart] WebSocket connected!');

    // Subscribe to SPY and VIX
    wsManager.subscribe(SPY_CONID, { symbol: 'SPY', type: 'stock' });
    wsManager.subscribe(VIX_CONID, { symbol: 'VIX', type: 'stock' });
    console.log('[MarketDataAutoStart] Subscribed to SPY and VIX');

    console.log('[MarketDataAutoStart] Market data streaming active!');

    // Also try to start option chain streaming if market is open
    try {
      const { getOptionChainStreamer } = await import('../broker/optionChainStreamer');
      const streamer = getOptionChainStreamer();
      const status = streamer.getStatus();
      if (!status.isStreaming) {
        // Check if market is open
        const now = new Date();
        const ny = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
        const dayOfWeek = ny.getDay();
        const hours = ny.getHours();
        const minutes = ny.getMinutes();
        const currentMinutes = hours * 60 + minutes;
        const marketOpen = 9 * 60 + 30;
        const marketClose = 16 * 60;
        const isMarketOpen = dayOfWeek >= 1 && dayOfWeek <= 5 && currentMinutes >= marketOpen && currentMinutes < marketClose;

        if (isMarketOpen) {
          console.log('[MarketDataAutoStart] Market is open, starting option chain streaming...');
          await streamer.startStreaming('SPY');
          console.log('[MarketDataAutoStart] Option chain streaming started!');
        } else {
          console.log('[MarketDataAutoStart] Market is closed, option chain streaming will start at market open');
          streamer.scheduleMarketOpenStart('SPY');
        }
      }
    } catch (optErr: any) {
      console.error('[MarketDataAutoStart] Failed to start option chain streaming:', optErr.message);
    }
  } finally {
    isStarting = false;
  }
}

/**
 * Start periodic health check to ensure WebSocket stays connected
 * Also verifies SPY/VIX subscriptions exist and adds them if missing
 */
function startHealthCheck(): void {
  if (healthCheckInterval) {
    return; // Already running
  }

  console.log('[MarketDataAutoStart] Starting health check every 30s');

  healthCheckInterval = setInterval(async () => {
    // Skip reconnect if in relay mode - user is using local TWS/Gateway
    if (connectionMode === 'relay') {
      console.log('[MarketDataAutoStart][HealthCheck] Relay mode active - skipping OAuth reconnect');
      return;
    }

    const wsManager = getIbkrWebSocketManager();

    if (!wsManager?.connected) {
      console.log('[MarketDataAutoStart][HealthCheck] WebSocket not connected, attempting to reconnect...');
      try {
        await startWebSocketStream();
        console.log('[MarketDataAutoStart][HealthCheck] Reconnected successfully');
      } catch (err: any) {
        console.error('[MarketDataAutoStart][HealthCheck] Reconnection failed:', err.message);
      }
      return; // Don't check subscriptions if we just reconnected - startWebSocketStream handles them
    }

    // Verify SPY/VIX subscriptions exist - add if missing
    // This handles cases where subscriptions were lost but connection stayed up
    const subs = wsManager.getSubscriptions();
    const hasSpy = subs.has(SPY_CONID);
    const hasVix = subs.has(VIX_CONID);

    if (!hasSpy) {
      console.log('[MarketDataAutoStart][HealthCheck] SPY not subscribed, adding...');
      wsManager.subscribe(SPY_CONID, { symbol: 'SPY', type: 'stock' });
    }
    if (!hasVix) {
      console.log('[MarketDataAutoStart][HealthCheck] VIX not subscribed, adding...');
      wsManager.subscribe(VIX_CONID, { symbol: 'VIX', type: 'stock' });
    }

    // Log status if subscriptions were missing
    if (!hasSpy || !hasVix) {
      console.log(`[MarketDataAutoStart][HealthCheck] Subscription check: SPY=${hasSpy}, VIX=${hasVix} -> now subscribed`);
    }
  }, HEALTH_CHECK_INTERVAL_MS);
}

/**
 * Check if WebSocket is streaming fresh data
 */
export function isMarketDataStreaming(): boolean {
  const wsManager = getIbkrWebSocketManager();
  if (!wsManager?.connected) return false;

  const spyData = wsManager.getCachedMarketData(SPY_CONID);
  if (!spyData?.timestamp) return false;

  // Check if data is fresh (less than 60 seconds old)
  const ageMs = Date.now() - spyData.timestamp.getTime();
  return ageMs < 60000;
}
