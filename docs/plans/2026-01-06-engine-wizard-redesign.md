# Engine Page Wizard Redesign - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the Engine page from stacked cards to a polished stepper/wizard with sidebar, achieving production SaaS quality.

**Architecture:** Replace the current 5-card vertical stack with a centered wizard layout. A progress bar at the top shows step completion. Main content area shows one step at a time. Right sidebar displays the EngineLog in real-time. All backend logic and API calls remain unchanged - this is purely a frontend visual refactor.

**Tech Stack:** React, TypeScript, TailwindCSS, existing shadcn/ui components

---

## Task 1: Create EngineStepper Component

**Files:**
- Create: `client/src/components/engine/EngineStepper.tsx`

**Step 1: Create the engine components directory**

```bash
mkdir -p client/src/components/engine
```

**Step 2: Write the EngineStepper component**

Create `client/src/components/engine/EngineStepper.tsx`:

```tsx
/**
 * EngineStepper - Progress bar showing 5-step wizard progress
 *
 * Displays: Market → Direction → Strikes → Size → Exit
 * States: completed (✓), current (●), future (○)
 * Clickable to navigate back (not forward)
 */

import { Check } from 'lucide-react';

export type StepId = 1 | 2 | 3 | 4 | 5;

interface EngineStepperProps {
  currentStep: StepId;
  completedSteps: Set<StepId>;
  onStepClick: (step: StepId) => void;
}

const STEPS: { id: StepId; label: string }[] = [
  { id: 1, label: 'Market' },
  { id: 2, label: 'Direction' },
  { id: 3, label: 'Strikes' },
  { id: 4, label: 'Size' },
  { id: 5, label: 'Exit' },
];

export function EngineStepper({ currentStep, completedSteps, onStepClick }: EngineStepperProps) {
  return (
    <div className="flex items-center justify-center gap-0 py-4">
      {STEPS.map((step, index) => {
        const isCompleted = completedSteps.has(step.id);
        const isCurrent = step.id === currentStep;
        const isFuture = step.id > currentStep && !isCompleted;
        const canClick = isCompleted || step.id < currentStep;

        return (
          <div key={step.id} className="flex items-center">
            {/* Step circle + label */}
            <button
              onClick={() => canClick && onStepClick(step.id)}
              disabled={!canClick}
              className={`
                flex flex-col items-center gap-1
                ${canClick ? 'cursor-pointer' : 'cursor-default'}
              `}
            >
              <div
                className={`
                  w-10 h-10 rounded-full flex items-center justify-center
                  text-sm font-semibold transition-all
                  ${isCompleted
                    ? 'bg-green-500/20 text-green-400 border-2 border-green-500/50'
                    : isCurrent
                    ? 'bg-blue-500/20 text-blue-400 border-2 border-blue-500/50 ring-4 ring-blue-500/20'
                    : 'bg-zinc-800 text-zinc-500 border-2 border-zinc-700'
                  }
                `}
              >
                {isCompleted ? <Check className="w-5 h-5" /> : step.id}
              </div>
              <span
                className={`
                  text-xs font-medium
                  ${isCompleted ? 'text-green-400' : isCurrent ? 'text-blue-400' : 'text-zinc-600'}
                `}
              >
                {step.label}
              </span>
            </button>

            {/* Connector line (except after last step) */}
            {index < STEPS.length - 1 && (
              <div
                className={`
                  w-12 h-0.5 mx-2
                  ${completedSteps.has(step.id) && (completedSteps.has((step.id + 1) as StepId) || step.id + 1 === currentStep)
                    ? 'bg-green-500/50'
                    : step.id < currentStep
                    ? 'bg-gradient-to-r from-green-500/50 to-zinc-700'
                    : 'bg-zinc-700'
                  }
                `}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
```

**Step 3: Verify the file was created**

```bash
cat client/src/components/engine/EngineStepper.tsx | head -20
```

**Step 4: Commit**

```bash
git add client/src/components/engine/EngineStepper.tsx
git commit -m "feat(engine): add EngineStepper progress bar component"
```

---

## Task 2: Create EngineWizardLayout Component

**Files:**
- Create: `client/src/components/engine/EngineWizardLayout.tsx`

**Step 1: Write the layout wrapper**

