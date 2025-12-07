/**
 * EngineStepCard - Professional Collapsible Step Card
 *
 * Clean, minimal design with:
 * - Key metrics always visible in summary line
 * - Details hidden by default, expand on click
 * - Clear status indicators (green/yellow/red)
 * - No verbose Q&A format
 */

import { useState, ReactNode } from 'react';
import { ChevronDown, ChevronUp, Check, AlertTriangle, Clock, Loader2 } from 'lucide-react';

export type StepStatus = 'pending' | 'running' | 'passed' | 'warning' | 'failed';

export interface EngineStepCardProps {
  /** Step number (1-5) */
  step: number;
  /** Step title */
  title: string;
  /** Current status */
  status: StepStatus;
  /** Key metrics to show in summary line (always visible) */
  summary: string;
  /** Expandable details content */
  children?: ReactNode;
  /** Start expanded */
  defaultExpanded?: boolean;
  /** Additional class names */
  className?: string;
}

/**
 * Status indicator component
 */
function StatusIndicator({ status }: { status: StepStatus }) {
  switch (status) {
    case 'passed':
      return (
        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-green-500/20">
          <Check className="w-4 h-4 text-green-400" />
        </div>
      );
    case 'warning':
      return (
        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-yellow-500/20">
          <AlertTriangle className="w-4 h-4 text-yellow-400" />
        </div>
      );
    case 'failed':
      return (
        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-red-500/20">
          <span className="text-red-400 font-bold text-sm">!</span>
        </div>
      );
    case 'running':
      return (
        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-500/20">
          <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
        </div>
      );
    default:
      return (
        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-zinc-700">
          <Clock className="w-4 h-4 text-zinc-400" />
        </div>
      );
  }
}

/**
 * Main EngineStepCard component
 */
