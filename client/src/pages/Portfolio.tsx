import { useQuery } from '@tanstack/react-query';
import { getPositions } from '@/lib/api';
import { DataTable } from '@/components/DataTable';
import { LeftNav } from '@/components/LeftNav';
import { StatCard } from '@/components/StatCard';
import { DollarSign, TrendingUp, Shield, Activity, ArrowUpDown, Wallet, Banknote, BarChart3, Scale, Gauge } from 'lucide-react';
import type { Position } from '@shared/types';

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

// Helper to format currency values, showing "-" for null/undefined
const formatCurrency = (value: number | null | undefined, includeSign = false): string => {
  if (value === null || value === undefined) return '-';
  const formatted = `$${Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (includeSign) {
    return value >= 0 ? `+${formatted}` : `-${formatted.substring(1)}`;
  }
  return formatted;
};

// Helper to format percentage values, showing "-" for null/undefined
const formatPercent = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return '-';
  return `${value.toFixed(1)}%`;
};

// Helper to format multiplier values, showing "-" for null/undefined
const formatMultiplier = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return '-';
  return `${value.toFixed(2)}x`;
};

// Helper to format delta values, showing "-" for null/undefined
const formatDelta = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return '-';
  return value.toFixed(2);
};

export function Portfolio() {
  const { data: positions } = useQuery<Position[]>({
    queryKey: ['/api/positions'],
    queryFn: getPositions,
  });

  const { data: account, isLoading: accountLoading } = useQuery<AccountInfo>({
    queryKey: ['/api/account'],
    queryFn: async () => {
      const res = await fetch('/api/account', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch account');
      return res.json();
    },
    refetchInterval: 30000, // Refresh every 30s
  });

  const columns = [
    { header: 'Symbol', accessor: 'symbol' as keyof Position, sortable: true },
    { header: 'Strategy', accessor: (row: Position) => row.side === 'SELL' ? 'Credit Spread' : 'Long', className: 'text-silver' },
    { header: 'Qty', accessor: 'qty' as keyof Position, sortable: true, className: 'tabular-nums' },
    { header: 'Entry', accessor: (row: Position) => `$${row.avg.toFixed(2)}`, className: 'tabular-nums' },
    { header: 'Mark', accessor: (row: Position) => `$${row.mark.toFixed(2)}`, className: 'tabular-nums' },
    { 
      header: 'P/L$', 
      accessor: (row: Position) => {
        const isProfit = row.upl >= 0;
        return (
          <span className={isProfit ? 'font-medium' : 'font-medium'}>
            {isProfit ? '+' : ''}${row.upl.toFixed(2)}
          </span>
        );
      },
      className: 'tabular-nums'
    },
    { header: 'Delta', accessor: (row: Position) => row.delta?.toFixed(2) || '-', className: 'tabular-nums text-silver' },
    { header: 'Margin', accessor: (row: Position) => `$${row.margin?.toLocaleString() || '0'}`, className: 'tabular-nums text-silver' },
  ];

  return (
    <div className="flex h-[calc(100vh-64px)]">
      <LeftNav />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="mb-6">
          <h1 className="text-3xl font-bold tracking-wide">Portfolio</h1>
          <p className="text-silver text-sm mt-1">
            {account?.accountNumber ? `Account: ${account.accountNumber}` : 'Loading account data...'}
          </p>
        </div>

        {/* Account Summary Cards - Row 1: Core Values */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <StatCard
            label="Portfolio Value"
            value={accountLoading ? 'Loading...' : formatCurrency(account?.portfolioValue)}
            icon={<TrendingUp className="w-5 h-5 text-blue-500" />}
            testId="portfolio-value"
          />
          <StatCard
            label="Buying Power"
            value={accountLoading ? 'Loading...' : formatCurrency(account?.buyingPower)}
            icon={<DollarSign className="w-5 h-5 text-green-500" />}
            testId="buying-power"
          />
          <StatCard
            label="Total Cash"
            value={accountLoading ? 'Loading...' : formatCurrency(account?.totalCash)}
            icon={<Wallet className="w-5 h-5 text-emerald-500" />}
            testId="total-cash"
          />
          <StatCard
            label="Settled Cash"
            value={accountLoading ? 'Loading...' : formatCurrency(account?.settledCash)}
            icon={<Banknote className="w-5 h-5 text-teal-500" />}
            testId="settled-cash"
          />
          <StatCard
            label="Day P&L"
            value={accountLoading ? 'Loading...' : formatCurrency(account?.dayPnL, true)}
            icon={<ArrowUpDown className={`w-5 h-5 ${(account?.dayPnL ?? 0) >= 0 ? 'text-green-500' : 'text-red-500'}`} />}
            testId="day-pnl"
          />
        </div>

        {/* Account Summary Cards - Row 2: Margin & Risk */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <StatCard
            label="Position Value"
            value={accountLoading ? 'Loading...' : formatCurrency(account?.grossPositionValue)}
            icon={<BarChart3 className="w-5 h-5 text-indigo-500" />}
            testId="position-value"
          />
          <StatCard
            label="Initial Margin"
            value={accountLoading ? 'Loading...' : formatCurrency(account?.marginUsed)}
            icon={<Shield className="w-5 h-5 text-yellow-500" />}
            testId="margin-used"
          />
          <StatCard
            label="Maint. Margin"
            value={accountLoading ? 'Loading...' : formatCurrency(account?.maintenanceMargin)}
            icon={<Shield className="w-5 h-5 text-orange-500" />}
            testId="maint-margin"
          />
          <StatCard
            label="Cushion"
            value={accountLoading ? 'Loading...' : formatPercent(account?.cushion)}
            icon={<Gauge className={`w-5 h-5 ${(account?.cushion ?? 100) > 50 ? 'text-green-500' : (account?.cushion ?? 100) > 20 ? 'text-yellow-500' : 'text-red-500'}`} />}
            testId="cushion"
          />
          <StatCard
            label="Leverage"
            value={accountLoading ? 'Loading...' : formatMultiplier(account?.leverage)}
            icon={<Scale className={`w-5 h-5 ${(account?.leverage ?? 0) < 2 ? 'text-green-500' : (account?.leverage ?? 0) < 4 ? 'text-yellow-500' : 'text-red-500'}`} />}
            testId="leverage"
          />
        </div>

        {/* Account Summary Cards - Row 3: Greeks */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <StatCard
            label="Net Delta"
            value={accountLoading ? 'Loading...' : formatDelta(account?.netDelta)}
            icon={<Activity className="w-5 h-5 text-purple-500" />}
            testId="net-delta"
          />
        </div>

        <div className="bg-charcoal rounded-2xl p-6 border border-white/10 shadow-lg">
          <h3 className="text-lg font-semibold mb-4">Open Positions</h3>
          {positions && positions.length > 0 ? (
            <DataTable
              data={positions}
              columns={columns}
              testId="table-portfolio-positions"
            />
          ) : (
            <div className="text-center py-12">
              <p className="text-silver">No open positions</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
