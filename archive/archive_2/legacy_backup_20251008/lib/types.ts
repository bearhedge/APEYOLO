// AccountInfo now exported from @shared/schema
export type { AccountInfo, OptionChainData } from "@shared/schema";

export type DashboardMetrics = {
  portfolioValue: number;
  openPositions: number;
  netDelta: number;
  dayPnL: number;
  weekPnL: number;
  monthPnL: number;
  winRate: number;
  avgHoldTime: string;
  capitalUtilization: number;
  spyAllocation: number;
  weeklyAllocation: number;
  maxDeltaExposure: number;
};

export type RecentTrade = {
  id: string;
  symbol: string;
  strategy: string;
  strikes: string;
  credit: number;
  pnl: number;
  time: string;
};

export type TradeMode = 'spy-0dte' | 'weekly-singles';

export type FilterConfig = {
  symbol: string;
  expiration: string;
  deltaRange: string;
  minOI: number;
};
