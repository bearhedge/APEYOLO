# IBKR Token Persistence Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Persist IBKR OAuth tokens to database so users stay logged in across server restarts/deployments.

**Architecture:** Store encrypted runtime tokens (access_token, sso_token) in the existing `ibkr_credentials` table. On server startup, load and restore tokens to IbkrClient. Auto-refresh tokens before expiry.

**Tech Stack:** PostgreSQL (Drizzle ORM), AES-256-GCM encryption (existing crypto.ts), Node.js

---

## Task 1: Add Token Columns to Schema

**Files:**
- Modify: `shared/schema.ts:190-205` (ibkrCredentials table)

**Step 1: Add token columns to ibkrCredentials table**

Add these columns after `errorMessage` (line 202):

```typescript
  // Runtime OAuth tokens (encrypted, survive restarts)
  accessTokenEncrypted: text("access_token_encrypted"),
  accessTokenExpiryMs: bigint("access_token_expiry_ms", { mode: "number" }),
  ssoTokenEncrypted: text("sso_token_encrypted"),
  ssoSessionId: text("sso_session_id"),
  ssoTokenExpiryMs: bigint("sso_token_expiry_ms", { mode: "number" }),
  cookieJarJson: text("cookie_jar_json"), // Serialized cookie jar
```

**Step 2: Run database migration**

Run: `cd "/Users/home/Desktop/APE YOLO/APE-YOLO" && DATABASE_URL=postgresql://home@localhost:5432/options_data npx drizzle-kit push`
Expected: Schema changes applied successfully

**Step 3: Verify columns exist**

Run: `/opt/homebrew/opt/postgresql@15/bin/psql -d options_data -c "\d ibkr_credentials"`
Expected: Shows new columns (access_token_encrypted, sso_token_encrypted, etc.)

**Step 4: Commit**

```bash
git add shared/schema.ts
git commit -m "feat: add IBKR token persistence columns to schema"
```

---

## Task 2: Add Token Encryption Helpers

**Files:**
- Modify: `server/crypto.ts:109-134` (add new functions)

**Step 1: Add token encryption/decryption helpers**

Add after `decryptPrivateKey` function (line 109):

```typescript
/**
 * Encrypts IBKR OAuth token for storage
 */
export function encryptToken(token: string): string {
  const key = getEncryptionKey();
  return encrypt(token, key);
}

/**
 * Decrypts IBKR OAuth token for use
 */
export function decryptToken(encryptedToken: string): string {
  const key = getEncryptionKey();
  return decrypt(encryptedToken, key);
}
```

**Step 2: Verify crypto module still works**

Run: `cd "/Users/home/Desktop/APE YOLO/APE-YOLO" && npx tsx -e "const { encryptToken, decryptToken } = require('./server/crypto'); const enc = encryptToken('test123'); console.log('encrypted:', enc.slice(0,20) + '...'); console.log('decrypted:', decryptToken(enc));"`
Expected: `decrypted: test123`

**Step 3: Commit**

```bash
git add server/crypto.ts
git commit -m "feat: add token encryption helpers"
```

---

## Task 3: Add Token Save/Restore Methods to IbkrClient

**Files:**
- Modify: `server/broker/ibkr.ts:114-160` (IbkrClient class)

**Step 1: Add userId property to IbkrClient**

Add after line 122 (`private credentials?`):

```typescript
  private userId?: string; // For token persistence
```

**Step 2: Update constructor to accept userId**

Modify the IbkrConfig type (around line 98) to add:

```typescript
type IbkrConfig = {
  baseUrl?: string;
  accountId?: string;
  env: "paper" | "live";
  userId?: string; // For token persistence
  credentials?: {
    clientId: string;
    clientKeyId: string;
    privateKey: string;
    credential: string;
    allowedIp?: string;
  };
};
```

Update constructor (line 145) to store userId:

```typescript
  constructor(cfg: IbkrConfig) {
    this.baseUrl = cfg.baseUrl || "https://api.ibkr.com";
    this.accountId = cfg.accountId;
    this.env = cfg.env;
    this.userId = cfg.userId; // Store for token persistence
    this.credentials = cfg.credentials;
    // ... rest unchanged
```

**Step 3: Add getTokenState and restoreTokenState methods**

Add after the constructor (around line 160):

