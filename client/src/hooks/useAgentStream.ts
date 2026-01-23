/**
 * useAgentStream - Hook for SSE streaming from CodeAct agent
 *
 * Connects to /api/agent/stream and receives real-time log events.
 */

import { useState, useEffect, useRef, useCallback } from 'react';

// Log types matching server/agent/logger.ts
export const LOG_TYPES = {
  BANANA_TIME:   { label: 'BANANA TIME',   color: '#4ade80' },   // green
  APE_BRAIN:     { label: 'APE BRAIN',     color: '#22d3ee' },   // cyan
  GRABBING_DATA: { label: 'GRABBING DATA', color: '#facc15' },   // yellow
  FOUND_BANANA:  { label: 'FOUND BANANA',  color: '#f5f5f5' },   // white
  SWING_TIME:    { label: 'SWING TIME',    color: '#e879f9' },   // magenta
  NO_SWING:      { label: 'NO SWING',      color: '#9ca3af' },   // gray
  BAD_BANANA:    { label: 'BAD BANANA',    color: '#f87171' },   // red
  DANGER_BRANCH: { label: 'DANGER BRANCH', color: '#fb923c' },   // orange
  BACK_TO_TREE:  { label: 'BACK TO TREE',  color: '#4ade80' },   // green
} as const;

export type LogType = keyof typeof LOG_TYPES;

export interface LogLine {
  id: string;
  timestamp: string;
  logType: LogType;
  text: string;
}

interface LogEvent {
  type: 'start' | 'append' | 'connected';
  logType?: LogType;
  text?: string;
  timestamp?: string;
  sessionId?: string;
}

export function useAgentStream() {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const lineIdRef = useRef(0);

  // Connect to SSE stream
  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    setError(null);
    const eventSource = new EventSource('/api/agent/stream');
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setIsConnected(true);
      setError(null);
    };

    eventSource.onmessage = (e) => {
      try {
        const event: LogEvent = JSON.parse(e.data);

        if (event.type === 'connected') {
          // Initial connection event
          setIsConnected(true);
          return;
        }

        if (event.type === 'start' && event.logType && event.timestamp) {
          // New log block
          setLines(prev => [...prev, {
            id: `line-${lineIdRef.current++}`,
            timestamp: event.timestamp!,
            logType: event.logType!,
            text: event.text || '',
          }]);
        } else if (event.type === 'append' && event.text) {
          // Append to last line
          setLines(prev => {
            if (prev.length === 0) return prev;
            const updated = [...prev];
            updated[updated.length - 1] = {
              ...updated[updated.length - 1],
              text: updated[updated.length - 1].text + event.text,
            };
            return updated;
          });
        }
      } catch (err) {
        console.error('[AgentStream] Failed to parse event:', err);
      }
    };

    eventSource.onerror = () => {
      setIsConnected(false);
      setError('Connection lost. Reconnecting...');
      // EventSource will auto-reconnect
    };

    return () => {
      eventSource.close();
    };
  }, []);

  // Disconnect from SSE stream
  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setIsConnected(false);
  }, []);

  // Clear log lines
  const clearLines = useCallback(() => {
    setLines([]);
  }, []);

  // Auto-connect on mount
  useEffect(() => {
    const cleanup = connect();
    return () => {
      cleanup?.();
      disconnect();
    };
  }, [connect, disconnect]);

  return {
    lines,
    isConnected,
    error,
    connect,
    disconnect,
    clearLines,
  };
}
