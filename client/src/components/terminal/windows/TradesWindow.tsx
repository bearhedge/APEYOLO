/**
 * TradesWindow - Trade history log (Master source of truth)
 *
 * Shows all closed trades with full details:
 * - Entry/Exit times and holding period
 * - Symbol, Strategy, Strikes, Contracts
 * - Entry/Exit Premium
 * - P&L (absolute, % NAV, annualized)
 * - Exit Reason (Expired, Stopped Out, Exercised)
 * - Solana signature link (when available)
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Filter } from 'lucide-react';

// Trade interface matching API response from /api/defi/trades
interface Trade {
  id: string;
  date: string;              // YYYY-MM-DD
  dateFormatted: string;     // "Jan 24"
  symbol: string;
  strategy: string;          // "Strangle", "Short Put", "Short Call"
  contracts: number;
  putStrike: number | null;
  callStrike: number | null;
  entryPremium: number | null;   // HKD
  exitPremium: number | null;    // HKD
  entryTime: string | null;      // "9:32 AM ET"
  exitTime: string | null;       // "2:15 PM ET"
  status: string;                // "expired" | "stopped out" | "exercised"
  outcome: 'win' | 'loss' | 'breakeven' | 'open';
  exitReason: string | null;
  realizedPnlUSD: number;
  returnPercent: number;
  holdingMinutes: number | null;
  entryNav: number;
  solanaSignature?: string;
}

// Benchmark date: Jan 24, 2026 - public track record starts from this date
const BENCHMARK_DATE = '2026-01-24';

type FilterMode = 'all' | 'since_benchmark' | 'mtd' | 'ytd';

export function TradesWindow() {
  const [filterMode, setFilterMode] = useState<FilterMode>('since_benchmark');

  const { data: tradesResponse, isLoading, error } = useQuery<{ trades: Trade[]; count: number }>({
    queryKey: ['trades'],
    queryFn: async () => {
      const res = await fetch('/api/defi/trades?limit=100', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch trades');
      const data = await res.json();
      return data;
    },
    refetchInterval: 30000,
  });

  if (isLoading) {
    return <p style={{ color: '#666' }}>&gt; Loading trade log...</p>;
  }

  if (error) {
    return <p style={{ color: '#ef4444' }}>&gt; ERROR: Failed to load trades</p>;
  }

  const allTrades = tradesResponse?.trades || [];

  if (allTrades.length === 0) {
    return (
      <div>
        <p>&gt; NO TRADES YET</p>
        <p style={{ marginTop: 12, color: '#666' }}>&gt; Your trade history will appear here.</p>
      </div>
    );
  }

  // Apply filter
  const filteredTrades = filterTrades(allTrades, filterMode);

  // Calculate summary stats for filtered trades (closed trades only)
  const closedTrades = filteredTrades.filter(t => t.status !== 'open');
  const totalPnl = closedTrades.reduce((sum, t) => sum + (t.realizedPnlUSD || 0), 0);
  const wins = closedTrades.filter(t => t.outcome === 'win').length;
  const winRate = closedTrades.length > 0 ? (wins / closedTrades.length) * 100 : 0;

  return (
    <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>
      {/* Summary Header */}
      <div style={{ marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid #333' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 20 }}>
            <span>
              P&L:{' '}
              <span style={{ color: totalPnl >= 0 ? '#4ade80' : '#ef4444', fontWeight: 600 }}>
                {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(0)}
              </span>
            </span>
            <span>
              Win Rate: <span style={{ color: '#fff', fontWeight: 600 }}>{winRate.toFixed(0)}%</span>
            </span>
            <span>
              Trades: <span style={{ color: '#fff', fontWeight: 600 }}>{closedTrades.length}</span>
            </span>
          </div>

          {/* Filter Toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Filter style={{ width: 12, height: 12, color: '#666' }} />
            <select
              value={filterMode}
              onChange={(e) => setFilterMode(e.target.value as FilterMode)}
              style={{
                background: '#111',
                border: '1px solid #333',
                color: '#fff',
                padding: '2px 6px',
                fontSize: 10,
                borderRadius: 2,
                cursor: 'pointer',
              }}
            >
              <option value="since_benchmark">Since Jan 24</option>
              <option value="mtd">MTD</option>
              <option value="ytd">YTD</option>
              <option value="all">All Time</option>
            </select>
          </div>
        </div>
      </div>

      {/* Column Headers */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '55px 50px 45px 80px 60px 30px 50px 90px 70px 20px',
          gap: 6,
          padding: '4px 0',
          borderBottom: '1px solid #333',
          color: '#666',
          fontSize: 9,
          textTransform: 'uppercase',
        }}
      >
        <span>Date</span>
        <span>Entry</span>
        <span>Exit</span>
        <span>Strategy</span>
        <span>Strikes</span>
        <span>#</span>
        <span>Held</span>
        <span style={{ textAlign: 'right' }}>P&L</span>
        <span>Status</span>
        <span></span>
      </div>

      {/* Trade List */}
      <div style={{ maxHeight: 280, overflow: 'auto' }}>
        {filteredTrades.map(trade => (
          <TradeRow key={trade.id} trade={trade} />
        ))}
      </div>
    </div>
  );
}

