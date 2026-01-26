import { useEffect, useRef, useState, useCallback } from 'react';

type WebSocketMessage = {
  type: string;
  data?: any;
  message?: string;
};

// Full market data for chart price updates
export interface ChartPriceData {
  price: number;
  symbol: string;
  timestamp: number;
  bid: number;
  ask: number;
  previousClose: number;
  changePct: number;
}

// Callback type for chart price updates
type ChartPriceCallback = (data: ChartPriceData) => void;

// Callback type for option chain updates
export interface OptionChainUpdate {
  conid: number;
  strike: number;
  optionType: 'PUT' | 'CALL';
  bid: number;
  ask: number;
  last?: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  iv?: number;
  openInterest?: number;
}
type OptionChainCallback = (update: OptionChainUpdate, symbol: string) => void;

// Connection status from server state machine (push-based, not polling)
export interface ConnectionStatusUpdate {
  phase: 'disconnected' | 'authenticating' | 'connected' | 'streaming' | 'stale' | 'error';
  auth: {
    oauth: { success: boolean; timestamp: string | null };
    sso: { success: boolean; timestamp: string | null };
    validate: { success: boolean; timestamp: string | null };
    init: { success: boolean; timestamp: string | null };
  };
  websocket: {
    connected: boolean;
    authenticated: boolean;
    lastHeartbeat: string | null;
  };
  dataFlow: {
    receiving: boolean;
    lastTick: string | null;
    spyPrice: number | null;
    status: 'streaming' | 'stale' | 'none';
  };
  error?: {
    message: string;
    timestamp: string;
    recoverable: boolean;
  };
  lastUpdated: string;
}
type ConnectionStatusCallback = (status: ConnectionStatusUpdate) => void;

// Global callback registries (shared across hook instances)
const chartPriceCallbacks = new Set<ChartPriceCallback>();
const optionChainCallbacks = new Set<OptionChainCallback>();
const connectionStatusCallbacks = new Set<ConnectionStatusCallback>();

// Store latest connection status for immediate access
let latestConnectionStatus: ConnectionStatusUpdate | null = null;

// Reconnection settings
const INITIAL_RECONNECT_DELAY = 1000; // 1 second
const MAX_RECONNECT_DELAY = 30000; // 30 seconds
const HEARTBEAT_INTERVAL = 30000; // 30 seconds

