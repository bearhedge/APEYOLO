/**
 * CommandMenu - Clickable command overlay for /help
 *
 * Shows available commands as clickable buttons.
 * Each button closes the menu and runs the corresponding command.
 */

import { useEffect, useCallback } from 'react';

type AgentCommand = '/vix' | '/market' | '/positions' | '/analyze';

interface CommandMenuItem {
  command: AgentCommand;
  label: string;
  description: string;
}

const COMMANDS: CommandMenuItem[] = [
  { command: '/vix', label: '/vix', description: 'VIX analysis' },
  { command: '/market', label: '/market', description: 'Market snapshot' },
  { command: '/positions', label: '/positions', description: 'Current holdings' },
  { command: '/analyze', label: '/analyze', description: 'Full analysis' },
];

interface CommandMenuProps {
  onCommand: (command: AgentCommand) => void;
  onClose: () => void;
}

export function CommandMenu({ onCommand, onClose }: CommandMenuProps) {
  // Handle ESC key to close
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleCommandClick = (command: AgentCommand) => {
    onClose();
    onCommand(command);
  };

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#111',
          border: '1px solid #333',
          padding: '20px 24px',
          minWidth: 280,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            color: '#00ffff',
            fontSize: 14,
            fontWeight: 600,
            marginBottom: 16,
            letterSpacing: '0.05em',
          }}
        >
          COMMANDS
        </div>
        <div
          style={{
            borderTop: '1px solid #333',
            marginBottom: 16,
          }}
        />

        {COMMANDS.map((item) => (
          <button
            key={item.command}
            onClick={() => handleCommandClick(item.command)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              width: '100%',
              padding: '10px 12px',
              marginBottom: 8,
              background: '#1a1a1a',
              border: '1px solid #333',
              borderRadius: 2,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              textAlign: 'left',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#222';
              e.currentTarget.style.borderColor = '#00ff00';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#1a1a1a';
              e.currentTarget.style.borderColor = '#333';
            }}
          >
            <span
              style={{
                color: '#00ff00',
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 13,
                fontWeight: 500,
                minWidth: 90,
              }}
            >
              {item.label}
            </span>
            <span
              style={{
                color: '#888',
                fontSize: 12,
              }}
            >
              {item.description}
            </span>
          </button>
        ))}

        <div
          style={{
            marginTop: 16,
            color: '#555',
            fontSize: 11,
            textAlign: 'center',
          }}
        >
          Press ESC to close
        </div>
      </div>
    </div>
  );
}
