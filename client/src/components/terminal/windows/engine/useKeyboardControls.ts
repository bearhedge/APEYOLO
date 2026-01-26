/**
 * useKeyboardControls - Keyboard event handling for HUD
 *
 * Controls:
 * [1] [2] [3]    - Select strategy
 * [↑] [↓]       - Adjust put strike
 * [←] [→]       - Adjust call strike
 * [Tab]         - Toggle AUTO/MANUAL
 * [Enter]       - Execute main action
 * [Esc]         - Cancel/Reset
 * [Space]       - Pause auto-mode
 * [A]           - Analyze now
 * [R]           - Refresh market data
 * [?]           - Show help overlay
 */

import { useEffect, useCallback } from 'react';
import type { Strategy } from './SelectionBar';

interface KeyboardControlsOptions {
  enabled: boolean;
  onStrategyChange: (s: Strategy) => void;
  onPutStrikeAdjust: (direction: 'up' | 'down') => void;
  onCallStrikeAdjust: (direction: 'up' | 'down') => void;
  onContractAdjust: (direction: 'up' | 'down') => void;
  onModeToggle: () => void;
  onEnter: () => void;
  onEscape: () => void;
  onAnalyze: () => void;
  onRefresh: () => void;
  onShowHelp: () => void;
  onPauseAuto: () => void;
}

export function useKeyboardControls({
  enabled,
  onStrategyChange,
  onPutStrikeAdjust,
  onCallStrikeAdjust,
  onContractAdjust,
  onModeToggle,
  onEnter,
  onEscape,
  onAnalyze,
  onRefresh,
  onShowHelp,
  onPauseAuto,
}: KeyboardControlsOptions) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return;

      // Don't capture if user is typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      switch (e.key) {
        // Strategy selection
        case '1':
          e.preventDefault();
          onStrategyChange('put-spread');
          break;
        case '2':
          e.preventDefault();
          onStrategyChange('call-spread');
          break;
        case '3':
          e.preventDefault();
          onStrategyChange('strangle');
          break;

        // Put strike adjustment (Up/Down)
        case 'ArrowUp':
          e.preventDefault();
          onPutStrikeAdjust('up');
          break;
        case 'ArrowDown':
          e.preventDefault();
          onPutStrikeAdjust('down');
          break;

        // Call strike adjustment (Left/Right)
        case 'ArrowLeft':
          e.preventDefault();
          onCallStrikeAdjust('down');
          break;
        case 'ArrowRight':
          e.preventDefault();
          onCallStrikeAdjust('up');
          break;

        // Mode toggle
        case 'Tab':
          e.preventDefault();
          onModeToggle();
          break;

        // Actions
        case 'Enter':
          e.preventDefault();
          onEnter();
          break;
        case 'Escape':
          e.preventDefault();
          onEscape();
          break;

        // Quick actions
        case 'a':
        case 'A':
          e.preventDefault();
          onAnalyze();
          break;
        case 'r':
        case 'R':
          e.preventDefault();
          onRefresh();
          break;
        case '?':
          e.preventDefault();
          onShowHelp();
          break;
        case ' ':
          e.preventDefault();
          onPauseAuto();
          break;
      }
    },
    [
      enabled,
      onStrategyChange,
      onPutStrikeAdjust,
      onCallStrikeAdjust,
      onContractAdjust,
      onModeToggle,
      onEnter,
      onEscape,
      onAnalyze,
      onRefresh,
      onShowHelp,
      onPauseAuto,
    ]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
