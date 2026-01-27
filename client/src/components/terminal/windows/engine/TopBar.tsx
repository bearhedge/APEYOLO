/**
 * TopBar - HUD status bar showing market data and mode
 *
 * Displays: SPY bid x ask + % change, VIX value, connection status, NY/HK times, AUTO/MANUAL mode
 */

import { useState, useEffect } from 'react';

interface TopBarProps {
  spyBid: number;
  spyAsk: number;
  spyPrevClose: number;
  vixPrice?: number;  // Primary VIX price (last) - VIX is an index, bid/ask are usually 0
  vixBid: number;
  vixAsk: number;
  vixPrevClose: number;
  vixIsClose?: boolean;  // true if VIX is showing closing price
  isConnected: boolean;
  wsConnected?: boolean;
  isDelayed?: boolean;   // true when using Yahoo fallback during extended hours
  mode: 'MANUAL' | 'AUTO';
  autoCountdown?: number; // seconds until next auto-analyze
  onModeToggle: () => void;
}

type MarketSession = 'PRE' | 'OPEN' | 'AH' | 'OVERNIGHT' | 'CLOSED';

function getMarketSession(): { session: MarketSession; color: string } {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay();
  const hour = et.getHours();
  const min = et.getMinutes();
  const time = hour * 60 + min;

  // Weekend
  if (day === 0 || day === 6) return { session: 'CLOSED', color: '#ef4444' };

  // Pre-market: 4:00 AM - 9:30 AM ET
  if (time >= 240 && time < 570) return { session: 'PRE', color: '#f59e0b' };

  // Regular: 9:30 AM - 4:00 PM ET
  if (time >= 570 && time < 960) return { session: 'OPEN', color: '#4ade80' };

  // After-hours: 4:00 PM - 8:00 PM ET
  if (time >= 960 && time < 1200) return { session: 'AH', color: '#f59e0b' };

  // Overnight: 8:00 PM - 4:00 AM ET
  return { session: 'OVERNIGHT', color: '#fbbf24' };
}

