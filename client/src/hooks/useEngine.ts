/**
 * Custom hook for Engine API integration
 */

import { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getDiag } from '@/lib/api';
import type {
  EngineAnalyzeResponse,
  TradeProposal,
  AnalyzeOptions,
  ExecutePaperTradeResponse,
} from '@shared/types/engine';

export interface EngineStatus {
  engineActive: boolean;
  brokerConnected: boolean;
  brokerProvider: string;
  tradingWindowOpen: boolean;
  tradingWindowReason?: string;
  guardRails: any;
  currentTime: string;
  nyTime: string;
}

export interface TradingDecision {
  timestamp: Date;
  canTrade: boolean;
  reason?: string;
  marketRegime?: {
    shouldTrade: boolean;
    reason: string;
    regime?: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    confidence?: number;
    metadata?: {
      currentTime?: string;
      vix?: number;
      vixChange?: number;
      spyPrice?: number;
      spyChange?: number;
      trend?: string;
    };
  };
  direction?: {
    direction: 'PUT' | 'CALL' | 'STRANGLE';
    confidence: number;
    reasoning: string;
    signals?: {
      trend?: 'UP' | 'DOWN' | 'SIDEWAYS';
      momentum?: number;
      strength?: number;
      spyPrice?: number;
      maFast?: number;
      maSlow?: number;
    };
  };
  strikes?: {
    putStrike?: any;
    callStrike?: any;
    expectedPremium: number;
    marginRequired: number;
    reasoning: string;
    nearbyStrikes?: {
      puts: Array<{ strike: number; bid: number; ask: number; delta: number; oi?: number }>;
      calls: Array<{ strike: number; bid: number; ask: number; delta: number; oi?: number }>;
    };
  };
  positionSize?: {
    contracts: number;
    riskPerContract: number;
    totalRisk: number;
    marginRequired: number;
    reasoning: string;
  };
  exitRules?: {
    stopLoss: number;
    takeProfit: number;
    timeStop: string;
    reasoning: string;
  };
  executionReady: boolean;
  audit: any[];
  guardRailViolations?: string[];
  passedGuardRails?: boolean;
}

export interface EngineConfig {
  riskProfile: 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
  underlyingSymbol: string;
  executionMode: 'manual' | 'auto';
  guardRails: any;
}

// Session storage helpers for state persistence across navigation
const STORAGE_KEYS = {
  analysis: 'engine_analysis',
  decision: 'engine_decision',
};

function getFromSession<T>(key: string, fallback: T): T {
  try {
    const stored = sessionStorage.getItem(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch {
    return fallback;
  }
}

function persistToSession(key: string, data: any): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(data));
  } catch (err) {
    console.warn('[Engine] Failed to persist to sessionStorage:', err);
  }
}

