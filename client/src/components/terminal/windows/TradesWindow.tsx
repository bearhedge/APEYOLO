/**
 * TradesWindow - Trade history log
 *
 * Uses the detailed TradeLogTable component from DeFi page.
 */

import { useQuery } from '@tanstack/react-query';
import { TradeLogTable } from '../../defi/TradeLogTable';

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
  holdingMinutes?: number | null;
  outcome?: 'win' | 'loss' | 'breakeven' | 'open';
  entryNav?: number | null;
  premiumReceived?: number | null;
  costToClose?: number | null;
  openingNav?: number | null;
  closingNav?: number | null;
  navChange?: number | null;
  dailyReturnPct?: number | null;
  putNotionalHKD?: number | null;
  callNotionalHKD?: number | null;
  totalNotionalHKD?: number | null;
  spotPriceAtClose?: number | null;
  validationStatus?: 'verified' | 'pending' | 'discrepancy';
  marginRequired?: number | null;
  maxLoss?: number | null;
  entrySpy?: number | null;
  entryCommission?: number | null;
  exitCommission?: number | null;
  totalCommissions?: number | null;
  grossPnl?: number | null;
  netPnl?: number | null;
  solanaSignature?: string;
}

export function TradesWindow() {
  const { data: tradesResponse, isLoading, error } = useQuery<{ trades: Trade[]; count: number }>({
    queryKey: ['trades'],
    queryFn: async () => {
      const res = await fetch('/api/defi/trades?limit=100', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch trades');
      return res.json();
    },
    refetchInterval: 30000,
  });

  if (error) {
    return <p style={{ color: '#ef4444' }}>&gt; ERROR: Failed to load trades</p>;
  }

  const trades = tradesResponse?.trades || [];

  return (
    <div style={{ maxHeight: '100%', overflow: 'auto' }}>
      <TradeLogTable trades={trades} loading={isLoading} />
    </div>
  );
}
