/**
 * Position Quick-View - Collapsible strip showing position summary
 *
 * Displays Net Delta, Total P&L, and position count at a glance.
 * Expands to show mini-table with per-position details.
 */

import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getPositions } from '@/lib/api';
import { ChevronUp, ChevronDown } from 'lucide-react';
import type { Position } from '@shared/types';

// Universal type coercion helper
const toNum = (val: any): number => {
  if (typeof val === 'number' && isFinite(val)) return val;
  if (val === null || val === undefined) return 0;
  if (val?.amount !== undefined) return Number(val.amount) || 0;
  if (val?.value !== undefined) return Number(val.value) || 0;
  const parsed = Number(val);
  return isFinite(parsed) ? parsed : 0;
};

// Format currency
const formatCurrency = (value: number, includeSign = false): string => {
  const formatted = `$${Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (includeSign) {
    return value >= 0 ? `+${formatted}` : `-${formatted}`;
  }
  return formatted;
};

// Format delta (3 decimal places)
const formatDelta = (value: number): string => {
  return value.toFixed(3);
};

// Helper to parse and format IBKR option symbols
const formatOptionSymbol = (symbol: string, assetType?: 'option' | 'stock'): string => {
  if (!symbol) return '-';

  // Stocks: return symbol directly
  if (assetType === 'stock') return symbol;

  // Match pattern: SYMBOL + whitespace + YYMMDD + P/C + strike (in cents)
  const match = symbol.match(/^([A-Z]+)\s+(\d{2})(\d{2})(\d{2})([PC])(\d+)$/);
  if (!match) return symbol;

  const [, underlying, , mm, dd, , strikeRaw] = match;
  const strike = parseInt(strikeRaw) / 1000;

  return `${underlying} ${mm}/${dd} $${strike}`;
};

export function PositionQuickView() {
  // Load collapsed state from localStorage
  const [isCollapsed, setIsCollapsed] = useState(() => {
    const saved = localStorage.getItem('positionQuickView-collapsed');
    return saved !== null ? saved === 'true' : true; // Default to collapsed
  });

  // Persist collapsed state to localStorage
  useEffect(() => {
    localStorage.setItem('positionQuickView-collapsed', String(isCollapsed));
  }, [isCollapsed]);

  // Fetch positions
  const { data: positions } = useQuery<Position[]>({
    queryKey: ['/api/positions'],
    queryFn: getPositions,
    refetchInterval: false, // Manual refresh only (expensive IBKR API calls)
  });

  // Calculate aggregated metrics
  const metrics = useMemo(() => {
    if (!positions || positions.length === 0) {
      return {
        netDelta: 0,
        totalPnL: 0,
        positionCount: 0,
      };
    }

    let netDelta = 0;
    let totalPnL = 0;

    positions.forEach(p => {
      const qty = Math.abs(toNum(p.qty));

      // Accumulate P&L
      totalPnL += toNum(p.upl);

      // Calculate delta
      if (p.assetType === 'stock') {
        // Stocks: delta = qty (or -qty for short)
        const stockDelta = p.side === 'SELL' ? -qty : qty;
        netDelta += stockDelta;
      } else {
        // Options: use IBKR delta if available, otherwise estimate
        const ibkrDelta = toNum(p.delta);
        if (ibkrDelta !== 0) {
          // IBKR provides per-contract delta, multiply by quantity
          netDelta += ibkrDelta * qty * (p.side === 'SELL' ? -1 : 1);
        }
      }
    });

    return {
      netDelta,
      totalPnL,
      positionCount: positions.length,
    };
  }, [positions]);

  const toggleCollapse = () => setIsCollapsed(!isCollapsed);

  // If no positions, don't show anything
  if (!positions || positions.length === 0) {
    return null;
  }

  return (
    <div className="border-t border-white/10 bg-charcoal">
      {/* Collapsed: Single line summary */}
      {isCollapsed ? (
        <button
          onClick={toggleCollapse}
          className="w-full px-6 py-2 flex items-center justify-between hover:bg-white/5 transition-colors"
        >
          <div className="flex items-center gap-6 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-silver">Net Delta:</span>
              <span className={`font-medium ${metrics.netDelta >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {formatDelta(metrics.netDelta)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-silver">P&L:</span>
              <span className={`font-medium ${metrics.totalPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {formatCurrency(metrics.totalPnL, true)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-silver">{metrics.positionCount} position{metrics.positionCount !== 1 ? 's' : ''} open</span>
            </div>
          </div>
          <ChevronUp className="w-4 h-4 text-silver" />
        </button>
      ) : (
        /* Expanded: Mini-table */
        <div className="px-6 py-3">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium">Open Positions</h3>
            <button
              onClick={toggleCollapse}
              className="flex items-center gap-1 text-sm text-silver hover:text-white transition-colors"
            >
              <ChevronDown className="w-4 h-4" />
              Hide
            </button>
          </div>

          {/* Mini-table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left py-2 px-2 text-silver text-xs font-medium">Symbol</th>
                  <th className="text-right py-2 px-2 text-silver text-xs font-medium">P&L</th>
                  <th className="text-right py-2 px-2 text-silver text-xs font-medium">Delta</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((pos) => {
                  const pnl = toNum(pos.upl);
                  const qty = Math.abs(toNum(pos.qty));

                  // Calculate delta for display
                  let delta = 0;
                  if (pos.assetType === 'stock') {
                    delta = pos.side === 'SELL' ? -qty : qty;
                  } else {
                    const ibkrDelta = toNum(pos.delta);
                    if (ibkrDelta !== 0) {
                      delta = ibkrDelta * qty * (pos.side === 'SELL' ? -1 : 1);
                    }
                  }

                  return (
                    <tr key={pos.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="py-2 px-2 font-medium">
                        {formatOptionSymbol(pos.symbol, pos.assetType)}
                      </td>
                      <td className={`py-2 px-2 text-right tabular-nums font-medium ${
                        pnl >= 0 ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {formatCurrency(pnl, true)}
                      </td>
                      <td className={`py-2 px-2 text-right tabular-nums ${
                        delta >= 0 ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {formatDelta(delta)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {/* Footer row with totals */}
              <tfoot>
                <tr className="border-t border-white/10 font-semibold">
                  <td className="py-2 px-2 text-white">TOTAL</td>
                  <td className={`py-2 px-2 text-right tabular-nums ${
                    metrics.totalPnL >= 0 ? 'text-green-400' : 'text-red-400'
                  }`}>
                    {formatCurrency(metrics.totalPnL, true)}
                  </td>
                  <td className={`py-2 px-2 text-right tabular-nums ${
                    metrics.netDelta >= 0 ? 'text-green-400' : 'text-red-400'
                  }`}>
                    {formatDelta(metrics.netDelta)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
