/**
 * TradesWindow - Trade history log
 *
 * Shows recent trades with P&L, dates, and details.
 */

import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';

interface Trade {
  id: string;
  symbol: string;
  strategy: string;
  leg1Strike: number;
  leg2Strike?: number;
  contracts: number;
  entryPremiumTotal: number;
  realizedPnl: number;
  status: string;
  exitReason?: string;
  createdAt: string;
  closedAt?: string;
  solanaSignature?: string;
}

export function TradesWindow() {
  const { data: trades, isLoading, error } = useQuery<Trade[]>({
    queryKey: ['trades'],
    queryFn: async () => {
      const res = await fetch('/api/defi/trades?limit=20', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch trades');
      const data = await res.json();
      return data.trades || [];
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  if (isLoading) {
    return <p style={{ color: '#666' }}>&gt; Loading trade log...</p>;
  }

  if (error) {
    return <p style={{ color: '#ef4444' }}>&gt; ERROR: Failed to load trades</p>;
  }

  if (!trades || trades.length === 0) {
    return (
      <div>
        <p>&gt; NO TRADES YET</p>
        <p style={{ marginTop: 12, color: '#666' }}>&gt; Your trade history will appear here.</p>
      </div>
    );
  }

  // Calculate totals
  const totalPnl = trades.reduce((sum, t) => sum + (t.realizedPnl || 0), 0);
  const wins = trades.filter(t => (t.realizedPnl || 0) > 0).length;
  const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;

  return (
    <div style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
      {/* Summary */}
      <div style={{ marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid #333' }}>
        <div style={{ display: 'flex', gap: 24, fontSize: 12 }}>
          <span>
            Total P&L:{' '}
            <span style={{ color: totalPnl >= 0 ? '#4ade80' : '#ef4444' }}>
              {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(0)}
            </span>
          </span>
          <span>
            Win Rate: <span style={{ color: '#fff' }}>{winRate.toFixed(0)}%</span>
          </span>
          <span>
            Trades: <span style={{ color: '#fff' }}>{trades.length}</span>
          </span>
        </div>
      </div>

      {/* Trade List */}
      <div style={{ maxHeight: 300, overflow: 'auto' }}>
        {trades.map(trade => (
          <TradeRow key={trade.id} trade={trade} />
        ))}
      </div>
    </div>
  );
}

function TradeRow({ trade }: { trade: Trade }) {
  const pnl = trade.realizedPnl || 0;
  const pnlColor = pnl >= 0 ? '#4ade80' : '#ef4444';
  const pnlSign = pnl >= 0 ? '+' : '';

  const date = new Date(trade.closedAt || trade.createdAt);
  const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  const strikes = trade.leg2Strike
    ? `${trade.leg1Strike}/${trade.leg2Strike}`
    : `${trade.leg1Strike}`;

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '8px 0',
        borderBottom: '1px solid #222',
        fontSize: 12,
      }}
    >
      <div>
        <span style={{ color: '#888', marginRight: 12 }}>{dateStr}</span>
        <span style={{ color: '#fff' }}>
          {trade.symbol} {trade.strategy}
        </span>
        <span style={{ color: '#666', marginLeft: 8 }}>{strikes}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ color: pnlColor }}>
          {pnlSign}${pnl.toFixed(0)}
        </span>
        {trade.solanaSignature && (
          <a
            href={`https://explorer.solana.com/tx/${trade.solanaSignature}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#3b82f6' }}
          >
            <ExternalLink style={{ width: 12, height: 12 }} />
          </a>
        )}
      </div>
    </div>
  );
}
