/**
 * Custom hook for Engine API integration
 */

import { useState, useEffect, useCallback } from 'react';

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

export function useEngine() {
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [decision, setDecision] = useState<TradingDecision | null>(null);
  const [config, setConfig] = useState<EngineConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch engine status
  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/engine/status', {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch engine status');
      const data = await response.json();
      setStatus(data);
      setError(null);
    } catch (err) {
      console.error('[Engine] Status error:', err);
      setError('Failed to fetch engine status');
    }
  }, []);

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
        { name: 'Market Regime', status: 'pending', detail: 'Waiting for analysis' },
        { name: 'Direction', status: 'pending', detail: 'Waiting for analysis' },
        { name: 'Strikes', status: 'pending', detail: 'Waiting for analysis' },
        { name: 'Position Size', status: 'pending', detail: 'Waiting for analysis' },
        { name: 'Exit Rules', status: 'pending', detail: 'Waiting for analysis' },
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
        detail: 'Not reached'
      });
    }

    return steps;
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchStatus();
    fetchConfig();
    // Set up polling interval
    const interval = setInterval(fetchStatus, 30000); // Update every 30 seconds
    return () => clearInterval(interval);
  }, [fetchStatus, fetchConfig]);

  return {
    status,
    decision,
    config,
    loading,
    error,
    fetchStatus,
    executeDecision,
    executeTrade,
    fetchConfig,
    updateConfig,
    formatSteps
  };
}