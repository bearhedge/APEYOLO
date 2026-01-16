# Fix 001: WebSocket Authentication Failure

**Date:** 2026-01-17
**Symptom:** "No live SPY data available", orders not executing
**Root Cause:** WebSocket ignoring `authenticated: false` from IBKR

---

## The Problem

IBKR WebSocket returns a status message (`sts`) after connection that includes an `authenticated` field:

```json
{"topic": "sts", "authenticated": false}
```

The old code at `server/broker/ibkrWebSocket.ts:258` was:

```typescript
if (msg.topic === 'sts') {
  this.isAuthenticated = true;  // BUG: Always true, ignoring actual value
  this.resubscribeAll();
  resolve();
}
```

This meant even when IBKR said "you're not authenticated", we proceeded as if we were. Result: subscriptions fail silently, no market data, orders rejected.

---

## The Fix

### 1. ibkrWebSocket.ts - Check authenticated field

```typescript
if (msg.topic === 'sts') {
  // CRITICAL: Check if IBKR actually authenticated us
  if (msg.authenticated === false) {
    console.error('[IbkrWS] IBKR returned authenticated=false! Session token is invalid.');
    this.forceReconnectWithFreshCredentials();
    reject(new Error('IBKR WebSocket authentication failed - session invalid'));
    return;
  }

  // authenticated=true or no authenticated field (legacy) - we're good
  this.isAuthenticated = true;
  this.resubscribeAll();
  resolve();
}
```

### 2. ibkr.ts - Add forceRefresh parameter

```typescript
export async function ensureIbkrReady(forceRefresh = false): Promise<IbkrDiagnostics> {
  if (!activeClient) throw new Error('IBKR client not initialized');
  if (typeof (activeClient as any).ensureReady === 'function') {
    await (activeClient as any).ensureReady(true, forceRefresh);
  }
  return activeClient.getDiagnostics();
}
```

### 3. marketDataAutoStart.ts - Force refresh on reconnect

```typescript
wsManager.setCredentialRefreshCallback(async () => {
  // Force refresh = true to clear cached tokens
  await ensureIbkrReady(true);
  const newCookieString = await getIbkrCookieString();
  const newSessionToken = await getIbkrSessionToken();
  return { cookieString: newCookieString || '', sessionToken: newSessionToken };
});
```

---

## Files Modified

| File | Change |
|------|--------|
| `server/broker/ibkrWebSocket.ts` | Check `authenticated` field in `sts` message |
| `server/broker/ibkr.ts` | Add `forceRefresh` param to `ensureIbkrReady()` |
| `server/services/marketDataAutoStart.ts` | Call `ensureIbkrReady(true)` in credential refresh |

---

## How to Verify

1. Check Cloud Run logs for: `[IbkrWS] sts received with auth success`
2. Market data should show live SPY/VIX prices
3. Orders should execute without "no valid order ID" errors

---

## Related Issues

- Stale OAuth tokens (10-min expiry)
- Stale SSO session (9-min expiry)
- Cookie jar not refreshing properly

If WebSocket keeps failing auth, the underlying OAuth flow may need investigation.
