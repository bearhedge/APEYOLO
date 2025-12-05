/**
 * Engine API Types - Standardized Response Shapes
 *
 * All field names use camelCase per user specification.
 * These types define the contract between backend and frontend
 * for the 5-step trading engine decision process.
 */

import type { EnhancedEngineLog } from './engineLog';

// =============================================================================
// Root Response Type
// =============================================================================

export interface EngineAnalyzeResponse {
  timestamp: string;
  requestId: string;
  version: string;

  canTrade: boolean;
  executionReady: boolean;
  reason?: string;

  q1MarketRegime: Q1MarketRegime;
  q2Direction: Q2Direction;
  q3Strikes: Q3Strikes;
  q4Size: Q4Size;
  q5Exit: Q5Exit;

  tradeProposal: TradeProposal | null;
  guardRails: GuardRailResult;
  tradingWindow: TradingWindowStatus;
  audit: AuditEntry[];

  // Enhanced logging for new UI
  enhancedLog?: EnhancedEngineLog;
}

// =============================================================================
// Q1 - Market Regime
// =============================================================================

export type VolatilityRegime = 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME';

export interface Q1MarketRegime {
  regimeLabel: VolatilityRegime;
  riskMultiplier: number;        // 1.0 normal, 0.5 high, 0 extreme
  canTrade: boolean;
  reason: string;

  inputs: {
    vixValue: number | null;
    vixChangePct: number | null;
    spyPrice: number | null;
    spyChangePct: number | null;
    currentTimeEt: string;
    isTradingHours: boolean;
  };

  thresholds: {
    vixLow: number;              // 17
    vixHigh: number;             // 20
    vixExtreme: number;          // 35
  };

  stepNumber: 1;
  stepName: 'Market Regime';
  passed: boolean;
  confidence: number;
}

// =============================================================================
// Q2 - Direction
// =============================================================================

export type TradeDirection = 'PUT' | 'CALL' | 'STRANGLE';
export type TrendDirection = 'UP' | 'DOWN' | 'SIDEWAYS';
export type BiasDirection = 'BULL' | 'BEAR' | 'NEUTRAL';

export interface Q2Direction {
  bias: BiasDirection;
  recommendedDirection: TradeDirection;
  confidencePct: number;         // 0-100
  comment: string;

  inputs: {
    spyPrice: number;
    maFast: number;              // 5-period MA
    maSlow: number;              // 15-period MA
    maFastPeriod: number;
    maSlowPeriod: number;
  };

  signals: {
    trend: TrendDirection;
    momentum: number;            // -1.0 to 1.0
    maAlignment: string;         // "SPY > MA5 > MA15"
  };

  stepNumber: 2;
  stepName: 'Direction';
  passed: boolean;
  confidence: number;
}

// =============================================================================
// Q3 - Strikes
// =============================================================================

export interface SelectedStrike {
  strike: number;
  delta: number;
  premium: number;
  bid: number;
  ask: number;
  probItm: number;               // Same as delta for simplicity
  sigmaDist: number;             // Std devs from current price
  optionType: 'PUT' | 'CALL';
}

export interface StrikeCandidate extends SelectedStrike {
  openInterest?: number;
  impliedVolatility?: number;
  isSelected: boolean;
}

export interface Q3Strikes {
  selectedPut: SelectedStrike | null;
  selectedCall: SelectedStrike | null;
  candidates: StrikeCandidate[];

  expectedPremiumPerContract: number;
  dataSource: 'IBKR' | 'MOCK';
  underlyingPrice: number;

  inputs: {
    targetDeltaMin: number;      // 0.15
    targetDeltaMax: number;      // 0.20
    targetDeltaIdeal: number;    // 0.18
    symbol: string;
    expiration: string;
  };

  stepNumber: 3;
  stepName: 'Strikes';
  passed: boolean;
  confidence: number;
}

// =============================================================================
// Q4 - Size
// =============================================================================

export type RiskProfile = 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';

