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

// Market data field codes from IBKR API
export const IBKR_FIELDS = {
  LAST_PRICE: '31',
  BID: '84',
  ASK: '86',
  DELTA: '7308',
  GAMMA: '7309',
  THETA: '7310',
  VEGA: '7633',
  IV: '7283',
  OPEN_INTEREST: '7311',
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

// Default fields for stock streaming (includes extended hours)
const DEFAULT_STOCK_FIELDS = [
  IBKR_FIELDS.LAST_PRICE,
  IBKR_FIELDS.BID,
  IBKR_FIELDS.ASK,
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
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000; // Start with 1 second
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

  constructor(cookieString: string, sessionToken?: string | null) {
    this.cookieString = cookieString;
    this.sessionToken = sessionToken || null;
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
   * Update session token
   */
  updateSessionToken(sessionToken: string | null): void {
    this.sessionToken = sessionToken;
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

          // Start heartbeat to keep connection alive (every 10 seconds per IBKR docs)
          this.startHeartbeat();

          // Send session token to authenticate
          if (this.sessionToken) {
            const sessionMsg = JSON.stringify({ session: this.sessionToken });
            console.log(`[IbkrWS] Sending session authentication: {"session":"${this.sessionToken.substring(0, 8)}..."}`);
            this.ws!.send(sessionMsg);
          } else {
            console.warn('[IbkrWS] No session token available - WebSocket may not authenticate properly');
            // Still resolve since connection is open, but auth may fail
            clearTimeout(connectionTimeout);
            this.resubscribeAll();
            resolve();
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

            // Check for sts (status) message - this indicates we can subscribe
            if (msg.topic === 'sts') {
              console.log(`[IbkrWS] Received sts message: ${JSON.stringify(msg)}`);
              this.isAuthenticated = true;
              clearTimeout(connectionTimeout);
              // Now that we've received sts, subscribe to market data
              console.log('[IbkrWS] sts received - subscribing to market data');
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
              clearTimeout(connectionTimeout);
              // Now that we're authenticated, resubscribe
              this.resubscribeAll();
              resolve();
              return;
            }

            // Handle session confirmation (some IBKR versions)
            if (msg.session) {
              console.log('[IbkrWS] Session confirmed');
              this.isAuthenticated = true;
              clearTimeout(connectionTimeout);
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
            clearTimeout(connectionTimeout);
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
    // CRITICAL: Clear cache and reset state to prevent stale data from being served
    this.marketDataCache.clear();
    this.lastDataReceived = null;
    this.subscriptionErrorMessage = null;
    console.log('[IbkrWS] Cleared market data cache on disconnect');
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
    if (msg[IBKR_FIELDS.DELTA]) update.delta = parseFloat(msg[IBKR_FIELDS.DELTA]);
    if (msg[IBKR_FIELDS.GAMMA]) update.gamma = parseFloat(msg[IBKR_FIELDS.GAMMA]);
    if (msg[IBKR_FIELDS.THETA]) update.theta = parseFloat(msg[IBKR_FIELDS.THETA]);
    if (msg[IBKR_FIELDS.VEGA]) update.vega = parseFloat(msg[IBKR_FIELDS.VEGA]);
    if (msg[IBKR_FIELDS.IV]) update.iv = parseFloat(msg[IBKR_FIELDS.IV]);
    if (msg[IBKR_FIELDS.OPEN_INTEREST]) update.openInterest = parseInt(msg[IBKR_FIELDS.OPEN_INTEREST], 10);

    // Update market data cache (for snapshot-free lookups)
    const cached = this.marketDataCache.get(conid) || {
      conid,
      symbol: sub?.symbol,
      last: 0,
      bid: 0,
      ask: 0,
      timestamp: new Date(),
    };
    if (update.last != null) cached.last = update.last;
    if (update.bid != null) cached.bid = update.bid;
    if (update.ask != null) cached.ask = update.ask;
    cached.timestamp = update.timestamp;
    this.marketDataCache.set(conid, cached);

    // Track when we received actual data (critical for staleness detection)
    this.lastDataReceived = new Date();

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
      }
    }, 25000);
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
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[IbkrWS] Max reconnect attempts reached');
      return;
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
          console.error('[IbkrWS] Failed to refresh credentials:', err);
        }
      }

      this.connect().catch((err) => {
        console.error('[IbkrWS] Reconnection failed:', err.message);
      });
    }, delay);
  }

  /**
   * Force immediate reconnection with fresh credentials
   * Called when authentication fails while connection is still open (session expired)
   */
  private async forceReconnectWithFreshCredentials(): Promise<void> {
    console.log('[IbkrWS] Force reconnecting with fresh credentials...');

    // Stop heartbeat and close current connection
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.terminate();
      this.ws = null;
    }

    // Reset connection state
    this.isConnected = false;
    this.isConnecting = false;
    this.isAuthenticated = false;

    // Clear stale cache since we have auth issues
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
