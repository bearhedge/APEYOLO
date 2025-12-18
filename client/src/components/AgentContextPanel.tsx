/**
 * Agent Context Panel
 *
 * Displays 6 boxes showing the agent's current state:
 * 1. CONTEXT - Market state (VIX, SPY price, positions)
 * 2. REASONING - AI's chain of thought
 * 3. PLAN - Steps the agent intends to take
 * 4. ACTIONS - Tool calls in progress
 * 5. VALIDATION - Critic's assessment
 * 6. STATUS - Current phase with controls
 *
 * Clean, minimal, professional design - no emojis.
 */

import { useAgentStore, AgentPhase } from '@/lib/agentStore';
import { useQuery } from '@tanstack/react-query';
import { getAccount } from '@/lib/api';

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
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-dark-gray p-4 border border-white/20">
      <div className="flex items-center gap-2 mb-3 pb-2 border-b border-white/10">
        <h3 className="text-xs font-semibold uppercase tracking-wider">{title}</h3>
      </div>
      {children}
    </div>
  );
}

// Context Box - Market state
function ContextBox() {
  const { context } = useAgentStore();
  const { data: account } = useQuery({
    queryKey: ['/api/account'],
    queryFn: getAccount,
  });

  return (
    <Card title="Context">
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-silver">VIX</span>
          <span className="font-medium tabular-nums">
            {context.vix > 0 ? context.vix.toFixed(2) : '--'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-silver">SPY</span>
          <span className="font-medium tabular-nums">
            {context.spyPrice > 0 ? `$${context.spyPrice.toFixed(2)}` : '--'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-silver">Positions</span>
          <span className="font-medium tabular-nums">
            {context.positions.length > 0 ? `${context.positions.length} open` : 'None'}
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

// Reasoning Box - AI's chain of thought
function ReasoningBox() {
  const { reasoning, phase } = useAgentStore();

  const isThinking = phase === 'thinking';

  return (
    <Card title="Reasoning">
      <div className="h-32 overflow-y-auto">
        {reasoning ? (
          <p className="text-sm text-silver whitespace-pre-wrap leading-relaxed">
            {reasoning}
          </p>
        ) : isThinking ? (
          <p className="text-sm text-silver italic">Thinking...</p>
        ) : (
          <p className="text-sm text-silver/50 text-center py-4">
            No reasoning yet
          </p>
        )}
      </div>
    </Card>
  );
}

// Plan Box - Steps the agent intends to take
function PlanBox() {
  const { plan } = useAgentStore();

  const getStatusIndicator = (status: string) => {
    switch (status) {
      case 'done':
        return '[x]';
      case 'active':
        return '[>]';
      case 'skipped':
        return '[-]';
      default:
        return '[ ]';
    }
  };

  const getStatusStyle = (status: string) => {
    switch (status) {
      case 'done':
        return 'text-green-400';
      case 'active':
        return 'text-yellow-400';
      case 'skipped':
        return 'text-silver/50 line-through';
      default:
        return 'text-silver';
    }
  };

  return (
    <Card title="Plan">
      <div className="h-24 overflow-y-auto">
        {plan.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {plan.map((step, index) => (
              <li key={index} className={`flex gap-2 ${getStatusStyle(step.status)}`}>
                <span className="font-mono text-xs">{getStatusIndicator(step.status)}</span>
                <span>{index + 1}. {step.step}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-silver/50 text-center py-4">
            No active plan
          </p>
        )}
      </div>
    </Card>
  );
}

// Actions Box - Tool calls in progress
function ActionsBox() {
  const { actions } = useAgentStore();

  // Show last 5 actions
  const recentActions = actions.slice(-5);

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
      <div className="h-24 overflow-y-auto">
        {recentActions.length > 0 ? (
          <div className="space-y-1 text-sm">
            {recentActions.map((action) => (
              <div key={action.id} className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs truncate flex-1">
                  {action.tool}
                </span>
                <span className={`text-xs ${getStatusStyle(action.status)}`}>
                  {getStatusText(action.status)}
                </span>
                {action.result && (
                  <span className="text-xs text-silver truncate max-w-[100px]">
                    {typeof action.result === 'string'
                      ? action.result
                      : JSON.stringify(action.result).slice(0, 20) + '...'}
                  </span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-silver/50 text-center py-4">
            No actions yet
          </p>
        )}
      </div>
    </Card>
  );
}

// Validation Box - Critic's assessment
function ValidationBox() {
  const { validation } = useAgentStore();

  const getStatusStyle = () => {
    switch (validation.status) {
      case 'approved':
        return 'text-green-400';
      case 'rejected':
        return 'text-red-400';
      case 'pending':
        return 'text-yellow-400';
      default:
        return 'text-silver/50';
    }
  };

  const getStatusText = () => {
    switch (validation.status) {
      case 'approved':
        return 'APPROVED';
      case 'rejected':
        return 'REJECTED';
      case 'pending':
        return 'PENDING';
      default:
        return 'Awaiting validation';
    }
  };

  return (
    <Card title="Validation">
      <div className="space-y-2">
        <div className={`text-sm font-medium ${getStatusStyle()}`}>
          {getStatusText()}
        </div>
        {validation.feedback && (
          <p className="text-xs text-silver leading-relaxed">
            {validation.feedback}
          </p>
        )}
        {validation.status === 'none' && (
          <p className="text-sm text-silver/50 text-center py-2">
            No validation required
          </p>
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

// Main AgentContextPanel component
export function AgentContextPanel() {
  return (
    <div className="w-96 bg-charcoal border-l border-white/20 overflow-y-auto">
      <div className="p-4 space-y-4">
        <ContextBox />
        <ReasoningBox />
        <PlanBox />
        <ActionsBox />
        <ValidationBox />
        <StatusBox />
      </div>
    </div>
  );
}
