/**
 * useBrokerStatus - Unified hook for broker connection status
 * Single source of truth used across Engine, Settings, and Header components
 *
 * Two modes available:
 * 1. useBrokerStatus() - HTTP-based (legacy, for initial load)
 * 2. useConnectionStatus() - WebSocket push-based (preferred, real-time)
 */

import { useQuery } from '@tanstack/react-query';
import { useState, useEffect, useCallback } from 'react';
import { useWebSocket, ConnectionStatusUpdate, getLatestConnectionStatus } from './use-websocket';

export interface BrokerDiagnostics {
  oauth: { status: number; message: string };
  sso: { status: number; message: string };
  validate: { status: number; message: string };
  init: { status: number; message: string };
}

export interface BrokerStatus {
  connected: boolean;
  provider: 'ibkr' | 'mock';
  environment: 'paper' | 'live';
  lastChecked: string;
  diagnostics?: BrokerDiagnostics;
  isConnecting?: boolean;
}

interface UseBrokerStatusOptions {
  /** Whether to enable polling */
  enabled?: boolean;
  /** Callback when connection status changes */
  onStatusChange?: (connected: boolean) => void;
}

/**
 * Fetch broker status from API
 */
async function fetchBrokerStatus(): Promise<BrokerStatus> {
  const response = await fetch('/api/ibkr/status');
  if (!response.ok) {
    throw new Error('Failed to fetch broker status');
  }
  return response.json();
}

/**
 * Hook for unified broker status across the application
 * Uses adaptive polling: faster when connecting, slower when stable
 */
export function useBrokerStatus(options: UseBrokerStatusOptions = {}) {
  const { enabled = true, onStatusChange } = options;

  const query = useQuery<BrokerStatus>({
    // Use same query key as Settings.tsx for unified cache
    queryKey: ['/api/ibkr/status'],
    queryFn: fetchBrokerStatus,
    enabled,
    // DISABLED - IBKR snapshots cost money
    refetchInterval: false,
    // Keep data fresh but allow some staleness
    staleTime: 5000, // Consider fresh for 5s
    // Don't refetch on window focus if recently fetched
    refetchOnWindowFocus: true,
    // Retry on error
    retry: 2,
    retryDelay: 1000,
  });

  // Track connection changes
  const connected = query.data?.connected ?? false;
  const isConnecting = query.isFetching && !query.data?.connected;

  return {
    // Connection state
    connected,
    isConnecting,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,

    // Status details
    status: query.data,
    provider: query.data?.provider ?? 'mock',
    environment: query.data?.environment ?? 'paper',
    diagnostics: query.data?.diagnostics,
    lastChecked: query.data?.lastChecked,

    // Actions
    refetch: query.refetch,

    // Query state for advanced use
    isFetching: query.isFetching,
    isStale: query.isStale,
  };
}

/**
 * Check if all 4 IBKR authentication phases passed
 */
export function isFullyConnected(diagnostics?: BrokerDiagnostics): boolean {
  if (!diagnostics) return false;
  return (
    diagnostics.oauth.status === 200 &&
    diagnostics.sso.status === 200 &&
    diagnostics.validate.status === 200 &&
    diagnostics.init.status === 200
  );
}

/**
 * Get connection phase status for display
 */
export function getConnectionPhase(diagnostics?: BrokerDiagnostics): {
  phase: string;
  progress: number;
  message: string;
} {
  if (!diagnostics) {
    return { phase: 'Unknown', progress: 0, message: 'No diagnostics available' };
  }

  const phases = [
    { key: 'oauth', name: 'OAuth' },
    { key: 'sso', name: 'SSO' },
    { key: 'validate', name: 'Validate' },
    { key: 'init', name: 'Initialize' },
  ] as const;

  let passedCount = 0;
  for (const phase of phases) {
    const status = diagnostics[phase.key];
    if (status.status !== 200) {
      return {
        phase: phase.name,
        progress: (passedCount / 4) * 100,
        message: status.message || `${phase.name} failed`,
      };
    }
    passedCount++;
  }

  return {
    phase: 'Connected',
    progress: 100,
    message: 'All phases completed',
  };
}

/**
 * WebSocket push-based connection status hook
 * Preferred over useBrokerStatus for real-time updates without polling
 */
export function useConnectionStatus() {
  const { onConnectionStatusUpdate } = useWebSocket();
  const [status, setStatus] = useState<ConnectionStatusUpdate | null>(getLatestConnectionStatus);

  useEffect(() => {
    const unsubscribe = onConnectionStatusUpdate((update) => {
      setStatus(update);
    });
    return unsubscribe;
  }, [onConnectionStatusUpdate]);

  // Derive connection state from status
  const isAuthComplete = status?.auth
    ? status.auth.oauth.success &&
      status.auth.sso.success &&
      status.auth.validate.success &&
      status.auth.init.success
    : false;

  const isStreaming = status?.dataFlow?.status === 'streaming';
  const isStale = status?.dataFlow?.status === 'stale';
  const hasError = status?.phase === 'error';

  // Convert to BrokerDiagnostics format for backward compatibility
  const diagnostics: BrokerDiagnostics | undefined = status?.auth
    ? {
        oauth: {
          status: status.auth.oauth.success ? 200 : 0,
          message: status.auth.oauth.success ? 'Connected' : 'Not connected',
        },
        sso: {
          status: status.auth.sso.success ? 200 : 0,
          message: status.auth.sso.success ? 'Active' : 'Not active',
        },
        validate: {
          status: status.auth.validate.success ? 200 : 0,
          message: status.auth.validate.success ? 'Validated' : 'Not validated',
        },
        init: {
          status: status.auth.init.success ? 200 : 0,
          message: status.auth.init.success ? 'Ready' : 'Not initialized',
        },
      }
    : undefined;

  return {
    // Raw status from server
    rawStatus: status,

    // Connection phase
    phase: status?.phase ?? 'disconnected',
    isAuthComplete,
    isStreaming,
    isStale,
    hasError,

    // Backward compatible fields
    connected: isAuthComplete,
    diagnostics,

    // Data flow info
    dataFlow: status?.dataFlow ?? null,
    spyPrice: status?.dataFlow?.spyPrice ?? null,
    lastTick: status?.dataFlow?.lastTick ?? null,

    // WebSocket health
    wsConnected: status?.websocket?.connected ?? false,
    wsAuthenticated: status?.websocket?.authenticated ?? false,

    // Error info
    error: status?.error ?? null,

    // Timestamps
    lastUpdated: status?.lastUpdated ?? null,
  };
}
