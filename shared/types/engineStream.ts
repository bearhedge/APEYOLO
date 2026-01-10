/**
 * Engine Streaming Types
 *
 * Types for Server-Sent Events (SSE) streaming of engine analysis progress.
 * Used by /api/engine/analyze/stream endpoint.
 */

import type { EnhancedStepLog } from './engineLog';
import type { EngineAnalyzeResponse } from './engine';

/**
 * SSE event types for engine analysis streaming
 */
export type EngineStreamEventType =
  | 'start'         // Analysis beginning
  | 'step_start'    // Step N starting
  | 'step_complete' // Step N finished with data
  | 'step_error'    // Step N failed
  | 'complete'      // All steps done, full result
  | 'error';        // Fatal error

/**
 * SSE event payload sent from server to client
 */
export interface EngineStreamEvent {
  type: EngineStreamEventType;
  timestamp: number;

  // Step progress (for step_start, step_complete, step_error)
  step?: number;
  stepName?: string;
  stepLog?: EnhancedStepLog;

  // Final result (for complete)
  result?: EngineAnalyzeResponse;

  // Error info (for error, step_error)
  error?: string;
  diagnostics?: Record<string, unknown>;
}

/**
 * Options for starting streaming analysis
 */
export interface StreamAnalyzeOptions {
  riskTier?: 'conservative' | 'balanced' | 'aggressive';
  stopMultiplier?: number;
  symbol?: string;
  strategy?: 'strangle' | 'put' | 'call';
  expirationMode?: '0DTE' | 'WEEKLY';
}
