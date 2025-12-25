/**
 * TradeLogTable - Flat table showing one row per trade
 *
 * All values in HKD. Click row to see validation details.
 */

import { useState } from 'react';
import { Check, AlertCircle, Clock, X } from 'lucide-react';

interface Trade {
  id: string;
  date: string;
  dateFormatted: string;
  symbol: string;
  strategy: string;
  contracts: number;
  putStrike: number | null;
  callStrike: number | null;
  leg1Premium: number | null;
  leg2Premium: number | null;
  entryPremium: number | null;
  exitPremium: number | null;
  entryTime: string | null;
  exitTime: string | null;
  status: string;
  exitReason?: string;
  realizedPnl: number;
  realizedPnlUSD?: number;
  returnPercent: number;
  // NEW: Days held and outcome
  daysHeld?: number | null;
  outcome?: 'win' | 'loss' | 'breakeven' | 'open';
  entryNav?: number | null;
  premiumReceived?: number | null;
  costToClose?: number | null;
  // NAV data (in HKD)
  openingNav?: number | null;
  closingNav?: number | null;
  navChange?: number | null;
  dailyReturnPct?: number | null;
  // Notional values (in HKD)
  putNotionalHKD?: number | null;
  callNotionalHKD?: number | null;
  totalNotionalHKD?: number | null;
  // Validation fields
  spotPriceAtClose?: number | null;
  validationStatus?: 'verified' | 'pending' | 'discrepancy';
  marginRequired?: number | null;
  maxLoss?: number | null;
  entrySpy?: number | null;
}

interface TradeLogTableProps {
  trades: Trade[];
  loading?: boolean;
}

function formatHKD(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function formatNotionalM(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return '—';
  const millions = value / 1_000_000;
  return `$${millions.toFixed(2)}M`;
}

function formatStrikes(putStrike: number | null, callStrike: number | null): string {
  if (putStrike && callStrike) {
    return `${putStrike}P / ${callStrike}C`;
  }
  if (putStrike) {
    return `${putStrike}P`;
  }
  if (callStrike) {
    return `${callStrike}C`;
  }
  return '—';
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'expired':
      return 'text-bloomberg-green';
    case 'closed':
      return 'text-bloomberg-blue';
    case 'open':
      return 'text-bloomberg-amber';
    default:
      return 'text-terminal-dim';
  }
}

