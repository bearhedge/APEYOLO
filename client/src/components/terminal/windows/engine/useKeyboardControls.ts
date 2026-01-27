/**
 * useKeyboardControls - Keyboard event handling for HUD
 *
 * Arrow keys: ↑↓ adjust PUT strike, ←→ adjust CALL strike
 * Enter: Analyze (idle) or Execute (ready)
 * Escape: Reset
 */

import { useEffect } from 'react';
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

export function useKeyboardControls(options: KeyboardControlsOptions) {
  const {
    enabled,
    onStrategyChange,
    onPutStrikeAdjust,
    onCallStrikeAdjust,
    onContractAdjust,
    onModeToggle,
    onEnter,
    onEscape,
    onAnalyze,
    onShowHelp,
    onPauseAuto,
  } = options;

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      console.log('[useKeyboardControls] Key pressed:', e.key);

      switch (e.key) {
        // Strategy selection: 1, 2, 3
        case '1':
          onStrategyChange('strangle');
          break;
        case '2':
          onStrategyChange('put-spread');
          break;
        case '3':
          onStrategyChange('call-spread');
          break;

        // PUT strike adjustment: ↑↓
        case 'ArrowUp':
          e.preventDefault();
          console.log('[useKeyboardControls] PUT strike UP');
          onPutStrikeAdjust('up');
          break;
        case 'ArrowDown':
          e.preventDefault();
          console.log('[useKeyboardControls] PUT strike DOWN');
          onPutStrikeAdjust('down');
          break;

        // CALL strike adjustment: ←→
        case 'ArrowLeft':
          e.preventDefault();
          console.log('[useKeyboardControls] CALL strike DOWN');
          onCallStrikeAdjust('down');
          break;
        case 'ArrowRight':
          e.preventDefault();
          console.log('[useKeyboardControls] CALL strike UP');
          onCallStrikeAdjust('up');
          break;

        // Contract adjustment: +/-
        case '+':
        case '=':
          onContractAdjust('up');
          break;
        case '-':
          onContractAdjust('down');
          break;

        // Mode toggle: Tab
        case 'Tab':
          e.preventDefault();
          onModeToggle();
          break;

        // Enter: Analyze/Execute
        case 'Enter':
          e.preventDefault();
          onEnter();
          break;

        // Escape: Reset
        case 'Escape':
          onEscape();
          break;

        // A: Analyze
        case 'a':
        case 'A':
          onAnalyze();
          break;

        // ?: Show help
        case '?':
          onShowHelp();
          break;

        // Space: Pause auto
        case ' ':
          e.preventDefault();
          onPauseAuto();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    enabled,
    onStrategyChange,
    onPutStrikeAdjust,
    onCallStrikeAdjust,
    onContractAdjust,
    onModeToggle,
    onEnter,
    onEscape,
    onAnalyze,
    onShowHelp,
    onPauseAuto,
  ]);
}
