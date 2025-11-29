/**
 * Chart Provider Abstraction Layer
 *
 * Abstraction interface for chart rendering.
 * Currently uses TradingView Lightweight Charts.
 * Designed to be replaceable with custom Canvas/WebGL engine later.
 */

import { createChart, IChartApi, ISeriesApi, CandlestickData, LineData, Time } from 'lightweight-charts';

// OHLC data type matching our backend
export interface OHLCData {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export type ChartType = 'candlestick' | 'line';

// Time range = how far back to look (lookback period)
export type TimeRange = '1D' | '5D' | '1M' | '3M' | '6M' | '1Y' | 'MAX';

// Bar interval = candlestick size (what each bar represents)
export type BarInterval = '1m' | '5m' | '15m' | '30m' | '1h' | '1d';

export interface ChartOptions {
  type: ChartType;
  height: number;
  width?: number;
  autoSize?: boolean;
  theme?: 'dark' | 'light';
  showGrid?: boolean;
  showVolume?: boolean;
}

export interface ChartProvider {
  render(data: OHLCData[], options: ChartOptions): void;
  update(data: OHLCData[]): void;
  setTimeframe(range: TimeRange): void;
  destroy(): void;
}

// Convert OHLCData to TradingView format
function toTVCandlestickData(data: OHLCData[]): CandlestickData<Time>[] {
  return data.map(d => ({
    time: Math.floor(d.timestamp.getTime() / 1000) as Time,
    open: d.open,
    high: d.high,
    low: d.low,
    close: d.close,
  }));
}

function toTVLineData(data: OHLCData[]): LineData<Time>[] {
  return data.map(d => ({
    time: Math.floor(d.timestamp.getTime() / 1000) as Time,
    value: d.close,
  }));
}

/**
 * TradingView Lightweight Charts implementation
 */
export class TradingViewChartProvider implements ChartProvider {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<'Candlestick'> | ISeriesApi<'Line'> | null = null;
  private container: HTMLElement;
  private currentType: ChartType = 'candlestick';

  constructor(container: HTMLElement) {
    this.container = container;
  }

  render(data: OHLCData[], options: ChartOptions): void {
    // Clean up existing chart
    if (this.chart) {
      this.chart.remove();
    }

    const isDark = options.theme === 'dark';

    // Create chart with dark theme optimized for our UI
    this.chart = createChart(this.container, {
      width: options.width || this.container.clientWidth,
      height: options.height,
      layout: {
        background: { color: isDark ? '#0a0a0a' : '#ffffff' },
        textColor: isDark ? '#a3a3a3' : '#333333',
      },
      grid: {
        vertLines: {
          visible: options.showGrid ?? true,
          color: isDark ? '#262626' : '#e5e5e5'
        },
        horzLines: {
          visible: options.showGrid ?? true,
          color: isDark ? '#262626' : '#e5e5e5'
        },
      },
      crosshair: {
        vertLine: { color: isDark ? '#525252' : '#c4c4c4', width: 1, style: 2 },
        horzLine: { color: isDark ? '#525252' : '#c4c4c4', width: 1, style: 2 },
      },
      rightPriceScale: {
        borderColor: isDark ? '#262626' : '#e5e5e5',
      },
      timeScale: {
        borderColor: isDark ? '#262626' : '#e5e5e5',
        timeVisible: true,
        secondsVisible: false,
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
    });

    // Auto-resize on container size change
    if (options.autoSize !== false) {
      this.chart.applyOptions({ autoSize: true });
    }

    this.currentType = options.type;

    // Add series based on chart type
    if (options.type === 'candlestick') {
      this.series = this.chart.addCandlestickSeries({
        upColor: '#22c55e',
        downColor: '#ef4444',
        borderUpColor: '#22c55e',
        borderDownColor: '#ef4444',
        wickUpColor: '#22c55e',
        wickDownColor: '#ef4444',
      });
      this.series.setData(toTVCandlestickData(data));
    } else {
      this.series = this.chart.addLineSeries({
        color: '#3b82f6',
        lineWidth: 2,
      });
      this.series.setData(toTVLineData(data));
    }

    // Fit content
    this.chart.timeScale().fitContent();
  }

  update(data: OHLCData[]): void {
    if (!this.series) return;

    if (this.currentType === 'candlestick') {
      (this.series as ISeriesApi<'Candlestick'>).setData(toTVCandlestickData(data));
    } else {
      (this.series as ISeriesApi<'Line'>).setData(toTVLineData(data));
    }
  }

  setTimeframe(_range: TimeRange): void {
    // Timeframe change handled externally by fetching new data
    this.chart?.timeScale().fitContent();
  }

  destroy(): void {
    if (this.chart) {
      this.chart.remove();
      this.chart = null;
      this.series = null;
    }
  }

  // Expose chart instance for advanced customization
  getChart(): IChartApi | null {
    return this.chart;
  }
}

/**
 * Factory function to create chart provider
 * Can be extended to support different providers
 */
export function createChartProvider(
  container: HTMLElement,
  _engine: 'tradingview' | 'canvas' | 'webgl' = 'tradingview'
): ChartProvider {
  // Currently only TradingView is implemented
  // Future: switch based on engine parameter
  return new TradingViewChartProvider(container);
}
