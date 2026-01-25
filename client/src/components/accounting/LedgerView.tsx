/**
 * LedgerView - Displays ledger entries with running balance
 *
 * Shows all financial events (premium received, commissions, deposits, etc.)
 * with a running balance column for tracking cash flow.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

interface LedgerEntry {
  id: string;
  timestamp: string;
  effectiveDate: string;
  entryType: string;
  amount: string;
  description: string | null;
  runningBalance: number;
  reconciled: boolean;
  tradeId: string | null;
}

// Get today's date and 30 days ago in YYYY-MM-DD format
const today = new Date();
const thirtyDaysAgo = new Date(today);
thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

const formatDateInput = (date: Date) => date.toISOString().split('T')[0];

export function LedgerView() {
  const [startDate, setStartDate] = useState(formatDateInput(thirtyDaysAgo));
  const [endDate, setEndDate] = useState(formatDateInput(today));

  const { data, isLoading, error } = useQuery<{ success: boolean; data: LedgerEntry[] }>({
    queryKey: ['ledger', startDate, endDate],
    queryFn: async () => {
      const res = await fetch(`/api/accounting/ledger?startDate=${startDate}&endDate=${endDate}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch ledger');
      return res.json();
    },
    refetchInterval: 60000, // Refresh every minute
  });

  const formatAmount = (amount: string) => {
    const num = parseFloat(amount);
    const formatted = Math.abs(num).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return num >= 0 ? `+$${formatted}` : `-$${formatted}`;
  };

  const formatBalance = (balance: number) => {
    return `$${balance.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };

  const getEntryTypeColor = (type: string) => {
    switch (type) {
      case 'premium_received':
      case 'dividend':
      case 'interest':
      case 'deposit':
      case 'assignment_credit':
        return '#22c55e'; // green
      case 'commission':
      case 'cost_to_close':
      case 'fee':
      case 'withdrawal':
      case 'assignment_debit':
        return '#ef4444'; // red
      default:
        return '#9ca3af'; // gray
    }
  };

  const formatEntryType = (type: string) => {
    return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const entries = data?.data || [];

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', fontFamily: "'IBM Plex Mono', monospace", fontSize: '11px' }}>
      {/* Date filters */}
      <div style={{ display: 'flex', gap: '8px', padding: '8px', borderBottom: '1px solid #333', alignItems: 'center' }}>
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          style={{
            background: '#000',
            border: '1px solid #444',
            padding: '4px 8px',
            color: '#fff',
            fontFamily: 'inherit',
            fontSize: '11px',
          }}
        />
        <span style={{ color: '#666' }}>to</span>
        <input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          style={{
            background: '#000',
            border: '1px solid #444',
            padding: '4px 8px',
            color: '#fff',
            fontFamily: 'inherit',
            fontSize: '11px',
          }}
        />
        <span style={{ color: '#666', marginLeft: 'auto' }}>
          {entries.length} entries
        </span>
      </div>

      {/* Header */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '60px 120px 90px 90px 1fr',
        gap: '8px',
        padding: '8px',
        borderBottom: '1px solid #333',
        color: '#666',
      }}>
        <span>Date</span>
        <span>Type</span>
        <span style={{ textAlign: 'right' }}>Amount</span>
        <span style={{ textAlign: 'right' }}>Balance</span>
        <span>Description</span>
      </div>

      {/* Entries */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {isLoading && (
          <div style={{ padding: '16px', color: '#666' }}>Loading ledger entries...</div>
        )}

        {error && (
          <div style={{ padding: '16px', color: '#ef4444' }}>
            Error: {(error as Error).message}
          </div>
        )}

        {!isLoading && !error && entries.length === 0 && (
          <div style={{ padding: '16px', color: '#666' }}>
            No ledger entries for selected period
          </div>
        )}

        {entries.map((entry) => (
          <div
            key={entry.id}
            style={{
              display: 'grid',
              gridTemplateColumns: '60px 120px 90px 90px 1fr',
              gap: '8px',
              padding: '8px',
              borderBottom: '1px solid #222',
              alignItems: 'center',
            }}
          >
            <span style={{ color: '#9ca3af' }}>
              {formatDate(entry.effectiveDate)}
            </span>
            <span style={{ color: getEntryTypeColor(entry.entryType) }}>
              {formatEntryType(entry.entryType)}
            </span>
            <span style={{
              textAlign: 'right',
              color: parseFloat(entry.amount) >= 0 ? '#22c55e' : '#ef4444',
            }}>
              {formatAmount(entry.amount)}
            </span>
            <span style={{ textAlign: 'right', color: '#fff' }}>
              {formatBalance(entry.runningBalance)}
            </span>
            <span style={{ color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {entry.description || '-'}
              {entry.reconciled && (
                <span style={{ color: '#22c55e', marginLeft: '8px' }} title="Reconciled">
                  ✓
                </span>
              )}
            </span>
          </div>
        ))}
      </div>

      {/* Summary footer */}
      {entries.length > 0 && (
        <div style={{
          padding: '8px',
          borderTop: '1px solid #333',
          display: 'flex',
          justifyContent: 'space-between',
          color: '#666',
        }}>
          <span>
            Period Total: {formatAmount(
              entries.reduce((sum, e) => sum + parseFloat(e.amount), 0).toFixed(2)
            )}
          </span>
          <span>
            Ending Balance: {formatBalance(entries[entries.length - 1]?.runningBalance || 0)}
          </span>
        </div>
      )}
    </div>
  );
}
