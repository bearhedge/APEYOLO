/**
 * Dock - Terminal-style dock at bottom of screen
 *
 * Shows $ prompt + blinking cursor + window toggle buttons
 */

import { WINDOW_CONFIGS, type WindowId, type WindowState } from '@/hooks/useWindowManager';

interface DockProps {
  windows: Record<WindowId, WindowState>;
  onToggle: (id: WindowId) => void;
}

export function Dock({ windows, onToggle }: DockProps) {
  return (
    <div
      className="terminal-dock"
      style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        zIndex: 100,
        fontSize: 13,
        fontFamily: "'IBM Plex Mono', monospace",
      }}
    >
      {/* Prompt */}
      <span style={{ color: '#707070', marginRight: 4 }}>$</span>

      {/* Blinking cursor */}
      <span
        style={{
          display: 'inline-block',
          width: 8,
          height: 16,
          background: '#fff',
          animation: 'blink 1s step-end infinite',
          verticalAlign: 'text-bottom',
          marginRight: 12,
        }}
      />

      {/* Window buttons */}
      {WINDOW_CONFIGS.map(config => {
        const isActive = windows[config.id].isOpen;
        return (
          <button
            key={config.id}
            onClick={() => onToggle(config.id)}
            className={`terminal-dock__item ${isActive ? 'active' : ''}`}
            style={{
              padding: '8px 14px',
              background: 'transparent',
              border: '1px solid',
              borderColor: isActive ? '#fff' : '#333',
              color: isActive ? '#fff' : '#888',
              fontSize: 12,
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={e => {
              if (!isActive) {
                e.currentTarget.style.borderColor = '#555';
                e.currentTarget.style.color = '#fff';
              }
            }}
            onMouseLeave={e => {
              if (!isActive) {
                e.currentTarget.style.borderColor = '#333';
                e.currentTarget.style.color = '#888';
              }
            }}
          >
            {config.title}
          </button>
        );
      })}

      {/* Blink animation */}
      <style>{`
        @keyframes blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
