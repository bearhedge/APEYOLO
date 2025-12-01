import { useEffect, useRef, useState, useCallback } from 'react';

type WebSocketMessage = {
  type: string;
  data?: any;
  message?: string;
};

// Callback type for chart price updates
type ChartPriceCallback = (price: number, symbol: string, timestamp: number) => void;

// Global callback registry (shared across hook instances)
const chartPriceCallbacks = new Set<ChartPriceCallback>();

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

  return {
    isConnected,
    lastMessage,
    sendMessage,
    onChartPriceUpdate,
  };
}
