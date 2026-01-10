/**
 * useAgentV2 - Hook for the 5-layer agent architecture
 *
 * Uses the new /api/agent/v2/chat/stream endpoint which provides:
 * - State machine transitions (IDLE -> PLANNING -> EXECUTING -> RESPONDING)
 * - Execution plans with steps
 * - Tool observations
 * - Streaming responses
 */

import { useState, useCallback, useRef, useEffect } from 'react';
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

const CONVERSATION_STORAGE_KEY = 'apeyolo_conversation_id';

function generateId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

// Load conversationId from localStorage on init
function loadStoredConversationId(): string | undefined {
  try {
    return localStorage.getItem(CONVERSATION_STORAGE_KEY) || undefined;
  } catch {
    return undefined;
  }
}

// Save conversationId to localStorage
function saveConversationId(id: string | undefined) {
  try {
    if (id) {
      localStorage.setItem(CONVERSATION_STORAGE_KEY, id);
    } else {
      localStorage.removeItem(CONVERSATION_STORAGE_KEY);
    }
  } catch {
    // Ignore localStorage errors
  }
}

export function useAgentV2() {
  const [messages, setMessages] = useState<AgentV2Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [state, setState] = useState<OrchestratorState>('IDLE');
  const [plan, setPlan] = useState<ExecutionPlan | null>(null);
  const [conversationId, setConversationId] = useState<string | undefined>(loadStoredConversationId);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Get agent store actions for context panel updates
  const { handleSSEEvent, resetState, addActivityEntry, addBrowserScreenshot, clearActivityLog } = useAgentStore.getState();

  // Auto-load conversation from server on mount if we have a stored conversationId
  useEffect(() => {
    const storedConvId = loadStoredConversationId();
    if (storedConvId && messages.length === 0 && !isLoadingHistory) {
      // Load conversation history from server
      setIsLoadingHistory(true);
      fetch(`/api/agent/conversations/${storedConvId}`, {
        credentials: 'include',
      })
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data?.success && data.conversation?.messages?.length > 0) {
            const loadedMessages: AgentV2Message[] = data.conversation.messages.map((m: {
              id: number;
              role: 'user' | 'assistant';
              content: string;
              createdAt: string;
            }) => ({
              id: `msg_${m.id}`,
              role: m.role,
              content: m.content,
              timestamp: new Date(m.createdAt),
            }));
            setMessages(loadedMessages);
            setConversationId(storedConvId);
          }
        })
        .catch(err => {
          console.warn('[useAgentV2] Failed to restore conversation:', err);
          // Clear invalid conversationId
          saveConversationId(undefined);
        })
        .finally(() => {
          setIsLoadingHistory(false);
        });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on mount

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
                  // Capture conversationId from server for persistence
                  if (event.conversationId) {
                    const newConvId = event.conversationId as string;
                    setConversationId(newConvId);
                    saveConversationId(newConvId);
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
    saveConversationId(undefined); // Clear localStorage
    setPlan(null);
    setState('IDLE');
    resetState();
  }, [resetState]);

  /**
   * Start a new conversation (clears history and localStorage)
   */
  const newConversation = useCallback(() => {
    clearMessages();
  }, [clearMessages]);

  /**
   * Load a specific conversation from the server
   */
  const loadConversation = useCallback(async (convId: string) => {
    setIsLoadingHistory(true);
    try {
      const response = await fetch(`/api/agent/conversations/${convId}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to load conversation');
      }

      const data = await response.json();
      if (!data.success || !data.conversation) {
        throw new Error('Invalid conversation data');
      }

      const conv = data.conversation;

      // Convert server messages to AgentV2Message format
      const loadedMessages: AgentV2Message[] = conv.messages.map((m: {
        id: number;
        role: 'user' | 'assistant';
        content: string;
        createdAt: string;
      }) => ({
        id: `msg_${m.id}`,
        role: m.role,
        content: m.content,
        timestamp: new Date(m.createdAt),
      }));

      setMessages(loadedMessages);
      setConversationId(convId);
      saveConversationId(convId);
      setPlan(null);
      setState('IDLE');
    } catch (error) {
      console.error('[useAgentV2] Failed to load conversation:', error);
      throw error;
    } finally {
      setIsLoadingHistory(false);
    }
  }, []);

  return {
    messages,
    isStreaming,
    isLoadingHistory,
    state,
    plan,
    conversationId,
    sendMessage,
    cancelStreaming,
    clearMessages,
    newConversation,
    loadConversation,
  };
}
