// Context that the agent sees each wake-up
export interface AgentContext {
  // Current market state
  spyPrice: number;
  vixLevel: number;

  // Time context
  currentTime: string; // HH:MM ET
  isMarketOpen: boolean;
  isTradingWindow: boolean; // After 12 PM ET baseline
  minutesUntilClose: number;

  // Position state
  hasPosition: boolean;
  currentPosition?: {
    type: 'PUT' | 'CALL';
    strike: number;
    contracts: number;
    entryPrice: number;
    currentPrice: number;
    unrealizedPnl: number;
    stopLossPrice: number;
  };

  // Daily stats
  tradesToday: number;
  dailyPnl: number;

  // Guardrails
  maxDailyLoss: number;
  maxContracts: number;
  stopLossMultiplier: number;
}

// Observation stored in memory
export interface Observation {
  sessionId: string;
  timestamp: Date;
  context: AgentContext;
  triageResult?: TriageResult;
  decision?: Decision;
}

// DeepSeek triage response
export interface TriageResult {
  escalate: boolean;
  reason: string;
  reasoning: string;
}

// Kimi K2 decision response
export interface Decision {
  action: 'TRADE' | 'WAIT' | 'CLOSE';
  reasoning: string;
  params?: TradeParams;
}

export interface TradeParams {
  direction: 'PUT' | 'CALL';
  strike: number;
  contracts: number;
}
