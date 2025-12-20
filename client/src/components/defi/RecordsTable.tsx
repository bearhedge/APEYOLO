/**
 * RecordsTable - Dense Bloomberg-style on-chain records display
 */

import { ExternalLink } from 'lucide-react';
import type { OnChainAttestation } from '@shared/types/defi';
import { formatUSD, getExplorerUrl } from '@/lib/solana';

interface RecordsTableProps {
  records: OnChainAttestation[];
  cluster: 'devnet' | 'mainnet-beta';
  loading?: boolean;
}

export function RecordsTable({ records, cluster, loading }: RecordsTableProps) {
  if (loading) {
    return (
      <div className="bg-terminal-panel terminal-grid">
        <div className="px-4 py-3 border-b border-terminal">
          <span className="text-xs uppercase tracking-wide text-terminal-dim">On-Chain Records</span>
        </div>
        <div className="p-4 animate-pulse space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-8 bg-white/5" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-terminal-panel terminal-grid">
      {/* Header */}
      <div className="px-4 py-3 border-b border-terminal flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-terminal-dim">
          On-Chain Records ({records.length})
        </span>
        <span className={`text-xs ${cluster === 'devnet' ? 'text-bloomberg-amber' : 'text-bloomberg-green'}`}>
          {cluster === 'devnet' ? 'DEVNET' : 'MAINNET'}
        </span>
      </div>

      {/* Table Header */}
      <div className="grid grid-cols-5 gap-2 px-4 py-2 border-b border-terminal text-xs text-terminal-dim uppercase tracking-wide">
        <div>Period</div>
        <div className="text-right">Return</div>
        <div className="text-right">P&L</div>
        <div className="text-right">Trades</div>
        <div className="text-right">Tx</div>
      </div>

      {/* Records */}
      {records.length > 0 ? (
        <div className="max-h-64 overflow-y-auto">
          {records.map((record, i) => (
            <div
              key={record.txSignature}
              className={`grid grid-cols-5 gap-2 px-4 py-2 text-xs font-mono hover:bg-white/5 ${
                i < records.length - 1 ? 'border-b border-terminal' : ''
              }`}
            >
              <div className="text-terminal-bright truncate">{record.data.periodLabel}</div>
              <div className={`text-right tabular-nums ${
                record.data.returnPercent >= 0 ? 'text-bloomberg-green' : 'text-bloomberg-red'
              }`}>
                {record.data.returnPercent >= 0 ? '+' : ''}{record.data.returnPercent.toFixed(2)}%
              </div>
              <div className={`text-right tabular-nums ${
                record.data.pnlUsd >= 0 ? 'text-bloomberg-green' : 'text-bloomberg-red'
              }`}>
                {formatUSD(record.data.pnlUsd)}
              </div>
              <div className="text-right tabular-nums text-terminal-dim">
                {record.data.tradeCount}
              </div>
              <div className="text-right">
                <a
                  href={getExplorerUrl(record.txSignature, 'tx', cluster)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-bloomberg-blue hover:underline inline-flex items-center gap-0.5"
                >
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="px-4 py-8 text-center text-terminal-dim text-xs">
          No on-chain records yet
        </div>
      )}
    </div>
  );
}
