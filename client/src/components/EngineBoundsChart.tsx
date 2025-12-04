/**
 * EngineBoundsChart Component
 *
 * Combines DeterministicChart with engine-driven bounds overlay.
 * Shows PUT/CALL strikes as visual boundaries with win/danger zones.
 * Receives real-time price updates via WebSocket.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { DeterministicChart, type DeterministicChartRef, type MarketStatusInfo, type TimeRange, type BarInterval } from './DeterministicChart';
import { useChartBounds } from '@/hooks/useChartBounds';
import { useWebSocket } from '@/hooks/use-websocket';
import { RefreshCw, TrendingUp, TrendingDown, Target, AlertTriangle, Clock, ChevronDown, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';

// Local Bar type to avoid circular imports
interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

// ============================================
// Types
// ============================================

// Default interval for each range (matching available database data)
const RANGE_DEFAULT_INTERVAL: Record<TimeRange, BarInterval> = {
  '1D': '1m',
  '5D': '5m',
  '1M': '1D',      // Changed from '1h' - database only has daily data for 1M+
  '3M': '1D',
  '6M': '1D',
  'YTD': '1D',
  '1Y': '1D',
  '5Y': '1W',
  'MAX': '1M',
};

// Available intervals for each range (only intervals with actual database data)
const RANGE_AVAILABLE_INTERVALS: Record<TimeRange, BarInterval[]> = {
  '1D': ['1m', '5m', '15m'],
  '5D': ['5m', '15m'],           // Removed '1m', '1h' - not enough data
  '1M': ['1D'],                  // Removed '15m', '1h' - only daily data available
  '3M': ['1D'],                  // Removed '1h' - only daily data available
  '6M': ['1D'],
  'YTD': ['1D'],
  '1Y': ['1D', '1W'],
  '5Y': ['1W', '1M'],
  'MAX': ['1M'],
};

interface EngineBoundsChartProps {
  symbol?: string;
  defaultRange?: TimeRange;
  defaultInterval?: BarInterval;
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
  defaultRange = '1D',
  defaultInterval,
  // Increased default size (was 800x400)
  width: propWidth,
  height = 550,
  className = '',
  onBoundsRefresh,
}: EngineBoundsChartProps) {
  // Range and interval state (Yahoo Finance style)
  const [range, setRange] = useState<TimeRange>(defaultRange);
  const [interval, setInterval] = useState<BarInterval>(
    defaultInterval || RANGE_DEFAULT_INTERVAL[defaultRange]
  );
  const [showIntervalDropdown, setShowIntervalDropdown] = useState(false);
  const [hoveredBar, setHoveredBar] = useState<Bar | null>(null);
  const [currentPrice, setCurrentPrice] = useState<number | undefined>(undefined);
  const [marketStatus, setMarketStatus] = useState<MarketStatusInfo | null>(null);
  // Extended hours toggle (default: show only RTH)
  const [showExtendedHours, setShowExtendedHours] = useState(false);
  // Responsive width state
  const [containerWidth, setContainerWidth] = useState(propWidth || 1200);

  // Ref to the chart for live updates
  const chartRef = useRef<DeterministicChartRef>(null);
  // Ref to container for resize observer
  const containerRef = useRef<HTMLDivElement>(null);

  // ResizeObserver for responsive width
  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) {
        // Use contentRect width, with minimum of 600px
        const newWidth = Math.max(600, entry.contentRect.width - 32); // 32px for padding
        setContainerWidth(newWidth);
      }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Use prop width if provided, otherwise use responsive width
  const effectiveWidth = propWidth || containerWidth;

  // Update interval when range changes (to valid default for that range)
  useEffect(() => {
    const availableIntervals = RANGE_AVAILABLE_INTERVALS[range];
    if (!availableIntervals.includes(interval)) {
      setInterval(RANGE_DEFAULT_INTERVAL[range]);
    }
  }, [range, interval]);

  // Poll market status from chart ref
  useEffect(() => {
    const pollInterval = globalThis.setInterval(() => {
      const status = chartRef.current?.getMarketStatus();
      if (status) {
        setMarketStatus(status);
      }
    }, 1000);
    return () => globalThis.clearInterval(pollInterval);
  }, []);

  // Fetch engine-selected bounds
  const { bounds, loading: boundsLoading, error: boundsError, refresh: refreshBounds } = useChartBounds(symbol);

  // WebSocket for real-time price updates
  const { isConnected, onChartPriceUpdate } = useWebSocket();

  // Subscribe to chart price updates
  useEffect(() => {
    const unsubscribe = onChartPriceUpdate((price, sym, timestamp) => {
      if (sym === symbol && price > 0) {
        setCurrentPrice(price);
        // Update the chart's candlestick in real-time
        chartRef.current?.updateWithTick(price, timestamp);
      }
    });
    return unsubscribe;
  }, [symbol, onChartPriceUpdate]);

  // Handle bar hover
  const handleBarHover = useCallback((bar: Bar | null, price: number) => {
    setHoveredBar(bar);
  }, []);

  // Zoom control handlers
  const handleZoomIn = useCallback(() => {
    chartRef.current?.zoomIn();
  }, []);

  const handleZoomOut = useCallback(() => {
    chartRef.current?.zoomOut();
  }, []);

  const handleResetZoom = useCallback(() => {
    chartRef.current?.resetZoom();
  }, []);

  // Refresh bounds and notify parent
  const handleRefreshBounds = useCallback(async () => {
    await refreshBounds();
    onBoundsRefresh?.();
  }, [refreshBounds, onBoundsRefresh]);

  // Range options (Yahoo Finance style)
  const ranges: { value: TimeRange; label: string }[] = [
    { value: '1D', label: '1D' },
    { value: '5D', label: '5D' },
    { value: '1M', label: '1M' },
    { value: '3M', label: '3M' },
    { value: '6M', label: '6M' },
    { value: 'YTD', label: 'YTD' },
    { value: '1Y', label: '1Y' },
    { value: '5Y', label: '5Y' },
    { value: 'MAX', label: 'MAX' },
  ];

  // Get available intervals for current range
  const availableIntervals = RANGE_AVAILABLE_INTERVALS[range];

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
    <div ref={containerRef} className={`bg-charcoal rounded-2xl border border-white/10 shadow-lg overflow-hidden ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-4">
          <h3 className="font-semibold">{symbol} Chart</h3>

          {/* Range selector (Yahoo Finance style) */}
          <div className="flex gap-1">
            {ranges.map(r => (
              <button
                key={r.value}
                onClick={() => setRange(r.value)}
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  range === r.value
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>

          {/* Interval dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowIntervalDropdown(!showIntervalDropdown)}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-gray-800 text-gray-300 rounded hover:bg-gray-700 transition-colors"
            >
              {interval}
              <ChevronDown className="w-3 h-3" />
            </button>
            {showIntervalDropdown && (
              <div className="absolute top-full left-0 mt-1 bg-gray-800 rounded shadow-lg border border-white/10 z-50">
                {availableIntervals.map(iv => (
                  <button
                    key={iv}
                    onClick={() => {
                      setInterval(iv);
                      setShowIntervalDropdown(false);
                    }}
                    className={`block w-full px-3 py-1.5 text-xs text-left hover:bg-gray-700 transition-colors ${
                      interval === iv ? 'bg-blue-600 text-white' : 'text-gray-300'
                    }`}
                  >
                    {iv}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* WebSocket status */}
          <div className={`flex items-center gap-1 text-xs ${isConnected ? 'text-green-500' : 'text-gray-500'}`}>
            <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-gray-500'}`} />
            {isConnected ? 'Live' : 'Offline'}
          </div>

          {/* Market Status */}
          {marketStatus && (
            <div className={`flex items-center gap-1 text-xs ${
              marketStatus.status === 'open' ? 'text-green-500' :
              marketStatus.status === 'pre-market' ? 'text-amber-500' :
              marketStatus.status === 'after-hours' ? 'text-blue-500' :
              'text-gray-500'
            }`}>
              <Clock className="w-3 h-3" />
              {marketStatus.status === 'pre-market' && 'Pre-Market'}
              {marketStatus.status === 'open' && 'Market Open'}
              {marketStatus.status === 'after-hours' && 'After Hours'}
              {marketStatus.status === 'closed' && 'Closed'}
              <span className="text-gray-500 text-[10px]">
                (→ {marketStatus.nextChange})
              </span>
            </div>
          )}

          {/* Extended Hours Toggle */}
          <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showExtendedHours}
              onChange={(e) => setShowExtendedHours(e.target.checked)}
              className="w-3 h-3 rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
            />
            <span className={showExtendedHours ? 'text-blue-400' : 'text-gray-500'}>
              Extended Hours
            </span>
          </label>
        </div>

        {/* Right side controls */}
        <div className="flex items-center gap-3">
          {/* Zoom controls */}
          <div className="flex items-center gap-1 border-r border-white/10 pr-3">
            <button
              onClick={handleZoomIn}
              className="flex items-center justify-center w-7 h-7 bg-gray-800 text-gray-400 rounded hover:bg-gray-700 hover:text-white transition"
              title="Zoom in (pinch outward on trackpad)"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              onClick={handleZoomOut}
              className="flex items-center justify-center w-7 h-7 bg-gray-800 text-gray-400 rounded hover:bg-gray-700 hover:text-white transition"
              title="Zoom out (pinch inward on trackpad)"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <button
              onClick={handleResetZoom}
              className="flex items-center justify-center w-7 h-7 bg-gray-800 text-gray-400 rounded hover:bg-gray-700 hover:text-white transition"
              title="Reset zoom and pan"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>

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

      {/* Bounds Error - Hidden for now, focusing on chart correctness */}
      {/* {boundsError && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border-b border-red-500/20 text-xs text-red-400">
          <AlertTriangle className="w-4 h-4" />
          {boundsError}
        </div>
      )} */}

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
        ref={chartRef}
        symbol={symbol}
        range={range}
        interval={interval}
        width={effectiveWidth}
        height={height}
        onBarHover={handleBarHover}
        putStrike={putStrike}
        callStrike={callStrike}
        showExtendedHours={showExtendedHours}
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
