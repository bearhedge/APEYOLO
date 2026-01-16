import { useEffect, useState, useCallback } from 'react';

export interface ApeAgentLog {
  id: string;
  sessionId: string;
  timestamp: string;
  type: 'WAKE' | 'DATA' | 'THINK' | 'TOOL' | 'OBSERVE' | 'ESCALATE' | 'DECIDE' | 'ACTION' | 'SLEEP' | 'ERROR';
  message: string;
}

export interface ApeAgentStatus {
  isRunning: boolean;
  nextRun: string | null;
  timezone: string;
}

export function useApeAgentLogs(limit = 20) {
  const [logs, setLogs] = useState<ApeAgentLog[]>([]);
  const [status, setStatus] = useState<ApeAgentStatus>({
    isRunning: false,
    nextRun: null,
    timezone: 'America/New_York'
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch initial logs and status
  const fetchData = useCallback(async () => {
    try {
      const [logsRes, statusRes] = await Promise.all([
        fetch(`/api/ape-agent/logs?limit=${limit}`),
        fetch('/api/ape-agent/status')
      ]);

      if (logsRes.ok) {
        const logsData = await logsRes.json();
        if (Array.isArray(logsData)) {
          setLogs(logsData);
        }
      }

      if (statusRes.ok) {
        const statusData = await statusRes.json();
        setStatus(statusData);
      }

      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [limit]);

  // Initial fetch
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // SSE for live updates
  useEffect(() => {
    const eventSource = new EventSource('/api/ape-agent/logs/stream');

    eventSource.onmessage = (event) => {
      try {
        const newLog = JSON.parse(event.data);
        // Ignore connection messages
        if (newLog.type === 'connected') return;

        // Add new log to the front, keep only `limit` entries
        setLogs(prev => [newLog, ...prev].slice(0, limit));
      } catch (e) {
        // Ignore parse errors (heartbeats, etc.)
      }
    };

    eventSource.onerror = () => {
      // SSE will auto-reconnect
    };

    return () => eventSource.close();
  }, [limit]);

  // Manual wake-up trigger
  const triggerWakeUp = useCallback(async () => {
    try {
      const res = await fetch('/api/ape-agent/wake', { method: 'POST' });
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  return {
    logs,
    status,
    isLoading,
    error,
    refetch: fetchData,
    triggerWakeUp
  };
}

// Map APE Agent log types to activity log event types
export function mapApeTypeToActivityType(type: string): string {
  const map: Record<string, string> = {
    'WAKE': 'state_change',
    'DATA': 'tool_done',
    'THINK': 'thought',
    'TOOL': 'tool_start',
    'OBSERVE': 'thought',
    'ESCALATE': 'state_change',
    'DECIDE': 'thought',
    'ACTION': 'tool_done',
    'SLEEP': 'state_change',
    'ERROR': 'tool_error',
  };
  return map[type] || 'info';
}
