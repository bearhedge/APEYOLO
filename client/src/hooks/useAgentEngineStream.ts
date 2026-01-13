/**
 * useAgentEngineStream - Consumes Agent's tool_progress events
 * and updates Engine Wizard UI state
 */
import { useState, useEffect } from 'react';
import { useAgentOperator } from './useAgentOperator';
import type { EngineAnalyzeResponse } from '@shared/types/engine';

export function useAgentEngineStream() {
  const { activities, isProcessing, activeProposal } = useAgentOperator();
  const [streamingAnalysis, setStreamingAnalysis] = useState<EngineAnalyzeResponse | null>(null);
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());

  // Parse tool_progress events and update UI state
  useEffect(() => {
    // Filter for tool_progress events from runEngine
    const engineSteps = activities.filter(
      a => a.type === 'tool_progress' && a.tool === 'runEngine'
    );

    if (engineSteps.length === 0) return;

    // Find latest completed step
    const latestStep = engineSteps[engineSteps.length - 1];

    // Parse step number from activity
    const stepMatch = latestStep.content?.match(/Step (\d+):/);
    if (stepMatch) {
      const stepNum = parseInt(stepMatch[1], 10);
      setCurrentStep(stepNum);

      // Mark all steps up to current as complete if status is 'done'
      if (latestStep.status === 'done') {
        setCompletedSteps(prev => {
          const updated = new Set(prev);
          for (let i = 1; i <= stepNum; i++) {
            updated.add(i);
          }
          return updated;
        });
      }
    }

    // Build EngineAnalysis when proposal is available
    if (activeProposal) {
      const putLeg = activeProposal.legs.find(l => l.optionType === 'PUT');
      const callLeg = activeProposal.legs.find(l => l.optionType === 'CALL');

      setStreamingAnalysis({
        canTrade: true,
        reason: null,
        q1MarketCheck: {
          vixAcceptable: true,
          vixLevel: 0, // TODO: Get from market data
          marketState: 'REGULAR',
          spyPrice: 0, // TODO: Get from market data
        },
        q2Direction: {
          selectedBias: activeProposal.bias,
          reasoning: activeProposal.reasoning,
        },
        q3Strikes: {
          selectedPut: putLeg ? {
            strike: putLeg.strike,
            delta: putLeg.delta,
            bid: putLeg.bid,
            ask: putLeg.ask,
            mid: ((putLeg.bid || 0) + (putLeg.ask || 0)) / 2,
          } : null,
          selectedCall: callLeg ? {
            strike: callLeg.strike,
            delta: callLeg.delta,
            bid: callLeg.bid,
            ask: callLeg.ask,
            mid: ((callLeg.bid || 0) + (callLeg.ask || 0)) / 2,
          } : null,
          smartCandidates: {
            puts: putLeg ? [putLeg] : [],
            calls: callLeg ? [callLeg] : [],
          },
        },
        q4RiskTier: {
          tier: 'balanced',
          contracts: activeProposal.contracts,
          totalPremium: activeProposal.entryPremiumTotal,
          maxLoss: activeProposal.maxLoss,
        },
        q5Exit: {
          stopLossMultiplier: 3, // TODO: Get from guard rails
          stopLossPrice: activeProposal.stopLossPrice,
          takeProfitPercent: 50,
        },
      });

      // Jump to Step 3 (Strike Selection) when analysis complete
      setCurrentStep(3);
      setCompletedSteps(new Set([1, 2, 3, 4, 5]));
    }
  }, [activities, activeProposal]);

  // Debug logging to verify state updates
  useEffect(() => {
    console.log('[useAgentEngineStream] currentStep:', currentStep);
    console.log('[useAgentEngineStream] completedSteps:', Array.from(completedSteps));
  }, [currentStep, completedSteps]);

  return {
    streamingAnalysis,
    currentStep,
    completedSteps,
    isRunning: isProcessing,
  };
}
