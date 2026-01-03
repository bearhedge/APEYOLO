import { storage } from "../storage";
import type { BrokerEnv, BrokerProvider, BrokerProviderName, BrokerStatus } from "./types";
import { createIbkrProvider, createIbkrProviderWithCredentials, getIbkrDiagnostics, ibkrEvents } from "./ibkr";
import type { InsertTrade } from "@shared/schema";
import { ibkrCredentials } from "@shared/schema";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { decryptPrivateKey } from "../crypto";
import { loadTokenState, clearTokenState } from '../services/ibkrTokenPersistence';

// Listen for IP mismatch events and auto-update database
ibkrEvents.on('ip_mismatch', async ({ storedIp, currentIp, userId }: { storedIp: string; currentIp: string; userId?: string }) => {
  console.log(`[Broker][IP] Auto-updating database IP from ${storedIp} to ${currentIp}`);

  try {
    if (!db) {
      console.error('[Broker][IP] Database not available for IP update');
      return;
    }

    // Update all credentials with the old IP to the new IP
    const result = await db.update(ibkrCredentials)
      .set({
        allowedIp: currentIp,
        updatedAt: new Date(),
      })
      .where(eq(ibkrCredentials.allowedIp, storedIp));

    console.log(`[Broker][IP] Database IP updated successfully to ${currentIp}`);

    // Clear cached tokens for this user (they were created with wrong IP)
    if (userId) {
      await clearTokenState(userId);
      console.log(`[Broker][IP] Cleared cached tokens for user ${userId}`);
    }

    // Create audit log
    await storage.createAuditLog({
      eventType: 'IBKR_IP_AUTO_UPDATE',
      details: `IP auto-updated from ${storedIp} to ${currentIp}`,
      status: 'SUCCESS',
    });
  } catch (err) {
    console.error('[Broker][IP] Failed to auto-update database IP:', err);
  }
});

type BrokerBundle = {
  status: BrokerStatus;
  api: BrokerProvider | null;  // null when user has no IBKR credentials configured
};

// SINGLETON: Cache IBKR provider to prevent creating new instances on every call
let cachedIbkrProvider: BrokerProvider | null = null;

// Mock provider that throws errors - forces real IBKR connection
// NO MOCK DATA: All methods throw to ensure IBKR is properly configured
function createMockProvider(): BrokerProvider {
  const notConfiguredError = (method: string) =>
    new Error(`[IBKR] Broker not configured. ${method}() requires real IBKR connection. Please configure IBKR credentials.`);

  return {
    getAccount: () => { throw notConfiguredError('getAccount'); },
    getPositions: () => { throw notConfiguredError('getPositions'); },
    getOptionChain: (symbol: string, expiration?: string) => { throw notConfiguredError('getOptionChain'); },
    getTrades: () => { throw notConfiguredError('getTrades'); },
    placeOrder: async (trade: InsertTrade) => { throw notConfiguredError('placeOrder'); },
    getMarketData: async (symbol: string) => { throw notConfiguredError('getMarketData'); },
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
  console.log(`[Broker] Looking up credentials for user ${userId}...`);
  const creds = await db.select().from(ibkrCredentials)
    .where(eq(ibkrCredentials.userId, userId))
    .limit(1);

  // No credentials found - return no broker (security: never fall back to shared broker)
  if (creds.length === 0) {
    console.log(`[Broker] No IBKR credentials found for user ${userId} in database`);
    return {
      status: { provider: "none", env: "paper", connected: false },
      api: null
    };
  }

  const userCreds = creds[0];
  console.log(`[Broker] Found credentials for user ${userId}: clientId=${userCreds.clientId.substring(0, 8)}***, status=${userCreds.status}`);

  // Only use active credentials (security: never fall back to shared broker)
  // BUT allow testing inactive credentials when explicitly requested
  if (userCreds.status !== 'active' && !options?.allowInactive) {
    console.log(`[Broker] IBKR credentials for user ${userId} are ${userCreds.status} (not active)`);
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
      userId: userId, // Pass userId for token persistence
      credentials: {
        clientId: userCreds.clientId,
        clientKeyId: userCreds.clientKeyId,
        privateKey: privateKey,
        credential: userCreds.credential,
        allowedIp: userCreds.allowedIp || undefined,
      }
    });

    // Restore persisted tokens if available
    const savedTokens = await loadTokenState(userId);
    if (savedTokens && (savedTokens.accessToken || savedTokens.ssoToken)) {
      // @ts-ignore - restoreTokenState is on the underlying IbkrClient
      if (typeof provider.restoreTokenState === 'function') {
        provider.restoreTokenState(savedTokens);
      }
    }

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

