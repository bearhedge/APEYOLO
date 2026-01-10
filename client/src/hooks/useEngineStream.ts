/**
 * useEngineStream - SSE Streaming Hook for Engine Analysis
 *
 * Provides real-time step-by-step progress during engine analysis.
 * Uses Server-Sent Events (SSE) to stream updates from the backend.
 */

import { useState, useCallback, useRef } from 'react';
import type { EngineAnalyzeResponse, AnalyzeOptions } from '@shared/types/engine';
import type { EnhancedEngineLog, EnhancedStepLog } from '@shared/types/engineLog';
import type { EngineStreamEvent } from '@shared/types/engineStream';

// Step names for building partial logs
const STEP_NAMES = [
  'Market Regime Check',
  'Direction Selection',
  'Strike Selection',
  'Position Sizing',
  'Exit Rules',
];

/**
 * Build a partial EnhancedEngineLog with completed + running + pending steps
 */
function buildPartialLog(
  completedSteps: EnhancedStepLog[],
  runningStep: number | null
): EnhancedEngineLog {
  const steps: EnhancedStepLog[] = [];

  // Add completed steps
  steps.push(...completedSteps);

  // Add running step if any
  if (runningStep !== null && runningStep > completedSteps.length) {
    steps.push({
      step: runningStep,
      name: STEP_NAMES[runningStep - 1],
      status: 'running',
      durationMs: 0,
      reasoning: [],
      metrics: [],
    });
  }

  // Add pending steps
  for (let i = steps.length + 1; i <= 5; i++) {
    steps.push({
      step: i,
      name: STEP_NAMES[i - 1],
      status: 'pending',
      durationMs: 0,
      reasoning: [],
      metrics: [],
    });
  }

  return {
    totalDurationMs: completedSteps.reduce((s, x) => s + x.durationMs, 0),
    steps,
    summary: {
      status: 'RUNNING',
      strategy: '...',
      strike: '-',
      contracts: 0,
      premium: 0,
      stopLoss: '-',
    },
  };
}

export interface UseEngineStreamReturn {
  /** Whether analysis is currently running */
  isRunning: boolean;
  /** Current step number being executed (1-5) */
  currentStep: number | null;
  /** Partial or complete engine log for UI display */
  engineLog: EnhancedEngineLog | null;
  /** Final complete analysis response (available after completion) */
  analysis: EngineAnalyzeResponse | null;
  /** Error message if analysis failed */
  error: string | null;
  /** Start a new streaming analysis */
  startAnalysis: (options?: AnalyzeOptions) => void;
  /** Cancel the current analysis */
  cancelAnalysis: () => void;
  /** Clear all state */
  reset: () => void;
}

export function useEngineStream(): UseEngineStreamReturn {
  const [isRunning, setIsRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState<number | null>(null);
  const [engineLog, setEngineLog] = useState<EnhancedEngineLog | null>(null);
  const [analysis, setAnalysis] = useState<EngineAnalyzeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Track EventSource and completed steps across events
  const eventSourceRef = useRef<EventSource | null>(null);
  const completedStepsRef = useRef<EnhancedStepLog[]>([]);

  const startAnalysis = useCallback((options?: AnalyzeOptions) => {
    // Reset state
    setIsRunning(true);
    setCurrentStep(null);
    setEngineLog(null);
    setAnalysis(null);
    setError(null);
    completedStepsRef.current = [];

    // Clear sessionStorage cache to prevent stale data display
    try {
      sessionStorage.removeItem('engine_analysis');
      sessionStorage.removeItem('engine_decision');
    } catch {
      // Ignore sessionStorage errors
    }

    // Build query params
    const params = new URLSearchParams();
    if (options?.riskTier) params.set('riskTier', options.riskTier);
    if (options?.stopMultiplier) params.set('stopMultiplier', String(options.stopMultiplier));
    if (options?.symbol) params.set('symbol', options.symbol);
    if (options?.strategy) params.set('strategy', options.strategy);

    // Close any existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    // Connect SSE
    const url = `/api/engine/analyze/stream?${params.toString()}`;
    const es = new EventSource(url, { withCredentials: true });
    eventSourceRef.current = es;

    es.onmessage = (e) => {
      try {
        const event: EngineStreamEvent = JSON.parse(e.data);

        switch (event.type) {
          case 'start':
            // Analysis starting - show empty log with all pending
            setCurrentStep(null);
            setEngineLog(buildPartialLog([], null));
            break;

          case 'step_start':
            // Step N starting - show it as running
            if (event.step) {
              setCurrentStep(event.step);
              setEngineLog(buildPartialLog(completedStepsRef.current, event.step));
            }
            break;

          case 'step_complete':
            // Step N finished - add to completed steps
            if (event.stepLog) {
              completedStepsRef.current.push(event.stepLog);
              setCurrentStep(null);
              setEngineLog(buildPartialLog(completedStepsRef.current, null));
            }
            break;

          case 'step_error':
            // Step failed but analysis continues (partial results)
            if (event.step && event.error) {
              const failedLog: EnhancedStepLog = {
                step: event.step,
                name: STEP_NAMES[event.step - 1],
                status: 'failed',
                durationMs: 0,
                reasoning: [{ question: 'Error', answer: event.error }],
                metrics: [],
                error: {
                  message: event.error,
                  suggestion: 'Check server logs for details',
                },
              };
              completedStepsRef.current.push(failedLog);
              setEngineLog(buildPartialLog(completedStepsRef.current, null));
            }
            break;

          case 'complete':
            // All done - full result available
            setIsRunning(false);
            setCurrentStep(null);
            if (event.result) {
              setAnalysis(event.result);
              // Use the enhanced log from the complete result
              if (event.result.enhancedLog) {
                setEngineLog(event.result.enhancedLog);
              }
              // Persist to sessionStorage for page navigation
              try {
                sessionStorage.setItem('engine_analysis', JSON.stringify(event.result));
              } catch {
                // Ignore
              }
            }
            es.close();
            break;

          case 'error':
            // Fatal error
            setIsRunning(false);
            setCurrentStep(null);
            setError(event.error || 'Analysis failed');
            es.close();
            break;
        }
      } catch (parseError) {
        console.error('[useEngineStream] Failed to parse SSE event:', parseError);
      }
    };

    es.onerror = (err) => {
      console.error('[useEngineStream] EventSource error:', err);
      setIsRunning(false);
      setCurrentStep(null);
      // Only set error if we don't already have analysis (some browsers fire error on close)
      if (!analysis) {
        setError('Connection lost - please try again');
      }
      es.close();
    };
  }, [analysis]);

  const cancelAnalysis = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setIsRunning(false);
    setCurrentStep(null);
  }, []);

  const reset = useCallback(() => {
    cancelAnalysis();
    setEngineLog(null);
    setAnalysis(null);
    setError(null);
    completedStepsRef.current = [];
  }, [cancelAnalysis]);

  return {
    isRunning,
    currentStep,
    engineLog,
    analysis,
    error,
    startAnalysis,
    cancelAnalysis,
    reset,
  };
}
