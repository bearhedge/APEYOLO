/**
 * Agent Context Panel
 *
 * Dynamic panel that adapts based on agent phase:
 * - During THINKING: Thinking box expands to fill panel, others collapse
 * - During IDLE: Compact multi-box dashboard view
 *
 * Clean, minimal, professional design - no emojis.
 */

import { useState } from 'react';
import { useAgentStore, AgentPhase } from '@/lib/agentStore';
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
    regime: string; // LOW, ELEVATED, HIGH, EXTREME
  } | null;
  market: {
    isOpen: boolean;
    canTrade: boolean;
    currentTime?: string;
  };
  regime?: {
    shouldTrade: boolean;
    reason: string;
  };
  source: 'ibkr';
  timestamp: string;
}

// Fetch market data from IBKR (the $10/month data you pay for)
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

// Helper to get phase indicator style
function getPhaseStyle(phase: AgentPhase): string {
  switch (phase) {
    case 'thinking':
    case 'planning':
      return 'bg-blue-500/20 text-blue-400';
    case 'executing':
      return 'bg-yellow-500/20 text-yellow-400';
    case 'validating':
      return 'bg-purple-500/20 text-purple-400';
    case 'responding':
      return 'bg-green-500/20 text-green-400';
    case 'error':
      return 'bg-red-500/20 text-red-400';
    default:
      return 'bg-white/10 text-silver';
  }
}