export interface Q4Size {
  maxContractsByRisk: number;
  maxContractsByBp: number;
  recommendedContracts: number;

  expectedPremiumTotal: number;
  worstCaseLoss: number;
  marginPerContract: number;
  totalMarginRequired: number;
  pctOfNav: number;

  inputs: {
    nav: number;
    buyingPower: number;
    cashBalance: number;
    riskProfile: RiskProfile;
    premiumPerContract: number;
  };

  riskLimits: {
    maxContracts: number;
    bpUtilizationPct: number;
    maxPositionPctOfNav: number;
  };

  stepNumber: 4;
  stepName: 'Size';
  passed: boolean;
  confidence: number;
}

// =============================================================================
// Q5 - Exit
// =============================================================================

export interface Q5Exit {
  takeProfitPrice: number | null;
  stopLossPrice: number;
  stopLossAmount: number;
  timeStopEt: string;

  takeProfitPct: number | null;
  stopLossMultiplier: number;
  maxHoldHours: number;

  inputs: {
    entryPremium: number;
    contracts: number;
    expirationTime: string;
  };

  rules: {
    stopLossRule: string;
    takeProfitRule: string;
    timeStopRule: string;
  };

  stepNumber: 5;
  stepName: 'Exit';
  passed: boolean;
  confidence: number;
}

// =============================================================================
// Trade Proposal
// =============================================================================

export interface TradeLeg {
  optionType: 'PUT' | 'CALL';
  action: 'SELL';
  strike: number;
  delta: number;
  premium: number;
  bid: number;
  ask: number;
}

export interface TradeProposal {
  proposalId: string;
  createdAt: string;

  symbol: string;
  expiration: string;
  expirationDate: string;

  strategy: TradeDirection;
  bias: BiasDirection;

  legs: TradeLeg[];
  contracts: number;

  entryPremiumPerContract: number;
  entryPremiumTotal: number;
  marginRequired: number;
  maxLoss: number;

  stopLossPrice: number;
  stopLossAmount: number;
  takeProfitPrice: number | null;
  timeStop: string;

  context: {
    vix: number;
    vixRegime: string;
    spyPrice: number;
    directionConfidence: number;
    riskProfile: string;
  };
}

// =============================================================================
// Supporting Types
// =============================================================================

export interface GuardRailResult {
  passed: boolean;
  violations: string[];
  checks: {
    deltaLimit?: boolean;
    positionSize?: boolean;
    marginLimit?: boolean;
    tradingWindow?: boolean;
  };
}

export interface TradingWindowStatus {
  isOpen: boolean;
  currentTimeEt: string;
  windowStart: string;
  windowEnd: string;
  nextOpenAt?: string;
  reason?: string;
}

export interface AuditEntry {
  step: number;
  name: string;
  timestamp: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  passed: boolean;
  reason?: string;
}

// =============================================================================
// Execute Paper Trade Request/Response
// =============================================================================

export interface ExecutePaperTradeRequest {
  tradeProposal: TradeProposal;
}

export interface ExecutePaperTradeResponse {
  success: boolean;
  tradeId: string;
  message: string;
  ibkrOrderIds?: string[];
}

// =============================================================================
// Analyze Request Options
// =============================================================================

export interface AnalyzeOptions {
  riskTier?: 'conservative' | 'balanced' | 'aggressive';
  stopMultiplier?: 2 | 3 | 4;
  deltaMin?: number;
  deltaMax?: number;
}

// =============================================================================
// Option Chain Diagnostics (for debugging IBKR connectivity)
// =============================================================================

export interface OptionChainDiagnostics {
  conid: number | null;
  symbol: string;
  monthInput: string;       // e.g., "202512"
  monthFormatted: string;   // e.g., "DEC25"
  strikesUrl: string;
  strikesStatus: number;
  strikesRaw: string;       // First 500 chars of raw response
  putCount: number;
  callCount: number;
  underlyingPrice: number;
  vix: number;
  error?: string;
  timestamp: string;
}
