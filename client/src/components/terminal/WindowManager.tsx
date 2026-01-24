/**
 * WindowManager - Renders all terminal windows
 *
 * Maps window configs to Window components with their content.
 */

import { Window } from './Window';
import { useWindowManager, type WindowId } from '@/hooks/useWindowManager';
import { MandateWindow } from './windows/MandateWindow';
import { PositionsWindow } from './windows/PositionsWindow';
import { TradesWindow } from './windows/TradesWindow';
import { StatsWindow } from './windows/StatsWindow';
import { EngineWindow } from './windows/EngineWindow';
import { SettingsWindow } from './windows/SettingsWindow';
import { AgentWindow } from './windows/AgentWindow';
import { JobsWindow } from './windows/JobsWindow';

interface WindowManagerProps {
  windowManager: ReturnType<typeof useWindowManager>;
}

const WINDOW_CONTENT: Record<WindowId, React.ComponentType> = {
  mandate: MandateWindow,
  positions: PositionsWindow,
  trades: TradesWindow,
  stats: StatsWindow,
  engine: EngineWindow,
  settings: SettingsWindow,
  agent: AgentWindow,
  jobs: JobsWindow,
};

export function WindowManager({ windowManager }: WindowManagerProps) {
  const {
    windows,
    configs,
    closeWindow,
    bringToFront,
    updatePosition,
    updateSize,
  } = windowManager;

  return (
    <>
      {configs.map(config => {
        const state = windows[config.id];
        const ContentComponent = WINDOW_CONTENT[config.id];

        return (
          <Window
            key={config.id}
            id={config.id}
            title={config.title}
            isOpen={state.isOpen}
            zIndex={state.zIndex}
            position={state.position}
            size={state.size}
            onClose={() => closeWindow(config.id)}
            onBringToFront={() => bringToFront(config.id)}
            onPositionChange={pos => updatePosition(config.id, pos)}
            onSizeChange={size => updateSize(config.id, size)}
          >
            <ContentComponent />
          </Window>
        );
      })}
    </>
  );
}
