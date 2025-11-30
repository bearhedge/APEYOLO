/**
 * Deterministic Chart Component
 *
 * React wrapper for the DeterministicChartEngine.
 * Handles:
 * - Data fetching from IBKR historical API
 * - Mouse interaction (crosshair, zoom, pan)
 * - Timeframe selection
 * - Responsive sizing
 */

import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import {
  DeterministicChartEngine,
  calculateViewport,
  DEFAULT_CONFIG,
  type Bar,
  type ChartConfig,
  type Viewport,
} from '../engine/ChartEngine';

// ============================================
// Types
// ============================================

type Timeframe = '1m' | '5m' | '15m' | '1h' | '1D';

interface DeterministicChartProps {
  symbol: string;
  timeframe?: Timeframe;
  width?: number;
  height?: number;
  config?: Partial<ChartConfig>;
  onBarHover?: (bar: Bar | null, price: number) => void;
  className?: string;
}

interface ChartState {
  bars: Bar[];
  loading: boolean;
  error: string | null;
  lastUpdate: number;
}

// ============================================
// Data Fetching
// ============================================

async function fetchChartData(
  symbol: string,
  timeframe: Timeframe,
  count: number = 200
): Promise<Bar[]> {
  const response = await fetch(
    `/api/chart/history/${symbol}?timeframe=${timeframe}&count=${count}`
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || error.message || `HTTP ${response.status}`);
  }

  const data = await response.json();
  return data.bars || [];
}

// ============================================
// Component
// ============================================

export function DeterministicChart({
  symbol,
  timeframe = '5m',
  width = 800,
  height = 400,
  config = {},
  onBarHover,
  className = '',
}: DeterministicChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<DeterministicChartEngine | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [state, setState] = useState<ChartState>({
    bars: [],
    loading: true,
    error: null,
    lastUpdate: 0,
  });

  const [viewport, setViewport] = useState<Viewport>({ startIndex: 0, endIndex: 0 });
  const [crosshair, setCrosshair] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; offset: number } | null>(null);
  const [viewOffset, setViewOffset] = useState(0);

  // Merged config
  const mergedConfig = useMemo(() => ({
    ...DEFAULT_CONFIG,
    width,
    height,
    ...config,
  }), [width, height, config]);

  // Calculate visible bars based on config
  const visibleBars = useMemo(() => {
    const chartWidth = mergedConfig.width - mergedConfig.paddingLeft - mergedConfig.paddingRight;
    const candleTotal = mergedConfig.candleWidth + mergedConfig.candleSpacing;
    return Math.floor(chartWidth / candleTotal);
  }, [mergedConfig]);

  // Initialize engine
  useEffect(() => {
    if (!canvasRef.current) return;

    engineRef.current = new DeterministicChartEngine(canvasRef.current, mergedConfig);

    return () => {
      engineRef.current = null;
    };
  }, []);

  // Update engine config
  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.updateConfig(mergedConfig);
    }
  }, [mergedConfig]);

  // Fetch data
  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setState(prev => ({ ...prev, loading: true, error: null }));

      try {
        const bars = await fetchChartData(symbol, timeframe);
        if (cancelled) return;

        setState({
          bars,
          loading: false,
          error: null,
          lastUpdate: Date.now(),
        });

        // Reset viewport to show most recent bars
        setViewOffset(0);
      } catch (err: any) {
        if (cancelled) return;
        setState(prev => ({
          ...prev,
          loading: false,
          error: err.message || 'Failed to load chart data',
        }));
      }
    }

    loadData();

    return () => {
      cancelled = true;
    };
  }, [symbol, timeframe]);

  // Update viewport when bars or offset changes
  useEffect(() => {
    if (state.bars.length > 0) {
      const newViewport = calculateViewport(state.bars.length, visibleBars, viewOffset);
      setViewport(newViewport);
    }
  }, [state.bars.length, visibleBars, viewOffset]);

  // Render chart
  useEffect(() => {
    if (!engineRef.current || state.bars.length === 0) return;

    engineRef.current.render({
      bars: state.bars,
      config: mergedConfig,
      viewport,
      crosshair,
    }).catch(console.error);
  }, [state.bars, mergedConfig, viewport, crosshair]);

  // Mouse handlers
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (isDragging && dragStart) {
      // Pan the chart
      const dx = x - dragStart.x;
      const barsToMove = Math.round(dx / (mergedConfig.candleWidth + mergedConfig.candleSpacing));
      const newOffset = Math.max(
        0,
        Math.min(state.bars.length - visibleBars, dragStart.offset - barsToMove)
      );
      setViewOffset(newOffset);
    } else {
      // Update crosshair
      setCrosshair({ x, y });

      // Get bar at position for hover callback
      if (onBarHover && engineRef.current) {
        const bar = engineRef.current.getBarAtPosition(x, y, state.bars, viewport);
        const price = engineRef.current.getPriceAtY(y, state.bars, viewport);
        onBarHover(bar, price);
      }
    }
  }, [isDragging, dragStart, mergedConfig, state.bars, visibleBars, viewport, onBarHover]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    setIsDragging(true);
    setDragStart({ x, offset: viewOffset });
  }, [viewOffset]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setDragStart(null);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setCrosshair(null);
    setIsDragging(false);
    setDragStart(null);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();

    // Zoom in/out by changing visible bars
    const delta = e.deltaY > 0 ? 10 : -10;
    const newOffset = Math.max(
      0,
      Math.min(state.bars.length - visibleBars, viewOffset + delta)
    );
    setViewOffset(newOffset);
  }, [state.bars.length, visibleBars, viewOffset]);

  // Loading state
  if (state.loading) {
    return (
      <div
        className={`flex items-center justify-center bg-[#0a0a0a] ${className}`}
        style={{ width, height }}
      >
        <div className="text-gray-500 text-sm">Loading chart data...</div>
      </div>
    );
  }

  // Error state
  if (state.error) {
    return (
      <div
        className={`flex items-center justify-center bg-[#0a0a0a] ${className}`}
        style={{ width, height }}
      >
        <div className="text-red-500 text-sm text-center px-4">
          <div className="mb-2">Failed to load chart</div>
          <div className="text-xs text-gray-500">{state.error}</div>
        </div>
      </div>
    );
  }

  // No data state
  if (state.bars.length === 0) {
    return (
      <div
        className={`flex items-center justify-center bg-[#0a0a0a] ${className}`}
        style={{ width, height }}
      >
        <div className="text-gray-500 text-sm">No chart data available</div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={className}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onWheel={handleWheel}
        style={{
          cursor: isDragging ? 'grabbing' : 'crosshair',
          display: 'block',
        }}
      />
    </div>
  );
}

