/**
 * useMarketSnapshot - Get market data from IBKR streamer cache
 *
 * Reads from the OptionChainStreamer cache - no API calls to IBKR.
 * The cache is populated by WebSocket streaming.
 */

import { useState, useEffect, useCallback } from 'react';

export interface MarketSnapshot {
  spyPrice: number;
  spyChange: number;
  spyChangePct: number;
  vix: number;
  vixChange: number;
  vixChangePct: number;
  marketState: 'PRE' | 'REGULAR' | 'POST' | 'CLOSED';
  source: 'ibkr' | 'yahoo' | 'none';
  timestamp: string;
}

export function useMarketSnapshot() {
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSnapshot = useCallback(async (isInitial = false) => {
    try {
      // Only show loading on initial fetch, not on subsequent polls
      if (isInitial) {
        setLoading(true);
      }
      setError(null);

      const response = await fetch('/api/broker/stream/snapshot', {
        credentials: 'include',
      });

      if (!response.ok) {
        console.log('[useMarketSnapshot] Snapshot endpoint not available:', response.status);
        setLoading(false);
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
          marketState: data.marketState || 'CLOSED',
          source: data.source || 'none',
          timestamp: data.snapshot.timestamp || new Date().toISOString(),
        });
      } else {
        console.log('[useMarketSnapshot] Snapshot not available:', data.message);
      }
    } catch (err: any) {
      console.error('[useMarketSnapshot] Error:', err);
      setError(err.message || 'Failed to fetch market snapshot');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Fetch immediately on mount (with loading indicator)
    fetchSnapshot(true);
  }, [fetchSnapshot]);

  // Dynamic polling based on market state
  useEffect(() => {
    // No polling if no snapshot yet or market is closed
    if (!snapshot) return;

    // Determine poll interval based on market state
    let pollInterval: number;
    switch (snapshot.marketState) {
      case 'REGULAR':
        pollInterval = 2000; // 2 seconds during market hours
        break;
      case 'PRE':
      case 'POST':
        pollInterval = 15000; // 15 seconds during extended hours
        break;
      case 'CLOSED':
      default:
        return; // No polling when market is closed
    }

    const intervalId = setInterval(() => {
      fetchSnapshot(false); // Silent polling, no loading flicker
    }, pollInterval);

    return () => clearInterval(intervalId);
  }, [snapshot?.marketState, fetchSnapshot]);

  return {
    snapshot,
    loading,
    error,
    refetch: fetchSnapshot,
  };
}
