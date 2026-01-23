/**
 * SettingsWindow - Configuration and preferences
 *
 * IBKR connection, Solana wallet info, app preferences.
 */

import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Wallet, Server, RefreshCw } from 'lucide-react';

interface BrokerStatus {
  connected: boolean;
  accountId?: string;
  host?: string;
  port?: number;
}

interface SolanaInfo {
  walletAddress?: string;
  balance?: number;
  cluster?: string;
}

export function SettingsWindow() {
  const { data: broker, refetch: refetchBroker } = useQuery<BrokerStatus>({
    queryKey: ['broker-status'],
    queryFn: async () => {
      const res = await fetch('/api/broker/diag', { credentials: 'include' });
      if (!res.ok) return { connected: false };
      return res.json();
    },
  });

  const { data: solana } = useQuery<SolanaInfo>({
    queryKey: ['solana-info'],
    queryFn: async () => {
      const res = await fetch('/api/solana/info', { credentials: 'include' });
      if (!res.ok) return {};
      return res.json();
    },
  });

  return (
    <div style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
      {/* IBKR Section */}
      <Section title="IBKR CONNECTION">
        <Row
          label="Status"
          value={broker?.connected ? 'CONNECTED' : 'DISCONNECTED'}
          valueColor={broker?.connected ? '#4ade80' : '#ef4444'}
        />
        {broker?.accountId && <Row label="Account" value={broker.accountId} />}
        {broker?.host && <Row label="Host" value={`${broker.host}:${broker.port}`} />}

        <div style={{ marginTop: 12 }}>
          <button
            onClick={() => refetchBroker()}
            style={{
              padding: '6px 12px',
              background: '#111',
              border: '1px solid #333',
              color: '#888',
              fontSize: 11,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontFamily: 'inherit',
            }}
          >
            <RefreshCw style={{ width: 12, height: 12 }} />
            Refresh Status
          </button>
        </div>

        <LinkButton href="/settings" label="Configure IBKR" icon={<Server style={{ width: 12, height: 12 }} />} />
      </Section>

      {/* Solana Section */}
      <Section title="SOLANA WALLET">
        <Row label="Cluster" value={solana?.cluster || 'mainnet-beta'} />
        {solana?.walletAddress && (
          <>
            <Row
              label="Address"
              value={
                <a
                  href={`https://explorer.solana.com/address/${solana.walletAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#3b82f6', display: 'flex', alignItems: 'center', gap: 4 }}
                >
                  {truncate(solana.walletAddress)}
                  <ExternalLink style={{ width: 10, height: 10 }} />
                </a>
              }
            />
            <Row
              label="Balance"
              value={solana.balance !== undefined ? `${solana.balance.toFixed(4)} SOL` : '--'}
            />
          </>
        )}
        {!solana?.walletAddress && (
          <p style={{ color: '#666', fontSize: 11, marginTop: 8 }}>
            Wallet address not available
          </p>
        )}
      </Section>

      {/* App Section */}
      <Section title="APP INFO">
        <Row label="Version" value="1.0.0" />
        <Row label="Environment" value={import.meta.env.MODE} />

        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <LinkButton
            href="/admin"
            label="Admin Dashboard"
            icon={<Server style={{ width: 12, height: 12 }} />}
          />
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <p style={{ color: '#87ceeb', fontSize: 11, marginBottom: 12 }}>&gt; {title}</p>
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
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12 }}>
      <span style={{ color: '#888' }}>{label}</span>
      <span style={{ color: valueColor || '#fff' }}>{value}</span>
    </div>
  );
}

function LinkButton({
  href,
  label,
  icon,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <a
      href={href}
      style={{
        padding: '6px 12px',
        background: '#111',
        border: '1px solid #333',
        color: '#888',
        fontSize: 11,
        textDecoration: 'none',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        marginTop: 8,
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
      {icon}
      {label}
    </a>
  );
}

function truncate(str: string, chars = 6): string {
  if (str.length <= chars * 2 + 3) return str;
  return `${str.slice(0, chars)}...${str.slice(-chars)}`;
}
