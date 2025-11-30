import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import { createChart, IChartApi, ISeriesApi, CandlestickData, LineData, Time } from 'lightweight-charts';
import { useQuery } from '@tanstack/react-query';

// Export ref handle type for parent components
export interface CandlestickChartRef {
  updateWithTick: (price: number, timestamp: number) => void;
}

// Timeframe options - maps to Yahoo Finance intervals
type Timeframe = '1m' | '5m' | '15m' | '1h' | '1d';

interface CandlestickChartProps {
  symbol: string;
  height?: number;
  showMAs?: boolean;
  showVolume?: boolean;
  onPriceUpdate?: (price: number) => void;
  className?: string;
}

// Internal format for chart (Unix seconds)
interface OHLCBar {
  time: number; // Unix timestamp in seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

// API response format - now returns sanitized bars with Unix seconds
interface SanitizedBar {
  time: number;   // Unix timestamp in seconds (already sanitized by server)
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

interface HistoryResponse {
  symbol: string;
  range: string;
  interval: string;
  count: number;
  data: SanitizedBar[];
  _meta?: {
    rawCount: number;
    cleanCount: number;
    dropped: number;
    reasons?: Record<string, number>;
  };
}

// Validation helpers for live tick updates
function isValidPrice(price: any): price is number {
  return (
    typeof price === 'number' &&
    isFinite(price) &&
    price > 0 &&
    price < 100000 // No stock is worth $100k
  );
}

function isValidTimestamp(ts: any): ts is number {
  if (typeof ts !== 'number' || !isFinite(ts)) return false;
  // Must be between 2020 and 2035 (Unix seconds)
  return ts >= 1577836800 && ts <= 2051222400;
}

// Calculate Simple Moving Average
function calculateSMA(data: CandlestickData[], period: number): LineData[] {
  const result: LineData[] = [];
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += (data[i - j] as any).close;
    }
    result.push({
      time: data[i].time,
      value: sum / period,
    });
  }
  return result;
}

// Get range parameter for Yahoo Finance API based on timeframe
function getTimeframeRange(tf: Timeframe): string {
  switch (tf) {
    case '1m': return '1D';    // 1 day of 1-min bars
    case '5m': return '5D';    // 5 days of 5-min bars
    case '15m': return '5D';   // 5 days of 15-min bars
    case '1h': return '1M';    // 1 month of hourly bars
    case '1d': return '1Y';    // 1 year of daily bars
    default: return '5D';
  }
}

// Convert sanitized API response to internal chart format
// Server already sanitizes data, but we validate one more time
function convertToChartFormat(data: SanitizedBar[]): OHLCBar[] {
  return data
    .filter(bar => {
      // Double-check validation (server should have done this)
      if (!isValidPrice(bar.open) || !isValidPrice(bar.high) ||
          !isValidPrice(bar.low) || !isValidPrice(bar.close)) {
        console.warn('[chart] filtered bar with invalid price', bar);
        return false;
      }
      if (!isValidTimestamp(bar.time)) {
        console.warn('[chart] filtered bar with invalid timestamp', bar);
        return false;
      }
      return true;
    })
    .map(bar => ({
      time: bar.time,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
    }));
}

