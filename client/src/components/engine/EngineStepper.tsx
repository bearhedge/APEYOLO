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
