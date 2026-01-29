/**
 * useBrokerStatus - Simplified broker connection status
 * Single source of truth: connected = SPY data flowing (received in last 10 seconds)
 *
 * Uses WebSocket push-based updates - no HTTP polling required.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useWebSocket, ConnectionStatusUpdate, getLatestConnectionStatus } from './use-websocket';
import { useMutation } from '@tanstack/react-query';

// Simple connection status interface
export interface SimpleConnectionStatus {
  connected: boolean;
  spyPrice: number | null;
  lastUpdate: number | null;
  account: string | null;
  mode: 'LIVE' | 'PAPER' | null;
}

// Legacy interfaces for backward compatibility
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
  /** Callback when connection status changes */
  onStatusChange?: (connected: boolean) => void;
}

/**
 * PRIMARY HOOK: Simplified broker status based on SPY data flow
 * Connected = SPY data received within the last 10 seconds
 * No HTTP polling - uses WebSocket push updates
 */
export function useBrokerStatus(options: UseBrokerStatusOptions = {}) {
  const { onStatusChange } = options;
  const { onConnectionStatusUpdate } = useWebSocket();
  const [status, setStatus] = useState<ConnectionStatusUpdate | null>(getLatestConnectionStatus);
  const prevConnected = useRef<boolean | null>(null);

  useEffect(() => {
    const unsubscribe = onConnectionStatusUpdate((update) => {
      setStatus(update);
    });
    return unsubscribe;
  }, [onConnectionStatusUpdate]);

  // Get simple status from the update (new format) or derive from legacy
  const simple = (status as any)?.simple as SimpleConnectionStatus | undefined;
  const connected = simple?.connected ?? (status?.dataFlow?.status === 'streaming');
  const spyPrice = simple?.spyPrice ?? status?.dataFlow?.spyPrice ?? null;
  const account = simple?.account ?? null;
  const mode = simple?.mode ?? null;
  const lastUpdate = simple?.lastUpdate ?? (status?.dataFlow?.lastTick ? new Date(status.dataFlow.lastTick).getTime() : null);

  // Notify on connection changes
  useEffect(() => {
    if (prevConnected.current !== null && prevConnected.current !== connected && onStatusChange) {
      onStatusChange(connected);
    }
    prevConnected.current = connected;
  }, [connected, onStatusChange]);

  return {
    // Simple status (primary)
    connected,
    spyPrice,
    lastUpdate,
    account,
    mode,

    // Connection state
    isConnecting: false, // No longer tracking intermediate states
    isLoading: status === null,
    isError: status?.phase === 'error',
    error: status?.error ?? null,

    // Legacy compatibility
    provider: 'ibkr' as const,
    environment: (mode === 'LIVE' ? 'live' : 'paper') as 'paper' | 'live',
    lastChecked: status?.lastUpdated ?? null,
    diagnostics: undefined, // No longer tracking detailed diagnostics

    // Actions
    refetch: () => {}, // No-op since we use WebSocket push
  };
}

/**
 * Hook for reconnecting to IBKR
 */
export function useReconnectMutation() {
  return useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/settings/force-reconnect', { method: 'POST', credentials: 'include' });
      return response.json();
    },
  });
}

/**
 * Legacy compatibility: Check if all 4 IBKR authentication phases passed
 * @deprecated Use useBrokerStatus().connected instead
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
 * Legacy compatibility: Get connection phase status for display
 * @deprecated Use useBrokerStatus().connected instead - shows connected or disconnected
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
 * Legacy hook: WebSocket push-based connection status
 * @deprecated Use useBrokerStatus() instead
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

  // Get simple status from the update (new format)
  const simple = (status as any)?.simple as SimpleConnectionStatus | undefined;
  const connected = simple?.connected ?? (status?.dataFlow?.status === 'streaming');

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

    // Simple status (new)
    simple,

    // Connection phase
    phase: status?.phase ?? 'disconnected',
    isAuthComplete,
    isStreaming,
    isStale,
    hasError,

    // Backward compatible fields - now use simple.connected
    connected,
    diagnostics,

    // Data flow info
    dataFlow: status?.dataFlow ?? null,
    spyPrice: simple?.spyPrice ?? status?.dataFlow?.spyPrice ?? null,
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
