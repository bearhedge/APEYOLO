/**
 * useAgentChat - Hook for AI agent chat functionality
 *
 * Manages:
 * - Agent connection status
 * - Chat message history
 * - Streaming responses
 * - Send/receive messages
 */

import { useState, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAgentStore, type AgentSSEEvent } from '@/lib/agentStore';

export interface ChatMessage {
  id: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
}

export interface AgentStatus {
  online: boolean;
  model?: string;
  error?: string;
}

interface ChatResponse {
  success: boolean;
  message?: { role: 'assistant'; content: string };
  stats?: { totalDuration?: number; evalCount?: number };
  error?: string;
  offline?: boolean;
}

/**
 * Fetch agent status from API
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

/**
 * Send chat message (non-streaming)
 */
async function sendChatMessage(
  messages: Array<{ role: string; content: string }>
): Promise<ChatResponse> {
  const response = await fetch('/api/agent/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ messages }),
  });

  const data = await response.json();
  return data;
}

/**
 * Generate unique message ID
 */
function generateId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

interface UseAgentChatOptions {
  /** System prompt for the agent */
  systemPrompt?: string;
  /** Whether to enable status polling */
  enableStatusPolling?: boolean;
}

/**
 * Hook for AI agent chat functionality
 */
export function useAgentChat(options: UseAgentChatOptions = {}) {
  const {
    systemPrompt,
    enableStatusPolling = true,
  } = options;

  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Agent status query
  const statusQuery = useQuery<AgentStatus>({
    queryKey: ['/api/agent/status'],
    queryFn: fetchAgentStatus,
    enabled: enableStatusPolling,
    refetchInterval: 30000, // Poll every 30s
    staleTime: 10000,
    retry: 1,
  });

  // Non-streaming chat mutation
  const chatMutation = useMutation({
    mutationFn: sendChatMessage,
    onError: (error: Error) => {
      console.error('[useAgentChat] Chat error:', error);
    },
  });

  /**
   * Send a message to the agent (non-streaming)
   */
  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim()) return;

    // Add user message
    const userMessage: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: content.trim(),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);

    // Build messages array for API
    const apiMessages: Array<{ role: string; content: string }> = [];

    // Add system prompt if provided
    if (systemPrompt) {
      apiMessages.push({ role: 'system', content: systemPrompt });
    }

    // Add conversation history (last 20 messages)
    const historyMessages = [...messages, userMessage]
      .slice(-20)
      .map(m => ({ role: m.role, content: m.content }));

    apiMessages.push(...historyMessages);

    try {
      const response = await chatMutation.mutateAsync(apiMessages);

      if (response.success && response.message) {
        const assistantMessage: ChatMessage = {
          id: generateId(),
          role: 'assistant',
          content: response.message.content,
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, assistantMessage]);
      } else {
        // Add error message
        const errorMessage: ChatMessage = {
          id: generateId(),
          role: 'assistant',
          content: response.offline
            ? 'Agent is currently offline. Please try again later.'
            : `Error: ${response.error || 'Unknown error'}`,
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, errorMessage]);
      }
    } catch (error: any) {
      const errorMessage: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: `Connection error: ${error.message || 'Failed to reach agent'}`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
    }
  }, [messages, systemPrompt, chatMutation]);

  /**
   * Send a message with streaming response
   * Now also updates the agent store with structured events
   */
  const sendMessageStreaming = useCallback(async (content: string) => {
    if (!content.trim() || isStreaming) return;

    // Get agent store actions
    const { handleSSEEvent, resetState } = useAgentStore.getState();

    // Reset agent state for new conversation turn
    resetState();

    // Add user message
    const userMessage: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: content.trim(),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setIsStreaming(true);

    // Create placeholder for assistant message
    const assistantId = generateId();
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isStreaming: true,
    };
    setMessages(prev => [...prev, assistantMessage]);

    // Build messages array for API
    const apiMessages: Array<{ role: string; content: string }> = [];
    if (systemPrompt) {
      apiMessages.push({ role: 'system', content: systemPrompt });
    }
    const historyMessages = [...messages, userMessage]
      .slice(-20)
      .map(m => ({ role: m.role, content: m.content }));
    apiMessages.push(...historyMessages);

    // Setup abort controller
    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch('/api/agent/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ messages: apiMessages }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Stream request failed');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';
      let fullContent = '';
      let fullReasoning = ''; // Accumulate reasoning for chat display

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6)) as AgentSSEEvent;

              // Only forward action/status events to agent store (for right panel display)
              // Don't forward reasoning - it will show in the chat instead
              if (data.type === 'action' || data.type === 'status' || data.type === 'context') {
                handleSSEEvent(data);
              }

              // Handle specific events for chat display
              switch (data.type) {
                case 'reasoning':
                  // Accumulate reasoning for chat display (don't send to agentStore)
                  if (data.content && !data.isComplete) {
                    fullReasoning += data.content;
                    // Show reasoning in chat as it streams
                    const displayContent = fullReasoning
                      ? `<think>\n${fullReasoning}\n</think>\n\n${fullContent}`
                      : fullContent;
                    setMessages(prev =>
                      prev.map(m =>
                        m.id === assistantId
                          ? { ...m, content: displayContent }
                          : m
                      )
                    );
                  }
                  break;

                case 'chunk':
                  // Response content (after reasoning)
                  if (data.content) {
                    fullContent += data.content;
                    const displayContent = fullReasoning
                      ? `<think>\n${fullReasoning}\n</think>\n\n${fullContent}`
                      : fullContent;
                    setMessages(prev =>
                      prev.map(m =>
                        m.id === assistantId
                          ? { ...m, content: displayContent }
                          : m
                      )
                    );
                  }
                  break;

                case 'done':
                  // Use fullContent from done event if available
                  // Include reasoning if present
                  const finalReasoning = data.reasoning || fullReasoning;
                  const finalResponse = data.fullContent || fullContent;
                  const finalDisplay = finalReasoning
                    ? `<think>\n${finalReasoning}\n</think>\n\n${finalResponse}`
                    : finalResponse;
                  setMessages(prev =>
                    prev.map(m =>
                      m.id === assistantId
                        ? { ...m, content: finalDisplay, isStreaming: false }
                        : m
                    )
                  );
                  break;

                case 'error':
                  throw new Error(data.error || 'Unknown error');
              }
            } catch (parseError) {
              // Skip non-JSON lines
              if (parseError instanceof SyntaxError) continue;
              throw parseError;
            }
          }
        }
      }

      // Mark streaming complete
      setMessages(prev =>
        prev.map(m =>
          m.id === assistantId
            ? { ...m, isStreaming: false }
            : m
        )
      );
    } catch (error: any) {
      if (error.name === 'AbortError') {
        // User cancelled - update the message
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantId
              ? { ...m, content: m.content + ' [cancelled]', isStreaming: false }
              : m
          )
        );
        handleSSEEvent({ type: 'status', phase: 'idle' });
      } else {
        // Replace streaming message with error
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantId
              ? {
                  ...m,
                  content: `Error: ${error.message || 'Stream failed'}`,
                  isStreaming: false,
                }
              : m
          )
        );
        handleSSEEvent({ type: 'error', error: error.message });
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  }, [messages, systemPrompt, isStreaming]);

  /**
   * Cancel ongoing streaming
   */
  const cancelStreaming = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

  /**
   * Clear chat history
   */
  const clearMessages = useCallback(() => {
    setMessages([]);
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

    // Messages
    messages,
    isStreaming,
    isSending: chatMutation.isPending,

    // Actions
    sendMessage,
    sendMessageStreaming,
    cancelStreaming,
    clearMessages,
    refreshStatus,
  };
}
