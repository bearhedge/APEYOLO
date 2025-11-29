/**
 * EngineLog - Terminal-like component for displaying engine execution logs
 * Shows step-by-step operations, computations, and values during engine execution
 *
 * Enhanced with transparent reasoning chains:
 * - Logic steps showing decision flow
 * - Computations with formulas and values
 * - Confidence levels with visual indicators
 * - Warnings and alerts
 *
 * Supports two entry types:
 * 1. Operation entries - Real-time IBKR/market data operations (connection, fetching)
 * 2. Step entries - 5-step analysis process results with full reasoning chains
 */

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Terminal, Loader2, Zap, TrendingUp, BarChart3, LineChart, Settings2, AlertTriangle, Calculator, GitBranch, Brain } from 'lucide-react';

// Reasoning chain types (matching backend StepReasoning)
interface LogicStep {
  index: number;
  action: string;
  result?: string;
  hasWarning?: boolean;
}

interface Computation {
  name: string;
  formula: string;
  inputs: Record<string, unknown>;
  result: unknown;
  explanation?: string;
}

interface StepReasoning {
  step: 1 | 2 | 3 | 4 | 5;
  name: string;
  timestamp: string;
  inputs: Record<string, unknown>;
  logic: LogicStep[];
  computations: Computation[];
  decision: string;
  decisionEmoji: string;
  confidence: number;
  canProceed: boolean;
  warnings: string[];
  metadata?: Record<string, unknown>;
}

