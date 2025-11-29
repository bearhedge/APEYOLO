import { storage } from "../storage";
import type { BrokerEnv, BrokerProvider, BrokerProviderName, BrokerStatus } from "./types";
import { createIbkrProvider, getIbkrDiagnostics } from "./ibkr";
import type { InsertTrade } from "@shared/schema";

type BrokerBundle = {
  status: BrokerStatus;
  api: BrokerProvider;
};

// Adapter over existing in-memory storage for the mock provider.
function createMockProvider(): BrokerProvider {
  return {
    getAccount: () => storage.getAccountInfo(),
    getPositions: () => storage.getPositions(),
    getOptionChain: (symbol: string, expiration?: string) => storage.getOptionChain(symbol, expiration),
    getTrades: () => storage.getTrades(),
    placeOrder: async (trade: InsertTrade) => {
      // For mock, placement is handled by routes today; return a simple ack.
      return { status: "accepted_mock" };
    },
    getMarketData: async (symbol: string) => {
      // Mock market data
      const basePrice = symbol === 'SPY' ? 680 : symbol === 'VIX' ? 15 : 100;
      return {
        price: basePrice + (Math.random() - 0.5) * 2,
        bid: basePrice - 0.01,
        ask: basePrice + 0.01,
        volume: Math.floor(Math.random() * 1000000),
        change: (Math.random() - 0.5) * 5,
        changePercent: (Math.random() - 0.5) * 2,
      };
    },
  };
}

export function getBroker(): BrokerBundle {
  // Auto-detect IBKR if credentials are configured (same logic as Settings page)
  const ibkrConfigured = !!(process.env.IBKR_CLIENT_ID && process.env.IBKR_PRIVATE_KEY);
  const provider: BrokerProviderName = ibkrConfigured ? "ibkr" : ((process.env.BROKER_PROVIDER as BrokerProviderName) || "mock");
  const env = (process.env.IBKR_ENV as BrokerEnv) || "paper";

  if (provider === "ibkr") {
    const accountId = process.env.IBKR_ACCOUNT_ID;
    const baseUrl = process.env.IBKR_BASE_URL;

    const api = createIbkrProvider({ env, accountId, baseUrl });

    // Check actual IBKR connection status dynamically
    const diagnostics = getIbkrDiagnostics();
    const isConnected = diagnostics.oauth.status === 200 &&
                       diagnostics.sso.status === 200 &&
                       diagnostics.validate.status === 200 &&
                       diagnostics.init.status === 200;

    const status: BrokerStatus = { provider, env, connected: isConnected };
    return { status, api };
  }

  const api = createMockProvider();
  const status: BrokerStatus = { provider: "mock", env: "paper", connected: true };
  return { status, api };
}

// Helper function to get broker with real-time status check
export function getBrokerWithStatus(): BrokerBundle {
  const bundle = getBroker();

  // For IBKR, always check the latest connection status
  if (bundle.status.provider === "ibkr") {
    const diagnostics = getIbkrDiagnostics();
    const isConnected = diagnostics.oauth.status === 200 &&
                       diagnostics.sso.status === 200 &&
                       diagnostics.validate.status === 200 &&
                       diagnostics.init.status === 200;
    bundle.status.connected = isConnected;
  }

  return bundle;
}

