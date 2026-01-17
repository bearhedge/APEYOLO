/**
 * Trade Page - Unified trading interface
 *
 * Combines Engine workflow (center) + Agent sidebar (right).
 * Engine uses useEngineAnalysis (direct API).
 * Agent sidebar uses its own useAgentOperator (separate state).
 */

import { useState, useEffect } from 'react';
import { LeftNav } from '@/components/LeftNav';
import { Engine } from '@/pages/Engine';
import { AgentSidebar } from '@/components/agent/AgentSidebar';
import { useEngineAnalysis } from '@/hooks/useEngineAnalysis';
import type { StrategyPreference } from '@shared/types/engine';

export function Trade() {
  // Strategy state - user can select PUT/CALL/strangle in Step 1
  const [strategy, setStrategy] = useState<StrategyPreference>('strangle');

  // Engine analysis - completely separate from Agent
  const {
    analyze,
    isAnalyzing,
    currentStep,
    completedSteps,
    analysis,
    error,
  } = useEngineAnalysis({
    symbol: 'SPY',
    strategy,  // Use dynamic strategy from user selection
    riskTier: 'balanced',
  });

  // Load Agent sidebar collapsed state from localStorage
  const [isAgentCollapsed, setIsAgentCollapsed] = useState(() => {
    const saved = localStorage.getItem('agent-sidebar-collapsed');
    if (saved !== null) return saved === 'true';
    return window.innerWidth < 1280;
  });

  // Persist collapsed state to localStorage
  useEffect(() => {
    localStorage.setItem('agent-sidebar-collapsed', String(isAgentCollapsed));
  }, [isAgentCollapsed]);

  // Auto-collapse on resize (responsive)
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1280 && !isAgentCollapsed) {
        setIsAgentCollapsed(true);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isAgentCollapsed]);

  const toggleAgentSidebar = () => setIsAgentCollapsed(!isAgentCollapsed);

  console.log('[Trade] isAnalyzing:', isAnalyzing, 'currentStep:', currentStep);

  return (
    <div className="flex h-[calc(100vh-64px)]">
      {/* Left Navigation */}
      <LeftNav />

      {/* Engine Workflow (Center) */}
      <div
        className="min-w-0 overflow-hidden"
        style={{ flex: isAgentCollapsed ? '1 0 0' : '55 0 0' }}
      >
        <Engine
          hideLeftNav={true}
          isAnalyzing={isAnalyzing}
          currentStep={currentStep}
          completedSteps={completedSteps}
          streamAnalysis={analysis}
          streamError={error}
          onAnalyze={analyze}
          onStrategyPrefChange={setStrategy}
        />
      </div>

      {/* Agent Sidebar (Right) - Uses its own useAgentOperator */}
      <AgentSidebar
        isCollapsed={isAgentCollapsed}
        onToggleCollapse={toggleAgentSidebar}
      />
    </div>
  );
}