```typescript
  /**
   * Get current token state for persistence
   */
  public getTokenState(): {
    accessToken: string | null;
    accessTokenExpiryMs: number;
    ssoToken: string | null;
    ssoSessionId: string | null;
    ssoTokenExpiryMs: number;
    cookieJarJson: string;
  } {
    return {
      accessToken: this.accessToken,
      accessTokenExpiryMs: this.accessTokenExpiryMs,
      ssoToken: this.ssoAccessToken,
      ssoSessionId: this.ssoSessionId,
      ssoTokenExpiryMs: this.ssoAccessTokenExpiryMs,
      cookieJarJson: JSON.stringify(this.jar.toJSON()),
    };
  }

  /**
   * Restore token state from persistence
   */
  public restoreTokenState(state: {
    accessToken: string | null;
    accessTokenExpiryMs: number;
    ssoToken: string | null;
    ssoSessionId: string | null;
    ssoTokenExpiryMs: number;
    cookieJarJson: string | null;
  }): void {
    const now = Date.now();

    // Only restore if tokens haven't expired
    if (state.accessToken && state.accessTokenExpiryMs > now) {
      this.accessToken = state.accessToken;
      this.accessTokenExpiryMs = state.accessTokenExpiryMs;
      console.log('[IBKR] Restored access token, expires in',
        Math.round((state.accessTokenExpiryMs - now) / 1000 / 60), 'minutes');
    }

    if (state.ssoToken && state.ssoTokenExpiryMs > now) {
      this.ssoAccessToken = state.ssoToken;
      this.ssoSessionId = state.ssoSessionId;
      this.ssoAccessTokenExpiryMs = state.ssoTokenExpiryMs;
      this.sessionReady = true;
      console.log('[IBKR] Restored SSO session, expires in',
        Math.round((state.ssoTokenExpiryMs - now) / 1000 / 60), 'minutes');
    }

    // Restore cookies
    if (state.cookieJarJson) {
      try {
        const jarData = JSON.parse(state.cookieJarJson);
        this.jar = CookieJar.fromJSON(jarData);
        // Recreate http client with restored jar
        this.http = wrapper(axios.create({
          baseURL: 'https://api.ibkr.com',
          jar: this.jar,
          withCredentials: true,
          validateStatus: () => true,
          timeout: 30000,
          headers: { 'User-Agent': 'apeyolo/1.0' },
        }));
        console.log('[IBKR] Restored cookie jar');
      } catch (e) {
        console.warn('[IBKR] Failed to restore cookie jar:', e);
      }
    }
  }

  /**
   * Get userId for this client
   */
  public getUserId(): string | undefined {
    return this.userId;
  }
```

**Step 4: Verify TypeScript compiles**

Run: `cd "/Users/home/Desktop/APE YOLO/APE-YOLO" && npx tsc --noEmit -p tsconfig.json 2>&1 | head -20`
Expected: No errors (or only unrelated warnings)

**Step 5: Commit**

```bash
git add server/broker/ibkr.ts
git commit -m "feat: add token state save/restore methods to IbkrClient"
```

---

## Task 4: Create Token Persistence Service

**Files:**
- Create: `server/services/ibkrTokenPersistence.ts`

**Step 1: Create the token persistence service**

```typescript
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
      accessTokenExpiryMs: creds.accessTokenExpiryMs ?? 0,
      ssoToken: creds.ssoTokenEncrypted ? decryptToken(creds.ssoTokenEncrypted) : null,
      ssoSessionId: creds.ssoSessionId,
      ssoTokenExpiryMs: creds.ssoTokenExpiryMs ?? 0,
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
```

**Step 2: Verify file created**

Run: `ls -la "/Users/home/Desktop/APE YOLO/APE-YOLO/server/services/ibkrTokenPersistence.ts"`
Expected: File exists

**Step 3: Commit**

```bash
git add server/services/ibkrTokenPersistence.ts
git commit -m "feat: add IBKR token persistence service"
```

---

## Task 5: Integrate Token Persistence into Broker

**Files:**
- Modify: `server/broker/index.ts:103-220` (getBrokerForUser function)

**Step 1: Add import for token persistence**

Add at top of file (after line 8):

```typescript
import { loadTokenState, saveTokenState } from '../services/ibkrTokenPersistence';
```

**Step 2: Modify getBrokerForUser to restore tokens on creation**

In `getBrokerForUser` function, after creating the provider (around line 178), add token restoration:

```typescript
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

    // Restore persisted tokens
    const savedTokens = await loadTokenState(userId);
    if (savedTokens && (savedTokens.accessToken || savedTokens.ssoToken)) {
      // @ts-ignore - accessing internal method
      provider.restoreTokenState?.(savedTokens);
    }
```

**Step 3: Verify TypeScript compiles**

Run: `cd "/Users/home/Desktop/APE YOLO/APE-YOLO" && npx tsc --noEmit -p tsconfig.json 2>&1 | head -20`
Expected: No errors

**Step 4: Commit**

```bash
git add server/broker/index.ts
git commit -m "feat: restore persisted tokens on broker creation"
```

---

## Task 6: Save Tokens After Successful Authentication

