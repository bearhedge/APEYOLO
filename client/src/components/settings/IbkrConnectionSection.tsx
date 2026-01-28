/**
 * Simplified IBKR Connection Section
 *
 * Single source of truth: Connected = SPY data flowing (received in last 10 seconds)
 * No OAuth status checks. No SSO checks. No 5-indicator reconciliation.
 */

import { useState, useEffect, useRef } from 'react';
import { RefreshCw, CheckCircle, XCircle, ChevronDown, Building2 } from 'lucide-react';
import { useBrokerStatus, useReconnectMutation } from '@/hooks/useBrokerStatus';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useWebSocket } from '@/hooks/use-websocket';

interface ConnectionLog {
  timestamp: Date;
  message: string;
  type: 'info' | 'success' | 'error';
}

export function IbkrConnectionSection() {
  const status = useBrokerStatus();
  const reconnectMutation = useReconnectMutation();
  const { isConnected: wsConnected } = useWebSocket();

  // Debug logs
  const [logs, setLogs] = useState<ConnectionLog[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const logsRef = useRef<HTMLDivElement>(null);

  // Auto-reconnect state (once after 15s)
  const [hasTriedAutoReconnect, setHasTriedAutoReconnect] = useState(false);

  // Add log entry
  const addLog = (message: string, type: 'info' | 'success' | 'error' = 'info') => {
    setLogs((prev) => [...prev.slice(-49), { timestamp: new Date(), message, type }]);
  };

  // Log status changes
  useEffect(() => {
    if (status.connected) {
      addLog(`Connected - SPY: $${status.spyPrice?.toFixed(2) || '—'}`, 'success');
    } else if (status.lastUpdate) {
      const age = Math.round((Date.now() - status.lastUpdate) / 1000);
      addLog(`Disconnected - last data ${age}s ago`, 'error');
    }
  }, [status.connected]);

  // Auto-scroll logs
  useEffect(() => {
    if (showLogs && logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight;
    }
  }, [logs, showLogs]);

  // Auto-reconnect once after 15 seconds of being disconnected
  useEffect(() => {
    if (!status.connected && !hasTriedAutoReconnect && wsConnected) {
      const timer = setTimeout(() => {
        addLog('Auto-reconnecting...', 'info');
        reconnectMutation.mutate();
        setHasTriedAutoReconnect(true);
      }, 15000); // 15 seconds before auto-reconnect attempt
      return () => clearTimeout(timer);
    }
    if (status.connected) {
      setHasTriedAutoReconnect(false);
    }
  }, [status.connected, hasTriedAutoReconnect, wsConnected]);

  // Format last update time
  const formatLastUpdate = () => {
    if (!status.lastUpdate) return '—';
    const age = Math.round((Date.now() - status.lastUpdate) / 1000);
    if (age < 60) return `${age}s ago`;
    if (age < 3600) return `${Math.floor(age / 60)}m ago`;
    return `${Math.floor(age / 3600)}h ago`;
  };

  return (
    <div className="bg-charcoal rounded-2xl border border-white/10 shadow-lg overflow-hidden">
      {/* Card Header */}
      <div className="flex items-center justify-between p-6 border-b border-white/10">
        <div className="flex items-center gap-3">
          <Building2 className="w-6 h-6" />
          <h3 className="text-xl font-semibold">IBKR Connection</h3>
        </div>
        <div className="flex items-center gap-2">
          <div
            className={cn(
              'w-3 h-3 rounded-full',
              status.connected ? 'bg-green-500' : 'bg-red-500'
            )}
          />
          <span
            className={cn(
              'text-sm font-medium',
              status.connected ? 'text-green-500' : 'text-red-500'
            )}
          >
            {status.connected ? 'CONNECTED' : 'DISCONNECTED'}
          </span>
        </div>
      </div>

      {/* Main Content */}
      <div className="p-6 space-y-4">
        {/* Status Grid */}
        <div className="grid grid-cols-4 gap-3">
          <div className="p-3 bg-dark-gray rounded-lg">
            <p className="text-xs text-silver mb-1">Account</p>
            <p className="text-sm font-mono font-medium">{status.account || '—'}</p>
          </div>
          <div className="p-3 bg-dark-gray rounded-lg">
            <p className="text-xs text-silver mb-1">Mode</p>
            <p
              className={cn(
                'text-sm font-medium',
                status.mode === 'LIVE' ? 'text-orange-400' : 'text-blue-400'
              )}
            >
              {status.mode || '—'}
            </p>
          </div>
          <div className="p-3 bg-dark-gray rounded-lg">
            <p className="text-xs text-silver mb-1">SPY Price</p>
            <p className="text-sm font-medium tabular-nums">
              {status.spyPrice ? `$${status.spyPrice.toFixed(2)}` : '—'}
            </p>
          </div>
          <div className="p-3 bg-dark-gray rounded-lg">
            <p className="text-xs text-silver mb-1">Last Update</p>
            <p className="text-sm text-silver">{formatLastUpdate()}</p>
          </div>
        </div>

        {/* Reconnect button (only when disconnected) */}
        {!status.connected && (
          <Button
            onClick={() => {
              addLog('Manual reconnect triggered', 'info');
              reconnectMutation.mutate();
            }}
            disabled={reconnectMutation.isPending}
            className="w-full"
          >
            {reconnectMutation.isPending ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                Connecting...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4 mr-2" />
                Reconnect
              </>
            )}
          </Button>
        )}

        {/* Debug Log (collapsed) */}
        <div className="border-t border-white/10 pt-4">
          <button
            onClick={() => setShowLogs(!showLogs)}
            className="flex items-center gap-2 text-xs text-silver hover:text-white transition-colors w-full"
          >
            <ChevronDown
              className={cn('w-3 h-3 transition-transform', showLogs && 'rotate-180')}
            />
            Debug Log
            <span className="bg-white/10 px-1.5 py-0.5 rounded text-xs">{logs.length}</span>
          </button>

          {showLogs && (
            <div
              ref={logsRef}
              className="mt-2 bg-black/50 rounded-lg p-3 max-h-48 overflow-y-auto font-mono text-xs"
            >
              {logs.length === 0 ? (
                <p className="text-silver">No events yet...</p>
              ) : (
                logs.map((log, i) => (
                  <div
                    key={i}
                    className={cn(
                      'leading-relaxed',
                      log.type === 'success' && 'text-green-400',
                      log.type === 'error' && 'text-red-400',
                      log.type === 'info' && 'text-silver'
                    )}
                  >
                    <span className="text-zinc-500">
                      [{log.timestamp.toLocaleTimeString('en-US', { hour12: false })}]
                    </span>{' '}
                    {log.type === 'success' && '✓ '}
                    {log.type === 'error' && '✗ '}
                    {log.message}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
