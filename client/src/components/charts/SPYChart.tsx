/**
 * SPY Chart Component
 *
 * Large interactive candlestick chart for SPY price analysis
 * Used in Direction step to help determine PUT/CALL direction
 *
 * Features:
 * - Interactive candlesticks with drag-scroll for historical data
 * - Zoom with mouse wheel
 * - Timeframe selector
 * - Current price and change display
 * - Dark theme matching app design
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { createChartProvider, ChartProvider, TimeRange, ChartType, OHLCData } from './ChartProvider';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface SPYData {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  avgVolume: number;
  open: number;
  high: number;
  low: number;
  previousClose: number;
  marketCap?: number;
}

interface SPYHistoryResponse {
  symbol: string;
  range: TimeRange;
  count: number;
  data: Array<{
    timestamp: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
}

interface SPYChartProps {
  /** Chart height in pixels (default: 400 for 4x VIX chart size) */
  height?: number;
  /** Default timeframe */
  defaultTimeframe?: TimeRange;
  /** Chart type - defaults to candlestick */
  chartType?: ChartType;
  /** Show timeframe selector buttons */
  showTimeframeSelector?: boolean;
  /** Show OHLC bar at bottom */
  showOHLC?: boolean;
  /** Show volume */
  showVolume?: boolean;
  /** Additional CSS classes */
  className?: string;
}

// Granular minute timeframes (1m, 5m, 15m, 30m) + standard day/week/month ranges
const timeframeOptions: TimeRange[] = ['1m', '5m', '15m', '30m', '1D', '5D', '1M', '3M', '6M', '1Y', 'MAX'];

