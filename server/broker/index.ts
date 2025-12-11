import { storage } from "../storage";
import type { BrokerEnv, BrokerProvider, BrokerProviderName, BrokerStatus } from "./types";
import { createIbkrProvider, createIbkrProviderWithCredentials, getIbkrDiagnostics } from "./ibkr";
import type { InsertTrade } from "@shared/schema";
import { ibkrCredentials } from "@shared/schema";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { decryptPrivateKey } from "../crypto";

type BrokerBundle = {
  status: BrokerStatus;
  api: BrokerProvider | null;  // null when user has no IBKR credentials configured
};

// SINGLETON: Cache IBKR provider to prevent creating new instances on every call
let cachedIbkrProvider: BrokerProvider | null = null;

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
      // Mock market data - returns reasonable defaults
      return {
        symbol,
        price: symbol === 'SPY' ? 600 : 100,
        bid: symbol === 'SPY' ? 599.95 : 99.95,
        ask: symbol === 'SPY' ? 600.05 : 100.05,
        volume: 1000000,
        change: 0.5,
        changePercent: 0.08,
        timestamp: new Date(),
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

    // SINGLETON: Reuse existing IBKR provider instance
    if (!cachedIbkrProvider) {
      console.log('[Broker] Creating singleton IBKR provider');
      cachedIbkrProvider = createIbkrProvider({ env, accountId, baseUrl });
    }
    const api = cachedIbkrProvider;

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

// ==================== MULTI-TENANT: PER-USER IBKR CLIENT MANAGEMENT ====================

// Cache for per-user IBKR providers - prevents creating new instances on every call
const userBrokerCache = new Map<string, {
  provider: BrokerProvider;
  createdAt: Date;
  environment: string;
}>();

// Cache expiration time (1 hour) - forces credential refresh periodically
const CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Gets or creates an IBKR broker for a specific user based on their stored credentials.
 * Falls back to the default (env-based) broker if no credentials found.
 *
 * @param userId - The authenticated user's ID
 * @returns Promise<BrokerBundle> - The broker bundle with status and API
 */
export async function getBrokerForUser(
  userId: string,
  options?: { allowInactive?: boolean }
): Promise<BrokerBundle> {
  // Check cache first
  const cached = userBrokerCache.get(userId);
  if (cached && (Date.now() - cached.createdAt.getTime()) < CACHE_TTL_MS) {
    // Use cached provider, but check connection status dynamically
    const diagnostics = getIbkrDiagnostics();
    const isConnected = diagnostics.oauth.status === 200 &&
                       diagnostics.sso.status === 200 &&
                       diagnostics.validate.status === 200 &&
                       diagnostics.init.status === 200;

    const status: BrokerStatus = {
      provider: "ibkr",
      env: cached.environment as BrokerEnv,
      connected: isConnected
    };

    return { status, api: cached.provider };
  }

  // Database not available - return no broker (security: never fall back to shared broker)
  if (!db) {
    console.warn('[Broker] Database not available, no broker for user');
    return {
      status: { provider: "none", env: "paper", connected: false },
      api: null
    };
  }

  // Load credentials from database
  const creds = await db.select().from(ibkrCredentials)
    .where(eq(ibkrCredentials.userId, userId))
    .limit(1);

  // No credentials found - return no broker (security: never fall back to shared broker)
  if (creds.length === 0) {
    console.log(`[Broker] No IBKR credentials for user ${userId}`);
    return {
      status: { provider: "none", env: "paper", connected: false },
      api: null
    };
  }

  const userCreds = creds[0];

  // Only use active credentials (security: never fall back to shared broker)
  // BUT allow testing inactive credentials when explicitly requested
  if (userCreds.status !== 'active' && !options?.allowInactive) {
    console.log(`[Broker] IBKR credentials for user ${userId} are ${userCreds.status}`);
    return {
      status: { provider: "none", env: "paper", connected: false },
      api: null
    };
  }

  try {
    // Decrypt the private key
    const privateKey = decryptPrivateKey(userCreds.privateKeyEncrypted);

    // Create IBKR provider with user's credentials
    console.log(`[Broker] Creating IBKR provider for user ${userId} (env: ${userCreds.environment})`);

    const provider = createIbkrProviderWithCredentials({
      env: userCreds.environment as BrokerEnv,
      accountId: userCreds.accountId || undefined,
      credentials: {
        clientId: userCreds.clientId,
        clientKeyId: userCreds.clientKeyId,
        privateKey: privateKey,
        credential: userCreds.credential,
        allowedIp: userCreds.allowedIp || undefined,
      }
    });

    // Cache the provider
    userBrokerCache.set(userId, {
      provider,
      createdAt: new Date(),
      environment: userCreds.environment
    });

    // Check connection status
    const diagnostics = getIbkrDiagnostics();
    const isConnected = diagnostics.oauth.status === 200 &&
                       diagnostics.sso.status === 200 &&
                       diagnostics.validate.status === 200 &&
                       diagnostics.init.status === 200;

    const status: BrokerStatus = {
      provider: "ibkr",
      env: userCreds.environment as BrokerEnv,
      connected: isConnected
    };

    return { status, api: provider };
  } catch (error) {
    console.error(`[Broker] Failed to create IBKR provider for user ${userId}:`, error);

    // Update credential status to error
    await db.update(ibkrCredentials)
      .set({
        status: 'error',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        updatedAt: new Date()
      })
      .where(eq(ibkrCredentials.userId, userId));

    // Return no broker (security: never fall back to shared broker)
    return {
      status: { provider: "none", env: "paper", connected: false },
      api: null
    };
  }
}

/**
 * Clears the cached broker for a user (call when credentials are updated)
 */
export function clearUserBrokerCache(userId: string): void {
  userBrokerCache.delete(userId);
  console.log(`[Broker] Cleared broker cache for user ${userId}`);
}

/**
 * Clears all cached brokers (call on server shutdown or credential rotation)
 */
export function clearAllBrokerCaches(): void {
  userBrokerCache.clear();
  console.log('[Broker] Cleared all broker caches');
}

