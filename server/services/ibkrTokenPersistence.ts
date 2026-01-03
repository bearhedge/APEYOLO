/**
 * IBKR Token Persistence Service
 *
 * Saves and restores OAuth tokens to database so users stay logged in
 * across server restarts and deployments.
 */

import { db } from '../db';
import { ibkrCredentials } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { encryptToken, decryptToken } from '../crypto';

interface TokenState {
  accessToken: string | null;
  accessTokenExpiryMs: number;
  ssoToken: string | null;
  ssoSessionId: string | null;
  ssoTokenExpiryMs: number;
  cookieJarJson: string | null;
}

/**
 * Save token state to database
 */
export async function saveTokenState(userId: string, state: TokenState): Promise<void> {
  if (!db) {
    console.warn('[TokenPersistence] Database not available, skipping save');
    return;
  }

  try {
    const updates: Record<string, any> = {
      updatedAt: new Date(),
    };

    // Encrypt tokens before saving
    if (state.accessToken) {
      updates.accessTokenEncrypted = encryptToken(state.accessToken);
      updates.accessTokenExpiryMs = state.accessTokenExpiryMs;
    }

    if (state.ssoToken) {
      updates.ssoTokenEncrypted = encryptToken(state.ssoToken);
      updates.ssoSessionId = state.ssoSessionId;
      updates.ssoTokenExpiryMs = state.ssoTokenExpiryMs;
    }

    if (state.cookieJarJson) {
      updates.cookieJarJson = state.cookieJarJson;
    }

    await db.update(ibkrCredentials)
      .set(updates)
      .where(eq(ibkrCredentials.userId, userId));

    console.log(`[TokenPersistence] Saved tokens for user ${userId}`);
  } catch (error) {
    console.error('[TokenPersistence] Failed to save tokens:', error);
  }
}

/**
 * Load token state from database
 */
export async function loadTokenState(userId: string): Promise<TokenState | null> {
  if (!db) {
    console.warn('[TokenPersistence] Database not available, skipping load');
    return null;
  }

  try {
    const [creds] = await db.select({
      accessTokenEncrypted: ibkrCredentials.accessTokenEncrypted,
      accessTokenExpiryMs: ibkrCredentials.accessTokenExpiryMs,
      ssoTokenEncrypted: ibkrCredentials.ssoTokenEncrypted,
      ssoSessionId: ibkrCredentials.ssoSessionId,
      ssoTokenExpiryMs: ibkrCredentials.ssoTokenExpiryMs,
      cookieJarJson: ibkrCredentials.cookieJarJson,
    })
      .from(ibkrCredentials)
      .where(eq(ibkrCredentials.userId, userId))
      .limit(1);

    if (!creds) {
      return null;
    }

    // Decrypt tokens
    const state: TokenState = {
      accessToken: creds.accessTokenEncrypted ? decryptToken(creds.accessTokenEncrypted) : null,
      accessTokenExpiryMs: Number(creds.accessTokenExpiryMs) || 0,
      ssoToken: creds.ssoTokenEncrypted ? decryptToken(creds.ssoTokenEncrypted) : null,
      ssoSessionId: creds.ssoSessionId,
      ssoTokenExpiryMs: Number(creds.ssoTokenExpiryMs) || 0,
      cookieJarJson: creds.cookieJarJson,
    };

    // Check if tokens are still valid
    const now = Date.now();
    if (state.accessTokenExpiryMs > 0 && state.accessTokenExpiryMs <= now) {
      console.log(`[TokenPersistence] Access token expired for user ${userId}`);
      state.accessToken = null;
    }
    if (state.ssoTokenExpiryMs > 0 && state.ssoTokenExpiryMs <= now) {
      console.log(`[TokenPersistence] SSO token expired for user ${userId}`);
      state.ssoToken = null;
    }

    console.log(`[TokenPersistence] Loaded tokens for user ${userId} (valid: access=${!!state.accessToken}, sso=${!!state.ssoToken})`);
    return state;
  } catch (error) {
    console.error('[TokenPersistence] Failed to load tokens:', error);
    return null;
  }
}

/**
 * Clear token state from database
 */
export async function clearTokenState(userId: string): Promise<void> {
  if (!db) return;

  try {
    await db.update(ibkrCredentials)
      .set({
        accessTokenEncrypted: null,
        accessTokenExpiryMs: null,
        ssoTokenEncrypted: null,
        ssoSessionId: null,
        ssoTokenExpiryMs: null,
        cookieJarJson: null,
        updatedAt: new Date(),
      })
      .where(eq(ibkrCredentials.userId, userId));

    console.log(`[TokenPersistence] Cleared tokens for user ${userId}`);
  } catch (error) {
    console.error('[TokenPersistence] Failed to clear tokens:', error);
  }
}
