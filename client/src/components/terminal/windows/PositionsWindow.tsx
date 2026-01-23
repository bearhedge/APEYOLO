/**
 * PositionsWindow - Current State Display
 *
 * Shows account summary and open positions from IBKR.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// Position from IBKR API (flat structure)
interface Position {
  id: string;
  symbol: string;
  assetType: 'stock' | 'option';
  side: 'SELL' | 'BUY';
  qty: number;
  avg: number;
  mark: number;
  upl: number;
  iv: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  margin: number;
  openedAt: string;
  status: string;
}

// Account data
interface AccountData {
  nav?: number;
  netLiquidation?: number;
  buyingPower?: number;
  availableFunds?: number;
  totalCash?: number;
  maintenanceMargin?: number;
  initialMargin?: number;
  excessLiquidity?: number;
  portfolioValue?: number;
}

export function PositionsWindow() {
  const [confirmClose, setConfirmClose] = useState<string | null>(null);
  const [confirmCloseAll, setConfirmCloseAll] = useState(false);
  const queryClient = useQueryClient();

  // Fetch IBKR positions
  const { data: positions, isLoading, error } = useQuery<Position[]>({
    queryKey: ['positions'],
    queryFn: async () => {
      const res = await fetch('/api/positions', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch positions');
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
    refetchInterval: 5000,
  });

  // Fetch account data
  const { data: account } = useQuery<AccountData>({
    queryKey: ['/api/account'],
    queryFn: async () => {
      const res = await fetch('/api/account', { credentials: 'include' });
      if (!res.ok) return null;
      return res.json();
    },
    refetchInterval: 10000,
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

  // Separate options and stocks
  const optionPositions = (positions || []).filter(p => p.assetType === 'option');
  const stockPositions = (positions || []).filter(p => p.assetType === 'stock');
  const allPositions = positions || [];

  // Calculate totals
  const totalUnrealizedPnl = allPositions.reduce((sum, p) => sum + (p.upl || 0), 0);
  const nav = account?.netLiquidation || account?.nav || 0;
  const cash = account?.totalCash || account?.availableFunds || 0;
  const buyingPower = account?.buyingPower || 0;

  return (
    <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>
      {/* Account Summary */}
      {account && (
        <div style={{ marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid #333' }}>
          <div style={{ display: 'flex', gap: 16 }}>
            <span>NAV: <span style={{ color: '#4ade80' }}>${nav.toLocaleString()}</span></span>
            <span>BP: <span style={{ color: '#fff' }}>${buyingPower.toLocaleString()}</span></span>
            <span>Cash: <span style={{ color: '#fff' }}>${cash.toLocaleString()}</span></span>
          </div>
        </div>
      )}

      {/* No Positions State */}
      {allPositions.length === 0 && (
        <div>
          <p>&gt; NO OPEN POSITIONS</p>
          <p style={{ marginTop: 8, color: '#666' }}>&gt; Use engine.exe to enter trades.</p>
        </div>
      )}

      {/* Header with Close All */}
      {allPositions.length > 0 && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div>
              <span style={{ color: '#4ade80', fontSize: 10 }}>
                &gt; {allPositions.length} POSITION{allPositions.length !== 1 ? 'S' : ''}
              </span>
              <span style={{ color: '#666', fontSize: 10, marginLeft: 12 }}>
                P&L: <span style={{ color: totalUnrealizedPnl >= 0 ? '#4ade80' : '#ef4444' }}>
                  {totalUnrealizedPnl >= 0 ? '+' : ''}${totalUnrealizedPnl.toFixed(0)}
                </span>
              </span>
            </div>
            <button
              onClick={() => setConfirmCloseAll(true)}
              disabled={closeAllMutation.isPending}
              style={{
                fontSize: 10,
                color: '#ef4444',
                background: 'none',
                border: '1px solid #ef4444',
                padding: '3px 6px',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {closeAllMutation.isPending ? 'CLOSING...' : 'CLOSE ALL'}
            </button>
          </div>

          {/* Error display */}
          {(closePositionMutation.isError || closeAllMutation.isError) && (
            <p style={{ color: '#ef4444', fontSize: 10, marginBottom: 8 }}>
              &gt; ERROR: {closePositionMutation.error?.message || closeAllMutation.error?.message}
            </p>
          )}

          {/* Close All Confirmation Modal */}
          {confirmCloseAll && (
            <ConfirmModal
              title="CLOSE ALL POSITIONS"
              message={`This will close ${allPositions.length} position${allPositions.length !== 1 ? 's' : ''} at market.`}
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
              message={`Close position at market?`}
              onConfirm={() => closePositionMutation.mutate(confirmClose)}
              onCancel={() => setConfirmClose(null)}
              isPending={closePositionMutation.isPending}
            />
          )}

          {/* Position List */}
          <div style={{ maxHeight: 280, overflow: 'auto' }}>
            {optionPositions.map(pos => (
              <PositionRow
                key={pos.id}
                position={pos}
                onClose={() => setConfirmClose(pos.id)}
                isClosing={closePositionMutation.isPending && confirmClose === pos.id}
              />
            ))}
            {stockPositions.map(pos => (
              <PositionRow
                key={pos.id}
                position={pos}
                onClose={() => setConfirmClose(pos.id)}
                isClosing={closePositionMutation.isPending && confirmClose === pos.id}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Parse OCC option symbol: "SPY   251212P00600000" -> { underlying: "SPY", expiry: "251212", type: "P", strike: 600 }
function parseOccSymbol(symbol: string): { underlying: string; expiry: string; type: string; strike: number } | null {
  // OCC format: 6-char underlying + 6-char date (YYMMDD) + 1-char type (P/C) + 8-char strike (x1000)
  const match = symbol.match(/^([A-Z]+)\s*(\d{6})([PC])(\d{8})$/);
  if (!match) return null;
  return {
    underlying: match[1].trim(),
    expiry: match[2],
    type: match[3],
    strike: parseInt(match[4]) / 1000,
  };
}

// Format display symbol from position
function formatPositionSymbol(pos: Position): string {
  if (pos.assetType === 'stock') {
    return pos.symbol;
  }

  // Try to parse OCC symbol
  const parsed = parseOccSymbol(pos.symbol);
  if (parsed) {
    // Format: SPY 600P 12/12
    const month = parsed.expiry.slice(2, 4);
    const day = parsed.expiry.slice(4, 6);
    return `${parsed.underlying} ${parsed.strike}${parsed.type} ${month}/${day}`;
  }

  // Fallback: use as-is but truncate if too long
  return pos.symbol.length > 20 ? pos.symbol.slice(0, 20) + '...' : pos.symbol;
}

function PositionRow({
  position,
  onClose,
  isClosing,
}: {
  position: Position;
  onClose: () => void;
  isClosing: boolean;
}) {
  const pnl = position.upl || 0;
  const pnlColor = pnl >= 0 ? '#4ade80' : '#ef4444';
  const pnlSign = pnl >= 0 ? '+' : '';
  const isShort = position.side === 'SELL';
  const displaySymbol = formatPositionSymbol(position);

  // Format delta (already in decimal form from API)
  const delta = position.delta || 0;
  const displayDelta = Math.round(Math.abs(delta) * 100);

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '6px 0',
        borderBottom: '1px solid #222',
        fontSize: 11,
      }}
    >
      <div style={{ flex: 1 }}>
        <span style={{ color: isShort ? '#f59e0b' : '#3b82f6', marginRight: 6, fontSize: 9 }}>
          {isShort ? 'SHORT' : 'LONG'}
        </span>
        <span style={{ color: '#fff' }}>{displaySymbol}</span>
        <span style={{ color: '#666', marginLeft: 8 }}>x{position.qty}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* Greeks for options */}
        {position.assetType === 'option' && displayDelta > 0 && (
          <span style={{ color: '#666', fontSize: 10 }}>Δ{displayDelta}</span>
        )}

        {/* P&L */}
        <span style={{ color: pnlColor, minWidth: 60, textAlign: 'right' }}>
          {pnlSign}${pnl.toFixed(0)}
        </span>

        {/* Close button */}
        <button
          onClick={onClose}
          disabled={isClosing}
          style={{
            fontSize: 9,
            color: '#888',
            background: 'none',
            border: '1px solid #333',
            padding: '2px 6px',
            cursor: isClosing ? 'wait' : 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {isClosing ? '...' : 'X'}
        </button>
      </div>
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
