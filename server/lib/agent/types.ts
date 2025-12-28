// server/lib/agent/types.ts

// ============ State Machine ============

export type OrchestratorState =
  | 'IDLE'
  | 'PLANNING'
  | 'EXECUTING'
  | 'VALIDATING'
  | 'RESPONDING'
  | 'ERROR';

export interface SafetyLimits {
  maxToolCalls: number;
  maxLoopIterations: number;
  requestTimeoutMs: number;
  toolTimeoutMs: number;
}

export const DEFAULT_SAFETY_LIMITS: SafetyLimits = {
  maxToolCalls: 10,
  maxLoopIterations: 5,
  requestTimeoutMs: 300000, // 5 min - DeepSeek reasoning is slow
  toolTimeoutMs: 300000,    // 5 min - model loading + inference
};

// ============ Planner ============

export type Intent =
  | 'market_check'
  | 'position_query'
  | 'trade_proposal'
  | 'conversation';

export interface PlanStep {
  id: number;
  action: 'getMarketData' | 'getPositions' | 'runEngine' | 'respond' | 'validate';
  args?: Record<string, unknown>;
  reason: string;
  dependsOn?: number[];
}

export interface ExecutionPlan {
  intent: Intent;
  confidence: number;
  steps: PlanStep[];
  requiresValidation: boolean;
  estimatedDurationMs: number;
}

export interface PlannerInput {
  userMessage: string;
  conversationContext: Message[];
  cachedMarketData?: unknown;
  cachedPositions?: unknown;
}

// ============ Executor ============

export interface Observation {
  tool: string;
  input: unknown;
  output: unknown;
  durationMs: number;
  success: boolean;
  error?: string;
}

export interface ExecutorState {
  planStep: PlanStep;
  observations: Observation[];
  thoughtChain: string[];
  loopCount: number;
  startTimeMs: number;
}

// ============ Memory ============

export type MessageRole = 'user' | 'assistant' | 'observation';

export interface Message {
  id?: number;
  conversationId: string;
  role: MessageRole;
  content: string;
  metadata?: {
    tool?: string;
    toolResult?: unknown;
    thought?: string;
    planStep?: number;
  };
  createdAt: Date;
}

export interface Conversation {
  id: string;
  userId: string;
  createdAt: Date;
  lastActivityAt: Date;
  summary?: string;
}

export interface ContextCache {
  conversationId: string;
  marketSnapshot?: unknown;
  positionsSnapshot?: unknown;
  cachedAt: Date;
}

// ============ Streaming Events ============

export type AgentEvent =
  | { type: 'state_change'; from: OrchestratorState; to: OrchestratorState }
  | { type: 'plan_ready'; plan: ExecutionPlan }
  | { type: 'step_start'; stepId: number; action: string }
  | { type: 'thought'; content: string }
  | { type: 'tool_start'; tool: string }
  | { type: 'tool_done'; tool: string; result: unknown; durationMs: number }
  | { type: 'tool_error'; tool: string; error: string }
  | { type: 'thinking'; content: string; isStreaming?: boolean }
  | { type: 'step_complete'; stepId: number }
  | { type: 'validation_start' }
  | { type: 'validation_result'; approved: boolean; reason: string }
  | { type: 'response_chunk'; content: string }
  | { type: 'done'; finalResponse?: string }
  | { type: 'error'; error: string; recoverable: boolean }
  | { type: 'browser_screenshot'; data: { base64: string; url: string; timestamp: number } };

// ============ Activity Log ============

// Activity Log Entry for UI display
export interface ActivityLogEntry {
  id: string;
  timestamp: number;
  eventType: AgentEvent['type'];
  title: string;
  summary?: string;
  details?: {
    args?: Record<string, unknown>;
    result?: unknown;
    durationMs?: number;
    reasoning?: string;
    screenshotBase64?: string;
    url?: string;
  };
  isExpandable: boolean;
}

// ============ Tool Registry ============

export interface ToolDefinition {
  name: string;
  description: string;
  execute: (args: unknown) => Promise<unknown>;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  durationMs: number;
}
