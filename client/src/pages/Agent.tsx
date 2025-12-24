/**
 * Agent Page - Operator Console
 *
 * Transforms from a chatbot into an operator that executes trading tasks.
 * "Task First, Chat Second" - primary interaction through action buttons.
 * Supports trade negotiation with interactive strike adjustment.
 */

import { useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { LeftNav } from '@/components/LeftNav';
import { ActivityFeed } from '@/components/agent/ActivityFeed';
import { QuickActionsBar, type OperationType } from '@/components/agent/QuickActionsBar';
import { TradeProposalCard, type ModificationImpact, type NegotiationMessage } from '@/components/agent/TradeProposalCard';
import { AgentContextPanel } from '@/components/AgentContextPanel';
import { useAgentOperator } from '@/hooks/useAgentOperator';
import { useBrokerStatus } from '@/hooks/useBrokerStatus';
import { Circle, RefreshCw, AlertTriangle, Trash2 } from 'lucide-react';
import type { StrategyPreference } from '@shared/types/engine';

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
    updateProposal,
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

  // Negotiation state
  const [isNegotiating, setIsNegotiating] = useState(true); // Enable negotiation by default when proposal exists
  const [negotiationMessages, setNegotiationMessages] = useState<NegotiationMessage[]>([]);

  // Strategy preference state (PUT-only, CALL-only, or Strangle)
  const [strategyPreference, setStrategyPreference] = useState<StrategyPreference>('strangle');

  // Handle strike modification - calls /api/agent/negotiate
  const handleModifyStrike = useCallback(async (legIndex: number, newStrike: number): Promise<ModificationImpact | null> => {
    if (!activeProposal?.id) return null;

    try {
      const response = await fetch('/api/agent/negotiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          proposalId: activeProposal.id,
          legIndex,
          newStrike,
        }),
      });

      const data = await response.json();
      console.log('[Agent] negotiate response:', data);

      if (!response.ok || !data.success) {
        console.error('Negotiate failed:', data.error);
        toast.error(data.error || 'Failed to adjust strike');
        return null;
      }

      // Update the active proposal with new values from server
      // This refreshes premium, maxLoss, stopLoss, etc.
      if (data.updatedProposal) {
        console.log('[Agent] Updating proposal with:', data.updatedProposal);
        updateProposal({
          legs: data.updatedProposal.legs,
          entryPremiumTotal: data.updatedProposal.entryPremiumTotal,
          maxLoss: data.updatedProposal.maxLoss,
          stopLossPrice: data.updatedProposal.stopLossPrice,
        });
      } else {
        console.warn('[Agent] No updatedProposal in response');
      }

      // Add agent message to negotiation history
      if (data.impact?.reasoning) {
        setNegotiationMessages(prev => [
          ...prev,
          {
            role: 'agent' as const,
            content: data.impact.reasoning,
            timestamp: new Date(),
          },
        ]);
      }

      return data.impact as ModificationImpact;
    } catch (error) {
      console.error('Failed to negotiate:', error);
      return null;
    }
  }, [activeProposal?.id, updateProposal]);

  // Clear negotiation messages when proposal changes
  const handleDismissProposal = useCallback(() => {
    setNegotiationMessages([]);
    dismissProposal();
  }, [dismissProposal]);

  // Handle quick action
  const handleAction = (action: OperationType, options?: { message?: string; strategy?: StrategyPreference }) => {
    // Clear previous negotiation messages when starting new action
    if (action === 'propose') {
      setNegotiationMessages([]);
    }
    operate(action, { message: options?.message, strategy: options?.strategy });
  };

  return (
    <div className="flex h-[calc(100vh-64px)]">
      <LeftNav />

      {/* Main content + Right panel container */}
      <div className="flex-1 flex">
        {/* Main content column */}
        <div className="flex-1 flex flex-col min-w-0">
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

        {/* Main Content Area - scrollable */}
        <div className="flex-1 flex flex-col overflow-y-auto">
          {/* Activity Feed */}
          <ActivityFeed
            activities={activities}
            isProcessing={isProcessing}
            emptyMessage="Ready to operate. Use the buttons below to analyze markets or find trades."
          />

          {/* Trade Proposal Card (when active) */}
          {activeProposal && (
            <div className="p-4 border-t border-white/10 flex-shrink-0">
              <TradeProposalCard
                proposal={activeProposal}
                critique={activeCritique ?? undefined}
                executionResult={executionResult ?? undefined}
                isExecuting={isExecuting}
                onExecute={executeProposal}
                onReject={handleDismissProposal}
                isNegotiating={isNegotiating}
                onModifyStrike={handleModifyStrike}
                negotiationMessages={negotiationMessages}
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
          strategy={strategyPreference}
          onStrategyChange={setStrategyPreference}
        />
        </div>

        {/* Right Panel - Agent Context & Reasoning */}
        <AgentContextPanel />
      </div>
    </div>
  );
}