export function SPYChart({
  height = 400, // 4x larger than VIX chart (100px)
  defaultTimeframe = '1D',
  chartType = 'candlestick', // Default to candlestick for SPY
  showTimeframeSelector = true,
  showOHLC = true,
  showVolume = false,
  className = '',
}: SPYChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartProviderRef = useRef<ChartProvider | null>(null);

  const [timeframe, setTimeframe] = useState<TimeRange>(defaultTimeframe);
  const [spyData, setSpyData] = useState<SPYData | null>(null);
  const [historyData, setHistoryData] = useState<OHLCData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch current SPY quote
  const fetchSPYData = useCallback(async () => {
    try {
      const response = await fetch('/api/market/quote/SPY');
      if (!response.ok) throw new Error('Failed to fetch SPY data');
      const data = await response.json();
      setSpyData(data);
    } catch (err: any) {
      console.error('[SPYChart] Error fetching SPY data:', err);
    }
  }, []);

  // Fetch historical data for chart
  const fetchHistoryData = useCallback(async (range: TimeRange) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/market/history/SPY?range=${range}`);
      if (!response.ok) throw new Error('Failed to fetch SPY history');
      const data: SPYHistoryResponse = await response.json();

      const ohlcData: OHLCData[] = data.data.map(d => ({
        timestamp: new Date(d.timestamp),
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
        volume: d.volume,
      }));

      setHistoryData(ohlcData);
    } catch (err: any) {
      console.error('[SPYChart] Error fetching history:', err);
      setError(err.message || 'Failed to load chart data');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initialize and update chart
  useEffect(() => {
    if (!containerRef.current || historyData.length === 0) return;

    // Create chart provider if not exists
    if (!chartProviderRef.current) {
      chartProviderRef.current = createChartProvider(containerRef.current);
    }

    chartProviderRef.current.render(historyData, {
      type: chartType,
      height,
      theme: 'dark',
      showGrid: true,
      autoSize: true,
      showVolume,
    });

    return () => {
      // Don't destroy on every render, only on unmount
    };
  }, [historyData, height, chartType, showVolume]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (chartProviderRef.current) {
        chartProviderRef.current.destroy();
        chartProviderRef.current = null;
      }
    };
  }, []);

  // Fetch data on mount and timeframe change
  useEffect(() => {
    fetchSPYData();
    fetchHistoryData(timeframe);
  }, [timeframe, fetchSPYData, fetchHistoryData]);

  // Refresh data periodically (every 30s for price, chart stays)
  useEffect(() => {
    const interval = setInterval(fetchSPYData, 30000);
    return () => clearInterval(interval);
  }, [fetchSPYData]);

  // Handle timeframe change
  const handleTimeframeChange = (newTimeframe: TimeRange) => {
    setTimeframe(newTimeframe);
  };

  // Determine change color and icon
  const isPositive = spyData?.change && spyData.change >= 0;
  const isNegative = spyData?.change && spyData.change < 0;
  const changeColor = isPositive ? 'text-green-400' : isNegative ? 'text-red-400' : 'text-neutral-400';

  return (
    <div className={`bg-neutral-900 rounded-lg overflow-hidden ${className}`}>
      {/* Header: Current value + Timeframe selector */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
        <div className="flex items-center gap-4">
          {/* Symbol and price */}
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-lg font-medium text-neutral-400">SPY</span>
              <span className="text-3xl font-bold text-white">
                ${spyData?.price?.toFixed(2) ?? '--'}
              </span>
            </div>
            {spyData && (
              <div className={`flex items-center gap-1 text-sm ${changeColor}`}>
                {isPositive ? (
                  <TrendingUp className="w-4 h-4" />
                ) : isNegative ? (
                  <TrendingDown className="w-4 h-4" />
                ) : (
                  <Minus className="w-4 h-4" />
                )}
                <span>
                  {isPositive ? '+' : ''}{spyData.change?.toFixed(2)} ({isPositive ? '+' : ''}{spyData.changePercent?.toFixed(2)}%)
                </span>
              </div>
            )}
          </div>

          {/* Quick stats */}
          {spyData && (
            <div className="hidden md:flex gap-4 text-xs text-neutral-400 border-l border-neutral-700 pl-4">
              <span>Vol: {((spyData.volume || 0) / 1000000).toFixed(1)}M</span>
              <span>Avg: {((spyData.avgVolume || 0) / 1000000).toFixed(1)}M</span>
            </div>
          )}
        </div>

        {/* Timeframe selector */}
        {showTimeframeSelector && (
          <div className="flex gap-1">
            {timeframeOptions.map((tf) => (
              <button
                key={tf}
                onClick={() => handleTimeframeChange(tf)}
                className={`px-3 py-1.5 text-sm rounded transition-colors ${
                  timeframe === tf
                    ? 'bg-blue-600 text-white'
                    : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Chart area */}
      <div className="relative" style={{ height: height + 'px' }}>
        {loading && historyData.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center bg-neutral-900/80">
            <div className="flex flex-col items-center gap-2">
              <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <div className="text-neutral-500 text-sm">Loading chart...</div>
            </div>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-red-400 text-sm">{error}</div>
          </div>
        )}
        <div ref={containerRef} className="w-full h-full" />
      </div>

      {/* OHLC Bar */}
      {showOHLC && spyData && (
        <div className="flex items-center justify-between px-4 py-2 border-t border-neutral-800 text-sm">
          <div className="flex gap-6">
            <span className="text-neutral-400">
              Open: <span className="text-neutral-200">${spyData.open?.toFixed(2)}</span>
            </span>
            <span className="text-neutral-400">
              High: <span className="text-green-400">${spyData.high?.toFixed(2)}</span>
            </span>
            <span className="text-neutral-400">
              Low: <span className="text-red-400">${spyData.low?.toFixed(2)}</span>
            </span>
            <span className="text-neutral-400">
              Prev Close: <span className="text-neutral-200">${spyData.previousClose?.toFixed(2)}</span>
            </span>
          </div>
          <div className="text-neutral-500 text-xs">
            Drag to scroll · Scroll to zoom
          </div>
        </div>
      )}
    </div>
  );
}

export default SPYChart;