function filterTrades(trades: Trade[], mode: FilterMode): Trade[] {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  switch (mode) {
    case 'since_benchmark':
      return trades.filter(t => t.date >= BENCHMARK_DATE);
    case 'mtd': {
      const mtdStart = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-01`;
      return trades.filter(t => t.date >= mtdStart);
    }
    case 'ytd': {
      const ytdStart = `${currentYear}-01-01`;
      return trades.filter(t => t.date >= ytdStart);
    }
    case 'all':
    default:
      return trades;
  }
}

function formatHoldingTime(minutes: number | null): string {
  if (minutes === null || minutes === undefined) return '—';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours < 24) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

function calculateAnnualizedReturn(returnPercent: number, holdingMinutes: number | null): number | null {
  if (holdingMinutes === null || holdingMinutes <= 0) return null;
  const holdingDays = holdingMinutes / (60 * 24);
  if (holdingDays < 0.01) return null; // Too short to annualize meaningfully
  // Annualize: (1 + r)^(365/days) - 1
  const annualized = (Math.pow(1 + returnPercent / 100, 365 / holdingDays) - 1) * 100;
  // Cap at reasonable values for display
  if (Math.abs(annualized) > 10000) return annualized > 0 ? 10000 : -10000;
  return annualized;
}

function formatPnL(pnlUSD: number, returnPercent: number, annualized: number | null): string {
  const sign = pnlUSD >= 0 ? '+' : '';
  const pnlStr = `${sign}$${Math.abs(pnlUSD).toFixed(0)}`;
  const pctStr = `${sign}${returnPercent.toFixed(2)}%`;

  if (annualized !== null) {
    const annSign = annualized >= 0 ? '+' : '';
    const annStr = Math.abs(annualized) >= 1000
      ? `${annSign}${(annualized / 1000).toFixed(0)}k%`
      : `${annSign}${annualized.toFixed(0)}%`;
    return `${pnlStr} | ${pctStr} | ${annStr}`;
  }
  return `${pnlStr} | ${pctStr}`;
}

function getStatusDisplay(status: string): { text: string; color: string } {
  switch (status.toLowerCase()) {
    case 'expired':
      return { text: 'Expired', color: '#4ade80' }; // Green - full premium kept
    case 'stopped out':
      return { text: 'Stopped', color: '#f59e0b' }; // Orange - early exit
    case 'exercised':
      return { text: 'Exercised', color: '#ef4444' }; // Red - assignment
    case 'open':
      return { text: 'Open', color: '#3b82f6' }; // Blue - still active
    default:
      return { text: status, color: '#888' };
  }
}

function TradeRow({ trade }: { trade: Trade }) {
  const pnlColor = trade.realizedPnlUSD >= 0 ? '#4ade80' : '#ef4444';
  const statusDisplay = getStatusDisplay(trade.status);
  const annualized = calculateAnnualizedReturn(trade.returnPercent, trade.holdingMinutes);

  // Format strikes: "575P/595C" or "575P" for single leg
  const strikes = trade.putStrike
    ? (trade.callStrike ? `${trade.putStrike}P/${trade.callStrike}C` : `${trade.putStrike}P`)
    : (trade.callStrike ? `${trade.callStrike}C` : '—');

  // Extract just time portion (e.g., "9:32 AM" from "9:32 AM ET")
  const entryTime = trade.entryTime?.replace(' ET', '') || '—';
  const exitTime = trade.exitTime?.replace(' ET', '') || '—';

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '55px 50px 45px 80px 60px 30px 50px 90px 70px 20px',
        gap: 6,
        padding: '6px 0',
        borderBottom: '1px solid #1a1a1a',
        alignItems: 'center',
      }}
    >
      {/* Date */}
      <span style={{ color: '#888' }}>{trade.dateFormatted}</span>

      {/* Entry Time */}
      <span style={{ color: '#666', fontSize: 10 }}>{entryTime}</span>

      {/* Exit Time */}
      <span style={{ color: '#666', fontSize: 10 }}>{exitTime}</span>

      {/* Strategy */}
      <span style={{ color: '#fff' }}>{trade.strategy}</span>

      {/* Strikes */}
      <span style={{ color: '#87ceeb', fontSize: 10 }}>{strikes}</span>

      {/* Contracts */}
      <span style={{ color: '#666' }}>{trade.contracts}</span>

      {/* Holding Time */}
      <span style={{ color: '#666', fontSize: 10 }}>
        {formatHoldingTime(trade.holdingMinutes)}
      </span>

      {/* P&L (3-format) */}
      <span style={{ color: pnlColor, textAlign: 'right', fontSize: 10 }}>
        {formatPnL(trade.realizedPnlUSD, trade.returnPercent, annualized)}
      </span>

      {/* Status */}
      <span style={{ color: statusDisplay.color, fontSize: 10 }}>
        {statusDisplay.text}
      </span>

      {/* Solana Link */}
      <span>
        {trade.solanaSignature && (
          <a
            href={`https://explorer.solana.com/tx/${trade.solanaSignature}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#3b82f6' }}
            title="View on Solana"
          >
            <ExternalLink style={{ width: 10, height: 10 }} />
          </a>
        )}
      </span>
    </div>
  );
}
