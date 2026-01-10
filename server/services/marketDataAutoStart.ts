/**
 * Market Data Auto-Start Service
 *
 * Automatically starts IBKR WebSocket streaming for SPY and VIX
 * on server startup. This ensures real-time market data is available
 * immediately without requiring manual initialization.
 */

import { db } from '../db';
import { ibkrCredentials } from '@shared/schema';
import { initIbkrWebSocket, getIbkrWebSocketManager } from '../broker/ibkrWebSocket';
import { ensureIbkrReady, getIbkrCookieString, getIbkrSessionToken } from '../broker/ibkr';

// Conids for key symbols
const SPY_CONID = 756733;
const VIX_CONID = 13455763;

/**
 * Auto-start WebSocket streaming for market data
 * Called on server startup
 */
export async function autoStartMarketDataStream(): Promise<void> {
  console.log('[MarketDataAutoStart] Attempting to auto-start WebSocket streaming...');

  try {
    // Check if we have any IBKR credentials in the database
    if (!db) {
      console.log('[MarketDataAutoStart] Database not available, skipping auto-start');
      return;
    }

    const [creds] = await db.select({
      userId: ibkrCredentials.userId,
    })
      .from(ibkrCredentials)
      .limit(1);

    if (!creds) {
      console.log('[MarketDataAutoStart] No IBKR credentials found, skipping auto-start');
      return;
    }

    console.log('[MarketDataAutoStart] Found IBKR credentials, initializing...');

    // Ensure IBKR client is ready (this will restore tokens from database)
    await ensureIbkrReady();

    // Get credentials for WebSocket
    const cookieString = await getIbkrCookieString();
    const sessionToken = await getIbkrSessionToken();

    if (!cookieString) {
      console.log('[MarketDataAutoStart] No cookie string available, skipping WebSocket start');
      return;
    }

    console.log('[MarketDataAutoStart] Starting WebSocket with cookies...');

    // Initialize WebSocket
    const wsManager = initIbkrWebSocket(cookieString, sessionToken);

    // Set up credential refresh callback for reconnections
    // This ensures fresh credentials are used when WebSocket needs to reconnect
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
    try {
      await wsManager.connect();
      console.log('[MarketDataAutoStart] WebSocket connected!');
    } catch (connErr: any) {
      console.error('[MarketDataAutoStart] WebSocket connection failed:', connErr.message);
      return;
    }

    // Subscribe to SPY and VIX
    wsManager.subscribe(SPY_CONID, { symbol: 'SPY', type: 'stock' });
    wsManager.subscribe(VIX_CONID, { symbol: 'VIX', type: 'stock' });
    console.log('[MarketDataAutoStart] Subscribed to SPY and VIX');

    // Set up logging for incoming data
    wsManager.onUpdate((update) => {
      if (update.conid === SPY_CONID && update.last) {
        console.log(`[MarketDataAutoStart] SPY: $${update.last.toFixed(2)} @ ${new Date().toISOString()}`);
      }
    });

    console.log('[MarketDataAutoStart] Market data streaming active!');

    // Also try to start option chain streaming if market is open
    // This is a fallback in case the authenticated event wasn't received
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

  } catch (error: any) {
    console.error('[MarketDataAutoStart] Failed to auto-start:', error.message);
  }
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
