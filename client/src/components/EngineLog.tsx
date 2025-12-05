/**
 * EngineLog - Professional engine execution log display
 * Clean, monochromatic, terminal-style design
 * Shows Q&A reasoning, metrics, timing, and nearby strikes table
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { EnhancedEngineLog, EnhancedStepLog, StepReasoning, StepMetric, NearbyStrike } from '@shared/types/engineLog';

interface EngineLogProps {
  log: EnhancedEngineLog | null;
  isRunning?: boolean;
  className?: string;
}

/**
 * Format milliseconds to human-readable duration
 */
function formatDuration(ms: number): string {
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(2)}s`;
  }
  return `${ms}ms`;
}

/**
 * Timeline bar showing proportional step durations
 */
function TimelineBar({ steps }: { steps: EnhancedStepLog[] }) {
  const totalMs = steps.reduce((sum, s) => sum + s.durationMs, 0);
  if (totalMs === 0) return null;

  return (
    <div className="mb-6">
      <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Timeline</div>
      <div className="flex h-2 rounded overflow-hidden bg-zinc-800">
        {steps.map((step, i) => {
          const widthPct = (step.durationMs / totalMs) * 100;
          return (
            <div
              key={step.step}
              className={`${step.isSlowest ? 'bg-amber-600' : 'bg-zinc-600'} transition-all`}
              style={{ width: `${widthPct}%` }}
              title={`Step ${step.step}: ${formatDuration(step.durationMs)}`}
            />
          );
        })}
      </div>
      <div className="flex justify-between mt-1">
        {steps.map((step) => (
          <div
            key={step.step}
            className={`text-xs ${step.isSlowest ? 'text-amber-400' : 'text-zinc-500'}`}
          >
            S{step.step}
            {step.isSlowest && ' *'}
          </div>
        ))}
      </div>
      <div className="flex justify-between">
        {steps.map((step) => (
          <div
            key={step.step}
            className={`text-xs ${step.isSlowest ? 'text-amber-400' : 'text-zinc-600'}`}
          >
            {formatDuration(step.durationMs)}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Reasoning section - Q&A format
 */
function ReasoningSection({ reasoning }: { reasoning: StepReasoning[] }) {
  if (!reasoning || reasoning.length === 0) return null;

  return (
    <div className="mt-3">
      <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Reasoning</div>
      <div className="space-y-1 font-mono text-sm">
        {reasoning.map((r, i) => (
          <div key={i} className="flex">
            <span className="text-zinc-500 min-w-[200px]">{r.question}</span>
            <span className="text-zinc-100">{r.answer}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Metrics section - key values with status
 */
function MetricsSection({ metrics }: { metrics: StepMetric[] }) {
  if (!metrics || metrics.length === 0) return null;

  const statusColors = {
    normal: 'text-zinc-100',
    warning: 'text-amber-400',
    critical: 'text-red-400',
  };

  return (
    <div className="mt-3">
      <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Metrics</div>
      <div className="grid grid-cols-2 gap-x-8 gap-y-1 font-mono text-sm">
        {metrics.map((m, i) => (
          <div key={i} className="flex justify-between">
            <span className="text-zinc-500">{m.label}</span>
            <span className={statusColors[m.status || 'normal']}>
              {m.value}{m.unit && ` ${m.unit}`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Nearby strikes table - Step 3 specific
 */
function NearbyStrikesTable({ strikes }: { strikes: NearbyStrike[] }) {
  if (!strikes || strikes.length === 0) return null;

  return (
    <div className="mt-4">
      <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Nearby Strikes</div>
      <div className="overflow-x-auto">
        <table className="w-full font-mono text-sm">
          <thead>
            <tr className="text-zinc-500 text-xs uppercase">
              <th className="text-left py-1 pr-4">Strike</th>
              <th className="text-right py-1 px-4">Delta</th>
              <th className="text-right py-1 px-4">Bid</th>
              <th className="text-right py-1 px-4">Ask</th>
              <th className="text-right py-1 pl-4">Spread</th>
            </tr>
          </thead>
          <tbody>
            {strikes.map((s, i) => (
              <tr
                key={i}
                className={`${s.selected ? 'bg-zinc-800 text-emerald-400' : 'text-zinc-300'} border-t border-zinc-800`}
              >
                <td className="py-1 pr-4">
                  ${s.strike}{s.optionType === 'PUT' ? 'P' : 'C'}
                  {s.selected && ' *'}
                </td>
                <td className="text-right py-1 px-4">{s.delta.toFixed(2)}</td>
                <td className="text-right py-1 px-4">${s.bid.toFixed(2)}</td>
                <td className="text-right py-1 px-4">${s.ask.toFixed(2)}</td>
                <td className="text-right py-1 pl-4">${s.spread.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Single step row - collapsible
 */
function StepRow({ step, isExpanded, onToggle }: {
  step: EnhancedStepLog;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const statusColors = {
    passed: 'text-emerald-400',
    failed: 'text-red-400',
    skipped: 'text-zinc-500',
  };

  return (
    <div className="border-b border-zinc-800 last:border-b-0">
      {/* Collapsed header */}
      <div
        className="flex items-center justify-between py-3 px-4 cursor-pointer hover:bg-zinc-800/50 transition-colors"
        onClick={onToggle}
      >
        <div className="flex items-center gap-3">
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-zinc-500" />
          ) : (
            <ChevronRight className="w-4 h-4 text-zinc-500" />
          )}
          <span className="text-zinc-500 font-medium">STEP {step.step}</span>
          <span className="text-zinc-100">{step.name}</span>
        </div>
        <div className="flex items-center gap-4">
          <span className={`font-medium ${statusColors[step.status]}`}>
            {step.status.toUpperCase()}
          </span>
          <span className={`text-sm ${step.isSlowest ? 'text-amber-400' : 'text-zinc-500'}`}>
            {formatDuration(step.durationMs)}
            {step.isSlowest && ' *'}
          </span>
        </div>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="px-4 pb-4 pt-0 ml-7 border-l border-zinc-800">
          <ReasoningSection reasoning={step.reasoning} />
          <MetricsSection metrics={step.metrics} />
          {step.nearbyStrikes && <NearbyStrikesTable strikes={step.nearbyStrikes} />}
          {step.error && (
            <div className="mt-3 p-3 bg-red-950/30 border border-red-900 rounded">
              <div className="text-red-400 font-medium">{step.error.message}</div>
              {step.error.suggestion && (
                <div className="text-zinc-400 text-sm mt-1">{step.error.suggestion}</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Summary section at the bottom
 */
function SummarySection({ summary }: { summary: EnhancedEngineLog['summary'] }) {
  const statusColors: Record<string, string> = {
    READY: 'text-emerald-400',
    'INSUFFICIENT FUNDS': 'text-amber-400',
    'OUTSIDE WINDOW': 'text-amber-400',
    'NOT READY': 'text-red-400',
    'ANALYSIS INCOMPLETE': 'text-red-400',
  };

  // Handle dynamic "FAILED AT STEP X" status
  const getStatusColor = (status: string) => {
    if (status.startsWith('FAILED AT')) return 'text-red-400';
    return statusColors[status] || 'text-zinc-100';
  };

  // Check if status indicates a failure/warning state
  const isNotReady = summary.status !== 'READY';

  return (
    <div className="border-t border-zinc-700 pt-4 mt-4">
      <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">Summary</div>
      <div className="grid grid-cols-2 gap-x-8 gap-y-2 font-mono text-sm">
        <div className="flex justify-between">
          <span className="text-zinc-500">Strategy</span>
          <span className="text-zinc-100">{summary.strategy}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">Strike</span>
          <span className="text-zinc-100">{summary.strike}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">Contracts</span>
          <span className="text-zinc-100">{summary.contracts}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">Premium</span>
          <span className="text-zinc-100">${summary.premium.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">Stop Loss</span>
          <span className="text-zinc-100">{summary.stopLoss}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">Status</span>
          <span className={getStatusColor(summary.status)}>{summary.status}</span>
        </div>
      </div>

      {/* Reason message when not ready */}
      {isNotReady && summary.reason && (
        <div className="mt-4 p-3 bg-zinc-900 border border-zinc-700 rounded">
          <div className="text-zinc-400 text-sm">{summary.reason}</div>
        </div>
      )}
    </div>
  );
}

/**
 * Main EngineLog component
 */
export default function EngineLog({ log, isRunning = false, className = '' }: EngineLogProps) {
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set([1, 2, 3, 4, 5]));

  const toggleStep = (step: number) => {
    setExpandedSteps(prev => {
      const next = new Set(prev);
      if (next.has(step)) {
        next.delete(step);
      } else {
        next.add(step);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (expandedSteps.size === 5) {
      setExpandedSteps(new Set());
    } else {
      setExpandedSteps(new Set([1, 2, 3, 4, 5]));
    }
  };

  // Empty state
  if (!log && !isRunning) {
    return (
      <div className={`bg-zinc-950 border border-zinc-800 rounded-lg p-8 ${className}`}>
        <div className="text-zinc-500 text-sm text-center font-mono">
          Click "Run Engine" to see execution logs
        </div>
      </div>
    );
  }

  // Loading state
  if (isRunning && !log) {
    return (
      <div className={`bg-zinc-950 border border-zinc-800 rounded-lg p-8 ${className}`}>
        <div className="text-zinc-400 text-sm text-center font-mono flex items-center justify-center gap-2">
          <div className="w-2 h-2 bg-amber-400 rounded-full animate-pulse" />
          Running engine analysis...
        </div>
      </div>
    );
  }

  if (!log) return null;

  return (
    <div className={`bg-zinc-950 border border-zinc-800 rounded-lg flex flex-col font-mono ${className}`}>
      {/* Header - fixed */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-zinc-100 uppercase tracking-wider">Engine Log</span>
          {isRunning && (
            <div className="w-2 h-2 bg-amber-400 rounded-full animate-pulse" />
          )}
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={toggleAll}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            {expandedSteps.size === 5 ? 'Collapse All' : 'Expand All'}
          </button>
          <span className="text-sm text-zinc-400">
            {formatDuration(log.totalDurationMs)}
          </span>
        </div>
      </div>

      {/* Content - scrollable */}
      <div className="p-4 overflow-y-auto flex-1">
        {/* Timeline */}
        <TimelineBar steps={log.steps} />

        {/* Steps */}
        <div className="border border-zinc-800 rounded divide-y divide-zinc-800">
          {log.steps.map((step) => (
            <StepRow
              key={step.step}
              step={step}
              isExpanded={expandedSteps.has(step.step)}
              onToggle={() => toggleStep(step.step)}
            />
          ))}
        </div>

        {/* Summary */}
        <SummarySection summary={log.summary} />
      </div>
    </div>
  );
}
