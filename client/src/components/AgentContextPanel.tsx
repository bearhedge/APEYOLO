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

// Types for market snapshot (matches yahooFinanceService)
interface MarketSnapshot {
  vix: {
    current: number;
    level: 'low' | 'normal' | 'elevated' | 'high';
    change: number;
    changePercent: number;
    trend: 'up' | 'down' | 'flat';
  };
  spy: {
    price: number;
    change: number;
    changePercent: number;
    marketState: 'PRE' | 'REGULAR' | 'POST' | 'CLOSED';
  };
  timestamp: string;
}

// Fetch market snapshot (VIX + SPY in one call)
async function fetchMarketSnapshot(): Promise<MarketSnapshot> {
  const response = await fetch('/api/market/snapshot');
  if (!response.ok) {
    throw new Error('Failed to fetch market snapshot');
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
    queryKey: ['/api/market/snapshot'],
    queryFn: fetchMarketSnapshot,
    refetchInterval: 30000, // Refresh every 30 seconds
    staleTime: 10000,
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
        {market?.spy?.marketState || '--'}
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
    queryKey: ['/api/market/snapshot'],
    queryFn: fetchMarketSnapshot,
    refetchInterval: 30000, // Refresh every 30 seconds
    staleTime: 10000,
  });
  const { connected: brokerConnected } = useBrokerStatus();

  // Get VIX level color
  const getVixColor = (level?: string) => {
    switch (level) {
      case 'low': return 'text-green-400';
      case 'normal': return 'text-blue-400';
      case 'elevated': return 'text-yellow-400';
      case 'high': return 'text-red-400';
      default: return '';
    }
  };

  return (
    <Card title="Context">
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-silver">VIX</span>
          <span className={`font-medium tabular-nums ${getVixColor(market?.vix?.level)}`}>
            {market?.vix?.current ? `${market.vix.current.toFixed(2)} (${market.vix.level.toUpperCase()})` : '--'}
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
          <span className={`font-medium tabular-nums ${market?.spy?.marketState === 'REGULAR' ? 'text-green-400' : 'text-silver'}`}>
            {market?.spy?.marketState || '--'}
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

// Actions Box - Tool calls in progress
function ActionsBox() {
  const { actions } = useAgentStore();

  const recentActions = actions.slice(-5);

  if (recentActions.length === 0) return null;

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

  const getStatusText = (status: string) => {
    switch (status) {
      case 'done':
        return 'Done';
      case 'running':
        return 'Running';
      case 'error':
        return 'Error';
      default:
        return 'Pending';
    }
  };

  return (
    <Card title="Actions">
      <div className="space-y-1 text-sm max-h-24 overflow-y-auto">
        {recentActions.map((action) => (
          <div key={action.id} className="flex items-center justify-between gap-2">
            <span className="font-mono text-xs truncate flex-1">
              {action.tool}
            </span>
            <span className={`text-xs ${getStatusStyle(action.status)}`}>
              {getStatusText(action.status)}
            </span>
          </div>
        ))}
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
  const { phase, actions } = useAgentStore();

  // Determine if we're in an active thinking/processing state
  const isThinking = phase === 'thinking' || phase === 'planning';
  const isExecuting = phase === 'executing';
  const hasActions = actions.length > 0;

  return (
    <div className="w-96 h-full flex flex-col bg-charcoal border-l border-white/20">
      {/* THINKING - Always at top, expands when active */}
      <div className={`p-4 pb-0 ${isThinking ? 'flex-1 flex flex-col min-h-0' : ''}`}>
        <ThinkingBox expanded={isThinking} />
      </div>

      {/* CONTEXT - Compact bar when thinking, full card when idle */}
      {isThinking ? (
        <CompactContextBar />
      ) : (
        <div className="px-4 pt-4">
          <ContextBox />
        </div>
      )}

      {/* ACTIONS - Only show when has actions and not in thinking mode */}
      {!isThinking && hasActions && (
        <div className="px-4 pt-4">
          <ActionsBox />
        </div>
      )}

      {/* Spacer to push status to bottom when not thinking */}
      {!isThinking && <div className="flex-1" />}

      {/* STATUS - Minimal when thinking, full when idle */}
      {isThinking ? (
        <MinimalStatusBar />
      ) : (
        <div className="p-4 pt-4">
          <StatusBox />
        </div>
      )}
    </div>
  );
}