Create `client/src/components/engine/EngineWizardLayout.tsx`:

```tsx
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
  // Header
  symbol: string;
  brokerConnected: boolean;
  environment: 'live' | 'paper' | 'simulation';

  // Stepper
  currentStep: StepId;
  completedSteps: Set<StepId>;
  onStepClick: (step: StepId) => void;

  // Content
  children: ReactNode;

  // Sidebar
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
```

**Step 2: Verify the file**

```bash
cat client/src/components/engine/EngineWizardLayout.tsx | head -20
```

**Step 3: Commit**

```bash
git add client/src/components/engine/EngineWizardLayout.tsx
git commit -m "feat(engine): add EngineWizardLayout with sidebar"
```

---

## Task 3: Create Step Content Components

**Files:**
- Create: `client/src/components/engine/steps/Step1Market.tsx`
- Create: `client/src/components/engine/steps/Step2Direction.tsx`
- Create: `client/src/components/engine/steps/Step3Strikes.tsx`
- Create: `client/src/components/engine/steps/Step4Size.tsx`
- Create: `client/src/components/engine/steps/Step5Exit.tsx`
- Create: `client/src/components/engine/steps/index.ts`

**Step 1: Create steps directory**

```bash
mkdir -p client/src/components/engine/steps
```

**Step 2: Create Step1Market component**

Create `client/src/components/engine/steps/Step1Market.tsx`:

```tsx
/**
 * Step 1: Market Assessment
 * Clean, focused market context display
 */

import { Button } from '@/components/ui/button';
import { Play, RefreshCw } from 'lucide-react';

interface Step1MarketProps {
  spyPrice?: number;
  spyChangePct?: number;
  vix?: number;
  vwap?: number;
  ivRank?: number;
  dayLow?: number;
  dayHigh?: number;
  marketOpen: boolean;
  onAnalyze: () => void;
  isLoading: boolean;
}

export function Step1Market({
  spyPrice,
  spyChangePct,
  vix,
  vwap,
  ivRank,
  dayLow,
  dayHigh,
  marketOpen,
  onAnalyze,
  isLoading,
}: Step1MarketProps) {
  // Calculate position in range
  const rangePosition = spyPrice && dayLow && dayHigh
    ? ((spyPrice - dayLow) / (dayHigh - dayLow)) * 100
    : 50;

  return (
    <div className="space-y-6">
      {/* Market Status Badge */}
      <div className="flex justify-center">
        <span className={`
          px-4 py-1.5 rounded-full text-sm font-medium
          ${marketOpen
            ? 'bg-green-500/20 text-green-400 border border-green-500/30'
            : 'bg-zinc-700 text-zinc-400 border border-zinc-600'
          }
        `}>
          {marketOpen ? '● MARKET OPEN' : '○ MARKET CLOSED'}
        </span>
      </div>

      {/* Hero Price */}
      <div className="text-center py-8">
        <div className="text-6xl font-bold font-mono tracking-tight">
          ${spyPrice?.toFixed(2) ?? '---'}
        </div>
        <div className={`text-xl font-mono mt-2 ${
          (spyChangePct ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'
        }`}>
          {spyChangePct != null
            ? `${spyChangePct >= 0 ? '▲' : '▼'} ${Math.abs(spyChangePct).toFixed(2)}%`
            : '--'
          }
        </div>
      </div>

      {/* Key Metrics Row */}
      <div className="grid grid-cols-3 gap-4 py-4 border-y border-zinc-800">
        <div className="text-center">
          <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">VIX</div>
          <div className={`text-lg font-mono font-medium ${
            (vix ?? 20) < 17 ? 'text-green-400' :
            (vix ?? 20) < 25 ? 'text-yellow-400' : 'text-red-400'
          }`}>
            {vix?.toFixed(1) ?? '--'}
          </div>
        </div>
        <div className="text-center">
          <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">VWAP</div>
          <div className="text-lg font-mono font-medium">
            ${vwap?.toFixed(2) ?? '--'}
          </div>
        </div>
        <div className="text-center">
          <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">IV Rank</div>
          <div className="text-lg font-mono font-medium">
            {ivRank != null ? `${ivRank}%` : '--'}
          </div>
        </div>
      </div>

      {/* Range Bar */}
      <div className="py-4">
        <div className="text-xs text-zinc-500 uppercase tracking-wider mb-3 text-center">
          Today's Range
        </div>
        <div className="relative">
          {/* Track */}
          <div className="h-2 bg-zinc-800 rounded-full" />
          {/* Current position marker */}
          <div
            className="absolute top-0 w-3 h-3 bg-blue-500 rounded-full -translate-y-0.5 -translate-x-1.5"
            style={{ left: `${rangePosition}%` }}
          />
        </div>
        <div className="flex justify-between mt-2 text-xs font-mono text-zinc-500">
          <span>${dayLow?.toFixed(2) ?? '--'}</span>
          <span className="text-zinc-300">${spyPrice?.toFixed(2) ?? '--'}</span>
          <span>${dayHigh?.toFixed(2) ?? '--'}</span>
        </div>
      </div>

      {/* CTA Button */}
      <div className="pt-4">
        <Button
          onClick={onAnalyze}
          disabled={isLoading}
          className="w-full py-6 text-lg font-semibold"
          size="lg"
        >
          {isLoading ? (
            <>
              <RefreshCw className="w-5 h-5 mr-2 animate-spin" />
              Analyzing...
            </>
          ) : (
            <>
              <Play className="w-5 h-5 mr-2" />
              Analyze Direction →
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
```

**Step 3: Create Step2Direction component**

Create `client/src/components/engine/steps/Step2Direction.tsx`:

```tsx
/**
 * Step 2: Direction Analysis
 * Shows direction recommendation with confidence and override options
 */

import { Button } from '@/components/ui/button';
import { ChevronRight } from 'lucide-react';

type Direction = 'PUT' | 'CALL' | 'STRANGLE';

interface Step2DirectionProps {
  direction?: Direction;
  confidence?: number;
  signals?: {
    trend?: string;
    maAlignment?: string;
    reasons?: string[];
  };
  onOverride: (direction: Direction) => void;
  onContinue: () => void;
  isComplete: boolean;
}

export function Step2Direction({
  direction,
  confidence = 0,
  signals,
  onOverride,
  onContinue,
  isComplete,
}: Step2DirectionProps) {
  return (
    <div className="space-y-6">
      {/* Direction Display */}
      <div className="text-center py-6">
        <div className="text-xs text-zinc-500 uppercase tracking-wider mb-2">
          Recommended Direction
        </div>
        <div className={`text-4xl font-bold ${
          direction === 'PUT' ? 'text-red-400' :
          direction === 'CALL' ? 'text-green-400' :
          'text-purple-400'
        }`}>
          {direction || '--'}
        </div>
      </div>

      {/* Confidence Bar */}
      <div className="py-4">
        <div className="flex justify-between text-xs text-zinc-500 mb-2">
          <span>Confidence</span>
          <span className="font-mono">{confidence}%</span>
        </div>
        <div className="h-3 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              confidence >= 70 ? 'bg-green-500' :
              confidence >= 50 ? 'bg-yellow-500' :
              'bg-red-500'
            }`}
            style={{ width: `${confidence}%` }}
          />
        </div>
      </div>

      {/* Signals */}
      {signals?.reasons && signals.reasons.length > 0 && (
        <div className="bg-zinc-900 rounded-lg p-4">
          <div className="text-xs text-zinc-500 uppercase tracking-wider mb-3">
            Signals
          </div>
          <ul className="space-y-2">
            {signals.reasons.map((reason, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-zinc-300">
                <span className="text-zinc-600">•</span>
                {reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Override Buttons */}
      <div className="bg-zinc-900 rounded-lg p-4">
        <div className="text-xs text-zinc-500 uppercase tracking-wider mb-3">
          Override?
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(['PUT', 'CALL', 'STRANGLE'] as Direction[]).map((dir) => (
            <Button
              key={dir}
              variant="outline"
              size="sm"
              onClick={() => onOverride(dir)}
              className={`
                ${direction === dir ? 'ring-2' : ''}
                ${dir === 'PUT' ? 'border-red-500/50 hover:bg-red-500/10 ring-red-500/50' :
                  dir === 'CALL' ? 'border-green-500/50 hover:bg-green-500/10 ring-green-500/50' :
                  'border-purple-500/50 hover:bg-purple-500/10 ring-purple-500/50'
                }
              `}
            >
              {dir}
            </Button>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div className="pt-4">
        <Button
          onClick={onContinue}
          disabled={!isComplete}
          className="w-full py-6 text-lg font-semibold"
          size="lg"
        >
          View Strikes
          <ChevronRight className="w-5 h-5 ml-2" />
        </Button>
      </div>
    </div>
  );
}
```

**Step 4: Create Step3Strikes component**

Create `client/src/components/engine/steps/Step3Strikes.tsx`:

```tsx
/**
 * Step 3: Strike Selection
 * Interactive strike picker with sliders and premium preview
 */

import { Button } from '@/components/ui/button';
import { ChevronRight, ExternalLink } from 'lucide-react';
import type { SmartStrikeCandidate } from '@shared/types/engine';

interface Step3StrikesProps {
  underlyingPrice: number;
  putCandidates: SmartStrikeCandidate[];
  callCandidates: SmartStrikeCandidate[];
  selectedPutStrike: number | null;
  selectedCallStrike: number | null;
  recommendedPutStrike?: number;
  recommendedCallStrike?: number;
  onPutSelect: (strike: number | null) => void;
  onCallSelect: (strike: number | null) => void;
  onViewFullChain: () => void;
  onContinue: () => void;
  expectedPremium: number;
}

export function Step3Strikes({
  underlyingPrice,
  putCandidates,
  callCandidates,
  selectedPutStrike,
  selectedCallStrike,
  recommendedPutStrike,
  recommendedCallStrike,
  onPutSelect,
  onCallSelect,
  onViewFullChain,
  onContinue,
  expectedPremium,
}: Step3StrikesProps) {
  const selectedPut = putCandidates.find(c => c.strike === selectedPutStrike);
  const selectedCall = callCandidates.find(c => c.strike === selectedCallStrike);

  // Calculate premium from selection
  const totalPremium = (
    (selectedPut ? selectedPut.bid * 100 : 0) +
    (selectedCall ? selectedCall.bid * 100 : 0)
  );

  const hasSelection = selectedPutStrike !== null || selectedCallStrike !== null;

  return (
    <div className="space-y-6">
      {/* ATM Reference */}
      <div className="text-center text-sm text-zinc-500">
        ATM: <span className="font-mono text-zinc-300">${underlyingPrice.toFixed(0)}</span>
      </div>

      {/* Strike Selection Cards */}
      <div className="grid grid-cols-2 gap-4">
        {/* PUT Selection */}
        <div className="bg-zinc-900 rounded-lg p-4 border border-red-500/20">
          <div className="text-sm font-medium text-red-400 mb-3">PUT Strike</div>

          <select
            value={selectedPutStrike ?? ''}
            onChange={(e) => onPutSelect(e.target.value ? Number(e.target.value) : null)}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-lg font-mono"
          >
            <option value="">Select...</option>
            {putCandidates.map(c => (
              <option key={c.strike} value={c.strike}>
                ${c.strike} (δ{c.delta.toFixed(2)}) ${c.strike === recommendedPutStrike ? '★' : ''}
              </option>
            ))}
          </select>

          {selectedPut && (
            <div className="mt-3 text-xs text-zinc-500 space-y-1">
              <div className="flex justify-between">
                <span>Delta:</span>
                <span className="font-mono">{selectedPut.delta.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span>Premium:</span>
                <span className="font-mono text-green-400">${selectedPut.bid.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span>IV:</span>
                <span className="font-mono">{((selectedPut.iv ?? 0) * 100).toFixed(1)}%</span>
              </div>
            </div>
          )}
        </div>

        {/* CALL Selection */}
        <div className="bg-zinc-900 rounded-lg p-4 border border-green-500/20">
          <div className="text-sm font-medium text-green-400 mb-3">CALL Strike</div>

          <select
            value={selectedCallStrike ?? ''}
            onChange={(e) => onCallSelect(e.target.value ? Number(e.target.value) : null)}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-lg font-mono"
          >
            <option value="">Select...</option>
            {callCandidates.map(c => (
              <option key={c.strike} value={c.strike}>
                ${c.strike} (δ{c.delta.toFixed(2)}) ${c.strike === recommendedCallStrike ? '★' : ''}
              </option>
            ))}
          </select>

          {selectedCall && (
            <div className="mt-3 text-xs text-zinc-500 space-y-1">
              <div className="flex justify-between">
                <span>Delta:</span>
                <span className="font-mono">{selectedCall.delta.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span>Premium:</span>
                <span className="font-mono text-green-400">${selectedCall.bid.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span>IV:</span>
                <span className="font-mono">{((selectedCall.iv ?? 0) * 100).toFixed(1)}%</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Premium Summary */}
      <div className="bg-zinc-900 rounded-lg p-4 text-center">
        <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">
          Est. Premium / Contract
        </div>
        <div className="text-2xl font-mono font-bold text-green-400">
          ${totalPremium.toFixed(0)}
        </div>
      </div>

      {/* View Full Chain Link */}
      <div className="text-center">
        <button
          onClick={onViewFullChain}
          className="text-sm text-blue-400 hover:text-blue-300 transition inline-flex items-center gap-1"
        >
          View Full Chain
          <ExternalLink className="w-3 h-3" />
        </button>
      </div>

      {/* CTA */}
      <div className="pt-4">
        <Button
          onClick={onContinue}
          disabled={!hasSelection}
          className="w-full py-6 text-lg font-semibold"
          size="lg"
        >
          Calculate Size
          <ChevronRight className="w-5 h-5 ml-2" />
        </Button>
      </div>
    </div>
  );
}
```

**Step 5: Create Step4Size component**

Create `client/src/components/engine/steps/Step4Size.tsx`:

```tsx
/**
 * Step 4: Position Size
 * Risk tier selection with position summary
 */

import { Button } from '@/components/ui/button';
import { ChevronRight } from 'lucide-react';

type RiskTier = 'conservative' | 'balanced' | 'aggressive';

interface Step4SizeProps {
  riskTier: RiskTier;
  onRiskTierChange: (tier: RiskTier) => void;
  accountValue?: number;
  recommendedContracts?: number;
  premiumPerContract?: number;
  marginRequired?: number;
  maxRiskPercent?: number;
  onContinue: () => void;
}

const TIERS: { id: RiskTier; label: string; range: string }[] = [
  { id: 'conservative', label: 'Conservative', range: '1-2%' },
  { id: 'balanced', label: 'Balanced', range: '2-4%' },
  { id: 'aggressive', label: 'Aggressive', range: '4-6%' },
];

export function Step4Size({
  riskTier,
  onRiskTierChange,
  accountValue,
  recommendedContracts,
  premiumPerContract,
  marginRequired,
  maxRiskPercent,
  onContinue,
}: Step4SizeProps) {
  const totalPremium = (premiumPerContract ?? 0) * (recommendedContracts ?? 0);

  return (
    <div className="space-y-6">
      {/* Risk Tier Selection */}
      <div>
        <div className="text-xs text-zinc-500 uppercase tracking-wider mb-3 text-center">
          Risk Tier
        </div>
        <div className="grid grid-cols-3 gap-3">
          {TIERS.map((tier) => (
            <button
              key={tier.id}
              onClick={() => onRiskTierChange(tier.id)}
              className={`
                p-4 rounded-lg border-2 transition-all
                ${riskTier === tier.id
                  ? 'border-blue-500 bg-blue-500/10 ring-2 ring-blue-500/20'
                  : 'border-zinc-700 bg-zinc-900 hover:border-zinc-600'
                }
              `}
            >
              <div className={`text-lg font-semibold ${
                riskTier === tier.id ? 'text-blue-400' : 'text-zinc-300'
              }`}>
                {tier.label}
              </div>
              <div className="text-xs text-zinc-500 mt-1">
                {tier.range}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Position Summary */}
      <div className="bg-zinc-900 rounded-lg p-4 space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-zinc-500">Contracts</span>
          <span className="font-mono text-xl font-bold text-white">
            {recommendedContracts ?? '--'}
          </span>
        </div>

        <div className="h-px bg-zinc-800" />

        <div className="flex justify-between text-sm">
          <span className="text-zinc-500">Total Premium</span>
          <span className="font-mono text-green-400">
            ${totalPremium.toLocaleString()}
          </span>
        </div>

        <div className="flex justify-between text-sm">
          <span className="text-zinc-500">Margin Required</span>
          <span className="font-mono">
            ${marginRequired?.toLocaleString() ?? '--'}
          </span>
        </div>

        <div className="flex justify-between text-sm">
          <span className="text-zinc-500">Max Risk</span>
          <span className="font-mono">
            {maxRiskPercent != null ? `${maxRiskPercent.toFixed(1)}% of account` : '--'}
          </span>
        </div>
      </div>

      {/* Account Context */}
      {accountValue && (
        <div className="text-center text-xs text-zinc-500">
          Account: ${accountValue.toLocaleString()}
        </div>
      )}

      {/* CTA */}
      <div className="pt-4">
        <Button
          onClick={onContinue}
          disabled={!recommendedContracts}
          className="w-full py-6 text-lg font-semibold"
          size="lg"
        >
          Set Exit Strategy
          <ChevronRight className="w-5 h-5 ml-2" />
        </Button>
      </div>
    </div>
  );
}
```

**Step 6: Create Step5Exit component**

Create `client/src/components/engine/steps/Step5Exit.tsx`:

```tsx
/**
 * Step 5: Exit Strategy & Confirmation
 * Stop multiplier selection with order preview and execution
 */

import { Button } from '@/components/ui/button';
import { AlertTriangle, Check, X } from 'lucide-react';
import type { TradeProposal } from '@/components/agent/TradeProposalCard';

type StopMultiplier = 2 | 3 | 4;

interface Step5ExitProps {
  stopMultiplier: StopMultiplier;
  onStopMultiplierChange: (mult: StopMultiplier) => void;
  proposal: TradeProposal | null;
  entryPremium?: number;
  stopLossPrice?: number;
  maxLoss?: number;
  guardRailsPassed: boolean;
  violations?: string[];
  onExecute: () => void;
  onCancel: () => void;
  isExecuting: boolean;
}

const MULTIPLIERS: { id: StopMultiplier; label: string; desc: string }[] = [
  { id: 2, label: '2x', desc: 'Tight' },
  { id: 3, label: '3x', desc: 'Standard' },
  { id: 4, label: '4x', desc: 'Loose' },
];

export function Step5Exit({
  stopMultiplier,
  onStopMultiplierChange,
  proposal,
  entryPremium,
  stopLossPrice,
  maxLoss,
  guardRailsPassed,
  violations = [],
  onExecute,
  onCancel,
  isExecuting,
}: Step5ExitProps) {
  return (
    <div className="space-y-6">
      {/* Stop Multiplier Selection */}
      <div>
        <div className="text-xs text-zinc-500 uppercase tracking-wider mb-3 text-center">
          Stop Multiplier
        </div>
        <div className="grid grid-cols-3 gap-3">
          {MULTIPLIERS.map((mult) => (
            <button
              key={mult.id}
              onClick={() => onStopMultiplierChange(mult.id)}
              className={`
                p-4 rounded-lg border-2 transition-all
                ${stopMultiplier === mult.id
                  ? 'border-blue-500 bg-blue-500/10 ring-2 ring-blue-500/20'
                  : 'border-zinc-700 bg-zinc-900 hover:border-zinc-600'
                }
              `}
            >
              <div className={`text-2xl font-bold ${
                stopMultiplier === mult.id ? 'text-blue-400' : 'text-zinc-300'
              }`}>
                {mult.label}
              </div>
              <div className="text-xs text-zinc-500 mt-1">
                {mult.desc}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Order Preview */}
      <div className="bg-zinc-900 rounded-lg p-4">
        <div className="text-xs text-zinc-500 uppercase tracking-wider mb-3">
          Order Preview
        </div>

        {proposal?.legs.map((leg, i) => (
          <div key={i} className="flex justify-between py-2 border-b border-zinc-800 last:border-0">
            <span className={leg.optionType === 'PUT' ? 'text-red-400' : 'text-green-400'}>
              {proposal.contracts}x SPY ${leg.strike} {leg.optionType}
            </span>
            <span className="font-mono">${leg.premium.toFixed(2)}</span>
          </div>
        ))}

        <div className="flex justify-between pt-3 mt-2 border-t border-zinc-700">
          <span className="font-medium">Total Premium</span>
          <span className="font-mono text-green-400">${proposal?.entryPremiumTotal?.toFixed(0) ?? '--'}</span>
        </div>
      </div>

      {/* Stop Loss Info */}
      <div className="bg-zinc-900 rounded-lg p-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-zinc-500 mb-1">Stop Price</div>
            <div className="text-lg font-mono text-red-400">
              ${stopLossPrice?.toFixed(2) ?? '--'}
            </div>
          </div>
          <div>
            <div className="text-xs text-zinc-500 mb-1">Max Loss</div>
            <div className="text-lg font-mono text-red-400">
              ${maxLoss?.toFixed(0) ?? '--'}
            </div>
          </div>
        </div>
      </div>

      {/* Guard Rails Violations */}
      {violations.length > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
          <div className="flex items-center gap-2 text-red-400 font-medium mb-2">
            <AlertTriangle className="w-4 h-4" />
            Guard Rail Violations
          </div>
          <ul className="text-sm text-red-300 space-y-1">
            {violations.map((v, i) => (
              <li key={i}>• {v}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Warning */}
      <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-yellow-200">
          This will execute a <strong>LIVE</strong> bracket order (SELL + STOP) through IBKR.
          Ensure you have reviewed all details.
        </div>
      </div>

      {/* Action Buttons */}
      <div className="grid grid-cols-2 gap-4 pt-4">
        <Button
          variant="outline"
          onClick={onCancel}
          disabled={isExecuting}
          className="py-6 text-lg"
          size="lg"
        >
          <X className="w-5 h-5 mr-2" />
          Cancel
        </Button>

        <Button
          onClick={onExecute}
          disabled={isExecuting || !guardRailsPassed}
          className="py-6 text-lg font-semibold bg-green-600 hover:bg-green-700"
          size="lg"
        >
          {isExecuting ? (
            'Executing...'
          ) : (
            <>
              <Check className="w-5 h-5 mr-2" />
              Execute Trade
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
```

**Step 7: Create index barrel file**

Create `client/src/components/engine/steps/index.ts`:

```tsx
export { Step1Market } from './Step1Market';
export { Step2Direction } from './Step2Direction';
export { Step3Strikes } from './Step3Strikes';
export { Step4Size } from './Step4Size';
export { Step5Exit } from './Step5Exit';
```

**Step 8: Verify files were created**

```bash
ls -la client/src/components/engine/steps/
```

**Step 9: Commit**

```bash
git add client/src/components/engine/steps/
git commit -m "feat(engine): add step content components for wizard"
```

---

## Task 4: Create Index Barrel for Engine Components

**Files:**
- Create: `client/src/components/engine/index.ts`

**Step 1: Create the index file**

Create `client/src/components/engine/index.ts`:

```tsx
export { EngineStepper, type StepId } from './EngineStepper';
export { EngineWizardLayout } from './EngineWizardLayout';
export * from './steps';
```

**Step 2: Commit**

```bash
git add client/src/components/engine/index.ts
git commit -m "feat(engine): add index barrel for engine components"
```

---

## Task 5: Refactor Engine.tsx to Use Wizard Layout

**Files:**
- Modify: `client/src/pages/Engine.tsx`

**Step 1: Replace the current implementation**

This is the largest task. Replace the entire `Engine.tsx` with the new wizard-based implementation.

Key changes:
1. Import new wizard components
2. Add `currentStep` state tracking (1-5)
3. Derive `completedSteps` from analysis state
4. Render `EngineWizardLayout` instead of card stack
5. Switch render based on `currentStep`
6. Keep ALL existing hooks, state, and handlers

The new structure:

```tsx
// Imports at top
import { EngineWizardLayout, EngineStepper, StepId } from '@/components/engine';
import { Step1Market, Step2Direction, Step3Strikes, Step4Size, Step5Exit } from '@/components/engine/steps';

// Inside component, add:
const [currentStep, setCurrentStep] = useState<StepId>(1);

// Derive completed steps from analysis
const completedSteps = useMemo(() => {
  const completed = new Set<StepId>();
  if (analysis?.q1MarketRegime?.passed) completed.add(1);
  if (analysis?.q2Direction?.passed) completed.add(2);
  if (analysis?.q3Strikes?.passed) completed.add(3);
  if (analysis?.q4Size?.passed) completed.add(4);
  if (analysis?.q5Exit?.passed) completed.add(5);
  return completed;
}, [analysis]);

// Step navigation
const handleStepClick = (step: StepId) => {
  if (completedSteps.has(step) || step < currentStep) {
    setCurrentStep(step);
  }
};

// Render the appropriate step content
const renderStepContent = () => {
  switch (currentStep) {
    case 1:
      return <Step1Market {...step1Props} />;
    case 2:
      return <Step2Direction {...step2Props} />;
    // etc.
  }
};

// Main render
return (
  <EngineWizardLayout
    symbol={selectedSymbol}
    brokerConnected={brokerConnectedFinal}
    environment={environment}
    currentStep={currentStep}
    completedSteps={completedSteps}
    onStepClick={handleStepClick}
    engineLog={analysis?.enhancedLog || null}
    isRunning={isExecuting}
  >
    {renderStepContent()}
  </EngineWizardLayout>
);
```

**Step 2: Test the build**

```bash
npm run build
```

**Step 3: Test in browser**

```bash
npm run dev
# Visit http://localhost:5173/engine
```

**Step 4: Commit**

```bash
git add client/src/pages/Engine.tsx
git commit -m "refactor(engine): convert to wizard layout with stepper"
```

---

## Task 6: Add Mobile Responsive Sidebar

**Files:**
- Modify: `client/src/components/engine/EngineWizardLayout.tsx`

**Step 1: Add mobile sidebar toggle**

Update `EngineWizardLayout.tsx` to:
1. Hide sidebar on mobile by default
2. Add toggle button to show/hide
3. Sidebar becomes bottom drawer on mobile

```tsx
// Add state
const [sidebarOpen, setSidebarOpen] = useState(false);

// Responsive classes for sidebar
<aside className={`
  fixed inset-y-0 right-0 w-full md:w-[400px] md:relative
  transform ${sidebarOpen ? 'translate-x-0' : 'translate-x-full'} md:translate-x-0
  transition-transform duration-300 ease-in-out
  border-l border-zinc-800 bg-zinc-950 z-50
`}>
```

**Step 2: Add toggle button in header**

```tsx
<button
  onClick={() => setSidebarOpen(!sidebarOpen)}
  className="md:hidden p-2 hover:bg-zinc-800 rounded"
>
  <Menu className="w-5 h-5" />
</button>
```

**Step 3: Test on mobile viewport**

Open browser devtools, resize to mobile width.

**Step 4: Commit**

```bash
git add client/src/components/engine/EngineWizardLayout.tsx
git commit -m "feat(engine): add mobile responsive sidebar"
```

---

## Task 7: Clean Up Old Components (Optional)

**Files:**
- Consider removing: `client/src/components/EngineStepCard.tsx` (if no longer used)
- Consider removing: `client/src/components/EngineStepContents.tsx` (if no longer used)

**Step 1: Check for usage**

```bash
grep -r "EngineStepCard" client/src/
grep -r "EngineStepContents" client/src/
```

**Step 2: If unused, remove**

Only remove if no other files import these components.

```bash
rm client/src/components/EngineStepCard.tsx
rm client/src/components/EngineStepContents.tsx
```

**Step 3: Commit**

```bash
git add -A
git commit -m "chore(engine): remove legacy step card components"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Create EngineStepper | `engine/EngineStepper.tsx` |
| 2 | Create EngineWizardLayout | `engine/EngineWizardLayout.tsx` |
| 3 | Create Step Components | `engine/steps/*.tsx` |
| 4 | Create Index Barrel | `engine/index.ts` |
| 5 | Refactor Engine.tsx | `pages/Engine.tsx` |
| 6 | Add Mobile Responsive | `engine/EngineWizardLayout.tsx` |
| 7 | Clean Up (optional) | Remove old components |

**What Stays The Same:**
- All API calls (`/api/engine/analyze`, `/api/engine/execute-paper`)
- All hooks (`useEngine`, `useBrokerStatus`, `useTradeEngineJob`)
- Session storage logic
- Mandate enforcement
- Trade proposal logic
- Option chain modal

**Risk Mitigation:**
- No backend changes
- Can revert by restoring old `Engine.tsx`
- Incremental commits at each task