export const CandlestickChart = forwardRef<CandlestickChartRef, CandlestickChartProps>(function CandlestickChart({
  symbol,
  height = 400,
  showMAs = true,
  showVolume = false,
  onPriceUpdate,
  className = '',
}, ref) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const ma5SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ma15SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ma50SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);

  const [timeframe, setTimeframe] = useState<Timeframe>('5m');
  const [currentCandle, setCurrentCandle] = useState<OHLCBar | null>(null);

  // Fetch historical data from Yahoo Finance API
  const { data: historicalData, isLoading, refetch } = useQuery<OHLCBar[]>({
    queryKey: ['/api/market/history', symbol, timeframe],
    queryFn: async () => {
      const range = getTimeframeRange(timeframe);
      const res = await fetch(
        `/api/market/history/${symbol}?range=${range}&interval=${timeframe}`,
        { credentials: 'include' }
      );
      if (!res.ok) {
        console.warn('Market history API not available, using mock data');
        return generateMockData(timeframe);
      }
      const response: HistoryResponse = await res.json();
      return convertToChartFormat(response.data);
    },
    refetchInterval: false, // Don't auto-refetch, we use WebSocket for updates
    staleTime: 60000, // Consider data stale after 1 minute
  });

  // Generate mock data for testing (will be replaced by real API)
  function generateMockData(tf: Timeframe): OHLCBar[] {
    const bars: OHLCBar[] = [];
    const now = Math.floor(Date.now() / 1000);
    const intervalSeconds = tf === '1m' ? 60 : tf === '5m' ? 300 : tf === '15m' ? 900 : tf === '1h' ? 3600 : 86400;
    const numBars = tf === '1m' ? 390 : tf === '5m' ? 78 * 5 : tf === '15m' ? 26 * 10 : tf === '1h' ? 7 * 30 : 252;

    let price = 600; // Base SPY price
    for (let i = numBars; i >= 0; i--) {
      const time = now - (i * intervalSeconds);
      const change = (Math.random() - 0.5) * 2;
      const open = price;
      const close = price + change;
      const high = Math.max(open, close) + Math.random() * 0.5;
      const low = Math.min(open, close) - Math.random() * 0.5;
      price = close;

      bars.push({
        time,
        open,
        high,
        low,
        close,
        volume: Math.floor(Math.random() * 1000000) + 500000,
      });
    }
    return bars;
  }

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Create chart with dark theme
    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height,
      layout: {
        background: { color: '#1a1a1a' },
        textColor: '#d1d5db',
      },
      grid: {
        vertLines: { color: '#2d2d2d' },
        horzLines: { color: '#2d2d2d' },
      },
      crosshair: {
        mode: 1, // Magnet mode
        vertLine: {
          color: '#6b7280',
          width: 1,
          style: 2,
          labelBackgroundColor: '#374151',
        },
        horzLine: {
          color: '#6b7280',
          width: 1,
          style: 2,
          labelBackgroundColor: '#374151',
        },
      },
      rightPriceScale: {
        borderColor: '#2d2d2d',
        scaleMargins: {
          top: 0.1,
          bottom: showVolume ? 0.2 : 0.1,
        },
      },
      timeScale: {
        borderColor: '#2d2d2d',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
        barSpacing: 6,
      },
      handleScroll: {
        vertTouchDrag: false,
      },
    });

    // Add candlestick series
    const candleSeries = chart.addCandlestickSeries({
      upColor: '#10b981',
      downColor: '#ef4444',
      borderUpColor: '#10b981',
      borderDownColor: '#ef4444',
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
    });

    // Add MA lines if enabled
    let ma5Series: ISeriesApi<'Line'> | null = null;
    let ma15Series: ISeriesApi<'Line'> | null = null;
    let ma50Series: ISeriesApi<'Line'> | null = null;

    if (showMAs) {
      ma5Series = chart.addLineSeries({
        color: '#fbbf24', // Yellow - fast MA
        lineWidth: 1,
        crosshairMarkerVisible: false,
        priceLineVisible: false,
        lastValueVisible: false,
      });

      ma15Series = chart.addLineSeries({
        color: '#3b82f6', // Blue - medium MA
        lineWidth: 1,
        crosshairMarkerVisible: false,
        priceLineVisible: false,
        lastValueVisible: false,
      });

      ma50Series = chart.addLineSeries({
        color: '#ef4444', // Red - slow MA
        lineWidth: 1,
        crosshairMarkerVisible: false,
        priceLineVisible: false,
        lastValueVisible: false,
      });
    }

    // Add volume histogram if enabled
    let volumeSeries: ISeriesApi<'Histogram'> | null = null;
    if (showVolume) {
      volumeSeries = chart.addHistogramSeries({
        color: '#6b7280',
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
      });

      chart.priceScale('volume').applyOptions({
        scaleMargins: {
          top: 0.85,
          bottom: 0,
        },
      });
    }

    // Handle resize
    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    // Store refs
    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    ma5SeriesRef.current = ma5Series;
    ma15SeriesRef.current = ma15Series;
    ma50SeriesRef.current = ma50Series;
    volumeSeriesRef.current = volumeSeries;

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      ma5SeriesRef.current = null;
      ma15SeriesRef.current = null;
      ma50SeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, [height, showMAs, showVolume]);

  // Update chart data when historical data changes
  useEffect(() => {
    if (!historicalData || !candleSeriesRef.current) return;

    // Convert to Lightweight Charts format
    const candleData: CandlestickData[] = historicalData.map(bar => ({
      time: bar.time as Time,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
    }));

    // Set candle data
    candleSeriesRef.current.setData(candleData);

    // Calculate and set MAs
    if (showMAs && candleData.length > 0) {
      if (ma5SeriesRef.current) {
        ma5SeriesRef.current.setData(calculateSMA(candleData, 5));
      }
      if (ma15SeriesRef.current) {
        ma15SeriesRef.current.setData(calculateSMA(candleData, 15));
      }
      if (ma50SeriesRef.current && candleData.length >= 50) {
        ma50SeriesRef.current.setData(calculateSMA(candleData, 50));
      }
    }

    // Set volume data
    if (showVolume && volumeSeriesRef.current) {
      const volumeData = historicalData.map(bar => ({
        time: bar.time as Time,
        value: bar.volume || 0,
        color: bar.close >= bar.open ? '#10b98140' : '#ef444440',
      }));
      volumeSeriesRef.current.setData(volumeData);
    }

    // Store last candle for live updates
    if (historicalData.length > 0) {
      setCurrentCandle(historicalData[historicalData.length - 1]);
      if (onPriceUpdate) {
        onPriceUpdate(historicalData[historicalData.length - 1].close);
      }
    }

    // Fit content
    chartRef.current?.timeScale().fitContent();
  }, [historicalData, showMAs, showVolume, onPriceUpdate]);

  // Handle timeframe change
  const handleTimeframeChange = useCallback((newTimeframe: Timeframe) => {
    setTimeframe(newTimeframe);
  }, []);

  // Public method to update with live tick (will be called from parent via WebSocket)
  const updateWithTick = useCallback((price: number, timestamp: number) => {
    if (!candleSeriesRef.current || !currentCandle) return;

    // Validate tick before processing
    if (!isValidPrice(price)) {
      console.warn('[chart] dropped tick with invalid price', { price, timestamp });
      return;
    }

    // Normalize timestamp to Unix seconds if in milliseconds
    let normalizedTs = timestamp;
    if (timestamp > 10_000_000_000) {
      normalizedTs = Math.floor(timestamp / 1000);
    }

    if (!isValidTimestamp(normalizedTs)) {
      console.warn('[chart] dropped tick with invalid timestamp', { price, timestamp, normalizedTs });
      return;
    }

    const intervalSeconds = timeframe === '1m' ? 60 : timeframe === '5m' ? 300 : timeframe === '15m' ? 900 : timeframe === '1h' ? 3600 : 86400;
    const candleTime = Math.floor(normalizedTs / intervalSeconds) * intervalSeconds;

    if (candleTime === currentCandle.time) {
      // Update current candle
      const updatedCandle: OHLCBar = {
        ...currentCandle,
        high: Math.max(currentCandle.high, price),
        low: Math.min(currentCandle.low, price),
        close: price,
      };
      setCurrentCandle(updatedCandle);
      candleSeriesRef.current.update({
        time: updatedCandle.time as Time,
        open: updatedCandle.open,
        high: updatedCandle.high,
        low: updatedCandle.low,
        close: updatedCandle.close,
      });
    } else {
      // New candle
      const newCandle: OHLCBar = {
        time: candleTime,
        open: price,
        high: price,
        low: price,
        close: price,
      };
      setCurrentCandle(newCandle);
      candleSeriesRef.current.update({
        time: newCandle.time as Time,
        open: newCandle.open,
        high: newCandle.high,
        low: newCandle.low,
        close: newCandle.close,
      });
    }

    if (onPriceUpdate) {
      onPriceUpdate(price);
    }
  }, [currentCandle, timeframe, onPriceUpdate]);

  // Expose updateWithTick via ref for parent component to call
  useImperativeHandle(ref, () => ({
    updateWithTick,
  }), [updateWithTick]);

  return (
    <div className={`relative ${className}`}>
      {/* Timeframe Selector */}
      <div className="absolute top-2 left-2 z-10 flex gap-1">
        {(['1m', '5m', '15m', '1h', '1d'] as Timeframe[]).map((tf) => (
          <button
            key={tf}
            onClick={() => handleTimeframeChange(tf)}
            className={`px-2 py-1 text-xs font-medium rounded transition ${
              timeframe === tf
                ? 'bg-white text-black'
                : 'bg-white/10 text-white hover:bg-white/20'
            }`}
          >
            {tf.toUpperCase()}
          </button>
        ))}
      </div>

      {/* MA Legend */}
      {showMAs && (
        <div className="absolute top-2 right-2 z-10 flex gap-3 text-xs">
          <span className="text-yellow-400">MA5</span>
          <span className="text-blue-400">MA15</span>
          <span className="text-red-400">MA50</span>
        </div>
      )}

      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-20">
          <div className="text-white">Loading chart data...</div>
        </div>
      )}

      {/* Chart container */}
      <div ref={chartContainerRef} style={{ height }} />
    </div>
  );
});
