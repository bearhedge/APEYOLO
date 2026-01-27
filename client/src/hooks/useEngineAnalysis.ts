/**
 * useEngineAnalysis - Step-by-step Engine analysis
 *
 * Calls each step individually for fast feedback:
 * - Step 1: /api/engine/step1 (Market Regime) ~200ms
 * - Step 2: /api/engine/step2 (Direction) ~2-5s
 * - Step 3: /api/engine/step3 (Strikes) ~5-15s
 * - Step 4: /api/engine/step4 (Position Size) ~100ms
 *
 * Each step shows result immediately instead of waiting 3+ minutes
 */

import { useState, useCallback, useRef } from 'react';
import type { EngineAnalyzeResponse } from '@shared/types/engine';

interface UseEngineAnalysisOptions {
  symbol?: string;
  strategy?: 'strangle' | 'put-only' | 'call-only';
  riskTier?: 'conservative' | 'balanced' | 'aggressive';
}

// Step results storage
interface StepResults {
  step1?: any; // MarketRegime
  step2?: any; // DirectionDecision
  step3?: any; // StrikeSelection
  step4?: any; // PositionSize
  accountInfo?: any;
}

interface UseEngineAnalysisReturn {
  // Actions
  analyze: () => void;      // Start from Step 1
  nextStep: () => void;     // Continue to next step
  cancel: () => void;

  // State
  isAnalyzing: boolean;
  currentStep: number;
  completedSteps: Set<number>;
  analysis: EngineAnalyzeResponse | null;
  error: string | null;
  stepResults: StepResults; // Intermediate results
}

