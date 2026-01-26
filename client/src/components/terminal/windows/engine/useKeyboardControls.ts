/**
 * useKeyboardControls - Keyboard event handling for HUD (DISABLED)
 *
 * All keyboard shortcuts have been disabled.
 * Actions should be triggered via UI buttons instead.
 */

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

export function useKeyboardControls(_options: KeyboardControlsOptions) {
  // Keyboard shortcuts disabled - no-op hook
  // All actions should be triggered via UI buttons instead
}
