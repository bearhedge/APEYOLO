/**
 * useOptionChainStream - Real-time option chain streaming hook
 *
 * Consumes WebSocket updates for specific strikes and provides
 * live bid/ask/delta updates for the Step 3 strike selection table.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useWebSocket, OptionChainUpdate } from './use-websocket';

export interface StreamedStrike {
  strike: number;
  optionType: 'PUT' | 'CALL';
  bid: number;
  ask: number;
  delta: number;
  iv?: number;
  theta?: number;
  gamma?: number;
  lastUpdate: Date;
  isStale: boolean;
}

export interface UseOptionChainStreamOptions {
  /** Symbol to stream (e.g., 'SPY') */
  symbol: string;
  /** List of PUT strikes to monitor */
  putStrikes: number[];
  /** List of CALL strikes to monitor */
  callStrikes: number[];
  /** Whether streaming should be active */
  enabled: boolean;
}

export interface UseOptionChainStreamReturn {
  /** PUT strikes with live data */
  streamedPuts: Map<number, StreamedStrike>;
  /** CALL strikes with live data */
  streamedCalls: Map<number, StreamedStrike>;
  /** WebSocket connection status */
  isStreaming: boolean;
  /** Time since last update */
  lastUpdateTimestamp: Date | null;
  /** Error message if any */
  error: string | null;
}

// Stale threshold in milliseconds (10 seconds)
const STALE_THRESHOLD_MS = 10000;

export function useOptionChainStream(
  options: UseOptionChainStreamOptions
): UseOptionChainStreamReturn {
  const { symbol, putStrikes, callStrikes, enabled } = options;

  const [streamedPuts, setStreamedPuts] = useState<Map<number, StreamedStrike>>(new Map());
  const [streamedCalls, setStreamedCalls] = useState<Map<number, StreamedStrike>>(new Map());
  const [lastUpdateTimestamp, setLastUpdateTimestamp] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { isConnected, onOptionChainUpdate } = useWebSocket();

  // Track strikes to monitor as refs for stable callback
  const putStrikesRef = useRef<Set<number>>(new Set());
  const callStrikesRef = useRef<Set<number>>(new Set());

  // Update strike sets when props change
  useEffect(() => {
    putStrikesRef.current = new Set(putStrikes);
    callStrikesRef.current = new Set(callStrikes);
  }, [putStrikes, callStrikes]);

  // Handle incoming option chain updates
  const handleUpdate = useCallback((update: OptionChainUpdate, updateSymbol: string) => {
    // Only process updates for our symbol
    if (updateSymbol !== symbol) return;

    const { strike, optionType, bid, ask, delta, iv, theta, gamma } = update;

    const newStrike: StreamedStrike = {
      strike,
      optionType,
      bid,
      ask,
      delta: delta ?? 0,
      iv,
      theta,
      gamma,
      lastUpdate: new Date(),
      isStale: false,
    };

    if (optionType === 'PUT' && putStrikesRef.current.has(strike)) {
      setStreamedPuts(prev => {
        const next = new Map(prev);
        next.set(strike, newStrike);
        return next;
      });
      setLastUpdateTimestamp(new Date());
    } else if (optionType === 'CALL' && callStrikesRef.current.has(strike)) {
      setStreamedCalls(prev => {
        const next = new Map(prev);
        next.set(strike, newStrike);
        return next;
      });
      setLastUpdateTimestamp(new Date());
    }
  }, [symbol]);

  // Subscribe to WebSocket updates when enabled
  useEffect(() => {
    if (!enabled) {
      return;
    }

    const unsubscribe = onOptionChainUpdate(handleUpdate);

    return () => {
      unsubscribe();
    };
  }, [enabled, onOptionChainUpdate, handleUpdate]);

  // Mark stale entries periodically
  useEffect(() => {
    if (!enabled) return;

    const interval = setInterval(() => {
      const now = Date.now();

      setStreamedPuts(prev => {
        let changed = false;
        const next = new Map(prev);
        for (const [strike, data] of next) {
          const age = now - data.lastUpdate.getTime();
          const shouldBeStale = age > STALE_THRESHOLD_MS;
          if (data.isStale !== shouldBeStale) {
            next.set(strike, { ...data, isStale: shouldBeStale });
            changed = true;
          }
        }
        return changed ? next : prev;
      });

      setStreamedCalls(prev => {
        let changed = false;
        const next = new Map(prev);
        for (const [strike, data] of next) {
          const age = now - data.lastUpdate.getTime();
          const shouldBeStale = age > STALE_THRESHOLD_MS;
          if (data.isStale !== shouldBeStale) {
            next.set(strike, { ...data, isStale: shouldBeStale });
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 2000); // Check every 2 seconds

    return () => clearInterval(interval);
  }, [enabled]);

  // Clear state when disabled or strikes change significantly
  useEffect(() => {
    if (!enabled) {
      setStreamedPuts(new Map());
      setStreamedCalls(new Map());
      setLastUpdateTimestamp(null);
      setError(null);
    }
  }, [enabled]);

  // Track connection errors
  useEffect(() => {
    if (enabled && !isConnected) {
      setError('WebSocket disconnected - using cached data');
    } else {
      setError(null);
    }
  }, [enabled, isConnected]);

  return {
    streamedPuts,
    streamedCalls,
    isStreaming: enabled && isConnected,
    lastUpdateTimestamp,
    error,
  };
}
