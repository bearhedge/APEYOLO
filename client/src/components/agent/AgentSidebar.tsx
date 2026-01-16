/**
 * Agent Sidebar - Collapsible operator console for Trade page
 *
 * Extracted from Agent.tsx to be used as sidebar on Trade page.
 * Supports collapsed (60px icon strip) and expanded (500px full console) states.
 *
 * The expanded sidebar shows the unified execution log (ActivityFeed) which now
 * includes transparent tool-use logging from the Engine and all Agent operations.
 */

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import toast from 'react-hot-toast';
import { ActivityFeed } from '@/components/agent/ActivityFeed';
import type { ActivityEntryData } from '@/components/agent/ActivityEntry';
import { TradeProposalCard, type ModificationImpact, type NegotiationMessage } from '@/components/agent/TradeProposalCard';
import { AgentContextPanel } from '@/components/AgentContextPanel';
import { useAgentOperator } from '@/hooks/useAgentOperator';
import { useAgentV2 } from '@/hooks/useAgentV2';
import { useBrokerStatus } from '@/hooks/useBrokerStatus';
import { ChatInput } from '@/components/agent/ChatInput';
import { ChevronsLeft, ChevronsRight, Circle, AlertTriangle } from 'lucide-react';

interface AgentSidebarProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export function AgentSidebar({ isCollapsed, onToggleCollapse }: AgentSidebarProps) {
  const {
    isOnline,
    model,
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
    updateProposal,
  } = useAgentOperator({
    enableStatusPolling: true,
  });

  // V2 Agent hook for chat functionality
  const {
    messages: v2Messages,
    isStreaming,
    sendMessage,
  } = useAgentV2();

  // IBKR broker status
  const {
    connected: ibkrConnected,
    isConnecting: ibkrIsConnecting,
    environment: ibkrEnvironment,
  } = useBrokerStatus();

  // Agent can only operate if both LLM and IBKR are connected
  const canOperate = isOnline && ibkrConnected;

  // Negotiation state
  const [negotiationMessages, setNegotiationMessages] = useState<NegotiationMessage[]>([]);

  // Ref to always have latest proposal (fixes stale closure on first click)
  const activeProposalRef = useRef(activeProposal);
  useEffect(() => {
    activeProposalRef.current = activeProposal;
  }, [activeProposal]);

  // Merge operator activities with V2 chat messages into unified feed
  const unifiedActivities = useMemo((): ActivityEntryData[] => {
    // Defensive checks: ensure both are arrays
    const safeActivities = Array.isArray(activities) ? activities : [];
    const safeMessages = Array.isArray(v2Messages) ? v2Messages : [];

    // Convert V2 messages to activity format
    const chatActivities: ActivityEntryData[] = safeMessages.map(msg => ({
      id: msg.id,
      type: msg.role === 'user' ? 'user-message' : 'assistant-message',
      timestamp: msg.timestamp,
      content: msg.content,
      status: msg.isStreaming ? 'running' : undefined,
    }));

    // Merge and sort by timestamp
    const merged = [...safeActivities, ...chatActivities];
    merged.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    return merged;
  }, [activities, v2Messages]);

