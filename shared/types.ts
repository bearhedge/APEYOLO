export type Position = {
  id: string;
  symbol: string;
  assetType: 'option' | 'stock';
  side: 'BUY' | 'SELL';
  qty: number;
  avg: number;
  mark: number;
  upl: number;
  iv: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  margin: number;
  openedAt: string;
  status?: 'OPEN' | 'CLOSED' | 'EXPIRED' | 'EXERCISED';
};

export type PnlRow = {
  tradeId: string;
  ts: string;
  symbol: string;
  strategy: string;
  side: 'BUY' | 'SELL';
  qty: number;
  entry: number;
  exit?: number;
  fees: number;
  realized: number;
  run: number;
  notes?: string;
};

export type DiagEntry = {
  status: number | null;
  ts: string;
};

export type BrokerDiag = {
  provider: string;
  env: string;
  last: {
    oauth: DiagEntry;
    sso: DiagEntry;
    validate: DiagEntry;
    init: DiagEntry;
  };
  // Shorthand accessors for top-level status
  oauth?: number | null;
  sso?: number | null;
};

// Legacy type - kept for backwards compatibility
export type BrokerStatus = {
  oauth: number | null;
  sso: number | null;
  init: number | null;
  traceId?: string;
};

export type RiskCfg = {
  aggression: number;
  maxLev: number;
  perTradeRiskPct: number;
  dailyLossPct: number;
  maxPositions: number;
  maxNotional: number;
  autoRoll: boolean;
  autoHedge: boolean;
  marketHoursOnly: boolean;
  circuitBreaker: boolean;
};

export type Withdrawal = {
  id: string;
  date: string;
  amount: number;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
};

export type DashboardData = {
  nav: number;
  cash: number;
  lev: number;
  marginAvailable: number;
  navHistory: number[];
  positions: Position[];
  history: Position[];
  withdrawals: Withdrawal[];
};

export type TradeRequest = {
  symbol: string;
  strategy: string;
  qty: number;
};

export type AgentConfig = {
  model: string;
  apiKey: string;
  systemPrompt: string;
  strategyPreset: 'wheel' | 'covered-calls' | 'cash-secured-puts';
  banList: string[];
  minLiquidity: number;
  minPremium: number;
};

export type NotificationConfig = {
  email: string;
  slack: string;
  webhook: string;
  fills: boolean;
  errors: boolean;
  riskBreaches: boolean;
  dailySummary: boolean;
};

export type GeneralSettings = {
  baseCurrency: string;
  timezone: string;
  numberFormat: string;
};
