/**
 * Terminal - Single-page dashboard with draggable windows
 *
 * Bear Hedge style: black background, dock at bottom, terminal aesthetic.
 */

import { useEffect } from 'react';
import { WindowManager } from '@/components/terminal/WindowManager';
import { Dock } from '@/components/terminal/Dock';
import { useWindowManager, type WindowId } from '@/hooks/useWindowManager';
import { useQuery } from '@tanstack/react-query';

export function Terminal() {
  const windowManager = useWindowManager();

  // Fetch NAV directly from account endpoint (always works when authenticated)
  const { data: accountData } = useQuery<{
    netLiquidation?: number;
    totalValue?: number;
    portfolioValue?: number;
  }>({
    queryKey: ['/api/account'],
    queryFn: async () => {
      const res = await fetch('/api/account', { credentials: 'include' });
      if (!res.ok) return {};
      return res.json();
    },
    refetchInterval: 10000, // Refresh every 10 seconds
  });

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

  // Get NAV from account data
  const nav = accountData?.netLiquidation || accountData?.totalValue || accountData?.portfolioValue || 0;

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#000',
        fontFamily: "'IBM Plex Mono', monospace",
        overflow: 'hidden',
      }}
    >
      {/* Top Status Bar - NAV only */}
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
          justifyContent: 'flex-end',
          alignItems: 'center',
          padding: '0 16px',
          fontSize: 12,
          zIndex: 1000,
        }}
      >
        {/* Right: NAV */}
        {nav > 0 ? (
          <span style={{ color: '#00ffff', fontWeight: 600, fontSize: 14 }}>
            NAV ${nav.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        ) : (
          <span style={{ color: '#666', fontSize: 12 }}>
            NAV --
          </span>
        )}
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
