/**
 * SettingsWindow - Configuration and preferences
 *
 * PORTED FROM: client/src/pages/Settings.tsx
 * Uses same API endpoints and logic, with terminal styling.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DebugLogPanel } from '@/components/DebugLogPanel';

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

export function SettingsWindow() {
  const queryClient = useQueryClient();

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
    refetchOnWindowFocus: true,
    refetchOnMount: true,
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

  // Warm endpoint (full readiness flow) - SAME AS Settings.tsx
  const warmMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/broker/warm', { credentials: 'include' });
      return res.json();
    },
    onSuccess: () => refreshAllIbkrStatus(),
  });

  const isLoading = testConnectionMutation.isPending || warmMutation.isPending;

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
        {(testConnectionMutation.isError || warmMutation.isError) && (
          <p style={{ color: '#ef4444', fontSize: 11, marginTop: 8 }}>
            &gt; ERROR: {testConnectionMutation.error?.message || warmMutation.error?.message}
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

      {/* Debug Log Panel */}
      <Section title="DEBUG LOG">
        <DebugLogPanel height={200} title="" />
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
  // Status: 0 = not attempted, 1 = in progress, 2 = complete, 200 = HTTP OK
  const isComplete = status === 200 || status === 2 || success;
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
