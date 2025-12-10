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

  // Risk Assessment - VIX-based dynamic delta & position sizing
  riskAssessment?: RiskAssessment;

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

// =============================================================================
// Risk Assessment - Dynamic Delta & Position Sizing based on VIX
// =============================================================================

export type RiskRegime = 'LOW' | 'NORMAL' | 'ELEVATED' | 'HIGH' | 'EXTREME';

export interface RiskAssessment {
  vixLevel: number;
  riskRegime: RiskRegime;
  targetDelta: number;      // Dynamic delta based on VIX (0.20-0.40)
  contracts: number;        // Position size (0-3) based on risk regime
  reasoning: string;
}

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
    ma50: number;                // 50-period MA on 5-min bars (~4 hours)
    maPeriod: number;            // MA period used (50)
  };

  signals: {
    trend: TrendDirection;
    momentum: number;            // -1.0 to 1.0
    maAlignment: string;         // "SPY > MA50" or "SPY < MA50"
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

// =============================================================================
// Smart Strike Selection - Quality Filtering & Scoring
// =============================================================================

/**
 * Quality rating for a strike (1-5 stars)
 * Based on probability, liquidity, and yield metrics
 */
export type QualityRating = 1 | 2 | 3 | 4 | 5;

/**
 * Rejection reason when a strike doesn't pass filters
 */
export interface StrikeRejection {
  strike: number;
  optionType: 'PUT' | 'CALL';
  reason: 'DELTA_OUT_OF_RANGE' | 'BID_TOO_LOW' | 'SPREAD_TOO_WIDE' | 'YIELD_TOO_LOW' | 'ILLIQUID' | 'PREMIUM_TOO_LOW';
  details: string;
}

/**
 * Smart strike candidate with quality scoring and yield metrics
 * These are the "elite strikes" that pass all filters
 */
export interface SmartStrikeCandidate {
  strike: number;
  optionType: 'PUT' | 'CALL';

  // Pricing
  bid: number;
  ask: number;
  spread: number;         // ask - bid

  // Greeks
  delta: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  iv?: number;            // Implied Volatility

  // Liquidity
  openInterest: number;
  volume?: number;

  // Smart Metrics
  yield: number;          // premium / underlying price (e.g., 0.055 = 0.055%)
  yieldPct: string;       // Formatted "0.055%"

  // Quality Scoring
  qualityScore: QualityRating;  // 1-5 stars
  qualityReasons: string[];     // Why this rating (e.g., "Good delta (0.14)", "Tight spread ($0.03)")

  // Selection
  isEngineRecommended: boolean;  // Engine's top pick
  isUserSelected: boolean;       // User's selection (for override)
}

/**
 * Smart filtering configuration
 */
export interface SmartFilterConfig {
  // Probability filter
  deltaMin: number;       // e.g., 0.05
  deltaMax: number;       // e.g., 0.25

  // Liquidity filter
  minBid: number;         // e.g., 0.01
  maxSpread: number;      // e.g., 0.10 for SPY
  minLiquidity: number;   // OI + Volume threshold

  // Premium-to-Risk filter
  minYield: number;       // e.g., 0.0003 (0.03%)
}

// =============================================================================
// Gated Engine Flow - Interactive Strike Selection
// =============================================================================

/**
 * Engine state for gated flow
 * idle → running_1_2_3 → awaiting_selection → running_4_5 → complete
 */
export type EngineFlowState =
  | 'idle'
  | 'running_1_2_3'
  | 'awaiting_selection'
  | 'running_4_5'
  | 'complete'
  | 'error';

/**
 * User's strike selection for continuing the engine
 */
export interface UserStrikeSelection {
  selectedPutStrike: number | null;
  selectedCallStrike: number | null;
}

/**
 * Engine analyze request with optional user selection (for Steps 4-5)
 */
export interface EngineAnalyzeRequest {
  // Phase 1: Initial analysis (Steps 1-3)
  riskTier?: 'conservative' | 'balanced' | 'aggressive';
  stopMultiplier?: 2 | 3 | 4;

  // Phase 2: Continue after user selection (Steps 4-5)
  userSelection?: UserStrikeSelection;
  continueFromStep3?: boolean;  // Flag to continue from awaiting_selection
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

  // Smart Strike Selection (Interactive UI)
  smartCandidates?: {
    puts: SmartStrikeCandidate[];
    calls: SmartStrikeCandidate[];
  };
  rejectedStrikes?: StrikeRejection[];
  filterConfig?: SmartFilterConfig;

  // Gated flow state
  awaitingUserSelection?: boolean;

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
  // Enhanced status for UI feedback
  orderStatus?: 'submitted' | 'filled' | 'cancelled' | 'rejected' | 'error';
  statusReason?: string;
}

// =============================================================================
// Analyze Request Options
// =============================================================================

export interface AnalyzeOptions {
  riskTier?: 'conservative' | 'balanced' | 'aggressive';
  stopMultiplier?: 2 | 3 | 4;
  deltaMin?: number;
  deltaMax?: number;
  symbol?: 'SPY' | 'ARM';  // Trading symbol selection
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
