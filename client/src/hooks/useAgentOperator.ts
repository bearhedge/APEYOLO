/**
 * useAgentOperator - Hook for operator-style agent interactions
 *
 * Manages:
 * - Activity feed (structured log of operations)
 * - Quick actions (analyze, propose, positions)
 * - Trade proposals and execution
 * - SSE streaming for real-time updates
 * - State persistence via sessionStorage
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ActivityEntryData, ActivityType } from '@/components/agent/ActivityEntry';
import type { TradeProposal, CritiqueResult, ExecutionResult } from '@/components/agent/TradeProposalCard';
import { useAgentStore } from '@/lib/agentStore';

// =============================================================================
// Session Storage Helpers (persist state across page navigation)
// =============================================================================

const STORAGE_KEYS = {
  activities: 'agent_activities',
  activeProposal: 'agent_active_proposal',
  activeCritique: 'agent_active_critique',
  executionResult: 'agent_execution_result',
} as const;

function getFromSession<T>(key: string, fallback: T): T {
  try {
    const stored = sessionStorage.getItem(key);
    if (!stored) return fallback;
    const parsed = JSON.parse(stored);
    // Special handling for activities - restore Date objects
    if (key === STORAGE_KEYS.activities && Array.isArray(parsed)) {
      return parsed.map((a: any) => ({
        ...a,
        timestamp: new Date(a.timestamp),
      })) as T;
    }
    return parsed;
  } catch {
    return fallback;
  }
}

function persistToSession(key: string, data: any): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(data));
  } catch (err) {
    console.warn('[AgentOperator] Failed to persist to sessionStorage:', err);
  }
}

function clearFromSession(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Ignore
  }
}

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
  // Streaming flags - server sends accumulated content with these flags
  isUpdate?: boolean;   // Content is accumulated (update existing activity)
  isComplete?: boolean; // Final content (mark as complete)
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

  // Get store actions for forwarding SSE events to AgentContextPanel
  const storeHandleSSEEvent = useAgentStore(state => state.handleSSEEvent);
  const storeSetPhase = useAgentStore(state => state.setPhase);
  const storeResetState = useAgentStore(state => state.resetState);

  // Initialize state from sessionStorage for persistence across navigation
  // Filter out activities older than 30 minutes to prevent stale data
  // IMPORTANT: Convert timestamp strings back to Date objects (JSON serialization loses Date type)
  const [activities, setActivities] = useState<ActivityEntryData[]>(() => {
    const loaded = getFromSession<ActivityEntryData[]>(STORAGE_KEYS.activities, []);
    const MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes
    const now = Date.now();
    return loaded
      .map(a => ({ ...a, timestamp: new Date(a.timestamp) })) // Convert string to Date
      .filter(a => (now - a.timestamp.getTime()) < MAX_AGE_MS);
  });
  const [isProcessing, setIsProcessing] = useState(false); // Don't persist - should reset
  const [activeProposal, setActiveProposal] = useState<TradeProposal | null>(
    () => getFromSession(STORAGE_KEYS.activeProposal, null)
  );
  const [activeCritique, setActiveCritique] = useState<CritiqueResult | null>(
    () => getFromSession(STORAGE_KEYS.activeCritique, null)
  );
  const [executionResult, setExecutionResult] = useState<ExecutionResult | null>(
    () => {
      const loaded = getFromSession<ExecutionResult | null>(STORAGE_KEYS.executionResult, null);
      // Convert timestamp string back to Date (JSON serialization loses Date type)
      return loaded ? { ...loaded, timestamp: new Date(loaded.timestamp) } : null;
    }
  );
  const [isExecuting, setIsExecuting] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Refs for tracking streaming activities (to update instead of create new)
  const streamingThinkingIdRef = useRef<string | null>(null);
  const streamingResultIdRef = useRef<string | null>(null);
  // Track last tool action to mark it done when result arrives
  const lastToolActionIdRef = useRef<string | null>(null);

  // Persist state changes to sessionStorage
  useEffect(() => {
    // Don't persist empty state (allows clear to work properly)
    if (activities.length === 0) return;
    // Keep only last 50 activities to prevent storage overflow
    const toStore = activities.slice(-50);
    persistToSession(STORAGE_KEYS.activities, toStore);
  }, [activities]);

  useEffect(() => {
    if (activeProposal) {
      persistToSession(STORAGE_KEYS.activeProposal, activeProposal);
    } else {
      clearFromSession(STORAGE_KEYS.activeProposal);
    }
  }, [activeProposal]);

  useEffect(() => {
    if (activeCritique) {
      persistToSession(STORAGE_KEYS.activeCritique, activeCritique);
    } else {
      clearFromSession(STORAGE_KEYS.activeCritique);
    }
  }, [activeCritique]);

  useEffect(() => {
    if (executionResult) {
      persistToSession(STORAGE_KEYS.executionResult, executionResult);
    } else {
      clearFromSession(STORAGE_KEYS.executionResult);
    }
  }, [executionResult]);

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

    // Reset streaming refs for new operation
    streamingThinkingIdRef.current = null;
    streamingResultIdRef.current = null;
    lastToolActionIdRef.current = null;

    // Reset agent store state for context panel
    storeResetState();

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
  }, [isProcessing, addActivity, updateActivity, storeResetState]);

  /**
   * Handle SSE events from the server
   *
   * For streaming events (thinking, result), we:
   * - Create a new activity on first update (isUpdate=true, no existing ID)
   * - Update existing activity on subsequent updates (isUpdate=true, has ID)
   * - Mark as complete on final event (isComplete=true)
   */
  const handleSSEEvent = useCallback((event: OperateSSEEvent, actionId: string) => {
    // Forward events to agentStore for AgentContextPanel display
    // Map event types from operator format to store format
    const forwardToStore = () => {
      switch (event.type) {
        case 'status':
          if (event.phase) {
            storeSetPhase(event.phase as any);
          }
          break;
        case 'thinking':
          // Map to reasoning event
          storeHandleSSEEvent({
            type: 'reasoning',
            content: event.content,
            isComplete: event.isComplete,
          });
          break;
        case 'result':
          // Map to chunk event for response display
          storeHandleSSEEvent({
            type: 'chunk',
            content: event.content,
          });
          break;
        case 'action':
          // Forward tool action
          storeHandleSSEEvent({
            type: 'action',
            tool: event.tool,
            args: event.data,
          });
          break;
        case 'critique':
          // Map to validation event
          if (event.critique) {
            storeHandleSSEEvent({
              type: 'validation',
              approved: event.critique.approved,
              feedback: event.critique.reasoning,
            });
          }
          break;
        case 'done':
          storeHandleSSEEvent({ type: 'done' });
          break;
        case 'error':
          storeHandleSSEEvent({ type: 'error', error: event.error });
          break;
      }
    };
    forwardToStore();

    switch (event.type) {
      case 'status':
        // Phase change - could add visual indicator
        break;

      case 'action':
        // Tool being called - track the action ID to mark it done later
        if (event.tool && event.content) {
          const id = addActivity('action', event.content, event.tool, 'running');
          lastToolActionIdRef.current = id;
        }
        break;

      case 'result':
        // Tool result - handle streaming updates
        if (event.content) {
          // Mark the previous tool action as done (if any)
          if (lastToolActionIdRef.current) {
            updateActivity(lastToolActionIdRef.current, { status: 'done' });
            lastToolActionIdRef.current = null;
          }

          if (event.isUpdate || event.isComplete) {
            // Streaming result - update existing or create new
            if (streamingResultIdRef.current) {
              // Update existing result activity
              updateActivity(streamingResultIdRef.current, {
                content: event.content,
                status: event.isComplete ? 'done' : 'running',
              });
              if (event.isComplete) {
                streamingResultIdRef.current = null;
              }
            } else {
              // Create new result activity
              const id = addActivity('result', event.content, undefined, event.isComplete ? 'done' : 'running');
              if (!event.isComplete) {
                streamingResultIdRef.current = id;
              }
            }
          } else {
            // Non-streaming result (e.g., tool output) - just add it
            addActivity('result', event.content);
          }
        }
        break;

      case 'thinking':
        // DeepSeek reasoning - handle streaming updates
        if (event.content) {
          if (event.isUpdate || event.isComplete) {
            // Streaming thinking - update existing or create new
            if (streamingThinkingIdRef.current) {
              // Update existing thinking activity
              updateActivity(streamingThinkingIdRef.current, {
                content: event.content,
                status: event.isComplete ? 'done' : 'running',
              });
              if (event.isComplete) {
                streamingThinkingIdRef.current = null;
              }
            } else {
              // Create new thinking activity
              const id = addActivity('thinking', event.content, undefined, event.isComplete ? 'done' : 'running');
              if (!event.isComplete) {
                streamingThinkingIdRef.current = id;
              }
            }
          } else {
            // Non-streaming thinking (e.g., propose operation) - just add it
            addActivity('thinking', event.content);
          }
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
        // Operation complete - reset streaming refs and mark any pending action as done
        if (lastToolActionIdRef.current) {
          updateActivity(lastToolActionIdRef.current, { status: 'done' });
        }
        streamingThinkingIdRef.current = null;
        streamingResultIdRef.current = null;
        lastToolActionIdRef.current = null;
        break;
    }
  }, [addActivity, updateActivity, storeHandleSSEEvent, storeSetPhase]);

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
   * Clear activity history and sessionStorage
   */
  const clearActivities = useCallback(() => {
    // Clear sessionStorage FIRST to prevent race condition with persist effect
    Object.values(STORAGE_KEYS).forEach(clearFromSession);
    // Then update state
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

  /**
   * Update active proposal with partial data (e.g., after strike modification)
   */
  const updateProposal = useCallback((updates: Partial<TradeProposal>) => {
    setActiveProposal(prev => prev ? { ...prev, ...updates } : null);
  }, []);

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
    updateProposal,
  };
}
