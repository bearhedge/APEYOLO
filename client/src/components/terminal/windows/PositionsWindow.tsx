/**
 * PositionsWindow - Current open positions display
 *
 * Shows live P&L, Greeks, and position details.
 */

import { useQuery } from '@tanstack/react-query';

interface Position {
  id: string;
  symbol: string;
  strategy: string;
  leg1Type: string;
  leg1Strike: number;
  leg2Type?: string;
  leg2Strike?: number;
  contracts: number;
  entryPremiumTotal: number;
  currentPrice?: number;
  unrealizedPnl?: number;
  delta?: number;
  theta?: number;
  expiry?: string;
}

export function PositionsWindow() {
  const { data: positions, isLoading, error } = useQuery<Position[]>({
    queryKey: ['positions'],
    queryFn: async () => {
      const res = await fetch('/api/positions', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch positions');
      const data = await res.json();
      return data.positions || [];
    },
    refetchInterval: 5000, // Refresh every 5 seconds
  });

  if (isLoading) {
    return <p style={{ color: '#666' }}>&gt; Loading positions...</p>;
  }

  if (error) {
    return <p style={{ color: '#ef4444' }}>&gt; ERROR: Failed to load positions</p>;
  }

  if (!positions || positions.length === 0) {
    return (
      <div>
        <p>&gt; NO OPEN POSITIONS</p>
        <p style={{ marginTop: 12, color: '#666' }}>&gt; Use engine.exe to enter trades.</p>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
      <p style={{ color: '#4ade80', marginBottom: 12 }}>
        &gt; {positions.length} OPEN POSITION{positions.length !== 1 ? 'S' : ''}
      </p>

      {positions.map(pos => (
        <PositionCard key={pos.id} position={pos} />
      ))}
    </div>
  );
}

function PositionCard({ position }: { position: Position }) {
  const pnl = position.unrealizedPnl || 0;
  const pnlColor = pnl >= 0 ? '#4ade80' : '#ef4444';
  const pnlSign = pnl >= 0 ? '+' : '';

  // Format strikes
  const strikes = position.leg2Strike
    ? `${position.leg1Strike}/${position.leg2Strike}`
    : `${position.leg1Strike}`;

  return (
    <div
      style={{
        background: '#111',
        border: '1px solid #222',
        padding: 12,
        marginBottom: 8,
        fontSize: 12,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ color: '#fff', fontWeight: 500 }}>
          {position.symbol} {position.strategy}
        </span>
        <span style={{ color: pnlColor }}>
          {pnlSign}${pnl.toFixed(0)}
        </span>
      </div>

      {/* Details */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, color: '#888' }}>
        <span>Strikes: {strikes}</span>
        <span>Contracts: {position.contracts}</span>
        <span>Entry: ${position.entryPremiumTotal.toFixed(0)}</span>
        {position.delta !== undefined && (
          <span>Delta: {position.delta.toFixed(2)}</span>
        )}
        {position.theta !== undefined && (
          <span>Theta: ${position.theta.toFixed(0)}/day</span>
        )}
        {position.expiry && (
          <span>Expiry: {new Date(position.expiry).toLocaleDateString()}</span>
        )}
      </div>
    </div>
  );
}
