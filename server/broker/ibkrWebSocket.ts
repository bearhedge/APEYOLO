/**
 * IBKR WebSocket Streaming Client
 *
 * Connects to IBKR's WebSocket API for real-time market data streaming.
 * Unlike HTTP polling (snapshot), WebSocket provides continuous push updates.
 *
 * IBKR WebSocket Protocol:
 * - URL: wss://api.ibkr.com/v1/api/ws
 * - Subscribe: smd+{conid}+{"fields":["31","84","86"]}
 * - Unsubscribe: umd+{conid}+{"fields":["31","84","86"]}
 * - Heartbeat: tic (every ~30 seconds to keep connection alive)
 */

import WebSocket from 'ws';
import { db } from '../db';
import { latestPrices } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { getConnectionStateManager } from './connectionState';

// Market data field codes from IBKR API
export const IBKR_FIELDS = {
  LAST_PRICE: '31',
  BID: '84',
  ASK: '86',
  // Stock-specific fields
  DAY_HIGH: '7308',        // Stock: Day high price
  DAY_LOW: '7309',         // Stock: Day low price
  OPEN_PRICE: '7283',      // Stock: Opening price
  PREVIOUS_CLOSE: '7311',  // Stock: Previous day close
  // Option-specific fields (same codes, different meanings)
  DELTA: '7308',           // Option: Delta
  GAMMA: '7309',           // Option: Gamma
  THETA: '7310',
  VEGA: '7633',
  IV: '7283',              // Option: Implied Volatility
  OPEN_INTEREST: '7311',   // Option: Open Interest
  // Extended hours fields
  AFTER_HOURS_LAST: '7762',
  PRE_MARKET_LAST: '7741',
  AFTER_HOURS_CHANGE: '7744',
  PRE_MARKET_CHANGE: '7745',
  OVERNIGHT_LAST: '7682',  // Overnight/extended trading last price
} as const;

// Default fields for options streaming
const DEFAULT_OPTION_FIELDS = [
  IBKR_FIELDS.LAST_PRICE,
  IBKR_FIELDS.BID,
  IBKR_FIELDS.ASK,
  IBKR_FIELDS.DELTA,
  IBKR_FIELDS.GAMMA,
  IBKR_FIELDS.THETA,
  IBKR_FIELDS.VEGA,
  IBKR_FIELDS.IV,
  IBKR_FIELDS.OPEN_INTEREST,
];

// Default fields for stock streaming (includes extended hours + day range)
const DEFAULT_STOCK_FIELDS = [
  IBKR_FIELDS.LAST_PRICE,
  IBKR_FIELDS.BID,
  IBKR_FIELDS.ASK,
  IBKR_FIELDS.DAY_HIGH,        // ✅ Real day high
  IBKR_FIELDS.DAY_LOW,         // ✅ Real day low
  IBKR_FIELDS.OPEN_PRICE,      // ✅ Opening price
  IBKR_FIELDS.PREVIOUS_CLOSE,  // ✅ Previous close
  IBKR_FIELDS.AFTER_HOURS_LAST,
  IBKR_FIELDS.PRE_MARKET_LAST,
  IBKR_FIELDS.OVERNIGHT_LAST,
];

export interface MarketDataUpdate {
  conid: number;
  symbol?: string;
  last?: number;
  bid?: number;
  ask?: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  iv?: number;
  openInterest?: number;
  timestamp: Date;
}

export type MarketDataCallback = (update: MarketDataUpdate) => void;

interface Subscription {
  conid: number;
  fields: string[];
  symbol?: string;
  type: 'stock' | 'option';
}

// Cached market data for instant lookups (no snapshot needed)
export interface CachedMarketData {
  conid: number;
  symbol?: string;
  last: number;
  bid: number;
  ask: number;
  dayHigh?: number;        // ✅ Real day high from IBKR
  dayLow?: number;         // ✅ Real day low from IBKR
  openPrice?: number;      // ✅ Opening price from IBKR
  previousClose?: number;  // ✅ Previous close from IBKR
  timestamp: Date;
}

// Callback type for refreshing credentials before reconnection
export type CredentialRefreshCallback = () => Promise<{ cookieString: string; sessionToken: string | null }>;

export class IbkrWebSocketManager {
  private ws: WebSocket | null = null;
  private wsUrl = 'wss://api.ibkr.com/v1/api/ws';
  private cookieString: string;
  private sessionToken: string | null = null;
  private subscriptions = new Map<number, Subscription>();
  private callbacks = new Set<MarketDataCallback>();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;  // Increased from 5 to allow more attempts
  private reconnectDelay = 1000; // Start with 1 second
  private lastReconnectReset = 0; // Track when we last reset the counter
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private isConnecting = false;
  private isConnected = false;
  private isAuthenticated = false;
  // Cache of latest market data per conid (for snapshot-free lookups)
  private marketDataCache = new Map<number, CachedMarketData>();
  // Callback to refresh credentials before reconnection
  private credentialRefreshCallback: CredentialRefreshCallback | null = null;
  // Track update counts per conid for throttled logging
  private updateCounts = new Map<number, number>();
  // Track when we last received actual market data (not just heartbeats)
  private lastDataReceived: Date | null = null;
  // Track subscription errors (e.g., "Missing iserver bridge")
  private subscriptionErrorMessage: string | null = null;
  // Session token expiry tracking - proactive refresh before expiry
  private sessionTokenExpiresAt: number = 0;
  private sessionRefreshInterval: NodeJS.Timeout | null = null;
  // Track last persist time per conid for debouncing (max once per 5 seconds)
  private lastPersist = new Map<number, number>();
  // Auto-healing: health check interval that detects stale data and auto-reconnects
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private readonly STALE_THRESHOLD_MS = 60000; // Data older than 60s = stale
  private readonly HEALTH_CHECK_INTERVAL_MS = 30000; // Check every 30s

