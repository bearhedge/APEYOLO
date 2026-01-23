/**
 * TradesWindow - Trade history log
 *
 * Shows all trades with P&L and details. Simple list view.
 */

import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';

interface Trade {
  id: string;
  date: string;
  dateFormatted: string;
  symbol: string;
  strategy: string;
  putStrike: number | null;
  callStrike: number | null;
  contracts: number;
  entryTime: string | null;
  exitTime: string | null;
  status: string;
  outcome: string;
  realizedPnlUSD: number;
  holdingMinutes: number | null;
  solanaSignature?: string;
}

export function TradesWindow() {
  const { data: tradesResponse, isLoading, error } = useQuery<{ trades: Trade[]; count: number }>({
    queryKey: ['trades'],
    queryFn: async () => {
      const res = await fetch('/api/defi/trades?limit=50', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch trades');
      return res.json();
    },
    refetchInterval: 30000,
  });

  if (isLoading) {
    return <p style={{ color: '#666' }}>&gt; Loading trade log...</p>;
  }

  if (error) {
    return <p style={{ color: '#ef4444' }}>&gt; ERROR: Failed to load trades</p>;
  }

  const trades = tradesResponse?.trades || [];

  if (trades.length === 0) {
    return (
      <div>
        <p>&gt; NO TRADES YET</p>
        <p style={{ marginTop: 12, color: '#666' }}>&gt; Your trade history will appear here.</p>
      </div>
    );
  }

  // Calculate totals from closed trades only
  const closedTrades = trades.filter(t => t.status !== 'open');
  const totalPnl = closedTrades.reduce((sum, t) => sum + (t.realizedPnlUSD || 0), 0);
  const winningTrades = closedTrades.filter(t => t.outcome === 'win');
  const losingTrades = closedTrades.filter(t => t.outcome === 'loss');
  const wins = winningTrades.length;
  const losses = losingTrades.length;
  const winRate = closedTrades.length > 0 ? (wins / closedTrades.length) * 100 : 0;

  // Calculate averages
  const totalWinAmount = winningTrades.reduce((sum, t) => sum + (t.realizedPnlUSD || 0), 0);
  const totalLossAmount = Math.abs(losingTrades.reduce((sum, t) => sum + (t.realizedPnlUSD || 0), 0));
  const avgWin = wins > 0 ? totalWinAmount / wins : 0;
  const avgLoss = losses > 0 ? totalLossAmount / losses : 0;

  return (
    <div style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
      {/* Summary */}
      <div style={{ marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid #333' }}>
        {/* Row 1: Main metrics */}
        <div style={{ display: 'flex', gap: 20, fontSize: 12, marginBottom: 6 }}>
          <span>
            P&L:{' '}
            <span style={{ color: totalPnl >= 0 ? '#4ade80' : '#ef4444' }}>
              {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(0)}
            </span>
          </span>
          <span>
            Win: <span style={{ color: winRate >= 50 ? '#4ade80' : '#f59e0b' }}>{winRate.toFixed(0)}%</span>
            <span style={{ color: '#666', marginLeft: 4, fontSize: 10 }}>({wins}/{closedTrades.length})</span>
          </span>
        </div>
        {/* Row 2: Avg Win/Loss */}
        {closedTrades.length > 0 && (
          <div style={{ display: 'flex', gap: 20, fontSize: 10, color: '#888' }}>
            <span>Avg Win: <span style={{ color: '#4ade80' }}>+${avgWin.toFixed(0)}</span></span>
            <span>Avg Loss: <span style={{ color: '#ef4444' }}>-${avgLoss.toFixed(0)}</span></span>
          </div>
        )}
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
  const pnl = trade.realizedPnlUSD || 0;
  const isOpen = trade.status === 'open';
  const pnlColor = isOpen ? '#3b82f6' : (pnl >= 0 ? '#4ade80' : '#ef4444');
  const pnlSign = pnl >= 0 ? '+' : '';

  // Format strikes
  const strikes = trade.putStrike
    ? (trade.callStrike ? `${trade.putStrike}P/${trade.callStrike}C` : `${trade.putStrike}P`)
    : (trade.callStrike ? `${trade.callStrike}C` : '');

  // Format holding time
  const held = trade.holdingMinutes !== null
    ? (trade.holdingMinutes < 60 ? `${trade.holdingMinutes}m` : `${Math.floor(trade.holdingMinutes / 60)}h`)
    : '';

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
        <span style={{ color: '#888', marginRight: 12 }}>{trade.dateFormatted}</span>
        <span style={{ color: '#fff' }}>
          {trade.symbol} {trade.strategy}
        </span>
        <span style={{ color: '#666', marginLeft: 8 }}>{strikes}</span>
        {held && <span style={{ color: '#555', marginLeft: 8, fontSize: 10 }}>{held}</span>}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {isOpen ? (
          <span style={{ color: pnlColor, fontSize: 10 }}>OPEN</span>
        ) : (
          <span style={{ color: pnlColor }}>
            {pnlSign}${pnl.toFixed(0)}
          </span>
        )}
        <span style={{ color: '#555', fontSize: 10 }}>
          {trade.status === 'expired' ? 'exp' : trade.status === 'stopped out' ? 'stop' : ''}
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
