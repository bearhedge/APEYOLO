/**
 * useAgentV2 - Hook for the 5-layer agent architecture
 *
 * Uses the new /api/agent/v2/chat/stream endpoint which provides:
 * - State machine transitions (IDLE -> PLANNING -> EXECUTING -> RESPONDING)
 * - Execution plans with steps
 * - Tool observations
 * - Streaming responses
 */

import { useState, useCallback, useRef } from 'react';
import { useAgentStore } from '@/lib/agentStore';

export type OrchestratorState =
  | 'IDLE'
  | 'PLANNING'
  | 'EXECUTING'
  | 'VALIDATING'
  | 'RESPONDING'
  | 'ERROR';

export interface AgentV2Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
}

export interface ExecutionPlan {
  intent: string;
  confidence: number;
  steps: Array<{
    id: number;
    action: string;
    reason: string;
  }>;
}

interface AgentV2Event {
  type: string;
  [key: string]: unknown;
}

function generateId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function useAgentV2() {
  const [messages, setMessages] = useState<AgentV2Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [state, setState] = useState<OrchestratorState>('IDLE');
  const [plan, setPlan] = useState<ExecutionPlan | null>(null);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const abortControllerRef = useRef<AbortController | null>(null);

  // Get agent store actions for context panel updates
  const { handleSSEEvent, resetState, addActivityEntry, addBrowserScreenshot, clearActivityLog } = useAgentStore.getState();

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || isStreaming) return;

    // Reset state for new message
    resetState();
    clearActivityLog();
    setPlan(null);

    // Add user message
    const userMessage: AgentV2Message = {
      id: generateId(),
      role: 'user',
      content: content.trim(),
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMessage]);
    setIsStreaming(true);

    // Create placeholder for assistant response
    const assistantId = generateId();
    const assistantMessage: AgentV2Message = {
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isStreaming: true,
    };
    setMessages(prev => [...prev, assistantMessage]);

    // Setup abort controller
    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch('/api/agent/v2/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          message: content.trim(),
          conversationId,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Request failed');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';
      let fullContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6)) as AgentV2Event;

              switch (event.type) {
                case 'state_change':
                  setState(event.to as OrchestratorState);
                  // Map orchestrator states to AgentPhase
                  const phaseMap: Record<string, 'idle' | 'thinking' | 'planning' | 'executing' | 'validating' | 'responding' | 'error'> = {
                    IDLE: 'idle',
                    PLANNING: 'planning',
                    EXECUTING: 'executing',
                    VALIDATING: 'validating',
                    RESPONDING: 'responding',
                    ERROR: 'error',
                  };
                  handleSSEEvent({
                    type: 'status',
                    phase: phaseMap[(event.to as string)] || 'idle',
                  });
                  // Add to activity log
                  addActivityEntry({
                    id: `${Date.now()}-state-${event.to}`,
                    timestamp: Date.now(),
                    eventType: 'state_change',
                    title: `State: ${event.from} → ${event.to}`,
                    isExpandable: false,
                  });
                  break;

                case 'plan_ready':
                  setPlan(event.plan as ExecutionPlan);
                  // Show plan in context panel
                  handleSSEEvent({
                    type: 'plan',
                    steps: (event.plan as ExecutionPlan).steps.map(s => ({
                      id: s.id,
                      description: s.reason,
                      status: 'pending',
                    })),
                  });
                  break;

                case 'step_start':
                  handleSSEEvent({
                    type: 'step',
                    stepId: event.stepId as number,
                    status: 'running' as const,
                  });
                  break;

                case 'step_complete':
                  handleSSEEvent({
                    type: 'step',
                    stepId: event.stepId as number,
                    status: 'complete' as const,
                  });
                  break;

                case 'thought':
                  // Add thought to activity log
                  addActivityEntry({
                    id: `${Date.now()}-thought`,
                    timestamp: Date.now(),
                    eventType: 'thought',
                    title: (event.content as string)?.slice(0, 60) + ((event.content as string)?.length > 60 ? '...' : ''),
                    isExpandable: false,
                  });
                  break;

                case 'tool_start':
                  handleSSEEvent({
                    type: 'action',
                    tool: event.tool as string,
                    status: 'running',
                    content: `Executing ${event.tool}...`,
                  });
                  // Add to activity log
                  addActivityEntry({
                    id: `${Date.now()}-tool-${event.tool}`,
                    timestamp: Date.now(),
                    eventType: 'tool_start',
                    title: `Calling ${event.tool}`,
                    isExpandable: false,
                  });
                  break;

                case 'tool_done':
                  handleSSEEvent({
                    type: 'action',
                    tool: event.tool as string,
                    status: 'complete' as const,
                    result: event.result,
                  });
                  // Add to activity log
                  addActivityEntry({
                    id: `${Date.now()}-tool-${event.tool}-done`,
                    timestamp: Date.now(),
                    eventType: 'tool_done',
                    title: `${event.tool} completed`,
                    summary: `${event.durationMs || 0}ms`,
                    details: { result: event.result, durationMs: event.durationMs as number },
                    isExpandable: true,
                  });
                  // Update context panel with tool results
                  if (event.tool === 'getMarketData' && event.result) {
                    const data = event.result as {
                      spy?: { price?: number };
                      vix?: { level?: number };
                      market?: { isOpen?: boolean };
                    };
                    handleSSEEvent({
                      type: 'context',
                      context: {
                        spyPrice: data.spy?.price || 0,
                        vix: data.vix?.level || 0,
                        marketOpen: data.market?.isOpen || false,
                        lastUpdate: Date.now(),
                      },
                    });
                  }
                  break;

                case 'browser_screenshot':
                  // Handle browser screenshot event
                  if (event.data) {
                    const screenshotData = event.data as { base64: string; url: string; timestamp: number };
                    addBrowserScreenshot(screenshotData);
                  }
                  break;

                case 'tool_error':
                  handleSSEEvent({
                    type: 'action',
                    tool: event.tool as string,
                    status: 'error',
                    error: event.error as string,
                  });
                  // Add to activity log
                  addActivityEntry({
                    id: `${Date.now()}-tool-${event.tool}-error`,
                    timestamp: Date.now(),
                    eventType: 'tool_error',
                    title: `${event.tool} failed`,
                    summary: 'error',
                    details: { result: { error: event.error } },
                    isExpandable: true,
                  });
                  break;

                case 'response_chunk':
                  fullContent += event.content as string;
                  setMessages(prev =>
                    prev.map(m =>
                      m.id === assistantId
                        ? { ...m, content: fullContent }
                        : m
                    )
                  );
                  break;

                case 'done':
                  if (event.finalResponse) {
                    fullContent = event.finalResponse as string;
                  }
                  setMessages(prev =>
                    prev.map(m =>
                      m.id === assistantId
                        ? { ...m, content: fullContent || 'Done.', isStreaming: false }
                        : m
                    )
                  );
                  break;

                case 'error':
                  throw new Error((event.error as string) || 'Agent error');
              }
            } catch (parseError) {
              if (parseError instanceof SyntaxError) continue;
              throw parseError;
            }
          }
        }
      }

      // Finalize message
      setMessages(prev =>
        prev.map(m =>
          m.id === assistantId
            ? { ...m, isStreaming: false }
            : m
        )
      );
    } catch (error: unknown) {
      const err = error as Error;
      if (err.name === 'AbortError') {
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantId
              ? { ...m, content: m.content + ' [cancelled]', isStreaming: false }
              : m
          )
        );
      } else {
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantId
              ? { ...m, content: `Error: ${err.message}`, isStreaming: false }
              : m
          )
        );
      }
      setState('ERROR');
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  }, [conversationId, isStreaming, handleSSEEvent, resetState]);

  const cancelStreaming = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setConversationId(undefined);
    setPlan(null);
    setState('IDLE');
    resetState();
  }, [resetState]);

  return {
    messages,
    isStreaming,
    state,
    plan,
    sendMessage,
    cancelStreaming,
    clearMessages,
  };
}
