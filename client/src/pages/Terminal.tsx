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
