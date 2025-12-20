/**
 * PerformanceGrid - Bloomberg-style performance metrics display
 *
 * Dense, monospace, right-aligned numbers with period rows.
 */

import { formatUSD } from '@/lib/solana';

interface PerformanceRow {
  label: string;
  returnPercent: number;
  pnlUsd: number;
  tradeCount: number;
  winRate?: number;
}

interface PerformanceGridProps {
  rows: PerformanceRow[];
  loading?: boolean;
}

export function PerformanceGrid({ rows, loading }: PerformanceGridProps) {
  if (loading) {
    return (
      <div className="bg-terminal-panel terminal-grid p-4">
        <div className="animate-pulse space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-6 bg-white/5" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-terminal-panel terminal-grid">
      {/* Header Row */}
      <div className="grid grid-cols-5 gap-2 px-4 py-2 border-b border-terminal text-xs text-terminal-dim uppercase tracking-wide">
        <div>Period</div>
        <div className="text-right">Return</div>
        <div className="text-right">P&L</div>
        <div className="text-right">Trades</div>
        <div className="text-right">Win %</div>
      </div>

      {/* Data Rows */}
      {rows.map((row, i) => (
        <div
          key={row.label}
          className={`grid grid-cols-5 gap-2 px-4 py-2 text-sm font-mono ${
            i < rows.length - 1 ? 'border-b border-terminal' : ''
          }`}
        >
          <div className="text-terminal-dim">{row.label}</div>
          <div className={`text-right tabular-nums font-medium ${
            row.returnPercent >= 0 ? 'text-bloomberg-green' : 'text-bloomberg-red'
          }`}>
            {row.returnPercent >= 0 ? '+' : ''}{row.returnPercent.toFixed(2)}%
          </div>
          <div className={`text-right tabular-nums ${
            row.pnlUsd >= 0 ? 'text-bloomberg-green' : 'text-bloomberg-red'
          }`}>
            {row.pnlUsd >= 0 ? '+' : ''}{formatUSD(row.pnlUsd)}
          </div>
          <div className="text-right tabular-nums text-terminal-bright">
            {row.tradeCount}
          </div>
          <div className="text-right tabular-nums text-terminal-dim">
            {row.winRate !== undefined ? `${(row.winRate * 100).toFixed(0)}%` : '—'}
          </div>
        </div>
      ))}

      {/* Empty State */}
      {rows.length === 0 && (
        <div className="px-4 py-8 text-center text-terminal-dim text-sm">
          No performance data available
        </div>
      )}
    </div>
  );
}