  constructor(cookieString: string, sessionToken?: string | null) {
    this.cookieString = cookieString;
    this.sessionToken = sessionToken || null;
    // Default expiry: 9 minutes from now if token provided
    if (sessionToken) {
      this.sessionTokenExpiresAt = Date.now() + (540 * 1000);
    }
  }

  /**
   * Set a callback to refresh credentials before reconnection
   */
  setCredentialRefreshCallback(callback: CredentialRefreshCallback): void {
    this.credentialRefreshCallback = callback;
  }

  /**
   * Update cookies and session token (needed when IBKR session refreshes)
   */
  updateCookies(cookieString: string, sessionToken?: string | null): void {
    this.cookieString = cookieString;
    if (sessionToken !== undefined) {
      this.sessionToken = sessionToken;
    }
  }

  /**
   * Update session token with optional expiry tracking
   * @param sessionToken - New session token
   * @param expiresInSeconds - Token lifetime in seconds (default 540 = 9 minutes)
   */
  updateSessionToken(sessionToken: string | null, expiresInSeconds: number = 540): void {
    this.sessionToken = sessionToken;
    if (sessionToken) {
      this.sessionTokenExpiresAt = Date.now() + (expiresInSeconds * 1000);
      console.log(`[IbkrWS] Session token updated, expires in ${expiresInSeconds}s`);
    } else {
      this.sessionTokenExpiresAt = 0;
    }
  }

  /**
   * Check if session token is still valid (with 30s safety margin)
   */
  isSessionTokenValid(): boolean {
    return this.sessionToken !== null && this.sessionTokenExpiresAt > Date.now() + 30_000;
  }

  /**
   * Get session token expiry timestamp
   */
  getSessionTokenExpiresAt(): number {
    return this.sessionTokenExpiresAt;
  }

  /**
   * Start proactive session token refresh (every 5 minutes)
   */
  startSessionRefresh(): void {
    this.stopSessionRefresh();

    this.sessionRefreshInterval = setInterval(async () => {
      if (this.isConnected && this.isAuthenticated && this.credentialRefreshCallback) {
        // Check if token will expire in next 2 minutes
        if (this.sessionTokenExpiresAt > 0 && this.sessionTokenExpiresAt < Date.now() + 120_000) {
          console.log('[IbkrWS] Session token expiring soon, refreshing...');
          await this.refreshSessionToken();
        }
      }
    }, 60_000); // Check every minute

    console.log('[IbkrWS] Started session refresh interval');
  }

  /**
   * Stop session refresh interval
   */
  stopSessionRefresh(): void {
    if (this.sessionRefreshInterval) {
      clearInterval(this.sessionRefreshInterval);
      this.sessionRefreshInterval = null;
    }
  }

