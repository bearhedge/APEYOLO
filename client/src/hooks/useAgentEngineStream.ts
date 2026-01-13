/**
 * useAgentEngineStream - Consumes Agent's tool_progress events
 * and updates Engine Wizard UI state
 */
import { useState, useEffect } from 'react';
import { useAgentOperator } from './useAgentOperator';
import type { EngineAnalyzeResponse } from '@shared/types/engine';

export function useAgentEngineStream() {
  const { activities, isProcessing } = useAgentOperator();
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

    // Find proposal activity (final result)
    const proposalActivity = activities.find(a => a.type === 'info' && a.content?.includes('Trade opportunity found'));

    if (proposalActivity) {
      // TODO: Extract strikes and analysis from proposal
      // This will be built from the activeProposal in Task 2
    }
  }, [activities]);

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
