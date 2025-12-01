/**
 * useChartBounds Hook
 *
 * Fetches engine-selected strikes from the trading engine for chart overlay visualization.
 * Returns PUT and CALL strikes with their deltas, premiums, and the calculated "win zone"
 * between the strikes.
 */

import { useState, useEffect, useCallback, useRef } from 'react';

export interface StrikeBound {
  strike: number;
  delta: number;
  premium: number;
  bid: number;
  ask: number;
}

export interface WinZone {
  low: number;   // PUT strike (lower bound)
  high: number;  // CALL strike (upper bound)
  width: number; // Distance between strikes
}

export interface ChartBounds {
  symbol: string;
  underlyingPrice: number;
  putStrike: StrikeBound | null;
  callStrike: StrikeBound | null;
  winZone: WinZone | null;
  expectedPremium: number;
  marginRequired: number;
  reasoning: string;
  timestamp: string;
  source: string;
  expiration: string;
}

interface UseChartBoundsResult {
  bounds: ChartBounds | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  lastUpdated: Date | null;
}

/**
 * Hook to fetch and manage chart bounds from the trading engine
 *
 * @param symbol - Stock symbol (e.g., 'SPY')
 * @param autoRefresh - Whether to auto-refresh bounds periodically
 * @param refreshInterval - Refresh interval in milliseconds (default: 60000 = 1 minute)
 */
export function useChartBounds(
  symbol: string,
  autoRefresh: boolean = true,
  refreshInterval: number = 60000
): UseChartBoundsResult {
  const [bounds, setBounds] = useState<ChartBounds | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Use ref to track if component is mounted
  const mountedRef = useRef(true);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchBounds = useCallback(async () => {
    if (!symbol) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/chart/bounds/${encodeURIComponent(symbol)}`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `Failed to fetch bounds: ${response.status}`);
      }

      const data = await response.json();

      if (mountedRef.current) {
        setBounds(data);
        setLastUpdated(new Date());
        setError(null);
      }
    } catch (err: any) {
      console.error('[useChartBounds] Error:', err);
      if (mountedRef.current) {
        setError(err.message || 'Failed to fetch chart bounds');
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [symbol]);

  // Initial fetch and auto-refresh setup
  useEffect(() => {
    mountedRef.current = true;

    // Initial fetch
    fetchBounds();

    // Set up auto-refresh interval
    if (autoRefresh && refreshInterval > 0) {
      intervalRef.current = setInterval(fetchBounds, refreshInterval);
    }

    return () => {
      mountedRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [symbol, autoRefresh, refreshInterval, fetchBounds]);

  return {
    bounds,
    loading,
    error,
    refresh: fetchBounds,
    lastUpdated,
  };
}

export default useChartBounds;
