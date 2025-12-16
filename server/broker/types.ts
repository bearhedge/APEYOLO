import type {
  AccountInfo,
  OptionChainData,
  Position,
  Trade,
  InsertTrade,
} from "@shared/schema";

export type BrokerProviderName = "mock" | "ibkr" | "none";
export type BrokerEnv = "paper" | "live";

export interface BrokerProvider {
  getAccount(): Promise<AccountInfo>;
  getPositions(): Promise<Position[]>;
  getOptionChain(symbol: string, expiration?: string): Promise<OptionChainData>;
  getTrades(): Promise<Trade[]>;
  placeOrder(trade: InsertTrade): Promise<{ id?: string; status: string; raw?: any }>;
  getMarketData(symbol: string): Promise<{
    symbol: string;
    price: number;
    bid: number;
    ask: number;
    volume: number;
    change: number;
    changePercent: number;
    timestamp: Date;
  }>;
}

export type BrokerStatus = {
  provider: BrokerProviderName;
  env: BrokerEnv;
  connected: boolean;
  status?: string;  // Current status message
};