// Card wrapper component
function Card({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-dark-gray p-4 border border-white/20 ${className}`}>
      <div className="flex items-center gap-2 mb-3 pb-2 border-b border-white/10">
        <h3 className="text-xs font-semibold uppercase tracking-wider">{title}</h3>
      </div>
      {children}
    </div>
  );
}

// ============================================
// COMPACT COMPONENTS (for thinking mode)
// ============================================

// Compact single-line context bar
function CompactContextBar() {
  const { data: account } = useQuery({
    queryKey: ['/api/account'],
    queryFn: getAccount,
  });
  const { data: market } = useQuery({
    queryKey: ['/api/agent/market'],
    queryFn: fetchIBKRMarket,
    refetchInterval: 15000, // Refresh every 15 seconds (IBKR data is real-time)
    staleTime: 5000,
  });

  return (
    <div className="px-4 py-2 bg-dark-gray/50 border-y border-white/10 text-xs text-silver flex items-center justify-between">
      <span className="tabular-nums">
        SPY {market?.spy?.price ? `$${market.spy.price.toFixed(2)}` : '--'}
      </span>
      <span className="tabular-nums">
        VIX {market?.vix?.current ? market.vix.current.toFixed(1) : '--'}
      </span>
      <span className="tabular-nums">
        {market?.market?.isOpen ? 'OPEN' : 'CLOSED'}
      </span>
      <span className="tabular-nums">
        ${account?.nav?.toLocaleString() || '0'}
      </span>
    </div>
  );
}

// Minimal status bar with stop button
function MinimalStatusBar() {
  const { phase, stopAgent } = useAgentStore();

  return (
    <div className="px-4 py-3 bg-dark-gray border-t border-white/20 flex items-center justify-between">
      <span className="flex items-center gap-2">
        <span className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" />
        <span className={`text-xs font-medium ${getPhaseStyle(phase).split(' ')[1]}`}>
          {formatPhase(phase)}
        </span>
      </span>
      <button
        onClick={stopAgent}
        className="px-3 py-1 text-xs font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded transition-colors"
      >
        Stop
      </button>
    </div>
  );
}

// ============================================
// FULL COMPONENTS (for idle/other modes)
// ============================================

// Context Box - Market state
function ContextBox() {
  const { data: account } = useQuery({
    queryKey: ['/api/account'],
    queryFn: getAccount,
  });
  const { data: market, isLoading: marketLoading } = useQuery({
    queryKey: ['/api/agent/market'],
    queryFn: fetchIBKRMarket,
    refetchInterval: 15000, // Refresh every 15 seconds (IBKR data is real-time)
    staleTime: 5000,
  });
  const { connected: brokerConnected } = useBrokerStatus();

  // Get VIX regime color (from IBKR analysis)
  const getVixColor = (regime?: string) => {
    switch (regime) {
      case 'LOW': return 'text-green-400';
      case 'NORMAL': return 'text-blue-400';
      case 'ELEVATED': return 'text-yellow-400';
      case 'HIGH': return 'text-orange-400';
      case 'EXTREME': return 'text-red-400';
      default: return '';
    }
  };

  return (
    <Card title="Context">
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-silver">VIX</span>
          <span className={`font-medium tabular-nums ${getVixColor(market?.vix?.regime)}`}>
            {market?.vix?.current ? `${market.vix.current.toFixed(2)} (${market.vix.regime})` : '--'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-silver">SPY</span>
          <span className="font-medium tabular-nums">
            {market?.spy?.price ? `$${market.spy.price.toFixed(2)}` : '--'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-silver">Market</span>
          <span className={`font-medium tabular-nums ${market?.market?.isOpen ? 'text-green-400' : 'text-silver'}`}>
            {market?.market?.isOpen ? (market?.market?.canTrade ? 'OPEN (Can Trade)' : 'OPEN') : 'CLOSED'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-silver">Broker</span>
          <span className={`font-medium tabular-nums ${brokerConnected ? 'text-green-400' : 'text-red-400'}`}>
            {brokerConnected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-silver">NAV</span>
          <span className="font-medium tabular-nums">
            ${account?.nav?.toLocaleString() || '0'}
          </span>
        </div>
      </div>
    </Card>
  );
}

// Thinking Box - AI's chain of thought (live streaming from DeepSeek-R1)
function ThinkingBox({ expanded }: { expanded: boolean }) {
  const { reasoning, reasoningBuffer, phase } = useAgentStore();
  const [manualExpand, setManualExpand] = useState(false);

  const isThinking = phase === 'thinking';
  const displayThinking = reasoning || reasoningBuffer;
  const isExpanded = expanded || manualExpand;

  return (
    <div
      className={`bg-dark-gray border border-white/20 flex flex-col transition-all duration-300 ${
        expanded ? 'flex-1 min-h-0' : ''
      }`}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b border-white/10 cursor-pointer hover:bg-white/5"
        onClick={() => !expanded && setManualExpand(!manualExpand)}
      >
        <h3 className="text-xs font-semibold uppercase tracking-wider flex items-center gap-2">
          Thinking
          {isThinking && (
            <span className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" />
          )}
        </h3>
        {!expanded && displayThinking && (
          <span className="text-xs text-silver/50">
            {manualExpand ? '▼' : '▶'}
          </span>
        )}
      </div>

      {/* Content */}
      <div
        className={`overflow-y-auto scrollbar-thin scrollbar-thumb-white/20 px-4 py-3 ${
          expanded ? 'flex-1' : isExpanded ? 'h-48' : 'h-24'
        }`}
      >
        {displayThinking ? (
          <p className="text-sm text-silver whitespace-pre-wrap leading-relaxed font-mono">
            {displayThinking}
            {isThinking && <span className="animate-pulse text-blue-400">|</span>}
          </p>
        ) : isThinking ? (
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" />
            <p className="text-sm text-silver">Model is thinking...</p>
          </div>
        ) : (
          <p className="text-sm text-silver/50 text-center py-4">
            Thinking will stream here
          </p>
        )}
      </div>
    </div>
  );
}

// Actions Box - Tool calls in progress (always shown)
function ActionsBox() {
  const { actions, phase } = useAgentStore();

  const recentActions = actions.slice(-8);
  const isExecuting = phase === 'executing';

  const getStatusStyle = (status: string) => {
    switch (status) {
      case 'done':
        return 'text-green-400';
      case 'running':
        return 'text-yellow-400';
      case 'error':
        return 'text-red-400';
      default:
        return 'text-silver';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'done':
        return '✓';
      case 'running':
        return '⟳';
      case 'error':
        return '✗';
      default:
        return '○';
    }
  };

  return (
    <Card title="Agent Actions">
      <div className="space-y-2 text-sm min-h-[80px] max-h-48 overflow-y-auto">
        {recentActions.length === 0 ? (
          <div className="text-center py-4 text-silver/50">
            {isExecuting ? (
              <div className="flex items-center justify-center gap-2">
                <span className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse" />
                <span>Executing...</span>
              </div>
            ) : (
              <span>No actions yet</span>
            )}
          </div>
        ) : (
          recentActions.map((action) => (
            <div key={action.id} className="flex items-center gap-2 py-1 border-b border-white/5 last:border-0">
              <span className={`text-xs ${getStatusStyle(action.status)}`}>
                {getStatusIcon(action.status)}
              </span>
              <span className="font-mono text-xs truncate flex-1">
                {action.tool}
              </span>
              <span className={`text-xs ${getStatusStyle(action.status)}`}>
                {action.status === 'running' && (
                  <span className="animate-pulse">running</span>
                )}
                {action.status === 'done' && 'done'}
                {action.status === 'error' && 'error'}
              </span>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

// Status Box - Current phase with controls
function StatusBox() {
  const { phase, isRunning, startAgent, stopAgent, resetState } = useAgentStore();

  return (
    <Card title="Status">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-silver">Phase</span>
          <span className={`px-2 py-0.5 text-xs font-medium rounded ${getPhaseStyle(phase)}`}>
            {formatPhase(phase)}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-silver">Mode</span>
          <span className="text-xs font-medium">Auto with Limits</span>
        </div>

        <div className="flex gap-2 pt-2 border-t border-white/10">
          {!isRunning ? (
            <button
              onClick={startAgent}
              className="flex-1 px-3 py-1.5 text-xs font-medium bg-green-600 hover:bg-green-500 transition-colors"
            >
              Start Agent
            </button>
          ) : (
            <button
              onClick={stopAgent}
              className="flex-1 px-3 py-1.5 text-xs font-medium bg-red-600 hover:bg-red-500 transition-colors"
            >
              Stop
            </button>
          )}
          <button
            onClick={resetState}
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
// MAIN COMPONENT
// ============================================

export function AgentContextPanel() {
  const { phase } = useAgentStore();

  // Determine if we're in an active state
  const isActive = phase !== 'idle';

  return (
    <div className="w-96 h-full flex flex-col bg-charcoal border-l border-white/20">
      {/* CONTEXT - Market data at top */}
      <div className="px-4 pt-4">
        <ContextBox />
      </div>

      {/* ACTIONS - Tool execution status (always shown) */}
      <div className="px-4 pt-4">
        <ActionsBox />
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
