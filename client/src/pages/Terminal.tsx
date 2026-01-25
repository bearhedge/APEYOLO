/**
 * Terminal - Single-page dashboard with draggable windows
 *
 * Bear Hedge style: black background, dock at bottom, terminal aesthetic.
 */

import { useEffect } from 'react';
import { WindowManager } from '@/components/terminal/WindowManager';
import { Dock } from '@/components/terminal/Dock';
import { useWindowManager, type WindowId } from '@/hooks/useWindowManager';

export function Terminal() {
  const windowManager = useWindowManager();

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

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#000',
        fontFamily: "'IBM Plex Mono', monospace",
        overflow: 'hidden',
      }}
    >
      {/* Docs Button - Top Right */}
      <button
        onClick={() => windowManager.toggleWindow('docs')}
        style={{
          position: 'fixed',
          top: 16,
          right: 16,
          padding: '6px 12px',
          background: windowManager.windows.docs.isOpen ? '#1a1a1a' : 'transparent',
          border: '1px solid #333',
          color: windowManager.windows.docs.isOpen ? '#87ceeb' : '#666',
          fontSize: 11,
          fontFamily: "'IBM Plex Mono', monospace",
          cursor: 'pointer',
          zIndex: 1000,
          transition: 'all 0.15s ease',
        }}
        onMouseEnter={e => {
          if (!windowManager.windows.docs.isOpen) {
            e.currentTarget.style.borderColor = '#555';
            e.currentTarget.style.color = '#888';
          }
        }}
        onMouseLeave={e => {
          if (!windowManager.windows.docs.isOpen) {
            e.currentTarget.style.borderColor = '#333';
            e.currentTarget.style.color = '#666';
          }
        }}
      >
        [?] docs
      </button>

      {/* Main Area */}
      <main
        style={{
          minHeight: '100vh',
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
