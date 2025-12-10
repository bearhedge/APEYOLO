import { useQuery } from '@tanstack/react-query';
import { getPositions } from '@/lib/api';
import { DataTable } from '@/components/DataTable';
import { LeftNav } from '@/components/LeftNav';
import { StatCard } from '@/components/StatCard';
import { DollarSign, TrendingUp, Shield, ArrowUpDown, Wallet, Banknote, BarChart3, Scale, Gauge } from 'lucide-react';
import type { Position } from '@shared/types';

// Universal type coercion helper - handles strings, nulls, objects from IBKR
const toNum = (val: any): number => {
  if (typeof val === 'number' && isFinite(val)) return val;
  if (val === null || val === undefined) return 0;
  // Handle IBKR's {amount: "value"} or {value: X} patterns
  if (val?.amount !== undefined) return Number(val.amount) || 0;
  if (val?.value !== undefined) return Number(val.value) || 0;
  const parsed = Number(val);
  return isFinite(parsed) ? parsed : 0;
};

interface AccountInfo {
  accountNumber: string;
  buyingPower: number;
  portfolioValue: number;
  netDelta: number;
  dayPnL: number;
  marginUsed: number;
  // Enhanced fields
  totalCash: number;
  settledCash: number;
  grossPositionValue: number;
  maintenanceMargin: number;
  cushion: number;
  leverage: number;
  excessLiquidity: number;
}

