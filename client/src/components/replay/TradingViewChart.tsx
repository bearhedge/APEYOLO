// @ts-nocheck
/**
 * TradingView Chart Component
 *
 * Embeds the official TradingView Advanced Chart widget.
 * For replay mode, we'll overlay historical data visualization.
 */

import { useEffect, useRef, memo } from 'react';

interface TradingViewChartProps {
  symbol?: string;
  interval?: string;
  theme?: 'dark' | 'light';
  height?: number;
  showToolbar?: boolean;
  studies?: string[];
}

function TradingViewChartComponent({
  symbol = 'SPY',
  interval = '5',
  theme = 'dark',
  height = 500,
  showToolbar = true,
  studies = ['RSI@tv-basicstudies', 'MACD@tv-basicstudies'],
}: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Clear previous widget
    containerRef.current.innerHTML = '';

    // Create widget container
    const widgetContainer = document.createElement('div');
    widgetContainer.className = 'tradingview-widget-container';
    widgetContainer.style.height = '100%';
    widgetContainer.style.width = '100%';

    const widgetDiv = document.createElement('div');
    widgetDiv.className = 'tradingview-widget-container__widget';
    widgetDiv.style.height = '100%';
    widgetDiv.style.width = '100%';

    widgetContainer.appendChild(widgetDiv);
    containerRef.current.appendChild(widgetContainer);

    // Load TradingView script
    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: symbol,
      interval: interval,
      timezone: 'America/New_York',
      theme: theme,
      style: '1', // Candlestick
      locale: 'en',
      allow_symbol_change: false,
      hide_top_toolbar: !showToolbar,
      hide_legend: false,
      save_image: false,
      calendar: false,
      hide_volume: false,
      support_host: 'https://www.tradingview.com',
      studies: studies,
      backgroundColor: theme === 'dark' ? 'rgba(10, 10, 15, 1)' : 'rgba(255, 255, 255, 1)',
      gridColor: theme === 'dark' ? 'rgba(42, 46, 57, 0.3)' : 'rgba(0, 0, 0, 0.1)',
    });

    widgetContainer.appendChild(script);
    widgetRef.current = widgetContainer;

    return () => {
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, [symbol, interval, theme, showToolbar, studies]);

  return (
    <div
      ref={containerRef}
      style={{ height: `${height}px`, width: '100%' }}
      className="rounded-lg overflow-hidden"
    />
  );
}

// Memo to prevent unnecessary re-renders
export const TradingViewChart = memo(TradingViewChartComponent);
