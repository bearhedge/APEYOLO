/**
 * SettingsWindow - Configuration and preferences
 *
 * IBKR connection management, Solana wallet, data source preferences,
 * and diagnostics.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

interface BrokerStatus {
  connected: boolean;
  accountId?: string;
  host?: string;
  port?: number;
  environment?: 'paper' | 'live';
}

interface BrokerDiag {
  oauth: boolean;
  sso: boolean;
  init: boolean;
  ws: boolean;
  lastError?: string;
}

interface SolanaInfo {
  walletAddress?: string;
  balance?: number;
  cluster?: string;
}

interface AppSettings {
  dataSource: 'websocket' | 'rest';
  environment: 'paper' | 'live';
}

export function SettingsWindow() {
  const queryClient = useQueryClient();
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Queries
  const { data: broker, refetch: refetchBroker } = useQuery<BrokerStatus>({
    queryKey: ['broker-status'],
    queryFn: async () => {
      const res = await fetch('/api/broker/diag', { credentials: 'include' });
      if (!res.ok) return { connected: false };
      const data = await res.json();
      return {
        connected: data.connected || data.status === 'connected',
        accountId: data.accountId,
        host: data.host,
        port: data.port,
        environment: data.environment || 'paper',
      };
    },
    refetchInterval: 10000,
  });

  const { data: diag } = useQuery<BrokerDiag>({
    queryKey: ['broker-diag-full'],
    queryFn: async () => {
      const res = await fetch('/api/broker/diag', { credentials: 'include' });
      if (!res.ok) return { oauth: false, sso: false, init: false, ws: false };
      const data = await res.json();
      return {
        oauth: data.oauth ?? false,
        sso: data.sso ?? false,
        init: data.init ?? false,
        ws: data.ws ?? data.websocket ?? false,
        lastError: data.lastError,
      };
    },
    refetchInterval: 10000,
  });

  const { data: solana } = useQuery<SolanaInfo>({
    queryKey: ['solana-info'],
    queryFn: async () => {
      const res = await fetch('/api/solana/info', { credentials: 'include' });
      if (!res.ok) return {};
      return res.json();
    },
  });

  const { data: settings } = useQuery<AppSettings>({
    queryKey: ['app-settings'],
    queryFn: async () => {
      // Try to get from localStorage or API
      const stored = localStorage.getItem('ape-settings');
      if (stored) return JSON.parse(stored);
      return { dataSource: 'websocket', environment: 'paper' };
    },
  });

  // Mutations
  const testConnectionMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/ibkr/test', {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Connection test failed');
      }
      return res.json();
    },
    onSuccess: () => {
      refetchBroker();
      queryClient.invalidateQueries({ queryKey: ['broker-diag-full'] });
    },
  });

  const reconnectMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/broker/reconnect', {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Reconnect failed');
      }
      return res.json();
    },
    onSuccess: () => {
      refetchBroker();
    },
  });

  const clearOrdersMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/ibkr/clear-orders', {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to clear orders');
      }
      return res.json();
    },
    onSuccess: () => {
      setShowClearConfirm(false);
    },
  });

  const testOrderMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/broker/paper/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          symbol: 'SPY',
          action: 'BUY',
          quantity: 1,
          orderType: 'LMT',
          limitPrice: 1.00,
          test: true,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Test order failed');
      }
      return res.json();
    },
  });

  const updateSettingsMutation = useMutation({
    mutationFn: async (newSettings: Partial<AppSettings>) => {
      const updated = { ...settings, ...newSettings };
      localStorage.setItem('ape-settings', JSON.stringify(updated));
      // Also notify server if needed
      await fetch('/api/settings/connection-mode', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(newSettings),
      }).catch(() => {}); // Ignore if endpoint doesn't exist
      return updated;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['app-settings'] });
    },
  });

  const isLoading = testConnectionMutation.isPending || reconnectMutation.isPending;

  return (
    <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>
      {/* IBKR Section */}
      <Section title="IBKR CONNECTION">
        <Row
          label="Status"
          value={broker?.connected ? 'CONNECTED' : 'DISCONNECTED'}
          valueColor={broker?.connected ? '#4ade80' : '#ef4444'}
        />
        {broker?.accountId && <Row label="Account" value={broker.accountId} />}
        <Row label="Mode" value={broker?.environment?.toUpperCase() || 'PAPER'} valueColor="#87ceeb" />

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <ActionButton
            label={testConnectionMutation.isPending ? 'Testing...' : 'Test Connection'}
            onClick={() => testConnectionMutation.mutate()}
            disabled={isLoading}
          />
          <ActionButton
            label={reconnectMutation.isPending ? 'Reconnecting...' : 'Reconnect'}
            onClick={() => reconnectMutation.mutate()}
            disabled={isLoading}
          />
        </div>

        {/* Error display */}
        {(testConnectionMutation.isError || reconnectMutation.isError) && (
          <p style={{ color: '#ef4444', fontSize: 11, marginTop: 8 }}>
            &gt; ERROR: {testConnectionMutation.error?.message || reconnectMutation.error?.message}
          </p>
        )}

        {/* Success display */}
        {testConnectionMutation.isSuccess && (
          <p style={{ color: '#4ade80', fontSize: 11, marginTop: 8 }}>
            &gt; Connection test passed
          </p>
        )}
      </Section>

      {/* Solana Section */}
      <Section title="SOLANA WALLET">
        <Row label="Network" value={solana?.cluster || 'mainnet-beta'} />
        {solana?.walletAddress ? (
          <>
            <Row
              label="Address"
              value={`${solana.walletAddress.slice(0, 6)}...${solana.walletAddress.slice(-4)}`}
            />
            <Row
              label="Balance"
              value={`${(solana.balance ?? 0).toFixed(4)} SOL`}
              valueColor="#4ade80"
            />
          </>
        ) : (
          <p style={{ color: '#666', fontSize: 11, marginTop: 4 }}>
            No wallet connected
          </p>
        )}
      </Section>

      {/* Preferences Section */}
      <Section title="PREFERENCES">
        <div style={{ marginBottom: 12 }}>
          <label style={{ color: '#888', fontSize: 10, display: 'block', marginBottom: 4 }}>Data Source</label>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['websocket', 'rest'] as const).map(source => (
              <button
                key={source}
                onClick={() => updateSettingsMutation.mutate({ dataSource: source })}
                style={{
                  flex: 1,
                  padding: '6px 0',
                  background: settings?.dataSource === source ? '#333' : 'transparent',
                  border: `1px solid ${settings?.dataSource === source ? '#555' : '#333'}`,
                  color: settings?.dataSource === source ? '#fff' : '#666',
                  fontSize: 10,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {source.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ color: '#888', fontSize: 10, display: 'block', marginBottom: 4 }}>Environment</label>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['paper', 'live'] as const).map(env => (
              <button
                key={env}
                onClick={() => updateSettingsMutation.mutate({ environment: env })}
                style={{
                  flex: 1,
                  padding: '6px 0',
                  background: settings?.environment === env ? (env === 'live' ? '#7f1d1d' : '#333') : 'transparent',
                  border: `1px solid ${settings?.environment === env ? (env === 'live' ? '#ef4444' : '#555') : '#333'}`,
                  color: settings?.environment === env ? '#fff' : '#666',
                  fontSize: 10,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {env.toUpperCase()}
              </button>
            ))}
          </div>
          {settings?.environment === 'live' && (
            <p style={{ color: '#ef4444', fontSize: 10, marginTop: 4 }}>
              WARNING: Live trading enabled
            </p>
          )}
        </div>
      </Section>

      {/* Order Management */}
      <Section title="ORDER MANAGEMENT">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <ActionButton
            label={testOrderMutation.isPending ? 'Testing...' : 'Test Order'}
            onClick={() => testOrderMutation.mutate()}
            disabled={!broker?.connected || testOrderMutation.isPending}
          />
          <ActionButton
            label="Clear Open Orders"
            onClick={() => setShowClearConfirm(true)}
            disabled={!broker?.connected}
            variant="danger"
          />
        </div>

        {/* Clear orders confirmation */}
        {showClearConfirm && (
          <div style={{ background: '#111', border: '1px solid #ef4444', padding: 12, marginTop: 8 }}>
            <p style={{ color: '#ef4444', marginBottom: 8, fontSize: 11 }}>&gt; CONFIRM CLEAR ALL OPEN ORDERS?</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => clearOrdersMutation.mutate()}
                disabled={clearOrdersMutation.isPending}
                style={{
                  flex: 1,
                  padding: '6px 0',
                  background: '#ef4444',
                  border: 'none',
                  color: '#fff',
                  fontSize: 10,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {clearOrdersMutation.isPending ? 'CLEARING...' : 'CONFIRM'}
              </button>
              <button
                onClick={() => setShowClearConfirm(false)}
                style={{
                  flex: 1,
                  padding: '6px 0',
                  background: 'none',
                  border: '1px solid #333',
                  color: '#888',
                  fontSize: 10,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                CANCEL
              </button>
            </div>
          </div>
        )}

        {testOrderMutation.isSuccess && (
          <p style={{ color: '#4ade80', fontSize: 11, marginTop: 8 }}>
            &gt; Test order submitted
          </p>
        )}
        {testOrderMutation.isError && (
          <p style={{ color: '#ef4444', fontSize: 11, marginTop: 8 }}>
            &gt; ERROR: {testOrderMutation.error?.message}
          </p>
        )}
        {clearOrdersMutation.isSuccess && (
          <p style={{ color: '#4ade80', fontSize: 11, marginTop: 8 }}>
            &gt; Open orders cleared
          </p>
        )}
      </Section>

      {/* Diagnostics Section */}
      <Section title="DIAGNOSTICS">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4 }}>
          <DiagItem label="OAuth" status={diag?.oauth ?? false} />
          <DiagItem label="SSO" status={diag?.sso ?? false} />
          <DiagItem label="Init" status={diag?.init ?? false} />
          <DiagItem label="WebSocket" status={diag?.ws ?? false} />
        </div>
        {diag?.lastError && (
          <p style={{ color: '#ef4444', fontSize: 10, marginTop: 8 }}>
            Last Error: {diag.lastError}
          </p>
        )}
      </Section>

      {/* App Info */}
      <Section title="APP INFO">
        <Row label="Version" value="1.0.0" />
        <Row label="Environment" value={import.meta.env.MODE} />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid #222' }}>
      <p style={{ color: '#87ceeb', fontSize: 11, marginBottom: 10 }}>&gt; {title}</p>
      {children}
    </div>
  );
}

function Row({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: React.ReactNode;
  valueColor?: string;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 11 }}>
      <span style={{ color: '#888' }}>{label}</span>
      <span style={{ color: valueColor || '#fff' }}>{value}</span>
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  disabled,
  variant = 'default',
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'default' | 'danger';
}) {
  const colors = variant === 'danger'
    ? { border: '#ef4444', color: '#ef4444' }
    : { border: '#333', color: '#888' };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '6px 12px',
        background: 'transparent',
        border: `1px solid ${colors.border}`,
        color: disabled ? '#444' : colors.color,
        fontSize: 10,
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {label}
    </button>
  );
}

function DiagItem({ label, status }: { label: string; status: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10 }}>
      <span style={{ color: status ? '#4ade80' : '#ef4444' }}>
        {status ? '[OK]' : '[X]'}
      </span>
      <span style={{ color: '#888' }}>{label}</span>
    </div>
  );
}