  /**
   * Refresh session token proactively before expiry
   */
  async refreshSessionToken(): Promise<void> {
    if (!this.credentialRefreshCallback) {
      console.warn('[IbkrWS] No credential refresh callback set, cannot refresh session');
      return;
    }

    try {
      console.log('[IbkrWS] Refreshing session token...');
      const { sessionToken } = await this.credentialRefreshCallback();

      if (sessionToken) {
        this.updateSessionToken(sessionToken);

        // Re-authenticate with new token if connected
        if (this.ws && this.isConnected && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ session: sessionToken }));
          console.log('[IbkrWS] Sent refreshed session token to WebSocket');
        }
      } else {
        console.warn('[IbkrWS] Credential refresh returned no session token');
      }
    } catch (err) {
      console.error('[IbkrWS] Failed to refresh session token:', err);
    }
  }

  /**
   * Connect to IBKR WebSocket
   * @param timeoutMs - Connection timeout in milliseconds (default: 30 seconds)
   *
   * IBKR WebSocket Authentication Flow:
   * 1. Connect with cookies in headers
   * 2. Server may respond "waiting for session"
   * 3. Send {"session": "TOKEN"} to authenticate
   * 4. Wait for authentication confirmation
   * 5. Then subscribe to market data
   */
  async connect(timeoutMs: number = 30000): Promise<void> {
    if (this.isConnecting || this.isConnected) {
      console.log('[IbkrWS] Already connected or connecting');
      return;
    }

    this.isConnecting = true;
    this.isAuthenticated = false;

    return new Promise((resolve, reject) => {
      // Set up connection timeout to prevent hanging indefinitely
      const connectionTimeout = setTimeout(() => {
        this.isConnecting = false;
        if (this.ws) {
          this.ws.terminate();
          this.ws = null;
        }
        reject(new Error(`WebSocket connection timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      try {
        console.log('[IbkrWS] Connecting to IBKR WebSocket...');
        console.log(`[IbkrWS] URL: ${this.wsUrl}`);
        console.log(`[IbkrWS] Has session token: ${!!this.sessionToken}`);
        console.log(`[IbkrWS] Cookie length: ${this.cookieString?.length || 0}`);

        this.ws = new WebSocket(this.wsUrl, {
          headers: {
            'Cookie': this.cookieString,
            'User-Agent': 'apeyolo/1.0',
          },
        });

        this.ws.on('open', () => {
          console.log('[IbkrWS] WebSocket connection opened');
          this.isConnected = true;
          this.isConnecting = false;
          this.reconnectAttempts = 0;
          this.reconnectDelay = 1000;

          // Update connection state machine
          getConnectionStateManager().setWebSocketStatus(true, false);

          // Start heartbeat to keep connection alive (every 10 seconds per IBKR docs)
          this.startHeartbeat();

          // Send session token to authenticate
          if (this.sessionToken) {
            const sessionMsg = JSON.stringify({ session: this.sessionToken });
            console.log(`[IbkrWS] Sending session authentication: {"session":"${this.sessionToken.substring(0, 8)}..."}`);
            this.ws!.send(sessionMsg);
          } else {
            console.error('[IbkrWS] CRITICAL: No session token available for auth!');
            console.error('[IbkrWS] Aborting connection - cannot authenticate without token.');
            clearTimeout(connectionTimeout);
            this.ws!.close();
            this.isConnected = false;
            this.isConnecting = false;
            reject(new Error('Cannot authenticate WebSocket without session token'));
            return;
          }
        });

        this.ws.on('message', (data: Buffer) => {
          const msgStr = data.toString();

          // Handle authentication-related messages
          if (msgStr.includes('waiting for session')) {
            console.log('[IbkrWS] Server waiting for session - sending session token');
            if (this.sessionToken) {
              const sessionMsg = JSON.stringify({ session: this.sessionToken });
              this.ws!.send(sessionMsg);
            } else {
              console.error('[IbkrWS] No session token to send!');
              clearTimeout(connectionTimeout);
              reject(new Error('WebSocket requires session token but none available'));
            }
            return;
          }

          // Check for authentication success
          try {
            const msg = JSON.parse(msgStr);

            // Log all non-heartbeat messages during auth
            if (msg.topic !== 'system' || !msg.hb) {
              console.log(`[IbkrWS] Auth phase msg: topic=${msg.topic} keys=${Object.keys(msg).join(',')}`);
            }

            // Check for sts (status) message - this indicates connection status
            if (msg.topic === 'sts') {
              console.log(`[IbkrWS] Received sts message: ${JSON.stringify(msg)}`);

              // CRITICAL: Check if IBKR actually authenticated us
              // IBKR returns {"topic":"sts","authenticated":false} when session is invalid
              if (msg.authenticated === false) {
                console.error('[IbkrWS] IBKR returned authenticated=false! Session token is invalid.');
                clearTimeout(connectionTimeout);
                // Clean up and close connection - the 'close' handler will trigger scheduleReconnect
                // which will refresh credentials with exponential backoff
                this.stopHeartbeat();
                this.stopSessionRefresh();
                this.isConnected = false;
                this.isConnecting = false;
                this.isAuthenticated = false;
                // Note: Don't clear cache here - keep Friday's data for weekend display
                if (this.ws) {
                  this.ws.close();
                }
                reject(new Error('IBKR WebSocket authentication failed - session invalid'));
                return;
              }

              // authenticated=true or no authenticated field (legacy) - we're good
              this.isAuthenticated = true;
              // Update connection state machine - now authenticated
              getConnectionStateManager().setWebSocketStatus(true, true);
              clearTimeout(connectionTimeout);
              // Start proactive session refresh to prevent token expiry
              this.startSessionRefresh();
              // Now that we've received sts, subscribe to market data
              console.log('[IbkrWS] sts received with auth success - subscribing to market data');
              this.resubscribeAll();
              resolve();
              return;
            }

            // Check various authentication confirmation formats from IBKR
            const isAuthConfirmed =
              msg.authenticated === true ||
              msg.result === 'success' ||
              msg.iserver?.authStatus?.authenticated === true ||
              // Also check for success message on topic="system"
              (msg.topic === 'system' && msg.success);

            if (isAuthConfirmed) {
              console.log('[IbkrWS] WebSocket authenticated successfully');
              this.isAuthenticated = true;
              // Update connection state machine - now authenticated
              getConnectionStateManager().setWebSocketStatus(true, true);
              clearTimeout(connectionTimeout);
              this.startSessionRefresh();
              // Now that we're authenticated, resubscribe
              this.resubscribeAll();
              resolve();
              return;
            }

            // Handle session confirmation (some IBKR versions)
            if (msg.session) {
              console.log('[IbkrWS] Session confirmed');
              this.isAuthenticated = true;
              // Update connection state machine - now authenticated
              getConnectionStateManager().setWebSocketStatus(true, true);
              clearTimeout(connectionTimeout);
              this.startSessionRefresh();
              this.resubscribeAll();
              resolve();
              return;
            }
          } catch {
            // Not JSON, continue to normal handling
          }

          // Handle normal messages
          this.handleMessage(msgStr);

          // If we haven't resolved yet and got a market data message, consider authenticated
          if (!this.isAuthenticated && msgStr.includes('"topic":"smd"')) {
            console.log('[IbkrWS] Received market data - connection authenticated');
            this.isAuthenticated = true;
            // Update connection state machine - now authenticated
            getConnectionStateManager().setWebSocketStatus(true, true);
            clearTimeout(connectionTimeout);
            this.startSessionRefresh();
            resolve();
          }
        });

        this.ws.on('error', (error) => {
          clearTimeout(connectionTimeout);
          console.error('[IbkrWS] WebSocket error:', error.message);
          this.isConnecting = false;
          this.isAuthenticated = false;
          if (!this.isConnected) {
            reject(error);
          }
        });

        this.ws.on('close', (code, reason) => {
          clearTimeout(connectionTimeout);
          console.log(`[IbkrWS] Connection closed: ${code} - ${reason.toString()}`);
          this.isConnected = false;
          this.isConnecting = false;
          this.isAuthenticated = false;
          // Update connection state machine - disconnected
          getConnectionStateManager().setWebSocketStatus(false, false);
          this.stopHeartbeat();

          // Attempt reconnection
          this.scheduleReconnect();
        });

      } catch (error) {
        clearTimeout(connectionTimeout);
        this.isConnecting = false;
        reject(error);
      }
    });
  }

  /**
   * Disconnect from IBKR WebSocket
   */
  disconnect(): void {
    console.log('[IbkrWS] Disconnecting...');
    this.stopHeartbeat();
    this.stopSessionRefresh();

    if (this.ws) {
      // Unsubscribe from all before closing
      for (const [conid, sub] of this.subscriptions) {
        this.sendUnsubscribe(conid, sub.fields);
      }

      this.ws.close();
      this.ws = null;
    }

    this.isConnected = false;
    this.subscriptions.clear();
    // Note: Don't clear marketDataCache - preserve last known prices for display
    // Only clear subscription state since we'll need to resubscribe after reconnect
    this.subscriptionErrorMessage = null;
    // Keep lastDataReceived so frontend can show data age
    console.log('[IbkrWS] Disconnected (cache preserved for display)');
  }

  /**
   * Subscribe to market data for a conid
   */
  subscribe(conid: number, options: { symbol?: string; type?: 'stock' | 'option'; fields?: string[] } = {}): void {
    const type = options.type || 'stock';
    const fields = options.fields || (type === 'option' ? DEFAULT_OPTION_FIELDS : DEFAULT_STOCK_FIELDS);
    const symbol = options.symbol || `conid:${conid}`;

    console.log(`[IbkrWS] subscribe() called for ${symbol} (${conid}), connected=${this.isConnected}, authenticated=${this.isAuthenticated}`);

    // Store subscription
    this.subscriptions.set(conid, {
      conid,
      fields,
      symbol: options.symbol,
      type,
    });

    // Send subscription if connected AND authenticated
    if (this.isConnected && this.isAuthenticated && this.ws) {
      console.log(`[IbkrWS] Sending subscription for ${symbol} immediately`);
      this.sendSubscribe(conid, fields);
    } else {
      console.log(`[IbkrWS] Subscription for ${symbol} queued (will send on connect/auth)`);
    }
  }

  /**
   * Unsubscribe from market data for a conid
   */
  unsubscribe(conid: number): void {
    const sub = this.subscriptions.get(conid);
    if (sub) {
      this.sendUnsubscribe(conid, sub.fields);
      this.subscriptions.delete(conid);
    }
  }

  /**
   * Register a callback for market data updates
   */
  onUpdate(callback: MarketDataCallback): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  /**
   * Check if connected
   */
  get connected(): boolean {
    return this.isConnected;
  }

  /**
   * Check if we have fresh data (received within maxAgeMs)
   * CRITICAL: Use this to determine if cached data should be trusted
   */
  isDataFresh(maxAgeMs: number = 60000): boolean {
    if (!this.lastDataReceived) return false;
    const age = Date.now() - this.lastDataReceived.getTime();
    return age < maxAgeMs;
  }

  /**
   * Get the age of cached data in milliseconds
   */
  getDataAge(): number | null {
    if (!this.lastDataReceived) return null;
    return Date.now() - this.lastDataReceived.getTime();
  }

  /**
   * Check if there are subscription errors preventing data flow
   */
  hasSubscriptionError(): boolean {
    return this.subscriptionErrorMessage !== null;
  }

  /**
   * Get current subscription error message (e.g., "Missing iserver bridge")
   */
  getSubscriptionError(): string | null {
    return this.subscriptionErrorMessage;
  }

  /**
   * Clear subscription error (e.g., after successful data received)
   */
  private clearSubscriptionError(): void {
    if (this.subscriptionErrorMessage) {
      console.log('[IbkrWS] Clearing subscription error - data flowing again');
      this.subscriptionErrorMessage = null;
    }
  }

  /**
   * Get active subscriptions
   */
  getSubscriptions(): Map<number, Subscription> {
    return new Map(this.subscriptions);
  }

  // --- Private methods ---

  private sendSubscribe(conid: number, fields: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    // IBKR format: smd+{conid}+{"fields":["31","84","86"]}
    const message = `smd+${conid}+${JSON.stringify({ fields })}`;
    console.log(`[IbkrWS] Subscribing: ${message}`);
    this.ws.send(message);
  }

  private sendUnsubscribe(conid: number, fields: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    // IBKR format: umd+{conid}+{"fields":["31","84","86"]}
    const message = `umd+${conid}+${JSON.stringify({ fields })}`;
    console.log(`[IbkrWS] Unsubscribing: ${message}`);
    this.ws.send(message);
  }

  private handleMessage(data: string): void {
    try {
      // Check for heartbeat response
      if (data === 'tic') {
        return; // Heartbeat acknowledged
      }

      // Try to parse as JSON
      const msg = JSON.parse(data);

      // Log ALL messages for debugging
      const topic = msg.topic || 'no-topic';
      if (!topic.includes('hb')) {
        console.log(`[IbkrWS] MSG topic=${topic} keys=${Object.keys(msg).join(',')}`);
      }

      // Handle different message types
      // IBKR market data topics start with "smd+" (e.g., "smd+756733")
      if (msg.topic?.startsWith('smd')) {
        // Check for subscription errors first
        if (msg.error) {
          const errorMsg = typeof msg.error === 'string' ? msg.error : JSON.stringify(msg.error);
          console.error(`[IbkrWS] Subscription error for ${msg.topic}: code=${msg.code} error=${errorMsg}`);
          // Track the subscription error - this means data is NOT flowing
          this.subscriptionErrorMessage = errorMsg;

          // CRITICAL: If we get "not authenticated" error, force reconnect with fresh credentials
          if (errorMsg.toLowerCase().includes('not authenticated') || errorMsg.toLowerCase().includes('authentication')) {
            console.error('[IbkrWS] Authentication failed! Forcing reconnect with fresh credentials...');
            this.forceReconnectWithFreshCredentials();
          }
        } else {
          // Market data update - clear any previous error since data is flowing
          this.clearSubscriptionError();
          this.processMarketData(msg);
        }
      } else if (msg.topic === 'tic') {
        this.processMarketData(msg);
      } else if (msg.error) {
        console.error('[IbkrWS] Error from IBKR:', msg.error);
      } else if (!msg.topic?.includes('hb') && msg.topic !== 'system') {
        console.log('[IbkrWS] Other message:', JSON.stringify(msg).slice(0, 300));
      }
    } catch (err) {
      // Non-JSON message (like 'tic' heartbeat)
      if (data !== 'tic') {
        console.log('[IbkrWS] Non-JSON message:', data.slice(0, 100));
      }
    }
  }

  private processMarketData(msg: any): void {
    // IBKR returns data like: { conid: 756733, "31": "600.50", "84": "600.49", ... }
    const conid = msg.conid || msg.conidEx;
    if (!conid) return;

    // Log EVERY market data update for SPY/VIX (conid 756733 and 13455763)
    const updateCount = (this.updateCounts.get(conid) || 0) + 1;
    this.updateCounts.set(conid, updateCount);
    const price = msg[IBKR_FIELDS.LAST_PRICE];
    // Log COMPLETE raw message for SPY to see ALL fields IBKR sends (debugging overnight streaming)
    if (conid === 756733) {
      // Log entire raw message to see what fields IBKR actually returns
      console.log(`[IbkrWS] RAW SPY #${updateCount}: ${JSON.stringify(msg)}`);
    } else if (conid === 13455763 || updateCount % 10 === 1) {
      console.log(`[IbkrWS] DATA conid=${conid} #${updateCount} last=$${price} bid=${msg[IBKR_FIELDS.BID]} ask=${msg[IBKR_FIELDS.ASK]}`);
    }

    const sub = this.subscriptions.get(conid);

    const update: MarketDataUpdate = {
      conid,
      symbol: sub?.symbol,
      timestamp: new Date(),
    };

    // Parse field values
    // IBKR may prefix values with "C" (close), "H" (halt), etc. during extended hours
    // Strip non-numeric prefixes before parsing
    const parsePrice = (val: string | undefined): number | undefined => {
      if (!val) return undefined;
      // Strip any leading non-numeric characters except minus sign and decimal
      const cleaned = val.replace(/^[^0-9.-]+/, '');
      const num = parseFloat(cleaned);
      return isNaN(num) ? undefined : num;
    };

    // Check if regular last price is a "Close" price (prefixed with "C")
    const lastPriceRaw = msg[IBKR_FIELDS.LAST_PRICE];
    const isClosingPrice = lastPriceRaw && typeof lastPriceRaw === 'string' && lastPriceRaw.startsWith('C');

    // Sanity check for reasonable prices (IBKR sometimes sends garbage in extended hours fields)
    // SPY should be $100-2000, VIX should be $5-100, general stocks $0.01-10000
    const isReasonablePrice = (price: number | undefined, conid: number): boolean => {
      if (!price || price <= 0) return false;
      if (conid === 756733) return price >= 100 && price <= 2000; // SPY
      if (conid === 13455763) return price >= 5 && price <= 100;  // VIX
      return price > 0 && price < 10000;
    };

    // During extended hours, prioritize live extended hours prices over closing price
    // Try: overnight > after-hours > pre-market > regular last
    let extendedLast: number | undefined;
    if (msg[IBKR_FIELDS.OVERNIGHT_LAST]) {
      const parsed = parsePrice(msg[IBKR_FIELDS.OVERNIGHT_LAST]);
      if (isReasonablePrice(parsed, conid)) {
        extendedLast = parsed;
        if (conid === 756733) {
          console.log(`[IbkrWS] Extended hours: OVERNIGHT_LAST=${extendedLast}`);
        }
      } else if (conid === 756733 && parsed) {
        console.log(`[IbkrWS] Rejecting garbage OVERNIGHT_LAST=${parsed} for SPY`);
      }
    }
    if (!extendedLast && msg[IBKR_FIELDS.AFTER_HOURS_LAST]) {
      const parsed = parsePrice(msg[IBKR_FIELDS.AFTER_HOURS_LAST]);
      if (isReasonablePrice(parsed, conid)) {
        extendedLast = parsed;
        if (conid === 756733) {
          console.log(`[IbkrWS] Extended hours: AFTER_HOURS_LAST=${extendedLast}`);
        }
      } else if (conid === 756733 && parsed) {
        console.log(`[IbkrWS] Rejecting garbage AFTER_HOURS_LAST=${parsed} for SPY`);
      }
    }
    if (!extendedLast && msg[IBKR_FIELDS.PRE_MARKET_LAST]) {
      const parsed = parsePrice(msg[IBKR_FIELDS.PRE_MARKET_LAST]);
      if (isReasonablePrice(parsed, conid)) {
        extendedLast = parsed;
        if (conid === 756733) {
          console.log(`[IbkrWS] Extended hours: PRE_MARKET_LAST=${extendedLast}`);
        }
      } else if (conid === 756733 && parsed) {
        console.log(`[IbkrWS] Rejecting garbage PRE_MARKET_LAST=${parsed} for SPY`);
      }
    }

    // Use extended hours price if available and regular price is just closing price
    if (extendedLast && isClosingPrice) {
      update.last = extendedLast;
      if (conid === 756733) {
        console.log(`[IbkrWS] Using extended hours price: $${extendedLast} (regular was closing: ${lastPriceRaw})`);
      }
    } else if (lastPriceRaw) {
      update.last = parsePrice(lastPriceRaw);
    }

    if (msg[IBKR_FIELDS.BID]) update.bid = parsePrice(msg[IBKR_FIELDS.BID]);
    if (msg[IBKR_FIELDS.ASK]) update.ask = parsePrice(msg[IBKR_FIELDS.ASK]);

    // Stock-specific fields (day range, open, previous close)
    // Note: For options, these same field codes mean delta/gamma/IV/openInterest
    const dayHigh = parsePrice(msg[IBKR_FIELDS.DAY_HIGH]);
    const dayLow = parsePrice(msg[IBKR_FIELDS.DAY_LOW]);
    const openPrice = parsePrice(msg[IBKR_FIELDS.OPEN_PRICE]);
    const previousClose = parsePrice(msg[IBKR_FIELDS.PREVIOUS_CLOSE]);

    // Option-specific fields (for options subscriptions)
    if (msg[IBKR_FIELDS.DELTA]) update.delta = parseFloat(msg[IBKR_FIELDS.DELTA]);
    if (msg[IBKR_FIELDS.GAMMA]) update.gamma = parseFloat(msg[IBKR_FIELDS.GAMMA]);
    if (msg[IBKR_FIELDS.THETA]) update.theta = parseFloat(msg[IBKR_FIELDS.THETA]);
    if (msg[IBKR_FIELDS.VEGA]) update.vega = parseFloat(msg[IBKR_FIELDS.VEGA]);
    if (msg[IBKR_FIELDS.IV]) update.iv = parseFloat(msg[IBKR_FIELDS.IV]);
    if (msg[IBKR_FIELDS.OPEN_INTEREST]) update.openInterest = parseInt(msg[IBKR_FIELDS.OPEN_INTEREST], 10);

    // Update market data cache (for snapshot-free lookups)
    const cached: CachedMarketData = this.marketDataCache.get(conid) || {
      conid,
      symbol: sub?.symbol,
      last: 0,
      bid: 0,
      ask: 0,
      dayHigh: undefined,
      dayLow: undefined,
      openPrice: undefined,
      previousClose: undefined,
      timestamp: new Date(),
    };
    if (update.last != null) cached.last = update.last;
    if (update.bid != null) cached.bid = update.bid;
    if (update.ask != null) cached.ask = update.ask;
    // Store stock-specific fields (day high/low, open, previous close)
    if (dayHigh != null) cached.dayHigh = dayHigh;
    if (dayLow != null) cached.dayLow = dayLow;
    if (openPrice != null) cached.openPrice = openPrice;
    if (previousClose != null) cached.previousClose = previousClose;
    cached.timestamp = update.timestamp;
    this.marketDataCache.set(conid, cached);

    // Persist to database for restart recovery (debounced - max once per 5 seconds per symbol)
    this.persistPrice(conid, cached);

    // Track when we received actual data (critical for staleness detection)
    this.lastDataReceived = new Date();

    // Update connection state machine if this is SPY data
    if (conid === SPY_CONID && cached.last > 0) {
      getConnectionStateManager().setDataReceived(cached.last);
    }

    // Notify all callbacks
    for (const callback of this.callbacks) {
      try {
        callback(update);
      } catch (err) {
        console.error('[IbkrWS] Callback error:', err);
      }
    }
  }

  /**
   * Get cached market data for a conid (no snapshot request needed)
   * Returns null if no cached data available
   */
  getCachedMarketData(conid: number): CachedMarketData | null {
    return this.marketDataCache.get(conid) || null;
  }

  /**
   * Get all cached market data
   */
  getAllCachedMarketData(): Map<number, CachedMarketData> {
    return this.marketDataCache;
  }

  /**
   * Seed the cache with data from database (for startup recovery)
   * Called before WebSocket connects to restore last known prices
   */
  seedCache(conid: number, data: { last: number; bid: number; ask: number; symbol?: string }): void {
    this.marketDataCache.set(conid, {
      conid,
      symbol: data.symbol,
      last: data.last,
      bid: data.bid,
      ask: data.ask,
      timestamp: new Date()
    });
    console.log(`[IbkrWS] Seeded cache for ${data.symbol || conid}: $${data.last}`);
  }

  /**
   * Persist price to database for restart recovery
   * Debounced: max once per 5 seconds per symbol to avoid excessive writes
   */
  private async persistPrice(conid: number, data: CachedMarketData): Promise<void> {
    const now = Date.now();
    const last = this.lastPersist.get(conid) || 0;
    if (now - last < 5000) return; // Debounce: max once per 5 seconds

    this.lastPersist.set(conid, now);

    // Only persist if we have a valid price and db is available
    if (!data.last || data.last <= 0) return;
    if (!db) return;

    try {
      const symbol = data.symbol || `conid:${conid}`;
      await db.insert(latestPrices)
        .values({
          symbol,
          conid,
          price: String(data.last),
          bid: data.bid ? String(data.bid) : null,
          ask: data.ask ? String(data.ask) : null,
          source: 'websocket',
          updatedAt: new Date()
        })
        .onConflictDoUpdate({
          target: latestPrices.symbol,
          set: {
            price: String(data.last),
            bid: data.bid ? String(data.bid) : null,
            ask: data.ask ? String(data.ask) : null,
            source: 'websocket',
            updatedAt: new Date()
          }
        });
    } catch (err) {
      // Log but don't throw - persistence failure shouldn't break streaming
      console.error('[IbkrWS] Failed to persist price:', err);
    }
  }

  /**
   * Get WebSocket connection status for diagnostics
   */
  getStatus(): { connected: boolean; authenticated: boolean; subscriptions: number } {
    return {
      connected: this.isConnected,
      authenticated: this.isAuthenticated,
      subscriptions: this.subscriptions.size
    };
  }

  /**
   * Get detailed WebSocket status for debugging
   */
  getDetailedStatus(): {
    connected: boolean;
    authenticated: boolean;
    hasSessionToken: boolean;
    subscriptions: number;
    lastDataReceived: string | null;
    subscriptionError: string | null;
  } {
    return {
      connected: this.isConnected,
      authenticated: this.isAuthenticated,
      hasSessionToken: !!this.sessionToken,
      subscriptions: this.subscriptions.size,
      lastDataReceived: this.lastDataReceived?.toISOString() || null,
      subscriptionError: this.subscriptionErrorMessage,
    };
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();

    // Send 'tic' every 25 seconds to keep connection alive
    // IBKR typically requires activity every 30 seconds
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send('tic');
        // Record heartbeat in connection state machine
        getConnectionStateManager().recordHeartbeat();
      }
    }, 25000);
  }

  /**
   * Start auto-healing health check
   * Detects when data stops flowing and auto-reconnects
   */
  private startHealthCheck(): void {
    this.stopHealthCheck();

    this.healthCheckInterval = setInterval(async () => {
      // Only check if we think we're connected
      if (!this.isConnected || !this.isAuthenticated) return;

      // Check if SPY data is fresh (SPY is our canary)
      const spyData = this.marketDataCache.get(SPY_CONID);
      const vixData = this.marketDataCache.get(VIX_CONID);

      const now = Date.now();
      const spyAge = spyData ? now - spyData.timestamp.getTime() : Infinity;
      const vixAge = vixData ? now - vixData.timestamp.getTime() : Infinity;

      // Log health status - VIX may not have last price, use bid/ask mid
      const spyPrice = spyData?.last || 0;
      const vixPrice = vixData?.last || (vixData?.bid && vixData?.ask ? (vixData.bid + vixData.ask) / 2 : 0);
      console.log(`[IbkrWS] HEALTH CHECK: SPY=$${spyPrice.toFixed(2)} (${Math.round(spyAge/1000)}s old), VIX=${vixPrice.toFixed(2)} (${Math.round(vixAge/1000)}s old)`);

      // CRITICAL: Only reconnect if SPY data is truly stale
      // VIX might not have 'last' price - that's OK if we have bid/ask
      const isSpyStale = spyAge > this.STALE_THRESHOLD_MS;
      const vixHasAnyData = vixData && (vixData.last > 0 || (vixData.bid > 0 && vixData.ask > 0));
      const isVixStale = !vixHasAnyData && vixAge > this.STALE_THRESHOLD_MS;

      if (isSpyStale) {
        console.error(`[IbkrWS] ⚠️ SPY DATA STALE (${Math.round(spyAge/1000)}s old)! Auto-reconnecting...`);

        try {
          await this.forceFullReconnect();
        } catch (err: any) {
          console.error('[IbkrWS] Auto-reconnect failed:', err.message);
        }
      } else if (isVixStale) {
        console.warn(`[IbkrWS] VIX data stale but SPY OK - not reconnecting`);
      }
    }, this.HEALTH_CHECK_INTERVAL_MS);

    console.log('[IbkrWS] Health check started (checking every 30s for stale data)');
  }

  private stopHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private resubscribeAll(): void {
    const count = this.subscriptions.size;
    console.log(`[IbkrWS] resubscribeAll() called with ${count} subscriptions`);
    for (const [conid, sub] of this.subscriptions) {
      console.log(`[IbkrWS] Resubscribing to ${sub.symbol || conid}`);
      this.sendSubscribe(conid, sub.fields);
    }
  }

  private scheduleReconnect(): void {
    // Reset reconnect attempts after 5 minutes of trying (don't give up forever)
    const now = Date.now();
    if (this.lastReconnectReset && now - this.lastReconnectReset > 5 * 60 * 1000) {
      console.log('[IbkrWS] Resetting reconnect attempts after 5 minutes');
      this.reconnectAttempts = 0;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[IbkrWS] Max reconnect attempts reached, will retry after 60s cooldown');
      // Don't give up forever - schedule one more attempt after a longer cooldown
      setTimeout(() => {
        this.reconnectAttempts = 0;
        this.lastReconnectReset = Date.now();
        this.scheduleReconnect();
      }, 60000);
      return;
    }

    if (this.reconnectAttempts === 0) {
      this.lastReconnectReset = now;
    }

    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 30000);

    console.log(`[IbkrWS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    setTimeout(async () => {
      // Refresh credentials before reconnecting
      if (this.credentialRefreshCallback) {
        try {
          console.log('[IbkrWS] Refreshing credentials before reconnection...');
          const { cookieString, sessionToken } = await this.credentialRefreshCallback();
          this.cookieString = cookieString;
          this.sessionToken = sessionToken;
          console.log(`[IbkrWS] Credentials refreshed. Cookie length: ${cookieString?.length || 0}, Has session: ${!!sessionToken}`);
        } catch (err) {
          console.error('[IbkrWS] Failed to refresh credentials, will retry later:', err);
          // Don't try to connect with stale credentials - schedule another attempt
          this.scheduleReconnect();
          return;
        }
      }

      this.connect().catch((err) => {
        console.error('[IbkrWS] Reconnection failed:', err.message);
      });
    }, delay);
  }

  /**
   * PUBLIC: Force complete WebSocket reconnection
   * Call this when data is stale but connection shows "connected"
   * Destroys everything and starts fresh
   */
  async forceFullReconnect(): Promise<void> {
    console.log('[IbkrWS] ========== FORCE FULL RECONNECT ==========');
    console.log('[IbkrWS] Destroying stale WebSocket and clearing all cached data...');

    // 1. Stop all intervals
    this.stopHeartbeat();
    this.stopSessionRefresh();

    // 2. Destroy the WebSocket completely
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.terminate();
      this.ws = null;
    }

    // 3. Reset ALL state
    this.isConnected = false;
    this.isConnecting = false;
    this.isAuthenticated = false;

    // 4. CLEAR THE STALE CACHE - this is critical!
    console.log(`[IbkrWS] Clearing stale cache (had ${this.marketDataCache.size} entries)`);
    this.marketDataCache.clear();
    this.lastDataReceived = null;
    this.subscriptionErrorMessage = null;
    this.updateCounts.clear();
    this.lastPersist.clear();

    // 5. Reset reconnect counters
    this.reconnectAttempts = 0;
    this.reconnectDelay = 1000;

    // 6. Get FRESH credentials
    if (this.credentialRefreshCallback) {
      try {
        console.log('[IbkrWS] Getting FRESH credentials from /tickle...');
        const { cookieString, sessionToken } = await this.credentialRefreshCallback();
        this.cookieString = cookieString;
        this.sessionToken = sessionToken;
        console.log(`[IbkrWS] Fresh credentials obtained. Session token: ${sessionToken ? sessionToken.substring(0, 8) + '...' : 'NONE'}`);
      } catch (err: any) {
        console.error('[IbkrWS] FAILED to get fresh credentials:', err.message);
        throw new Error(`Cannot reconnect: ${err.message}`);
      }
    } else {
      console.error('[IbkrWS] NO credential refresh callback - cannot get fresh session!');
      throw new Error('No credential refresh callback configured');
    }

    // 7. Connect with fresh credentials
    console.log('[IbkrWS] Connecting with fresh credentials...');
    await this.connect();
    console.log('[IbkrWS] ========== RECONNECT COMPLETE ==========');
  }

  /**
   * Force immediate reconnection with fresh credentials
   * Called when authentication fails while connection is still open (session expired)
   */
  private async forceReconnectWithFreshCredentials(): Promise<void> {
    console.log('[IbkrWS] Force reconnecting with fresh credentials...');

    // Stop heartbeat/session refresh and close current connection
    this.stopHeartbeat();
    this.stopSessionRefresh();
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.terminate();
      this.ws = null;
    }

    // Reset connection state
    this.isConnected = false;
    this.isConnecting = false;
    this.isAuthenticated = false;

    // KEEP THIS CACHE CLEAR: Unlike disconnect(), forceReconnect is called when
    // we receive auth errors DURING an active session, indicating data corruption.
    // We want to clear potentially bad data and get fresh prices after reconnect.
    this.marketDataCache.clear();
    this.lastDataReceived = null;

    // Reset reconnect attempts to give fresh credentials a fair chance
    this.reconnectAttempts = 0;
    this.reconnectDelay = 1000;

    // Get fresh credentials
    if (this.credentialRefreshCallback) {
      try {
        console.log('[IbkrWS] Fetching fresh credentials...');
        const { cookieString, sessionToken } = await this.credentialRefreshCallback();
        this.cookieString = cookieString;
        this.sessionToken = sessionToken;
        console.log(`[IbkrWS] Fresh credentials obtained. Cookie length: ${cookieString?.length || 0}, Has session: ${!!sessionToken}`);
      } catch (err: any) {
        console.error('[IbkrWS] Failed to get fresh credentials:', err.message);
        // Schedule normal reconnect which will try again
        this.scheduleReconnect();
        return;
      }
    } else {
      console.warn('[IbkrWS] No credential refresh callback set - reconnecting with stale credentials');
    }

    // Reconnect immediately with fresh credentials
    try {
      await this.connect();
      console.log('[IbkrWS] Force reconnection successful!');
    } catch (err: any) {
      console.error('[IbkrWS] Force reconnection failed:', err.message);
      // Fall back to scheduled reconnect
      this.scheduleReconnect();
    }
  }
}

// Singleton instance (will be initialized with cookies from IbkrClient)
// Singleton instance - exported for debugging
export let wsManagerInstance: IbkrWebSocketManager | null = null;

/**
 * Get or create the WebSocket manager instance
 */
export function getIbkrWebSocketManager(cookieString?: string, sessionToken?: string | null): IbkrWebSocketManager | null {
  if (!wsManagerInstance && cookieString) {
    wsManagerInstance = new IbkrWebSocketManager(cookieString, sessionToken);
  }
  return wsManagerInstance;
}

/**
 * Initialize the WebSocket manager with cookies and session token
 * Session token is required for proper IBKR WebSocket authentication
 */
export function initIbkrWebSocket(cookieString: string, sessionToken?: string | null): IbkrWebSocketManager {
  if (wsManagerInstance) {
    wsManagerInstance.updateCookies(cookieString, sessionToken);
  } else {
    wsManagerInstance = new IbkrWebSocketManager(cookieString, sessionToken);
  }
  return wsManagerInstance;
}

/**
 * Destroy the WebSocket manager
 */
export function destroyIbkrWebSocket(): void {
  if (wsManagerInstance) {
    wsManagerInstance.disconnect();
    wsManagerInstance = null;
  }
}

/**
 * Get WebSocket connection status for diagnostics
 */
export function getIbkrWebSocketStatus(): { connected: boolean; authenticated: boolean; subscriptions: number } | null {
  if (!wsManagerInstance) {
    return null;
  }
  return wsManagerInstance.getStatus();
}

// Standard conids for diagnostic checks
export const SPY_CONID = 756733;
export const VIX_CONID = 13455763;

/**
 * Get detailed WebSocket status including real data flow verification
 * Only returns hasRealData=true when actual SPY data has been received recently (within 2 min)
 * This prevents false positives when only options data is streaming or cache is DB-seeded
 */
export function getIbkrWebSocketDetailedStatus(): {
  connected: boolean;
  authenticated: boolean;
  subscriptions: number;
  hasRealData: boolean;
  spyPrice: number | null;
  vixPrice: number | null;
  dataAge: number | null;
  spyDataAge: number | null;
  subscriptionError: string | null;
} | null {
  if (!wsManagerInstance) return null;

  const spyData = wsManagerInstance.getCachedMarketData(SPY_CONID);
  const vixData = wsManagerInstance.getCachedMarketData(VIX_CONID);
  const status = wsManagerInstance.getDetailedStatus();

  // SPY price from last
  const spyPrice = spyData?.last && spyData.last > 0 ? spyData.last : null;
  // VIX price: try last first, then mid of bid/ask (VIX often doesn't have last price)
  let vixPrice: number | null = null;
  if (vixData?.last && vixData.last > 0) {
    vixPrice = vixData.last;
  } else if (vixData?.bid && vixData?.ask && vixData.bid > 0 && vixData.ask > 0) {
    vixPrice = (vixData.bid + vixData.ask) / 2;
  }

  // Calculate SPY-specific data age (different from general lastDataReceived which includes options)
  const spyDataAge = spyData?.timestamp
    ? Date.now() - spyData.timestamp.getTime()
    : null;

  // hasRealData = true ONLY if:
  // 1. We have a non-zero SPY price
  // 2. SPY data was received recently (within 30 minutes)
  // Using 30 min to handle sparse pre-market ticks and overnight gaps
  // This prevents false positives when:
  // - Only options data is streaming (lastDataReceived is set but SPY isn't)
  // - Cache is seeded from DB but no actual WebSocket data flowing
  const hasRealSpyData = spyPrice !== null && spyDataAge !== null && spyDataAge < 1800000; // 30 min

  return {
    connected: status.connected,
    authenticated: status.authenticated,
    subscriptions: status.subscriptions,
    hasRealData: hasRealSpyData,
    spyPrice,
    vixPrice,
    dataAge: status.lastDataReceived ? Date.now() - new Date(status.lastDataReceived).getTime() : null,
    spyDataAge,
    subscriptionError: status.subscriptionError || null,
  };
}
