/**
 * TerminalHeader - Top bar with market data and multi-timezone clocks
 *
 * Bear Hedge style: gray bar, candle icon, SPY/VIX prices, HK/NY/LON times
 */

import { useState, useEffect } from 'react';

interface MarketData {
  spy: { price: number; change: number } | null;
  vix: { price: number; change: number } | null;
}

export function TerminalHeader() {
  const [times, setTimes] = useState({ hk: '', ny: '', lon: '' });
  const [market, setMarket] = useState<MarketData>({ spy: null, vix: null });

  // Update clocks every second
  useEffect(() => {
    const updateTimes = () => {
      const now = new Date();

      const hkTime = now.toLocaleTimeString('en-US', {
        timeZone: 'Asia/Hong_Kong',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      });

      const nyTime = now.toLocaleTimeString('en-US', {
        timeZone: 'America/New_York',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      });

      const lonTime = now.toLocaleTimeString('en-US', {
        timeZone: 'Europe/London',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      });

      setTimes({ hk: hkTime, ny: nyTime, lon: lonTime });
    };

    updateTimes();
    const interval = setInterval(updateTimes, 1000);
    return () => clearInterval(interval);
  }, []);

  // Fetch market data
  useEffect(() => {
    const fetchMarket = async () => {
      try {
        // Try Yahoo Finance via CORS proxy
        const fetchQuote = async (symbol: string) => {
          const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1m&range=1d`;
          const res = await fetch(`https://corsproxy.io/?${encodeURIComponent(url)}`);
          if (res.ok) {
            const data = await res.json();
            const meta = data.chart?.result?.[0]?.meta;
            if (meta) {
              const price = meta.regularMarketPrice;
              const prevClose = meta.regularMarketPreviousClose || meta.previousClose;
              const change = prevClose ? ((price - prevClose) / prevClose) * 100 : 0;
              return { price, change };
            }
          }
          return null;
        };

        const [spy, vix] = await Promise.all([
          fetchQuote('SPY'),
          fetchQuote('^VIX'),
        ]);

        setMarket({ spy, vix });
      } catch {
        // Silently fail
      }
    };

    fetchMarket();
    const interval = setInterval(fetchMarket, 10000); // Every 10 seconds
    return () => clearInterval(interval);
  }, []);

  return (
    <header
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: 40,
        background: '#707070',
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        gap: 24,
        zIndex: 200,
        fontSize: 13,
        fontFamily: "'IBM Plex Mono', monospace",
      }}
    >
      {/* Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
        {/* Candle icon */}
        <div style={{ display: 'flex', gap: 3, alignItems: 'center', height: 18 }}>
          <CandleIcon up height={10} />
          <CandleIcon up={false} height={8} />
        </div>
        <span>APE YOLO</span>
      </div>

      {/* Market Data */}
      <div style={{ display: 'flex', gap: 20, fontSize: 12, marginLeft: 'auto', marginRight: 'auto' }}>
        <MarketItem label="SPY" data={market.spy} />
        <MarketItem label="VIX" data={market.vix} inverted />
      </div>

      {/* Clocks */}
      <div style={{ display: 'flex', gap: 8, fontSize: 12 }}>
        <span style={{ color: '#4dd0e1' }}>HK {times.hk}</span>
        <span style={{ opacity: 0.4 }}>·</span>
        <span style={{ color: '#7ec8a3' }}>NY {times.ny}</span>
        <span style={{ opacity: 0.4 }}>·</span>
        <span style={{ color: '#ffa8a8' }}>LON {times.lon}</span>
      </div>
    </header>
  );
}

function CandleIcon({ up, height }: { up: boolean; height: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ width: 1, height: 2, background: 'currentColor' }} />
      <div
        style={{
          width: 4,
          height,
          background: up ? '#4ade80' : '#ef4444',
        }}
      />
      <div style={{ width: 1, height: 2, background: 'currentColor' }} />
    </div>
  );
}

function MarketItem({
  label,
  data,
  inverted = false,
}: {
  label: string;
  data: { price: number; change: number } | null;
  inverted?: boolean;
}) {
  if (!data) {
    return (
      <div style={{ display: 'flex', gap: 6, color: '#fff' }}>
        <span>{label}</span>
        <span>--</span>
      </div>
    );
  }

  // For VIX, high = bad for premium sellers, so invert colors
  const isUp = inverted ? data.change < 0 : data.change > 0;
  const color = isUp ? '#4ade80' : '#ff7575';
  const changeStr = `${data.change >= 0 ? '+' : ''}${data.change.toFixed(2)}%`;

  return (
    <div style={{ display: 'flex', gap: 6, color }}>
      <span style={{ color: '#fff' }}>{label}</span>
      <span>
        {data.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
      <span>({changeStr})</span>
    </div>
  );
}
