import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getPNL } from '@/lib/api';
import { DataTable } from '@/components/DataTable';
import { LeftNav } from '@/components/LeftNav';
import { StatCard } from '@/components/StatCard';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  TrendingUp,
  TrendingDown,
  Trophy,
  Target,
  DollarSign,
  Percent,
  ArrowUpDown,
  ArrowDownUp,
  CalendarDays,
  PiggyBank,
  Wallet,
  Plus,
  ChevronDown,
  Scale,
  BarChart3,
  Banknote,
} from 'lucide-react';
import type { PnlRow } from '@shared/types';

// Time period filter type
type TimePeriod = '1m' | '3m' | '6m' | 'ytd' | 'all';

// Get date cutoff for time period filter
function getDateCutoff(period: TimePeriod): Date | null {
  if (period === 'all') return null;

  const now = new Date();
  switch (period) {
    case '1m':
      return new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    case '3m':
      return new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
    case '6m':
      return new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
    case 'ytd':
      return new Date(now.getFullYear(), 0, 1); // January 1st of current year
    default:
      return null;
  }
}

// Universal type coercion helper
const toNum = (val: any): number => {
  if (typeof val === 'number' && isFinite(val)) return val;
  if (val === null || val === undefined) return 0;
  if (val?.amount !== undefined) return Number(val.amount) || 0;
  if (val?.value !== undefined) return Number(val.value) || 0;
  const parsed = Number(val);
  return isFinite(parsed) ? parsed : 0;
};

// Cash flow transaction type
interface CashFlow {
  id: string;
  date: string;
  type: 'deposit' | 'withdrawal';
  amount: number;
  description: string;
}

