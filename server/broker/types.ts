import type {
  AccountInfo,
  OptionChainData,
  Position,
  Trade,
  InsertTrade,
} from "@shared/schema";

export type BrokerProviderName = "mock" | "ibkr";
export type BrokerEnv = "paper" | "live";

export interface BrokerProvider {
  getAccount(): Promise<AccountInfo>;
  getPositions(): Promise<Position[]>;
  getOptionChain(symbol: string, expiration?: string): Promise<OptionChainData>;
  getTrades(): Promise<Trade[]>;
  placeOrder(trade: InsertTrade): Promise<{ id?: string; status: string; raw?: any }>;
  getMarketData(symbol: string): Promise<{
    price: number;
    bid: number;
    ask: number;
    volume: number;
    change: number;
    changePercent: number;
  }>;
}

export type BrokerStatus = {
  provider: BrokerProviderName;
  env: BrokerEnv;
  connected: boolean;
};