// ============================================
// Chart with Controls
// ============================================

interface ChartWithControlsProps {
  symbol: string;
  defaultTimeframe?: Timeframe;
  width?: number;
  height?: number;
  className?: string;
}

export function ChartWithControls({
  symbol,
  defaultTimeframe = '5m',
  width = 800,
  height = 400,
  className = '',
}: ChartWithControlsProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>(defaultTimeframe);
  const [hoveredBar, setHoveredBar] = useState<Bar | null>(null);
  const [hoveredPrice, setHoveredPrice] = useState<number>(0);

  const timeframes: { value: Timeframe; label: string }[] = [
    { value: '1m', label: '1m' },
    { value: '5m', label: '5m' },
    { value: '15m', label: '15m' },
    { value: '1h', label: '1H' },
    { value: '1D', label: '1D' },
  ];

  const handleBarHover = useCallback((bar: Bar | null, price: number) => {
    setHoveredBar(bar);
    setHoveredPrice(price);
  }, []);

  return (
    <div className={className}>
      {/* Timeframe selector */}
      <div className="flex items-center justify-between mb-2">
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

        {/* Hovered bar info */}
        {hoveredBar && (
          <div className="text-xs text-gray-400 flex gap-4">
            <span>O: <span className="text-white">{hoveredBar.open.toFixed(2)}</span></span>
            <span>H: <span className="text-white">{hoveredBar.high.toFixed(2)}</span></span>
            <span>L: <span className="text-white">{hoveredBar.low.toFixed(2)}</span></span>
            <span>C: <span className="text-white">{hoveredBar.close.toFixed(2)}</span></span>
          </div>
        )}
      </div>

      {/* Chart */}
      <DeterministicChart
        symbol={symbol}
        timeframe={timeframe}
        width={width}
        height={height}
        onBarHover={handleBarHover}
      />
    </div>
  );
}

export default DeterministicChart;
