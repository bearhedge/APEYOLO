/**
 * Symbol Chart Component
 *
 * Generic chart for any symbol (SPY, QQQ, etc.) with:
 * - Candlestick or line chart
 * - Timeframe selector
 * - OHLC display bar
 * - Dark theme matching app design
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { createChartProvider, ChartProvider, TimeRange, ChartType, OHLCData } from './ChartProvider';

interface QuoteData {
  price: number;
  change: number;
  changePercent: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  marketState?: string;
}

interface HistoryResponse {
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

interface SymbolChartProps {
  symbol: string;
  height?: number;
  defaultTimeframe?: TimeRange;
  chartType?: ChartType;
  showTimeframeSelector?: boolean;
  showOHLC?: boolean;
  showHeader?: boolean;
  className?: string;
}

const timeframeOptions: TimeRange[] = ['1D', '5D', '1M', '3M', '6M', '1Y', 'MAX'];

export function SymbolChart({
  symbol,
  height = 150,
  defaultTimeframe = '5D',
  chartType = 'candlestick',
  showTimeframeSelector = true,
  showOHLC = true,
  showHeader = true,
  className = '',
}: SymbolChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartProviderRef = useRef<ChartProvider | null>(null);

  const [timeframe, setTimeframe] = useState<TimeRange>(defaultTimeframe);
  const [quoteData, setQuoteData] = useState<QuoteData | null>(null);
  const [historyData, setHistoryData] = useState<OHLCData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch current quote
  const fetchQuote = useCallback(async () => {
    try {
      const response = await fetch(`/api/market/quote/${symbol}`);
      if (!response.ok) throw new Error(`Failed to fetch ${symbol} quote`);
      const data = await response.json();
      setQuoteData(data);
    } catch (err: any) {
      console.error(`[SymbolChart] Error fetching ${symbol} quote:`, err);
    }
  }, [symbol]);

  // Fetch historical data for chart
  const fetchHistoryData = useCallback(async (range: TimeRange) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/market/history/${symbol}?range=${range}`);
      if (!response.ok) throw new Error(`Failed to fetch ${symbol} history`);
      const data: HistoryResponse = await response.json();

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
      console.error(`[SymbolChart] Error fetching ${symbol} history:`, err);
      setError(err.message || 'Failed to load chart data');
    } finally {
      setLoading(false);
    }
  }, [symbol]);

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
    fetchQuote();
    fetchHistoryData(timeframe);
  }, [timeframe, fetchQuote, fetchHistoryData]);

  // Handle timeframe change
  const handleTimeframeChange = (newTimeframe: TimeRange) => {
    setTimeframe(newTimeframe);
  };

  // Determine change color (green up, red down for stocks)
  const changeColor = quoteData?.change && quoteData.change >= 0 ? 'text-green-400' : 'text-red-400';
  const changeIcon = quoteData?.change && quoteData.change >= 0 ? '▲' : '▼';

  return (
    <div className={`bg-neutral-900 rounded-lg ${className}`}>
      {/* Header: Current value + Timeframe selector */}
      {showHeader && (
        <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-800">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-medium text-neutral-400">{symbol}</span>
            <span className="text-lg font-semibold text-white">
              ${quoteData?.price?.toFixed(2) ?? '--'}
            </span>
            {quoteData && (
              <span className={`text-xs ${changeColor}`}>
                {changeIcon} {Math.abs(quoteData.change).toFixed(2)} ({Math.abs(quoteData.changePercent).toFixed(2)}%)
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
      )}

      {/* Chart area */}
      <div className="relative" style={{ height: height + 'px' }}>
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
        <div ref={containerRef} className="w-full h-full" />
      </div>

      {/* OHLC Bar */}
      {showOHLC && quoteData && (
        <div className="flex items-center justify-between px-3 py-2 border-t border-neutral-800 text-xs">
          <div className="flex gap-4">
            <span className="text-neutral-400">
              O: <span className="text-neutral-200">{quoteData.open?.toFixed(2)}</span>
            </span>
            <span className="text-neutral-400">
              H: <span className="text-neutral-200">{quoteData.high?.toFixed(2)}</span>
            </span>
            <span className="text-neutral-400">
              L: <span className="text-neutral-200">{quoteData.low?.toFixed(2)}</span>
            </span>
            <span className="text-neutral-400">
              C: <span className="text-neutral-200">{quoteData.close?.toFixed(2)}</span>
            </span>
          </div>
          {quoteData.marketState && (
            <span className="text-neutral-500">{quoteData.marketState}</span>
          )}
        </div>
      )}
    </div>
  );
}

export default SymbolChart;
