/**
 * Agent Context Panel - Manus-style Interface
 *
 * Clean, minimal, functional design inspired by Manus AI:
 * - APEYOLO Workspace: Key-value data from agent tools
 * - Task Progress: Numbered steps with checkmarks
 * - Status controls at bottom
 *
 * No emojis, minimal colors, functional design.
 */

import { useAgentStore, AgentPhase, type TaskStep } from '@/lib/agentStore';
import { useQuery } from '@tanstack/react-query';
import { getAccount } from '@/lib/api';
import { useBrokerStatus } from '@/hooks/useBrokerStatus';

// Types for IBKR market data (from /api/agent/market)
interface IBKRMarketData {
  success: boolean;
  spy: {
    price: number;
    change: number;
    changePercent: number;
  } | null;
  vix: {
    current: number;
    regime: string;
  } | null;
  market: {
    isOpen: boolean;
    canTrade: boolean;
    currentTime?: string;
    reason?: string;  // e.g., "Weekend - market closed"
  };
  regime?: {
    shouldTrade: boolean;
    reason: string;
  };
  source: 'ibkr';
  timestamp: string;
}

// Fetch market data from IBKR
async function fetchIBKRMarket(): Promise<IBKRMarketData> {
  const response = await fetch('/api/agent/market', {
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error('Failed to fetch IBKR market data');
  }
  return response.json();
}

// Helper to format phase display
function formatPhase(phase: AgentPhase): string {
  const phaseMap: Record<AgentPhase, string> = {
    idle: 'IDLE',
    thinking: 'THINKING',
    planning: 'PLANNING',
    executing: 'EXECUTING',
    validating: 'VALIDATING',
    responding: 'RESPONDING',
    error: 'ERROR',
  };
  return phaseMap[phase] || phase.toUpperCase();
}

// Card wrapper component - minimal design
function Card({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-dark-gray border border-white/20 ${className}`}>
      <div className="px-4 py-3 border-b border-white/10">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-silver">{title}</h3>
      </div>
      <div className="p-4">
        {children}
      </div>
    </div>
  );
}

// ============================================
// APEYOLO WORKSPACE - Key-value data display
// ============================================

function APEYOLOWorkspace() {
  const { workspaceData } = useAgentStore();
  const { connected: brokerConnected } = useBrokerStatus();

  // Fallback to market data if workspace is empty (idle state)
  const { data: market } = useQuery({
    queryKey: ['/api/agent/market'],
    queryFn: fetchIBKRMarket,
    refetchInterval: 15000,
    staleTime: 5000,
  });
  const { data: account } = useQuery({
    queryKey: ['/api/account'],
    queryFn: getAccount,
  });

  // Merge workspace data with fallback market data
  const displayData: Record<string, string> = { ...workspaceData };
  const isMarketClosed = market?.market && !market.market.isOpen;

  // If workspace is empty, show default market data
  if (Object.keys(displayData).length === 0) {
    if (market?.spy?.price) {
      // Label as "Last Close" when market is closed
      const spyLabel = isMarketClosed ? 'SPY (Last)' : 'SPY';
      displayData[spyLabel] = `$${market.spy.price.toFixed(2)}`;
    }
    if (market?.vix?.current) {
      // Label as "Last Close" when market is closed
      const vixLabel = isMarketClosed ? 'VIX (Last)' : 'VIX';
      displayData[vixLabel] = `${market.vix.current.toFixed(2)} (${market.vix.regime || 'N/A'})`;
    }
    if (market?.market) {
      // Show status with reason when closed
      if (market.market.isOpen) {
        displayData['Market'] = 'OPEN';
      } else {
        // Extract short reason (e.g., "Weekend" from "Weekend - market closed")
        const shortReason = market.market.reason?.split(' - ')[0] || 'CLOSED';
        displayData['Market'] = shortReason;
      }
    }
    displayData['Broker'] = brokerConnected ? 'Connected' : 'Disconnected';
    if (account?.nav) {
      displayData['NAV'] = `$${account.nav.toLocaleString()}`;
    }
  }

  const entries = Object.entries(displayData);

  return (
    <Card title="APEYOLO Workspace">
      <div className="space-y-2 text-sm font-mono">
        {entries.length === 0 ? (
          <div className="text-silver/50 text-center py-2">
            No data yet
          </div>
        ) : (
          entries.map(([key, value]) => (
            <div key={key} className="flex justify-between items-center">
              <span className="text-silver">{key}</span>
              <span className="text-white tabular-nums">{value}</span>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

// ============================================
// TASK PROGRESS - Manus-style numbered steps
// ============================================

function TaskProgress() {
  const { taskSteps, phase } = useAgentStore();

  // Calculate progress
  const completedCount = taskSteps.filter(s => s.status === 'complete').length;
  const totalCount = taskSteps.length;

  // Get step indicator - text only, no colors
  const getStepIndicator = (step: TaskStep): string => {
    switch (step.status) {
      case 'complete':
        return '\u2713'; // checkmark
      case 'running':
        return '\u2192'; // arrow
      case 'error':
        return '\u2717'; // x mark
      default:
        return ' '; // space for pending
    }
  };

  // Get step text style
  const getStepStyle = (step: TaskStep): string => {
    switch (step.status) {
      case 'complete':
        return 'text-white';
      case 'running':
        return 'text-white';
      case 'error':
        return 'text-silver/70';
      default:
        return 'text-silver/50';
    }
  };

  const isExecuting = phase === 'executing';

  return (
    <Card title="Task Progress">
      <div className="space-y-2 text-sm font-mono min-h-[60px]">
        {taskSteps.length === 0 ? (
          <div className="text-silver/50 text-center py-2">
            {isExecuting ? (
              <span>Preparing tasks...</span>
            ) : (
              <span>No active tasks</span>
            )}
          </div>
        ) : (
          <>
            {taskSteps.map((step) => (
              <div key={step.id} className={`flex items-start gap-3 ${getStepStyle(step)}`}>
                <span className="w-4 text-center flex-shrink-0">
                  {getStepIndicator(step)}
                </span>
                <span className="flex-shrink-0 w-4">{step.id}.</span>
                <span className="flex-1">{step.description}</span>
              </div>
            ))}

            {/* Progress counter */}
            <div className="pt-3 mt-3 border-t border-white/10 flex justify-end">
              <span className="text-xs text-silver tabular-nums">
                {completedCount}/{totalCount}
              </span>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

// ============================================
// STATUS BOX - Agent status and controls
// ============================================

function StatusBox() {
  const { phase, isRunning, startAgent, stopAgent, resetState, clearTaskSteps } = useAgentStore();

  const handleReset = () => {
    resetState();
    clearTaskSteps();
  };

  return (
    <Card title="Status">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-silver">Phase</span>
          <span className="text-xs font-medium text-white">
            {formatPhase(phase)}
          </span>
        </div>

        <div className="flex gap-2 pt-2 border-t border-white/10">
          {!isRunning ? (
            <button
              onClick={startAgent}
              className="flex-1 px-3 py-1.5 text-xs font-medium bg-white/10 hover:bg-white/20 transition-colors"
            >
              Start Agent
            </button>
          ) : (
            <button
              onClick={stopAgent}
              className="flex-1 px-3 py-1.5 text-xs font-medium bg-white/10 hover:bg-white/20 transition-colors"
            >
              Stop
            </button>
          )}
          <button
            onClick={handleReset}
            className="px-3 py-1.5 text-xs font-medium bg-white/10 hover:bg-white/20 transition-colors"
          >
            Reset
          </button>
        </div>
      </div>
    </Card>
  );
}

// ============================================
// MINIMAL STATUS BAR (for active states)
// ============================================

function MinimalStatusBar() {
  const { phase, stopAgent, clearTaskSteps } = useAgentStore();

  const handleStop = () => {
    stopAgent();
    clearTaskSteps();
  };

  return (
    <div className="px-4 py-3 bg-dark-gray border-t border-white/20 flex items-center justify-between">
      <span className="flex items-center gap-2">
        <span className="w-2 h-2 bg-white/50 rounded-full animate-pulse" />
        <span className="text-xs font-medium text-white">
          {formatPhase(phase)}
        </span>
      </span>
      <button
        onClick={handleStop}
        className="px-3 py-1 text-xs font-medium text-silver hover:text-white hover:bg-white/10 transition-colors"
      >
        Stop
      </button>
    </div>
  );
}

// ============================================
// MAIN COMPONENT
// ============================================

export function AgentContextPanel() {
  const { phase } = useAgentStore();

  // Determine if we're in an active state
  const isActive = phase !== 'idle';

  return (
    <div className="w-96 h-full flex flex-col bg-charcoal border-l border-white/20">
      {/* WORKSPACE - Data collected by agent */}
      <div className="px-4 pt-4">
        <APEYOLOWorkspace />
      </div>

      {/* TASK PROGRESS - Manus-style numbered steps */}
      <div className="px-4 pt-4">
        <TaskProgress />
      </div>

      {/* Spacer to push status to bottom */}
      <div className="flex-1" />

      {/* STATUS - Agent status and controls */}
      {isActive ? (
        <MinimalStatusBar />
      ) : (
        <div className="p-4 pt-4">
          <StatusBox />
        </div>
      )}
    </div>
  );
}
