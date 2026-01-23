/**
 * useWindowManager - Hook for managing terminal window state
 *
 * Handles open/close, z-index, positions, and localStorage persistence.
 */

import { useState, useCallback, useEffect } from 'react';

export type WindowId = 'mandate' | 'positions' | 'trades' | 'stats' | 'engine' | 'settings';

export interface WindowState {
  isOpen: boolean;
  zIndex: number;
  position: { x: number; y: number };
  size: { width: number; height: number };
}

export interface WindowConfig {
  id: WindowId;
  title: string;
  defaultPosition: { x: number; y: number };
  defaultSize: { width: number; height: number };
}

export const WINDOW_CONFIGS: WindowConfig[] = [
  { id: 'mandate', title: 'mandate.json', defaultPosition: { x: 60, y: 80 }, defaultSize: { width: 380, height: 400 } },
  { id: 'positions', title: 'positions/', defaultPosition: { x: 480, y: 80 }, defaultSize: { width: 450, height: 350 } },
  { id: 'trades', title: 'trades.log', defaultPosition: { x: 100, y: 200 }, defaultSize: { width: 600, height: 400 } },
  { id: 'stats', title: 'stats.sh', defaultPosition: { x: 200, y: 120 }, defaultSize: { width: 400, height: 350 } },
  { id: 'engine', title: 'engine.exe', defaultPosition: { x: 300, y: 100 }, defaultSize: { width: 500, height: 500 } },
  { id: 'settings', title: 'settings.cfg', defaultPosition: { x: 400, y: 150 }, defaultSize: { width: 450, height: 400 } },
];

const STORAGE_KEY = 'apeyolo-terminal-windows';

function getDefaultStates(): Record<WindowId, WindowState> {
  const states: Record<string, WindowState> = {};
  for (const config of WINDOW_CONFIGS) {
    states[config.id] = {
      isOpen: false,
      zIndex: 1,
      position: config.defaultPosition,
      size: config.defaultSize,
    };
  }
  return states as Record<WindowId, WindowState>;
}

function loadFromStorage(): Record<WindowId, WindowState> | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // Ignore parse errors
  }
  return null;
}

function saveToStorage(states: Record<WindowId, WindowState>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(states));
  } catch {
    // Ignore storage errors
  }
}

export function useWindowManager() {
  const [windows, setWindows] = useState<Record<WindowId, WindowState>>(() => {
    return loadFromStorage() || getDefaultStates();
  });
  const [maxZIndex, setMaxZIndex] = useState(10);

  // Save to localStorage on changes
  useEffect(() => {
    saveToStorage(windows);
  }, [windows]);

  const toggleWindow = useCallback((id: WindowId) => {
    setWindows(prev => ({
      ...prev,
      [id]: {
        ...prev[id],
        isOpen: !prev[id].isOpen,
        zIndex: !prev[id].isOpen ? maxZIndex + 1 : prev[id].zIndex,
      },
    }));
    setMaxZIndex(z => z + 1);
  }, [maxZIndex]);

  const closeWindow = useCallback((id: WindowId) => {
    setWindows(prev => ({
      ...prev,
      [id]: { ...prev[id], isOpen: false },
    }));
  }, []);

  const bringToFront = useCallback((id: WindowId) => {
    setMaxZIndex(z => {
      setWindows(prev => ({
        ...prev,
        [id]: { ...prev[id], zIndex: z + 1 },
      }));
      return z + 1;
    });
  }, []);

  const updatePosition = useCallback((id: WindowId, position: { x: number; y: number }) => {
    setWindows(prev => ({
      ...prev,
      [id]: { ...prev[id], position },
    }));
  }, []);

  const updateSize = useCallback((id: WindowId, size: { width: number; height: number }) => {
    setWindows(prev => ({
      ...prev,
      [id]: { ...prev[id], size },
    }));
  }, []);

  const resetPositions = useCallback(() => {
    setWindows(getDefaultStates());
    setMaxZIndex(10);
  }, []);

  const openWindows = WINDOW_CONFIGS.filter(c => windows[c.id].isOpen);

  return {
    windows,
    configs: WINDOW_CONFIGS,
    openWindows,
    toggleWindow,
    closeWindow,
    bringToFront,
    updatePosition,
    updateSize,
    resetPositions,
  };
}