// Step analysis entry (from backend) - enhanced with reasoning
interface AuditEntry {
  step: number;
  name: string;
  timestamp: string;
  input: Record<string, any>;
  output: Record<string, any>;
  passed: boolean;
  reason?: string;
  // NEW: Full reasoning chain for transparency
  reasoning?: StepReasoning;
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

// Reasoning summary from the engine
export interface ReasoningSummary {
  totalSteps: number;
  passedSteps: number;
  totalWarnings: number;
  totalComputations: number;
  averageConfidence: number;
  canExecute: boolean;
  failedAtStep?: number;
  elapsedMs: number;
}

interface EngineLogProps {
  logs: LogEntry[];
  isRunning?: boolean;
  className?: string;
  reasoningSummary?: ReasoningSummary;
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
 * Confidence level indicator with color coding
 */
function ConfidenceBar({ confidence }: { confidence: number }) {
  const getColor = (conf: number) => {
    if (conf >= 80) return 'bg-green-500';
    if (conf >= 60) return 'bg-yellow-500';
    if (conf >= 40) return 'bg-orange-500';
    return 'bg-red-500';
  };

  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full ${getColor(confidence)} transition-all`}
          style={{ width: `${confidence}%` }}
        />
      </div>
      <span className={`text-xs ${confidence >= 60 ? 'text-green-400' : 'text-yellow-400'}`}>
        {confidence.toFixed(0)}%
      </span>
    </div>
  );
}

/**
 * Logic step display component
 */
function LogicStepDisplay({ step }: { step: LogicStep }) {
  return (
    <div className={`flex items-start gap-2 py-0.5 ${step.hasWarning ? 'text-yellow-400' : 'text-gray-400'}`}>
      <span className="text-gray-600 font-mono">{step.index}.</span>
      <div className="flex-1">
        <span className="text-gray-300">{step.action}</span>
        {step.result && (
          <span className="text-cyan-400 ml-2">→ {step.result}</span>
        )}
        {step.hasWarning && (
          <AlertTriangle className="inline w-3 h-3 ml-1 text-yellow-500" />
        )}
      </div>
    </div>
  );
}

/**
 * Computation display component
 */
function ComputationDisplay({ comp }: { comp: Computation }) {
  const [showInputs, setShowInputs] = useState(false);

  return (
    <div className="py-1 border-l-2 border-purple-500/30 pl-2 my-1">
      <div className="flex items-center gap-2">
        <Calculator className="w-3 h-3 text-purple-400" />
        <span className="text-purple-300 font-medium">{comp.name}</span>
      </div>
      <div className="text-gray-500 text-xs font-mono ml-5">{comp.formula}</div>
      <div className="flex items-center gap-2 ml-5 mt-0.5">
        <span className="text-gray-600">=</span>
        <span className="text-cyan-400 font-bold">{formatValue(comp.result)}</span>
        {comp.explanation && (
          <span className="text-gray-500 text-xs">({comp.explanation})</span>
        )}
      </div>
      {Object.keys(comp.inputs).length > 0 && (
        <button
          onClick={() => setShowInputs(!showInputs)}
          className="text-xs text-gray-600 hover:text-gray-400 ml-5 mt-0.5"
        >
          {showInputs ? '▼ hide inputs' : '▶ show inputs'}
        </button>
      )}
      {showInputs && (
        <div className="ml-5 mt-1 text-xs">
          {Object.entries(comp.inputs).map(([key, value]) => (
            <div key={key} className="text-gray-500">
              <span className="text-gray-600">{key}:</span> <span className="text-gray-400">{formatValue(value)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Single step log entry component (for 5-step analysis)
 * Enhanced with full reasoning chain display
 */
function StepLogEntry({ entry, isExpanded, onToggle }: {
  entry: AuditEntry;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const [showLogic, setShowLogic] = useState(false);
  const [showComputations, setShowComputations] = useState(false);

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

  const reasoning = entry.reasoning;

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
        <span className="mx-2">{reasoning?.decisionEmoji || stepIcons[entry.step] || '📌'}</span>
        <span className={`font-bold ${stepColors[entry.step] || 'text-white'}`}>
          STEP {entry.step}
        </span>
        <span className="text-gray-400 mx-2">-</span>
        <span className="text-white">{entry.name}</span>
        {/* Confidence indicator */}
        {reasoning && (
          <span className="ml-2">
            <ConfidenceBar confidence={reasoning.confidence} />
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {/* Warning indicator */}
          {reasoning?.warnings && reasoning.warnings.length > 0 && (
            <span className="flex items-center gap-1 text-yellow-500 text-xs">
              <AlertTriangle className="w-3 h-3" />
              {reasoning.warnings.length}
            </span>
          )}
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
          {/* Decision summary from reasoning */}
          {reasoning?.decision && (
            <div className="text-gray-300 py-1 mb-2 flex items-start gap-2">
              <Brain className="w-4 h-4 text-cyan-400 mt-0.5 flex-shrink-0" />
              <span>{reasoning.decision}</span>
            </div>
          )}

          {/* Warnings */}
          {reasoning?.warnings && reasoning.warnings.length > 0 && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded px-2 py-1 mb-2">
              {reasoning.warnings.map((warning, idx) => (
                <div key={idx} className="flex items-center gap-2 text-yellow-400 text-xs">
                  <AlertTriangle className="w-3 h-3" />
                  <span>{warning}</span>
                </div>
              ))}
            </div>
          )}

          {/* Logic steps (collapsible) */}
          {reasoning?.logic && reasoning.logic.length > 0 && (
            <div className="mb-2">
              <button
                onClick={(e) => { e.stopPropagation(); setShowLogic(!showLogic); }}
                className="flex items-center gap-2 text-xs text-gray-500 hover:text-gray-300 mb-1"
              >
                <GitBranch className="w-3 h-3" />
                <span>Logic Steps ({reasoning.logic.length})</span>
                {showLogic ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              </button>
              {showLogic && (
                <div className="ml-4 border-l border-gray-700 pl-2">
                  {reasoning.logic.map((step) => (
                    <LogicStepDisplay key={step.index} step={step} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Computations (collapsible) */}
          {reasoning?.computations && reasoning.computations.length > 0 && (
            <div className="mb-2">
              <button
                onClick={(e) => { e.stopPropagation(); setShowComputations(!showComputations); }}
                className="flex items-center gap-2 text-xs text-gray-500 hover:text-gray-300 mb-1"
              >
                <Calculator className="w-3 h-3" />
                <span>Computations ({reasoning.computations.length})</span>
                {showComputations ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              </button>
              {showComputations && (
                <div className="ml-4">
                  {reasoning.computations.map((comp, idx) => (
                    <ComputationDisplay key={idx} comp={comp} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Reason (legacy fallback) */}
          {!reasoning?.decision && entry.reason && (
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
 * Enhanced with reasoning summary display
 */
export default function EngineLog({ logs, isRunning = false, className = '', reasoningSummary }: EngineLogProps) {
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

      {/* Footer with reasoning summary */}
      {logs.length > 0 && (
        <div className="px-4 py-2 bg-gray-900/30 border-t border-gray-800 text-xs">
          {/* Reasoning summary stats */}
          {reasoningSummary && (
            <div className="flex items-center gap-4 mb-2 pb-2 border-b border-gray-800">
              <div className="flex items-center gap-1">
                <span className="text-gray-600">Steps:</span>
                <span className={reasoningSummary.passedSteps === reasoningSummary.totalSteps ? 'text-green-400' : 'text-yellow-400'}>
                  {reasoningSummary.passedSteps}/{reasoningSummary.totalSteps}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-gray-600">Confidence:</span>
                <span className={reasoningSummary.averageConfidence >= 70 ? 'text-green-400' : 'text-yellow-400'}>
                  {reasoningSummary.averageConfidence.toFixed(0)}%
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-gray-600">Computations:</span>
                <span className="text-purple-400">{reasoningSummary.totalComputations}</span>
              </div>
              {reasoningSummary.totalWarnings > 0 && (
                <div className="flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3 text-yellow-500" />
                  <span className="text-yellow-400">{reasoningSummary.totalWarnings}</span>
                </div>
              )}
              <div className="flex items-center gap-1">
                <span className="text-gray-600">Time:</span>
                <span className="text-gray-400">{reasoningSummary.elapsedMs}ms</span>
              </div>
              <div className="ml-auto">
                {reasoningSummary.canExecute ? (
                  <span className="text-green-400 font-bold">READY TO EXECUTE</span>
                ) : (
                  <span className="text-red-400 font-bold">
                    BLOCKED{reasoningSummary.failedAtStep ? ` @ Step ${reasoningSummary.failedAtStep}` : ''}
                  </span>
                )}
              </div>
            </div>
          )}
          <div className="flex items-center justify-between text-gray-500">
            <span>
              {(() => {
                const stepLogs = logs.filter((l): l is AuditEntry => !isOperationEntry(l));
                const opLogs = logs.filter(isOperationEntry);
                if (stepLogs.length > 0) {
                  const passed = stepLogs.filter(l => l.passed).length;
                  const warnings = stepLogs.reduce((sum, l) => sum + (l.reasoning?.warnings?.length || 0), 0);
                  return `${passed}/${stepLogs.length} steps passed${warnings > 0 ? ` (${warnings} warnings)` : ''}`;
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
