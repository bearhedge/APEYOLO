/**
 * EngineBoundsChart Component
 *
 * Combines DeterministicChart with engine-driven bounds overlay.
 * Shows PUT/CALL strikes as visual boundaries with win/danger zones.
 * Receives real-time price updates via WebSocket.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { DeterministicChart } from './DeterministicChart';
import { useChartBounds } from '@/hooks/useChartBounds';
import { useWebSocket } from '@/hooks/use-websocket';
import { RefreshCw, TrendingUp, TrendingDown, Target, AlertTriangle } from 'lucide-react';
import type { Bar } from '@/engine/ChartEngine';

// ============================================
// Types
// ============================================

type Timeframe = '1m' | '5m' | '15m' | '1h' | '1D';

interface EngineBoundsChartProps {
  symbol?: string;
  defaultTimeframe?: Timeframe;
  width?: number;
  height?: number;
  className?: string;
  onBoundsRefresh?: () => void;
}

// ============================================
// Component
// ============================================

export function EngineBoundsChart({
  symbol = 'SPY',
  defaultTimeframe = '5m',
  width = 800,
  height = 400,
  className = '',
  onBoundsRefresh,
}: EngineBoundsChartProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>(defaultTimeframe);
  const [hoveredBar, setHoveredBar] = useState<Bar | null>(null);
  const [currentPrice, setCurrentPrice] = useState<number | undefined>(undefined);

  // Fetch engine-selected bounds
  const { bounds, loading: boundsLoading, error: boundsError, refresh: refreshBounds } = useChartBounds(symbol);

  // WebSocket for real-time price updates
  const { isConnected, onChartPriceUpdate } = useWebSocket();

  // Subscribe to chart price updates
  useEffect(() => {
    const unsubscribe = onChartPriceUpdate((price, sym, timestamp) => {
      if (sym === symbol && price > 0) {
        setCurrentPrice(price);
      }
    });
    return unsubscribe;
  }, [symbol, onChartPriceUpdate]);

  // Handle bar hover
  const handleBarHover = useCallback((bar: Bar | null, price: number) => {
    setHoveredBar(bar);
  }, []);

  // Refresh bounds and notify parent
  const handleRefreshBounds = useCallback(async () => {
    await refreshBounds();
    onBoundsRefresh?.();
  }, [refreshBounds, onBoundsRefresh]);

  // Timeframe options
  const timeframes: { value: Timeframe; label: string }[] = [
    { value: '1m', label: '1m' },
    { value: '5m', label: '5m' },
    { value: '15m', label: '15m' },
    { value: '1h', label: '1H' },
    { value: '1D', label: '1D' },
  ];

  // Extract bounds values
  const putStrike = bounds?.putStrike?.strike;
  const callStrike = bounds?.callStrike?.strike;
  const winZone = bounds?.winZone;

  // Price position relative to bounds
  const pricePosition = currentPrice && putStrike && callStrike
    ? currentPrice < putStrike
      ? 'danger-low'
      : currentPrice > callStrike
        ? 'danger-high'
        : 'safe'
    : null;

  return (
    <div className={`bg-charcoal rounded-2xl border border-white/10 shadow-lg overflow-hidden ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-4">
          <h3 className="font-semibold">{symbol} Chart</h3>

          {/* Timeframe selector */}
          <div className="flex gap-1">
            {timeframes.map(tf => (
              <button
                key={tf.value}
                onClick={() => setTimeframe(tf.value)}
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  timeframe === tf.value
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                {tf.label}
              </button>
            ))}
          </div>

          {/* WebSocket status */}
          <div className={`flex items-center gap-1 text-xs ${isConnected ? 'text-green-500' : 'text-gray-500'}`}>
            <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-gray-500'}`} />
            {isConnected ? 'Live' : 'Offline'}
          </div>
        </div>

        {/* Right side controls */}
        <div className="flex items-center gap-3">
          {/* Refresh bounds button */}
          <button
            onClick={handleRefreshBounds}
            disabled={boundsLoading}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-gray-800 text-gray-400 rounded hover:bg-gray-700 disabled:opacity-50 transition"
            title="Refresh bounds from engine"
          >
            <RefreshCw className={`w-3 h-3 ${boundsLoading ? 'animate-spin' : ''}`} />
            Bounds
          </button>

          {/* Hovered bar info */}
          {hoveredBar && (
            <div className="text-xs text-gray-400 flex gap-3">
              <span>O: <span className="text-white">{hoveredBar.open.toFixed(2)}</span></span>
              <span>H: <span className="text-white">{hoveredBar.high.toFixed(2)}</span></span>
              <span>L: <span className="text-white">{hoveredBar.low.toFixed(2)}</span></span>
              <span>C: <span className="text-white">{hoveredBar.close.toFixed(2)}</span></span>
            </div>
          )}
        </div>
      </div>

      {/* Bounds Info Bar */}
      {bounds && !boundsError && (
        <div className="flex items-center justify-between px-4 py-2 bg-black/30 border-b border-white/5 text-xs">
          {/* PUT Strike */}
          <div className="flex items-center gap-2">
            <TrendingDown className="w-4 h-4 text-red-500" />
            <span className="text-gray-400">PUT:</span>
            <span className="font-mono text-red-400">
              ${putStrike?.toFixed(0) ?? '—'}
            </span>
            {bounds.putStrike && (
              <span className="text-gray-500">
                Δ{Math.abs(bounds.putStrike.delta).toFixed(2)}
              </span>
            )}
          </div>

          {/* Win Zone */}
          {winZone && (
            <div className="flex items-center gap-2">
              <Target className="w-4 h-4 text-green-500" />
              <span className="text-gray-400">Win Zone:</span>
              <span className="font-mono text-green-400">
                ${winZone.low.toFixed(0)} - ${winZone.high.toFixed(0)}
              </span>
              <span className="text-gray-500">
                (${winZone.width.toFixed(0)} wide)
              </span>
            </div>
          )}

          {/* CALL Strike */}
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-blue-500" />
            <span className="text-gray-400">CALL:</span>
            <span className="font-mono text-blue-400">
              ${callStrike?.toFixed(0) ?? '—'}
            </span>
            {bounds.callStrike && (
              <span className="text-gray-500">
                Δ{Math.abs(bounds.callStrike.delta).toFixed(2)}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Bounds Error */}
      {boundsError && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border-b border-red-500/20 text-xs text-red-400">
          <AlertTriangle className="w-4 h-4" />
          {boundsError}
        </div>
      )}

      {/* Price Position Indicator */}
      {pricePosition && currentPrice && (
        <div className={`flex items-center justify-center gap-2 px-4 py-1 text-xs ${
          pricePosition === 'safe'
            ? 'bg-green-500/10 text-green-400'
            : 'bg-red-500/10 text-red-400'
        }`}>
          {pricePosition === 'safe' ? (
            <>
              <Target className="w-3 h-3" />
              Price ${currentPrice.toFixed(2)} is within win zone
            </>
          ) : pricePosition === 'danger-low' ? (
            <>
              <AlertTriangle className="w-3 h-3" />
              Price ${currentPrice.toFixed(2)} is BELOW PUT strike (danger zone)
            </>
          ) : (
            <>
              <AlertTriangle className="w-3 h-3" />
              Price ${currentPrice.toFixed(2)} is ABOVE CALL strike (danger zone)
            </>
          )}
        </div>
      )}

      {/* Chart */}
      <DeterministicChart
        symbol={symbol}
        timeframe={timeframe}
        width={width}
        height={height}
        onBarHover={handleBarHover}
        putStrike={putStrike}
        callStrike={callStrike}
        currentPrice={currentPrice}
        showZones={true}
      />

      {/* Footer with premium info */}
      {bounds && (
        <div className="flex items-center justify-between px-4 py-2 border-t border-white/10 text-xs text-gray-400">
          <div>
            <span>Expected Premium: </span>
            <span className="text-green-400 font-mono">
              ${bounds.expectedPremium?.toFixed(0) ?? '—'}
            </span>
          </div>
          <div>
            <span>Margin Required: </span>
            <span className="text-amber-400 font-mono">
              ${bounds.marginRequired?.toFixed(0) ?? '—'}
            </span>
          </div>
          <div>
            <span>Expiration: </span>
            <span className="text-white font-mono">
              {bounds.expiration || '0DTE'}
            </span>
          </div>
          <div className="text-gray-500">
            Source: {bounds.source || 'engine'}
          </div>
        </div>
      )}
    </div>
  );
}

export default EngineBoundsChart;
