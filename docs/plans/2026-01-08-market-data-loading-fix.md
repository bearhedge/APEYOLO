# Market Data Loading Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix slow initial load (~1 min) and incorrect data display in SPY Engine

**Architecture:** Add market status check before SSE, add SSE timeout, pass real day high/low from Yahoo, fix source badge logic

**Tech Stack:** React hooks, Express endpoints, Yahoo Finance API

---

## Problem Summary

| Issue | Root Cause |
|-------|------------|
| Takes ~1 minute to load | Client tries SSE first, waits for data that never comes |
| Price is stale ($690.11 vs $689.58) | Cached IBKR data shown instead of fresh Yahoo |
| "LIVE" badge when market closed | Source badge hardcoded to 'ibkr-sse' in SSE handler |
| Day range is fake | Hardcoded as `price * 1.005` / `price * 0.995` |
| Change % shows 0.00% | Yahoo provides it but dayHigh/dayLow not passed |

---

### Task 1: Add Market Status Endpoint

**Files:**
- Modify: `/server/routes.ts`

**Step 1: Add lightweight market status endpoint**

Add this endpoint after the existing market routes (around line 1680):

```ts
// Lightweight market status check (no auth required for speed)
app.get('/api/market/status', (_req, res) => {
  try {
    const status = getMarketStatus();
    return res.json({
      ok: true,
      isOpen: status.isOpen,
      marketState: status.isOpen ? 'REGULAR' : 'CLOSED',
      currentTimeET: status.currentTimeET,
      reason: status.reason,
    });
  } catch (err: any) {
    return res.json({
      ok: true,
      isOpen: false,
      marketState: 'CLOSED',
      reason: 'Error checking market status',
    });
  }
});
```

**Step 2: Verify endpoint works**

Run: `curl http://localhost:5000/api/market/status`
Expected: `{"ok":true,"isOpen":false,"marketState":"CLOSED",...}`

**Step 3: Commit**

```bash
git add server/routes.ts
git commit -m "feat: add lightweight market status endpoint"
```

---

### Task 2: Add Day High/Low to Snapshot Response

**Files:**
- Modify: `/server/routes.ts` (lines 1756-1772)

**Step 1: Update Yahoo snapshot response to include day high/low**

Find the Yahoo snapshot response (around line 1756) and update:

```ts
console.log(`[Snapshot] Yahoo: SPY=$${yahoo.spy.price} (${yahoo.spy.changePercent.toFixed(2)}%), VIX=${yahoo.vix.current} (IV Rank: ${ivRank})`);
return res.json({
  ok: true,
  available: true,
  source: 'yahoo',
  marketState,
  snapshot: {
    spyPrice: yahoo.spy.price,
    spyChange: yahoo.spy.change,
    spyChangePct: yahoo.spy.changePercent,
    vix: yahoo.vix.current,
    vixChange: yahoo.vix.change,
    vixChangePct: yahoo.vix.changePercent,
    vwap: null,
    ivRank,
    dayHigh: yahoo.spy.high,   // ADD THIS
    dayLow: yahoo.spy.low,     // ADD THIS
    timestamp: yahoo.timestamp.toISOString()
  }
});
```

**Step 2: Also update IBKR snapshot response (around line 1722)**

Find the IBKR WebSocket snapshot response and add dayHigh/dayLow (use calculated values as fallback):

```ts
snapshot: {
  spyPrice: spyData.last,
  spyChange,
  spyChangePct,
  vix: vixCurrent,
  vixChange,
  vixChangePct,
  vwap: vwap || spyData.last,
  ivRank,
  dayHigh: spyData.last * 1.005,  // ADD - fallback since IBKR WS doesn't provide
  dayLow: spyData.last * 0.995,   // ADD - fallback
  timestamp: spyData.timestamp.toISOString()
}
```

**Step 3: Commit**

```bash
git add server/routes.ts
git commit -m "feat: include day high/low in snapshot response"
```

---

### Task 3: Update Client MarketSnapshot Interface

**Files:**
- Modify: `/client/src/hooks/useMarketSnapshot.ts`

**Step 1: Add dayHigh and dayLow to interface (line 10-22)**

