import { useEffect, useRef, useState, useCallback } from 'react';

type WebSocketMessage = {
  type: string;
  data?: any;
  message?: string;
};

// Callback type for chart price updates
type ChartPriceCallback = (price: number, symbol: string, timestamp: number) => void;

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

// Global callback registries (shared across hook instances)
const chartPriceCallbacks = new Set<ChartPriceCallback>();
const optionChainCallbacks = new Set<OptionChainCallback>();

export function useWebSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('Connected to WebSocket');
        setIsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          setLastMessage(message);

          // Handle chart_price_update messages
          if (message.type === 'chart_price_update' && message.data) {
            const { symbol, price, timestamp } = message.data;
            if (price > 0) {
              chartPriceCallbacks.forEach(callback => {
                try {
                  callback(price, symbol, timestamp);
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
          if (message.type === 'underlying_price_update') {
            const { symbol, price, timestamp } = message;
            if (price > 0) {
              chartPriceCallbacks.forEach(callback => {
                try {
                  callback(price, symbol, new Date(timestamp).getTime());
                } catch (err) {
                  console.error('[WebSocket] Underlying price callback error:', err);
                }
              });
            }
          }
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };

      ws.onclose = () => {
        console.log('Disconnected from WebSocket');
        setIsConnected(false);
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setIsConnected(false);
      };

    } catch (error) {
      console.error('Failed to create WebSocket connection:', error);
    }

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
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

  return {
    isConnected,
    lastMessage,
    sendMessage,
    onChartPriceUpdate,
    onOptionChainUpdate,
  };
}
