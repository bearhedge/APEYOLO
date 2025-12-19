/**
 * useAgentOperator - Hook for operator-style agent interactions
 *
 * Manages:
 * - Activity feed (structured log of operations)
 * - Quick actions (analyze, propose, positions)
 * - Trade proposals and execution
 * - SSE streaming for real-time updates
 */

import { useState, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ActivityEntryData, ActivityType } from '@/components/agent/ActivityEntry';
import type { TradeProposal, CritiqueResult, ExecutionResult } from '@/components/agent/TradeProposalCard';

// Types
export type OperationType = 'analyze' | 'propose' | 'positions' | 'execute' | 'custom';

interface AgentStatus {
  online: boolean;
  model?: string;
  error?: string;
}

interface OperateSSEEvent {
  type: 'status' | 'action' | 'result' | 'thinking' | 'proposal' | 'critique' | 'execution' | 'done' | 'error';
  phase?: string;
  tool?: string;
  content?: string;
  data?: any;
  proposal?: TradeProposal;
  critique?: CritiqueResult;
  executionResult?: ExecutionResult;
  error?: string;
}

/**
 * Generate unique ID for activities
 */
function generateId(): string {
  return `act_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Fetch agent status
 */
async function fetchAgentStatus(): Promise<AgentStatus> {
  const response = await fetch('/api/agent/status');
  if (!response.ok) {
    return { online: false, error: 'Failed to fetch status' };
  }
  const data = await response.json();
  return {
    online: data.online ?? false,
    model: data.model,
    error: data.error,
  };
}

interface UseAgentOperatorOptions {
  enableStatusPolling?: boolean;
}

/**
 * Hook for operator-style agent interactions
 */
export function useAgentOperator(options: UseAgentOperatorOptions = {}) {
  const { enableStatusPolling = true } = options;

  const queryClient = useQueryClient();
  const [activities, setActivities] = useState<ActivityEntryData[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeProposal, setActiveProposal] = useState<TradeProposal | null>(null);
  const [activeCritique, setActiveCritique] = useState<CritiqueResult | null>(null);
  const [executionResult, setExecutionResult] = useState<ExecutionResult | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Agent status query
  const statusQuery = useQuery<AgentStatus>({
    queryKey: ['/api/agent/status'],
    queryFn: fetchAgentStatus,
    enabled: enableStatusPolling,
    refetchInterval: 30000,
    staleTime: 10000,
    retry: 1,
  });

  /**
   * Add an activity to the feed
   */
  const addActivity = useCallback((
    type: ActivityType,
    content: string,
    tool?: string,
    status?: 'running' | 'done' | 'error'
  ): string => {
    const id = generateId();
    const entry: ActivityEntryData = {
      id,
      type,
      timestamp: new Date(),
      content,
      tool,
      status,
    };
    setActivities(prev => [...prev, entry]);
    return id;
  }, []);

  /**
   * Update an existing activity
   */
  const updateActivity = useCallback((id: string, updates: Partial<ActivityEntryData>) => {
    setActivities(prev => prev.map(a => a.id === id ? { ...a, ...updates } : a));
  }, []);

  /**
   * Perform an operation (analyze, propose, positions, custom)
   */
  const operate = useCallback(async (
    operation: OperationType,
    params?: { message?: string; proposalId?: string }
  ) => {
    if (isProcessing && operation !== 'execute') return;

    // Clear previous proposal when starting new operation
    if (operation === 'analyze' || operation === 'propose') {
      setActiveProposal(null);
      setActiveCritique(null);
      setExecutionResult(null);
    }

    setIsProcessing(true);
    abortControllerRef.current = new AbortController();

    // Add initial activity
    const actionLabels: Record<OperationType, string> = {
      analyze: 'Analyzing market conditions...',
      propose: 'Finding trading opportunity...',
      positions: 'Fetching current positions...',
      execute: 'Executing trade...',
      custom: 'Processing request...',
    };

    const actionId = addActivity('action', actionLabels[operation], operation, 'running');

    try {
      const response = await fetch('/api/agent/operate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          operation,
          message: params?.message,
          proposalId: params?.proposalId,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Operation failed');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6)) as OperateSSEEvent;
              handleSSEEvent(event, actionId);
            } catch (parseError) {
              if (parseError instanceof SyntaxError) continue;
              throw parseError;
            }
          }
        }
      }

      // Mark action as done
      updateActivity(actionId, { status: 'done' });

    } catch (error: any) {
      if (error.name === 'AbortError') {
        updateActivity(actionId, { status: 'error', content: 'Operation cancelled' });
      } else {
        updateActivity(actionId, { status: 'error' });
        addActivity('error', error.message || 'Operation failed');
      }
    } finally {
      setIsProcessing(false);
      abortControllerRef.current = null;
    }
  }, [isProcessing, addActivity, updateActivity]);

  /**
   * Handle SSE events from the server
   */
  const handleSSEEvent = useCallback((event: OperateSSEEvent, actionId: string) => {
    switch (event.type) {
      case 'status':
        // Phase change - could add visual indicator
        break;

      case 'action':
        // Tool being called
        if (event.tool && event.content) {
          addActivity('action', event.content, event.tool, 'running');
        }
        break;

      case 'result':
        // Tool result - format and display
        if (event.content) {
          addActivity('result', event.content);
        }
        break;

      case 'thinking':
        // DeepSeek reasoning - always visible
        if (event.content) {
          addActivity('thinking', event.content);
        }
        break;

      case 'proposal':
        // Trade proposal ready
        if (event.proposal) {
          setActiveProposal(event.proposal);
          addActivity('info', `Trade opportunity found: ${event.proposal.strategy} on ${event.proposal.symbol}`);
        }
        break;

      case 'critique':
        // Qwen validation result
        if (event.critique) {
          setActiveCritique(event.critique);
          addActivity('info', `Validation: ${event.critique.approved ? 'Approved' : 'Rejected'} (${event.critique.riskLevel} risk)`);
        }
        break;

      case 'execution':
        // Trade execution result
        if (event.executionResult) {
          setExecutionResult(event.executionResult);
        }
        break;

      case 'error':
        addActivity('error', event.error || 'Unknown error');
        break;

      case 'done':
        // Operation complete
        break;
    }
  }, [addActivity]);

  /**
   * Execute the active proposal
   */
  const executeProposal = useCallback(async () => {
    if (!activeProposal || !activeCritique?.approved) return;

    setIsExecuting(true);
    await operate('execute', { proposalId: activeProposal.id });
    setIsExecuting(false);
  }, [activeProposal, activeCritique, operate]);

  /**
   * Dismiss the active proposal
   */
  const dismissProposal = useCallback(() => {
    setActiveProposal(null);
    setActiveCritique(null);
    setExecutionResult(null);
    addActivity('info', 'Trade proposal dismissed');
  }, [addActivity]);

  /**
   * Stop current operation
   */
  const stopOperation = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

  /**
   * Clear activity history
   */
  const clearActivities = useCallback(() => {
    setActivities([]);
    setActiveProposal(null);
    setActiveCritique(null);
    setExecutionResult(null);
  }, []);

  /**
   * Refresh agent status
   */
  const refreshStatus = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['/api/agent/status'] });
  }, [queryClient]);

  return {
    // Status
    isOnline: statusQuery.data?.online ?? false,
    model: statusQuery.data?.model,
    statusError: statusQuery.data?.error,
    isCheckingStatus: statusQuery.isLoading,

    // Activities
    activities,
    isProcessing,

    // Proposal
    activeProposal,
    activeCritique,
    executionResult,
    isExecuting,

    // Actions
    operate,
    executeProposal,
    dismissProposal,
    stopOperation,
    clearActivities,
    refreshStatus,
  };
}
