/**
 * Trading Mandate Types
 *
 * Blockchain-enforced trading rules for self-discipline and investor transparency.
 * Mandates are permanent once created - cannot be modified, only replaced.
 */

// Violation types that can be recorded
export type ViolationType =
  | 'symbol'        // Trading a non-permitted symbol
  | 'delta'         // Delta outside allowed range
  | 'strategy'      // Using non-permitted strategy (e.g., BUY instead of SELL)
  | 'overnight'     // Holding positions past exit deadline
  | 'daily_loss';   // Exceeding maximum daily loss limit

// Action taken when a violation is detected
export type ViolationAction = 'blocked' | 'warning';

// Mandate rules configuration
export interface MandateRules {
  allowedSymbols: string[];        // ["SPY", "SPX"]
  strategyType: 'SELL' | 'BUY';    // Only SELL for credit strategies
  minDelta: number;                 // 0.20
  maxDelta: number;                 // 0.35
  maxDailyLossPercent: number;      // 0.02 = 2%
  noOvernightPositions: boolean;    // true
  exitDeadline: string;             // "15:55" (3:55 PM ET)
  tradingWindowStart?: string;      // "12:00" (guideline only)
  tradingWindowEnd?: string;        // "14:00" (guideline only)
}

// Full mandate with metadata
export interface Mandate extends MandateRules {
  id: string;
  userId: string;
  isActive: boolean;
  isLocked: boolean;
  onChainHash?: string;
  solanaSignature?: string;
  solanaSlot?: number;
  createdAt: string;
}

// Mandate validation result
export interface MandateValidation {
  valid: boolean;
  violation?: {
    type: ViolationType;
    attempted: string;
    limit: string;
    message: string;
  };
}

// Violation record
export interface Violation {
  id: string;
  userId: string;
  mandateId: string;
  violationType: ViolationType;
  attemptedValue?: string;
  limitValue?: string;
  actionTaken: ViolationAction;
  tradeDetails?: Record<string, unknown>;
  onChainHash?: string;
  solanaSignature?: string;
  solanaSlot?: number;
  createdAt: string;
}

// API request/response types
export interface CreateMandateRequest {
  allowedSymbols: string[];
  strategyType: 'SELL' | 'BUY';
  minDelta: number;
  maxDelta: number;
  maxDailyLossPercent: number;
  noOvernightPositions: boolean;
  exitDeadline: string;
  tradingWindowStart?: string;
  tradingWindowEnd?: string;
}

export interface MandateResponse {
  mandate: Mandate;
  violations: Violation[];
  violationCount: number;
}

// Trade enforcement check
export interface EnforcementResult {
  allowed: boolean;
  reason?: string;
  violation?: {
    type: ViolationType;
    attempted: string;
    limit: string;
  };
}

// Solana commitment data
export interface MandateCommitment {
  mandateId: string;
  rulesHash: string;          // SHA256 of mandate rules
  signature: string;          // Solana transaction signature
  slot: number;               // Solana slot number
  explorerUrl: string;        // Link to Solana Explorer
}

// For displaying in the legal document UI
export interface MandateDisplay {
  mandate: Mandate;
  statusText: 'ACTIVE' | 'INACTIVE';
  effectiveDate: string;      // Formatted date string
  onChainProof?: {
    hash: string;
    signature: string;
    explorerUrl: string;
  };
  violations: {
    total: number;
    thisMonth: number;
  };
}
