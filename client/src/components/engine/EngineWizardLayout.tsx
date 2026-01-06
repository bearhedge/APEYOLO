/**
 * EngineWizardLayout - Main wizard container with sidebar
 *
 * Layout:
 * - Header: Back button, title, broker status
 * - Progress: EngineStepper
 * - Content: 70% main area, 30% sidebar (EngineLog)
 *
 * Mobile:
 * - Sidebar becomes bottom drawer (collapsible)
 * - Content takes full width
 */

import { ReactNode, useState } from 'react';
import { ArrowLeft, Zap, XCircle, ChevronUp, ChevronDown, Terminal } from 'lucide-react';
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
  // Mobile drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);

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

      {/* Main Content Area - Desktop: Side by side, Mobile: Stacked */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Step Content */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          <div className="max-w-2xl mx-auto">
            {children}
          </div>
        </main>

        {/* Sidebar - Hidden on mobile, shown on lg+ */}
        <aside className="hidden lg:flex w-[400px] border-l border-zinc-800 overflow-hidden flex-col bg-zinc-950">
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

      {/* Mobile Bottom Drawer - Only shown on mobile */}
      <div className="lg:hidden border-t border-zinc-800 bg-zinc-950">
        {/* Drawer Toggle */}
        <button
          onClick={() => setDrawerOpen(!drawerOpen)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-900/50 transition"
        >
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-zinc-400" />
            <span className="text-sm font-medium text-zinc-400">Engine Log</span>
            {isRunning && (
              <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
            )}
          </div>
          {drawerOpen ? (
            <ChevronDown className="w-4 h-4 text-zinc-400" />
          ) : (
            <ChevronUp className="w-4 h-4 text-zinc-400" />
          )}
        </button>

        {/* Drawer Content */}
        {drawerOpen && (
          <div className="h-64 overflow-y-auto border-t border-zinc-800">
            <EngineLog
              log={engineLog}
              isRunning={isRunning}
              className="border-0 rounded-none h-full"
            />
          </div>
        )}
      </div>
    </div>
  );
}
