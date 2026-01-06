/**
 * EngineWizardLayout - Main wizard container with sidebar
 *
 * Layout:
 * - Header: Back button, title, broker status
 * - Progress: EngineStepper
 * - Content: 70% main area, 30% sidebar (EngineLog)
 */

import { ReactNode } from 'react';
import { ArrowLeft, Zap, XCircle } from 'lucide-react';
import { Link } from 'wouter';
import { EngineStepper, StepId } from './EngineStepper';
import EngineLog from '../EngineLog';
import type { EnhancedEngineLog } from '@shared/types/engineLog';

interface EngineWizardLayoutProps {
  symbol: string;
  brokerConnected: boolean;
  environment: 'live' | 'paper' | 'simulation';
  currentStep: StepId;
  completedSteps: Set<StepId>;
  onStepClick: (step: StepId) => void;
  children: ReactNode;
  engineLog: EnhancedEngineLog | null;
  isRunning: boolean;
}

export function EngineWizardLayout({
  symbol,
  brokerConnected,
  environment,
  currentStep,
  completedSteps,
  onStepClick,
  children,
  engineLog,
  isRunning,
}: EngineWizardLayoutProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
        <Link href="/">
          <a className="flex items-center gap-2 text-zinc-400 hover:text-white transition">
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm">Dashboard</span>
          </a>
        </Link>

        <h1 className="text-xl font-bold">
          {symbol} Engine
        </h1>

        <div className="flex items-center gap-2">
          {brokerConnected ? (
            <Zap className={`w-4 h-4 ${environment === 'live' ? 'text-green-500' : 'text-yellow-500'}`} />
          ) : (
            <XCircle className="w-4 h-4 text-red-500" />
          )}
          <span className="text-sm text-zinc-400">
            {brokerConnected
              ? environment === 'live' ? 'IBKR Live' : 'IBKR Paper'
              : 'Disconnected'
            }
          </span>
        </div>
      </header>

      {/* Progress Bar */}
      <div className="px-6 border-b border-zinc-800 bg-zinc-900/50">
        <EngineStepper
          currentStep={currentStep}
          completedSteps={completedSteps}
          onStepClick={onStepClick}
        />
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Step Content - 70% */}
        <main className="flex-1 overflow-y-auto p-6">
          <div className="max-w-2xl mx-auto">
            {children}
          </div>
        </main>

        {/* Sidebar - 30% */}
        <aside className="w-[400px] border-l border-zinc-800 overflow-hidden flex flex-col bg-zinc-950">
          <div className="px-4 py-3 border-b border-zinc-800">
            <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
              Engine Log
            </h2>
          </div>
          <div className="flex-1 overflow-y-auto">
            <EngineLog
              log={engineLog}
              isRunning={isRunning}
              className="border-0 rounded-none h-full"
            />
          </div>
        </aside>
      </div>
    </div>
  );
}
