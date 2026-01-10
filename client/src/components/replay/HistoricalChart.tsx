// @ts-nocheck
/**
 * Historical Chart Component
 *
 * Uses TradingView Lightweight Charts to display historical OHLC data.
 * This shows the actual candles from the replay date, not live data.
 */

import { useEffect, useRef, memo } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi } from 'lightweight-charts';

interface Candle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface DateMarker {
  date: string;
  startIndex: number;
}

interface HistoricalChartProps {
  candles: Candle[];
  height?: number;
  currentTime?: string; // To highlight current position in replay
  showMA?: boolean;
  maPeriod?: number;
  dateMarkers?: DateMarker[]; // For multi-day chart date separators
}

/**
 * Parse timestamp string and return Unix timestamp in seconds.
 * Handles timestamps like "2023-01-03T09:30:00".
 *
 * Market data timestamps don't have timezone info but represent market hours.
 * We treat them as UTC to ensure consistent display (09:30 in data = 09:30 on chart).
 */
function parseTimestamp(timestamp: string): number {
  // Append 'Z' to treat timestamp as UTC, ensuring 09:30 displays as 09:30
  // Without this, JS parses as local time causing wrong display (e.g., 01:30 instead of 09:30)
  const utcTimestamp = timestamp.endsWith('Z') ? timestamp : timestamp + 'Z';
  const date = new Date(utcTimestamp);
  if (isNaN(date.getTime())) {
    console.warn('Invalid timestamp:', timestamp);
    return 0;
  }
  return Math.floor(date.getTime() / 1000);
}

function HistoricalChartComponent({
  candles,
  height = 400,
  currentTime,
  showMA = true,
  maPeriod = 20,
  dateMarkers,
}: HistoricalChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const maSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#0a0a0f' },
        textColor: '#9ca3af',
      },
      grid: {
        vertLines: { color: '#1f2937' },
        horzLines: { color: '#1f2937' },
      },
      width: chartContainerRef.current.clientWidth,
      height: height,
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: '#374151',
      },
      rightPriceScale: {
        borderColor: '#374151',
      },
      crosshair: {
        mode: 1,
        vertLine: {
          color: '#6b7280',
          width: 1,
          style: 2,
        },
        horzLine: {
          color: '#6b7280',
          width: 1,
          style: 2,
        },
      },
    });

    // Add candlestick series using v4 API
    const candleSeries = chart.addCandlestickSeries({
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });

    // Add MA line series if enabled
    if (showMA) {
      const maSeries = chart.addLineSeries({
        color: '#3b82f6',
        lineWidth: 2,
        priceLineVisible: false,
      });
      maSeriesRef.current = maSeries;
    }

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;

    // Handle resize
    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [height, showMA]);

  // Update data when candles change
  useEffect(() => {
    if (!candleSeriesRef.current || !candles.length) return;

    // Convert candles to chart format with validation
    // lightweight-charts expects time as number (Unix timestamp in seconds)
    const chartData = candles
      .map((c) => {
        const time = parseTimestamp(c.timestamp);
        return {
          time: time as unknown as import('lightweight-charts').UTCTimestamp,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        };
      })
      .filter((c) => (c.time as unknown as number) > 0) // Filter out invalid timestamps
      .sort((a, b) => (a.time as unknown as number) - (b.time as unknown as number)); // Ensure sorted by time

    if (chartData.length === 0) {
      console.warn('No valid candle data to display');
      return;
    }

    console.log(`[HistoricalChart] Setting ${chartData.length} candles, first: ${new Date((chartData[0].time as unknown as number) * 1000).toISOString()}`);
    candleSeriesRef.current.setData(chartData);

    // Calculate and set MA if enabled
    if (showMA && maSeriesRef.current && chartData.length >= maPeriod) {
      const maData: { time: import('lightweight-charts').UTCTimestamp; value: number }[] = [];
      for (let i = maPeriod - 1; i < chartData.length; i++) {
        let sum = 0;
        for (let j = 0; j < maPeriod; j++) {
          sum += chartData[i - j].close;
        }
        maData.push({
          time: chartData[i].time,
          value: sum / maPeriod,
        });
      }
      maSeriesRef.current.setData(maData);
    }

    // Add date markers for multi-day chart
    if (dateMarkers && dateMarkers.length > 1 && candleSeriesRef.current) {
      const markers = dateMarkers.slice(1).map((marker) => {
        if (marker.startIndex >= chartData.length) return null;
        const time = chartData[marker.startIndex].time;
        return {
          time,
          position: 'aboveBar' as const,
          color: '#6b7280',
          shape: 'square' as const,
          text: marker.date.slice(5), // Show MM-DD
        };
      }).filter(Boolean);

      if (markers.length > 0) {
        candleSeriesRef.current.setMarkers(markers as any);
      }
    }

    // Fit content
    if (chartRef.current) {
      chartRef.current.timeScale().fitContent();
    }
  }, [candles, showMA, maPeriod, dateMarkers]);

  // Scroll to current time when it changes
  useEffect(() => {
    if (!chartRef.current || !currentTime || !candles.length) return;

    // Find the candle closest to current time
    const targetTime = currentTime.replace(':', '');
    const currentCandle = candles.find((c) => {
      const candleTime = c.timestamp.split('T')[1]?.substring(0, 5).replace(':', '');
      return candleTime >= targetTime;
    });

    if (currentCandle) {
      // Scroll to show candles up to the current time
      // Use scrollToPosition to show the most recent candles
      chartRef.current.timeScale().scrollToPosition(-2, false);
    }
  }, [currentTime, candles]);

  return (
    <div className="relative">
      <div
        ref={chartContainerRef}
        className="rounded-lg overflow-hidden"
      />
      {candles.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0a0a0f]">
          <span className="text-gray-500">Loading chart data...</span>
        </div>
      )}
    </div>
  );
}

export const HistoricalChart = memo(HistoricalChartComponent);
