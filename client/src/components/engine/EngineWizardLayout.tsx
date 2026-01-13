/**
 * EngineWizardLayout - Main wizard container (simplified)
 *
 * Layout:
 * - Header: Back button, title, broker status
 * - Progress: EngineStepper
 * - Content: Full width (logging happens in AgentSidebar)
 *
 * Note: This layout no longer includes the Engine log panel.
 * All execution logging flows through the unified AgentSidebar ActivityFeed.
 */

import { ReactNode } from 'react';
import { ArrowLeft, Zap, XCircle } from 'lucide-react';
import { Link } from 'wouter';
import { EngineStepper, StepId } from './EngineStepper';

interface EngineWizardLayoutProps {
  symbol: string;
  brokerConnected: boolean;
  environment: 'live' | 'paper' | 'simulation';
  currentStep: StepId;
  completedSteps: Set<StepId>;
  onStepClick: (step: StepId) => void;
  children: ReactNode;
}

export function EngineWizardLayout({
  symbol,
  brokerConnected,
  environment,
  currentStep,
  completedSteps,
  onStepClick,
  children,
}: EngineWizardLayoutProps) {

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-4 md:px-6 py-3 md:py-4 border-b border-zinc-800">
        <Link href="/">
          <a className="flex items-center gap-2 text-zinc-400 hover:text-white transition">
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm hidden sm:inline">Dashboard</span>
          </a>
        </Link>

        <h1 className="text-lg md:text-xl font-bold">
          {symbol} Engine
        </h1>

        <div className="flex items-center gap-2">
          {brokerConnected ? (
            <Zap className={`w-4 h-4 ${environment === 'live' ? 'text-green-500' : 'text-yellow-500'}`} />
          ) : (
            <XCircle className="w-4 h-4 text-red-500" />
          )}
          <span className="text-xs md:text-sm text-zinc-400">
            {brokerConnected
              ? environment === 'live' ? 'Live' : 'Paper'
              : 'Disconnected'
            }
          </span>
        </div>
      </header>

      {/* Progress Bar - Scrollable on mobile */}
      <div className="px-2 md:px-6 border-b border-zinc-800 bg-zinc-900/50 overflow-x-auto">
        <EngineStepper
          currentStep={currentStep}
          completedSteps={completedSteps}
          onStepClick={onStepClick}
        />
      </div>

      {/* Main Content Area - Full width (log moved to AgentSidebar) */}
      <div className="flex-1 overflow-hidden">
        <main className="h-full overflow-y-auto p-4 md:p-6">
          <div className="max-w-2xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
