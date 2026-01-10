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
import { ibkrCredentials } from '@shared/schema';
import { initIbkrWebSocket, getIbkrWebSocketManager } from '../broker/ibkrWebSocket';
import { ensureIbkrReady, getIbkrCookieString, getIbkrSessionToken } from '../broker/ibkr';

// Conids for key symbols
const SPY_CONID = 756733;
const VIX_CONID = 13455763;

// Retry configuration
const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY_MS = 5000; // 5 seconds
const HEALTH_CHECK_INTERVAL_MS = 30000; // 30 seconds

let healthCheckInterval: NodeJS.Timeout | null = null;
let isStarting = false;

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
 */
async function startWebSocketStream(): Promise<void> {
  if (isStarting) {
    throw new Error('Already starting');
  }
  isStarting = true;

  try {
    // Check if we have any IBKR credentials in the database
    if (!db) {
      throw new Error('Database not available');
    }

    const [creds] = await db.select({
      userId: ibkrCredentials.userId,
    })
      .from(ibkrCredentials)
      .limit(1);

    if (!creds) {
      throw new Error('No IBKR credentials found in database');
    }

    console.log('[MarketDataAutoStart] Found IBKR credentials, initializing...');

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

    // Set up credential refresh callback for reconnections
    wsManager.setCredentialRefreshCallback(async () => {
      console.log('[MarketDataAutoStart] Refreshing credentials for WebSocket reconnection...');
      try {
        await ensureIbkrReady();
        const newCookieString = await getIbkrCookieString();
        const newSessionToken = await getIbkrSessionToken();
        console.log(`[MarketDataAutoStart] Credentials refreshed: cookies=${!!newCookieString}, session=${!!newSessionToken}`);
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
 */
function startHealthCheck(): void {
  if (healthCheckInterval) {
    return; // Already running
  }

  console.log('[MarketDataAutoStart] Starting health check every 30s');

  healthCheckInterval = setInterval(async () => {
    const wsManager = getIbkrWebSocketManager();

    if (!wsManager?.connected) {
      console.log('[MarketDataAutoStart][HealthCheck] WebSocket not connected, attempting to reconnect...');
      try {
        await startWebSocketStream();
        console.log('[MarketDataAutoStart][HealthCheck] Reconnected successfully');
      } catch (err: any) {
        console.error('[MarketDataAutoStart][HealthCheck] Reconnection failed:', err.message);
      }
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
