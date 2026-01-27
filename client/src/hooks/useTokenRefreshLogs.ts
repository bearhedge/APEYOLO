/**
 * useTokenRefreshLogs - Hook for OAuth token refresh log entries
 *
 * Fetches initial logs via HTTP and subscribes to real-time WebSocket updates.
 * Used by the Token Refresh Log panel in Settings to show OAuth activity.
 */

import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';

export interface RefreshLogEntry {
  timestamp: string;
  type: 'check' | 'refresh_start' | 'refresh_success' | 'refresh_error' | 'ws_updated';
  message: string;
  oauthRemaining?: string;
  ssoRemaining?: string;
}

const MAX_LOG_ENTRIES = 50;

// Global callback registry for token refresh log updates
type TokenRefreshLogCallback = (entry: RefreshLogEntry) => void;
const tokenRefreshLogCallbacks = new Set<TokenRefreshLogCallback>();

// Track if WebSocket listener is already set up (to avoid duplicates)
let wsListenerSetup = false;

/**
 * Set up global WebSocket listener for token_refresh_log messages
 * This is called once when the first component using this hook mounts
 */
function setupWebSocketListener() {
  if (wsListenerSetup) return;
  wsListenerSetup = true;

  // We need to listen to WebSocket messages globally
  // The WebSocket is managed by use-websocket.ts but we need to intercept token_refresh_log messages
  const originalAddEventListener = WebSocket.prototype.addEventListener;

  // Patch to intercept messages - this is a bit hacky but works with the existing WebSocket setup
  // A cleaner approach would be to extend use-websocket.ts, but this keeps changes minimal

  // Actually, let's use a simpler approach - add handler when WebSocket connects
  const checkForWebSocket = () => {
    // Find the WebSocket connection (it's typically accessible via window or global refs)
    // For now, we'll create our own listener that piggybacks on the existing connection
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    // Use a dedicated WebSocket just for token refresh logs
    // This is cleaner than patching the existing one
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[TokenRefreshLogs] WebSocket connected for log updates');
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'token_refresh_log' && message.data) {
          const entry = message.data as RefreshLogEntry;
          tokenRefreshLogCallbacks.forEach(callback => {
            try {
              callback(entry);
            } catch (err) {
              console.error('[TokenRefreshLogs] Callback error:', err);
            }
          });
        }
      } catch {
        // Ignore parse errors
      }
    };

    ws.onclose = () => {
      console.log('[TokenRefreshLogs] WebSocket disconnected, reconnecting...');
      wsListenerSetup = false;
      // Reconnect after a delay
      setTimeout(setupWebSocketListener, 3000);
    };

    ws.onerror = () => {
      // onclose will handle reconnection
    };
  };

  checkForWebSocket();
}

export function useTokenRefreshLogs() {
  const [logs, setLogs] = useState<RefreshLogEntry[]>([]);

  // Initial fetch of existing logs
  const { data, isLoading, error } = useQuery({
    queryKey: ['/api/token-refresh/logs'],
    queryFn: async () => {
      const res = await fetch('/api/token-refresh/logs', { credentials: 'include' });
      if (!res.ok) {
        throw new Error('Failed to fetch token refresh logs');
      }
      return res.json() as Promise<{ logs: RefreshLogEntry[] }>;
    },
    staleTime: 30000, // Consider fresh for 30s
    refetchOnWindowFocus: false,
  });

  // Seed logs from initial fetch
  useEffect(() => {
    if (data?.logs) {
      setLogs(data.logs);
    }
  }, [data]);

  // Subscribe to real-time WebSocket updates
  useEffect(() => {
    // Ensure WebSocket listener is set up
    setupWebSocketListener();

    // Add our callback to receive new log entries
    const handleNewLog = (entry: RefreshLogEntry) => {
      setLogs(prev => {
        const next = [...prev, entry];
        // Keep only the last MAX_LOG_ENTRIES
        return next.slice(-MAX_LOG_ENTRIES);
      });
    };

    tokenRefreshLogCallbacks.add(handleNewLog);

    return () => {
      tokenRefreshLogCallbacks.delete(handleNewLog);
    };
  }, []);

  // Clear logs (local only - doesn't affect server buffer)
  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  return {
    logs,
    isLoading,
    error,
    clearLogs,
  };
}