// Format currency
const formatCurrency = (value: any, includeSign = false): string => {
  const num = toNum(value);
  if (value === null || value === undefined) return '-';
  const formatted = `$${Math.abs(num).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (includeSign) {
    return num >= 0 ? `+${formatted}` : `-${formatted.substring(1)}`;
  }
  return formatted;
};

// Format percentage
const formatPercent = (value: any): string => {
  if (value === null || value === undefined) return '-';
  return `${toNum(value).toFixed(1)}%`;
};

// Calculate trading KPIs from trade history
function calculateKPIs(trades: PnlRow[]) {
  if (!trades || trades.length === 0) {
    return {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      totalPnL: 0,
      totalWinnings: 0,
      totalLosses: 0,
      avgWin: 0,
      avgLoss: 0,
      profitFactor: 0,
      avgTradeReturn: 0,
      largestWin: 0,
      largestLoss: 0,
      avgHoldingTime: 0,
      consecutiveWins: 0,
      consecutiveLosses: 0,
      sharpeRatio: 0,
    };
  }

  const winningTrades = trades.filter((t) => toNum(t.realized) > 0);
  const losingTrades = trades.filter((t) => toNum(t.realized) < 0);
  const totalWinnings = winningTrades.reduce((sum, t) => sum + toNum(t.realized), 0);
  const totalLosses = Math.abs(losingTrades.reduce((sum, t) => sum + toNum(t.realized), 0));
  const totalPnL = trades.reduce((sum, t) => sum + toNum(t.realized), 0);

  // Calculate consecutive wins/losses
  let maxConsecWins = 0, maxConsecLosses = 0, currentWins = 0, currentLosses = 0;
  trades.forEach(t => {
    if (toNum(t.realized) > 0) {
      currentWins++;
      currentLosses = 0;
      maxConsecWins = Math.max(maxConsecWins, currentWins);
    } else if (toNum(t.realized) < 0) {
      currentLosses++;
      currentWins = 0;
      maxConsecLosses = Math.max(maxConsecLosses, currentLosses);
    }
  });

  // Calculate Sharpe Ratio (simplified - using daily returns)
  const returns = trades.map(t => toNum(t.realized));
  const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const variance = returns.length > 0
    ? returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length
    : 0;
  const stdDev = Math.sqrt(variance);
  const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0; // Annualized

  return {
    totalTrades: trades.length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    winRate: trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0,
    totalPnL,
    totalWinnings,
    totalLosses,
    avgWin: winningTrades.length > 0 ? totalWinnings / winningTrades.length : 0,
    avgLoss: losingTrades.length > 0 ? totalLosses / losingTrades.length : 0,
    profitFactor: totalLosses > 0 ? totalWinnings / totalLosses : totalWinnings > 0 ? Infinity : 0,
    avgTradeReturn: trades.length > 0 ? totalPnL / trades.length : 0,
    largestWin: winningTrades.length > 0 ? Math.max(...winningTrades.map(t => toNum(t.realized))) : 0,
    largestLoss: losingTrades.length > 0 ? Math.min(...losingTrades.map(t => toNum(t.realized))) : 0,
    consecutiveWins: maxConsecWins,
    consecutiveLosses: maxConsecLosses,
    sharpeRatio,
  };
}

export function TrackRecord() {
  const queryClient = useQueryClient();
  const [showAddFlow, setShowAddFlow] = useState(false);
  const [flowType, setFlowType] = useState<'deposit' | 'withdrawal'>('deposit');
  const [flowAmount, setFlowAmount] = useState('');
  const [flowDescription, setFlowDescription] = useState('');
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('all');

  // Fetch trade history
  const { data: trades } = useQuery<PnlRow[]>({
    queryKey: ['/api/pnl'],
    queryFn: getPNL,
  });

  // Fetch cash flows (deposits/withdrawals)
  const { data: cashFlows } = useQuery<CashFlow[]>({
    queryKey: ['/api/cashflows'],
    queryFn: async () => {
      try {
        const res = await fetch('/api/cashflows');
        if (!res.ok) return [];
        return res.json();
      } catch {
        return [];
      }
    },
  });

  // Fetch account info for NAV
  const { data: account } = useQuery<{ portfolioValue: number; totalCash: number }>({
    queryKey: ['/api/account'],
    queryFn: async () => {
      try {
        const res = await fetch('/api/account');
        if (!res.ok) return { portfolioValue: 0, totalCash: 0 };
        return res.json();
      } catch {
        return { portfolioValue: 0, totalCash: 0 };
      }
    },
  });

  // Add cash flow mutation
  const addCashFlow = useMutation({
    mutationFn: async (flow: Omit<CashFlow, 'id'>) => {
      const res = await fetch('/api/cashflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(flow),
      });
      if (!res.ok) throw new Error('Failed to add cash flow');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/cashflows'] });
      setShowAddFlow(false);
      setFlowAmount('');
      setFlowDescription('');
    },
  });

  // Filter trades by time period
  const filteredTrades = useMemo(() => {
    if (!trades || timePeriod === 'all') return trades || [];
    const cutoff = getDateCutoff(timePeriod);
    if (!cutoff) return trades || [];
    return trades.filter(t => new Date(t.ts) >= cutoff);
  }, [trades, timePeriod]);

  // Filter cash flows by time period
  const filteredCashFlows = useMemo(() => {
    if (!cashFlows || timePeriod === 'all') return cashFlows || [];
    const cutoff = getDateCutoff(timePeriod);
    if (!cutoff) return cashFlows || [];
    return cashFlows.filter(cf => new Date(cf.date) >= cutoff);
  }, [cashFlows, timePeriod]);

  // KPIs recalculate based on filtered trades
  const kpis = calculateKPIs(filteredTrades);

  // Calculate cash flow totals (filtered)
  const totalDeposits = (filteredCashFlows)
    .filter((f) => f.type === 'deposit')
    .reduce((sum, f) => sum + f.amount, 0);
  const totalWithdrawals = (filteredCashFlows)
    .filter((f) => f.type === 'withdrawal')
    .reduce((sum, f) => sum + f.amount, 0);
  const netCashFlow = totalDeposits - totalWithdrawals;

  // Time-weighted return approximation
  const nav = toNum(account?.portfolioValue);
  const timeWeightedReturn = netCashFlow > 0 ? ((nav - netCashFlow) / netCashFlow) * 100 : 0;

  // Fund-style metrics (TVPI, RVPI, DPI)
  // These use ALL-TIME cash flows for proper fund accounting
  const allDeposits = (cashFlows || [])
    .filter((f) => f.type === 'deposit')
    .reduce((sum, f) => sum + f.amount, 0);
  const allWithdrawals = (cashFlows || [])
    .filter((f) => f.type === 'withdrawal')
    .reduce((sum, f) => sum + f.amount, 0);

  // TVPI = (NAV + Total Distributions) / Total Paid-In Capital
  const tvpi = allDeposits > 0 ? (nav + allWithdrawals) / allDeposits : 0;
  // RVPI = NAV / Total Paid-In Capital (Residual value)
  const rvpi = allDeposits > 0 ? nav / allDeposits : 0;
  // DPI = Total Distributions / Total Paid-In Capital
  const dpi = allDeposits > 0 ? allWithdrawals / allDeposits : 0;

  const handleAddFlow = () => {
    const amount = parseFloat(flowAmount);
    if (isNaN(amount) || amount <= 0) return;

    addCashFlow.mutate({
      date: new Date().toISOString().split('T')[0],
      type: flowType,
      amount,
      description: flowDescription || (flowType === 'deposit' ? 'Deposit' : 'Withdrawal'),
    });
  };

  // Cash flow table columns
  const cashFlowColumns = [
    {
      header: 'Date',
      accessor: (row: CashFlow) => new Date(row.date).toLocaleDateString(),
      className: 'text-silver',
    },
    {
      header: 'Type',
      accessor: (row: CashFlow) => (
        <span className={row.type === 'deposit' ? 'text-green-400' : 'text-red-400'}>
          {row.type === 'deposit' ? 'Deposit' : 'Withdrawal'}
        </span>
      ),
    },
    {
      header: 'Amount',
      accessor: (row: CashFlow) => (
        <span className={row.type === 'deposit' ? 'text-green-400' : 'text-red-400'}>
          {row.type === 'deposit' ? '+' : '-'}{formatCurrency(row.amount)}
        </span>
      ),
      className: 'tabular-nums text-right',
    },
    { header: 'Description', accessor: (row: CashFlow) => row.description || '-', className: 'text-silver' },
  ];

  // Trade history columns (simplified)
  const tradeColumns = [
    { header: 'Time', accessor: (row: PnlRow) => new Date(row.ts).toLocaleString(), className: 'text-silver text-sm' },
    { header: 'Symbol', accessor: (row: PnlRow) => String(row.symbol || '-'), className: 'font-medium' },
    { header: 'Strategy', accessor: (row: PnlRow) => String(row.strategy || '-') },
    { header: 'Side', accessor: (row: PnlRow) => String(row.side || '-') },
    { header: 'Qty', accessor: (row: PnlRow) => String(row.qty ?? '-'), className: 'tabular-nums' },
    {
      header: 'P&L',
      accessor: (row: PnlRow) => (
        <span className={toNum(row.realized) >= 0 ? 'text-green-400' : 'text-red-400'}>
          {formatCurrency(row.realized, true)}
        </span>
      ),
      className: 'tabular-nums text-right',
    },
  ];

  return (
    <div className="flex h-[calc(100vh-64px)]">
      <LeftNav />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold tracking-wide">Track Record</h1>
            <p className="text-silver text-sm mt-1">Performance metrics, trade history & cash flows</p>
          </div>
          <div className="flex items-center gap-6">
            {/* Time Period Filter */}
            <div className="flex items-center gap-1 bg-charcoal border border-white/10 rounded-lg p-1">
              {(['1m', '3m', '6m', 'ytd', 'all'] as TimePeriod[]).map((period) => (
                <button
                  key={period}
                  onClick={() => setTimePeriod(period)}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                    timePeriod === period
                      ? 'bg-white text-black'
                      : 'text-silver hover:text-white'
                  }`}
                >
                  {period === 'ytd' ? 'YTD' : period === 'all' ? 'All' : period.toUpperCase()}
                </button>
              ))}
            </div>
            <div className="text-right">
              <p className="text-silver text-sm">Current NAV</p>
              <p className="text-2xl font-bold tabular-nums">{formatCurrency(nav)}</p>
            </div>
          </div>
        </div>

        {/* Primary KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <StatCard
            label="Total P&L"
            value={formatCurrency(kpis.totalPnL, true)}
            icon={kpis.totalPnL >= 0 ? <TrendingUp className="w-5 h-5 text-green-400" /> : <TrendingDown className="w-5 h-5 text-red-400" />}
          />
          <StatCard
            label="Win Rate"
            value={formatPercent(kpis.winRate)}
            icon={<Target className={`w-5 h-5 ${kpis.winRate >= 50 ? 'text-green-400' : 'text-yellow-400'}`} />}
          />
          <StatCard
            label="Profit Factor"
            value={kpis.profitFactor === Infinity ? '∞' : kpis.profitFactor.toFixed(2)}
            icon={<Trophy className={`w-5 h-5 ${kpis.profitFactor >= 1.5 ? 'text-green-400' : 'text-yellow-400'}`} />}
          />
          <StatCard
            label="Total Trades"
            value={kpis.totalTrades.toString()}
            icon={<ArrowUpDown className="w-5 h-5 text-electric" />}
          />
          <StatCard
            label="Sharpe Ratio"
            value={kpis.sharpeRatio.toFixed(2)}
            icon={<Percent className={`w-5 h-5 ${kpis.sharpeRatio >= 1 ? 'text-green-400' : 'text-yellow-400'}`} />}
          />
          <StatCard
            label="Time-Weighted Return"
            value={formatPercent(timeWeightedReturn)}
            icon={<CalendarDays className={`w-5 h-5 ${timeWeightedReturn >= 0 ? 'text-green-400' : 'text-red-400'}`} />}
          />
        </div>

        {/* Fund-Style Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-charcoal rounded-xl p-4 border border-white/10">
            <div className="flex items-center gap-2 mb-2">
              <Scale className="w-5 h-5 text-electric" />
              <span className="text-silver text-sm">TVPI</span>
              <span className="text-xs text-zinc-500 ml-auto">Total Value to Paid-In</span>
            </div>
            <p className={`text-3xl font-bold tabular-nums ${tvpi >= 1 ? 'text-green-400' : 'text-red-400'}`}>
              {tvpi.toFixed(2)}x
            </p>
            <p className="text-xs text-silver mt-1">(NAV + Distributions) / Capital</p>
          </div>
          <div className="bg-charcoal rounded-xl p-4 border border-white/10">
            <div className="flex items-center gap-2 mb-2">
              <BarChart3 className="w-5 h-5 text-blue-400" />
              <span className="text-silver text-sm">RVPI</span>
              <span className="text-xs text-zinc-500 ml-auto">Residual Value to Paid-In</span>
            </div>
            <p className={`text-3xl font-bold tabular-nums ${rvpi >= 1 ? 'text-green-400' : 'text-yellow-400'}`}>
              {rvpi.toFixed(2)}x
            </p>
            <p className="text-xs text-silver mt-1">NAV / Total Paid-In Capital</p>
          </div>
          <div className="bg-charcoal rounded-xl p-4 border border-white/10">
            <div className="flex items-center gap-2 mb-2">
              <Banknote className="w-5 h-5 text-green-400" />
              <span className="text-silver text-sm">DPI</span>
              <span className="text-xs text-zinc-500 ml-auto">Distributions to Paid-In</span>
            </div>
            <p className="text-3xl font-bold tabular-nums text-green-400">
              {dpi.toFixed(2)}x
            </p>
            <p className="text-xs text-silver mt-1">Total Withdrawals / Capital</p>
          </div>
        </div>

        {/* Tabbed Content */}
        <Tabs defaultValue="kpis" className="w-full">
          <TabsList className="bg-charcoal border border-white/10 mb-4">
            <TabsTrigger value="kpis" className="data-[state=active]:bg-white data-[state=active]:text-black">
              KPI Details
            </TabsTrigger>
            <TabsTrigger value="cashflows" className="data-[state=active]:bg-white data-[state=active]:text-black">
              Cash Flows
            </TabsTrigger>
            <TabsTrigger value="history" className="data-[state=active]:bg-white data-[state=active]:text-black">
              Trade History ({filteredTrades.length})
            </TabsTrigger>
          </TabsList>

          {/* KPI Details Tab */}
          <TabsContent value="kpis">
            <div className="bg-charcoal rounded-2xl p-6 border border-white/10 shadow-lg">
              <h3 className="text-lg font-semibold mb-6">Detailed Performance Metrics</h3>

              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                {/* Win/Loss Breakdown */}
                <div className="space-y-2">
                  <p className="text-silver text-sm">Winning Trades</p>
                  <p className="text-2xl font-bold text-green-400">{kpis.winningTrades}</p>
                </div>
                <div className="space-y-2">
                  <p className="text-silver text-sm">Losing Trades</p>
                  <p className="text-2xl font-bold text-red-400">{kpis.losingTrades}</p>
                </div>
                <div className="space-y-2">
                  <p className="text-silver text-sm">Total Winnings</p>
                  <p className="text-2xl font-bold text-green-400">{formatCurrency(kpis.totalWinnings)}</p>
                </div>
                <div className="space-y-2">
                  <p className="text-silver text-sm">Total Losses</p>
                  <p className="text-2xl font-bold text-red-400">{formatCurrency(kpis.totalLosses)}</p>
                </div>

                {/* Averages */}
                <div className="space-y-2">
                  <p className="text-silver text-sm">Average Win</p>
                  <p className="text-2xl font-bold text-green-400">{formatCurrency(kpis.avgWin)}</p>
                </div>
                <div className="space-y-2">
                  <p className="text-silver text-sm">Average Loss</p>
                  <p className="text-2xl font-bold text-red-400">{formatCurrency(kpis.avgLoss)}</p>
                </div>
                <div className="space-y-2">
                  <p className="text-silver text-sm">Avg Trade Return</p>
                  <p className={`text-2xl font-bold ${kpis.avgTradeReturn >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {formatCurrency(kpis.avgTradeReturn, true)}
                  </p>
                </div>
                <div className="space-y-2">
                  <p className="text-silver text-sm">Win/Loss Ratio</p>
                  <p className="text-2xl font-bold">{kpis.avgLoss > 0 ? (kpis.avgWin / kpis.avgLoss).toFixed(2) : '-'}</p>
                </div>

                {/* Extremes */}
                <div className="space-y-2">
                  <p className="text-silver text-sm">Largest Win</p>
                  <p className="text-2xl font-bold text-green-400">{formatCurrency(kpis.largestWin)}</p>
                </div>
                <div className="space-y-2">
                  <p className="text-silver text-sm">Largest Loss</p>
                  <p className="text-2xl font-bold text-red-400">{formatCurrency(kpis.largestLoss)}</p>
                </div>
                <div className="space-y-2">
                  <p className="text-silver text-sm">Max Consecutive Wins</p>
                  <p className="text-2xl font-bold text-green-400">{kpis.consecutiveWins}</p>
                </div>
                <div className="space-y-2">
                  <p className="text-silver text-sm">Max Consecutive Losses</p>
                  <p className="text-2xl font-bold text-red-400">{kpis.consecutiveLosses}</p>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Cash Flows Tab */}
          <TabsContent value="cashflows">
            <div className="bg-charcoal rounded-2xl p-6 border border-white/10 shadow-lg">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold">Deposits & Withdrawals</h3>
                <button
                  onClick={() => setShowAddFlow(!showAddFlow)}
                  className="flex items-center gap-2 px-4 py-2 bg-electric/20 text-electric rounded-lg hover:bg-electric/30 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Add Transaction
                  <ChevronDown className={`w-4 h-4 transition-transform ${showAddFlow ? 'rotate-180' : ''}`} />
                </button>
              </div>

              {/* Add Flow Form */}
              {showAddFlow && (
                <div className="mb-6 p-4 bg-white/5 rounded-xl border border-white/10">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div>
                      <label className="block text-sm text-silver mb-2">Type</label>
                      <select
                        value={flowType}
                        onChange={(e) => setFlowType(e.target.value as 'deposit' | 'withdrawal')}
                        className="w-full bg-black border border-white/20 rounded-lg px-3 py-2 text-white"
                      >
                        <option value="deposit">Deposit</option>
                        <option value="withdrawal">Withdrawal</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm text-silver mb-2">Amount ($)</label>
                      <input
                        type="number"
                        value={flowAmount}
                        onChange={(e) => setFlowAmount(e.target.value)}
                        placeholder="0.00"
                        className="w-full bg-black border border-white/20 rounded-lg px-3 py-2 text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-silver mb-2">Description</label>
                      <input
                        type="text"
                        value={flowDescription}
                        onChange={(e) => setFlowDescription(e.target.value)}
                        placeholder="Optional note"
                        className="w-full bg-black border border-white/20 rounded-lg px-3 py-2 text-white"
                      />
                    </div>
                    <div className="flex items-end">
                      <button
                        onClick={handleAddFlow}
                        disabled={addCashFlow.isPending}
                        className="w-full px-4 py-2 bg-electric text-black font-medium rounded-lg hover:bg-electric/90 transition-colors disabled:opacity-50"
                      >
                        {addCashFlow.isPending ? 'Adding...' : 'Add'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Cash Flow Summary */}
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-xl">
                  <div className="flex items-center gap-2 mb-2">
                    <PiggyBank className="w-5 h-5 text-green-400" />
                    <span className="text-silver text-sm">Total Deposits</span>
                  </div>
                  <p className="text-2xl font-bold text-green-400">{formatCurrency(totalDeposits)}</p>
                </div>
                <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl">
                  <div className="flex items-center gap-2 mb-2">
                    <Wallet className="w-5 h-5 text-red-400" />
                    <span className="text-silver text-sm">Total Withdrawals</span>
                  </div>
                  <p className="text-2xl font-bold text-red-400">{formatCurrency(totalWithdrawals)}</p>
                </div>
                <div className={`p-4 ${netCashFlow >= 0 ? 'bg-green-500/10 border-green-500/30' : 'bg-red-500/10 border-red-500/30'} border rounded-xl`}>
                  <div className="flex items-center gap-2 mb-2">
                    <DollarSign className={`w-5 h-5 ${netCashFlow >= 0 ? 'text-green-400' : 'text-red-400'}`} />
                    <span className="text-silver text-sm">Net Cash Flow</span>
                  </div>
                  <p className={`text-2xl font-bold ${netCashFlow >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {formatCurrency(netCashFlow, true)}
                  </p>
                </div>
              </div>

              {/* Cash Flow Table */}
              {cashFlows && cashFlows.length > 0 ? (
                <DataTable data={cashFlows} columns={cashFlowColumns} />
              ) : (
                <div className="text-center py-12">
                  <PiggyBank className="w-12 h-12 text-silver mx-auto mb-4" />
                  <p className="text-silver">No cash flows recorded yet</p>
                  <p className="text-silver text-sm mt-1">Add your deposits and withdrawals to track performance</p>
                </div>
              )}
            </div>
          </TabsContent>

          {/* Trade History Tab */}
          <TabsContent value="history">
            <div className="bg-charcoal rounded-2xl p-6 border border-white/10 shadow-lg">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">Trade Execution Log</h3>
                {timePeriod !== 'all' && (
                  <span className="text-sm text-silver">
                    Showing {timePeriod === 'ytd' ? 'YTD' : timePeriod.toUpperCase()} ({filteredTrades.length} of {trades?.length || 0} trades)
                  </span>
                )}
              </div>
              {filteredTrades.length > 0 ? (
                <DataTable data={filteredTrades} columns={tradeColumns} />
              ) : (
                <div className="text-center py-12">
                  <ArrowUpDown className="w-12 h-12 text-silver mx-auto mb-4" />
                  <p className="text-silver">No trades in this period</p>
                  <p className="text-silver text-sm mt-1">
                    {trades?.length ? 'Try selecting a different time period' : 'Your trade history will appear here'}
                  </p>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
