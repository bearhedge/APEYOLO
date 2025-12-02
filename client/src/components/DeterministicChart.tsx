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

import React, { useRef, useEffect, useState, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react';
import {
  DeterministicChartEngine,
  calculateViewport,
  DEFAULT_CONFIG,
  type Bar,
  type ChartConfig,
  type Viewport,
  type ChartOverlays,
} from '../engine/ChartEngine';

// ============================================
// Types
// ============================================

// Time range for historical data selection (Yahoo Finance style)
export type TimeRange = '1D' | '5D' | '1M' | '3M' | '6M' | 'YTD' | '1Y' | '5Y' | 'MAX';

// Bar interval for candlestick granularity
export type BarInterval = '1m' | '5m' | '15m' | '1h' | '1D' | '1W' | '1M';

// Legacy Timeframe type for backwards compatibility
type Timeframe = BarInterval;

interface DeterministicChartProps {
  symbol: string;
  timeframe?: Timeframe;
  // NEW: Yahoo Finance style range + interval
  range?: TimeRange;
  interval?: BarInterval;
  width?: number;
  height?: number;
  config?: Partial<ChartConfig>;
  onBarHover?: (bar: Bar | null, price: number) => void;
  className?: string;
  // Engine-driven bounds overlay props
  putStrike?: number;
  callStrike?: number;
  currentPrice?: number;
  showZones?: boolean;
  // NEW: Use database-backed endpoint
  useDatabase?: boolean;
}

// Ref interface for external control
export interface DeterministicChartRef {
  updateWithTick: (price: number, timestamp: number) => void;
  getMarketStatus: () => MarketStatusInfo | null;
}

interface ChartState {
  bars: Bar[];
  loading: boolean;
  error: string | null;
  lastUpdate: number;
  marketStatus: MarketStatusInfo | null;
}

// ============================================
// Market Status Types
// ============================================

export type MarketStatus = 'pre-market' | 'open' | 'after-hours' | 'closed';

export interface MarketStatusInfo {
  status: MarketStatus;
  nextChange: string;
  isExtendedHours: boolean;
}

interface ChartDataResponse {
  bars: Bar[];
  marketStatus?: MarketStatusInfo;
}

// ============================================
// Data Fetching
// ============================================

// Default interval for each range (for database-backed queries)
const RANGE_DEFAULT_INTERVAL: Record<TimeRange, BarInterval> = {
  '1D': '1m',
  '5D': '5m',
  '1M': '1h',
  '3M': '1D',
  '6M': '1D',
  'YTD': '1D',
  '1Y': '1D',
  '5Y': '1W',
  'MAX': '1M',
};

// Available intervals for each range
const RANGE_AVAILABLE_INTERVALS: Record<TimeRange, BarInterval[]> = {
  '1D': ['1m', '5m', '15m'],
  '5D': ['1m', '5m', '15m', '1h'],
  '1M': ['15m', '1h', '1D'],
  '3M': ['1h', '1D'],
  '6M': ['1D'],
  'YTD': ['1D'],
  '1Y': ['1D', '1W'],
  '5Y': ['1W', '1M'],
  'MAX': ['1M'],
};

/**
 * Fetch chart data from IBKR API (legacy endpoint)
 */
async function fetchChartDataFromIBKR(
  symbol: string,
  timeframe: Timeframe,
  count: number = 200
): Promise<ChartDataResponse> {
  const response = await fetch(
    `/api/chart/history/${symbol}?timeframe=${timeframe}&count=${count}`
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || error.message || `HTTP ${response.status}`);
  }

  const data = await response.json();
  return {
    bars: data.bars || [],
    marketStatus: data.marketStatus,
  };
}

/**
 * Fetch chart data from Database (new fast endpoint)
 */
async function fetchChartDataFromDB(
  symbol: string,
  range: TimeRange,
  interval: BarInterval
): Promise<ChartDataResponse> {
  const response = await fetch(
    `/api/chart/data/${symbol}?range=${range}&interval=${interval}`
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || error.message || `HTTP ${response.status}`);
  }

  const data = await response.json();
  return {
    bars: data.bars || [],
    marketStatus: data.marketStatus,
  };
}

/**
 * Main fetch function - uses database if enabled, falls back to IBKR
 */
