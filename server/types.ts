// Common types used across the application

export interface Greeks {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  iv: number;
}

export interface Contract {
  symbol: string;
  secType: 'STK' | 'OPT' | 'FUT' | 'CASH' | 'BOND' | 'CFD' | 'FOP' | 'WAR' | 'BAG' | 'NEWS';
  exchange?: string;
  currency?: string;
  strike?: number;
  right?: 'PUT' | 'CALL';
  expiry?: string;
  multiplier?: string;
  conId?: string;
  localSymbol?: string;
}

export interface Option {
  symbol: string;
  strike: number;
  right: 'PUT' | 'CALL';
  expiry: string;
  bid: number;
  ask: number;
  last: number;
  volume: number;
  openInterest: number;
  greeks?: Greeks;
  conId: string;
  impliedVolatility?: number;
}

export interface Position {
  contract: Contract;
  quantity: number;
  averageCost: number;
  marketValue: number;
  unrealizedPnL?: number;
  realizedPnL?: number;
}

export interface Order {
  orderId?: string;
  symbol: string;
  quantity: number;
  side: 'BUY' | 'SELL';
  orderType: 'MARKET' | 'LIMIT' | 'STOP' | 'STOP_LIMIT';
  limitPrice?: number;
  stopPrice?: number;
  timeInForce: 'DAY' | 'GTC' | 'IOC' | 'FOK';
  contract?: Contract;
}

export interface OrderStatus {
  orderId: string;
  status: 'PENDING' | 'FILLED' | 'CANCELLED' | 'REJECTED';
  filledQuantity: number;
  remainingQuantity: number;
  averageFillPrice?: number;
  message?: string;
}

export interface AccountInfo {
  accountId: string;
  buyingPower: number;
  netLiquidation: number;
  totalCash: number;
  unrealizedPnL: number;
  realizedPnL: number;
  maintenanceMargin: number;
  initialMargin: number;
}

export interface MarketData {
  symbol: string;
  bid: number;
  ask: number;
  last: number;
  volume: number;
  high: number;
  low: number;
  open: number;
  close: number;
  timestamp: Date;
}