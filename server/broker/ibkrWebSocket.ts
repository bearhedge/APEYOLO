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

// Default fields for stock streaming
const DEFAULT_STOCK_FIELDS = [
  IBKR_FIELDS.LAST_PRICE,
  IBKR_FIELDS.BID,
  IBKR_FIELDS.ASK,
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

export class IbkrWebSocketManager {
  private ws: WebSocket | null = null;
  private wsUrl = 'wss://api.ibkr.com/v1/api/ws';
  private cookieString: string;
  private subscriptions = new Map<number, Subscription>();
  private callbacks = new Set<MarketDataCallback>();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000; // Start with 1 second
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private isConnecting = false;
  private isConnected = false;

  constructor(cookieString: string) {
    this.cookieString = cookieString;
  }

  /**
   * Update cookies (needed when IBKR session refreshes)
   */
  updateCookies(cookieString: string): void {
    this.cookieString = cookieString;
  }

  /**
   * Connect to IBKR WebSocket
   */
  async connect(): Promise<void> {
    if (this.isConnecting || this.isConnected) {
      console.log('[IbkrWS] Already connected or connecting');
      return;
    }

    this.isConnecting = true;

    return new Promise((resolve, reject) => {
      try {
        console.log('[IbkrWS] Connecting to IBKR WebSocket...');

        this.ws = new WebSocket(this.wsUrl, {
          headers: {
            'Cookie': this.cookieString,
            'User-Agent': 'apeyolo/1.0',
          },
        });

        this.ws.on('open', () => {
          console.log('[IbkrWS] Connected to IBKR WebSocket');
          this.isConnected = true;
          this.isConnecting = false;
          this.reconnectAttempts = 0;
          this.reconnectDelay = 1000;

          // Start heartbeat to keep connection alive
          this.startHeartbeat();

          // Resubscribe to all previous subscriptions
          this.resubscribeAll();

          resolve();
        });

        this.ws.on('message', (data: Buffer) => {
          this.handleMessage(data.toString());
        });

        this.ws.on('error', (error) => {
          console.error('[IbkrWS] WebSocket error:', error.message);
          this.isConnecting = false;
          if (!this.isConnected) {
            reject(error);
          }
        });

        this.ws.on('close', (code, reason) => {
          console.log(`[IbkrWS] Connection closed: ${code} - ${reason.toString()}`);
          this.isConnected = false;
          this.isConnecting = false;
          this.stopHeartbeat();

          // Attempt reconnection
          this.scheduleReconnect();
        });

      } catch (error) {
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
  }

  /**
   * Subscribe to market data for a conid
   */
  subscribe(conid: number, options: { symbol?: string; type?: 'stock' | 'option'; fields?: string[] } = {}): void {
    const type = options.type || 'stock';
    const fields = options.fields || (type === 'option' ? DEFAULT_OPTION_FIELDS : DEFAULT_STOCK_FIELDS);

    // Store subscription
    this.subscriptions.set(conid, {
      conid,
      fields,
      symbol: options.symbol,
      type,
    });

    // Send subscription if connected
    if (this.isConnected && this.ws) {
      this.sendSubscribe(conid, fields);
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

      // Handle different message types
      if (msg.topic === 'smd' || msg.topic === 'tic') {
        // Market data update
        this.processMarketData(msg);
      } else if (msg.error) {
        console.error('[IbkrWS] Error from IBKR:', msg.error);
      } else {
        console.log('[IbkrWS] Received message:', JSON.stringify(msg).slice(0, 200));
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

    const sub = this.subscriptions.get(conid);

    const update: MarketDataUpdate = {
      conid,
      symbol: sub?.symbol,
      timestamp: new Date(),
    };

    // Parse field values
    if (msg[IBKR_FIELDS.LAST_PRICE]) update.last = parseFloat(msg[IBKR_FIELDS.LAST_PRICE]);
    if (msg[IBKR_FIELDS.BID]) update.bid = parseFloat(msg[IBKR_FIELDS.BID]);
    if (msg[IBKR_FIELDS.ASK]) update.ask = parseFloat(msg[IBKR_FIELDS.ASK]);
    if (msg[IBKR_FIELDS.DELTA]) update.delta = parseFloat(msg[IBKR_FIELDS.DELTA]);
    if (msg[IBKR_FIELDS.GAMMA]) update.gamma = parseFloat(msg[IBKR_FIELDS.GAMMA]);
    if (msg[IBKR_FIELDS.THETA]) update.theta = parseFloat(msg[IBKR_FIELDS.THETA]);
    if (msg[IBKR_FIELDS.VEGA]) update.vega = parseFloat(msg[IBKR_FIELDS.VEGA]);
    if (msg[IBKR_FIELDS.IV]) update.iv = parseFloat(msg[IBKR_FIELDS.IV]);
    if (msg[IBKR_FIELDS.OPEN_INTEREST]) update.openInterest = parseInt(msg[IBKR_FIELDS.OPEN_INTEREST], 10);

    // Notify all callbacks
    for (const callback of this.callbacks) {
      try {
        callback(update);
      } catch (err) {
        console.error('[IbkrWS] Callback error:', err);
      }
    }
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
    for (const [conid, sub] of this.subscriptions) {
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

    setTimeout(() => {
      this.connect().catch((err) => {
        console.error('[IbkrWS] Reconnection failed:', err.message);
      });
    }, delay);
  }
}

// Singleton instance (will be initialized with cookies from IbkrClient)
let wsManagerInstance: IbkrWebSocketManager | null = null;

/**
 * Get or create the WebSocket manager instance
 */
export function getIbkrWebSocketManager(cookieString?: string): IbkrWebSocketManager | null {
  if (!wsManagerInstance && cookieString) {
    wsManagerInstance = new IbkrWebSocketManager(cookieString);
  }
  return wsManagerInstance;
}

/**
 * Initialize the WebSocket manager with cookies
 */
export function initIbkrWebSocket(cookieString: string): IbkrWebSocketManager {
  if (wsManagerInstance) {
    wsManagerInstance.updateCookies(cookieString);
  } else {
    wsManagerInstance = new IbkrWebSocketManager(cookieString);
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
