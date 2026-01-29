/**
 * DebugLogPanel - Real-time IBKR WebSocket debug log display
 *
 * Subscribes to debug_log events from the backend WebSocket and displays
 * them in a terminal-style panel with color-coded log levels.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Trash2, Pause, Play } from 'lucide-react';

export interface DebugLogEntry {
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  timestamp: string;
}

const MAX_LOG_ENTRIES = 500;

const LEVEL_COLORS: Record<DebugLogEntry['level'], string> = {
  info: '#888',
  warn: '#f59e0b',
  error: '#ef4444',
  success: '#4ade80',
};

const LEVEL_PREFIXES: Record<DebugLogEntry['level'], string> = {
  info: '',
  warn: 'WARN ',
  error: 'ERROR ',
  success: '',
};

function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

interface DebugLogPanelProps {
  /** Custom height (default: 300px) */
  height?: number;
  /** Title to display (default: "IBKR Debug Log") */
  title?: string;
}

export function DebugLogPanel({ height = 300, title = 'IBKR DEBUG LOG' }: DebugLogPanelProps) {
  const [logs, setLogs] = useState<DebugLogEntry[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pendingLogsRef = useRef<DebugLogEntry[]>([]);
  const isUserScrollingRef = useRef(false);

  // Auto-scroll to bottom when new logs arrive (if not paused/scrolling)
  useEffect(() => {
    if (!isPaused && !isUserScrollingRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, isPaused]);

  // Detect user scroll (pause auto-scroll when scrolled up)
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;

    isUserScrollingRef.current = !isAtBottom;
    if (isAtBottom && isPaused) {
      setIsPaused(false);
    }
  }, [isPaused]);

  // Connect to WebSocket and subscribe to debug logs
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    const connect = () => {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        // Subscribe to debug logs
        ws.send(JSON.stringify({ action: 'subscribe_debug_log' }));

        // Add connection log
        setLogs(prev => [...prev.slice(-(MAX_LOG_ENTRIES - 1)), {
          level: 'success',
          message: 'Connected to debug log stream',
          timestamp: new Date().toISOString()
        }]);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === 'debug_log' || data.topic === 'debug_log') {
            const entry: DebugLogEntry = {
              level: data.level || data.data?.level || 'info',
              message: data.message || data.data?.message || '',
              timestamp: data.timestamp || data.data?.timestamp || new Date().toISOString()
            };

            if (isPaused) {
              // Queue logs when paused
              pendingLogsRef.current.push(entry);
            } else {
              setLogs(prev => [...prev.slice(-(MAX_LOG_ENTRIES - 1)), entry]);
            }
          }
        } catch {
          // Ignore non-JSON messages
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        setLogs(prev => [...prev.slice(-(MAX_LOG_ENTRIES - 1)), {
          level: 'warn',
          message: 'Debug log stream disconnected',
          timestamp: new Date().toISOString()
        }]);

        // Reconnect after 3 seconds
        setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    return () => {
      if (wsRef.current) {
        wsRef.current.send(JSON.stringify({ action: 'unsubscribe_debug_log' }));
        wsRef.current.close();
      }
    };
  }, [isPaused]);

  // Resume and flush pending logs
  const handleResume = useCallback(() => {
    setIsPaused(false);
    if (pendingLogsRef.current.length > 0) {
      setLogs(prev => {
        const combined = [...prev, ...pendingLogsRef.current];
        pendingLogsRef.current = [];
        return combined.slice(-MAX_LOG_ENTRIES);
      });
    }
    // Scroll to bottom
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  const handleClear = useCallback(() => {
    setLogs([]);
    pendingLogsRef.current = [];
  }, []);

  const handlePause = useCallback(() => {
    setIsPaused(true);
  }, []);

  return (
    <div style={{
      background: '#0a0a0a',
      border: '1px solid #222',
      borderRadius: 4,
      fontFamily: "'IBM Plex Mono', 'Consolas', monospace",
      fontSize: 11,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 12px',
        borderBottom: '1px solid #222',
        background: '#111',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: isConnected ? '#4ade80' : '#ef4444'
          }} />
          <span style={{ color: '#87ceeb', fontSize: 11 }}>&gt; {title}</span>
          {isPaused && (
            <span style={{
              color: '#f59e0b',
              fontSize: 10,
              padding: '2px 6px',
              background: '#f59e0b20',
              borderRadius: 3
            }}>
              PAUSED ({pendingLogsRef.current.length} queued)
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {isPaused ? (
            <button
              onClick={handleResume}
              style={{
                background: 'transparent',
                border: '1px solid #333',
                color: '#4ade80',
                padding: '4px 8px',
                borderRadius: 3,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 10,
              }}
              title="Resume auto-scroll"
            >
              <Play size={12} />
              Resume
            </button>
          ) : (
            <button
              onClick={handlePause}
              style={{
                background: 'transparent',
                border: '1px solid #333',
                color: '#888',
                padding: '4px 8px',
                borderRadius: 3,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 10,
              }}
              title="Pause auto-scroll"
            >
              <Pause size={12} />
              Pause
            </button>
          )}
          <button
            onClick={handleClear}
            style={{
              background: 'transparent',
              border: '1px solid #333',
              color: '#888',
              padding: '4px 8px',
              borderRadius: 3,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 10,
            }}
            title="Clear logs"
          >
            <Trash2 size={12} />
            Clear
          </button>
        </div>
      </div>

      {/* Log content */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        style={{
          height,
          overflowY: 'auto',
          padding: 8,
        }}
      >
        {logs.length === 0 ? (
          <div style={{ color: '#444', fontStyle: 'italic' }}>
            Waiting for debug events...
          </div>
        ) : (
          logs.map((log, index) => (
            <div
              key={index}
              style={{
                color: LEVEL_COLORS[log.level],
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              <span style={{ color: '#555' }}>[{formatTimestamp(log.timestamp)}]</span>{' '}
              <span>{LEVEL_PREFIXES[log.level]}{log.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default DebugLogPanel;
