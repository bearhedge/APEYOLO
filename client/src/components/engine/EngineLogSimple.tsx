/**
 * EngineLogSimple - Clean step-by-step thinking log
 *
 * One line at a time. Logical. Shows the reasoning.
 */

import { useEffect, useRef } from 'react';
import type { EnhancedEngineLog, EnhancedStepLog } from '@shared/types/engineLog';

interface EngineLogSimpleProps {
  log: EnhancedEngineLog | null;
  isRunning?: boolean;
  className?: string;
}

interface LogLine {
  text: string;
  type: 'step' | 'detail' | 'error' | 'success' | 'dim' | 'normal' | 'running';
}

export function EngineLogSimple({ log, isRunning, className = '' }: EngineLogSimpleProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [log]);

  const buildLines = (): LogLine[] => {
    const lines: LogLine[] = [];

    if (!log) {
      if (isRunning) {
        lines.push({ text: 'Starting analysis...', type: 'dim' });
      } else {
        lines.push({ text: 'Ready to analyze', type: 'dim' });
      }
      return lines;
    }

    // Process each step
    for (const step of log.steps) {
      // Step header with appropriate status icon
      const getStatusIcon = (status: string) => {
        switch (status) {
          case 'passed': return '✓';
          case 'failed': return '✗';
          case 'running': return '⟳';
          case 'pending': return '○';
          case 'skipped': return '–';
          default: return '○';
        }
      };

      const getLineType = (status: string): LogLine['type'] => {
        switch (status) {
          case 'passed': return 'success';
          case 'failed': return 'error';
          case 'running': return 'running';
          case 'pending': return 'dim';
          case 'skipped': return 'dim';
          default: return 'dim';
        }
      };

      const status = getStatusIcon(step.status);
      lines.push({
        text: `Step ${step.step}: ${step.name} ${status}`,
        type: getLineType(step.status)
      });

      // Only show reasoning/metrics for completed steps (passed or failed)
      if (step.status === 'passed' || step.status === 'failed') {
        // Reasoning - one line per thought
        if (step.reasoning) {
          for (const r of step.reasoning) {
            lines.push({ text: `→ ${r.answer}`, type: 'detail' });
          }
        }

        // Metrics as simple lines
        if (step.metrics) {
          for (const m of step.metrics) {
            const unit = m.unit || '';
            lines.push({ text: `→ ${m.label}: ${m.value}${unit}`, type: 'detail' });
          }
        }

        // Error
        if (step.error) {
          lines.push({ text: `→ ${step.error.message}`, type: 'error' });
        }
      }

      // Blank line between steps
      lines.push({ text: '', type: 'normal' });
    }

    // Final status (only show when not a placeholder)
    if (log.summary && log.summary.status !== 'PENDING') {
      const statusIcon = log.summary.status === 'READY' ? '✓' : '○';
      lines.push({
        text: `${statusIcon} ${log.summary.status}`,
        type: log.summary.status === 'READY' ? 'success' : 'dim'
      });
      if (log.summary.reason) {
        lines.push({ text: `→ ${log.summary.reason}`, type: 'dim' });
      }
    }

    return lines;
  };

  const lines = buildLines();

  const getLineClass = (type: LogLine['type']) => {
    switch (type) {
      case 'step': return 'text-white font-medium';
      case 'detail': return 'text-zinc-400 pl-2';
      case 'error': return 'text-red-400 pl-2';
      case 'success': return 'text-green-400';
      case 'running': return 'text-blue-400 animate-pulse';
      case 'dim': return 'text-zinc-500';
      default: return 'text-zinc-400';
    }
  };

  return (
    <div
      ref={scrollRef}
      className={`bg-zinc-950 font-mono text-xs overflow-y-auto ${className}`}
    >
      <div className="p-4 space-y-1">
        {lines.map((line, i) => (
          <div key={i} className={getLineClass(line.type)}>
            {line.text || '\u00A0'}
          </div>
        ))}

        {isRunning && (
          <div className="text-blue-400 animate-pulse">
            Thinking...
          </div>
        )}
      </div>
    </div>
  );
}
