/**
 * EngineLog - Terminal-like component for displaying engine execution logs
 * Shows step-by-step operations, computations, and values during engine execution
 *
 * Supports two entry types:
 * 1. Operation entries - Real-time IBKR/market data operations (connection, fetching)
 * 2. Step entries - 5-step analysis process results
 */

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Terminal, Loader2, Zap, TrendingUp, BarChart3, LineChart, Settings2 } from 'lucide-react';

// Step analysis entry (from backend)
interface AuditEntry {
  step: number;
  name: string;
  timestamp: string;
  input: Record<string, any>;
  output: Record<string, any>;
  passed: boolean;
  reason?: string;
}

// Operation log entry (real-time operations)
export interface OperationEntry {
  type: 'operation';
  category: 'IBKR' | 'MARKET' | 'OPTIONS' | 'ANALYSIS' | 'DECISION';
  message: string;
  timestamp: string;
  status?: 'pending' | 'success' | 'error';
  value?: string | number;
}

// Union type for all log entries
export type LogEntry = AuditEntry | OperationEntry;

// Type guard to check if entry is an operation
function isOperationEntry(entry: LogEntry): entry is OperationEntry {
  return 'type' in entry && entry.type === 'operation';
}

interface EngineLogProps {
  logs: LogEntry[];
  isRunning?: boolean;
  className?: string;
}

/**
 * Format a value for display in the log
 */
function formatValue(value: any): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') {
    // Format numbers nicely
    if (Number.isInteger(value)) return value.toLocaleString();
    return value.toFixed(4);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (typeof value === 'object') {
    // For nested objects, show key count
    const keys = Object.keys(value);
    if (keys.length <= 3) {
      return JSON.stringify(value);
    }
    return `{${keys.length} fields}`;
  }
  return String(value);
}

/**
 * Format timestamp for display
 */
function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }) + '.' + date.getMilliseconds().toString().padStart(3, '0');
}

/**
 * Render a tree of key-value pairs
 */
function renderTree(data: Record<string, any>, prefix = '  ', isLast = true): JSX.Element[] {
  const entries = Object.entries(data);
  return entries.map(([key, value], index) => {
    const isLastItem = index === entries.length - 1;
    const connector = isLastItem ? '└─' : '├─';

    // Skip internal fields
    if (key.startsWith('_')) return null;

    return (
      <div key={key} className="text-gray-400">
        <span className="text-gray-600">{prefix}{connector}</span>
        <span className="text-cyan-400"> {key}:</span>
        <span className="text-gray-300"> {formatValue(value)}</span>
      </div>
    );
  }).filter(Boolean) as JSX.Element[];
}

/**
 * Category icons and colors for operation entries
 */
const categoryConfig: Record<OperationEntry['category'], { icon: React.ReactNode; color: string }> = {
  IBKR: { icon: <Zap className="w-3 h-3" />, color: 'text-blue-400' },
  MARKET: { icon: <TrendingUp className="w-3 h-3" />, color: 'text-green-400' },
  OPTIONS: { icon: <BarChart3 className="w-3 h-3" />, color: 'text-yellow-400' },
  ANALYSIS: { icon: <LineChart className="w-3 h-3" />, color: 'text-purple-400' },
  DECISION: { icon: <Settings2 className="w-3 h-3" />, color: 'text-cyan-400' },
};

/**
 * Operation log entry component (for real-time IBKR operations)
 */
function OperationLogEntry({ entry }: { entry: OperationEntry }) {
  const config = categoryConfig[entry.category];
  const statusIcon = entry.status === 'pending' ? (
    <Loader2 className="w-3 h-3 animate-spin text-yellow-400" />
  ) : entry.status === 'error' ? (
    <span className="text-red-400">✗</span>
  ) : entry.status === 'success' ? (
    <span className="text-green-400">✓</span>
  ) : null;

  return (
    <div className="font-mono text-sm flex items-center px-2 py-1 hover:bg-gray-900/30 rounded">
      <span className="text-gray-500">[{formatTimestamp(entry.timestamp)}]</span>
      <span className={`mx-2 ${config.color} flex items-center gap-1`}>
        {config.icon}
        <span className="font-bold">[{entry.category}]</span>
      </span>
      <span className="text-gray-300">{entry.message}</span>
      {entry.value !== undefined && (
        <span className="ml-2 text-cyan-400 font-bold">{entry.value}</span>
      )}
      {statusIcon && <span className="ml-auto">{statusIcon}</span>}
    </div>
  );
}

/**
 * Single step log entry component (for 5-step analysis)
 */
