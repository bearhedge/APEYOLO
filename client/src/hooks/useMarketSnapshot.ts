/**
 * useMarketSnapshot - Real-time market data via SSE streaming
 *
 * Primary: SSE connection to /api/broker/stream/live (true streaming)
 * Fallback: HTTP polling to /api/broker/stream/snapshot
 */

import { useState, useEffect, useCallback, useRef } from 'react';

export interface MarketSnapshot {
  spyPrice: number;
  spyChange: number;
  spyChangePct: number;
  vix: number;
  vixChange: number;
  vixChangePct: number;
  vwap: number | null;
  ivRank: number | null;
  marketState: 'PRE' | 'REGULAR' | 'POST' | 'CLOSED';
  source: 'ibkr' | 'ibkr-sse' | 'yahoo' | 'none';
  timestamp: string;
}

export function useMarketSnapshot() {
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'fallback' | 'error'>('connecting');

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSpyPriceRef = useRef<number>(0);
  const lastVixPriceRef = useRef<number>(0);

  // Fallback to HTTP polling
  const fetchSnapshot = useCallback(async () => {
    try {
      const response = await fetch('/api/broker/stream/snapshot', {
        credentials: 'include',
      });

      if (!response.ok) {
        console.log('[useMarketSnapshot] Snapshot endpoint error:', response.status);
        return;
      }

      const data = await response.json();

      if (data.ok && data.available && data.snapshot) {
        setSnapshot({
          spyPrice: data.snapshot.spyPrice || 0,
          spyChange: data.snapshot.spyChange || 0,
          spyChangePct: data.snapshot.spyChangePct || 0,
          vix: data.snapshot.vix || 0,
          vixChange: data.snapshot.vixChange || 0,
          vixChangePct: data.snapshot.vixChangePct || 0,
          vwap: data.snapshot.vwap ?? null,
          ivRank: data.snapshot.ivRank ?? null,
          marketState: data.marketState || 'CLOSED',
          source: data.source || 'none',
          timestamp: data.snapshot.timestamp || new Date().toISOString(),
        });
        lastSpyPriceRef.current = data.snapshot.spyPrice || 0;
        lastVixPriceRef.current = data.snapshot.vix || 0;
      }
    } catch (err: any) {
      console.error('[useMarketSnapshot] Fallback fetch error:', err);
    }
  }, []);

  // Connect to SSE stream
  const connectSSE = useCallback(() => {
    // Clean up existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }

    console.log('[useMarketSnapshot] Connecting to SSE stream...');
    setConnectionStatus('connecting');

    const eventSource = new EventSource('/api/broker/stream/live', {
      withCredentials: true,
    });
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      console.log('[useMarketSnapshot] SSE connected');
      setConnectionStatus('connected');
      setLoading(false);
      setError(null);
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'connected') {
          console.log('[useMarketSnapshot] SSE stream established');
          return;
        }

        if (data.type === 'heartbeat') {
          return; // Ignore heartbeats
        }

        if (data.type === 'error') {
          console.warn('[useMarketSnapshot] SSE error:', data.message);
          setConnectionStatus('error');
          // Fall back to polling
          eventSource.close();
          setConnectionStatus('fallback');
          fetchSnapshot();
          return;
        }

        if (data.type === 'price') {
          // Update the appropriate price and metrics
          if (data.symbol === 'SPY' && data.last) {
            lastSpyPriceRef.current = data.last;
          } else if (data.symbol === 'VIX' && data.last) {
            lastVixPriceRef.current = data.last;
          }

          // Update snapshot with latest prices and server-calculated metrics
          setSnapshot(prev => ({
            spyPrice: lastSpyPriceRef.current,
            spyChange: prev?.spyChange || 0,
            // Use server-provided changePct for SPY updates
            spyChangePct: data.symbol === 'SPY' && data.changePct != null
              ? data.changePct
              : prev?.spyChangePct || 0,
            vix: lastVixPriceRef.current,
            vixChange: prev?.vixChange || 0,
            // Use server-provided changePct for VIX updates
            vixChangePct: data.symbol === 'VIX' && data.changePct != null
              ? data.changePct
              : prev?.vixChangePct || 0,
            // Use server-provided vwap (only from SPY updates)
            vwap: data.symbol === 'SPY' && data.vwap != null
              ? data.vwap
              : prev?.vwap ?? null,
            // Use server-provided ivRank (only from VIX updates)
            ivRank: data.symbol === 'VIX' && data.ivRank != null
              ? data.ivRank
              : prev?.ivRank ?? null,
            // Use server-provided marketState instead of hardcoding
            marketState: data.marketState || prev?.marketState || 'CLOSED',
            source: 'ibkr-sse',
            timestamp: data.timestamp || new Date().toISOString(),
          }));
          setLoading(false);
        }
      } catch (err) {
        console.error('[useMarketSnapshot] SSE parse error:', err);
      }
    };

    eventSource.onerror = (err) => {
      console.warn('[useMarketSnapshot] SSE error, falling back to polling');
      setConnectionStatus('fallback');
      eventSource.close();

      // Fetch initial data via HTTP
      fetchSnapshot();

      // Try to reconnect SSE after 30 seconds
      reconnectTimeoutRef.current = setTimeout(() => {
        console.log('[useMarketSnapshot] Attempting SSE reconnect...');
        connectSSE();
      }, 30000);
    };
  }, [fetchSnapshot]);

  // Initialize SSE connection
  useEffect(() => {
    connectSSE();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [connectSSE]);

  // Fallback polling when SSE is not available
  useEffect(() => {
    if (connectionStatus !== 'fallback') return;

    console.log('[useMarketSnapshot] Using fallback polling');
    const pollInterval = setInterval(fetchSnapshot, 2000);

    return () => clearInterval(pollInterval);
  }, [connectionStatus, fetchSnapshot]);

  return {
    snapshot,
    loading,
    error,
    connectionStatus,
    refetch: fetchSnapshot,
  };
}
