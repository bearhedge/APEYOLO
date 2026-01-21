/**
 * Toolkit Types - Type definitions for the LLM-callable toolkit
 */

// ============================================================================
// Tool Result Types (what each tool returns)
// ============================================================================

export interface MarketCheckResult {
  vix: number;
  vixChange: number;
  spyPrice: number;
  spyChange: number;
  time: string;
  isMarketOpen: boolean;
  isTradingWindow: boolean;
  volatilityRegime: 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME';
}

export interface DirectionResult {
  direction: 'PUT' | 'CALL' | 'STRANGLE';
  confidence: number;
  trend: 'UP' | 'DOWN' | 'SIDEWAYS';
  reasoning: string;
  signals: {
    ma50: number;
    spyPrice: number;
    momentum: number;
  };
}

export interface StrikeInfo {
  strike: number;
  delta: number;
  bid: number;
  ask: number;
  premium: number;
  expiration: string;
}

export interface StrikeResult {
  recommended: StrikeInfo | null;
  alternatives: StrikeInfo[];
  targetDelta: number;
  actualDelta: number;
  reasoning: string;
}

export interface SizeResult {
  contracts: number;
  marginPerContract: number;
  totalMargin: number;
  maxLoss: number;
  maxLossPercent: number;
  riskProfile: 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
  reasoning: string;
}

export interface ExitRulesResult {
  stopLossPrice: number;
  stopLossAmount: number;
  stopLossMultiplier: number;
  timeStop: string;
  profitTarget: number | null;
  reasoning: string;
}

export interface ExecuteResult {
  success: boolean;
  orderId?: string;
  fillPrice?: number;
  status: 'FILLED' | 'PENDING' | 'REJECTED' | 'ERROR';
  message: string;
}

export interface PositionResult {
  hasPosition: boolean;
  position?: {
    direction: 'PUT' | 'CALL';
    strike: number;
    contracts: number;
    entryPrice: number;
    currentPrice: number;
    pnl: number;
    pnlPercent: number;
    stopDistance: number;
  };
}

// ============================================================================
// Tool Call Types (LLM request format)
// ============================================================================

export interface ToolCallCheckMarket {
  tool: 'check_market';
  params: Record<string, never>; // No params
}

export interface ToolCallAnalyzeDirection {
  tool: 'analyze_direction';
  params: {
    symbol: string;
  };
}

export interface ToolCallGetStrikes {
  tool: 'get_strikes';
  params: {
    direction: 'PUT' | 'CALL';
    targetDelta: number; // 0.10 - 0.25
  };
}

export interface ToolCallCalculateSize {
  tool: 'calculate_size';
  params: {
    strike: number;
    premium: number;
    riskProfile: 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
  };
}

export interface ToolCallGetExitRules {
  tool: 'get_exit_rules';
  params: {
    strike: number;
    contracts: number;
    entryPremium: number;
  };
}

export interface ToolCallExecuteTrade {
  tool: 'execute_trade';
  params: {
    direction: 'PUT' | 'CALL';
    strike: number;
    contracts: number;
    limitPrice?: number;
  };
}

export interface ToolCallCheckPosition {
  tool: 'check_position';
  params: Record<string, never>; // No params
}

export type ToolCall =
  | ToolCallCheckMarket
  | ToolCallAnalyzeDirection
  | ToolCallGetStrikes
  | ToolCallCalculateSize
  | ToolCallGetExitRules
  | ToolCallExecuteTrade
  | ToolCallCheckPosition;

export type ToolName = ToolCall['tool'];

// ============================================================================
// LLM Response Format
// ============================================================================

export interface LLMToolCallResponse {
  thinking: string;
  action: 'call_tool';
  tool: ToolName;
  params: Record<string, unknown>;
}

export interface LLMDoneResponse {
  thinking: string;
  action: 'done';
  final_decision: {
    traded: boolean;
    summary: string;
    reason?: string;
  };
}

export type LLMResponse = LLMToolCallResponse | LLMDoneResponse;

// ============================================================================
// Orchestrator Types
// ============================================================================

export interface OrchestratorResult {
  success: boolean;
  traded: boolean;
  summary: string;
  toolCallCount: number;
  error?: string;
}
