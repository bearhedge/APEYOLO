/**
 * StatsWindow - Performance statistics
 *
 * Shows total return, win rate, Sharpe ratio, and other metrics.
 */

import { useQuery } from '@tanstack/react-query';

interface PerformanceData {
  totalReturn: number;
  winRate: number;
  totalTrades: number;
  winCount: number;
  lossCount: number;
  totalPnl: number;
  avgWin: number;
  avgLoss: number;
  sharpeRatio?: number;
  maxDrawdown?: number;
  profitFactor?: number;
}

export function StatsWindow() {
  const { data: stats, isLoading, error } = useQuery<PerformanceData>({
    queryKey: ['performance'],
    queryFn: async () => {
      const res = await fetch('/api/defi/performance', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch performance');
      const data = await res.json();
      return data.performance || data;
    },
    refetchInterval: 60000, // Refresh every minute
  });

  if (isLoading) {
    return <p style={{ color: '#666' }}>&gt; Calculating stats...</p>;
  }

  if (error) {
    return <p style={{ color: '#ef4444' }}>&gt; ERROR: Failed to load stats</p>;
  }

  if (!stats || stats.totalTrades === 0) {
    return (
      <div>
        <p>&gt; NO PERFORMANCE DATA</p>
        <p style={{ marginTop: 12, color: '#666' }}>&gt; Stats will appear after your first trade.</p>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
      <p style={{ color: '#87ceeb', marginBottom: 16 }}>&gt; PERFORMANCE METRICS</p>

      {/* Key Metrics */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <MetricCard
          label="Total Return"
          value={`${stats.totalReturn >= 0 ? '+' : ''}${stats.totalReturn.toFixed(2)}%`}
          color={stats.totalReturn >= 0 ? '#4ade80' : '#ef4444'}
        />
        <MetricCard
          label="Win Rate"
          value={`${stats.winRate.toFixed(1)}%`}
          color={stats.winRate >= 50 ? '#4ade80' : '#f59e0b'}
        />
        <MetricCard
          label="Total P&L"
          value={`${stats.totalPnl >= 0 ? '+' : ''}$${stats.totalPnl.toFixed(0)}`}
          color={stats.totalPnl >= 0 ? '#4ade80' : '#ef4444'}
        />
        <MetricCard label="Trades" value={stats.totalTrades.toString()} color="#fff" />
      </div>

      {/* Detailed Stats */}
      <div style={{ borderTop: '1px solid #333', paddingTop: 12 }}>
        <Row label="Wins / Losses" value={`${stats.winCount} / ${stats.lossCount}`} />
        <Row label="Avg Win" value={`+$${stats.avgWin.toFixed(0)}`} valueColor="#4ade80" />
        <Row label="Avg Loss" value={`-$${Math.abs(stats.avgLoss).toFixed(0)}`} valueColor="#ef4444" />
        {stats.profitFactor !== undefined && (
          <Row
            label="Profit Factor"
            value={stats.profitFactor.toFixed(2)}
            valueColor={stats.profitFactor >= 1.5 ? '#4ade80' : '#f59e0b'}
          />
        )}
        {stats.sharpeRatio !== undefined && (
          <Row
            label="Sharpe Ratio"
            value={stats.sharpeRatio.toFixed(2)}
            valueColor={stats.sharpeRatio >= 1 ? '#4ade80' : '#f59e0b'}
          />
        )}
        {stats.maxDrawdown !== undefined && (
          <Row
            label="Max Drawdown"
            value={`-${stats.maxDrawdown.toFixed(1)}%`}
            valueColor="#ef4444"
          />
        )}
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div
      style={{
        background: '#111',
        border: '1px solid #222',
        padding: 12,
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, color, fontWeight: 500 }}>{value}</div>
    </div>
  );
}

function Row({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12 }}>
      <span style={{ color: '#888' }}>{label}</span>
      <span style={{ color: valueColor || '#fff' }}>{value}</span>
    </div>
  );
}