**Files:**
- Modify: `server/broker/ibkr.ts` (after successful OAuth/SSO)

**Step 1: Add import for token persistence**

Add at top of file (after existing imports):

```typescript
import { saveTokenState } from '../services/ibkrTokenPersistence';
```

**Step 2: Add token save after successful OAuth**

Find the `getOAuthToken` method (search for `this.accessToken = json.access_token`). After that line (around line 528), add:

```typescript
      this.accessToken = json.access_token;
      this.accessTokenExpiryMs = this.now() + json.expires_in * 1000;

      // Persist tokens to database
      if (this.userId) {
        const state = this.getTokenState();
        saveTokenState(this.userId, state).catch(err =>
          console.error('[IBKR] Failed to persist tokens:', err)
        );
      }
```

**Step 3: Add token save after successful SSO**

Find the `createSSOSession` method. After the line that sets `this.ssoAccessToken` (search for `this.ssoAccessToken = body`), add similar persistence:

```typescript
      // After setting ssoAccessToken
      // Persist tokens to database
      if (this.userId) {
        const state = this.getTokenState();
        saveTokenState(this.userId, state).catch(err =>
          console.error('[IBKR] Failed to persist tokens:', err)
        );
      }
```

**Step 4: Verify TypeScript compiles**

Run: `cd "/Users/home/Desktop/APE YOLO/APE-YOLO" && npx tsc --noEmit -p tsconfig.json 2>&1 | head -20`
Expected: No errors

**Step 5: Commit**

```bash
git add server/broker/ibkr.ts
git commit -m "feat: persist tokens after successful authentication"
```

---

## Task 7: Update createIbkrProviderWithCredentials

**Files:**
- Modify: `server/broker/ibkr.ts` (createIbkrProviderWithCredentials function)

**Step 1: Find the function and add userId parameter**

Search for `export function createIbkrProviderWithCredentials`. Update to accept and pass userId:

```typescript
export function createIbkrProviderWithCredentials(cfg: {
  env: "paper" | "live";
  accountId?: string;
  userId?: string; // Add this
  credentials: {
    clientId: string;
    clientKeyId: string;
    privateKey: string;
    credential: string;
    allowedIp?: string;
  };
}): BrokerProvider {
  const client = new IbkrClient({
    env: cfg.env,
    accountId: cfg.accountId,
    userId: cfg.userId, // Pass userId
    credentials: cfg.credentials,
  });
  // ... rest unchanged
```

**Step 2: Verify TypeScript compiles**

Run: `cd "/Users/home/Desktop/APE YOLO/APE-YOLO" && npx tsc --noEmit -p tsconfig.json 2>&1 | head -20`
Expected: No errors

**Step 3: Commit**

```bash
git add server/broker/ibkr.ts
git commit -m "feat: pass userId to IbkrClient for token persistence"
```

---

## Task 8: Deploy and Test

**Files:**
- None (deployment and testing)

**Step 1: Run local dev server**

Run: `cd "/Users/home/Desktop/APE YOLO/APE-YOLO" && npm run dev`
Expected: Server starts without errors

**Step 2: Test token persistence flow**

1. Login via IBKR OAuth in browser
2. Check database for saved tokens:
   ```bash
   /opt/homebrew/opt/postgresql@15/bin/psql -d options_data -c "SELECT user_id, access_token_encrypted IS NOT NULL as has_token, sso_session_id IS NOT NULL as has_sso FROM ibkr_credentials;"
   ```
   Expected: Shows `has_token: true, has_sso: true`

3. Restart dev server (Ctrl+C, then `npm run dev` again)
4. Check if still authenticated (no login prompt)

**Step 3: Deploy to production**

Run: `cd "/Users/home/Desktop/APE YOLO/APE-YOLO" && npm run deploy:prod`
Expected: Deployment succeeds

**Step 4: Verify in production**

1. Visit https://apeyolo.com
2. If previously logged in, should still be logged in
3. Check logs: `gcloud run services logs read apeyolo --region=asia-east1 --limit=20`
   Look for: `[TokenPersistence] Loaded tokens for user...`

**Step 5: Commit any final fixes**

```bash
git add -A
git commit -m "fix: any deployment adjustments"
```

---

## Success Criteria

- [ ] Token columns added to ibkr_credentials table
- [ ] Tokens encrypted before storage
- [ ] Tokens restored on server startup
- [ ] User stays logged in after deployment
- [ ] No manual login required after deploy

---

## Security Considerations

- Tokens encrypted with AES-256-GCM using IBKR_ENCRYPTION_KEY
- Tokens stored per-user in ibkr_credentials table
- Expired tokens not restored (checked on load)
- Cookie jar serialized for session continuity