  // Handle strike modification - calls /api/agent/negotiate
  const handleModifyStrike = useCallback(async (legIndex: number, newStrike: number): Promise<ModificationImpact | null> => {
    // Use ref to always get latest proposal (fixes stale closure on first click)
    const proposal = activeProposalRef.current;
    if (!proposal?.id) {
      console.warn('[AgentSidebar] handleModifyStrike: No active proposal');
      return null;
    }

    try {
      const response = await fetch('/api/agent/negotiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          proposalId: proposal.id,
          legIndex,
          newStrike,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        console.error('Negotiate failed:', data.error);
        toast.error(data.error || 'Failed to adjust strike');
        return null;
      }

      // Update the active proposal with new values from server
      if (data.updatedProposal) {
        updateProposal({
          legs: data.updatedProposal.legs,
          entryPremiumTotal: data.updatedProposal.entryPremiumTotal,
          maxLoss: data.updatedProposal.maxLoss,
          stopLossPrice: data.updatedProposal.stopLossPrice,
        });
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
  }, [updateProposal]);

  // Clear negotiation messages when proposal changes
  const handleDismissProposal = useCallback(() => {
    setNegotiationMessages([]);
    dismissProposal();
  }, [dismissProposal]);

  // Collapsed state: show icon strip only
  if (isCollapsed) {
    return (
      <div className="w-[60px] border-l border-white/10 bg-charcoal flex flex-col items-center py-4 gap-4">
        <button
          onClick={onToggleCollapse}
          className="p-2 text-silver hover:text-white transition-colors"
          title="Expand Agent"
        >
          <ChevronsLeft className="w-5 h-5" />
        </button>

        {/* Status indicators (vertical) */}
        <div className="flex flex-col items-center gap-3 mt-4">
          {/* LLM Status */}
          <div className="flex flex-col items-center gap-1">
            <Circle
              className={`w-2.5 h-2.5 ${
                isOnline ? 'fill-green-500 text-green-500' : 'fill-red-500 text-red-500'
              }`}
            />
            <span className="text-[9px] text-silver">LLM</span>
          </div>

          {/* IBKR Status */}
          <div className="flex flex-col items-center gap-1">
            <Circle
              className={`w-2.5 h-2.5 ${
                ibkrConnected
                  ? 'fill-green-500 text-green-500'
                  : ibkrIsConnecting
                  ? 'fill-yellow-500 text-yellow-500'
                  : 'fill-red-500 text-red-500'
              }`}
            />
            <span className="text-[9px] text-silver">IBKR</span>
          </div>

          {/* Warning if not operational */}
          {!canOperate && (
            <AlertTriangle className="w-4 h-4 text-amber-400 mt-2" />
          )}
        </div>
      </div>
    );
  }

  // Expanded state: full operator console (45% of remaining space after LeftNav)
  return (
    <div
      className="border-l border-white/10 bg-charcoal flex flex-col h-full"
      style={{ flex: '45 0 0' }}
    >
      {/* Header with collapse button */}
      <div className="flex items-center justify-between px-4 md:px-6 py-3 md:py-4 border-b border-white/10">
        <div className="flex items-center gap-4">
          {/* LLM Status */}
          <div className="flex items-center gap-2">
            <Circle
              className={`w-2.5 h-2.5 ${
                isOnline ? 'fill-green-500 text-green-500' : 'fill-red-500 text-red-500'
              }`}
            />
            <span className="text-xs font-medium">
              {isOnline ? 'LLM Online' : 'LLM Offline'}
            </span>
            {isOnline && model && (
              <span className="text-[10px] text-silver">({model})</span>
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
            <span className="text-xs font-medium">
              {ibkrConnected
                ? 'IBKR'
                : ibkrIsConnecting
                ? 'Connecting...'
                : 'Disconnected'}
            </span>
            {ibkrConnected && (
              <span className={`text-[10px] px-1 py-0.5 rounded ${
                ibkrEnvironment === 'live'
                  ? 'bg-red-500/20 text-red-400'
                  : 'bg-blue-500/20 text-blue-400'
              }`}>
                {ibkrEnvironment === 'live' ? 'LIVE' : 'Paper'}
              </span>
            )}
          </div>
        </div>

        <button
          onClick={onToggleCollapse}
          className="p-1.5 text-silver hover:text-white transition-colors"
          title="Collapse Agent"
        >
          <ChevronsRight className="w-4 h-4" />
        </button>
      </div>

      {/* Warning if not fully operational */}
      {!canOperate && (
        <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/20">
          <div className="flex items-center gap-2 text-amber-400 text-xs">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>
              {!isOnline && !ibkrConnected
                ? 'LLM and IBKR required'
                : !isOnline
                ? 'LLM required'
                : 'IBKR required for live data'}
            </span>
          </div>
        </div>
      )}

      {/* Processing indicator */}
      {isProcessing && (
        <div className="px-4 py-2 bg-blue-500/10 border-b border-blue-500/20">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
            <span className="text-xs text-blue-400">Processing...</span>
          </div>
        </div>
      )}

      {/* Main Content Area - scrollable */}
      <div className="flex-1 flex flex-col overflow-y-auto">
        {/* Unified Activity Feed (operator activities + chat messages) */}
        <ActivityFeed
          activities={unifiedActivities}
          isProcessing={isProcessing || isStreaming}
          emptyMessage="Ready to operate. Click 'Analyze Market' or chat to interact with the agent."
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
              isNegotiating={true}
              onModifyStrike={handleModifyStrike}
              negotiationMessages={negotiationMessages}
            />
          </div>
        )}
      </div>

      {/* Chat Input for V2 agent */}
      <ChatInput
        onSend={sendMessage}
        isStreaming={isStreaming}
        disabled={!isOnline}
        placeholder="Ask the agent anything..."
      />
    </div>
  );
}
