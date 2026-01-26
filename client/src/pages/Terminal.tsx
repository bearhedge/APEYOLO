/**
 * Terminal - Single-page dashboard with draggable windows
 *
 * Bear Hedge style: black background, dock at bottom, terminal aesthetic.
 */

import { useEffect, useState } from 'react';
import { WindowManager } from '@/components/terminal/WindowManager';
import { Dock } from '@/components/terminal/Dock';
import { useWindowManager, type WindowId } from '@/hooks/useWindowManager';
import { useQuery } from '@tanstack/react-query';
import { useWebSocket } from '@/hooks/use-websocket';

export function Terminal() {
  const windowManager = useWindowManager();
  const { isConnected: wsConnected, onChartPriceUpdate } = useWebSocket();

  // IBKR status for NAV
  const { data: ibkrStatus } = useQuery<{
    configured: boolean;
    connected: boolean;
    accountId?: string;
    nav?: number;
  }>({
    queryKey: ['/api/ibkr/status'],
    queryFn: async () => {
      const res = await fetch('/api/ibkr/status', { credentials: 'include' });
      if (!res.ok) return { configured: false, connected: false };
      return res.json();
    },
    refetchInterval: 30000,
  });

  // Market data from WebSocket
  const [spyBid, setSpyBid] = useState(0);
  const [spyAsk, setSpyAsk] = useState(0);
  const [spyChangePct, setSpyChangePct] = useState(0);
  const [vixValue, setVixValue] = useState(0);

  useEffect(() => {
    const unsubscribe = onChartPriceUpdate((data) => {
      if (data.symbol === 'SPY') {
        setSpyBid(data.bid);
        setSpyAsk(data.ask);
        setSpyChangePct(data.changePct);
      } else if (data.symbol === 'VIX') {
        setVixValue(data.price);
      }
    });
    return unsubscribe;
  }, [onChartPriceUpdate]);

  // Handle escape key to close all windows
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        Object.keys(windowManager.windows).forEach(id => {
          if (windowManager.windows[id as WindowId].isOpen) {
            windowManager.closeWindow(id as WindowId);
          }
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [windowManager]);

  const spyMid = (spyBid + spyAsk) / 2;
  const isConnected = ibkrStatus?.connected ?? false;
  const nav = ibkrStatus?.nav ?? 0;

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#000',
        fontFamily: "'IBM Plex Mono', monospace",
        overflow: 'hidden',
      }}
    >
      {/* Top Status Bar */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: 32,
          background: '#0a0a0a',
          borderBottom: '1px solid #222',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '0 16px',
          fontSize: 12,
          zIndex: 1000,
        }}
      >
        {/* Left: Market data */}
        <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
          <span>
            <span style={{ color: '#666' }}>SPY </span>
            {spyMid > 0 ? (
              <>
                <span style={{ color: '#fff', fontWeight: 600 }}>${spyMid.toFixed(2)}</span>
                {spyChangePct !== 0 && (
                  <span style={{ color: spyChangePct >= 0 ? '#4ade80' : '#ef4444', marginLeft: 4 }}>
                    {spyChangePct >= 0 ? '+' : ''}{spyChangePct.toFixed(2)}%
                  </span>
                )}
              </>
            ) : (
              <span style={{ color: '#666' }}>--</span>
            )}
          </span>
          <span>
            <span style={{ color: '#666' }}>VIX </span>
            {vixValue > 0 ? (
              <span style={{ color: vixValue > 20 ? '#f59e0b' : '#888' }}>{vixValue.toFixed(2)}</span>
            ) : (
              <span style={{ color: '#666' }}>--</span>
            )}
          </span>
        </div>

        {/* Right: NAV + Connection */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          {nav > 0 && (
            <span style={{ color: '#00ffff', fontWeight: 600 }}>
              ${nav.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          )}
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: isConnected ? '#4ade80' : '#ef4444',
              }}
            />
            <span style={{ color: isConnected ? '#4ade80' : '#666', fontSize: 10 }}>
              {isConnected ? 'IBKR' : 'DISC'}
            </span>
          </span>
          <span style={{ color: wsConnected ? '#4ade80' : '#666', fontSize: 10 }}>
            WS:{wsConnected ? 'ON' : 'OFF'}
          </span>
        </div>
      </div>

      {/* Main Area */}
      <main
        style={{
          minHeight: '100vh',
          paddingTop: 32, // Account for status bar
          position: 'relative',
        }}
      >
        <WindowManager windowManager={windowManager} />
      </main>

      {/* Footer */}
      <footer
        style={{
          position: 'fixed',
          bottom: 70, // Above dock
          left: 0,
          right: 0,
          textAlign: 'center',
          fontSize: 10,
          color: '#333',
        }}
      >
        © 2025 APE YOLO · The Safest Way to YOLO
      </footer>

      {/* Dock */}
      <Dock windows={windowManager.windows} onToggle={windowManager.toggleWindow} />
    </div>
  );
}

export default Terminal;
