/**
 * AccountingWindow - Comprehensive accounting dashboard
 *
 * Tabs for:
 * - Ledger: View all financial entries with running balance
 * - Reconciliation: Calendar view of daily IBKR reconciliation status
 * - Attestation: Prepare and submit Solana attestations
 */

import { useState } from 'react';
import { LedgerView } from '../../accounting/LedgerView';
import { ReconciliationDashboard } from '../../accounting/ReconciliationDashboard';
import { useQuery } from '@tanstack/react-query';

type Tab = 'ledger' | 'reconciliation' | 'attestation';

const tabs: { id: Tab; label: string }[] = [
  { id: 'ledger', label: 'Ledger' },
  { id: 'reconciliation', label: 'Reconciliation' },
  { id: 'attestation', label: 'Attestation' },
];

interface AttestationPeriod {
  id: string;
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
  status: string;
  totalPnl: string;
  returnPercent: string;
  tradeCount: number;
  solanaSignature: string | null;
}

function AttestationView() {
  const { data, isLoading, error } = useQuery<{ success: boolean; data: AttestationPeriod[] }>({
    queryKey: ['attestations'],
    queryFn: async () => {
      const res = await fetch('/api/accounting/attestations', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch attestations');
      return res.json();
    },
    refetchInterval: 60000,
  });

  const attestations = data?.data || [];

  const getStatusBadge = (status: string) => {
    const styles: Record<string, { bg: string; color: string }> = {
      draft: { bg: 'rgba(156, 163, 175, 0.2)', color: '#9ca3af' },
      ready: { bg: 'rgba(234, 179, 8, 0.2)', color: '#eab308' },
      attested: { bg: 'rgba(34, 197, 94, 0.2)', color: '#22c55e' },
    };
    const style = styles[status] || styles.draft;
    return (
      <span style={{
        padding: '2px 6px',
        background: style.bg,
        color: style.color,
        fontSize: '10px',
        textTransform: 'uppercase',
      }}>
        {status}
      </span>
    );
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', fontSize: '11px' }}>
      {/* Header */}
      <div style={{ padding: '12px', borderBottom: '1px solid #333' }}>
        <h3 style={{ margin: 0, color: '#fff', fontSize: '12px' }}>Attestation History</h3>
        <p style={{ margin: '4px 0 0', color: '#666', fontSize: '10px' }}>
          Verified trading periods attested on Solana
        </p>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {isLoading && (
          <div style={{ padding: '16px', color: '#666' }}>Loading attestations...</div>
        )}

        {error && (
          <div style={{ padding: '16px', color: '#ef4444' }}>
            Error: {(error as Error).message}
          </div>
        )}

        {!isLoading && !error && attestations.length === 0 && (
          <div style={{ padding: '16px', color: '#666' }}>
            No attestations yet. Reconcile trading days first, then prepare attestations.
          </div>
        )}

        {attestations.map((att) => (
          <div
            key={att.id}
            style={{
              padding: '12px',
              borderBottom: '1px solid #222',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ color: '#fff' }}>{att.periodLabel || `${att.periodStart} to ${att.periodEnd}`}</span>
              {getStatusBadge(att.status)}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', color: '#9ca3af' }}>
              <div>
                <div style={{ fontSize: '9px', color: '#666' }}>P&L</div>
                <div style={{ color: parseFloat(att.totalPnl) >= 0 ? '#22c55e' : '#ef4444' }}>
                  {parseFloat(att.totalPnl) >= 0 ? '+' : ''}${parseFloat(att.totalPnl).toFixed(2)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '9px', color: '#666' }}>Return</div>
                <div style={{ color: parseFloat(att.returnPercent) >= 0 ? '#22c55e' : '#ef4444' }}>
                  {parseFloat(att.returnPercent) >= 0 ? '+' : ''}{parseFloat(att.returnPercent).toFixed(2)}%
                </div>
              </div>
              <div>
                <div style={{ fontSize: '9px', color: '#666' }}>Trades</div>
                <div>{att.tradeCount}</div>
              </div>
              <div>
                <div style={{ fontSize: '9px', color: '#666' }}>Solana</div>
                {att.solanaSignature ? (
                  <a
                    href={`https://solscan.io/tx/${att.solanaSignature}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: '#60a5fa', textDecoration: 'none', fontSize: '9px' }}
                  >
                    View Tx
                  </a>
                ) : (
                  <span style={{ color: '#666' }}>-</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div style={{
        padding: '8px 12px',
        borderTop: '1px solid #333',
        color: '#666',
        fontSize: '10px',
      }}>
        Total: {attestations.length} attestation periods
      </div>
    </div>
  );
}

export function AccountingWindow() {
  const [activeTab, setActiveTab] = useState<Tab>('ledger');

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: '#000',
      color: '#fff',
      fontFamily: "'IBM Plex Mono', monospace",
    }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex',
        borderBottom: '1px solid #333',
      }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '8px 16px',
              background: activeTab === tab.id ? '#1a1a1a' : 'transparent',
              border: 'none',
              borderRight: '1px solid #333',
              color: activeTab === tab.id ? '#fff' : '#666',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: '11px',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={e => {
              if (activeTab !== tab.id) {
                e.currentTarget.style.color = '#fff';
                e.currentTarget.style.background = '#111';
              }
            }}
            onMouseLeave={e => {
              if (activeTab !== tab.id) {
                e.currentTarget.style.color = '#666';
                e.currentTarget.style.background = 'transparent';
              }
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {activeTab === 'ledger' && <LedgerView />}
        {activeTab === 'reconciliation' && <ReconciliationDashboard />}
        {activeTab === 'attestation' && <AttestationView />}
      </div>
    </div>
  );
}
