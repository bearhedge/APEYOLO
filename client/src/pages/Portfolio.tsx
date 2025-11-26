import { useQuery } from '@tanstack/react-query';
import { getPositions } from '@/lib/api';
import { DataTable } from '@/components/DataTable';
import { LeftNav } from '@/components/LeftNav';
import { StatCard } from '@/components/StatCard';
import { DollarSign, TrendingUp, Shield, Activity } from 'lucide-react';
import type { Position } from '@shared/types';

interface AccountInfo {
  accountNumber: string;
  buyingPower: number;
  portfolioValue: number;
  netDelta: number;
  dayPnL: number;
  marginUsed: number;
}

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
            {account?.accountNumber ? `Account: ${account.accountNumber}` : 'Account overview and positions'}
          </p>
        </div>

        {/* Account Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <StatCard
            label="Buying Power"
            value={accountLoading ? 'Loading...' : `$${(account?.buyingPower ?? 0).toLocaleString()}`}
            icon={<DollarSign className="w-5 h-5 text-green-500" />}
            testId="buying-power"
          />
          <StatCard
            label="Portfolio Value"
            value={accountLoading ? 'Loading...' : `$${(account?.portfolioValue ?? 0).toLocaleString()}`}
            icon={<TrendingUp className="w-5 h-5 text-blue-500" />}
            testId="portfolio-value"
          />
          <StatCard
            label="Margin Used"
            value={accountLoading ? 'Loading...' : `$${(account?.marginUsed ?? 0).toLocaleString()}`}
            icon={<Shield className="w-5 h-5 text-yellow-500" />}
            testId="margin-used"
          />
          <StatCard
            label="Net Delta"
            value={accountLoading ? 'Loading...' : (account?.netDelta ?? 0).toFixed(2)}
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
