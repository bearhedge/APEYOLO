/**
 * useMarketSnapshot - Real-time market data via SSE streaming
 *
 * Primary: SSE connection to /api/broker/stream/live (true streaming)
 * Fallback: HTTP polling to /api/broker/stream/snapshot (live WebSocket data only)
 *
 * NO CACHED DATA - only live real-time prices from IBKR WebSocket
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';

export type DataSourceMode = 'websocket' | 'http';

// Helper to get data source preference from localStorage
function getDataSourcePreference(): DataSourceMode {
  if (typeof window !== 'undefined') {
    return (localStorage.getItem('apeyolo-data-source') as DataSourceMode) || 'http';
  }
  return 'http';
}

export interface MarketSnapshot {
  spyPrice: number;
  spyChange: number;
  spyChangePct: number;
  spyBid: number | null;
  spyAsk: number | null;
  spyPrevClose: number | null;
  vix: number;
  vixChange: number;
  vixChangePct: number;
  vwap: number | null;
  ivRank: number | null;
  dayHigh: number;
  dayLow: number;
  marketState: 'PRE' | 'REGULAR' | 'POST' | 'OVERNIGHT' | 'CLOSED';
  source: 'ibkr' | 'ibkr-sse' | 'none';
  timestamp: string;
}

export function useMarketSnapshot() {
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'fallback' | 'error'>('connecting');

  // Get data source preference (memoized to avoid re-reads)
  const dataSourceMode = useMemo(() => getDataSourcePreference(), []);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const sseTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSpyPriceRef = useRef<number>(0);
  const lastVixPriceRef = useRef<number>(0);
  const lastSpyBidRef = useRef<number | null>(null);
  const lastSpyAskRef = useRef<number | null>(null);

  // Fallback to HTTP polling
  const fetchSnapshot = useCallback(async () => {
    try {
      const response = await fetch('/api/broker/stream/snapshot', {
        credentials: 'include',
      });

      if (!response.ok) {
        console.log('[useMarketSnapshot] Snapshot endpoint error:', response.status);
        setError(`Snapshot error: ${response.status}`);
        setLoading(false);
        return;
      }

      const data = await response.json();

      if (data.ok && data.available && data.snapshot) {
        // Calculate change % on frontend as fallback if server returns 0
        const calcChangePct = (current: number, prevClose: number | null): number => {
          if (!prevClose || prevClose <= 0 || current <= 0) return 0;
          return ((current / prevClose) - 1) * 100;
        };

        const spyPrice = data.snapshot.spyPrice || 0;
        const spyPrevClose = data.snapshot.spyPrevClose ?? null;
        const vix = data.snapshot.vix || 0;

        // Use server value if non-zero, otherwise calculate on frontend
        let spyChangePct = data.snapshot.spyChangePct || 0;
        if (spyChangePct === 0 && spyPrevClose && spyPrice > 0) {
          spyChangePct = calcChangePct(spyPrice, spyPrevClose);
        }

        setSnapshot({
          spyPrice,
          spyChange: spyPrevClose ? spyPrice - spyPrevClose : 0,
          spyChangePct,
          spyBid: data.snapshot.spyBid ?? null,
          spyAsk: data.snapshot.spyAsk ?? null,
          spyPrevClose,
          vix,
          vixChange: data.snapshot.vixChange || 0,
          vixChangePct: data.snapshot.vixChangePct || 0,
          vwap: data.snapshot.vwap ?? null,
          ivRank: data.snapshot.ivRank ?? null,
          dayHigh: data.snapshot.dayHigh || 0,
          dayLow: data.snapshot.dayLow || 0,
          marketState: data.marketState || 'CLOSED',
          source: data.source || 'none',
          timestamp: data.snapshot.timestamp || new Date().toISOString(),
        });
        lastSpyPriceRef.current = data.snapshot.spyPrice || 0;
        lastVixPriceRef.current = data.snapshot.vix || 0;
        lastSpyBidRef.current = data.snapshot.spyBid ?? null;
        lastSpyAskRef.current = data.snapshot.spyAsk ?? null;
        setError(null);
      } else if (data.ok && !data.available) {
        // Server returned ok but no data available (e.g., Yahoo error)
        console.warn('[useMarketSnapshot] No data available:', data.message);
        setError(data.message || 'No market data available');
      }
      setLoading(false);
    } catch (err: any) {
      console.error('[useMarketSnapshot] Fallback fetch error:', err);
      setError(err.message || 'Failed to fetch market data');
      setLoading(false);
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
    if (sseTimeoutRef.current) {
      clearTimeout(sseTimeoutRef.current);
    }

    console.log(`[useMarketSnapshot] Connecting to SSE stream (mode: ${dataSourceMode})...`);
    setConnectionStatus('connecting');

    // Pass data source mode as query parameter
    const eventSource = new EventSource(`/api/broker/stream/live?mode=${dataSourceMode}`, {
      withCredentials: true,
    });
    eventSourceRef.current = eventSource;

    // Set timeout - if no price data within 5 seconds, fall back to HTTP
    sseTimeoutRef.current = setTimeout(() => {
      console.warn('[useMarketSnapshot] SSE timeout - no data received, falling back to HTTP');
      eventSource.close();
      setConnectionStatus('fallback');
      fetchSnapshot();
    }, 5000);

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
          // Clear timeout since we received data
          if (sseTimeoutRef.current) {
            clearTimeout(sseTimeoutRef.current);
            sseTimeoutRef.current = null;
          }

          // Update the appropriate price and metrics
          if (data.symbol === 'SPY' && data.last) {
            lastSpyPriceRef.current = data.last;
            if (data.bid != null) lastSpyBidRef.current = data.bid;
            if (data.ask != null) lastSpyAskRef.current = data.ask;
          } else if (data.symbol === 'VIX' && data.last) {
            lastVixPriceRef.current = data.last;
          }

          // Calculate change % on frontend as fallback if server returns 0 or null
          const calcChangePct = (current: number, prevClose: number | null): number => {
            if (!prevClose || prevClose <= 0) return 0;
            return ((current / prevClose) - 1) * 100;
          };

          // Update snapshot with latest prices
          setSnapshot(prev => {
            // Get prevClose from server or previous state
            const spyPrevClose = data.symbol === 'SPY' && data.prevClose != null
              ? data.prevClose
              : prev?.spyPrevClose ?? null;

            // ALWAYS calculate SPY change % on frontend from prevClose
            // Server value is unreliable - calculate directly
            let spyChangePct = prev?.spyChangePct || 0;
            if (data.symbol === 'SPY') {
              const prevClose = spyPrevClose || data.prevClose;
              if (prevClose && lastSpyPriceRef.current > 0) {
                // Always calculate on frontend: (price / prevClose - 1) * 100
                spyChangePct = calcChangePct(lastSpyPriceRef.current, prevClose);
              }
            }

            // Calculate VIX change % similarly
            let vixChangePct = prev?.vixChangePct || 0;
            if (data.symbol === 'VIX') {
              if (data.changePct != null && data.changePct !== 0) {
                vixChangePct = data.changePct;
              }
            }

            return {
              spyPrice: lastSpyPriceRef.current,
              spyChange: spyPrevClose ? lastSpyPriceRef.current - spyPrevClose : 0,
              spyChangePct,
              spyBid: lastSpyBidRef.current,
              spyAsk: lastSpyAskRef.current,
              spyPrevClose,
              vix: lastVixPriceRef.current,
              vixChange: prev?.vixChange || 0,
              vixChangePct,
              // Use server-provided vwap (only from SPY updates)
              vwap: data.symbol === 'SPY' && data.vwap != null
                ? data.vwap
                : prev?.vwap ?? null,
              // Use server-provided ivRank (only from VIX updates)
              ivRank: data.symbol === 'VIX' && data.ivRank != null
                ? data.ivRank
                : prev?.ivRank ?? null,
              // Preserve day high/low from HTTP snapshot (SSE doesn't provide these)
              dayHigh: prev?.dayHigh || lastSpyPriceRef.current * 1.005,
              dayLow: prev?.dayLow || lastSpyPriceRef.current * 0.995,
              // Use server-provided marketState instead of hardcoding
              marketState: data.marketState || prev?.marketState || 'CLOSED',
              source: 'ibkr-sse',
              timestamp: data.timestamp || new Date().toISOString(),
            };
          });
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
  }, [fetchSnapshot, dataSourceMode]);

  // Initialize - always try SSE first (IBKR WebSocket may have live data even when "market closed")
  useEffect(() => {
    const initialize = async () => {
      // Always try SSE first - IBKR WebSocket streams live bid/ask even outside market hours
      // SSE has a 5-second timeout and will fall back to HTTP if no data received
      console.log('[useMarketSnapshot] Connecting SSE (will fallback to HTTP if no data)...');
      connectSSE();
    };

    initialize();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (sseTimeoutRef.current) {
        clearTimeout(sseTimeoutRef.current);
      }
    };
  }, [connectSSE, fetchSnapshot]);

  // Fallback polling when SSE is not available
  // Use slower polling when market is closed (no need for rapid updates)
  useEffect(() => {
    if (connectionStatus !== 'fallback') return;

    // Poll every 1 second as fallback - needs to be fast for accurate pricing
    const pollIntervalMs = 1000;
    console.log(`[useMarketSnapshot] Using fallback polling every ${pollIntervalMs / 1000}s`);
    const pollInterval = setInterval(fetchSnapshot, pollIntervalMs);

    return () => clearInterval(pollInterval);
  }, [connectionStatus, fetchSnapshot]);

  return {
    snapshot,
    loading,
    error,
    connectionStatus,
    dataSourceMode,
    refetch: fetchSnapshot,
  };
}