function formatStatus(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatDaysHeld(days: number | null | undefined): string {
  if (days === null || days === undefined) return '—';
  if (days === 0) return '0d';
  return `${days}d`;
}

function OutcomeBadge({ outcome }: { outcome?: string }) {
  switch (outcome) {
    case 'win':
      return <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-bloomberg-green/20 text-bloomberg-green">W</span>;
    case 'loss':
      return <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-bloomberg-red/20 text-bloomberg-red">L</span>;
    case 'breakeven':
      return <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-terminal-dim/20 text-terminal-dim">BE</span>;
    case 'open':
      return <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-bloomberg-amber/20 text-bloomberg-amber">—</span>;
    default:
      return <span className="text-terminal-dim">—</span>;
  }
}

function ValidationIcon({ status }: { status?: string }) {
  switch (status) {
    case 'verified':
      return <Check className="w-3.5 h-3.5 text-bloomberg-green" />;
    case 'discrepancy':
      return <AlertCircle className="w-3.5 h-3.5 text-bloomberg-red" />;
    default:
      return <Clock className="w-3.5 h-3.5 text-terminal-dim" />;
  }
}

// Validation Modal Component
function ValidationModal({ trade, onClose }: { trade: Trade; onClose: () => void }) {
  const putITM = trade.spotPriceAtClose && trade.putStrike ? trade.spotPriceAtClose < trade.putStrike : false;
  const callITM = trade.spotPriceAtClose && trade.callStrike ? trade.spotPriceAtClose > trade.callStrike : false;

  // Expected P&L calculation
  let expectedPnlUSD = 0;
  const entryPremiumUSD = trade.entryPremium ? trade.entryPremium / 7.8 : 0;

  if (trade.status === 'expired' || trade.status === 'closed') {
    if (!putITM && !callITM) {
      // Both OTM - keep full premium
      expectedPnlUSD = entryPremiumUSD;
    } else if (putITM && trade.putStrike && trade.spotPriceAtClose) {
      // Put ITM - assignment loss
      const assignmentLoss = (trade.putStrike - trade.spotPriceAtClose) * 100 * trade.contracts;
      expectedPnlUSD = entryPremiumUSD - assignmentLoss;
    } else if (callITM && trade.callStrike && trade.spotPriceAtClose) {
      // Call ITM - assignment loss
      const assignmentLoss = (trade.spotPriceAtClose - trade.callStrike) * 100 * trade.contracts;
      expectedPnlUSD = entryPremiumUSD - assignmentLoss;
    }
  }

  const expectedPnlHKD = expectedPnlUSD * 7.8;
  const pnlMatch = Math.abs((trade.realizedPnl || 0) - expectedPnlHKD) < 50; // Within $50 HKD tolerance

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-terminal-panel border border-terminal rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-terminal">
          <div className="flex items-center gap-3">
            <span className="text-terminal-bright font-medium">{trade.dateFormatted}</span>
            <span className="text-terminal-dim">|</span>
            <span className="text-terminal-bright">{trade.symbol}</span>
            <span className="text-terminal-dim">|</span>
            <span className="text-terminal-dim">{trade.strategy}</span>
          </div>
          <button onClick={onClose} className="text-terminal-dim hover:text-terminal-bright">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Trade Details */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <h3 className="text-xs uppercase text-terminal-dim tracking-wide">Position Details</h3>
              <div className="bg-white/5 rounded p-3 space-y-1 font-mono text-sm">
                <div className="flex justify-between">
                  <span className="text-terminal-dim">Contracts:</span>
                  <span className="text-terminal-bright">{trade.contracts}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-terminal-dim">Put Strike:</span>
                  <span className="text-terminal-bright">${trade.putStrike || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-terminal-dim">Call Strike:</span>
                  <span className="text-terminal-bright">${trade.callStrike || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-terminal-dim">Entry SPY:</span>
                  <span className="text-terminal-bright">${trade.entrySpy?.toFixed(2) || '—'}</span>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-xs uppercase text-terminal-dim tracking-wide">Notional Exposure (HKD)</h3>
              <div className="bg-white/5 rounded p-3 space-y-1 font-mono text-sm">
                <div className="flex justify-between">
                  <span className="text-terminal-dim">Put Notional:</span>
                  <span className="text-terminal-bright">{formatNotionalM(trade.putNotionalHKD)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-terminal-dim">Call Notional:</span>
                  <span className="text-terminal-bright">{formatNotionalM(trade.callNotionalHKD)}</span>
                </div>
                <div className="flex justify-between border-t border-terminal pt-1 mt-1">
                  <span className="text-terminal-dim">Total Notional:</span>
                  <span className="text-bloomberg-amber font-medium">{formatNotionalM(trade.totalNotionalHKD)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* P&L Validation */}
          <div className="space-y-2">
            <h3 className="text-xs uppercase text-terminal-dim tracking-wide">P&L Validation</h3>
            <div className="bg-white/5 rounded p-3 space-y-2 font-mono text-sm">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <div className="text-terminal-dim text-xs">SPY Close</div>
                  <div className="text-terminal-bright">${trade.spotPriceAtClose?.toFixed(2) || '—'}</div>
                </div>
                <div>
                  <div className="text-terminal-dim text-xs">Put Status</div>
                  <div className={putITM ? 'text-bloomberg-red' : 'text-bloomberg-green'}>
                    {putITM ? 'ITM (Assigned)' : 'OTM (Expired)'}
                  </div>
                </div>
                <div>
                  <div className="text-terminal-dim text-xs">Call Status</div>
                  <div className={callITM ? 'text-bloomberg-red' : 'text-bloomberg-green'}>
                    {callITM ? 'ITM (Assigned)' : 'OTM (Expired)'}
                  </div>
                </div>
              </div>

              <div className="border-t border-terminal pt-2 mt-2 grid grid-cols-3 gap-4">
                <div>
                  <div className="text-terminal-dim text-xs">Entry Premium (HKD)</div>
                  <div className="text-terminal-bright">{formatHKD(trade.entryPremium)}</div>
                </div>
                <div>
                  <div className="text-terminal-dim text-xs">Expected P&L (HKD)</div>
                  <div className={expectedPnlHKD >= 0 ? 'text-bloomberg-green' : 'text-bloomberg-red'}>
                    {expectedPnlHKD >= 0 ? '+' : ''}{formatHKD(expectedPnlHKD)}
                  </div>
                </div>
                <div>
                  <div className="text-terminal-dim text-xs">Actual P&L (HKD)</div>
                  <div className={trade.realizedPnl >= 0 ? 'text-bloomberg-green' : 'text-bloomberg-red'}>
                    {trade.realizedPnl >= 0 ? '+' : ''}{formatHKD(trade.realizedPnl)}
                  </div>
                </div>
              </div>

              <div className="border-t border-terminal pt-2 mt-2 flex items-center gap-2">
                <span className="text-terminal-dim text-xs">Validation:</span>
                {pnlMatch ? (
                  <span className="flex items-center gap-1 text-bloomberg-green">
                    <Check className="w-4 h-4" /> Match
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-bloomberg-red">
                    <AlertCircle className="w-4 h-4" /> Discrepancy (Δ {formatHKD(Math.abs((trade.realizedPnl || 0) - expectedPnlHKD))})
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* NAV Reconciliation */}
          <div className="space-y-2">
            <h3 className="text-xs uppercase text-terminal-dim tracking-wide">NAV Reconciliation (HKD)</h3>
            <div className="bg-white/5 rounded p-3 space-y-1 font-mono text-sm">
              <div className="grid grid-cols-4 gap-4">
                <div>
                  <div className="text-terminal-dim text-xs">Opening NAV</div>
                  <div className="text-terminal-bright">{formatHKD(trade.openingNav)}</div>
                </div>
                <div>
                  <div className="text-terminal-dim text-xs">Closing NAV</div>
                  <div className="text-terminal-bright">{formatHKD(trade.closingNav)}</div>
                </div>
                <div>
                  <div className="text-terminal-dim text-xs">NAV Change</div>
                  <div className={(trade.navChange ?? 0) >= 0 ? 'text-bloomberg-green' : 'text-bloomberg-red'}>
                    {(trade.navChange ?? 0) >= 0 ? '+' : ''}{formatHKD(trade.navChange)}
                  </div>
                </div>
                <div>
                  <div className="text-terminal-dim text-xs">Daily Return</div>
                  <div className={(trade.dailyReturnPct ?? 0) >= 0 ? 'text-bloomberg-green' : 'text-bloomberg-red'}>
                    {(trade.dailyReturnPct ?? 0) >= 0 ? '+' : ''}{trade.dailyReturnPct?.toFixed(2) || '—'}%
                  </div>
                </div>
              </div>
              <div className="text-xs text-terminal-dim mt-2 pt-2 border-t border-terminal">
                Note: NAV includes all positions (stocks + options). NAV change ≠ Options P&L alone.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function TradeLogTable({ trades, loading }: TradeLogTableProps) {
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);

  if (loading) {
    return (
      <div className="bg-terminal-panel terminal-grid">
        <div className="px-4 py-3 border-b border-terminal">
          <span className="text-xs uppercase tracking-wide text-terminal-dim">Trade Log</span>
        </div>
        <div className="p-4 animate-pulse space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-6 bg-white/5" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="bg-terminal-panel terminal-grid">
        {/* Header */}
        <div className="px-4 py-3 border-b border-terminal flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-terminal-dim">Trade Log (HKD)</span>
          <span className="text-xs text-terminal-dim">Click row for details</span>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full table-auto">
            <thead>
              <tr className="border-b border-terminal text-xs text-terminal-dim uppercase tracking-wide">
                <th className="px-3 py-2.5 text-center font-normal whitespace-nowrap">#</th>
                <th className="px-3 py-2.5 text-left font-normal whitespace-nowrap">Date</th>
                <th className="px-3 py-2.5 text-right font-normal whitespace-nowrap">Open NAV</th>
                <th className="px-3 py-2.5 text-right font-normal whitespace-nowrap">Close NAV</th>
                <th className="px-3 py-2.5 text-center font-normal whitespace-nowrap">Days</th>
                <th className="px-3 py-2.5 text-left font-normal whitespace-nowrap">Sym</th>
                <th className="px-3 py-2.5 text-center font-normal whitespace-nowrap">Qty</th>
                <th className="px-3 py-2.5 text-right font-normal whitespace-nowrap">Strikes</th>
                <th className="px-3 py-2.5 text-right font-normal whitespace-nowrap">Notional</th>
                <th className="px-3 py-2.5 text-right font-normal whitespace-nowrap">Premium</th>
                <th className="px-3 py-2.5 text-right font-normal whitespace-nowrap">P&L</th>
                <th className="px-3 py-2.5 text-right font-normal whitespace-nowrap">Return</th>
                <th className="px-3 py-2.5 text-center font-normal whitespace-nowrap">W/L</th>
                <th className="px-3 py-2.5 text-center font-normal whitespace-nowrap">Status</th>
                <th className="px-3 py-2.5 text-center font-normal whitespace-nowrap">✓</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((trade, i) => (
                <tr
                  key={trade.id}
                  onClick={() => setSelectedTrade(trade)}
                  className={`text-sm font-mono cursor-pointer ${
                    i < trades.length - 1 ? 'border-b border-terminal' : ''
                  } hover:bg-white/10 transition-colors`}
                >
                  <td className="px-3 py-2.5 text-center text-bloomberg-amber font-medium">{trades.length - i}</td>
                  <td className="px-3 py-2.5 text-terminal-dim whitespace-nowrap">{trade.dateFormatted}</td>
                  <td className="px-3 py-2.5 text-right text-terminal-bright tabular-nums whitespace-nowrap">
                    {trade.openingNav ? `$${Math.round(trade.openingNav).toLocaleString()}` : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right text-terminal-bright tabular-nums whitespace-nowrap">
                    {trade.closingNav ? `$${Math.round(trade.closingNav).toLocaleString()}` : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-center text-terminal-dim tabular-nums">
                    {formatDaysHeld(trade.daysHeld)}
                  </td>
                  <td className="px-3 py-2.5 text-terminal-bright font-medium">{trade.symbol}</td>
                  <td className="px-3 py-2.5 text-center text-terminal-bright">{trade.contracts}</td>
                  <td className="px-3 py-2.5 text-right text-terminal-dim tabular-nums whitespace-nowrap">
                    {formatStrikes(trade.putStrike, trade.callStrike)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-bloomberg-amber whitespace-nowrap">
                    {formatNotionalM(trade.totalNotionalHKD)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-terminal-bright whitespace-nowrap">
                    {formatHKD(trade.entryPremium)}
                  </td>
                  <td className={`px-3 py-2.5 text-right tabular-nums font-medium whitespace-nowrap ${
                    trade.realizedPnl >= 0 ? 'text-bloomberg-green' : 'text-bloomberg-red'
                  }`}>
                    {trade.status === 'open' ? '—' : (
                      <>{trade.realizedPnl >= 0 ? '+' : ''}{formatHKD(trade.realizedPnl)}</>
                    )}
                  </td>
                  <td className={`px-3 py-2.5 text-right tabular-nums whitespace-nowrap ${
                    trade.returnPercent >= 0 ? 'text-bloomberg-green' : 'text-bloomberg-red'
                  }`}>
                    {trade.status === 'open' ? '—' : (
                      <>{trade.returnPercent >= 0 ? '+' : ''}{trade.returnPercent.toFixed(2)}%</>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <OutcomeBadge outcome={trade.outcome} />
                  </td>
                  <td className={`px-3 py-2.5 text-center ${getStatusColor(trade.status)}`}>
                    {formatStatus(trade.status)}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <div className="flex justify-center" title={trade.validationStatus || 'pending'}>
                      <ValidationIcon status={trade.validationStatus} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Empty State */}
        {trades.length === 0 && (
          <div className="px-4 py-8 text-center text-terminal-dim text-sm">
            No trades recorded yet
          </div>
        )}
      </div>

      {/* Validation Modal */}
      {selectedTrade && (
        <ValidationModal trade={selectedTrade} onClose={() => setSelectedTrade(null)} />
      )}
    </>
  );
}
