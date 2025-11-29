/**
 * useBrokerStatus - Unified hook for broker connection status
 * Single source of truth used across Engine, Settings, and Header components
 */

import { useQuery } from '@tanstack/react-query';

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
    // Adaptive polling: 10s when connecting/unstable, 30s when stable
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 10000; // 10s when no data yet
      return data.connected ? 30000 : 10000; // 30s stable, 10s when disconnected
    },
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