export function useWebSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelayRef = useRef(INITIAL_RECONNECT_DELAY);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isUnmountingRef = useRef(false);

  useEffect(() => {
    isUnmountingRef.current = false;

    const connect = () => {
      // Don't reconnect if unmounting
      if (isUnmountingRef.current) return;

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/ws`;

      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          console.log('[WebSocket] Connected');
          setIsConnected(true);
          // Reset reconnect delay on successful connection
          reconnectDelayRef.current = INITIAL_RECONNECT_DELAY;

          // Start heartbeat to keep connection alive
          if (heartbeatIntervalRef.current) {
            clearInterval(heartbeatIntervalRef.current);
          }
          heartbeatIntervalRef.current = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'ping' }));
            }
          }, HEARTBEAT_INTERVAL);
        };

        ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);

            // Ignore pong responses
            if (message.type === 'pong') return;

            setLastMessage(message);

            // Handle chart_price_update messages
            if (message.type === 'chart_price_update' && message.data) {
              const { symbol, price, timestamp, bid, ask, previousClose, changePct } = message.data;
              if (price > 0) {
                const chartData: ChartPriceData = {
                  price,
                  symbol,
                  timestamp,
                  bid: bid || 0,
                  ask: ask || 0,
                  previousClose: previousClose || 0,
                  changePct: changePct || 0,
                };
                chartPriceCallbacks.forEach(callback => {
                  try {
                    callback(chartData);
                  } catch (err) {
                    console.error('[WebSocket] Chart price callback error:', err);
                  }
                });
              }
            }

            // Handle option_chain_update messages
            if (message.type === 'option_chain_update' && message.data) {
              const { symbol } = message;
              optionChainCallbacks.forEach(callback => {
                try {
                  callback(message.data as OptionChainUpdate, symbol);
                } catch (err) {
                  console.error('[WebSocket] Option chain callback error:', err);
                }
              });
            }

            // Handle underlying_price_update messages (also update chart)
            // Note: This legacy message format doesn't include bid/ask/previousClose
            if (message.type === 'underlying_price_update') {
              const { symbol, price, timestamp } = message;
              if (price > 0) {
                const chartData: ChartPriceData = {
                  price,
                  symbol,
                  timestamp: new Date(timestamp).getTime(),
                  bid: 0,
                  ask: 0,
                  previousClose: 0,
                  changePct: 0,
                };
                chartPriceCallbacks.forEach(callback => {
                  try {
                    callback(chartData);
                  } catch (err) {
                    console.error('[WebSocket] Underlying price callback error:', err);
                  }
                });
              }
            }

            // Handle connection_status messages (push-based status updates)
            if (message.type === 'connection_status' && message.data) {
              const status = message.data as ConnectionStatusUpdate;
              latestConnectionStatus = status;
              connectionStatusCallbacks.forEach(callback => {
                try {
                  callback(status);
                } catch (err) {
                  console.error('[WebSocket] Connection status callback error:', err);
                }
              });
            }
          } catch (error) {
            console.error('[WebSocket] Failed to parse message:', error);
          }
        };

        ws.onclose = (event) => {
          console.log(`[WebSocket] Disconnected (code: ${event.code}, reason: ${event.reason || 'none'})`);
          setIsConnected(false);
          wsRef.current = null;

          // Clear heartbeat
          if (heartbeatIntervalRef.current) {
            clearInterval(heartbeatIntervalRef.current);
            heartbeatIntervalRef.current = null;
          }

          // Schedule reconnect with exponential backoff
          if (!isUnmountingRef.current) {
            const delay = reconnectDelayRef.current;
            console.log(`[WebSocket] Reconnecting in ${delay / 1000}s...`);
            reconnectTimeoutRef.current = setTimeout(() => {
              // Increase delay for next reconnect (exponential backoff)
              reconnectDelayRef.current = Math.min(
                reconnectDelayRef.current * 2,
                MAX_RECONNECT_DELAY
              );
              connect();
            }, delay);
          }
        };

        ws.onerror = (error) => {
          console.error('[WebSocket] Error:', error);
          // onclose will be called after onerror, which handles reconnection
        };

      } catch (error) {
        console.error('[WebSocket] Failed to create connection:', error);
        // Schedule reconnect on failure
        if (!isUnmountingRef.current) {
          reconnectTimeoutRef.current = setTimeout(connect, reconnectDelayRef.current);
        }
      }
    };

    // Initial connection
    connect();

    return () => {
      isUnmountingRef.current = true;

      // Clear reconnect timeout
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }

      // Clear heartbeat
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }

      // Close WebSocket
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  const sendMessage = (message: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  };

  // Register a callback for chart price updates
  // Returns an unsubscribe function
  const onChartPriceUpdate = useCallback((callback: ChartPriceCallback) => {
    chartPriceCallbacks.add(callback);
    return () => {
      chartPriceCallbacks.delete(callback);
    };
  }, []);

  // Register a callback for option chain updates
  // Returns an unsubscribe function
  const onOptionChainUpdate = useCallback((callback: OptionChainCallback) => {
    optionChainCallbacks.add(callback);
    return () => {
      optionChainCallbacks.delete(callback);
    };
  }, []);

  // Register a callback for connection status updates (push-based)
  // Returns an unsubscribe function
  const onConnectionStatusUpdate = useCallback((callback: ConnectionStatusCallback) => {
    connectionStatusCallbacks.add(callback);
    // Immediately call with latest status if available
    if (latestConnectionStatus) {
      callback(latestConnectionStatus);
    }
    return () => {
      connectionStatusCallbacks.delete(callback);
    };
  }, []);

  return {
    isConnected,
    lastMessage,
    sendMessage,
    onChartPriceUpdate,
    onOptionChainUpdate,
    onConnectionStatusUpdate,
  };
}

/**
 * Get the latest connection status without subscribing to updates
 */
export function getLatestConnectionStatus(): ConnectionStatusUpdate | null {
  return latestConnectionStatus;
}
