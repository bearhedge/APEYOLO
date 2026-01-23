/**
 * PositionsWindow - Current State Display
 *
 * Shows:
 * - Account summary: NAV, Buying Power, Cash
 * - Position Greeks per leg: Delta, Theta, DTE
 * - System constraints: Max Loss 2% NAV
 * - Margin indicator with status
 * - Exercise risk flag when ITM
 * - Open positions with stop loss levels
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';

// IBKR Position from broker
interface IBKRPosition {
  contract: {
    symbol: string;
    secType: string;
    strike?: number;
    right?: 'PUT' | 'CALL';
    expiry?: string;
    conId?: string;
  };
  quantity: number;
  averageCost: number;
  marketValue: number;
  unrealizedPnL?: number;
}

// Account data
interface AccountData {
  nav?: number;
  netLiquidation?: number;
  buyingPower?: number;
  availableFunds?: number;
  maintenanceMargin?: number;
  initialMargin?: number;
  excessLiquidity?: number;
  portfolioValue?: number;
}

// Trade position from database (for Greeks and stop loss)
interface TradePosition {
  id: string;
  symbol: string;
  strategy: string;
  leg1Type: string;
  leg1Strike: number;
  leg1Delta?: number;
  leg1Premium?: number;
  leg2Type?: string;
  leg2Strike?: number;
  leg2Delta?: number;
  leg2Premium?: number;
  contracts: number;
  entryPremiumTotal: number;
  stopLossPrice?: number;
  stopLossMultiplier?: number;
  expiration?: string;
  status: string;
}

// Grouped position for display
interface GroupedPosition {
  id: string;
  symbol: string;
  strategy: string;
  legs: PositionLeg[];
  totalDelta: number;
  totalTheta: number;
  unrealizedPnl: number;
  expiry: string | null;
  daysToExpiry: number | null;
  stopLossPrice: number | null;
  exerciseRisk: boolean;
  exerciseRiskLeg: string | null;
}

interface PositionLeg {
  type: 'PUT' | 'CALL';
  strike: number;
  delta: number;
  theta: number;
  quantity: number;
  unrealizedPnl: number;
  isITM: boolean;
}

export function PositionsWindow() {
  const [confirmClose, setConfirmClose] = useState<string | null>(null);
  const [confirmCloseAll, setConfirmCloseAll] = useState(false);
  const queryClient = useQueryClient();

  // Fetch IBKR positions
  const { data: ibkrPositions, isLoading: posLoading, error: posError } = useQuery<IBKRPosition[]>({
    queryKey: ['positions'],
    queryFn: async () => {
      const res = await fetch('/api/positions', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch positions');
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
    refetchInterval: 5000,
  });

  // Fetch open trades from database (for Greeks and stop loss)
  const { data: openTrades } = useQuery<{ trades: TradePosition[] }>({
    queryKey: ['open-trades'],
    queryFn: async () => {
      const res = await fetch('/api/defi/trades?limit=10', { credentials: 'include' });
      if (!res.ok) return { trades: [] };
      const data = await res.json();
      // Filter to only open trades
      return {
        trades: (data.trades || []).filter((t: TradePosition) => t.status === 'open')
      };
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

  // Fetch current SPY price for ITM detection
  const { data: marketData } = useQuery<{ price?: number }>({
    queryKey: ['spy-price'],
    queryFn: async () => {
      const res = await fetch('/api/market/spy', { credentials: 'include' });
      if (!res.ok) return { price: undefined };
      return res.json();
    },
    refetchInterval: 5000,
  });

  const isLoading = posLoading;
  const error = posError;

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
      queryClient.invalidateQueries({ queryKey: ['open-trades'] });
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
      queryClient.invalidateQueries({ queryKey: ['open-trades'] });
      setConfirmCloseAll(false);
    },
  });

  if (isLoading) {
    return <p style={{ color: '#666' }}>&gt; Loading positions...</p>;
  }

  if (error) {
    return <p style={{ color: '#ef4444' }}>&gt; ERROR: Failed to load positions</p>;
  }

  // Filter to option positions only
  const optionPositions = (ibkrPositions || []).filter(p => p.contract?.secType === 'OPT');

  // Group positions into strategies and calculate metrics
  const groupedPositions = groupPositions(
    optionPositions,
    openTrades?.trades || [],
    marketData?.price
  );

  // Calculate margin usage
  const nav = account?.netLiquidation || account?.nav || 0;
  const marginUsed = account?.maintenanceMargin || account?.initialMargin || 0;
  const marginPercent = nav > 0 ? (marginUsed / nav) * 100 : 0;
  const marginStatus: 'OK' | 'HIGH' | 'CRITICAL' = marginPercent < 30 ? 'OK' : marginPercent < 50 ? 'HIGH' : 'CRITICAL';

  // Max loss constraint (2% NAV)
  const maxLossAllowed = nav * 0.02;

  // Check for any exercise risk
  const hasExerciseRisk = groupedPositions.some(p => p.exerciseRisk);

  return (
    <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>
      {/* Account Summary */}
      {account && (
        <div style={{ marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid #333' }}>
          <div style={{ display: 'flex', gap: 16, marginBottom: 6 }}>
            <span>NAV: <span style={{ color: '#4ade80' }}>${nav.toLocaleString()}</span></span>
            <span>BP: <span style={{ color: '#fff' }}>${(account.buyingPower || 0).toLocaleString()}</span></span>
            <span>Cash: <span style={{ color: '#fff' }}>${(account.availableFunds || 0).toLocaleString()}</span></span>
          </div>

          {/* System Constraints */}
          <div style={{ display: 'flex', gap: 16, color: '#666', fontSize: 10 }}>
            <span>Max Loss: <span style={{ color: '#f59e0b' }}>${maxLossAllowed.toFixed(0)}</span> (2% NAV)</span>
            <span>
              Margin: <span style={{ color: marginStatus === 'OK' ? '#4ade80' : marginStatus === 'HIGH' ? '#f59e0b' : '#ef4444' }}>
                {marginPercent.toFixed(0)}%
              </span>
              {' '}
              <span style={{
                background: marginStatus === 'OK' ? '#1a3d1a' : marginStatus === 'HIGH' ? '#3d3d1a' : '#3d1a1a',
                color: marginStatus === 'OK' ? '#4ade80' : marginStatus === 'HIGH' ? '#f59e0b' : '#ef4444',
                padding: '1px 4px',
                fontSize: 9,
              }}>
                {marginStatus}
              </span>
            </span>
          </div>
        </div>
      )}

      {/* Exercise Risk Alert */}
      {hasExerciseRisk && (
        <div style={{
          background: '#3d1a1a',
          border: '1px solid #ef4444',
          padding: 8,
          marginBottom: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <AlertTriangle style={{ width: 14, height: 14, color: '#ef4444' }} />
          <span style={{ color: '#ef4444', fontSize: 10 }}>
            EXERCISE RISK: One or more legs are ITM
          </span>
        </div>
      )}

      {/* No Positions State */}
      {groupedPositions.length === 0 && (
        <div>
          <p>&gt; NO OPEN POSITIONS</p>
          <p style={{ marginTop: 8, color: '#666' }}>&gt; Use engine.exe to enter trades.</p>
        </div>
      )}

      {/* Header with Close All */}
      {groupedPositions.length > 0 && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <p style={{ color: '#4ade80', margin: 0, fontSize: 10 }}>
              &gt; {groupedPositions.length} OPEN POSITION{groupedPositions.length !== 1 ? 'S' : ''}
            </p>
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
              message={`This will close ${groupedPositions.length} position${groupedPositions.length !== 1 ? 's' : ''} at market.`}
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

          {/* Position Cards */}
          <div style={{ maxHeight: 280, overflow: 'auto' }}>
            {groupedPositions.map(pos => (
              <PositionCard
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

// Group IBKR positions with trade data
function groupPositions(
  ibkrPositions: IBKRPosition[],
  trades: TradePosition[],
  spyPrice?: number
): GroupedPosition[] {
  // For now, display each IBKR position as a leg
  // Group by symbol and expiry
  const groups = new Map<string, GroupedPosition>();

  for (const pos of ibkrPositions) {
    const { contract, quantity, unrealizedPnL } = pos;
    if (!contract.strike || !contract.right) continue;

    const expiry = contract.expiry || '';
    const groupKey = `${contract.symbol}-${expiry}`;

    // Check if ITM
    const isITM = spyPrice
      ? (contract.right === 'PUT' && spyPrice < contract.strike) ||
        (contract.right === 'CALL' && spyPrice > contract.strike)
      : false;

    // Find matching trade for Greeks
    const matchingTrade = trades.find(t =>
      t.symbol === contract.symbol &&
      ((t.leg1Type === contract.right && t.leg1Strike === contract.strike) ||
       (t.leg2Type === contract.right && t.leg2Strike === contract.strike))
    );

    // Get delta from trade (use leg1 or leg2 depending on match)
    let delta = 0;
    if (matchingTrade) {
      if (matchingTrade.leg1Type === contract.right && matchingTrade.leg1Strike === contract.strike) {
        delta = matchingTrade.leg1Delta || 0;
      } else if (matchingTrade.leg2Type === contract.right && matchingTrade.leg2Strike === contract.strike) {
        delta = matchingTrade.leg2Delta || 0;
      }
    }
    // For short options, delta is negative for puts, positive for calls (from seller's perspective)
    // Convert to percentage format (0.25 = 25 delta)
    const displayDelta = Math.round(Math.abs(delta) * 100) * (contract.right === 'PUT' ? -1 : 1) * (quantity < 0 ? -1 : 1);

    // Estimate theta (roughly $0.02 per day per contract for 0DTE)
    const daysToExpiry = expiry ? Math.max(0, Math.ceil((new Date(expiry.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')).getTime() - Date.now()) / (1000 * 60 * 60 * 24))) : 0;
    const estimatedTheta = Math.abs(quantity) * 2 * Math.max(0.5, 1 - daysToExpiry * 0.1); // Rough estimate

    const leg: PositionLeg = {
      type: contract.right,
      strike: contract.strike,
      delta: displayDelta,
      theta: estimatedTheta,
      quantity: Math.abs(quantity),
      unrealizedPnl: unrealizedPnL || 0,
      isITM,
    };

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        id: contract.conId || groupKey,
        symbol: contract.symbol,
        strategy: 'Unknown',
        legs: [],
        totalDelta: 0,
        totalTheta: 0,
        unrealizedPnl: 0,
        expiry,
        daysToExpiry,
        stopLossPrice: matchingTrade?.stopLossPrice || null,
        exerciseRisk: false,
        exerciseRiskLeg: null,
      });
    }

    const group = groups.get(groupKey)!;
    group.legs.push(leg);
    group.totalDelta += displayDelta;
    group.totalTheta += estimatedTheta;
    group.unrealizedPnl += unrealizedPnL || 0;
    if (isITM) {
      group.exerciseRisk = true;
      group.exerciseRiskLeg = `${contract.strike}${contract.right === 'PUT' ? 'P' : 'C'}`;
    }
  }

  // Determine strategy names
  for (const group of groups.values()) {
    const hasPut = group.legs.some(l => l.type === 'PUT');
    const hasCall = group.legs.some(l => l.type === 'CALL');
    if (hasPut && hasCall) {
      group.strategy = 'Strangle';
    } else if (hasPut) {
      group.strategy = 'Short Put';
    } else if (hasCall) {
      group.strategy = 'Short Call';
    }
  }

  return Array.from(groups.values());
}

function PositionCard({
  position,
  onClose,
  isClosing,
}: {
  position: GroupedPosition;
  onClose: () => void;
  isClosing: boolean;
}) {
  const pnl = position.unrealizedPnl;
  const pnlColor = pnl >= 0 ? '#4ade80' : '#ef4444';
  const pnlSign = pnl >= 0 ? '+' : '';

  return (
    <div
      style={{
        background: position.exerciseRisk ? '#1a0a0a' : '#111',
        border: `1px solid ${position.exerciseRisk ? '#ef4444' : '#222'}`,
        padding: 10,
        marginBottom: 6,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#fff', fontWeight: 500, fontSize: 11 }}>
            {position.symbol} {position.strategy}
          </span>
          {position.daysToExpiry !== null && (
            <span style={{
              background: position.daysToExpiry <= 1 ? '#3d1a1a' : '#222',
              color: position.daysToExpiry <= 1 ? '#ef4444' : '#888',
              padding: '1px 4px',
              fontSize: 9,
            }}>
              {position.daysToExpiry === 0 ? '0DTE' : `${position.daysToExpiry}DTE`}
            </span>
          )}
          {position.exerciseRisk && (
            <span style={{
              background: '#3d1a1a',
              color: '#ef4444',
              padding: '1px 4px',
              fontSize: 9,
            }}>
              ITM
            </span>
          )}
        </div>
        <span style={{ color: pnlColor, fontSize: 11 }}>
          {pnlSign}${pnl.toFixed(0)}
        </span>
      </div>

      {/* Per-Leg Greeks */}
      <div style={{ marginBottom: 8 }}>
        {position.legs.map((leg, i) => (
          <div
            key={i}
            style={{
              display: 'grid',
              gridTemplateColumns: '70px 50px 60px',
              gap: 8,
              padding: '3px 0',
              fontSize: 10,
              color: leg.isITM ? '#ef4444' : '#888',
              borderBottom: i < position.legs.length - 1 ? '1px solid #1a1a1a' : 'none',
            }}
          >
            <span>
              {leg.type} {leg.strike}
              {leg.isITM && <span style={{ color: '#ef4444', marginLeft: 4 }}>*</span>}
            </span>
            <span>Δ {leg.delta > 0 ? '+' : ''}{leg.delta}</span>
            <span>θ ${leg.theta.toFixed(0)}/day</span>
          </div>
        ))}
        {/* Net Greeks */}
        {position.legs.length > 1 && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '70px 50px 60px',
              gap: 8,
              padding: '4px 0 0 0',
              fontSize: 10,
              color: '#fff',
              fontWeight: 500,
              borderTop: '1px solid #333',
              marginTop: 4,
            }}
          >
            <span>NET</span>
            <span>Δ {position.totalDelta > 0 ? '+' : ''}{position.totalDelta}</span>
            <span>θ ${position.totalTheta.toFixed(0)}/day</span>
          </div>
        )}
      </div>

      {/* Stop Loss */}
      {position.stopLossPrice && (
        <div style={{ fontSize: 9, color: '#666', marginBottom: 6 }}>
          Stop: ${position.stopLossPrice.toFixed(2)}
        </div>
      )}

      {/* Close Button */}
      <button
        onClick={onClose}
        disabled={isClosing}
        style={{
          width: '100%',
          fontSize: 10,
          color: '#f59e0b',
          background: 'none',
          border: '1px solid #333',
          padding: '4px 0',
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
