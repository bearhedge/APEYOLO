/**
 * EngineWindow - Trading engine control panel
 *
 * Simplified version for window context - start/stop, status, quick actions.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Play, Square, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react';

interface EngineStatus {
  isRunning: boolean;
  lastRun?: string;
  currentStep?: string;
  error?: string;
}

interface BrokerStatus {
  connected: boolean;
  accountId?: string;
  nav?: number;
}

export function EngineWindow() {
  const queryClient = useQueryClient();
  const [actionLog, setActionLog] = useState<string[]>([]);

  const { data: broker } = useQuery<BrokerStatus>({
    queryKey: ['broker-status'],
    queryFn: async () => {
      const res = await fetch('/api/broker/diag', { credentials: 'include' });
      if (!res.ok) return { connected: false };
      const data = await res.json();
      return {
        connected: data.connected || data.status === 'connected',
        accountId: data.accountId,
        nav: data.nav,
      };
    },
    refetchInterval: 10000,
  });

  const { data: account } = useQuery({
    queryKey: ['account'],
    queryFn: async () => {
      const res = await fetch('/api/account', { credentials: 'include' });
      if (!res.ok) return null;
      return res.json();
    },
    refetchInterval: 10000,
  });

  const addLog = (msg: string) => {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    setActionLog(prev => [`[${time}] ${msg}`, ...prev.slice(0, 9)]);
  };

  const scanMutation = useMutation({
    mutationFn: async () => {
      addLog('Starting market scan...');
      const res = await fetch('/api/engine/scan', {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Scan failed');
      return res.json();
    },
    onSuccess: data => {
      addLog(`Scan complete: ${data.opportunities || 0} opportunities found`);
    },
    onError: () => {
      addLog('ERROR: Scan failed');
    },
  });

  const isConnected = broker?.connected;
  const nav = account?.nav || broker?.nav;

  return (
    <div style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
      {/* Status Header */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          {isConnected ? (
            <>
              <CheckCircle style={{ width: 14, height: 14, color: '#4ade80' }} />
              <span style={{ color: '#4ade80' }}>BROKER CONNECTED</span>
            </>
          ) : (
            <>
              <AlertTriangle style={{ width: 14, height: 14, color: '#ef4444' }} />
              <span style={{ color: '#ef4444' }}>BROKER DISCONNECTED</span>
            </>
          )}
        </div>

        {nav && (
          <div style={{ fontSize: 12, color: '#888' }}>
            NAV: <span style={{ color: '#fff' }}>${nav.toLocaleString()}</span>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <ActionButton
          icon={<Play style={{ width: 12, height: 12 }} />}
          label="Scan Market"
          onClick={() => scanMutation.mutate()}
          disabled={!isConnected || scanMutation.isPending}
          loading={scanMutation.isPending}
        />
        <ActionButton
          icon={<Square style={{ width: 12, height: 12 }} />}
          label="Close All"
          onClick={() => addLog('Close all not implemented yet')}
          disabled={!isConnected}
          variant="danger"
        />
      </div>

      {/* Quick Links */}
      <div style={{ marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid #333' }}>
        <p style={{ fontSize: 11, color: '#666', marginBottom: 8 }}>&gt; QUICK ACTIONS</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <QuickLink href="/trade" label="Full Engine" />
          <QuickLink href="/admin?tab=jobs" label="Automation" />
        </div>
      </div>

      {/* Action Log */}
      <div>
        <p style={{ fontSize: 11, color: '#666', marginBottom: 8 }}>&gt; LOG</p>
        <div
          style={{
            background: '#0a0a0a',
            border: '1px solid #222',
            padding: 8,
            maxHeight: 120,
            overflow: 'auto',
            fontSize: 11,
          }}
        >
          {actionLog.length === 0 ? (
            <span style={{ color: '#444' }}>No recent actions</span>
          ) : (
            actionLog.map((log, i) => (
              <div key={i} style={{ color: log.includes('ERROR') ? '#ef4444' : '#888' }}>
                {log}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
  disabled,
  loading,
  variant = 'primary',
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'danger';
}) {
  const colors = {
    primary: { bg: 'rgba(59, 130, 246, 0.2)', border: 'rgba(59, 130, 246, 0.5)', color: '#3b82f6' },
    danger: { bg: 'rgba(239, 68, 68, 0.2)', border: 'rgba(239, 68, 68, 0.5)', color: '#ef4444' },
  };
  const c = colors[variant];

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: 1,
        padding: '8px 12px',
        background: c.bg,
        border: `1px solid ${c.border}`,
        color: c.color,
        fontSize: 11,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        fontFamily: 'inherit',
      }}
    >
      {loading ? <Loader2 style={{ width: 12, height: 12, animation: 'spin 1s linear infinite' }} /> : icon}
      {label}
    </button>
  );
}

function QuickLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      style={{
        padding: '4px 8px',
        background: '#111',
        border: '1px solid #333',
        color: '#888',
        fontSize: 11,
        textDecoration: 'none',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = '#555';
        e.currentTarget.style.color = '#fff';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = '#333';
        e.currentTarget.style.color = '#888';
      }}
    >
      {label}
    </a>
  );
}
