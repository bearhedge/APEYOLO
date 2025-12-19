/**
 * Agent Page - Operator Console
 *
 * Transforms from a chatbot into an operator that executes trading tasks.
 * "Task First, Chat Second" - primary interaction through action buttons.
 */

import { LeftNav } from '@/components/LeftNav';
import { ActivityFeed } from '@/components/agent/ActivityFeed';
import { QuickActionsBar, type OperationType } from '@/components/agent/QuickActionsBar';
import { TradeProposalCard } from '@/components/agent/TradeProposalCard';
import { useAgentOperator } from '@/hooks/useAgentOperator';
import { useBrokerStatus } from '@/hooks/useBrokerStatus';
import { Circle, RefreshCw, AlertTriangle, Trash2 } from 'lucide-react';

export function Agent() {
  const {
    isOnline,
    model,
    isCheckingStatus,
    activities,
    isProcessing,
    activeProposal,
    activeCritique,
    executionResult,
    isExecuting,
    operate,
    executeProposal,
    dismissProposal,
    stopOperation,
    clearActivities,
    refreshStatus,
  } = useAgentOperator({
    enableStatusPolling: true,
  });

  // IBKR broker status
  const {
    connected: ibkrConnected,
    isConnecting: ibkrIsConnecting,
    environment: ibkrEnvironment,
  } = useBrokerStatus();

  // Agent can only operate if both LLM and IBKR are connected
  const canOperate = isOnline && ibkrConnected;

  // Handle quick action
  const handleAction = (action: OperationType, customMessage?: string) => {
    operate(action, { message: customMessage });
  };

  return (
    <div className="flex h-[calc(100vh-64px)]">
      <LeftNav />

      <div className="flex-1 flex flex-col">
        {/* Status Bar */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-white/10 bg-charcoal">
          <div className="flex items-center gap-4">
            {/* LLM Status */}
            <div className="flex items-center gap-2">
              <Circle
                className={`w-2.5 h-2.5 ${
                  isOnline ? 'fill-green-500 text-green-500' : 'fill-red-500 text-red-500'
                }`}
              />
              <span className="text-sm font-medium">
                {isOnline ? 'LLM Online' : 'LLM Offline'}
              </span>
              {isOnline && model && (
                <span className="text-xs text-silver">({model})</span>
              )}
            </div>

            {/* IBKR Status */}
            <div className="flex items-center gap-2 border-l border-white/10 pl-4">
              <Circle
                className={`w-2.5 h-2.5 ${
                  ibkrConnected
                    ? 'fill-green-500 text-green-500'
                    : ibkrIsConnecting
                    ? 'fill-yellow-500 text-yellow-500'
                    : 'fill-red-500 text-red-500'
                }`}
              />
              <span className="text-sm font-medium">
                {ibkrConnected
                  ? 'IBKR Connected'
                  : ibkrIsConnecting
                  ? 'IBKR Connecting...'
                  : 'IBKR Disconnected'}
              </span>
              {ibkrConnected && (
                <span className={`text-xs px-1.5 py-0.5 rounded ${
                  ibkrEnvironment === 'live'
                    ? 'bg-red-500/20 text-red-400'
                    : 'bg-blue-500/20 text-blue-400'
                }`}>
                  {ibkrEnvironment === 'live' ? 'LIVE' : 'Paper'}
                </span>
              )}
            </div>

            {/* Warning if not fully operational */}
            {!canOperate && (
              <div className="flex items-center gap-1 text-amber-400 text-xs">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>
                  {!isOnline && !ibkrConnected
                    ? 'LLM and IBKR required'
                    : !isOnline
                    ? 'LLM required'
                    : 'IBKR required for live data'}
                </span>
              </div>
            )}

            {/* Processing indicator */}
            {isProcessing && (
              <div className="flex items-center gap-2 border-l border-white/10 pl-4">
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                <span className="text-xs text-blue-400">Processing...</span>
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2">
            <button
              onClick={refreshStatus}
              disabled={isCheckingStatus}
              className="p-1.5 text-silver hover:text-white transition-colors disabled:opacity-50"
              title="Refresh status"
            >
              <RefreshCw className={`w-4 h-4 ${isCheckingStatus ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={clearActivities}
              className="p-1.5 text-silver hover:text-white transition-colors"
              title="Clear activity log"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Activity Feed */}
          <ActivityFeed
            activities={activities}
            isProcessing={isProcessing}
            emptyMessage="Ready to operate. Use the buttons below to analyze markets or find trades."
          />

          {/* Trade Proposal Card (when active) */}
          {activeProposal && (
            <div className="p-4 border-t border-white/10">
              <TradeProposalCard
                proposal={activeProposal}
                critique={activeCritique ?? undefined}
                executionResult={executionResult ?? undefined}
                isExecuting={isExecuting}
                onExecute={executeProposal}
                onReject={dismissProposal}
              />
            </div>
          )}
        </div>

        {/* Quick Actions Bar */}
        <QuickActionsBar
          onAction={handleAction}
          isProcessing={isProcessing}
          canOperate={canOperate}
          onStop={stopOperation}
        />
      </div>
    </div>
  );
}