// Helper to format currency values - handles strings, nulls, objects
const formatCurrency = (value: any, includeSign = false): string => {
  const num = toNum(value);
  if (value === null || value === undefined) return '-';
  const formatted = `$${Math.abs(num).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (includeSign) {
    return num >= 0 ? `+${formatted}` : `-${formatted.substring(1)}`;
  }
  return formatted;
};

// Helper to format percentage values - handles strings, nulls, objects
const formatPercent = (value: any): string => {
  if (value === null || value === undefined) return '-';
  return `${toNum(value).toFixed(1)}%`;
};

// Helper to format multiplier values - handles strings, nulls, objects
const formatMultiplier = (value: any): string => {
  if (value === null || value === undefined) return '-';
  return `${toNum(value).toFixed(2)}x`;
};

// Helper to format delta values - handles strings, nulls, objects
const formatDelta = (value: any): string => {
  if (value === null || value === undefined) return '-';
  return toNum(value).toFixed(2);
};

// Helper to parse and format IBKR option symbols
// Input: "ARM   241212P00135000" -> Output: "ARM 12/12 $135 PUT"
const formatOptionSymbol = (symbol: string): string => {
  if (!symbol) return '-';

  // Match pattern: SYMBOL + whitespace + YYMMDD + P/C + strike (in cents)
  const match = symbol.match(/^([A-Z]+)\s+(\d{2})(\d{2})(\d{2})([PC])(\d+)$/);
  if (!match) return symbol; // Return as-is if doesn't match option pattern

  const [, underlying, yy, mm, dd, type, strikeRaw] = match;
  const strike = parseInt(strikeRaw) / 1000; // Convert from cents
  const optType = type === 'P' ? 'PUT' : 'CALL';

  return `${underlying} ${mm}/${dd} $${strike} ${optType}`;
};

export function Portfolio() {
  const { data: positions } = useQuery<Position[]>({
    queryKey: ['/api/positions'],
    queryFn: getPositions,
  });

  const { data: account, isLoading: accountLoading, isError: accountError, refetch: refetchAccount } = useQuery<AccountInfo>({
    queryKey: ['/api/account'],
    queryFn: async () => {
      const res = await fetch('/api/account', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch account');
      return res.json();
    },
    refetchInterval: 30000, // Refresh every 30s
    retry: 2, // Retry twice before giving up
  });

  // Positions table columns - all fields use accessor functions to avoid object rendering
  const columns = [
    { header: 'Symbol', accessor: (row: Position) => formatOptionSymbol(row.symbol || ''), sortable: true },
    { header: 'Side', accessor: (row: Position) => row.side === 'SELL' ? 'SHORT' : 'LONG', className: 'text-silver' },
    { header: 'Qty', accessor: (row: Position) => String(toNum(row.qty)), sortable: true, className: 'tabular-nums' },
    { header: 'Entry', accessor: (row: Position) => `$${toNum(row.avg).toFixed(2)}`, className: 'tabular-nums' },
    { header: 'Mark', accessor: (row: Position) => `$${toNum(row.mark).toFixed(2)}`, className: 'tabular-nums' },
    {
      header: 'P/L (USD)',
      accessor: (row: Position) => {
        const upl = toNum(row.upl);
        const isProfit = upl >= 0;
        return (
          <span className={isProfit ? 'text-green-400 font-medium' : 'text-red-400 font-medium'}>
            {isProfit ? '+' : ''}{formatCurrency(upl)}
          </span>
        );
      },
      className: 'tabular-nums'
    },
    { header: 'Delta', accessor: (row: Position) => formatDelta(row.delta), className: 'tabular-nums text-silver' },
    { header: 'Margin', accessor: (row: Position) => toNum(row.margin) > 0 ? formatCurrency(row.margin) : '-', className: 'tabular-nums text-silver' },
  ];

  return (
    <div className="flex h-[calc(100vh-64px)]">
      <LeftNav />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="mb-6">
          <h1 className="text-3xl font-bold tracking-wide">Portfolio</h1>
          <p className="text-silver text-sm mt-1">
            {accountError
              ? 'Connection error - unable to load account'
              : account?.accountNumber
                ? `Account: ${account.accountNumber}`
                : 'Loading account data...'}
          </p>
        </div>

        {/* IBKR Connection Error Alert */}
        {accountError && (
          <div className="bg-red-900/20 border border-red-500/50 p-4 rounded-lg flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-red-400 font-medium">IBKR Connection Error</span>
              <span className="text-silver text-sm">Unable to fetch account data. The SSO session may have expired.</span>
            </div>
            <button
              onClick={() => refetchAccount()}
              className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded text-sm font-medium transition-colors"
            >
              Retry Connection
            </button>
          </div>
        )}

        {/* Account Summary Cards - Row 1: Core Values */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <StatCard
            label="Portfolio Value"
            value={accountError ? '--' : accountLoading ? 'Loading...' : formatCurrency(account?.portfolioValue)}
            icon={<TrendingUp className="w-5 h-5 text-blue-500" />}
            testId="portfolio-value"
          />
          <StatCard
            label="Buying Power"
            value={accountError ? '--' : accountLoading ? 'Loading...' : formatCurrency(account?.buyingPower)}
            icon={<DollarSign className="w-5 h-5 text-green-500" />}
            testId="buying-power"
          />
          <StatCard
            label="Total Cash"
            value={accountError ? '--' : accountLoading ? 'Loading...' : formatCurrency(account?.totalCash)}
            icon={<Wallet className="w-5 h-5 text-emerald-500" />}
            testId="total-cash"
          />
          <StatCard
            label="Settled Cash"
            value={accountError ? '--' : accountLoading ? 'Loading...' : formatCurrency(account?.settledCash)}
            icon={<Banknote className="w-5 h-5 text-teal-500" />}
            testId="settled-cash"
          />
          <StatCard
            label="Day P&L"
            value={accountError ? '--' : accountLoading ? 'Loading...' : formatCurrency(account?.dayPnL, true)}
            icon={<ArrowUpDown className={`w-5 h-5 ${(account?.dayPnL ?? 0) >= 0 ? 'text-green-500' : 'text-red-500'}`} />}
            testId="day-pnl"
          />
        </div>

        {/* Account Summary Cards - Row 2: Margin & Risk */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <StatCard
            label="Position Value"
            value={accountError ? '--' : accountLoading ? 'Loading...' : formatCurrency(account?.grossPositionValue)}
            icon={<BarChart3 className="w-5 h-5 text-indigo-500" />}
            testId="position-value"
          />
          <StatCard
            label="Initial Margin"
            value={accountError ? '--' : accountLoading ? 'Loading...' : formatCurrency(account?.marginUsed)}
            icon={<Shield className="w-5 h-5 text-yellow-500" />}
            testId="margin-used"
          />
          <StatCard
            label="Maint. Margin"
            value={accountError ? '--' : accountLoading ? 'Loading...' : formatCurrency(account?.maintenanceMargin)}
            icon={<Shield className="w-5 h-5 text-orange-500" />}
            testId="maint-margin"
          />
          <StatCard
            label="Cushion"
            value={accountError ? '--' : accountLoading ? 'Loading...' : formatPercent(account?.cushion)}
            icon={<Gauge className={`w-5 h-5 ${(account?.cushion ?? 100) > 50 ? 'text-green-500' : (account?.cushion ?? 100) > 20 ? 'text-yellow-500' : 'text-red-500'}`} />}
            testId="cushion"
          />
          <StatCard
            label="Leverage"
            value={accountError ? '--' : accountLoading ? 'Loading...' : formatMultiplier(account?.leverage)}
            icon={<Scale className={`w-5 h-5 ${(account?.leverage ?? 0) < 2 ? 'text-green-500' : (account?.leverage ?? 0) < 4 ? 'text-yellow-500' : 'text-red-500'}`} />}
            testId="leverage"
          />
        </div>

        {/* Open Positions */}
        <div className="bg-charcoal rounded-2xl p-6 border border-white/10 shadow-lg">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Open Positions</h3>
            <span className="text-sm text-silver">{positions?.length || 0} positions</span>
          </div>
          {positions && positions.length > 0 ? (
            <DataTable
              data={positions}
              columns={columns}
              testId="table-portfolio-positions"
            />
          ) : (
            <div className="text-center py-12">
              <p className="text-silver">No open positions</p>
              <p className="text-silver text-sm mt-1">Positions will appear here when you have active trades</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
