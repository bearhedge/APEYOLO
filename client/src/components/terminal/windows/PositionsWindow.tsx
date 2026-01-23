/**
 * PositionsWindow - Current open positions display with management
 *
 * Shows live P&L, Greeks, position details, and close actions.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

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
  const [confirmClose, setConfirmClose] = useState<string | null>(null);
  const [confirmCloseAll, setConfirmCloseAll] = useState(false);
  const queryClient = useQueryClient();

  const { data: positions, isLoading, error } = useQuery<Position[]>({
    queryKey: ['positions'],
    queryFn: async () => {
      const res = await fetch('/api/positions', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch positions');
      const data = await res.json();
      return data.positions || [];
    },
    refetchInterval: 5000,
  });

  // Close single position mutation
  const closePositionMutation = useMutation({
    mutationFn: async (positionId: string) => {
      const res = await fetch(`/api/positions/${positionId}/close`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to close position');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['positions'] });
      setConfirmClose(null);
    },
  });

  // Close all positions mutation
  const closeAllMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/positions/close-all', {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to close all positions');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['positions'] });
      setConfirmCloseAll(false);
    },
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
      {/* Header with Close All */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <p style={{ color: '#4ade80', margin: 0 }}>
          &gt; {positions.length} OPEN POSITION{positions.length !== 1 ? 'S' : ''}
        </p>
        {positions.length > 0 && (
          <button
            onClick={() => setConfirmCloseAll(true)}
            disabled={closeAllMutation.isPending}
            style={{
              fontSize: 11,
              color: '#ef4444',
              background: 'none',
              border: '1px solid #ef4444',
              padding: '4px 8px',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {closeAllMutation.isPending ? 'CLOSING...' : 'CLOSE ALL'}
          </button>
        )}
      </div>

      {/* Error display */}
      {(closePositionMutation.isError || closeAllMutation.isError) && (
        <p style={{ color: '#ef4444', fontSize: 11, marginBottom: 8 }}>
          &gt; ERROR: {closePositionMutation.error?.message || closeAllMutation.error?.message}
        </p>
      )}

      {/* Close All Confirmation Modal */}
      {confirmCloseAll && (
        <ConfirmModal
          title="CLOSE ALL POSITIONS"
          message={`This will close ${positions.length} position${positions.length !== 1 ? 's' : ''} at market. This action cannot be undone.`}
          onConfirm={() => closeAllMutation.mutate()}
          onCancel={() => setConfirmCloseAll(false)}
          isPending={closeAllMutation.isPending}
          danger
        />
      )}

      {/* Close Single Confirmation Modal */}
      {confirmClose && (
        <ConfirmModal
          title="CLOSE POSITION"
          message={`Close ${positions.find(p => p.id === confirmClose)?.symbol} ${positions.find(p => p.id === confirmClose)?.strategy} at market?`}
          onConfirm={() => closePositionMutation.mutate(confirmClose)}
          onCancel={() => setConfirmClose(null)}
          isPending={closePositionMutation.isPending}
        />
      )}

      {/* Position Cards */}
      {positions.map(pos => (
        <PositionCard
          key={pos.id}
          position={pos}
          onClose={() => setConfirmClose(pos.id)}
          isClosing={closePositionMutation.isPending && confirmClose === pos.id}
        />
      ))}
    </div>
  );
}

function PositionCard({
  position,
  onClose,
  isClosing,
}: {
  position: Position;
  onClose: () => void;
  isClosing: boolean;
}) {
  const pnl = position.unrealizedPnl ?? 0;
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
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, color: '#888', marginBottom: 8 }}>
        <span>Strikes: {strikes}</span>
        <span>Contracts: {position.contracts}</span>
        <span>Entry: ${(position.entryPremiumTotal ?? 0).toFixed(0)}</span>
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

      {/* Close Button */}
      <button
        onClick={onClose}
        disabled={isClosing}
        style={{
          width: '100%',
          fontSize: 11,
          color: '#f59e0b',
          background: 'none',
          border: '1px solid #333',
          padding: '6px 0',
          cursor: isClosing ? 'wait' : 'pointer',
          fontFamily: 'inherit',
        }}
      >
        {isClosing ? 'CLOSING...' : 'CLOSE POSITION'}
      </button>
    </div>
  );
}

function ConfirmModal({
  title,
  message,
  onConfirm,
  onCancel,
  isPending,
  danger,
}: {
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
  danger?: boolean;
}) {
  return (
    <div
      style={{
        background: '#111',
        border: `1px solid ${danger ? '#ef4444' : '#333'}`,
        padding: 16,
        marginBottom: 12,
      }}
    >
      <p style={{ color: danger ? '#ef4444' : '#f59e0b', marginBottom: 8, fontWeight: 500 }}>
        &gt; {title}
      </p>
      <p style={{ color: '#888', fontSize: 12, marginBottom: 12 }}>{message}</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={onConfirm}
          disabled={isPending}
          style={{
            flex: 1,
            fontSize: 11,
            color: '#000',
            background: danger ? '#ef4444' : '#f59e0b',
            border: 'none',
            padding: '8px 0',
            cursor: isPending ? 'wait' : 'pointer',
            fontFamily: 'inherit',
            fontWeight: 500,
          }}
        >
          {isPending ? 'PROCESSING...' : 'CONFIRM'}
        </button>
        <button
          onClick={onCancel}
          disabled={isPending}
          style={{
            flex: 1,
            fontSize: 11,
            color: '#888',
            background: 'none',
            border: '1px solid #333',
            padding: '8px 0',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          CANCEL
        </button>
      </div>
    </div>
  );
}