export function TopBar({
  spyBid,
  spyAsk,
  spyPrevClose,
  vixPrice,
  vixBid,
  vixAsk,
  vixPrevClose,
  vixIsClose,
  isConnected,
  wsConnected,
  isDelayed,
  mode,
  autoCountdown,
  onModeToggle,
}: TopBarProps) {
  // NY/HK time state
  const [times, setTimes] = useState({ ny: '', hk: '' });

  // Persist last known VIX value
  const [lastKnownVix, setLastKnownVix] = useState(0);

  // Market session state (updates every second with times)
  const [sessionInfo, setSessionInfo] = useState(getMarketSession);

  useEffect(() => {
    const updateTimes = () => {
      const now = new Date();
      const ny = now.toLocaleTimeString('en-US', {
        timeZone: 'America/New_York',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
      const hk = now.toLocaleTimeString('en-US', {
        timeZone: 'Asia/Hong_Kong',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
      setTimes({ ny, hk });
      setSessionInfo(getMarketSession());
    };
    updateTimes();
    const interval = setInterval(updateTimes, 1000);
    return () => clearInterval(interval);
  }, []);

  // Calculate midpoint for % change
  const spyMid = (spyBid + spyAsk) / 2;
  // VIX is an index - use price directly, fall back to bid/ask mid
  const vixMid = vixPrice && vixPrice > 0
    ? vixPrice
    : (vixBid + vixAsk) / 2;

  // Persist VIX value when available
  useEffect(() => {
    if (vixMid > 0) {
      setLastKnownVix(vixMid);
    }
  }, [vixMid]);

  // Display last known VIX when live data unavailable
  const displayVix = vixMid > 0 ? vixMid : lastKnownVix;

  // Calculate % change from previous close
  const spyChangePct = spyPrevClose > 0 && spyMid > 0
    ? ((spyMid - spyPrevClose) / spyPrevClose) * 100
    : 0;
  const vixChangePct = vixPrevClose > 0 && vixMid > 0
    ? ((vixMid - vixPrevClose) / vixPrevClose) * 100
    : 0;

  const spyPriceColor = spyChangePct >= 0 ? '#4ade80' : '#ef4444';
  const vixPriceColor = vixChangePct >= 0 ? '#4ade80' : '#ef4444';
  // VIX in white, with orange warning if elevated (>25)
  const vixValueColor = displayVix > 25 ? '#f59e0b' : '#fff';

  const formatCountdown = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '8px 12px',
        borderBottom: '1px solid #222',
        background: '#0a0a0a',
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 13,
      }}
    >
      {/* Left: Market data */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        {/* SPY bid x ask */}
        <span>
          <span style={{ color: '#888' }}>SPY </span>
          {spyBid > 0 && spyAsk > 0 ? (
            <>
              <span style={{ color: '#fff', fontWeight: 600 }}>
                ${spyBid.toFixed(2)}
              </span>
              <span style={{ color: '#666' }}> x </span>
              <span style={{ color: '#fff', fontWeight: 600 }}>
                ${spyAsk.toFixed(2)}
              </span>
              {spyPrevClose > 0 && (
                <span style={{ color: spyPriceColor, marginLeft: 6 }}>
                  {spyChangePct >= 0 ? '\u25B2' : '\u25BC'}
                  {spyChangePct >= 0 ? '+' : ''}{spyChangePct.toFixed(2)}%
                </span>
              )}
            </>
          ) : (
            <span style={{ color: '#ef4444', fontWeight: 500 }}>--</span>
          )}
        </span>

        {/* VIX value only */}
        <span>
          <span style={{ color: '#888' }}>VIX </span>
          {displayVix > 0 ? (
            <span style={{ color: vixValueColor, fontWeight: 500 }}>
              {displayVix.toFixed(2)}
            </span>
          ) : (
            <span style={{ color: '#888', fontWeight: 500 }}>--</span>
          )}
        </span>

        {/* Connection status - LIVE (green) | DELAYED (amber) | OFFLINE (gray) */}
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: spyMid > 0 ? (isDelayed ? '#f59e0b' : '#4ade80') : '#ef4444',
              display: 'inline-block',
            }}
          />
          <span style={{
            color: spyMid > 0 ? (isDelayed ? '#f59e0b' : '#4ade80') : '#888',
            fontSize: 11
          }}>
            {spyMid > 0 ? (isDelayed ? 'DELAYED' : 'LIVE') : 'OFFLINE'}
          </span>
        </span>
      </div>

      {/* Right: NY/HK Times + Mode toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        {/* NY/HK Times with colors + Session */}
        <span style={{ fontSize: 12 }}>
          <span style={{ color: '#a78bfa' }}>NY</span>{' '}
          <span style={{ color: '#a78bfa' }}>{times.ny}</span>
          <span style={{ margin: '0 8px', color: '#333' }}>|</span>
          <span style={{ color: '#93c5fd' }}>HK</span>{' '}
          <span style={{ color: '#93c5fd' }}>{times.hk}</span>
          <span style={{ margin: '0 8px', color: '#333' }}>|</span>
          <span style={{ color: sessionInfo.color, fontWeight: 600 }}>{sessionInfo.session}</span>
        </span>

        {/* Mode toggle */}
        <button
          onClick={onModeToggle}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '4px 12px',
            background: 'transparent',
            border: `1px solid ${mode === 'AUTO' ? '#00ffff' : '#333'}`,
            borderRadius: 4,
            color: mode === 'AUTO' ? '#00ffff' : '#888',
            fontSize: 12,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          <span>{mode}</span>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: mode === 'AUTO' ? '#00ffff' : 'transparent',
              border: mode === 'AUTO' ? 'none' : '1px solid #666',
              animation: mode === 'AUTO' ? 'pulse 2s infinite' : 'none',
            }}
          />
          {mode === 'AUTO' && autoCountdown !== undefined && (
            <span style={{ color: '#00ffff', fontFamily: 'monospace' }}>
              {formatCountdown(autoCountdown)}
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
