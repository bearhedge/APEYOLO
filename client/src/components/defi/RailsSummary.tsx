/**
 * RailsSummary - Compact spec-sheet style rails display
 *
 * Always visible, dense, terminal-style.
 */

import { Shield, AlertTriangle } from 'lucide-react';
import type { Rail } from '@shared/types/rails';

interface RailsSummaryProps {
  rail: Rail | null;
  violationCount?: number;
  onCreateClick?: () => void;
  loading?: boolean;
}

export function RailsSummary({
  rail,
  violationCount = 0,
  onCreateClick,
  loading,
}: RailsSummaryProps) {
  if (loading) {
    return (
      <div className="bg-terminal-panel terminal-grid p-4">
        <div className="animate-pulse space-y-2">
          <div className="h-4 bg-white/5 w-1/2" />
          <div className="h-3 bg-white/5 w-3/4" />
          <div className="h-3 bg-white/5 w-2/3" />
        </div>
      </div>
    );
  }

  if (!rail) {
    return (
      <div className="bg-terminal-panel terminal-grid p-4">
        <div className="flex items-center gap-2 mb-3">
          <Shield className="w-4 h-4 text-terminal-dim" />
          <span className="text-xs uppercase tracking-wide text-terminal-dim">DeFi Rails</span>
        </div>
        <p className="text-sm text-terminal-dim mb-3">No active rails</p>
        <button
          onClick={onCreateClick}
          className="text-xs text-bloomberg-blue hover:underline"
        >
          + Create Rails
        </button>
      </div>
    );
  }

  return (
    <div className="bg-terminal-panel terminal-grid p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-bloomberg-green" />
          <span className="text-xs uppercase tracking-wide text-terminal-dim">DeFi Rails</span>
        </div>
        <span className="text-xs text-bloomberg-green">ACTIVE</span>
      </div>

      {/* Spec Grid */}
      <div className="space-y-1.5 text-xs font-mono">
        <div className="flex justify-between">
          <span className="text-terminal-dim">Symbols</span>
          <span className="text-terminal-bright">{rail.allowedSymbols.join(', ')}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-terminal-dim">Strategy</span>
          <span className="text-terminal-bright">{rail.strategyType} only</span>
        </div>
        <div className="flex justify-between">
          <span className="text-terminal-dim">Delta</span>
          <span className="text-terminal-bright tabular-nums">
            {rail.minDelta.toFixed(2)} – {rail.maxDelta.toFixed(2)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-terminal-dim">Max Loss</span>
          <span className="text-terminal-bright tabular-nums">
            {(rail.maxDailyLossPercent * 100).toFixed(0)}%/day
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-terminal-dim">Overnight</span>
          <span className={rail.noOvernightPositions ? 'text-bloomberg-red' : 'text-terminal-bright'}>
            {rail.noOvernightPositions ? 'NOT ALLOWED' : 'Allowed'}
          </span>
        </div>
      </div>

      {/* Violations */}
      <div className="mt-3 pt-3 border-t border-terminal flex items-center justify-between">
        <span className="text-xs text-terminal-dim">Violations</span>
        <span className={`text-xs font-mono ${
          violationCount > 0 ? 'text-bloomberg-red' : 'text-bloomberg-green'
        }`}>
          {violationCount > 0 && <AlertTriangle className="w-3 h-3 inline mr-1" />}
          {violationCount}
        </span>
      </div>
    </div>
  );
}