function StepLogEntry({ entry, isExpanded, onToggle }: {
  entry: AuditEntry;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const stepColors: Record<number, string> = {
    1: 'text-blue-400',
    2: 'text-purple-400',
    3: 'text-yellow-400',
    4: 'text-green-400',
    5: 'text-orange-400',
  };

  const stepIcons: Record<number, string> = {
    1: '📊',
    2: '🎯',
    3: '🎲',
    4: '📏',
    5: '🚪',
  };

  return (
    <div className="font-mono text-sm">
      {/* Header line */}
      <div
        className="flex items-center cursor-pointer hover:bg-gray-900/50 px-2 py-1 rounded"
        onClick={onToggle}
      >
        {isExpanded ? (
          <ChevronDown className="w-3 h-3 text-gray-500 mr-1 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 text-gray-500 mr-1 flex-shrink-0" />
        )}
        <span className="text-gray-500">[{formatTimestamp(entry.timestamp)}]</span>
        <span className="mx-2">{stepIcons[entry.step] || '📌'}</span>
        <span className={`font-bold ${stepColors[entry.step] || 'text-white'}`}>
          STEP {entry.step}
        </span>
        <span className="text-gray-400 mx-2">-</span>
        <span className="text-white">{entry.name}</span>
        <span className="ml-auto">
          {entry.passed ? (
            <span className="text-green-400">✅ PASS</span>
          ) : (
            <span className="text-red-400">❌ FAIL</span>
          )}
        </span>
      </div>

      {/* Expanded details */}
      {isExpanded && (
        <div className="ml-6 pl-4 border-l border-gray-700 mb-2">
          {/* Reason */}
          {entry.reason && (
            <div className="text-gray-400 mb-1">
              <span className="text-gray-600">  └─</span>
              <span className="text-cyan-400"> reason:</span>
              <span className="text-gray-300"> {entry.reason}</span>
            </div>
          )}

          {/* Output values */}
          {entry.output && Object.keys(entry.output).length > 0 && (
            <div className="mt-1">
              <div className="text-gray-500 text-xs uppercase tracking-wider mb-1">Output:</div>
              {renderTree(entry.output)}
            </div>
          )}

          {/* Input values (collapsed by default) */}
          {entry.input && Object.keys(entry.input).length > 0 && (
            <div className="mt-2 opacity-60">
              <div className="text-gray-600 text-xs uppercase tracking-wider mb-1">Input:</div>
              {renderTree(entry.input)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Main EngineLog component
 */
export default function EngineLog({ logs, isRunning = false, className = '' }: EngineLogProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set([1, 2, 3, 4, 5])); // All expanded by default

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

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

  return (
    <div className={`bg-[#0a0a0a] border border-gray-800 rounded-lg overflow-hidden ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-900/50 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-gray-400" />
          <span className="text-sm font-medium text-gray-300">Engine Log</span>
          {isRunning && (
            <span className="flex items-center gap-1 text-xs text-yellow-400">
              <Loader2 className="w-3 h-3 animate-spin" />
              Running...
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleAll}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            {expandedSteps.size === 5 ? 'Collapse All' : 'Expand All'}
          </button>
          <span className="text-xs text-gray-600">
            {logs.length} step{logs.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Log content */}
      <div
        ref={containerRef}
        className="p-4 max-h-80 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent"
      >
        {logs.length === 0 ? (
          <div className="text-gray-500 text-sm text-center py-8">
            {isRunning ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Waiting for engine execution...
              </span>
            ) : (
              'Click "Run Engine" to see execution logs'
            )}
          </div>
        ) : (
          <div className="space-y-1">
            {logs.map((entry, index) => {
              // Render operation entries (real-time IBKR operations)
              if (isOperationEntry(entry)) {
                return (
                  <OperationLogEntry
                    key={`op-${index}`}
                    entry={entry}
                  />
                );
              }
              // Render step entries (5-step analysis)
              return (
                <StepLogEntry
                  key={`step-${entry.step}-${index}`}
                  entry={entry}
                  isExpanded={expandedSteps.has(entry.step)}
                  onToggle={() => toggleStep(entry.step)}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Footer with summary */}
      {logs.length > 0 && (
        <div className="px-4 py-2 bg-gray-900/30 border-t border-gray-800 text-xs">
          <div className="flex items-center justify-between text-gray-500">
            <span>
              {(() => {
                const stepLogs = logs.filter((l): l is AuditEntry => !isOperationEntry(l));
                const opLogs = logs.filter(isOperationEntry);
                if (stepLogs.length > 0) {
                  return `${stepLogs.filter(l => l.passed).length}/${stepLogs.length} steps passed`;
                }
                return `${opLogs.length} operations`;
              })()}
            </span>
            <span>
              {logs.length > 0 && formatTimestamp(logs[logs.length - 1].timestamp)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
