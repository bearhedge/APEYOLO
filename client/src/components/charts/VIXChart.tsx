/**
 * VIX Chart Component
 *
 * Clean, minimal VIX visualization with:
 * - Candlestick or line chart
 * - Timeframe selector
 * - OHLC display bar
 * - Dark theme matching app design
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { createChartProvider, ChartProvider, TimeRange, ChartType, OHLCData } from './ChartProvider';

interface VIXData {
  current: number;
  open: number;
  high: number;
  low: number;
  close: number;
  change: number;
  changePercent: number;
  trend: 'up' | 'down' | 'flat';
  level: 'low' | 'normal' | 'elevated' | 'high';
  marketState: string;
  lastUpdate: string;
}

interface VIXHistoryResponse {
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

interface VIXChartProps {
  height?: number;
  defaultTimeframe?: TimeRange;
  chartType?: ChartType;
  showTimeframeSelector?: boolean;
  showOHLC?: boolean;
  className?: string;
}

// Granular minute timeframes (1m, 5m, 15m, 30m) + standard day/week/month ranges
const timeframeOptions: TimeRange[] = ['1m', '5m', '15m', '30m', '1D', '5D', '1M', '3M', '6M', '1Y', 'MAX'];

export function VIXChart({
  height = 200,
  defaultTimeframe = '5D',
  chartType = 'candlestick',
  showTimeframeSelector = true,
  showOHLC = true,
  className = '',
}: VIXChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartProviderRef = useRef<ChartProvider | null>(null);

  const [timeframe, setTimeframe] = useState<TimeRange>(defaultTimeframe);
  const [vixData, setVixData] = useState<VIXData | null>(null);
  const [historyData, setHistoryData] = useState<OHLCData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch current VIX data
  const fetchVIXData = useCallback(async () => {
    try {
      const response = await fetch('/api/market/vix');
      if (!response.ok) throw new Error('Failed to fetch VIX data');
      const data = await response.json();
      setVixData(data);
    } catch (err: any) {
      console.error('[VIXChart] Error fetching VIX data:', err);
    }
  }, []);

  // Fetch historical data for chart
  const fetchHistoryData = useCallback(async (range: TimeRange) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/market/vix/history?range=${range}`);
      if (!response.ok) throw new Error('Failed to fetch VIX history');
      const data: VIXHistoryResponse = await response.json();

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
      console.error('[VIXChart] Error fetching history:', err);
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
    });

    return () => {
      // Don't destroy on every render, only on unmount
    };
  }, [historyData, height, chartType]);

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
    fetchVIXData();
    fetchHistoryData(timeframe);
  }, [timeframe, fetchVIXData, fetchHistoryData]);

  // Handle timeframe change
  const handleTimeframeChange = (newTimeframe: TimeRange) => {
    setTimeframe(newTimeframe);
  };

  // Determine change color
  const changeColor = vixData?.change && vixData.change >= 0 ? 'text-red-400' : 'text-green-400';
  const changeIcon = vixData?.change && vixData.change >= 0 ? '▲' : '▼';

  // Determine VIX level color
  const getLevelColor = (level?: string) => {
    switch (level) {
      case 'low': return 'text-green-400';
      case 'normal': return 'text-green-400';
      case 'elevated': return 'text-yellow-400';
      case 'high': return 'text-red-400';
      default: return 'text-neutral-400';
    }
  };

  return (
    <div className={`bg-neutral-900 rounded-lg ${className}`}>
      {/* Header: Current value + Timeframe selector */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-800">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold text-white">
            {vixData?.current?.toFixed(2) ?? '--'}
          </span>
          {vixData && (
            <span className={`text-sm ${changeColor}`}>
              {changeIcon} {Math.abs(vixData.change).toFixed(2)} ({Math.abs(vixData.changePercent).toFixed(2)}%)
            </span>
          )}
        </div>

        {showTimeframeSelector && (
          <div className="flex gap-1">
            {timeframeOptions.map((tf) => (
              <button
                key={tf}
                onClick={() => handleTimeframeChange(tf)}
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  timeframe === tf
                    ? 'bg-neutral-700 text-white'
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
      <div className="relative group" style={{ height: height + 'px' }}>
        {loading && historyData.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-neutral-500">Loading chart...</div>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-red-400 text-sm">{error}</div>
          </div>
        )}
        <div ref={containerRef} className="w-full h-full cursor-crosshair" />
        {/* Interactivity hint - shows on hover */}
        <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
          <span className="text-xs text-neutral-500 bg-neutral-900/80 px-2 py-1 rounded">
            Scroll to zoom • Drag to pan
          </span>
        </div>
      </div>

      {/* OHLC Bar */}
      {showOHLC && vixData && (
        <div className="flex items-center justify-between px-3 py-2 border-t border-neutral-800 text-xs">
          <div className="flex gap-4">
            <span className="text-neutral-400">
              O: <span className="text-neutral-200">{vixData.open?.toFixed(2)}</span>
            </span>
            <span className="text-neutral-400">
              H: <span className="text-neutral-200">{vixData.high?.toFixed(2)}</span>
            </span>
            <span className="text-neutral-400">
              L: <span className="text-neutral-200">{vixData.low?.toFixed(2)}</span>
            </span>
            <span className="text-neutral-400">
              C: <span className="text-neutral-200">{vixData.close?.toFixed(2)}</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className={getLevelColor(vixData.level)}>
              {vixData.level?.toUpperCase()}
            </span>
            <span className="text-neutral-500">
              {vixData.marketState}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export default VIXChart;
