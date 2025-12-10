import { useMemo } from 'react';
import { useQuery, useQueries } from '@tanstack/react-query';
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

// Helper to format percentage values - handles strings, nulls, objects (3 decimal places)
const formatPercent = (value: any): string => {
  if (value === null || value === undefined) return '-';
  return `${toNum(value).toFixed(3)}%`;
};

// Helper to format multiplier values - handles strings, nulls, objects (3 decimal places)
const formatMultiplier = (value: any): string => {
  if (value === null || value === undefined) return '-';
  return `${toNum(value).toFixed(3)}x`;
};

// Helper to format delta values - handles strings, nulls, objects
const formatDelta = (value: any): string => {
  if (value === null || value === undefined) return '-';
  return toNum(value).toFixed(2);
};

// Standard normal CDF approximation (Abramowitz and Stegun)
const normalCDF = (x: number): number => {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);

  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1.0 + sign * y);
};

// Extract underlying symbol from option symbol
// Input: "ARM   241212P00135000" -> Output: "ARM"
const getUnderlyingSymbol = (optionSymbol: string): string | null => {
  const match = optionSymbol.match(/^([A-Z]+)\s+/);
  return match ? match[1] : null;
};

// Black-Scholes delta estimation for options
// Requires the actual underlying price to calculate correctly
const estimateDelta = (position: Position, underlyingPrice: number): number | null => {
  if (!underlyingPrice || underlyingPrice <= 0) return null;

  // Parse option symbol to extract strike and type
  const symbol = position.symbol || '';
  const match = symbol.match(/^([A-Z]+)\s+(\d{2})(\d{2})(\d{2})([PC])(\d+)$/);
  if (!match) return null; // Not an option

  const [, , yy, mm, dd, optionType, strikeRaw] = match;
  const strike = parseInt(strikeRaw) / 1000;
  const isCall = optionType === 'C';

  // Calculate time to expiration
  const now = new Date();
  const expYear = 2000 + parseInt(yy);
  const expMonth = parseInt(mm) - 1;
  const expDay = parseInt(dd);
  const expDate = new Date(expYear, expMonth, expDay, 16, 0, 0); // 4 PM ET

  const timeToExpiry = Math.max((expDate.getTime() - now.getTime()) / (365.25 * 24 * 60 * 60 * 1000), 0.001);

  // Use position IV if available, otherwise default to 30%
  const iv = toNum(position.iv) > 0 ? toNum(position.iv) : 0.30;

  // Risk-free rate (approximate)
  const r = 0.05;

  // Black-Scholes d1 calculation
  const d1 = (Math.log(underlyingPrice / strike) + (r + (iv * iv) / 2) * timeToExpiry) / (iv * Math.sqrt(timeToExpiry));

  // Delta calculation
  let delta = normalCDF(d1);
  if (!isCall) {
    delta = delta - 1; // Put delta (negative for long puts)
  }

  // Adjust for short position (SELL) - flip the sign
  if (position.side === 'SELL') {
    delta = -delta;
  }

  return delta;
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

  // Get unique underlying symbols from positions
  const underlyingSymbols = useMemo(() => {
    if (!positions) return [];
    const symbols = new Set<string>();
    positions.forEach(p => {
      const underlying = getUnderlyingSymbol(p.symbol || '');
      if (underlying) symbols.add(underlying);
    });
    return Array.from(symbols);
  }, [positions]);

  // Fetch market data for each underlying symbol
  const underlyingQueries = useQueries({
    queries: underlyingSymbols.map(symbol => ({
      queryKey: ['/api/broker/test-market', symbol],
      queryFn: async () => {
        const res = await fetch(`/api/broker/test-market/${symbol}`, { credentials: 'include' });
        if (!res.ok) return null;
        const data = await res.json();
        return { symbol, price: data?.data?.price || 0 };
      },
      refetchInterval: 10000, // Refresh every 10s
      staleTime: 5000,
    })),
  });

  // Build a map of underlying symbol -> price
  const underlyingPrices = useMemo(() => {
    const prices: Record<string, number> = {};
    underlyingQueries.forEach(q => {
      if (q.data?.symbol && q.data?.price > 0) {
        prices[q.data.symbol] = q.data.price;
      }
    });
    return prices;
  }, [underlyingQueries]);

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
    {
      header: 'Delta',
      accessor: (row: Position) => {
        // Use IBKR delta if available and non-zero
        const ibkrDelta = toNum(row.delta);
        if (ibkrDelta !== 0) return formatDelta(ibkrDelta);

        // Otherwise estimate via Black-Scholes using actual underlying price
        const underlying = getUnderlyingSymbol(row.symbol || '');
        const underlyingPrice = underlying ? underlyingPrices[underlying] : 0;
        const estimated = estimateDelta(row, underlyingPrice);
        return estimated !== null ? formatDelta(estimated) : '-';
      },
      className: 'tabular-nums text-silver'
    },
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
