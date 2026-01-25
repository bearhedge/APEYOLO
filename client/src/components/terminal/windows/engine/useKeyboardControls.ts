/**
 * useKeyboardControls - Keyboard event handling for HUD
 *
 * Controls:
 * [1] [2] [3]    - Select strategy
 * [Arrow keys]  - Adjust strikes/contracts
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
  onStrikeAdjust: (direction: 'wider' | 'tighter') => void;
  onContractAdjust: (direction: 'up' | 'down') => void;
  onModeToggle: () => void;
  onEnter: () => void;
  onEscape: () => void;
  onAnalyze: () => void;
  onRefresh: () => void;
  onShowHelp: () => void;
  onPauseAuto: () => void;
  // Agent command hotkeys
  onVix?: () => void;
  onMarket?: () => void;
  onPositions?: () => void;
}

export function useKeyboardControls({
  enabled,
  onStrategyChange,
  onStrikeAdjust,
  onContractAdjust,
  onModeToggle,
  onEnter,
  onEscape,
  onAnalyze,
  onRefresh,
  onShowHelp,
  onPauseAuto,
  onVix,
  onMarket,
  onPositions,
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

        // Strike adjustment
        case 'ArrowLeft':
          e.preventDefault();
          onStrikeAdjust('tighter');
          break;
        case 'ArrowRight':
          e.preventDefault();
          onStrikeAdjust('wider');
          break;

        // Contract adjustment
        case 'ArrowUp':
          e.preventDefault();
          onContractAdjust('up');
          break;
        case 'ArrowDown':
          e.preventDefault();
          onContractAdjust('down');
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

        // Agent command hotkeys
        case 'v':
        case 'V':
          e.preventDefault();
          onVix?.();
          break;
        case 'm':
        case 'M':
          e.preventDefault();
          onMarket?.();
          break;
        case 'p':
        case 'P':
          e.preventDefault();
          onPositions?.();
          break;
      }
    },
    [
      enabled,
      onStrategyChange,
      onStrikeAdjust,
      onContractAdjust,
      onModeToggle,
      onEnter,
      onEscape,
      onAnalyze,
      onRefresh,
      onShowHelp,
      onPauseAuto,
      onVix,
      onMarket,
      onPositions,
    ]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