```ts
export interface MarketSnapshot {
  spyPrice: number;
  spyChange: number;
  spyChangePct: number;
  vix: number;
  vixChange: number;
  vixChangePct: number;
  vwap: number | null;
  ivRank: number | null;
  dayHigh: number;      // ADD THIS
  dayLow: number;       // ADD THIS
  marketState: 'PRE' | 'REGULAR' | 'POST' | 'CLOSED';
  source: 'ibkr' | 'ibkr-sse' | 'yahoo' | 'none';
  timestamp: string;
}
```

**Step 2: Update fetchSnapshot to include dayHigh/dayLow (line 49-65)**

```ts
if (data.ok && data.available && data.snapshot) {
  setSnapshot({
    spyPrice: data.snapshot.spyPrice || 0,
    spyChange: data.snapshot.spyChange || 0,
    spyChangePct: data.snapshot.spyChangePct || 0,
    vix: data.snapshot.vix || 0,
    vixChange: data.snapshot.vixChange || 0,
    vixChangePct: data.snapshot.vixChangePct || 0,
    vwap: data.snapshot.vwap ?? null,
    ivRank: data.snapshot.ivRank ?? null,
    dayHigh: data.snapshot.dayHigh || 0,    // ADD THIS
    dayLow: data.snapshot.dayLow || 0,      // ADD THIS
    marketState: data.marketState || 'CLOSED',
    source: data.source || 'none',
    timestamp: data.snapshot.timestamp || new Date().toISOString(),
  });
  lastSpyPriceRef.current = data.snapshot.spyPrice || 0;
  lastVixPriceRef.current = data.snapshot.vix || 0;
  setLoading(false);  // ADD - ensure loading is set to false
}
```

**Step 3: Commit**

```bash
git add client/src/hooks/useMarketSnapshot.ts
git commit -m "feat: add dayHigh/dayLow to MarketSnapshot interface"
```

---

### Task 4: Fix Client to Check Market Status First

**Files:**
- Modify: `/client/src/hooks/useMarketSnapshot.ts`

**Step 1: Add market status check before SSE (replace the useEffect at line 177-189)**

Replace the initialization useEffect with:

```ts
// Initialize - check market status first, then decide SSE vs HTTP
useEffect(() => {
  const initialize = async () => {
    try {
      // Check market status first
      const statusRes = await fetch('/api/market/status');
      const status = await statusRes.json();

      if (status.ok && status.isOpen) {
        // Market is open - try SSE for real-time data
        console.log('[useMarketSnapshot] Market open, connecting SSE...');
        connectSSE();
      } else {
        // Market is closed - skip SSE, go straight to HTTP
        console.log('[useMarketSnapshot] Market closed, using HTTP snapshot...');
        setConnectionStatus('fallback');
        await fetchSnapshot();
        setLoading(false);
      }
    } catch (err) {
      // If status check fails, try SSE anyway
      console.warn('[useMarketSnapshot] Status check failed, trying SSE...');
      connectSSE();
    }
  };

  initialize();

  return () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
  };
}, [connectSSE, fetchSnapshot]);
```

**Step 2: Commit**

```bash
git add client/src/hooks/useMarketSnapshot.ts
git commit -m "fix: check market status before attempting SSE connection"
```

---

### Task 5: Add SSE Timeout

**Files:**
- Modify: `/client/src/hooks/useMarketSnapshot.ts`

**Step 1: Add timeout ref (after line 33)**

```ts
const sseTimeoutRef = useRef<NodeJS.Timeout | null>(null);
```

**Step 2: Update connectSSE to add timeout (in the connectSSE function)**

After `eventSourceRef.current = eventSource;` (around line 87), add:

```ts
// Set timeout - if no price data within 5 seconds, fall back to HTTP
sseTimeoutRef.current = setTimeout(() => {
  console.warn('[useMarketSnapshot] SSE timeout - no data received, falling back to HTTP');
  eventSource.close();
  setConnectionStatus('fallback');
  fetchSnapshot();
}, 5000);
```

**Step 3: Clear timeout when price data received**

In the `if (data.type === 'price')` block (around line 119), add at the start:

```ts
if (data.type === 'price') {
  // Clear timeout since we received data
  if (sseTimeoutRef.current) {
    clearTimeout(sseTimeoutRef.current);
    sseTimeoutRef.current = null;
  }
  // ... rest of existing code
```

**Step 4: Clear timeout in cleanup**