export function useEngineAnalysis(options: UseEngineAnalysisOptions = {}): UseEngineAnalysisReturn {
  const { symbol = 'SPY', strategy = 'strangle', riskTier = 'balanced' } = options;

  // State
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [analysis, setAnalysis] = useState<EngineAnalyzeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stepResults, setStepResults] = useState<StepResults>({});

  // Ref for AbortController
  const abortControllerRef = useRef<AbortController | null>(null);

  // Get expiration mode from symbol
  const expirationMode = symbol === 'ARM' ? 'WEEKLY' : '0DTE';

  // Cancel any running analysis
  const cancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsAnalyzing(false);
  }, []);

  // Run Step 1: Market Regime Check
  const runStep1 = useCallback(async (abortSignal: AbortSignal) => {
    console.log('[useEngineAnalysis] Running Step 1: Market Regime');
    setCurrentStep(1);

    const response = await fetch(`/api/engine/step1?symbol=${symbol}`, {
      method: 'GET',
      credentials: 'include',
      signal: abortSignal,
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || `Step 1 failed (${response.status})`);
    }

    const data = await response.json();
    console.log(`[useEngineAnalysis] Step 1 complete in ${data.durationMs}ms`);

    // Mark step 1 complete
    setCompletedSteps(prev => new Set([...prev, 1]));
    setStepResults(prev => ({ ...prev, step1: data.result }));

    return data.result;
  }, [symbol]);

  // Run Step 2: Direction Selection
  const runStep2 = useCallback(async (abortSignal: AbortSignal, marketRegime: any) => {
    console.log('[useEngineAnalysis] Running Step 2: Direction Selection');
    setCurrentStep(2);

    const response = await fetch('/api/engine/step2', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        marketRegime,
        symbol,
        expirationMode,
        forcedStrategy: strategy !== 'strangle' ? strategy : undefined,
      }),
      signal: abortSignal,
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || `Step 2 failed (${response.status})`);
    }

    const data = await response.json();
    console.log(`[useEngineAnalysis] Step 2 complete in ${data.durationMs}ms - Direction: ${data.result.direction}`);

    setCompletedSteps(prev => new Set([...prev, 2]));
    setStepResults(prev => ({ ...prev, step2: data.result }));

    return data.result;
  }, [symbol, expirationMode, strategy]);

  // Run Step 3: Strike Selection
  const runStep3 = useCallback(async (abortSignal: AbortSignal, direction: any, underlyingPrice: number, accountInfo: any) => {
    console.log('[useEngineAnalysis] Running Step 3: Strike Selection');
    setCurrentStep(3);

    const response = await fetch('/api/engine/step3', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        direction,
        symbol,
        expirationMode,
        underlyingPrice,
        accountInfo,
        riskProfile: riskTier.toUpperCase(),
      }),
      signal: abortSignal,
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || `Step 3 failed (${response.status})`);
    }

    const data = await response.json();
    console.log(`[useEngineAnalysis] Step 3 complete in ${data.durationMs}ms`);
    console.log(`[useEngineAnalysis] Step 3 result:`, JSON.stringify({
      hasPutStrike: !!data.result?.putStrike,
      hasCallStrike: !!data.result?.callStrike,
      smartCandidatesPuts: data.result?.smartCandidates?.puts?.length ?? 'undefined',
      smartCandidatesCalls: data.result?.smartCandidates?.calls?.length ?? 'undefined',
      expectedPremium: data.result?.expectedPremium,
      nearbyPuts: data.result?.nearbyStrikes?.puts?.length ?? 'undefined',
      nearbyCalls: data.result?.nearbyStrikes?.calls?.length ?? 'undefined',
    }));

    setCompletedSteps(prev => new Set([...prev, 3]));
    setStepResults(prev => ({ ...prev, step3: data.result }));

    return data.result;
  }, [symbol, expirationMode, riskTier]);

  // Run Step 4: Position Sizing
  const runStep4 = useCallback(async (abortSignal: AbortSignal, strikes: any, accountInfo: any) => {
    console.log('[useEngineAnalysis] Running Step 4: Position Sizing');
    setCurrentStep(4);

    const response = await fetch('/api/engine/step4', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        strikes,
        accountInfo,
        riskProfile: riskTier.toUpperCase(),
      }),
      signal: abortSignal,
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || `Step 4 failed (${response.status})`);
    }

    const data = await response.json();
    console.log(`[useEngineAnalysis] Step 4 complete in ${data.durationMs}ms - Contracts: ${data.result.contracts}`);

    setCompletedSteps(prev => new Set([...prev, 4]));
    setStepResults(prev => ({ ...prev, step4: data.result }));

    return data.result;
  }, [riskTier]);

  // Get account info
  const getAccountInfo = useCallback(async (abortSignal: AbortSignal) => {
    const response = await fetch('/api/account', {
      credentials: 'include',
      signal: abortSignal,
    });
    if (!response.ok) {
      throw new Error('Failed to get account info');
    }
    const data = await response.json();
    return {
      buyingPower: data.buyingPower,
      cashBalance: data.totalCash || data.cashBalance,
      netLiquidation: data.netLiquidation || data.totalValue,
    };
  }, []);

  // Start analysis from Step 1 and run ALL steps automatically
  const analyze = useCallback(async () => {
    // Cancel any existing analysis
    cancel();

    // Reset state
    setIsAnalyzing(true);
    setCurrentStep(1);
    setCompletedSteps(new Set());
    setAnalysis(null);
    setError(null);
    setStepResults({});

    // Create new AbortController
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    console.log('[useEngineAnalysis] Starting step-by-step analysis');

    try {
      // Step 1: Market Regime
      const step1Result = await runStep1(abortController.signal);
      if (abortController.signal.aborted) return;

      // Get account info for step 3/4
      const accountInfo = await getAccountInfo(abortController.signal);
      setStepResults(prev => ({ ...prev, accountInfo }));
      if (abortController.signal.aborted) return;

      // Step 2: Direction Selection
      const step2Result = await runStep2(abortController.signal, step1Result);
      if (abortController.signal.aborted) return;

      // Get underlying price from step1
      const underlyingPrice = step1Result.metadata?.spyPrice || 450;

      // Step 3: Strike Selection
      const step3Result = await runStep3(abortController.signal, step2Result, underlyingPrice, accountInfo);
      if (abortController.signal.aborted) return;

      // Step 4: Position Sizing
      const step4Result = await runStep4(abortController.signal, step3Result, accountInfo);
      if (abortController.signal.aborted) return;

      // Build final analysis response with CORRECT field names (EngineAnalyzeResponse)
      // Engine.tsx expects q1MarketRegime, q2Direction, q3Strikes, q4Size, q5Exit
      const finalAnalysis = {
        timestamp: new Date().toISOString(),
        requestId: `step-${Date.now()}`,
        version: '2.0.0',
        canTrade: step1Result.shouldTrade && step3Result.expectedPremium > 0,
        executionReady: step3Result.expectedPremium > 0,

        // Q1 - Market Regime (Engine.tsx: effectiveAnalysis?.q1MarketRegime)
        q1MarketRegime: {
          ...step1Result,
          regimeLabel: step1Result.regime || 'NORMAL',
          riskMultiplier: 1.0,
          canTrade: step1Result.shouldTrade,
          reason: step1Result.reasoning || '',
          inputs: {
            vixValue: step1Result.vix || null,
            vixChangePct: step1Result.vixChange || null,
            spyPrice: step1Result.metadata?.spyPrice || null,
            spyChangePct: null,
            currentTimeEt: new Date().toISOString(),
            isTradingHours: step1Result.tradingWindowOpen,
          },
          thresholds: { vixLow: 17, vixHigh: 20, vixExtreme: 35 },
          stepNumber: 1 as const,
          stepName: 'Market Regime' as const,
          passed: step1Result.shouldTrade,
          confidence: 0.8,
        },

        // Q2 - Direction (Engine.tsx: effectiveAnalysis?.q2Direction)
        q2Direction: {
          ...step2Result,
          bias: step2Result.bias || 'NEUTRAL',
          recommendedDirection: step2Result.direction,
          confidencePct: step2Result.confidence || 70,
          comment: step2Result.reasoning || '',
          inputs: {
            spyPrice: step1Result.metadata?.spyPrice || 450,
            ma50: 0,
            maPeriod: 50,
          },
          signals: {
            trend: step2Result.trend || 'SIDEWAYS',
            momentum: 0,
            maAlignment: '',
          },
          stepNumber: 2 as const,
          stepName: 'Direction' as const,
          passed: true,
          confidence: step2Result.confidence || 0.7,
        },

        // Q3 - Strikes (Engine.tsx: effectiveAnalysis?.q3Strikes?.smartCandidates?.puts)
        q3Strikes: {
          // Selected strikes (Engine.tsx: q3Strikes.selectedPut?.strike)
          selectedPut: step3Result.putStrike ? {
            strike: step3Result.putStrike.strike,
            delta: step3Result.putStrike.delta,
            premium: (step3Result.putStrike.bid + step3Result.putStrike.ask) / 2,
            bid: step3Result.putStrike.bid,
            ask: step3Result.putStrike.ask,
            probItm: Math.abs(step3Result.putStrike.delta),
            sigmaDist: 0,
            optionType: 'PUT' as const,
          } : null,
          selectedCall: step3Result.callStrike ? {
            strike: step3Result.callStrike.strike,
            delta: step3Result.callStrike.delta,
            premium: (step3Result.callStrike.bid + step3Result.callStrike.ask) / 2,
            bid: step3Result.callStrike.bid,
            ask: step3Result.callStrike.ask,
            probItm: Math.abs(step3Result.callStrike.delta),
            sigmaDist: 0,
            optionType: 'CALL' as const,
          } : null,

          // Candidates for display (legacy)
          candidates: [],

          // AI Strike Selector: Use server's pre-filtered smartCandidates if available,
          // otherwise fall back to mapping nearbyStrikes
          smartCandidates: step3Result.smartCandidates ?? {
            puts: (step3Result.nearbyStrikes?.puts ?? []).map((s: any) => ({
              strike: s.strike,
              optionType: 'PUT' as const,
              bid: s.bid,
              ask: s.ask,
              spread: s.ask - s.bid,
              delta: s.delta,
              openInterest: s.oi ?? 0,
              yield: ((s.bid + s.ask) / 2) / (step1Result.metadata?.spyPrice || underlyingPrice),
              yieldPct: `${(((s.bid + s.ask) / 2) / (step1Result.metadata?.spyPrice || underlyingPrice) * 100).toFixed(3)}%`,
              qualityScore: 3 as const,
              qualityReasons: ['Available strike'],
              isEngineRecommended: step3Result.putStrike?.strike === s.strike,
              isUserSelected: false,
            })),
            calls: (step3Result.nearbyStrikes?.calls ?? []).map((s: any) => ({
              strike: s.strike,
              optionType: 'CALL' as const,
              bid: s.bid,
              ask: s.ask,
              spread: s.ask - s.bid,
              delta: s.delta,
              openInterest: s.oi ?? 0,
              yield: ((s.bid + s.ask) / 2) / (step1Result.metadata?.spyPrice || underlyingPrice),
              yieldPct: `${(((s.bid + s.ask) / 2) / (step1Result.metadata?.spyPrice || underlyingPrice) * 100).toFixed(3)}%`,
              qualityScore: 3 as const,
              qualityReasons: ['Available strike'],
              isEngineRecommended: step3Result.callStrike?.strike === s.strike,
              isUserSelected: false,
            })),
          },

          // Other required fields
          expectedPremiumPerContract: step3Result.expectedPremium * 100, // Convert to cents
          dataSource: 'IBKR' as const,
          underlyingPrice: step1Result.metadata?.spyPrice || underlyingPrice,

          inputs: {
            targetDeltaMin: 0.10,
            targetDeltaMax: 0.20,
            targetDeltaIdeal: 0.15,
            symbol,
            expiration: new Date().toISOString().split('T')[0],
          },

          rejectedStrikes: step3Result.rejectedStrikes || [],
          filterConfig: step3Result.filterConfig,
          awaitingUserSelection: step3Result.awaitingUserSelection,

          stepNumber: 3 as const,
          stepName: 'Strikes' as const,
          passed: step3Result.expectedPremium > 0,
          confidence: 0.8,
        },

        // Q4 - Size (Engine.tsx: effectiveAnalysis?.q4Size)
        q4Size: {
          maxContractsByRisk: step4Result.contracts,
          maxContractsByBp: step4Result.contracts,
          recommendedContracts: step4Result.contracts,
          expectedPremiumTotal: step3Result.expectedPremium * step4Result.contracts,
          worstCaseLoss: step3Result.marginRequired * step4Result.contracts * 0.1,
          marginPerContract: step3Result.marginRequired,
          totalMarginRequired: step3Result.marginRequired * step4Result.contracts,
          pctOfNav: 0,
          inputs: {
            nav: accountInfo.netLiquidation || 0,
            buyingPower: accountInfo.buyingPower || 0,
            cashBalance: accountInfo.cashBalance || 0,
            riskProfile: riskTier.toUpperCase() as 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE',
            premiumPerContract: step3Result.expectedPremium,
            accountValue: accountInfo.netLiquidation || accountInfo.cashBalance,
          },
          riskLimits: {
            maxContracts: 5,
            bpUtilizationPct: 0.2,
            maxPositionPctOfNav: 0.05,
          },
          stepNumber: 4 as const,
          stepName: 'Size' as const,
          passed: true,
          confidence: 0.9,
        },

        // Q5 - Exit (Engine.tsx: effectiveAnalysis?.q5Exit)
        q5Exit: {
          takeProfitPrice: null,
          stopLossPrice: step3Result.expectedPremium * 3, // 3x entry = stop
          stopLossAmount: step3Result.expectedPremium * 3 * step4Result.contracts,
          timeStopEt: '15:45',
          takeProfitPct: 50,
          stopLossMultiplier: 3,
          maxHoldHours: 6,
          inputs: {
            entryPremium: step3Result.expectedPremium,
            contracts: step4Result.contracts,
            expirationTime: '16:00',
          },
          rules: {
            stopLossRule: '3x entry premium',
            takeProfitRule: '50% of max profit',
            timeStopRule: 'Close at 3:45 PM ET',
          },
          stepNumber: 5 as const,
          stepName: 'Exit' as const,
          passed: true,
          confidence: 0.9,
        },

        // Trade proposal (Engine.tsx: effectiveAnalysis?.tradeProposal)
        tradeProposal: {
          proposalId: `prop-${Date.now()}`,
          createdAt: new Date().toISOString(),
          symbol,
          expiration: new Date().toISOString().split('T')[0],
          expirationDate: new Date().toISOString().split('T')[0],
          strategy: step2Result.direction,
          bias: step2Result.bias || 'NEUTRAL',
          legs: [
            ...(step3Result.putStrike ? [{
              optionType: 'PUT' as const,
              action: 'SELL' as const,
              strike: step3Result.putStrike.strike,
              delta: step3Result.putStrike.delta,
              premium: (step3Result.putStrike.bid + step3Result.putStrike.ask) / 2,
              bid: step3Result.putStrike.bid,
              ask: step3Result.putStrike.ask,
            }] : []),
            ...(step3Result.callStrike ? [{
              optionType: 'CALL' as const,
              action: 'SELL' as const,
              strike: step3Result.callStrike.strike,
              delta: step3Result.callStrike.delta,
              premium: (step3Result.callStrike.bid + step3Result.callStrike.ask) / 2,
              bid: step3Result.callStrike.bid,
              ask: step3Result.callStrike.ask,
            }] : []),
          ],
          contracts: step4Result.contracts,
          entryPremiumPerContract: step3Result.expectedPremium,
          entryPremiumTotal: step3Result.expectedPremium * step4Result.contracts,
          marginRequired: step3Result.marginRequired * step4Result.contracts,
          maxLoss: step3Result.marginRequired * step4Result.contracts * 0.1,
          stopLossPrice: step3Result.expectedPremium * 3,
          stopLossAmount: step3Result.expectedPremium * 3 * step4Result.contracts,
          takeProfitPrice: step3Result.expectedPremium * 0.5,
          timeStop: '15:45',
          context: {
            vix: step1Result.vix || 20,
            spyPrice: step1Result.metadata?.spyPrice || 450,
          },
        },

        // Guard rails
        guardRails: {
          passed: true,
          violations: [],
        },

        // Trading window
        tradingWindow: {
          isOpen: step1Result.tradingWindowOpen,
        },

        // Audit trail
        audit: [],

        // Risk assessment (Engine.tsx: effectiveAnalysis?.riskAssessment)
        riskAssessment: step3Result.riskAssessment,

        // Enhanced log
        enhancedLog: null,
      } as EngineAnalyzeResponse;

      // Mark step 5 complete (exit rules - just using defaults)
      setCompletedSteps(prev => new Set([...prev, 5]));
      setCurrentStep(5);
      setAnalysis(finalAnalysis);
      setIsAnalyzing(false);
      abortControllerRef.current = null;

      console.log('[useEngineAnalysis] All steps complete!');

    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        console.log('[useEngineAnalysis] Request aborted');
        return;
      }

      console.error('[useEngineAnalysis] Error:', err);
      setError(err instanceof Error ? err.message : 'Analysis failed');
      setIsAnalyzing(false);
      abortControllerRef.current = null;
    }
  }, [cancel, runStep1, runStep2, runStep3, runStep4, getAccountInfo, symbol]);

  // Continue to next step (for manual step-by-step mode if needed later)
  const nextStep = useCallback(() => {
    // For now, analyze runs all steps automatically
    // This can be extended for manual step-by-step mode
    console.log('[useEngineAnalysis] nextStep called - auto mode runs all steps');
  }, []);

  return {
    analyze,
    nextStep,
    cancel,
    isAnalyzing,
    currentStep,
    completedSteps,
    analysis,
    error,
    stepResults,
  };
}