export function EngineStepCard({
  step,
  title,
  status,
  summary,
  children,
  defaultExpanded = false,
  className = '',
}: EngineStepCardProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const hasContent = !!children;

  // Border color based on status
  const borderColor = {
    passed: 'border-green-500/30',
    warning: 'border-yellow-500/30',
    failed: 'border-red-500/30',
    running: 'border-blue-500/30',
    pending: 'border-zinc-700',
  }[status];

  return (
    <div className={`rounded-xl border ${borderColor} bg-zinc-900/50 overflow-hidden ${className}`}>
      {/* Header - Always Visible */}
      <button
        onClick={() => hasContent && setIsExpanded(!isExpanded)}
        disabled={!hasContent}
        className={`w-full flex items-center gap-4 px-4 py-3 ${hasContent ? 'cursor-pointer hover:bg-white/5' : 'cursor-default'} transition-colors`}
      >
        {/* Step number */}
        <span className="text-zinc-500 font-mono text-sm w-4">
          {step}
        </span>

        {/* Title */}
        <span className="font-medium text-zinc-200 min-w-[100px]">
          {title}
        </span>

        {/* Summary - Key metrics */}
        <span className="flex-1 text-left text-sm text-zinc-400 truncate">
          {summary}
        </span>

        {/* Status indicator */}
        <StatusIndicator status={status} />

        {/* Expand/collapse chevron */}
        {hasContent && (
          <div className="text-zinc-500">
            {isExpanded ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </div>
        )}
      </button>

      {/* Expandable Details */}
      {isExpanded && hasContent && (
        <div className="px-4 pb-4 border-t border-zinc-800">
          <div className="pt-4">
            {children}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Metric display component for details section
 */
export function StepMetric({
  label,
  value,
  subtext,
  color = 'default',
}: {
  label: string;
  value: string | number;
  subtext?: string;
  color?: 'default' | 'green' | 'red' | 'yellow' | 'purple';
}) {
  const valueColor = {
    default: 'text-white',
    green: 'text-green-400',
    red: 'text-red-400',
    yellow: 'text-yellow-400',
    purple: 'text-purple-400',
  }[color];

  return (
    <div>
      <p className="text-xs text-zinc-500 mb-1">{label}</p>
      <p className={`font-mono text-sm ${valueColor}`}>{value}</p>
      {subtext && <p className="text-[10px] text-zinc-600 mt-0.5">{subtext}</p>}
    </div>
  );
}

/**
 * Info row for showing calculation breakdowns
 */
export function StepInfoRow({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-xs text-zinc-500">{label}</span>
      <span className={`text-xs font-mono ${highlight ? 'text-white' : 'text-zinc-400'}`}>
        {value}
      </span>
    </div>
  );
}

/**
 * Section divider for details
 */
export function StepDivider({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 my-3">
      <div className="flex-1 h-px bg-zinc-800" />
      {label && <span className="text-[10px] text-zinc-600 uppercase tracking-wider">{label}</span>}
      <div className="flex-1 h-px bg-zinc-800" />
    </div>
  );
}

/**
 * Alert box for important information
 */
export function StepAlert({
  type = 'info',
  children,
}: {
  type?: 'info' | 'warning' | 'success' | 'error';
  children: ReactNode;
}) {
  const styles = {
    info: 'bg-blue-500/10 border-blue-500/20 text-blue-400',
    warning: 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400',
    success: 'bg-green-500/10 border-green-500/20 text-green-400',
    error: 'bg-red-500/10 border-red-500/20 text-red-400',
  }[type];

  return (
    <div className={`text-xs px-3 py-2 rounded-lg border ${styles}`}>
      {children}
    </div>
  );
}

/**
 * Step connector showing data flow between steps
 */
export function StepConnector({
  fromStep,
  toStep,
  output,
  status = 'pending',
}: {
  fromStep: number;
  toStep: number;
  output: string;
  status?: 'pending' | 'active' | 'complete';
}) {
  const lineColor = {
    pending: 'border-zinc-700',
    active: 'border-blue-500',
    complete: 'border-green-500/50',
  }[status];

  const dotColor = {
    pending: 'bg-zinc-700',
    active: 'bg-blue-500 animate-pulse',
    complete: 'bg-green-500',
  }[status];

  const textColor = {
    pending: 'text-zinc-600',
    active: 'text-blue-400',
    complete: 'text-zinc-500',
  }[status];

  return (
    <div className="flex items-center justify-center py-1 ml-6">
      {/* Vertical line with output label */}
      <div className="flex items-center gap-2">
        <div className={`w-px h-4 ${lineColor} border-l border-dashed`} />
        <div className={`w-2 h-2 rounded-full ${dotColor}`} />
        <span className={`text-[10px] font-mono ${textColor}`}>
          {output}
        </span>
      </div>
    </div>
  );
}

/**
 * Horizontal flow indicator showing step progression
 */
export function StepFlowIndicator({
  currentStep,
  totalSteps = 5,
  stepLabels = ['Market', 'Trend', 'Strikes', 'Size', 'Exit'],
}: {
  currentStep: number;
  totalSteps?: number;
  stepLabels?: string[];
}) {
  return (
    <div className="flex items-center justify-between mb-4 px-2">
      {Array.from({ length: totalSteps }, (_, i) => {
        const stepNum = i + 1;
        const isComplete = stepNum < currentStep;
        const isCurrent = stepNum === currentStep;
        const isPending = stepNum > currentStep;

        return (
          <div key={stepNum} className="flex items-center flex-1 last:flex-none">
            {/* Step circle */}
            <div className="flex flex-col items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${
                  isComplete
                    ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                    : isCurrent
                    ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                    : 'bg-zinc-800 text-zinc-500 border border-zinc-700'
                }`}
              >
                {isComplete ? (
                  <Check className="w-4 h-4" />
                ) : (
                  stepNum
                )}
              </div>
              <span
                className={`text-[10px] mt-1 ${
                  isComplete
                    ? 'text-green-400'
                    : isCurrent
                    ? 'text-blue-400'
                    : 'text-zinc-600'
                }`}
              >
                {stepLabels[i]}
              </span>
            </div>

            {/* Connector line */}
            {stepNum < totalSteps && (
              <div
                className={`flex-1 h-px mx-2 ${
                  isComplete
                    ? 'bg-green-500/30'
                    : isCurrent
                    ? 'bg-gradient-to-r from-blue-500/30 to-zinc-700'
                    : 'bg-zinc-700'
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