Update the cleanup return in useEffect to also clear sseTimeoutRef:

```ts
return () => {
  if (eventSourceRef.current) {
    eventSourceRef.current.close();
  }
  if (reconnectTimeoutRef.current) {
    clearTimeout(reconnectTimeoutRef.current);
  }
  if (sseTimeoutRef.current) {
    clearTimeout(sseTimeoutRef.current);
  }
};
```

**Step 5: Commit**

```bash
git add client/src/hooks/useMarketSnapshot.ts
git commit -m "fix: add 5-second SSE timeout to prevent slow initial load"
```

---

### Task 6: Update Engine.tsx to Use Real Day High/Low

**Files:**
- Modify: `/client/src/pages/Engine.tsx`

**Step 1: Replace hardcoded dayHigh/dayLow (around line 287-288)**

Find:
```ts
const dayHigh = spyPrice * 1.005;
const dayLow = spyPrice * 0.995;
```

Replace with:
```ts
// Use real day high/low from snapshot, fallback to calculated
const dayHigh = marketSnapshot?.dayHigh || spyPrice * 1.005;
const dayLow = marketSnapshot?.dayLow || spyPrice * 0.995;
```

**Step 2: Commit**

```bash
git add client/src/pages/Engine.tsx
git commit -m "fix: use real day high/low from Yahoo instead of hardcoded values"
```

---

### Task 7: Fix SSE Price Handler Source Badge

**Files:**
- Modify: `/client/src/hooks/useMarketSnapshot.ts`

**Step 1: Update SSE price handler to preserve source from server**

In the `setSnapshot` call inside `if (data.type === 'price')` (around line 128-153), the source is hardcoded to `'ibkr-sse'`. This is actually correct for SSE, but we need to also handle dayHigh/dayLow:

```ts
setSnapshot(prev => ({
  spyPrice: lastSpyPriceRef.current,
  spyChange: prev?.spyChange || 0,
  spyChangePct: data.symbol === 'SPY' && data.changePct != null
    ? data.changePct
    : prev?.spyChangePct || 0,
  vix: lastVixPriceRef.current,
  vixChange: prev?.vixChange || 0,
  vixChangePct: data.symbol === 'VIX' && data.changePct != null
    ? data.changePct
    : prev?.vixChangePct || 0,
  vwap: data.symbol === 'SPY' && data.vwap != null
    ? data.vwap
    : prev?.vwap ?? null,
  ivRank: data.symbol === 'VIX' && data.ivRank != null
    ? data.ivRank
    : prev?.ivRank ?? null,
  dayHigh: prev?.dayHigh || lastSpyPriceRef.current * 1.005,  // ADD
  dayLow: prev?.dayLow || lastSpyPriceRef.current * 0.995,    // ADD
  marketState: data.marketState || prev?.marketState || 'CLOSED',
  source: 'ibkr-sse',
  timestamp: data.timestamp || new Date().toISOString(),
}));
```

**Step 2: Commit**

```bash
git add client/src/hooks/useMarketSnapshot.ts
git commit -m "fix: handle dayHigh/dayLow in SSE price updates"
```

---

### Task 8: Build and Deploy

**Step 1: Build the project**

```bash
cd "/Users/home/Desktop/APE YOLO/APE-YOLO"
npm run build
```

Expected: Build completes without errors

**Step 2: Deploy to production**

```bash
npm run deploy:prod
```

Expected: Deployment succeeds

**Step 3: Final commit with all changes**

```bash
git add -A
git commit -m "fix: market data loading - check status first, add timeout, use real day range"
git push origin main
```

---

## Verification

1. **Open https://apeyolo.com/engine at 11 PM ET (market closed)**
   - Should load data within 1-2 seconds (not 1 minute)
   - Should show "MARKET CLOSED" badge
   - Should show "YAHOO" badge (not "LIVE")
   - Should show real price from Yahoo (~$689.58)
   - Should show real change % (~-0.32%)
   - Should show real day range from Yahoo

2. **Check server logs**
   - Should see: `[Snapshot] Yahoo: SPY=$689.58 (-0.32%), VIX=15.38`

3. **During market hours (9:30 AM - 4:00 PM ET)**
   - Should connect via SSE
   - Should show "LIVE" badge
   - Should show real-time IBKR data
