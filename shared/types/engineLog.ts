/**
 * Enhanced Engine Log Types
 * Provides transparency into the trading engine's decision-making process
 */

/**
 * A question-answer pair showing reasoning behind a decision
 */
export interface StepReasoning {
  question: string;  // "Is VIX acceptable?"
  answer: string;    // "YES (15.23 - LOW regime)"
}

/**
 * A key metric collected during step execution
 */
export interface StepMetric {
  label: string;
  value: string | number;
  unit?: string;
  status?: 'normal' | 'warning' | 'critical';
}

/**
 * Option strike data for Step 3 nearby strikes table
 */
export interface NearbyStrike {
  strike: number;
  optionType: 'PUT' | 'CALL';
  delta: number;
  bid: number;
  ask: number;
  spread: number;
  selected?: boolean;
}

/**
 * Enhanced log entry for a single step
 */
export interface EnhancedStepLog {
  step: number;
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  durationMs: number;
  isSlowest?: boolean;

  // Decision transparency
  reasoning: StepReasoning[];
  metrics: StepMetric[];

  // Step 3 specific: nearby strikes for context
  nearbyStrikes?: NearbyStrike[];

  // Error details (if failed)
  error?: {
    message: string;
    suggestion: string;
    diagnostic?: Record<string, unknown>;
  };
}

/**
 * Complete enhanced engine log with all steps and summary
 */
export interface EnhancedEngineLog {
  totalDurationMs: number;
  steps: EnhancedStepLog[];
  summary: {
    strategy: string;
    strike: string;
    contracts: number;
    premium: number;
    stopLoss: string;
    status: string;
    reason?: string;  // Explanation when status is not READY
  };
}
