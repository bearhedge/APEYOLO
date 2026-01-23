/**
 * SettingsWindow - Configuration and preferences
 *
 * PORTED FROM: client/src/pages/Settings.tsx
 * Uses same API endpoints and logic, with terminal styling.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

interface IbkrStatus {
  configured: boolean;
  connected: boolean;
  accountId?: string;
  nav?: number;
  environment?: 'paper' | 'live';
  connectionMode?: 'oauth' | 'relay';
  diagnostics?: {
    oauth?: { status: number; message: string; success?: boolean };
    sso?: { status: number; message: string; success?: boolean };
    validate?: { status: number; message: string; success?: boolean };
    validated?: { status: number; message: string; success?: boolean };
    init?: { status: number; message: string; success?: boolean };
    initialized?: { status: number; message: string; success?: boolean };
    websocket?: { status: number; message: string; success?: boolean };
  };
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

  // Main IBKR status query - SAME AS Settings.tsx
  const { data: ibkrStatus, refetch: refetchStatus } = useQuery<IbkrStatus>({
    queryKey: ['/api/ibkr/status'],
    queryFn: async () => {
      const response = await fetch('/api/ibkr/status', { credentials: 'include' });
      return response.json();
    },
    refetchInterval: (query) => {
      const data = query.state.data as IbkrStatus | undefined;
      if (!data?.configured) return false;
      if (data?.configured && !data?.connected) return 3000;
      return 30000;
    },
  });

  // Solana info query
  const { data: solana } = useQuery<SolanaInfo>({
    queryKey: ['solana-info'],
    queryFn: async () => {
      const res = await fetch('/api/solana/info', { credentials: 'include' });
      if (!res.ok) return {};
      return res.json();
    },
  });

  // Settings from localStorage
  const { data: settings } = useQuery<AppSettings>({
    queryKey: ['app-settings'],
    queryFn: async () => {
      const stored = localStorage.getItem('ape-settings');
      if (stored) return JSON.parse(stored);
      return { dataSource: 'websocket', environment: 'paper' };
    },
  });

  // Helper to refresh all IBKR-related caches
  const refreshAllIbkrStatus = () => {
    refetchStatus();
    queryClient.refetchQueries({ queryKey: ['/api/broker/diag'] });
    queryClient.refetchQueries({ queryKey: ['/api/account'] });
    queryClient.refetchQueries({ queryKey: ['broker-status'] });
  };

  // Test connection - SAME AS Settings.tsx
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
    onSuccess: () => refreshAllIbkrStatus(),
  });

  // Reconnect via OAuth - SAME AS Settings.tsx
  const reconnectMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/broker/oauth', {
        method: 'POST',
        credentials: 'include',
      });
      return res.json();
    },
    onSuccess: () => refreshAllIbkrStatus(),
  });

  // Warm endpoint (full readiness flow) - SAME AS Settings.tsx
  const warmMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/broker/warm', { credentials: 'include' });
      return res.json();
    },
    onSuccess: () => refreshAllIbkrStatus(),
  });

  // Clear all open orders
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
    onSuccess: () => setShowClearConfirm(false),
  });

  // Test order mutation
  const testOrderMutation = useMutation({
    mutationFn: async () => {
      const randomQty = Math.floor(Math.random() * 5) + 1;
      const res = await fetch('/api/broker/paper/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          symbol: 'SPY',
          side: 'BUY',
          quantity: randomQty,
          orderType: 'MKT',
          tif: 'DAY',
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Test order failed');
      }
      return res.json();
    },
  });

  // Update settings mutation
  const updateSettingsMutation = useMutation({
    mutationFn: async (newSettings: Partial<AppSettings>) => {
      const updated = { ...settings, ...newSettings };
      localStorage.setItem('ape-settings', JSON.stringify(updated));
      return updated;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['app-settings'] });
    },
  });

  const isLoading = testConnectionMutation.isPending || reconnectMutation.isPending || warmMutation.isPending;

  // Get diagnostics with fallbacks
  const diag = ibkrStatus?.diagnostics;

  return (
    <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>
      {/* IBKR Section */}
      <Section title="IBKR CONNECTION">
        <Row
          label="Status"
          value={ibkrStatus?.connected ? 'CONNECTED' : 'DISCONNECTED'}
          valueColor={ibkrStatus?.connected ? '#4ade80' : '#ef4444'}
        />
        {ibkrStatus?.accountId && <Row label="Account" value={ibkrStatus.accountId} />}
        {ibkrStatus?.nav && <Row label="NAV" value={`$${ibkrStatus.nav.toLocaleString()}`} valueColor="#4ade80" />}
        <Row label="Mode" value={ibkrStatus?.environment?.toUpperCase() || 'PAPER'} valueColor="#87ceeb" />

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <ActionButton
            label={testConnectionMutation.isPending ? 'Testing...' : 'Test Connection'}
            onClick={() => testConnectionMutation.mutate()}
            disabled={isLoading}
          />
          <ActionButton
            label={warmMutation.isPending ? 'Connecting...' : 'Reconnect'}
            onClick={() => warmMutation.mutate()}
            disabled={isLoading}
          />
        </div>

        {/* Error display */}
        {(testConnectionMutation.isError || reconnectMutation.isError || warmMutation.isError) && (
          <p style={{ color: '#ef4444', fontSize: 11, marginTop: 8 }}>
            &gt; ERROR: {testConnectionMutation.error?.message || reconnectMutation.error?.message || warmMutation.error?.message}
          </p>
        )}

        {/* Success display */}
        {testConnectionMutation.isSuccess && (
          <p style={{ color: '#4ade80', fontSize: 11, marginTop: 8 }}>
            &gt; Connection test passed
          </p>
        )}
      </Section>

      {/* Auth Pipeline - PORTED FROM Settings.tsx */}
      {ibkrStatus?.configured && diag && (
        <Section title="AUTH PIPELINE">
          {ibkrStatus?.connectionMode === 'relay' ? (
            <p style={{ color: '#666', fontSize: 11 }}>Not used in TWS/Gateway mode</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4 }}>
              <DiagStep
                label="OAuth"
                status={diag.oauth?.status || 0}
                message={diag.oauth?.message}
                success={diag.oauth?.success}
              />
              <DiagStep
                label="SSO"
                status={diag.sso?.status || 0}
                message={diag.sso?.message}
                success={diag.sso?.success}
              />
              <DiagStep
                label="Validate"
                status={diag.validate?.status || diag.validated?.status || 0}
                message={diag.validate?.message || diag.validated?.message}
                success={diag.validate?.success || diag.validated?.success}
              />
              <DiagStep
                label="Init"
                status={diag.init?.status || diag.initialized?.status || 0}
                message={diag.init?.message || diag.initialized?.message}
                success={diag.init?.success || diag.initialized?.success}
              />
              <DiagStep
                label="WebSocket"
                status={diag.websocket?.status || 0}
                message={diag.websocket?.message}
                success={diag.websocket?.success}
              />
            </div>
          )}
        </Section>
      )}

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
            disabled={!ibkrStatus?.connected || testOrderMutation.isPending}
          />
          <ActionButton
            label="Clear Open Orders"
            onClick={() => setShowClearConfirm(true)}
            disabled={!ibkrStatus?.connected}
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

function DiagStep({
  label,
  status,
  message,
  success,
}: {
  label: string;
  status: number;
  message?: string;
  success?: boolean;
}) {
  // Status: 0 = not attempted, 1 = in progress, 2 = complete
  const isComplete = status === 2 || success;
  const isInProgress = status === 1;

  const icon = isComplete ? '[OK]' : isInProgress ? '[..]' : '[X]';
  const color = isComplete ? '#4ade80' : isInProgress ? '#f59e0b' : '#ef4444';

  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10 }}
      title={message || label}
    >
      <span style={{ color }}>{icon}</span>
      <span style={{ color: '#888' }}>{label}</span>
    </div>
  );
}
