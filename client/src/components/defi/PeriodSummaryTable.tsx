/**
 * PeriodSummaryTable - Shows MTD/YTD/ALL with on-chain verification status
 *
 * Combines performance metrics with blockchain attestation status.
 * Each period shows: Return, P&L, Trades, Win%, and ON-CHAIN status/TX link.
 */

import { ExternalLink, Check, X, Loader2 } from 'lucide-react';
import { formatUSD, getExplorerUrl } from '@/lib/solana';

interface PeriodRow {
  period: string;
  returnPercent: number;
  pnlUsd: number;
  tradeCount: number;
  winRate: number;
  isAttested?: boolean;
  txHash?: string;
}

interface PeriodSummaryTableProps {
  rows: PeriodRow[];
  cluster: 'devnet' | 'mainnet-beta';
  loading?: boolean;
  onAttest?: (period: string) => void;
}

export function PeriodSummaryTable({ rows, cluster, loading, onAttest }: PeriodSummaryTableProps) {
  if (loading) {
    return (
      <div className="bg-terminal-panel terminal-grid">
        <div className="px-4 py-3 border-b border-terminal">
          <span className="text-xs uppercase tracking-wide text-terminal-dim">Period Summary</span>
        </div>
        <div className="p-4 animate-pulse space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-6 bg-white/5" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-terminal-panel terminal-grid">
      {/* Header */}
      <div className="px-4 py-3 border-b border-terminal flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-terminal-dim">Period Summary</span>
        <span className={`text-xs ${cluster === 'devnet' ? 'text-bloomberg-amber' : 'text-bloomberg-green'}`}>
          {cluster === 'devnet' ? 'DEVNET' : 'MAINNET'}
        </span>
      </div>

      {/* Table Header */}
      <div className="grid grid-cols-6 gap-2 px-4 py-2 border-b border-terminal text-xs text-terminal-dim uppercase tracking-wide">
        <div>Period</div>
        <div className="text-right">Return</div>
        <div className="text-right">P&L</div>
        <div className="text-right">Trades</div>
        <div className="text-right">Win %</div>
        <div className="text-right">On-Chain</div>
      </div>

      {/* Data Rows */}
      {rows.map((row, i) => (
        <div
          key={row.period}
          className={`grid grid-cols-6 gap-2 px-4 py-2 text-sm font-mono ${
            i < rows.length - 1 ? 'border-b border-terminal' : ''
          }`}
        >
          <div className="text-terminal-dim">{row.period}</div>
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
            {row.tradeCount > 0 ? `${(row.winRate * 100).toFixed(0)}%` : '—'}
          </div>
          <div className="text-right flex items-center justify-end gap-1">
            {row.isAttested && row.txHash ? (
              <>
                <Check className="w-3 h-3 text-bloomberg-green" />
                <a
                  href={getExplorerUrl(row.txHash, 'tx', cluster)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-bloomberg-blue hover:underline text-xs inline-flex items-center gap-0.5"
                  title={row.txHash}
                >
                  {row.txHash.slice(0, 6)}...
                  <ExternalLink className="w-3 h-3" />
                </a>
              </>
            ) : (
              <>
                <X className="w-3 h-3 text-terminal-dim" />
                {onAttest && (
                  <button
                    onClick={() => onAttest(row.period)}
                    className="text-xs text-bloomberg-blue hover:underline"
                  >
                    Attest
                  </button>
                )}
              </>
            )}
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