async function fetchChartData(
  symbol: string,
  options: {
    range?: TimeRange;
    interval?: BarInterval;
    timeframe?: Timeframe;
    useDatabase?: boolean;
  }
): Promise<ChartDataResponse> {
  const { range, interval, timeframe, useDatabase = true } = options;

  // If using database-backed endpoint
  if (useDatabase && range) {
    const effectiveInterval = interval || RANGE_DEFAULT_INTERVAL[range];
    try {
      return await fetchChartDataFromDB(symbol, range, effectiveInterval);
    } catch (err) {
      console.warn('[Chart] Database fetch failed, falling back to IBKR:', err);
      // Fall through to IBKR
    }
  }

  // Fall back to IBKR endpoint
  const effectiveTimeframe = interval || timeframe || '5m';
  return fetchChartDataFromIBKR(symbol, effectiveTimeframe);
}

// ============================================
// Helper: Get timeframe interval in seconds
// ============================================

function getTimeframeInterval(timeframe: Timeframe): number {
  switch (timeframe) {
    case '1m': return 60;
    case '5m': return 300;
    case '15m': return 900;
    case '1h': return 3600;
    case '1D': return 86400;
    default: return 300;
  }
}

// ============================================
// Component
// ============================================

export const DeterministicChart = forwardRef<DeterministicChartRef, DeterministicChartProps>(function DeterministicChart({
  symbol,
  timeframe = '5m',
  // NEW: Yahoo Finance style range + interval
  range,
  interval,
  // Increased default size (was 800x400)
  width = 1200,
  height = 550,
  config = {},
  onBarHover,
  className = '',
  // Engine-driven bounds overlay props
  putStrike,
  callStrike,
  currentPrice,
  showZones = true,
  // NEW: Use database-backed endpoint
  useDatabase = true,
}, ref) {
  // Effective interval: prefer interval prop, fall back to range default, then timeframe
  const effectiveInterval = interval || (range ? RANGE_DEFAULT_INTERVAL[range] : timeframe);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<DeterministicChartEngine | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [state, setState] = useState<ChartState>({
    bars: [],
    loading: true,
    error: null,
    lastUpdate: 0,
    marketStatus: null,
  });

  // Expose updateWithTick method via ref
  useImperativeHandle(ref, () => ({
    updateWithTick: (price: number, timestamp: number) => {
      if (price <= 0 || state.bars.length === 0) return;

      const interval = getTimeframeInterval(timeframe);
      const lastBar = state.bars[state.bars.length - 1];

      // Align timestamp to interval boundary
      const tickBarTime = Math.floor(timestamp / 1000 / interval) * interval;
      const lastBarTime = lastBar.time;

      setState(prev => {
        if (prev.bars.length === 0) return prev;

        const newBars = [...prev.bars];
        const lastIdx = newBars.length - 1;

        if (tickBarTime > lastBarTime) {
          // New candle: create a new bar
          newBars.push({
            time: tickBarTime,
            open: price,
            high: price,
            low: price,
            close: price,
            volume: 0,
          });
          // Keep only last 200 bars to prevent memory growth
          if (newBars.length > 200) {
            newBars.shift();
          }
          console.log('[Chart] New candle started:', tickBarTime, 'price:', price);
        } else {
          // Update existing candle
          const bar = newBars[lastIdx];
          newBars[lastIdx] = {
            ...bar,
            close: price,
            high: Math.max(bar.high, price),
            low: Math.min(bar.low, price),
          };
        }

        return {
          ...prev,
          bars: newBars,
          lastUpdate: Date.now(),
        };
      });
    },
    getMarketStatus: () => state.marketStatus,
  }), [state.bars, state.marketStatus, timeframe]);

  const [viewport, setViewport] = useState<Viewport>({ startIndex: 0, endIndex: 0 });
  const [crosshair, setCrosshair] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; offset: number } | null>(null);
  const [viewOffset, setViewOffset] = useState(0);
  const [renderError, setRenderError] = useState<string | null>(null);

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

  // CRITICAL: Clear engine when loading starts (canvas will be unmounted)
  // This ensures a fresh engine is created when the new canvas mounts
  useEffect(() => {
    if (state.loading) {
      console.log('[DeterministicChart] Loading started, clearing engine reference');
      engineRef.current = null;
    }
  }, [state.loading]);

  // Initialize engine - must run AFTER canvas is in DOM (not during loading)
  useEffect(() => {
    if (!canvasRef.current) return;
    if (state.loading) return;  // Don't init while loading (canvas not in DOM)

    // Create engine (engineRef should be null after loading due to effect above)
    if (!engineRef.current) {
      console.log('[DeterministicChart] Initializing engine for new canvas');
      engineRef.current = new DeterministicChartEngine(canvasRef.current, mergedConfig);
    }
    // No cleanup - engine persists until component unmounts
  }, [state.loading]); // Only depend on loading state, not mergedConfig

  // Update engine config when it changes
  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.updateConfig(mergedConfig);
    }
  }, [mergedConfig]);

  // Cleanup on unmount only
  useEffect(() => {
    return () => {
      engineRef.current = null;
    };
  }, []);

  // Fetch data - supports both database-backed (range+interval) and IBKR (timeframe)
  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setState(prev => ({ ...prev, loading: true, error: null }));

      try {
        const { bars, marketStatus } = await fetchChartData(symbol, {
          range,
          interval,
          timeframe,
          useDatabase,
        });
        if (cancelled) return;

        // Debug: Log fetched data
        console.log('[DeterministicChart] Fetched bars:', {
          count: bars.length,
          source: useDatabase && range ? 'database' : 'ibkr',
          range,
          interval: effectiveInterval,
          firstBar: bars[0],
          lastBar: bars[bars.length - 1],
          sampleOHLC: bars[0] ? { o: bars[0].open, h: bars[0].high, l: bars[0].low, c: bars[0].close } : null,
          marketStatus: marketStatus?.status,
        });

        setState({
          bars,
          loading: false,
          error: null,
          lastUpdate: Date.now(),
          marketStatus: marketStatus || null,
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
  }, [symbol, range, interval, timeframe, useDatabase, effectiveInterval]);

  // Update viewport when bars or offset changes
  useEffect(() => {
    if (state.bars.length > 0) {
      const newViewport = calculateViewport(state.bars.length, visibleBars, viewOffset);
      setViewport(newViewport);
    }
  }, [state.bars.length, visibleBars, viewOffset]);

  // Build overlays object for engine-driven bounds
  const overlays: ChartOverlays | undefined = useMemo(() => {
    // Only create overlays if at least one bound is defined
    if (putStrike === undefined && callStrike === undefined && currentPrice === undefined) {
      return undefined;
    }
    return {
      putStrike,
      callStrike,
      currentPrice,
      showZones,
    };
  }, [putStrike, callStrike, currentPrice, showZones]);

  // Render chart
  useEffect(() => {
    if (!engineRef.current || state.bars.length === 0) return;

    // Calculate viewport directly to avoid race condition with state updates
    const currentViewport = calculateViewport(state.bars.length, visibleBars, viewOffset);

    // Validate viewport before rendering
    if (currentViewport.startIndex >= currentViewport.endIndex) {
      console.warn('[Chart] Invalid viewport, skipping render:', currentViewport);
      return;
    }

    console.log('[Chart] Rendering', {
      barsCount: state.bars.length,
      viewport: currentViewport,
      hasOverlays: !!overlays,
    });

    engineRef.current.render({
      bars: state.bars,
      config: mergedConfig,
      viewport: currentViewport,
      crosshair,
      overlays,
      timeframe,
    })
      .then(() => {
        setRenderError(null);
      })
      .catch((err) => {
        console.error('[Chart] Render failed:', err);
        setRenderError(err.message || 'Failed to render chart');
      });
  }, [state.bars, mergedConfig, visibleBars, viewOffset, crosshair, overlays, timeframe]);

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

  // Render error state (show chart with error overlay)
  if (renderError) {
    return (
      <div
        className={`relative bg-[#0a0a0a] ${className}`}
        style={{ width, height }}
      >
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          style={{ display: 'block' }}
        />
        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
          <div className="text-red-500 text-sm text-center px-4">
            <div className="mb-2">Chart render error</div>
            <div className="text-xs text-gray-400">{renderError}</div>
          </div>
        </div>
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
});

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