export function useEngine() {
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [decision, setDecision] = useState<TradingDecision | null>(
    () => getFromSession(STORAGE_KEYS.decision, null)
  );
  const [analysis, setAnalysis] = useState<EngineAnalyzeResponse | null>(
    () => getFromSession(STORAGE_KEYS.analysis, null)
  );
  const [config, setConfig] = useState<EngineConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Persist analysis to sessionStorage when it changes
  useEffect(() => {
    if (analysis) {
      persistToSession(STORAGE_KEYS.analysis, analysis);
    }
  }, [analysis]);

  // Persist decision to sessionStorage when it changes
  useEffect(() => {
    if (decision) {
      persistToSession(STORAGE_KEYS.decision, decision);
    }
  }, [decision]);

  // Use React Query for IBKR status - shares cache with NAV header for instant sync
  // When Settings refetches this query, Engine updates immediately too
  const { data: diagData } = useQuery({
    queryKey: ['/api/broker/diag'],
    queryFn: getDiag,
    refetchInterval: 10000, // Poll every 10s (same as NAV header)
  });

  // Derive broker connection status from shared React Query cache (same logic as NAV header)
  const last = diagData?.last;
  const brokerConnected = last?.oauth?.status === 200 &&
                          last?.sso?.status === 200 &&
                          last?.validate?.status === 200 &&
                          last?.init?.status === 200;

  // Calculate trading window locally (11:00 AM - 1:00 PM ET, Mon-Fri)
  const getTradingWindow = useCallback(() => {
    const now = new Date();
    const nyTime = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(now);

    const [hour, minute] = nyTime.split(':').map(Number);
    const currentMinutes = hour * 60 + minute;
    const startMinutes = 11 * 60; // 11:00 AM
    const endMinutes = 13 * 60;   // 1:00 PM

    // Check weekday (get day in NY timezone)
    const nyDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const dayOfWeek = nyDate.getDay();
    const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;

    const isOpen = isWeekday && currentMinutes >= startMinutes && currentMinutes < endMinutes;

    return {
      isOpen,
      reason: isOpen
        ? 'Trading window is open'
        : isWeekday
          ? 'Trading only allowed between 11:00 AM and 1:00 PM ET'
          : 'Trading only allowed on weekdays (Mon-Fri)'
    };
  }, []);

  // Build status from local calculation + broker connection
  const updateStatus = useCallback(() => {
    const tradingWindow = getTradingWindow();
    const now = new Date();

    setStatus({
      engineActive: true,
      brokerConnected,
      brokerProvider: brokerConnected ? 'ibkr' : 'none',
      tradingWindowOpen: tradingWindow.isOpen,
      tradingWindowReason: tradingWindow.reason,
      guardRails: {},
      currentTime: now.toISOString(),
      nyTime: now.toLocaleString('en-US', { timeZone: 'America/New_York' })
    });
  }, [brokerConnected, getTradingWindow]);

  // Keep status updated when brokerConnected changes
  useEffect(() => {
    updateStatus();
  }, [updateStatus]);

  // Legacy fetchStatus for backward compatibility
  const fetchStatus = useCallback(async () => {
    queryClient.invalidateQueries({ queryKey: ['/api/broker/diag'] });
    updateStatus();
  }, [queryClient, updateStatus]);

  // Execute trading decision process
  const executeDecision = useCallback(async (options?: {
    riskTier?: 'conservative' | 'balanced' | 'aggressive';
    stopMultiplier?: 2 | 3 | 4;
  }) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/engine/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          riskTier: options?.riskTier || 'balanced',
          stopMultiplier: options?.stopMultiplier || 3
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to execute decision');
      }

      const data = await response.json();
      setDecision(data);
      return data;
    } catch (err: any) {
      console.error('[Engine] Execute error:', err);
      setError(err.message || 'Failed to execute decision');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // NEW: Run analysis using the standardized endpoint (returns EngineAnalyzeResponse)
  const analyzeEngine = useCallback(async (options?: AnalyzeOptions): Promise<EngineAnalyzeResponse> => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        riskTier: options?.riskTier || 'balanced',
        stopMultiplier: String(options?.stopMultiplier || 3),
      });

      const response = await fetch(`/api/engine/analyze?${params}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        const errorData = await response.json();
        // Create error with full structured data attached
        const err = new Error(errorData.reason || errorData.error || 'Failed to run analysis') as any;
        err.failedStep = errorData.failedStep;
        err.stepName = errorData.stepName;
        err.reason = errorData.reason;
        err.audit = errorData.audit;
        err.isEngineError = true;
        throw err;
      }

      const data: EngineAnalyzeResponse = await response.json();
      setAnalysis(data);
      return data;
    } catch (err: any) {
      console.error('[Engine] Analyze error:', err);
      setError(err.message || 'Failed to run analysis');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // NEW: Execute paper trade
  const executePaperTrade = useCallback(async (
    tradeProposal: TradeProposal
  ): Promise<ExecutePaperTradeResponse> => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/engine/execute-paper', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ tradeProposal }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to execute paper trade');
      }

      return await response.json();
    } catch (err: any) {
      console.error('[Engine] Execute paper trade error:', err);
      setError(err.message || 'Failed to execute paper trade');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // Execute trade based on decision
  const executeTrade = useCallback(async (decision: TradingDecision, autoApprove: boolean = false) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/engine/execute-trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ decision, autoApprove })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to execute trade');
      }

      const data = await response.json();
      return data;
    } catch (err: any) {
      console.error('[Engine] Execute trade error:', err);
      setError(err.message || 'Failed to execute trade');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch engine configuration
  const fetchConfig = useCallback(async () => {
    try {
      const response = await fetch('/api/engine/config', {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch engine config');
      const data = await response.json();
      setConfig(data);
      setError(null);
    } catch (err) {
      console.error('[Engine] Config error:', err);
      setError('Failed to fetch engine config');
    }
  }, []);

  // Update engine configuration
  const updateConfig = useCallback(async (newConfig: Partial<EngineConfig>) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/engine/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(newConfig)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update config');
      }

      const data = await response.json();
      setConfig(data.config);
      return data;
    } catch (err: any) {
      console.error('[Engine] Update config error:', err);
      setError(err.message || 'Failed to update config');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // Format step data for display
  const formatSteps = useCallback((decision: TradingDecision | null) => {
    if (!decision || !decision.audit) {
      return [
        { name: 'Market Regime', status: 'pending', detail: '—' },
        { name: 'Direction', status: 'pending', detail: '—' },
        { name: 'Strikes', status: 'pending', detail: '—' },
        { name: 'Position Size', status: 'pending', detail: '—' },
        { name: 'Exit Rules', status: 'pending', detail: '—' },
      ];
    }

    const steps = [];

    // Step 1: Market Regime
    const marketStep = decision.audit.find(a => a.step === 1);
    if (marketStep) {
      steps.push({
        name: 'Market Regime',
        status: marketStep.passed ? 'passed' : 'failed',
        detail: marketStep.output?.metadata?.vix != null
          ? `VIX: ${marketStep.output.metadata.vix?.toFixed(2) || 'N/A'}, SPY: $${marketStep.output.metadata.spyPrice?.toFixed(2) || 'N/A'}`
          : marketStep.reason || 'No data'
      });
    }

    // Step 2: Direction
    const directionStep = decision.audit.find(a => a.step === 2);
    if (directionStep) {
      steps.push({
        name: 'Direction',
        status: directionStep.passed ? 'passed' : 'failed',
        detail: directionStep.output?.direction
          ? `${directionStep.output.direction} (${((directionStep.output.confidence ?? 0) * 100).toFixed(0)}% confidence)`
          : 'No decision'
      });
    }

    // Step 3: Strikes
    const strikesStep = decision.audit.find(a => a.step === 3);
    if (strikesStep && decision.strikes) {
      const details = [];
      if (decision.strikes.putStrike) {
        details.push(`${decision.strikes.putStrike.strike}P (δ ${decision.strikes.putStrike.delta?.toFixed(2) || 'N/A'})`);
      }
      if (decision.strikes.callStrike) {
        details.push(`${decision.strikes.callStrike.strike}C (δ ${decision.strikes.callStrike.delta?.toFixed(2) || 'N/A'})`);
      }
      steps.push({
        name: 'Strikes',
        status: strikesStep.passed ? 'passed' : 'failed',
        detail: details.join(' / ') || 'No strikes selected'
      });
    }

    // Step 4: Position Size
    const positionStep = decision.audit.find(a => a.step === 4);
    if (positionStep && decision.positionSize) {
      steps.push({
        name: 'Position Size',
        status: positionStep.passed ? 'passed' : 'failed',
        detail: `${decision.positionSize.contracts} contracts ($${decision.positionSize.totalRisk?.toFixed(0) || '0'} risk)`
      });
    }

    // Step 5: Exit Rules
    const exitStep = decision.audit.find(a => a.step === 5);
    if (exitStep && decision.exitRules) {
      steps.push({
        name: 'Exit Rules',
        status: exitStep.passed ? 'passed' : 'failed',
        detail: `Stop: $${decision.exitRules.stopLoss}, Target: $${decision.exitRules.takeProfit}`
      });
    }

    // Fill in any missing steps
    while (steps.length < 5) {
      const stepNames = ['Market Regime', 'Direction', 'Strikes', 'Position Size', 'Exit Rules'];
      const stepName = stepNames[steps.length];
      steps.push({
        name: stepName,
        status: 'pending',
        detail: '—'
      });
    }

    return steps;
  }, []);

  // Initialize status and poll trading window
  useEffect(() => {
    updateStatus();
    fetchConfig();
    // Poll trading window every 10s to update when window opens/closes
    const interval = setInterval(updateStatus, 10000);
    return () => clearInterval(interval);
  }, [updateStatus, fetchConfig]);

  return {
    status,
    brokerConnected,  // Direct from React Query - no state indirection
    decision,
    analysis,         // NEW: Standardized EngineAnalyzeResponse
    config,
    loading,
    error,
    fetchStatus,
    executeDecision,
    analyzeEngine,    // NEW: Run analysis with standardized response
    executePaperTrade,// NEW: Execute paper trade
    executeTrade,
    fetchConfig,
    updateConfig,
    formatSteps
  };
}

// Re-export types for convenience
export type { EngineAnalyzeResponse, TradeProposal, AnalyzeOptions } from '@shared/types/engine';