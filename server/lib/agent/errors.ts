/**
 * Agent Error Classification System
 *
 * Provides specific, user-friendly error messages instead of generic
 * "something went wrong" responses.
 */

export enum AgentErrorType {
  // LLM-related errors
  LLM_TIMEOUT = 'LLM_TIMEOUT',
  LLM_UNAVAILABLE = 'LLM_UNAVAILABLE',
  LLM_PARSE_ERROR = 'LLM_PARSE_ERROR',
  LLM_RATE_LIMITED = 'LLM_RATE_LIMITED',

  // Tool execution errors
  TOOL_TIMEOUT = 'TOOL_TIMEOUT',
  TOOL_NOT_FOUND = 'TOOL_NOT_FOUND',
  TOOL_EXECUTION_FAILED = 'TOOL_EXECUTION_FAILED',

  // Broker errors
  IBKR_DISCONNECTED = 'IBKR_DISCONNECTED',
  IBKR_AUTH_FAILED = 'IBKR_AUTH_FAILED',
  IBKR_DATA_UNAVAILABLE = 'IBKR_DATA_UNAVAILABLE',

  // Memory/storage errors
  MEMORY_ERROR = 'MEMORY_ERROR',

  // Network errors
  NETWORK_ERROR = 'NETWORK_ERROR',
  TUNNEL_UNAVAILABLE = 'TUNNEL_UNAVAILABLE',

  // Unknown
  UNKNOWN = 'UNKNOWN',
}

export interface AgentError {
  type: AgentErrorType;
  message: string;
  recoverable: boolean;
  suggestion?: string;
  originalError?: Error;
  context?: Record<string, unknown>;
}

/**
 * Classify an error into a specific AgentError with user-friendly messaging
 */
export function classifyError(error: Error, context?: Record<string, unknown>): AgentError {
  const msg = error.message.toLowerCase();

  // LLM timeout errors
  if (msg.includes('timeout') && (msg.includes('llm') || msg.includes('model') || msg.includes('ollama'))) {
    return {
      type: AgentErrorType.LLM_TIMEOUT,
      message: 'The AI model took too long to respond.',
      recoverable: true,
      suggestion: 'Try asking a simpler question or try again in a moment.',
      originalError: error,
      context,
    };
  }

  // Generic timeout
  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('etimedout')) {
    return {
      type: AgentErrorType.TOOL_TIMEOUT,
      message: 'A request took too long to complete.',
      recoverable: true,
      suggestion: 'Please try again.',
      originalError: error,
      context,
    };
  }

  // Tunnel/connection errors
  if (msg.includes('tunnel') || msg.includes('cloudflare') || msg.includes('econnrefused')) {
    return {
      type: AgentErrorType.TUNNEL_UNAVAILABLE,
      message: 'Connection to AI model unavailable.',
      recoverable: true,
      suggestion: 'The system will use a backup model. Please try again.',
      originalError: error,
      context,
    };
  }

  // IBKR broker errors
  if (msg.includes('ibkr') || msg.includes('broker') || msg.includes('interactive brokers')) {
    if (msg.includes('auth') || msg.includes('401') || msg.includes('not authenticated')) {
      return {
        type: AgentErrorType.IBKR_AUTH_FAILED,
        message: 'IBKR authentication issue.',
        recoverable: false,
        suggestion: 'Please check your IBKR Gateway connection.',
        originalError: error,
        context,
      };
    }
    if (msg.includes('disconnect') || msg.includes('connection')) {
      return {
        type: AgentErrorType.IBKR_DISCONNECTED,
        message: 'IBKR broker connection lost.',
        recoverable: false,
        suggestion: 'Please reconnect to IBKR Gateway.',
        originalError: error,
        context,
      };
    }
    return {
      type: AgentErrorType.IBKR_DATA_UNAVAILABLE,
      message: 'Unable to fetch broker data.',
      recoverable: true,
      suggestion: 'Market data may be temporarily unavailable.',
      originalError: error,
      context,
    };
  }

  // Tool execution errors
  if (msg.includes('tool') || msg.includes('execution failed')) {
    return {
      type: AgentErrorType.TOOL_EXECUTION_FAILED,
      message: `Tool execution failed: ${error.message.slice(0, 100)}`,
      recoverable: true,
      suggestion: 'I\'ll try to continue with available data.',
      originalError: error,
      context,
    };
  }

  // LLM unavailable
  if (msg.includes('model') && (msg.includes('unavailable') || msg.includes('not found') || msg.includes('offline'))) {
    return {
      type: AgentErrorType.LLM_UNAVAILABLE,
      message: 'AI model is currently unavailable.',
      recoverable: true,
      suggestion: 'Trying backup model...',
      originalError: error,
      context,
    };
  }

  // Rate limiting
  if (msg.includes('rate limit') || msg.includes('429') || msg.includes('too many requests')) {
    return {
      type: AgentErrorType.LLM_RATE_LIMITED,
      message: 'Too many requests. Please slow down.',
      recoverable: true,
      suggestion: 'Wait a moment before trying again.',
      originalError: error,
      context,
    };
  }

  // Parse errors
  if (msg.includes('parse') || msg.includes('json') || msg.includes('syntax')) {
    return {
      type: AgentErrorType.LLM_PARSE_ERROR,
      message: 'Failed to understand AI response.',
      recoverable: true,
      suggestion: 'Please try again.',
      originalError: error,
      context,
    };
  }

  // Network errors
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('enotfound')) {
    return {
      type: AgentErrorType.NETWORK_ERROR,
      message: 'Network connection issue.',
      recoverable: true,
      suggestion: 'Please check your connection and try again.',
      originalError: error,
      context,
    };
  }

  // Memory/database errors
  if (msg.includes('memory') || msg.includes('database') || msg.includes('sqlite')) {
    return {
      type: AgentErrorType.MEMORY_ERROR,
      message: 'Failed to save conversation.',
      recoverable: true,
      suggestion: 'Your message was processed but may not be saved.',
      originalError: error,
      context,
    };
  }

  // Unknown error - provide generic but still informative message
  return {
    type: AgentErrorType.UNKNOWN,
    message: error.message.length > 100 ? error.message.slice(0, 100) + '...' : error.message,
    recoverable: false,
    suggestion: 'Please try again. If the issue persists, try refreshing the page.',
    originalError: error,
    context,
  };
}

/**
 * Format an AgentError for user display
 */
export function formatErrorForUser(error: AgentError): string {
  if (error.suggestion) {
    return `${error.message} ${error.suggestion}`;
  }
  return error.message;
}

/**
 * Check if a tool is critical (failure should stop execution)
 */
export function isCriticalTool(toolName: string): boolean {
  // These tools are critical - if they fail, we can't continue
  const criticalTools = [
    'executeOrder',
    'confirmTrade',
  ];
  return criticalTools.includes(toolName);
}
